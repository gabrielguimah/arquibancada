import { DurableObject } from 'cloudflare:workers';
import { teamName } from '../../src/app/api/team-names';
import { GoalAlert, GoalEvent, WatchState, detectGoals, minuteLabel } from '../../src/app/shared/goal-detect';
import { PushTarget, Vapid, b64urlDecode, sendPush } from './web-push';

// Avisos de gol por Web Push: chegam no celular e no computador mesmo com o site fechado. Um Durable
// Object (`GoalPush`, instância única) guarda as inscrições e, enquanto houver alguma, acompanha os jogos
// do dia pelo próprio alarme, com as mesmas buscas (e o mesmo cache) que o site faz em LiveFixtures:
// com jogo rolando, a cada 15 s; sem jogo, acorda pouco antes do próximo início.

const CHECK_LIVE_MS = 15_000;
const CHECK_IDLE_MAX_MS = 30 * 60_000;
// Jogos passam a ser acompanhados este tempo antes do início (estado inicial 0 x 0 guardado).
const KICKOFF_MARGIN_MS = 5 * 60_000;
// Envios por execução do alarme (limite de subrequisições do Worker); o resto vai na próxima, 1 s depois.
const SENDS_PER_RUN = 40;
// Mensagem de gol guardada pelo serviço de push por até 10 min (aparelho sem sinal); depois, perdeu a graça.
const GOAL_TTL_S = 600;
const MAX_SUBSCRIPTIONS = 20_000;
// Falhas seguidas (fora 404/410, que apagam na hora) até desistir de uma inscrição.
const MAX_FAILURES = 10;
// Notificação de teste (botão do site): chega este tempo depois do clique (dá tempo de sair do site).
const TEST_DELAY_MS = 10_000;
// ...e o gol de teste é anulado este tempo depois.
const TEST_CANCEL_AFTER_MS = 5_000;
// Só serviços de push conhecidos (Chrome/Android, Firefox, Safari/iPhone, Edge): o Worker não manda
// requisições para qualquer endereço.
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)$/;

const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const PROGRESS: Record<string, number> = { TBD: 0, NS: 0, '1H': 1, HT: 2, '2H': 3, BT: 4, ET: 5, P: 6, AET: 7, PEN: 7, FT: 7 };

interface PushTeam {
  id: number;
  name: string;
  logo: string;
}

export type PushEvent = GoalEvent;

export interface PushFixture {
  fixture: { id: number; timestamp: number; status: { short: string; elapsed: number | null; extra?: number | null } };
  teams: { home: PushTeam; away: PushTeam };
  goals: { home: number | null; away: number | null };
  events?: PushEvent[];
}

/** Conteúdo da notificação (o service worker do site mostra como veio). Mesmo texto dos avisos do site. */
export function alertPayload(f: PushFixture, a: GoalAlert<PushEvent>) {
  const home = teamName(f.teams.home);
  const away = teamName(f.teams.away);
  const team = teamName(a.event.team);
  const score = `${home} ${f.goals.home ?? 0} × ${f.goals.away ?? 0} ${away}`;
  const extra = a.event.detail === 'Penalty' ? ' (pênalti)' : a.event.detail === 'Own Goal' ? ' (contra)' : '';
  const who = `${a.event.player.name ?? ''} ${minuteLabel(a.event)}${extra}`.trim();
  const second =
    a.type === 'cancelled' ? `Anulado pelo VAR${a.reason ? `: ${a.reason}` : ''}` : a.event.assist.name ? `Assistência: ${a.event.assist.name}` : '';
  return {
    title: a.type === 'cancelled' ? `🚫 Gol anulado do ${team}` : `⚽ Gol do ${team}!`,
    body: [who, second, score].filter(Boolean).join('\n'),
    icon: a.event.team.logo,
    // Mesma `tag` do aviso do site: um substitui o outro em vez de aparecerem dois.
    tag: a.id,
    // Relativo ao site (o service worker completa): clicar abre a partida.
    path: `partida/${f.fixture.id}`,
    // Som do site, se ele estiver aberto (sino no gol, bloop no anulado).
    sound: a.type,
  };
}

/** Situação e placar da lista do dia, se ela estiver mais adiantada que a busca por id (como no site). */
function fresher(byId: PushFixture, listed: PushFixture | undefined): PushFixture {
  if (!listed) return byId;
  const progress = (f: PushFixture) => [PROGRESS[f.fixture.status.short] ?? 0, f.fixture.status.elapsed ?? 0, f.fixture.status.extra ?? 0];
  const [a, b] = [progress(byId), progress(listed)];
  const ahead = b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  return ahead > 0 ? { ...byId, fixture: { ...byId.fixture, status: listed.fixture.status }, goals: listed.goals } : byId;
}

/** Chave de cache igual à que o Worker monta para o site (parâmetros em ordem alfabética). */
function apiKey(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))}`;
}

function brasiliaDay(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(now));
}

interface SubscriptionInput {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

/** Inscrição recebida do site, conferida; `null` se inválida ou de um serviço de push desconhecido. */
export function validSubscription(input: SubscriptionInput | null): PushTarget | null {
  const endpoint = input?.endpoint;
  const p256dh = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (endpoint.length > 1024 || p256dh.length > 128 || auth.length > 64) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || !PUSH_HOSTS.test(url.hostname)) return null;
    if (b64urlDecode(p256dh).length !== 65 || b64urlDecode(auth).length < 16) return null;
  } catch {
    return null;
  }
  return { endpoint, p256dh, auth };
}

export class GoalPush extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS watch (fixture INTEGER PRIMARY KEY, state TEXT NOT NULL, updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL, payload TEXT NOT NULL, ttl INTEGER NOT NULL, created INTEGER NOT NULL);
      `);
      // `not_before`: envio agendado (notificação de teste); 0 = assim que possível.
      const hasColumn = this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM pragma_table_info('outbox') WHERE name = 'not_before'")
        .one().n;
      if (!hasColumn) this.ctx.storage.sql.exec('ALTER TABLE outbox ADD COLUMN not_before INTEGER NOT NULL DEFAULT 0');
    });
  }

  /** Inscreve (ou atualiza) um navegador. Na primeira vez, manda uma notificação de confirmação. */
  async subscribe(input: SubscriptionInput | null): Promise<{ ok: boolean; error?: string }> {
    const sub = validSubscription(input);
    if (!sub) return { ok: false, error: 'Inscrição inválida' };
    const sql = this.ctx.storage.sql;
    const exists = sql.exec('SELECT 1 FROM subs WHERE endpoint = ?', sub.endpoint).toArray().length > 0;
    if (!exists && this.subscriptions() >= MAX_SUBSCRIPTIONS) return { ok: false, error: 'Limite de inscrições atingido' };
    sql.exec(
      'INSERT INTO subs (endpoint, p256dh, auth, created) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, failures = 0',
      sub.endpoint,
      sub.p256dh,
      sub.auth,
      Date.now(),
    );
    if (!exists) {
      const welcome = {
        title: '🔔 Notificações de gol ligadas',
        body: 'Os gols do Brasileirão vão chegar aqui, mesmo com o site fechado.',
        tag: 'arquibancada-push-ligado',
        // Aparece mesmo com o site na frente (os gols, não: aí o aviso é o da página).
        always: true,
      };
      sql.exec('INSERT INTO outbox (endpoint, payload, ttl, created) VALUES (?, ?, ?, ?)', sub.endpoint, JSON.stringify(welcome), 60, Date.now());
    }
    // Acorda o alarme agora: envia a confirmação e, se for a primeira inscrição, começa a acompanhar.
    await this.ctx.storage.setAlarm(Date.now());
    return { ok: true };
  }

  async unsubscribe(endpoint: unknown): Promise<{ ok: boolean }> {
    if (typeof endpoint !== 'string') return { ok: false };
    this.ctx.storage.sql.exec('DELETE FROM subs WHERE endpoint = ?', endpoint);
    this.ctx.storage.sql.exec('DELETE FROM outbox WHERE endpoint = ?', endpoint);
    return { ok: true };
  }

  /**
   * Notificações de teste para um navegador já inscrito: um gol daqui a 10 s e, 5 s depois, o mesmo gol
   * anulado pelo VAR (um teste por navegador: clicar de novo reagenda). Devolve quando o gol sai, ou
   * `null` se o navegador não está inscrito.
   */
  async testPush(endpoint: unknown): Promise<number | null> {
    if (typeof endpoint !== 'string') return null;
    const sql = this.ctx.storage.sql;
    if (!sql.exec('SELECT 1 FROM subs WHERE endpoint = ?', endpoint).toArray().length) return null;
    const at = Date.now() + TEST_DELAY_MS;
    // Um gol de mentira, montado igual aos de verdade (mesmo texto, escudo e som).
    const flamengo = { id: 127, name: 'Flamengo', logo: 'https://media.api-sports.io/football/teams/127.png' };
    const palmeiras = { id: 121, name: 'Palmeiras', logo: 'https://media.api-sports.io/football/teams/121.png' };
    const event: PushEvent = {
      time: { elapsed: 23, extra: null },
      team: flamengo,
      player: { id: null, name: 'Pedro' },
      assist: { id: null, name: 'Arrascaeta' },
      type: 'Goal',
      detail: 'Normal Goal',
    };
    const fixture: PushFixture = {
      fixture: { id: 0, timestamp: Math.floor(at / 1000), status: { short: '1H', elapsed: 23 } },
      teams: { home: flamengo, away: palmeiras },
      goals: { home: 1, away: 0 },
      events: [event],
    };
    const goal = {
      ...alertPayload(fixture, { id: `arquibancada-teste-${at}`, type: 'goal', event }),
      // A partida não existe: o clique abre o site.
      path: '',
      // Aparece mesmo com o site na frente. Um id (`tag`) por teste: o site toca o som de cada um.
      always: true,
    };
    // Logo depois, o VAR anula o gol (placar volta a 0 x 0).
    const var_: PushEvent = { ...event, assist: { id: null, name: null }, type: 'Var', detail: 'Goal Disallowed - offside' };
    const cancelled = {
      ...alertPayload(
        { ...fixture, goals: { home: 0, away: 0 }, events: [event, var_] },
        { id: `arquibancada-teste-${at}-anulado`, type: 'cancelled', event: var_, reason: 'impedimento' },
      ),
      path: '',
      always: true,
    };
    sql.exec('DELETE FROM outbox WHERE endpoint = ? AND not_before > 0', endpoint);
    // `created` = hora do envio: a validade (10 min) conta a partir dela.
    for (const [payload, when] of [
      [goal, at],
      [cancelled, at + TEST_CANCEL_AFTER_MS],
    ] as const) {
      sql.exec(
        'INSERT INTO outbox (endpoint, payload, ttl, created, not_before) VALUES (?, ?, ?, ?, ?)',
        endpoint,
        JSON.stringify(payload),
        GOAL_TTL_S,
        when,
        when,
      );
    }
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > at) await this.ctx.storage.setAlarm(at);
    return at;
  }

  /** Chamado pelo cron: religa o alarme se ele parou por algum motivo e há inscritos. */
  async wake() {
    if (this.subscriptions() > 0 && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  status() {
    const outbox = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM outbox').one().n;
    const watching = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM watch').one().n;
    return { subscriptions: this.subscriptions(), outbox, watching };
  }

  async alarm() {
    const now = Date.now();
    if (this.subscriptions() === 0) {
      // Ninguém inscrito: para de acompanhar (a próxima inscrição religa).
      this.ctx.storage.sql.exec('DELETE FROM outbox');
      await this.ctx.storage.delete('nextCheck');
      return;
    }
    let next = (await this.ctx.storage.get<number>('nextCheck')) ?? 0;
    if (now >= next - 1000) {
      let delay = CHECK_LIVE_MS;
      try {
        delay = await this.check(now);
      } catch (err) {
        console.error('verificação dos gols falhou', err);
      }
      next = now + delay;
      await this.ctx.storage.put('nextCheck', next);
    }
    const more = await this.drain();
    // Próximo envio agendado (teste), se vier antes da próxima verificação.
    const scheduled = this.ctx.storage.sql.exec<{ at: number | null }>('SELECT MIN(not_before) AS at FROM outbox WHERE not_before > ?', Date.now()).one().at;
    await this.ctx.storage.setAlarm(more ? Date.now() + 1000 : Math.min(next, scheduled ?? next));
  }

  private subscriptions(): number {
    return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM subs').one().n;
  }

  private async fixtures(key: string): Promise<PushFixture[]> {
    const result = await this.env.API_CACHE.getByName('global').serve(key);
    if ('error' in result) throw new Error(result.error);
    return (JSON.parse(result.body) as { response?: PushFixture[] }).response ?? [];
  }

  /** Uma verificação dos jogos do dia; devolve em quanto tempo verificar de novo. */
  private async check(now: number): Promise<number> {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM watch WHERE updated < ?', now - 24 * 3600_000);
    const today = await this.fixtures(
      apiKey('fixtures', { date: brasiliaDay(now), league: '71', season: this.env.SEASON, timezone: 'America/Sao_Paulo' }),
    );
    const watch = today.filter(
      (f) => LIVE.has(f.fixture.status.short) || (f.fixture.status.short === 'NS' && f.fixture.timestamp * 1000 - now < KICKOFF_MARGIN_MS),
    );
    if (!watch.length) {
      const upcoming = today
        .filter((f) => f.fixture.status.short === 'NS')
        .map((f) => f.fixture.timestamp * 1000 - KICKOFF_MARGIN_MS - now)
        .filter((ms) => ms > 0);
      return Math.min(CHECK_IDLE_MAX_MS, ...upcoming);
    }

    const listed = new Map(today.map((f) => [f.fixture.id, f]));
    const ids = watch.map((f) => f.fixture.id);
    const detailed: PushFixture[] = [];
    // Em blocos de 20, na ordem da lista: a mesma chave que o site usa, então o cache é compartilhado.
    for (let i = 0; i < ids.length; i += 20) detailed.push(...(await this.fixtures(apiKey('fixtures', { ids: ids.slice(i, i + 20).join('-') }))));

    for (const raw of detailed) {
      const f = fresher(raw, listed.get(raw.fixture.id));
      const row = sql.exec<{ state: string }>('SELECT state FROM watch WHERE fixture = ?', f.fixture.id).toArray()[0];
      const { state, alerts } = detectGoals(row ? (JSON.parse(row.state) as WatchState) : undefined, f);
      sql.exec('INSERT OR REPLACE INTO watch (fixture, state, updated) VALUES (?, ?, ?)', f.fixture.id, JSON.stringify(state), now);
      for (const alert of alerts) {
        const payload = JSON.stringify(alertPayload(f, alert));
        sql.exec('INSERT INTO outbox (endpoint, payload, ttl, created) SELECT endpoint, ?, ?, ? FROM subs', payload, GOAL_TTL_S, now);
      }
    }
    return CHECK_LIVE_MS;
  }

  /** Envia o que está na fila (um lote); devolve se ainda sobrou. */
  private async drain(): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    sql.exec('DELETE FROM outbox WHERE created + ttl * 1000 < ?', now);
    const batch = sql
      .exec<{ id: number; payload: string; ttl: number; created: number; endpoint: string; p256dh: string; auth: string }>(
        'SELECT o.id, o.payload, o.ttl, o.created, s.endpoint, s.p256dh, s.auth FROM outbox o JOIN subs s ON s.endpoint = o.endpoint WHERE o.not_before <= ? ORDER BY o.id LIMIT ?',
        now,
        SENDS_PER_RUN,
      )
      .toArray();
    if (!batch.length) {
      sql.exec('DELETE FROM outbox WHERE endpoint NOT IN (SELECT endpoint FROM subs)');
      return false;
    }
    const vapid = this.vapid();
    await Promise.all(
      batch.map(async (m) => {
        sql.exec('DELETE FROM outbox WHERE id = ?', m.id);
        // Tempo que sobra da validade (a mensagem pode ter esperado na fila).
        const ttl = Math.max(30, m.ttl - Math.floor((now - m.created) / 1000));
        try {
          const res = await sendPush(m, m.payload, vapid, { ttl, urgency: 'high' });
          if (res.status === 404 || res.status === 410) {
            // Inscrição cancelada no navegador (ou expirada): sai da lista.
            sql.exec('DELETE FROM subs WHERE endpoint = ?', m.endpoint);
            sql.exec('DELETE FROM outbox WHERE endpoint = ?', m.endpoint);
          } else if (!res.ok) {
            console.error('push recusado', res.status, new URL(m.endpoint).hostname, await res.text().catch(() => ''));
            this.failed(m.endpoint);
          } else {
            sql.exec('UPDATE subs SET failures = 0 WHERE endpoint = ?', m.endpoint);
          }
        } catch (err) {
          console.error('push falhou', new URL(m.endpoint).hostname, err);
          this.failed(m.endpoint);
        }
      }),
    );
    return sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE not_before <= ?', Date.now()).one().n > 0;
  }

  private failed(endpoint: string) {
    const sql = this.ctx.storage.sql;
    sql.exec('UPDATE subs SET failures = failures + 1 WHERE endpoint = ?', endpoint);
    sql.exec('DELETE FROM subs WHERE endpoint = ? AND failures >= ?', endpoint, MAX_FAILURES);
  }

  private vapid(): Vapid {
    return { privateJwk: JSON.parse(this.env.VAPID_PRIVATE_KEY) as JsonWebKey, publicKey: this.env.VAPID_PUBLIC_KEY, subject: this.env.VAPID_SUBJECT };
  }
}
