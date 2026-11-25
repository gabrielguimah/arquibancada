import { DurableObject } from 'cloudflare:workers';
import { teamName } from '../../src/app/api/team-names';
import { GoalAlert, GoalEvent, WatchState, detectGoals, notificationText } from '../../src/app/shared/goal-detect';
import { LIVE_STATUSES, TZ, dayInBrasilia, fresher } from '../../src/app/shared/fixture-status';
import { keyFor } from './cache-key';
import { PushTarget, Vapid, b64urlDecode, sendPush } from './web-push';

// Avisos de gol por Web Push: chegam no celular e no computador mesmo com o site fechado. Um Durable
// Object (`GoalPush`, instância única) guarda as inscrições e, enquanto houver alguma, acompanha os jogos
// do dia pelo próprio alarme, com as mesmas buscas (e o mesmo cache) que o site faz em LiveFixtures:
// com jogo rolando, a cada 15 s; sem jogo, acorda pouco antes do próximo início.

const CHECK_LIVE_MS = 15_000;
const CHECK_IDLE_MAX_MS = 30 * 60_000;
// Jogos passam a ser acompanhados este tempo antes do início (estado inicial 0 x 0 guardado).
const KICKOFF_MARGIN_MS = 5 * 60_000;
// Envios por execução do alarme (limite de subrequisições do Worker); o resto vai na execução seguinte.
const SENDS_PER_RUN = 40;
// Mensagem de gol guardada pelo serviço de push por até 10 min (aparelho sem sinal); depois, perdeu a graça.
const GOAL_TTL_S = 600;
const MAX_SUBSCRIPTIONS = 20_000;
// Falhas seguidas (fora 404/410, que apagam na hora) até desistir de uma inscrição.
const MAX_FAILURES = 10;
// Só serviços de push conhecidos (Chrome/Android, Firefox, Safari/iPhone, Edge): o Worker não manda
// requisições para qualquer endereço.
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)$/;

interface PushTeam {
  id: number;
  name: string;
  logo: string;
}

interface PushFixture {
  fixture: { id: number; timestamp: number; status: { short: string; elapsed: number | null; extra?: number | null } };
  teams: { home: PushTeam; away: PushTeam };
  goals: { home: number | null; away: number | null };
  events?: GoalEvent[];
}

/** Conteúdo da notificação (o service worker do site mostra como veio). Mesmo texto dos avisos do site. */
function alertPayload(f: PushFixture, a: GoalAlert) {
  const names = { home: teamName(f.teams.home), away: teamName(f.teams.away), team: teamName(a.event.team) };
  return {
    ...notificationText(a, names, f.goals),
    icon: a.event.team.logo,
    // Mesma `tag` do aviso do site: um substitui o outro em vez de aparecerem dois.
    tag: a.id,
    // Relativo ao site (o service worker completa): clicar abre a partida.
    path: `partida/${f.fixture.id}`,
    // Som do site, se ele estiver aberto (sino no gol, bloop no anulado).
    sound: a.type,
  };
}

interface SubscriptionInput {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

/** Inscrição recebida do site, conferida; `null` se inválida ou de um serviço de push desconhecido. */
function validSubscription(input: SubscriptionInput | null): PushTarget | null {
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
    });
  }

  /** Inscreve (ou atualiza) um navegador. Na primeira vez, manda uma notificação de confirmação. */
  async subscribe(input: SubscriptionInput | null): Promise<{ ok: boolean; error?: string }> {
    const sub = validSubscription(input);
    if (!sub) return { ok: false, error: 'Inscrição inválida' };
    const sql = this.ctx.storage.sql;
    const current = sql.exec<{ p256dh: string; auth: string }>('SELECT p256dh, auth FROM subs WHERE endpoint = ?', sub.endpoint).toArray()[0];
    // Já inscrito com as mesmas chaves (o site confirma de tempos em tempos): nada a gravar nem acordar.
    if (current?.p256dh === sub.p256dh && current.auth === sub.auth) return { ok: true };
    const exists = !!current;
    if (!exists && this.countSubscriptions() >= MAX_SUBSCRIPTIONS) return { ok: false, error: 'Limite de inscrições atingido' };
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

  /** Chamado pelo cron: religa o alarme se ele parou por algum motivo e há inscritos. */
  async wake() {
    if (this.hasSubscriptions() && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  status() {
    const outbox = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM outbox').one().n;
    const watching = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM watch').one().n;
    return { subscriptions: this.countSubscriptions(), outbox, watching };
  }

  async alarm() {
    const now = Date.now();
    if (!this.hasSubscriptions()) {
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
    // Sobrou fila: o próximo lote sai já.
    await this.ctx.storage.setAlarm(more ? Date.now() : next);
  }

  private hasSubscriptions(): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 FROM subs LIMIT 1').toArray().length > 0;
  }

  private countSubscriptions(): number {
    return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM subs').one().n;
  }

  // `get` (e não `serve`): o push não usa o relógio estimado que `serve` acrescenta à resposta.
  private async fixtures(key: string): Promise<PushFixture[]> {
    const result = await this.env.API_CACHE.getByName('global').get(key);
    if ('error' in result) throw new Error(result.error);
    return (JSON.parse(result.body) as { response?: PushFixture[] }).response ?? [];
  }

  /** Uma verificação dos jogos do dia; devolve em quanto tempo verificar de novo. */
  private async check(now: number): Promise<number> {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM watch WHERE updated < ?', now - 24 * 3600_000);
    const today = await this.fixtures(
      keyFor('fixtures', { date: dayInBrasilia(now), league: '71', season: this.env.SEASON, timezone: TZ }),
    );
    const watch = today.filter(
      (f) => LIVE_STATUSES.has(f.fixture.status.short) || (f.fixture.status.short === 'NS' && f.fixture.timestamp * 1000 - now < KICKOFF_MARGIN_MS),
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
    for (let i = 0; i < ids.length; i += 20) detailed.push(...(await this.fixtures(keyFor('fixtures', { ids: ids.slice(i, i + 20).join('-') }))));

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
        'SELECT o.id, o.payload, o.ttl, o.created, s.endpoint, s.p256dh, s.auth FROM outbox o JOIN subs s ON s.endpoint = o.endpoint ORDER BY o.id LIMIT ?',
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
    return sql.exec('SELECT 1 FROM outbox LIMIT 1').toArray().length > 0;
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
