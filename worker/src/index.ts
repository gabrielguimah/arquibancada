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

// Ranking de notas: a API não tem um pronto, então o Worker percorre as páginas de `players`
// em segundo plano (alarme do Durable Object) e monta o ranking a partir das médias da temporada.
const TOP_RATED_PATH = 'players/toprated';
const TOP_RATED_TTL = 6 * 3600;
const TOP_RATED_SIZE = 20;
// Sobe quando o formato do ranking muda, para não servir a versão antiga guardada no cache.
const TOP_RATED_VERSION = 3;
const CRAWL_GAP_MS = 2000;
// Só entra no ranking quem jogou ao menos esta fração das partidas do jogador com mais jogos.
const TOP_RATED_MIN_APPEARANCES = 0.5;

// Estatísticas dos times (a API não tem um ranking pronto). A nota média da temporada sai das mesmas
// páginas de `players` do ranking de jogadores; o resto (e a nota das últimas 5) sai dos detalhes de
// cada jogo encerrado, buscados em grupos de 2 rodadas (até 20 jogos por chamada de `fixtures?ids=`).
const TEAM_RATINGS_PATH = 'teams/ratings';
const TEAM_RATINGS_VERSION = 3;
const TEAM_LAST_MATCHES = 5;
const TEAM_STATS_TTL = 3600;
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
// Grupos fixos de rodadas: a chave do cache de cada grupo só muda quando um jogo dele termina.
const ROUNDS_PER_CALL = 2;

// Time da rodada (4-3-3): melhores notas da rodada por posição, como o "time da semana" do SofaScore.
const ROUND_TEAM_PATH = 'players/team-of-round';
const ROUND_TEAM_VERSION = 1;
// Só entra quem jogou ao menos isto na partida (evita quem entrou no fim com nota alta).
const ROUND_TEAM_MIN_MINUTES = 45;
const ROUND_TEAM_FORMATION: Record<string, number> = { G: 1, D: 4, M: 3, F: 3 };

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

// Endpoints liberados e por quanto tempo (segundos) cada resposta fica em cache.
// `fixtures` tem TTL dinâmico, calculado a partir dos jogos da resposta.
const ROUTES: Record<string, number | ((body: ApiBody, key: string) => number)> = {
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
  paging?: { current: number; total: number };
  response?: Array<{ fixture?: { timestamp?: number; status?: { short?: string } } }>;
}

interface FixtureDetail {
  fixture: { id: number; timestamp: number; status: { short: string } };
  league: { round: string };
  teams: { home: TeamRef; away: TeamRef };
  goals: { home: number | null; away: number | null };
  statistics?: Array<{ team: { id: number }; statistics: Array<{ type: string; value: number | string | null }> }>;
  players?: Array<{
    team: { id: number };
    players: Array<{
      player: { id: number; name: string; photo: string };
      statistics: Array<{
        games: { minutes: number | null; rating: string | null; position?: string | null };
        passes: { key: number | null };
        tackles: { total: number | null; interceptions: number | null };
        dribbles: { success: number | null };
        penalty: { scored: number | null; commited: number | null };
      }>;
    }>;
  }>;
}

/** Números de um time em uma partida (ou somados em várias). Os nomes são os do site. */
interface TeamStats {
  goalsFor: number;
  goalsAgainst: number;
  yellowCards: number;
  redCards: number;
  possession: number;
  passesAccurate: number;
  shots: number;
  shotsOnGoal: number;
  dribbles: number;
  tackles: number;
  interceptions: number;
  corners: number;
  fouls: number;
  penaltyGoals: number;
  penaltiesConceded: number;
  cleanSheets: number;
  xg: number;
  keyPasses: number;
}

interface TeamMatch {
  timestamp: number;
  rating: number | null;
  stats: TeamStats;
}

interface TeamRef {
  id: number;
  name: string;
  logo: string;
}

interface PlayerSeason {
  player: { id: number; name: string; photo: string };
  statistics: Array<{
    team: { id: number; name: string; logo: string };
    league: { id: number };
    games: { appearences: number | null; minutes: number | null; rating: string | null };
    goals: { total: number | null; assists: number | null };
  }>;
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

function fixturesTtl(body: ApiBody, key: string): number {
  const fixtures = body.response ?? [];
  // Jogos pedidos por id, todos encerrados há mais de 3 h: não mudam mais.
  const byId = /[?&]ids?=/.test(key);
  const settled = fixtures.every(
    (f) => FINISHED_STATUSES.has(f.fixture?.status?.short ?? '') && Date.now() / 1000 - (f.fixture?.timestamp ?? 0) > 3 * 3600,
  );
  if (byId && fixtures.length && settled) return 7 * 24 * 3600;
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

function teamSeasonKey(season: string): string {
  return `${TEAM_RATINGS_PATH}/season?league=${BRASILEIRAO}&season=${season}&v=${TEAM_RATINGS_VERSION}`;
}

function teamStatsKey(season: string): string {
  return `${TEAM_RATINGS_PATH}/stats?league=${BRASILEIRAO}&season=${season}&v=${TEAM_RATINGS_VERSION}`;
}

function roundNumber(round: string): number {
  return Number(round.match(/(\d+)$/)?.[1] ?? 0);
}

/** Lê os números de um time num jogo: estatísticas do time + soma das dos jogadores. */
function matchStats(f: FixtureDetail, teamId: number): TeamMatch {
  const home = f.teams.home.id === teamId;
  const goalsFor = (home ? f.goals.home : f.goals.away) ?? 0;
  const goalsAgainst = (home ? f.goals.away : f.goals.home) ?? 0;
  const teamStat = (type: string) => {
    const v = f.statistics?.find((t) => t.team.id === teamId)?.statistics.find((s) => s.type === type)?.value;
    return typeof v === 'string' ? parseFloat(v) || 0 : (v ?? 0);
  };

  let weighted = 0;
  let minutes = 0;
  const sum = { keyPasses: 0, tackles: 0, interceptions: 0, dribbles: 0, penaltyGoals: 0, penaltiesConceded: 0 };
  for (const p of f.players?.find((t) => t.team.id === teamId)?.players ?? []) {
    const st = p.statistics[0];
    if (!st) continue;
    // Nota do time no jogo: notas de quem entrou em campo, com peso pelos minutos.
    if (st.games.rating && st.games.minutes) {
      weighted += Number(st.games.rating) * st.games.minutes;
      minutes += st.games.minutes;
    }
    sum.keyPasses += st.passes.key ?? 0;
    sum.tackles += st.tackles.total ?? 0;
    sum.interceptions += st.tackles.interceptions ?? 0;
    sum.dribbles += st.dribbles.success ?? 0;
    sum.penaltyGoals += st.penalty.scored ?? 0;
    sum.penaltiesConceded += st.penalty.commited ?? 0;
  }

  return {
    timestamp: f.fixture.timestamp,
    rating: minutes ? weighted / minutes : null,
    stats: {
      goalsFor,
      goalsAgainst,
      yellowCards: teamStat('Yellow Cards'),
      redCards: teamStat('Red Cards'),
      possession: teamStat('Ball Possession'),
      passesAccurate: teamStat('Passes accurate'),
      shots: teamStat('Total Shots'),
      shotsOnGoal: teamStat('Shots on Goal'),
      corners: teamStat('Corner Kicks'),
      fouls: teamStat('Fouls'),
      xg: teamStat('expected_goals'),
      cleanSheets: goalsAgainst === 0 ? 1 : 0,
      ...sum,
    },
  };
}

/** Soma os jogos; posse de bola é média, e xG fica com 2 casas. */
function aggregate(matches: TeamMatch[]): TeamStats {
  const total = {} as TeamStats;
  for (const m of matches) {
    for (const [k, v] of Object.entries(m.stats) as Array<[keyof TeamStats, number]>) total[k] = (total[k] ?? 0) + v;
  }
  if (matches.length) total.possession = Math.round((total.possession / matches.length) * 10) / 10;
  total.xg = round2(total.xg ?? 0);
  return total;
}

/** Rodada pedida em `players/team-of-round?round=...`, no formato da API ("Regular Season - 36"). */
function roundParam(url: URL): string {
  const round = url.searchParams.get('round') ?? '';
  if (!/^Regular Season - \d{1,2}$/.test(round)) throw new HttpError(400, 'Rodada inválida');
  return round;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function topRatedKey(season: string): string {
  return `${TOP_RATED_PATH}?league=${BRASILEIRAO}&season=${season}&v=${TOP_RATED_VERSION}`;
}

function playersPageKey(season: string, page: number): string {
  return `players?league=${BRASILEIRAO}&page=${page}&season=${season}`;
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
  // Alarme da varredura do ranking de notas em execução.
  private crawling = false;
  // Montagem das estatísticas dos times em andamento (uma por vez).
  private teamStatsBuild: Promise<void> | null = null;
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
    const ttl = typeof route === 'function' ? route(body, key) : route;
    this.store(key, text, ttl);
    return { body: text, status: 'MISS', age: 0, ttl };
  }

  private store(key: string, body: string, ttl: number) {
    const entry = { body, fetchedAt: Date.now(), ttl };
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO cache (key, body, fetched_at, ttl) VALUES (?, ?, ?, ?)',
      key,
      entry.body,
      entry.fetchedAt,
      entry.ttl,
    );
    this.memory.set(key, entry);
  }

  /** Ranking de notas da temporada. Devolve o último montado e, se estiver velho, agenda outro. */
  async topRated(): Promise<CacheResult | CacheError> {
    const key = topRatedKey(this.env.SEASON);
    const entry = this.read(key);
    const age = entry ? Math.floor((Date.now() - entry.fetchedAt) / 1000) : 0;
    const fresh = !!entry && age < entry.ttl;
    if (!fresh) await this.startCrawl();
    if (entry) return { body: entry.body, status: fresh ? 'HIT' : 'STALE', age, ttl: entry.ttl };
    return { httpStatus: 503, error: 'Ranking de notas sendo montado, tente em alguns minutos' };
  }

  private async startCrawl() {
    // Durante a execução do alarme, getAlarm() volta null; `crawling` cobre esse intervalo.
    if (this.crawling || (await this.ctx.storage.getAlarm()) !== null) return;
    // Sem alarme e com página salva: a varredura foi interrompida (ex.: deploy) e continua de onde parou.
    if ((await this.ctx.storage.get<number>('crawlPage')) === undefined) await this.ctx.storage.put('crawlPage', 1);
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** Busca uma página de `players` por vez; na última, monta o ranking. */
  async alarm() {
    this.crawling = true;
    try {
      await this.crawlStep();
    } finally {
      this.crawling = false;
    }
  }

  private async crawlStep() {
    const page = (await this.ctx.storage.get<number>('crawlPage')) ?? 1;
    const result = await this.get(playersPageKey(this.env.SEASON, page));
    if ('error' in result) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return;
    }
    const total = (JSON.parse(result.body) as ApiBody).paging?.total ?? page;
    if (page < total) {
      await this.ctx.storage.put('crawlPage', page + 1);
      await this.ctx.storage.setAlarm(Date.now() + CRAWL_GAP_MS);
      return;
    }
    await this.ctx.storage.delete('crawlPage');
    const teams = await this.leagueTeamIds();
    this.buildTopRated(total, teams);
  }

  /**
   * Times do campeonato, pela classificação. As páginas de `players` trazem, na liga 71, estatísticas
   * de times que não disputam a Série A (ex.: "Chapecoense B"); elas ficam fora dos rankings.
   * `null` se a classificação não puder ser lida: aí nada é filtrado.
   */
  private async leagueTeamIds(): Promise<Set<number> | null> {
    const result = await this.get(`standings?league=${BRASILEIRAO}&season=${this.env.SEASON}`);
    if ('error' in result) return null;
    const body = JSON.parse(result.body) as { response: Array<{ league: { standings: Array<Array<{ team: { id: number } }>> } }> };
    const ids = new Set((body.response[0]?.league.standings ?? []).flat().map((s) => s.team.id));
    return ids.size ? ids : null;
  }

  private buildTopRated(pages: number, teams: Set<number> | null) {
    const rows = [];
    for (let page = 1; page <= pages; page++) {
      const entry = this.read(playersPageKey(this.env.SEASON, page));
      if (!entry) continue;
      for (const item of (JSON.parse(entry.body) as { response: PlayerSeason[] }).response) {
        // Quem mudou de time no campeonato tem uma linha por clube; vale a do clube onde mais jogou.
        const stat = item.statistics
          .filter((s) => String(s.league.id) === BRASILEIRAO && s.games.rating && (!teams || teams.has(s.team.id)))
          .sort((a, b) => (b.games.minutes ?? 0) - (a.games.minutes ?? 0))[0];
        if (!stat) continue;
        rows.push({
          player: { id: item.player.id, name: item.player.name, photo: item.player.photo },
          team: stat.team,
          rating: Number(stat.games.rating),
          appearances: stat.games.appearences ?? 0,
          minutes: stat.games.minutes ?? 0,
          goals: stat.goals.total ?? 0,
          assists: stat.goals.assists ?? 0,
        });
      }
    }
    const maxApps = Math.max(0, ...rows.map((r) => r.appearances));
    const minAppearances = Math.ceil(maxApps * TOP_RATED_MIN_APPEARANCES);
    rows.sort((a, b) => b.rating - a.rating);
    // `response`: jogadores regulares (mínimo de jogos). `all`: todos, como a opção "Todos os jogadores" do site.
    const response = rows.filter((r) => r.appearances >= minAppearances).slice(0, TOP_RATED_SIZE);
    const all = rows.slice(0, TOP_RATED_SIZE);
    const body = { updatedAt: new Date().toISOString(), maxAppearances: maxApps, minAppearances, response, all };
    this.store(topRatedKey(this.env.SEASON), JSON.stringify(body), TOP_RATED_TTL);
    this.buildTeamSeasonRatings(pages, teams);
  }

  /** Nota média de cada time na temporada: notas dos jogadores, com peso pelos minutos jogados pelo clube. */
  private buildTeamSeasonRatings(pages: number, leagueTeams: Set<number> | null) {
    const teams = new Map<number, { team: TeamRef; weighted: number; minutes: number; players: number }>();
    for (let page = 1; page <= pages; page++) {
      const entry = this.read(playersPageKey(this.env.SEASON, page));
      if (!entry) continue;
      for (const item of (JSON.parse(entry.body) as { response: PlayerSeason[] }).response) {
        // Aqui vale cada clube por onde o jogador passou, cada um com os seus minutos.
        for (const stat of item.statistics) {
          const minutes = stat.games.minutes ?? 0;
          if (String(stat.league.id) !== BRASILEIRAO || !stat.games.rating || !minutes) continue;
          if (leagueTeams && !leagueTeams.has(stat.team.id)) continue;
          const t = teams.get(stat.team.id) ?? { team: stat.team, weighted: 0, minutes: 0, players: 0 };
          t.weighted += Number(stat.games.rating) * minutes;
          t.minutes += minutes;
          t.players += 1;
          teams.set(stat.team.id, t);
        }
      }
    }
    const rows = [...teams.values()]
      .map((t) => ({ team: t.team, rating: round2(t.weighted / t.minutes), players: t.players }))
      .sort((a, b) => b.rating - a.rating);
    this.store(teamSeasonKey(this.env.SEASON), JSON.stringify(rows), TOP_RATED_TTL);
  }

  /**
   * Estatísticas dos times: temporada e últimos 5 jogos. Devolve o que já está calculado e, se estiver
   * velho, recalcula em segundo plano (a primeira montagem busca os ~350 jogos da temporada).
   */
  async teamRatings(): Promise<CacheResult | CacheError> {
    const ratingEntry = this.read(teamSeasonKey(this.env.SEASON));
    if (!ratingEntry || Date.now() - ratingEntry.fetchedAt >= ratingEntry.ttl * 1000) await this.startCrawl();

    const statsEntry = this.read(teamStatsKey(this.env.SEASON));
    if ((!statsEntry || Date.now() - statsEntry.fetchedAt >= statsEntry.ttl * 1000) && !this.teamStatsBuild) {
      this.teamStatsBuild = this.buildTeamStats()
        .catch((err) => console.error('estatísticas dos times falharam', err))
        .finally(() => (this.teamStatsBuild = null));
    }

    if (!ratingEntry && !statsEntry) return { httpStatus: 503, error: 'Estatísticas dos times sendo calculadas, tente em alguns minutos' };

    // Nota da temporada (páginas de jogadores) junto com as demais estatísticas (jogos).
    const ratings = new Map<number, number>(
      (ratingEntry ? (JSON.parse(ratingEntry.body) as Array<{ team: TeamRef; rating: number }>) : []).map((r) => [r.team.id, r.rating]),
    );
    const stats = statsEntry
      ? (JSON.parse(statsEntry.body) as { season: Array<{ team: TeamRef; games: number; stats: TeamStats }>; last5: unknown[] })
      : null;
    const season = stats
      ? stats.season.map((r) => ({ ...r, rating: ratings.get(r.team.id) ?? null }))
      : ratingEntry
        ? (JSON.parse(ratingEntry.body) as unknown[])
        : null;

    const body = JSON.stringify({ updatedAt: new Date().toISOString(), season, last5: stats?.last5 ?? null });
    // Resposta montada aqui; com alguma lista ainda faltando, o navegador não deve guardá-la.
    return { body, status: 'HIT', age: 0, ttl: season && stats ? 600 : 0 };
  }

  /**
   * Time da rodada em 4-3-3: goleiro, 4 defensores, 3 meias e 3 atacantes com as melhores notas
   * nos jogos encerrados da rodada (posição e nota de cada jogo, mínimo de 45 minutos).
   */
  async roundTeam(round: string): Promise<CacheResult | CacheError> {
    const key = `${ROUND_TEAM_PATH}?round=${encodeURIComponent(round)}&season=${this.env.SEASON}&v=${ROUND_TEAM_VERSION}`;
    const cached = this.read(key);
    if (cached && Date.now() - cached.fetchedAt < cached.ttl * 1000) {
      return { body: cached.body, status: 'HIT', age: Math.floor((Date.now() - cached.fetchedAt) / 1000), ttl: cached.ttl };
    }

    // Mesma chave que o site usa ao abrir a rodada (parâmetros em ordem, como em cacheKey).
    const list = await this.get(`fixtures?${new URLSearchParams({ league: BRASILEIRAO, round, season: this.env.SEASON })}`);
    if ('error' in list) return list;
    const fixtures = (JSON.parse(list.body) as { response: FixtureDetail[] }).response;
    const finished = fixtures.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short));

    const candidates = new Map<string, Array<{ player: unknown; team: TeamRef; rating: number; minutes: number }>>();
    if (finished.length) {
      const details = await this.get(`fixtures?ids=${finished.map((f) => f.fixture.id).sort((a, b) => a - b).join('-')}`);
      if ('error' in details) return details;
      for (const f of (JSON.parse(details.body) as { response: FixtureDetail[] }).response) {
        for (const side of f.players ?? []) {
          const team = [f.teams.home, f.teams.away].find((t) => t.id === side.team.id);
          if (!team) continue;
          for (const p of side.players) {
            const g = p.statistics[0]?.games;
            if (!g?.rating || !g.position || (g.minutes ?? 0) < ROUND_TEAM_MIN_MINUTES) continue;
            const list = candidates.get(g.position) ?? [];
            list.push({
              player: { id: p.player.id, name: p.player.name, photo: p.player.photo },
              team: { id: team.id, name: team.name, logo: team.logo },
              rating: Number(g.rating),
              minutes: g.minutes ?? 0,
            });
            candidates.set(g.position, list);
          }
        }
      }
    }

    const players = Object.entries(ROUND_TEAM_FORMATION).flatMap(([position, count]) =>
      (candidates.get(position) ?? [])
        .sort((a, b) => b.rating - a.rating)
        .slice(0, count)
        .map((p) => ({ ...p, position })),
    );
    const complete = finished.length === fixtures.length && fixtures.length > 0;
    const settled = complete && finished.every((f) => Date.now() / 1000 - f.fixture.timestamp > 3 * 3600);
    const body = JSON.stringify({ round, formation: '4-3-3', games: finished.length, totalGames: fixtures.length, players });
    // Rodada encerrada há horas não muda; rodada em andamento é refeita a cada 10 min.
    const ttl = settled ? 7 * 24 * 3600 : 600;
    this.store(key, body, ttl);
    return { body, status: 'MISS', age: 0, ttl };
  }

  /** Busca os detalhes de todos os jogos encerrados e soma os números de cada time. */
  private async buildTeamStats() {
    const finished = await this.get(`fixtures?league=${BRASILEIRAO}&season=${this.env.SEASON}&status=FT-AET-PEN`);
    if ('error' in finished) return;
    const fixtures = (JSON.parse(finished.body) as { response: FixtureDetail[] }).response;

    const groups = new Map<number, number[]>();
    for (const f of fixtures) {
      const group = Math.floor((roundNumber(f.league.round) - 1) / ROUNDS_PER_CALL);
      groups.set(group, [...(groups.get(group) ?? []), f.fixture.id]);
    }

    const byTeam = new Map<number, { team: TeamRef; matches: TeamMatch[] }>();
    for (const ids of groups.values()) {
      const result = await this.get(`fixtures?ids=${ids.sort((a, b) => a - b).join('-')}`);
      if ('error' in result) return;
      for (const f of (JSON.parse(result.body) as { response: FixtureDetail[] }).response) {
        if (!FINISHED_STATUSES.has(f.fixture.status.short)) continue;
        for (const team of [f.teams.home, f.teams.away]) {
          const t = byTeam.get(team.id) ?? { team: { id: team.id, name: team.name, logo: team.logo }, matches: [] };
          t.matches.push(matchStats(f, team.id));
          byTeam.set(team.id, t);
        }
      }
    }

    const season = [];
    const last5 = [];
    for (const { team, matches } of byTeam.values()) {
      matches.sort((a, b) => b.timestamp - a.timestamp);
      season.push({ team, games: matches.length, stats: aggregate(matches) });
      const recent = matches.slice(0, TEAM_LAST_MATCHES);
      const ratings = recent.map((m) => m.rating).filter((r): r is number => r !== null);
      last5.push({
        team,
        games: recent.length,
        rating: ratings.length ? round2(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
        matches: ratings.map(round2),
        stats: aggregate(recent),
      });
    }
    this.store(teamStatsKey(this.env.SEASON), JSON.stringify({ season, last5 }), TEAM_STATS_TTL);
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
      const result =
        url.pathname === `/${TOP_RATED_PATH}`
          ? await stub.topRated()
          : url.pathname === `/${TEAM_RATINGS_PATH}`
            ? await stub.teamRatings()
            : url.pathname === `/${ROUND_TEAM_PATH}`
              ? await stub.roundTeam(roundParam(url))
              : await stub.get(cacheKey(url));
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
