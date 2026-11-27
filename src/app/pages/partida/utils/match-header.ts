import { Fixture, FixtureEvent } from '../../../api/api-football';

/** Gols que contam (o pênalti perdido também vem como evento "Goal"). */
const SCORED = new Set(['Normal Goal', 'Penalty', 'Own Goal']);
const RED_CARDS = new Set(['Red Card', 'Second Yellow card']);

/** Lance de destaque do cabeçalho: gol, cartão vermelho ou pênalti perdido. */
export type HighlightKind = 'goal' | 'red' | 'missed';

export interface Highlight {
  kind: HighlightKind;
  name: string;
  /** Minutos, já com o tipo do gol: "81'", "45+2' (P)", "30' (GC)". */
  minutes: string[];
}

/**
 * Lances de cada lado (gols, cartões vermelhos e pênaltis perdidos), juntando os do mesmo jogador e
 * tipo ("Fulano 12', 70'"). Os gols vêm primeiro; cartões e pênaltis perdidos, sempre abaixo deles.
 * Dentro de cada grupo, na ordem do primeiro minuto. Gol contra vai para o lado do time que se
 * beneficiou: se contar pelo time do evento não bater com o placar e o inverso bater, os gols contra
 * trocam de lado. Cartão e pênalti perdido ficam no time do jogador.
 */
export function highlights(f: Fixture): { home: Highlight[]; away: Highlight[] } {
  const events = f.events ?? [];
  const byTeam = (e: FixtureEvent) => (e.team.id === f.teams.home.id ? 'home' : 'away');
  const goalSide = goalSideOf(f);

  const kindOf = (e: FixtureEvent): HighlightKind | null => {
    if (e.type === 'Goal' && SCORED.has(e.detail)) return 'goal';
    if (e.type === 'Goal' && e.detail === 'Missed Penalty') return 'missed';
    if (e.type === 'Card' && RED_CARDS.has(e.detail)) return 'red';
    return null;
  };

  const result = { home: [] as Highlight[], away: [] as Highlight[] };
  const sorted = [...events].sort((a, b) => minuteValue(a) - minuteValue(b));
  for (const e of sorted) {
    const kind = kindOf(e);
    if (!kind) continue;
    const list = result[kind === 'goal' ? goalSide(e) : byTeam(e)];
    const name = e.player.name ?? (kind === 'goal' ? 'Gol' : 'Jogador');
    const tag = e.detail === 'Penalty' ? ' (P)' : e.detail === 'Own Goal' ? ' (GC)' : '';
    const minute = `${e.time.elapsed ?? ''}${e.time.extra ? `+${e.time.extra}` : ''}'${tag}`;
    const existing = list.find((h) => h.name === name && h.kind === kind);
    if (existing) existing.minutes.push(minute);
    else list.push({ kind, name, minutes: [minute] });
  }
  // Gols em cima; o resto embaixo. A ordenação é estável: a ordem dos minutos se mantém em cada grupo.
  const goalsFirst = (a: Highlight, b: Highlight) => Number(a.kind !== 'goal') - Number(b.kind !== 'goal');
  result.home.sort(goalsFirst);
  result.away.sort(goalsFirst);
  return result;
}

/** Gol que conta no placar (não o pênalti perdido). */
export function isGoal(e: FixtureEvent): boolean {
  return e.type === 'Goal' && SCORED.has(e.detail);
}

/**
 * Lado que cada gol soma no placar. Gol contra conta para o time que se beneficiou: se contar pelo time
 * do evento não bater com o placar e o inverso bater, os gols contra trocam de lado.
 */
export function goalSideOf(f: Fixture): (e: FixtureEvent) => 'home' | 'away' {
  const goals = (f.events ?? []).filter(isGoal);
  const byTeam = (e: FixtureEvent) => (e.team.id === f.teams.home.id ? 'home' : 'away');
  const ownFlipped = (e: FixtureEvent) =>
    e.detail === 'Own Goal' ? (byTeam(e) === 'home' ? 'away' : 'home') : byTeam(e);
  const count = (side: (e: FixtureEvent) => 'home' | 'away') => goals.filter((e) => side(e) === 'home').length;
  return count(byTeam) !== f.goals.home && count(ownFlipped) === f.goals.home ? ownFlipped : byTeam;
}

export function minuteValue(e: FixtureEvent): number {
  return (e.time.elapsed ?? 0) + (e.time.extra ?? 0) / 100;
}

/** Situação da partida abaixo do placar (o relógio, com bola rolando, é tratado à parte). */
export function statusLabel(f: Fixture): string {
  switch (f.fixture.status.short) {
    case 'NS':
    case 'TBD':
      return 'Não iniciado';
    case 'HT':
    case 'BT':
      return 'Intervalo';
    case 'FT':
      return 'Finalizado';
    case 'AET':
      return 'Finalizado na prorrogação';
    case 'PEN':
      return 'Finalizado nos pênaltis';
    case 'PST':
      return 'Adiado';
    case 'CANC':
      return 'Cancelado';
    case 'ABD':
      return 'Abandonado';
    case 'SUSP':
    case 'INT':
      return 'Interrompido';
    case 'P':
      return 'Pênaltis';
    case 'AWD':
    case 'WO':
      return 'W.O.';
    default:
      return 'Ao vivo';
  }
}
