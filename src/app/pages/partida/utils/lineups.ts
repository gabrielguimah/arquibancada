import { Fixture, FixtureEvent, Lineup, LineupPlayer, Team } from '../../../api/api-football';
import { isLive } from '../../../shared/components/fixture-card/fixture-card';
import { PLAYER_PLACEHOLDER } from '../../../shared/directives/player-photo';
import { formatRating } from '../../../shared/utils/rating';
import { FINISHED } from '../../../shared/utils/fixture-status';

/** Jogador como aparece no campo ou na lista de reservas. */
export interface LineupSpot {
  /** `null` para jogador que a API não tem cadastrado. */
  id: number | null;
  /** Identifica o jogador na partida (ver `playerKey`); serve de `track` nas listas. */
  key: string;
  /** Nome com o primeiro nome abreviado ("Carlos Miguel" → "C. Miguel"). */
  name: string;
  number: number | null;
  photo: string;
  rating: number | null;
  /** Nota inicial (6,0) de quem está jogando e ainda não recebeu nota da API; não concorre a melhor. */
  provisional: boolean;
  /** Minutos jogados (desempate do melhor da partida). */
  minutes: number;
  captain: boolean;
  goals: number;
  ownGoals: number;
  assists: number;
  yellow: boolean;
  red: boolean;
  /** Minuto em que saiu (titular substituído). */
  subOut: string | null;
  /** Minuto em que entrou (reserva que jogou). */
  subIn: string | null;
  /** Melhor da partida (critérios em `compareBest`). */
  best: boolean;
}

export interface TeamLineup {
  team: Team;
  formation: string | null;
  /** Média das notas de quem jogou, com peso pelos minutos. */
  rating: number | null;
  /** Linhas do campo, do goleiro para o ataque; em cada linha, da esquerda para a direita do time. */
  lines: LineupSpot[][];
  substitutes: LineupSpot[];
  coach: { name: string; photo: string | null } | null;
}

// Nota de partida de quem acabou de entrar em campo, antes da primeira nota da API.
const INITIAL_RATING = 6;

const PHOTO = (id: number) => `https://media.api-sports.io/football/players/${id}.png`;

/**
 * Chave do jogador na partida: o id ou, quando a API não tem o jogador cadastrado (id `null` na escalação
 * e nos eventos, `0` nas estatísticas), o nome, que nesses casos vem igual nos três lugares.
 */
export function playerKey(p: { id: number | null; name: string | null }): string | null {
  if (p.id) return `id:${p.id}`;
  const name = p.name?.trim().toLowerCase();
  return name ? `name:${name}` : null;
}

/** As duas escalações (mandante e visitante), ou `null` se ainda não saíram. */
export function lineups(f: Fixture): { home: TeamLineup; away: TeamLineup } | null {
  const list = f.lineups ?? [];
  const home = list.find((l) => l.team.id === f.teams.home.id);
  const away = list.find((l) => l.team.id === f.teams.away.id);
  if (!home?.startXI.length || !away?.startXI.length) return null;
  const result = { home: teamLineup(f, home), away: teamLineup(f, away) };

  // Melhor da partida, só depois do apito final (com a bola rolando as notas ainda mudam), com os
  // critérios do melhor da rodada; expulso não concorre e, se empatar em tudo, todos os empatados ganham
  // a estrela.
  if (!FINISHED.has(f.fixture.status.short)) return result;
  const outcome = teamResults(f);
  const candidates = (['home', 'away'] as const)
    .flatMap((side) => [...result[side].lines.flat(), ...result[side].substitutes].map((spot) => ({ spot, result: outcome[side] })))
    .filter((c) => c.spot.rating !== null && !c.spot.provisional && !c.spot.red)
    .sort(compareBest);
  const first = candidates[0];
  if (first) candidates.filter((c) => compareBest(c, first) === 0).forEach((c) => (c.spot.best = true));
  return result;
}

type Outcome = 'W' | 'D' | 'L' | null;
const OUTCOME_ORDER = { W: 2, D: 1, L: 0 };

/** Resultado de cada time pelo placar (`null` sem placar). */
function teamResults(f: Fixture): { home: Outcome; away: Outcome } {
  const { home, away } = f.goals;
  if (home === null || away === null) return { home: null, away: null };
  return home > away ? { home: 'W', away: 'L' } : home < away ? { home: 'L', away: 'W' } : { home: 'D', away: 'D' };
}

/**
 * Ordem do melhor da partida, a mesma do melhor da rodada: nota (duas casas), gols + assistências,
 * resultado do time, menos minutos (mesma nota em menos tempo) e menos cartões.
 */
function compareBest(a: { spot: LineupSpot; result: Outcome }, b: { spot: LineupSpot; result: Outcome }): number {
  const contributions = (s: LineupSpot) => s.goals + s.assists;
  const result = (r: Outcome) => (r ? OUTCOME_ORDER[r] : 0);
  const cards = (s: LineupSpot) => Number(s.yellow) + Number(s.red) * 2;
  return (
    (b.spot.rating ?? 0) - (a.spot.rating ?? 0) ||
    contributions(b.spot) - contributions(a.spot) ||
    result(b.result) - result(a.result) ||
    a.spot.minutes - b.spot.minutes ||
    cards(a.spot) - cards(b.spot)
  );
}

function teamLineup(f: Fixture, l: Lineup): TeamLineup {
  const stats = new Map(
    (f.players?.find((p) => p.team.id === l.team.id)?.players ?? []).map((p) => [playerKey(p.player), p]),
  );
  const starters = new Set(l.startXI.map((s) => playerKey(s.player)));
  const events = (f.events ?? []).filter((e) => e.team.id === l.team.id);
  const subs = substitutions(events, starters);

  const live = isLive(f);
  const spot = (p: LineupPlayer, starter: boolean): LineupSpot => {
    const key = playerKey(p);
    const s = stats.get(key);
    const games = s?.statistics[0]?.games;
    // Nota só para quem jogou: a API às vezes manda nota para reserva que não entrou.
    const official = games?.rating && Number(games.rating) > 0 && (games.minutes ?? 0) > 0 ? Number(games.rating) : null;
    const subIn = (key && subs.in.get(key)) ?? null;
    // Com o jogo rolando, quem está ou esteve em campo começa com 6,0 até a API mandar a nota.
    const provisional = official === null && live && (starter || subIn !== null);
    const rating = provisional ? INITIAL_RATING : official;
    const mine = (e: FixtureEvent) => key !== null && playerKey(e.player) === key;
    return {
      id: p.id || null,
      key: key ?? `${l.team.id}:${p.number}`,
      name: shortName(p.name),
      number: p.number,
      photo: s?.player.photo || (p.id ? PHOTO(p.id) : PLAYER_PLACEHOLDER),
      rating,
      provisional,
      minutes: games?.minutes ?? 0,
      captain: !!games?.captain,
      goals: events.filter((e) => mine(e) && e.type === 'Goal' && (e.detail === 'Normal Goal' || e.detail === 'Penalty')).length,
      ownGoals: events.filter((e) => mine(e) && e.type === 'Goal' && e.detail === 'Own Goal').length,
      assists: events.filter((e) => e.type === 'Goal' && e.detail !== 'Missed Penalty' && key !== null && playerKey(e.assist) === key).length,
      yellow: events.some((e) => mine(e) && e.type === 'Card' && e.detail === 'Yellow Card'),
      red: events.some((e) => mine(e) && e.type === 'Card' && (e.detail === 'Red Card' || e.detail === 'Second Yellow card')),
      subOut: (key && subs.out.get(key)) ?? null,
      subIn,
      best: false,
    };
  };

  // Titulares por linha do `grid`; sem grid (dado incompleto), tudo numa linha só depois do goleiro.
  const rows = new Map<number, Array<{ col: number; spot: LineupSpot }>>();
  for (const { player } of l.startXI) {
    const [row, col] = (player.grid ?? '').split(':').map(Number);
    const r = Number.isFinite(row) && row > 0 ? row : player.pos === 'G' ? 1 : 2;
    rows.set(r, [...(rows.get(r) ?? []), { col: Number.isFinite(col) ? col : 99, spot: spot(player, true) }]);
  }
  const lines = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row.sort((a, b) => a.col - b.col).map((r) => r.spot));

  const played = [...stats.values()]
    .map((p) => p.statistics[0]?.games)
    .filter((g) => g?.rating && Number(g.rating) > 0 && (g.minutes ?? 0) > 0);
  const minutes = played.reduce((t, g) => t + (g!.minutes ?? 0), 0);

  return {
    team: l.team,
    formation: l.formation,
    rating: minutes ? played.reduce((t, g) => t + Number(g!.rating) * (g!.minutes ?? 0), 0) / minutes : null,
    lines,
    // Reservas: quem entrou primeiro (na ordem da entrada), depois os que não jogaram.
    substitutes: l.substitutes
      .map(({ player }) => spot(player, false))
      .sort((a, b) => order(a.subIn) - order(b.subIn)),
    coach: l.coach?.name ? { name: l.coach.name, photo: l.coach.photo } : null,
  };
}

/**
 * Substituições do time: quem saiu e quem entrou, com o minuto. Na API, `player` costuma ser quem sai e
 * `assist` quem entra, mas às vezes vem invertido: quem já estava em campo (titular ou quem entrou antes)
 * é o que sai.
 */
function substitutions(events: FixtureEvent[], starters: Set<string | null>) {
  const onPitch = new Set(starters);
  const out = new Map<string, string>();
  const into = new Map<string, string>();
  const sorted = events
    .filter((e) => e.type === 'subst')
    .sort((a, b) => (a.time.elapsed ?? 0) + (a.time.extra ?? 0) / 100 - ((b.time.elapsed ?? 0) + (b.time.extra ?? 0) / 100));
  for (const e of sorted) {
    let leaving = playerKey(e.player);
    let entering = playerKey(e.assist);
    if (leaving === null || entering === null) continue;
    if (!onPitch.has(leaving) && onPitch.has(entering)) [leaving, entering] = [entering, leaving];
    const minute = `${e.time.elapsed ?? ''}${e.time.extra ? `+${e.time.extra}` : ''}'`;
    out.set(leaving, minute);
    into.set(entering, minute);
    onPitch.delete(leaving);
    onPitch.add(entering);
  }
  return { out, in: into };
}

function order(minute: string | null): number {
  if (minute === null) return 1000;
  const [elapsed, extra] = minute.replace("'", '').split('+').map(Number);
  return elapsed + (extra || 0) / 100;
}

/**
 * Nome do jogador com o primeiro nome abreviado: "Carlos Miguel" → "C. Miguel", "Giorgian de Arrascaeta"
 * → "G. de Arrascaeta". Já abreviado ("N. Ferraresi") ou de uma palavra só ("Marçal") fica como está.
 */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || /\.$/.test(parts[0])) return name.trim();
  return `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}`;
}

/**
 * Posição de cada titular no campo, independente da orientação (o CSS converte):
 * - `x`: distância do próprio gol, de 0 (linha do gol) a 1 (meio-campo). O goleiro fica colado no gol
 *   e as outras linhas, espaçadas por igual até perto do meio-campo;
 * - `y`: posição na largura do campo, de 0 (esquerda do time) a 1 (direita do time). Os jogadores da
 *   linha ficam centrados, com o mesmo passo entre eles; linhas cheias (4 ou 5) vão de uma lateral à
 *   outra, e as curtas (2 ou 3) não se espalham demais.
 */
export function pitchPositions(lines: LineupSpot[][]): Array<Array<{ spot: LineupSpot; x: number; y: number }>> {
  const outfield = lines.length - 1;
  return lines.map((line, i) => {
    const x =
      i === 0
        ? GOALKEEPER_X
        : outfield === 1
          ? (FIRST_LINE_X + LAST_LINE_X) / 2
          : FIRST_LINE_X + ((LAST_LINE_X - FIRST_LINE_X) * (i - 1)) / (outfield - 1);
    const step = line.length > 1 ? Math.min(MAX_STEP_Y, (1 - 2 * WIDE_MARGIN) / (line.length - 1)) : 0;
    return line.map((spot, j) => ({ spot, x, y: 0.5 + (j - (line.length - 1) / 2) * step }));
  });
}

// Goleiro perto do gol; linhas de linha da entrada da área até perto do meio-campo (frações da metade).
const GOALKEEPER_X = 0.05;
const FIRST_LINE_X = 0.27;
const LAST_LINE_X = 0.9;
// Na largura: os das pontas a 10% da lateral; no máximo 30% entre vizinhos (linhas de 2 ou 3).
const WIDE_MARGIN = 0.1;
const MAX_STEP_Y = 0.3;

/** Resumo do jogador no tooltip: "9 T. Soares · Nota 7.5 · 1 gol · Saiu aos 70'". */
export function playerTip(p: LineupSpot): string {
  return [
    `${p.number ?? ''} ${p.name}`.trim() + (p.captain ? ' (capitão)' : ''),
    p.best ? 'Melhor da partida' : '',
    p.rating !== null ? `Nota ${formatRating(p.rating)}${p.provisional ? ' (inicial, até a primeira nota da API)' : ''}` : '',
    p.goals ? `${p.goals} ${p.goals > 1 ? 'gols' : 'gol'}` : '',
    p.ownGoals ? `${p.ownGoals} gol contra` : '',
    p.assists ? `${p.assists} ${p.assists > 1 ? 'assistências' : 'assistência'}` : '',
    p.red ? 'Expulso' : p.yellow ? 'Cartão amarelo' : '',
    p.subIn ? `Entrou aos ${p.subIn}` : '',
    p.subOut ? `Saiu aos ${p.subOut}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
