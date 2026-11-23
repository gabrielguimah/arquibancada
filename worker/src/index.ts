import { DurableObject } from 'cloudflare:workers';

const UPSTREAM = 'https://v3.football.api-sports.io';
const BRASILEIRAO = '71';

// Status de jogo em andamento na API-Football.
// Intervalo mínimo entre chamadas à API: ela recusa rajadas, mesmo abaixo do limite por minuto.
const MIN_GAP_MS = 1000;

// A API-Football limita alguns endereços de saída da Cloudflare (compartilhados com outros clientes).
// As chamadas saem por Durable Objects nestas regiões; se uma for bloqueada, passa para a próxima.
const REGIONS: DurableObjectLocationHint[] = ['eeur', 'apac', 'weur', 'enam', 'wnam', 'sam', 'oc'];
const REGION_COOLDOWN_MS = 10 * 60_000;
const MAX_REGION_ATTEMPTS = 3;

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

// Endpoints liberados e por quanto tempo (segundos) cada resposta fica em cache.
// `fixtures` tem TTL dinâmico, calculado a partir dos jogos da resposta.
const ROUTES: Record<string, number | ((body: ApiBody) => number)> = {
  fixtures: fixturesTtl,
  'fixtures/rounds': 3600,
  'fixtures/headtohead': 6 * 3600,
  standings: 300,
  teams: 24 * 3600,
  'teams/statistics': 3600,
  players: 6 * 3600,
  'players/squads': 24 * 3600,
  'players/topscorers': 3600,
  'players/topassists': 3600,
  'players/topyellowcards': 3600,
  'players/topredcards': 3600,
};

interface ApiBody {
  errors?: unknown[] | Record<string, string>;
  response?: Array<{ fixture?: { timestamp?: number; status?: { short?: string } } }>;
}

interface UpstreamResponse {
  ok: boolean;
  text: string;
  rateLimited: boolean;
  remaining: number | null;
  minuteLimit: number | null;
  minuteRemaining: number | null;
}

interface CacheEntry {
  body: string;
  fetchedAt: number;
  ttl: number;
}

interface CacheResult {
  body: string;
  status: 'HIT' | 'MISS' | 'STALE';
  age: number;
  ttl: number;
}

interface CacheError {
  error: string;
  httpStatus: number;
}

function fixturesTtl(body: ApiBody): number {
  const fixtures = body.response ?? [];
  if (fixtures.some((f) => LIVE_STATUSES.has(f.fixture?.status?.short ?? ''))) return 15;
  const now = Date.now() / 1000;
  const startsSoon = fixtures.some((f) => {
    const t = f.fixture?.timestamp ?? 0;
    return f.fixture?.status?.short === 'NS' && t - now < 2 * 3600 && t - now > -3600;
  });
  return startsSoon ? 60 : 600;
}

function hasErrors(body: ApiBody): boolean {
  const e = body.errors;
  return Array.isArray(e) ? e.length > 0 : !!e && Object.keys(e).length > 0;
}

function numberHeader(res: Response, name: string): number | null {
  const value = res.headers.get(name);
  return value === null || value === '' ? null : Number(value);
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A instância "global" coordena todas as chamadas à API-Football: guarda o cache,
 * evita chamadas duplicadas simultâneas e conta a cota diária. As instâncias "fetch-<região>"
 * só executam a chamada (`upstream`), para que ela saia por endereços daquela região.
 */
export class ApiCache extends DurableObject<Env> {
  private memory = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<CacheResult | CacheError>>();
  // Regiões bloqueadas pela API, com o instante em que podem ser tentadas de novo.
  private regionCooldown = new Map<DurableObjectLocationHint, number>();
  private lastRegion: DurableObjectLocationHint | null = null;
  // Fila que espaça as chamadas à API em MIN_GAP_MS.
  private queue: Promise<void> = Promise.resolve();
  private lastCallAt = 0;
  // Últimos cabeçalhos de limite por minuto recebidos, para diagnóstico em /status.
  private minuteRate: { limit: number | null; remaining: number | null } = { limit: null, remaining: null };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL, ttl INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS quota (day TEXT PRIMARY KEY, used INTEGER NOT NULL, remaining INTEGER);
      `);
    });
  }

  async get(key: string): Promise<CacheResult | CacheError> {
    const entry = this.read(key);
    const age = entry ? Math.floor((Date.now() - entry.fetchedAt) / 1000) : 0;
    if (entry && age < entry.ttl) return { body: entry.body, status: 'HIT', age, ttl: entry.ttl };

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.refresh(key, entry).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  status() {
    const row = this.ctx.storage.sql
      .exec<{ used: number; remaining: number | null }>('SELECT used, remaining FROM quota WHERE day = ?', utcDay())
      .toArray()[0];
    return { day: utcDay(), used: row?.used ?? 0, limit: Number(this.env.DAILY_LIMIT), apiRemaining: row?.remaining ?? null, minuteRate: this.minuteRate, region: this.lastRegion };
  }

  private async refresh(key: string, stale: CacheEntry | undefined): Promise<CacheResult | CacheError> {
    const staleResult = (): CacheResult | null =>
      stale ? { body: stale.body, status: 'STALE', age: Math.floor((Date.now() - stale.fetchedAt) / 1000), ttl: stale.ttl } : null;

    const regions = REGIONS.filter((r) => (this.regionCooldown.get(r) ?? 0) < Date.now()).slice(0, MAX_REGION_ATTEMPTS);
    if (regions.length === 0) {
      return staleResult() ?? { httpStatus: 429, error: 'API temporariamente indisponível, tente em instantes' };
    }

    let res: UpstreamResponse | null = null;
    for (const region of regions) {
      if (this.status().used >= Number(this.env.DAILY_LIMIT)) {
        return staleResult() ?? { httpStatus: 503, error: 'Cota diária esgotada' };
      }
      await this.waitTurn();
      this.countRequest(null);
      try {
        res = await this.env.API_CACHE.get(this.env.API_CACHE.idFromName(`fetch-${region}`), { locationHint: region }).upstream(key);
      } catch (err) {
        // Falha na instância da região (ou na rede dela): tenta a próxima.
        console.error(`upstream ${region} falhou`, err);
        this.regionCooldown.set(region, Date.now() + 60_000);
        res = null;
        continue;
      }
      if (res.remaining !== null) this.countRequest(res.remaining, false);
      this.minuteRate = { limit: res.minuteLimit, remaining: res.minuteRemaining };
      this.lastRegion = region;
      if (!res.rateLimited) break;
      this.regionCooldown.set(region, Date.now() + REGION_COOLDOWN_MS);
    }

    if (!res || !res.ok) {
      return staleResult() ?? { httpStatus: res?.rateLimited ? 429 : 502, error: res?.text ?? 'Falha ao acessar a API' };
    }
    const text = res.text;
    const body: ApiBody = JSON.parse(text);

    const route = ROUTES[key.split('?')[0]];
    const ttl = typeof route === 'function' ? route(body) : route;
    const entry = { body: text, fetchedAt: Date.now(), ttl };
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO cache (key, body, fetched_at, ttl) VALUES (?, ?, ?, ?)',
      key,
      entry.body,
      entry.fetchedAt,
      entry.ttl,
    );
    this.memory.set(key, entry);
    return { body: text, status: 'MISS', age: 0, ttl };
  }

  /** Executa a chamada à API a partir desta instância (usado pelas instâncias "fetch-<região>"). */
  async upstream(key: string): Promise<UpstreamResponse> {
    const res = await fetch(`${UPSTREAM}/${key}`, { headers: { 'x-apisports-key': this.env.API_FOOTBALL_KEY } });
    const text = await res.text();
    let body: ApiBody;
    try {
      body = JSON.parse(text);
    } catch {
      body = { errors: ['invalid json'] };
    }
    return {
      ok: res.ok && !hasErrors(body),
      text,
      rateLimited: res.status === 429 || (!!body.errors && 'rateLimit' in body.errors),
      remaining: numberHeader(res, 'x-ratelimit-requests-remaining'),
      minuteLimit: numberHeader(res, 'x-ratelimit-limit'),
      minuteRemaining: numberHeader(res, 'x-ratelimit-remaining'),
    };
  }

  private waitTurn(): Promise<void> {
    const turn = this.queue.then(async () => {
      const wait = this.lastCallAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastCallAt = Date.now();
    });
    this.queue = turn;
    return turn;
  }

  private read(key: string): CacheEntry | undefined {
    let entry = this.memory.get(key);
    if (!entry) {
      const row = this.ctx.storage.sql
        .exec<{ body: string; fetched_at: number; ttl: number }>('SELECT body, fetched_at, ttl FROM cache WHERE key = ?', key)
        .toArray()[0];
      if (row) {
        entry = { body: row.body, fetchedAt: row.fetched_at, ttl: row.ttl };
        this.memory.set(key, entry);
      }
    }
    return entry;
  }

  private countRequest(remaining: number | null, increment = true) {
    this.ctx.storage.sql.exec(
      `INSERT INTO quota (day, used, remaining) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET used = used + ?, remaining = COALESCE(?, remaining)`,
      utcDay(),
      increment ? 1 : 0,
      remaining,
      increment ? 1 : 0,
      remaining,
    );
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Monta a chave de cache (caminho + query ordenada) e recusa pedidos fora do Brasileirão. */
function cacheKey(url: URL): string {
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  if (!(path in ROUTES)) throw new HttpError(404, 'Endpoint não suportado');

  const league = url.searchParams.get('league');
  if (league !== null && league !== BRASILEIRAO) throw new HttpError(400, 'Somente league=71');

  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (params.length === 0) throw new HttpError(400, 'Parâmetros obrigatórios');
  return `${path}?${new URLSearchParams(params)}`;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').includes(origin);
  return allowed ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Método não permitido', { status: 405, headers: cors });

    const url = new URL(request.url);
    const stub = env.API_CACHE.getByName('global');

    if (url.pathname === '/status') return Response.json(await stub.status(), { headers: cors });

    try {
      const result = await stub.get(cacheKey(url));
      if ('error' in result) return Response.json({ error: result.error }, { status: result.httpStatus, headers: cors });
      const maxAge = Math.max(0, result.ttl - result.age);
      return new Response(result.body, {
        headers: {
          ...cors,
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${maxAge}`,
          'x-cache': result.status,
        },
      });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status, headers: cors });
    }
  },
} satisfies ExportedHandler<Env>;
