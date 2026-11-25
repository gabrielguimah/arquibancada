import { DurableObject } from 'cloudflare:workers';
import { GoalPush } from './goal-push';

export { GoalPush };

const UPSTREAM = 'https://v3.football.api-sports.io';
const BRASILEIRAO = '71';

// Status de jogo em andamento na API-Football.
// Intervalo mínimo entre chamadas à API: ela recusa rajadas, mesmo abaixo do limite por minuto. Com 500 ms
// (no máximo 120 por minuto, abaixo dos 300 do plano), a página inicial com cache frio não espera 1 s por
// chamada.
const MIN_GAP_MS = 500;
// Respostas com cache a partir disto podem ser servidas vencidas enquanto atualizam (ver `get`).
const STALE_MIN_TTL = 60;

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

// Tabela de jogadores (grade da página de estatísticas): números de cada jogador na temporada,
// montados a partir das mesmas páginas de `players` do ranking de notas.
const PLAYER_STATS_PATH = 'players/stats';
const PLAYER_STATS_VERSION = 1;

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
const ROUND_TEAM_VERSION = 2;
// Só entra quem jogou ao menos isto na partida (evita quem entrou no fim com nota alta).
const ROUND_TEAM_MIN_MINUTES = 45;
const ROUND_TEAM_FORMATION: Record<string, number> = { G: 1, D: 4, M: 3, F: 3 };

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

// Relógio dos jogos ao vivo. A API só informa o minuto, e ele não vira a cada 60 s certinhos (num
// mesmo jogo, minutos de 33 s e de 71 s). O Worker, que vê os dados assim que saem da API, marca cada
// virada de minuto no meio entre a última busca com o minuto anterior e a primeira com o novo, e daí
// tira quando o período teria começado. A estimativa é a mediana das últimas viradas: as irregulares
// da API se compensam, sem o relógio ir se adiantando aos poucos. Vai para o site em
// `fixture.status.clockStart`, para quem abre a página no meio do minuto já ver o relógio acertado.
const CLOCK_RUNNING = new Set(['1H', '2H', 'ET']);
const CLOCK_RUNNING_RE = /"short":\s*"(1H|2H|ET)"/;
// Estimativas de jogos que já acabaram são apagadas depois disso.
const CLOCK_MAX_AGE_MS = 6 * 3600_000;
// Virada vista com buscas mais espaçadas que isso é imprecisa demais para entrar na mediana.
const CLOCK_MAX_GAP_MS = 40_000;
// Quantas viradas recentes entram na mediana.
const CLOCK_SAMPLES = 20;

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
  injuries: injuriesTtl,
  // Técnicos de um time (com a carreira): muda raramente.
  coachs: 24 * 3600,
};

interface ApiBody {
  errors?: unknown[] | Record<string, string>;
  paging?: { current: number; total: number };
  response?: Array<{
    fixture?: {
      id?: number;
      timestamp?: number;
      status?: { short?: string; elapsed?: number | null; extra?: number | null; clockStart?: number };
    };
  }>;
}

interface ClockAnchor {
  period: string;
  /** Maior minuto já visto neste período (com acréscimo somado). */
  minute: number;
  /** Última busca à API em que o jogo ainda estava nesse minuto. */
  lastAt: number;
  /** Início do período estimado por cada virada de minuto recente. */
  samples: number[];
  /** Instante (ms) em que o relógio do período marcaria 00:00: a mediana das amostras. */
  start: number;
}

/** Junta o minuto `minute`, visto na busca feita em `at`, à estimativa do relógio. */
function observeClock(anchor: ClockAnchor | undefined, period: string, minute: number, at: number): ClockAnchor {
  // Primeira vez no período: só se sabe que o minuto já começou; fica no início dele até a primeira virada.
  if (!anchor || anchor.period !== period) {
    return { period, minute, lastAt: at, samples: [], start: at - (minute - 1) * 60_000 };
  }
  // Dado mais velho que o já visto (outra lista da API, ainda sem a virada): ignora.
  if (minute < anchor.minute) return anchor;
  if (minute === anchor.minute) return { ...anchor, lastAt: at };

  // Virou o minuto entre `lastAt` e `at`. Só entra na mediana se as buscas foram próximas e virou um só.
  if (minute !== anchor.minute + 1 || at - anchor.lastAt > CLOCK_MAX_GAP_MS) {
    return { ...anchor, minute, lastAt: at };
  }
  const turn = (anchor.lastAt + at) / 2;
  const samples = [...anchor.samples, Math.round(turn - (minute - 1) * 60_000)].slice(-CLOCK_SAMPLES);
  return { period, minute, lastAt: at, samples, start: median(samples) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Período do relógio; a prorrogação tem um intervalo curto no meio sem mudar o status. */
function clockPeriod(short: string, elapsed: number): string {
  if (short !== 'ET') return short;
  return elapsed > 105 ? 'ET2' : 'ET1';
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
        goals?: { total: number | null; assists: number | null };
        cards?: { yellow: number | null; red: number | null };
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
    games: { appearences: number | null; minutes: number | null; rating: string | null; position?: string | null };
    goals: { total: number | null; assists: number | null; conceded?: number | null; saves?: number | null };
    shots?: { total: number | null; on: number | null };
    passes?: { total: number | null; key: number | null; accuracy: number | null };
    tackles?: { total: number | null; blocks: number | null; interceptions: number | null };
    duels?: { total: number | null; won: number | null };
    dribbles?: { attempts: number | null; success: number | null };
    fouls?: { drawn: number | null; committed: number | null };
    cards?: { yellow: number | null; yellowred: number | null; red: number | null };
    penalty?: { won: number | null; commited: number | null; scored: number | null; missed: number | null; saved: number | null };
  }>;
}

/** Linha da tabela de jogadores: soma dos clubes do jogador no campeonato. */
interface PlayerStatsRow {
  id: number;
  name: string;
  photo: string;
  /** Clube onde o jogador mais jogou no campeonato. */
  team: TeamRef;
  /** G (goleiro), D, M ou F (atacante). */
  position: string | null;
  appearances: number;
  minutes: number;
  /** Média das notas, com peso pelos minutos; `null` sem nota. */
  rating: number | null;
  goals: number;
  assists: number;
  shots: number;
  shotsOn: number;
  passes: number;
  keyPasses: number;
  /** Acerto no passe (%), com peso pelos passes de cada clube; `null` sem passes. */
  passAccuracy: number | null;
  tackles: number;
  interceptions: number;
  blocks: number;
  duels: number;
  duelsWon: number;
  dribbles: number;
  dribblesWon: number;
  foulsDrawn: number;
  foulsCommitted: number;
  yellowCards: number;
  redCards: number;
  penaltiesScored: number;
  penaltiesMissed: number;
  penaltiesWon: number;
  penaltiesCommitted: number;
  saves: number;
  goalsConceded: number;
  penaltiesSaved: number;
}

const POSITIONS: Record<string, string> = { Goalkeeper: 'G', Defender: 'D', Midfielder: 'M', Attacker: 'F' };

/** Junta as linhas do jogador no Brasileirão (uma por clube) numa só. */
function playerStatsRow(item: PlayerSeason, stats: PlayerSeason['statistics']): PlayerStatsRow {
  const sum = (pick: (s: PlayerSeason['statistics'][number]) => number | null | undefined) =>
    stats.reduce((total, s) => total + (pick(s) ?? 0), 0);
  const main = [...stats].sort((a, b) => (b.games.minutes ?? 0) - (a.games.minutes ?? 0))[0];

  const rated = stats.filter((s) => s.games.rating && s.games.minutes);
  const ratedMinutes = rated.reduce((t, s) => t + (s.games.minutes ?? 0), 0);
  const passes = sum((s) => s.passes?.total);
  const withAccuracy = stats.filter((s) => s.passes?.total && s.passes.accuracy != null);
  const accuracyPasses = withAccuracy.reduce((t, s) => t + (s.passes?.total ?? 0), 0);

  return {
    id: item.player.id,
    name: item.player.name,
    photo: item.player.photo,
    team: { id: main.team.id, name: main.team.name, logo: main.team.logo },
    position: POSITIONS[main.games.position ?? ''] ?? null,
    appearances: sum((s) => s.games.appearences),
    minutes: sum((s) => s.games.minutes),
    rating: ratedMinutes
      ? round2(rated.reduce((t, s) => t + Number(s.games.rating) * (s.games.minutes ?? 0), 0) / ratedMinutes)
      : null,
    goals: sum((s) => s.goals.total),
    assists: sum((s) => s.goals.assists),
    shots: sum((s) => s.shots?.total),
    shotsOn: sum((s) => s.shots?.on),
    passes,
    keyPasses: sum((s) => s.passes?.key),
    passAccuracy: accuracyPasses
      ? Math.round(withAccuracy.reduce((t, s) => t + (s.passes?.accuracy ?? 0) * (s.passes?.total ?? 0), 0) / accuracyPasses)
      : null,
    tackles: sum((s) => s.tackles?.total),
    interceptions: sum((s) => s.tackles?.interceptions),
    blocks: sum((s) => s.tackles?.blocks),
    duels: sum((s) => s.duels?.total),
    duelsWon: sum((s) => s.duels?.won),
    dribbles: sum((s) => s.dribbles?.attempts),
    dribblesWon: sum((s) => s.dribbles?.success),
    foulsDrawn: sum((s) => s.fouls?.drawn),
    foulsCommitted: sum((s) => s.fouls?.committed),
    yellowCards: sum((s) => s.cards?.yellow),
    redCards: sum((s) => (s.cards?.red ?? 0) + (s.cards?.yellowred ?? 0)),
    penaltiesScored: sum((s) => s.penalty?.scored),
    penaltiesMissed: sum((s) => s.penalty?.missed),
    penaltiesWon: sum((s) => s.penalty?.won),
    penaltiesCommitted: sum((s) => s.penalty?.commited),
    saves: sum((s) => s.goals.saves),
    goalsConceded: sum((s) => s.goals.conceded),
    penaltiesSaved: sum((s) => s.penalty?.saved),
  };
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
  // Último jogo de um time (técnico atual): só muda quando o time joga de novo.
  if (/[?&]last=/.test(key) && fixtures.length && settled) return 6 * 3600;
  const now = Date.now() / 1000;
  const live = fixtures.some((f) => LIVE_STATUSES.has(f.fixture?.status?.short ?? ''));
  const startsWithin = (seconds: number) =>
    fixtures.some((f) => {
      const t = f.fixture?.timestamp ?? 0;
      return f.fixture?.status?.short === 'NS' && t - now < seconds && t - now > -3600;
    });
  // Busca por id é a fonte dos jogos ao vivo do site (placar, relógio, gols): 15 s com jogo rolando
  // ou começando em até 10 min, para pegar o apito inicial na hora.
  if (byId && (live || startsWithin(10 * 60))) return 15;
  // Listas (rodada, dia): só dizem quais jogos existem e o horário; o ao vivo vem da busca por id.
  if (live || startsWithin(2 * 3600)) return 60;
  return 600;
}

/**
 * Desfalques (lesionados e suspensos) de uma partida: a lista muda até perto do jogo, então 30 min;
 * de jogo já passado (mais de 3 h do início), não muda mais.
 */
function injuriesTtl(body: ApiBody): number {
  const items = body.response ?? [];
  const past = items.length > 0 && items.every((i) => Date.now() / 1000 - (i.fixture?.timestamp ?? 0) > 3 * 3600);
  return past ? 7 * 24 * 3600 : 1800;
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

interface RoundCandidate {
  player: { id: number; name: string; photo: string };
  team: TeamRef;
  rating: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  result: 'W' | 'D' | 'L';
}

const RESULT_ORDER = { W: 2, D: 1, L: 0 };

/**
 * Ordem do time da rodada (e do melhor da rodada, no site): nota (duas casas), gols + assistências,
 * resultado do time, menos minutos (mesma nota em menos tempo) e menos cartões.
 */
function compareRoundPlayers(a: RoundCandidate, b: RoundCandidate): number {
  return (
    b.rating - a.rating ||
    b.goals + b.assists - (a.goals + a.assists) ||
    RESULT_ORDER[b.result] - RESULT_ORDER[a.result] ||
    a.minutes - b.minutes ||
    a.yellowCards + a.redCards * 2 - (b.yellowCards + b.redCards * 2)
  );
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

function playerStatsKey(season: string): string {
  return `${PLAYER_STATS_PATH}?league=${BRASILEIRAO}&season=${season}&v=${PLAYER_STATS_VERSION}`;
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
        DROP TABLE IF EXISTS clock;
        CREATE TABLE IF NOT EXISTS live_clock (fixture INTEGER PRIMARY KEY, anchor TEXT NOT NULL, start INTEGER NOT NULL);
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
    // Vencida há pouco (até mais um TTL): responde na hora com a cópia e atualiza em segundo plano, para
    // ninguém esperar a fila da API. A próxima busca (o site atualiza sozinho) já pega a nova. Não vale
    // para o ao vivo (TTL curto): placar e gols atrasariam mais um ciclo.
    if (entry && entry.ttl >= STALE_MIN_TTL && age < entry.ttl * 2) {
      pending.catch(() => undefined);
      return { body: entry.body, status: 'STALE', age, ttl: entry.ttl };
    }
    return pending;
  }

  /** O que o site recebe: a resposta em cache e, nos jogos com bola rolando, o início estimado do relógio. */
  async serve(key: string): Promise<CacheResult | CacheError> {
    const result = await this.get(key);
    if ('error' in result || !key.startsWith('fixtures?') || !CLOCK_RUNNING_RE.test(result.body)) return result;
    const body: ApiBody = JSON.parse(result.body);
    for (const { fixture: f } of body.response ?? []) {
      const short = f?.status?.short ?? '';
      if (!f?.id || !f.status || !CLOCK_RUNNING.has(short) || f.status.elapsed == null) continue;
      const anchor = this.clockAnchor(f.id);
      // A resposta em cache pode ser de antes de o período mudar: só vale a estimativa do mesmo período.
      if (anchor?.period === clockPeriod(short, f.status.elapsed)) f.status.clockStart = anchor.start;
    }
    return { ...result, body: JSON.stringify(body) };
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
    if (key.startsWith('fixtures?')) this.observeClocks(body, Date.now());
    return { body: text, status: 'MISS', age: 0, ttl };
  }

  /** Anota o minuto de cada jogo com bola rolando, recém-chegado da API, na estimativa do relógio. */
  private observeClocks(body: ApiBody, at: number) {
    for (const { fixture: f } of body.response ?? []) {
      const short = f?.status?.short ?? '';
      const elapsed = f?.status?.elapsed;
      if (!f?.id || !CLOCK_RUNNING.has(short) || elapsed == null) continue;
      const anchor = this.clockAnchor(f.id);
      const next = observeClock(anchor, clockPeriod(short, elapsed), elapsed + (f.status?.extra ?? 0), at);
      if (next === anchor) continue;
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO live_clock (fixture, anchor, start) VALUES (?, ?, ?)',
        f.id,
        JSON.stringify(next),
        next.start,
      );
    }
    this.ctx.storage.sql.exec('DELETE FROM live_clock WHERE start < ?', at - CLOCK_MAX_AGE_MS);
  }

  private clockAnchor(fixture: number): ClockAnchor | undefined {
    const row = this.ctx.storage.sql
      .exec<{ anchor: string }>('SELECT anchor FROM live_clock WHERE fixture = ?', fixture)
      .toArray()[0];
    return row ? (JSON.parse(row.anchor) as ClockAnchor) : undefined;
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

  /** Tabela de jogadores da temporada. Como o ranking de notas: devolve a última montada e, se velha, agenda outra. */
  async playerStats(): Promise<CacheResult | CacheError> {
    const entry = this.read(playerStatsKey(this.env.SEASON));
    const age = entry ? Math.floor((Date.now() - entry.fetchedAt) / 1000) : 0;
    const fresh = !!entry && age < entry.ttl;
    if (!fresh) await this.startCrawl();
    if (entry) return { body: entry.body, status: fresh ? 'HIT' : 'STALE', age, ttl: entry.ttl };
    // Primeira vez: as páginas de `players` podem já estar todas no cache (ranking de notas); aí monta na hora.
    const pages = this.cachedPlayerPages();
    if (pages) {
      this.buildPlayerStats(pages, await this.leagueTeamIds());
      const built = this.read(playerStatsKey(this.env.SEASON));
      if (built) return { body: built.body, status: 'MISS', age: 0, ttl: built.ttl };
    }
    return { httpStatus: 503, error: 'Tabela de jogadores sendo montada, tente em alguns minutos' };
  }

  /** Total de páginas de `players`, se todas estão no cache; `null` se falta alguma. */
  private cachedPlayerPages(): number | null {
    const first = this.read(playersPageKey(this.env.SEASON, 1));
    if (!first) return null;
    const total = (JSON.parse(first.body) as ApiBody).paging?.total ?? 1;
    for (let page = 2; page <= total; page++) if (!this.read(playersPageKey(this.env.SEASON, page))) return null;
    return total;
  }

  /** Monta a tabela de jogadores: uma linha por jogador com jogos no Brasileirão, por clubes da Série A. */
  private buildPlayerStats(pages: number, teams: Set<number> | null) {
    const rows: PlayerStatsRow[] = [];
    for (let page = 1; page <= pages; page++) {
      const entry = this.read(playersPageKey(this.env.SEASON, page));
      if (!entry) continue;
      for (const item of (JSON.parse(entry.body) as { response: PlayerSeason[] }).response) {
        const stats = item.statistics.filter(
          (s) => String(s.league.id) === BRASILEIRAO && (s.games.appearences ?? 0) > 0 && (!teams || teams.has(s.team.id)),
        );
        if (stats.length) rows.push(playerStatsRow(item, stats));
      }
    }
    const maxApps = Math.max(0, ...rows.map((r) => r.appearances));
    const body = {
      updatedAt: new Date().toISOString(),
      // Mesmo critério de "Regulares" do ranking de notas.
      minAppearances: Math.ceil(maxApps * TOP_RATED_MIN_APPEARANCES),
      players: rows,
    };
    this.store(playerStatsKey(this.env.SEASON), JSON.stringify(body), TOP_RATED_TTL);
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
    this.buildPlayerStats(pages, teams);
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

    const candidates = new Map<string, RoundCandidate[]>();
    if (finished.length) {
      const details = await this.get(`fixtures?ids=${finished.map((f) => f.fixture.id).sort((a, b) => a - b).join('-')}`);
      if ('error' in details) return details;
      for (const f of (JSON.parse(details.body) as { response: FixtureDetail[] }).response) {
        for (const side of f.players ?? []) {
          const team = [f.teams.home, f.teams.away].find((t) => t.id === side.team.id);
          if (!team) continue;
          // Resultado do time no jogo, para o desempate.
          const home = f.teams.home.id === team.id;
          const [own, other] = home ? [f.goals.home ?? 0, f.goals.away ?? 0] : [f.goals.away ?? 0, f.goals.home ?? 0];
          const result = own > other ? 'W' : own < other ? 'L' : 'D';
          for (const p of side.players) {
            const st = p.statistics[0];
            const g = st?.games;
            if (!g?.rating || !g.position || (g.minutes ?? 0) < ROUND_TEAM_MIN_MINUTES) continue;
            const list = candidates.get(g.position) ?? [];
            list.push({
              player: { id: p.player.id, name: p.player.name, photo: p.player.photo },
              team: { id: team.id, name: team.name, logo: team.logo },
              rating: Number(g.rating),
              minutes: g.minutes ?? 0,
              goals: st.goals?.total ?? 0,
              assists: st.goals?.assists ?? 0,
              yellowCards: st.cards?.yellow ?? 0,
              redCards: st.cards?.red ?? 0,
              result,
            });
            candidates.set(g.position, list);
          }
        }
      }
    }

    const players = Object.entries(ROUND_TEAM_FORMATION).flatMap(([position, count]) =>
      (candidates.get(position) ?? [])
        .sort(compareRoundPlayers)
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

/**
 * Notificações de gol por push (`/push/...`): a chave pública do servidor (GET `/push/key`), inscrever
 * e cancelar (POST com a inscrição do navegador, em JSON). `null` se não for um desses caminhos.
 */
async function pushRoute(request: Request, env: Env, url: URL, cors: Record<string, string>): Promise<Response | null> {
  if (!url.pathname.startsWith('/push/')) return null;
  const stub = env.GOAL_PUSH.getByName('push');
  if (request.method === 'GET' && url.pathname === '/push/key') {
    return Response.json({ key: env.VAPID_PUBLIC_KEY }, { headers: { ...cors, 'cache-control': 'public, max-age=86400' } });
  }
  if (request.method === 'GET' && url.pathname === '/push/status') return Response.json(await stub.status(), { headers: cors });
  if (request.method !== 'POST') return new Response('Método não permitido', { status: 405, headers: cors });
  // Só do site: outras origens nem passariam do CORS no navegador.
  if (!cors['access-control-allow-origin']) return new Response('Origem não permitida', { status: 403 });
  const text = await request.text();
  if (text.length > 4096) return new Response('Corpo grande demais', { status: 413, headers: cors });
  let body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: 'JSON inválido' }, { status: 400, headers: cors });
  }
  if (url.pathname === '/push/subscribe') {
    const result = await stub.subscribe(body);
    return Response.json(result, { status: result.ok ? 200 : 400, headers: cors });
  }
  if (url.pathname === '/push/unsubscribe') return Response.json(await stub.unsubscribe(body?.endpoint), { headers: cors });
  if (url.pathname === '/push/test') {
    const at = await stub.testPush(body?.endpoint);
    return Response.json(at ? { ok: true, at } : { ok: false, error: 'Navegador não inscrito' }, { status: at ? 200 : 404, headers: cors });
  }
  return new Response('Não encontrado', { status: 404, headers: cors });
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
      });
    }
    const url = new URL(request.url);
    const push = await pushRoute(request, env, url, cors);
    if (push) return push;
    if (request.method !== 'GET') return new Response('Método não permitido', { status: 405, headers: cors });

    const stub = env.API_CACHE.getByName('global');

    if (url.pathname === '/status') return Response.json(await stub.status(), { headers: cors });

    try {
      const result =
        url.pathname === `/${TOP_RATED_PATH}`
          ? await stub.topRated()
          : url.pathname === `/${PLAYER_STATS_PATH}`
            ? await stub.playerStats()
            : url.pathname === `/${TEAM_RATINGS_PATH}`
              ? await stub.teamRatings()
              : url.pathname === `/${ROUND_TEAM_PATH}`
                ? await stub.roundTeam(roundParam(url))
                : await stub.serve(cacheKey(url));
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

  // Rede de segurança dos avisos de gol: o alarme do GoalPush se reagenda sozinho; o cron só o religa
  // se ele tiver parado.
  async scheduled(_controller, env) {
    await env.GOAL_PUSH.getByName('push').wake();
  },
} satisfies ExportedHandler<Env>;
