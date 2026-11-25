import { Fixture, FixtureEvent } from '../../api/api-football';
import { shortName } from './lineups';
import { goalSideOf, isGoal, minuteValue } from './match-header';
import { FINISHED, PROGRESS } from '../../shared/fixture-status';

export type TimelineKind = 'goal' | 'missed-penalty' | 'yellow' | 'red' | 'second-yellow' | 'sub' | 'var';

export interface TimelineEvent {
  type: 'event';
  side: 'home' | 'away';
  minute: string;
  kind: TimelineKind;
  /** Em destaque: autor do gol, jogador do cartão, quem entrou… */
  main: string;
  /** Em cinza: assistência, motivo do cartão, quem saiu, decisão do VAR… */
  secondary: string | null;
  /** Só nos gols: o placar depois dele ("1 - 1"). */
  score?: string;
  /** Só nos gols: `secondary` é quem deu a assistência (mostra o ícone da chuteira). */
  assist?: boolean;
}

/** Separador entre as etapas, com o placar ao fim dela ("Intervalo 0 - 1"). */
export interface TimelineDivider {
  type: 'divider';
  label: string;
  score: string;
}

/** Aviso de etapa encerrada sem nenhum lance ("Nenhum lance marcante no 1º tempo"). */
export interface TimelineNote {
  type: 'note';
  text: string;
}

export type TimelineItem = TimelineEvent | TimelineDivider | TimelineNote;

// Teve prorrogação (em andamento ou encerrada).
const EXTRA_TIME = new Set(['ET', 'BT', 'P', 'AET', 'PEN']);
const PERIOD_NAMES = ['', 'no 1º tempo', 'no 2º tempo', 'na prorrogação'];

// Motivos de cartão (campo `comments` da API).
const CARD_REASONS: Record<string, string> = {
  foul: 'Falta',
  'serious foul': 'Falta grave',
  'professional foul': 'Falta tática',
  'professional foul last man': 'Falta no último homem',
  'time wasting': 'Perda de tempo',
  'violent conduct': 'Conduta violenta',
  'unsportsmanlike conduct': 'Conduta antidesportiva',
  argument: 'Reclamação',
  dissent: 'Reclamação',
  handball: 'Mão na bola',
  simulation: 'Simulação',
  roughing: 'Jogo brusco',
  holding: 'Segurar o adversário',
  tripping: 'Rasteira',
  pushing: 'Empurrão',
  elbowing: 'Cotovelada',
  'off the ball foul': 'Falta sem bola',
  'entering field': 'Entrada no campo sem autorização',
  'leaving field': 'Saída do campo sem autorização',
};

// Decisões do VAR (campo `detail`).
const VAR_DECISIONS: Record<string, string> = {
  'goal cancelled': 'Gol anulado',
  'goal disallowed - offside': 'Gol anulado: impedimento',
  'goal disallowed - handball': 'Gol anulado: mão na bola',
  'goal disallowed - foul': 'Gol anulado: falta',
  'goal confirmed': 'Gol confirmado',
  'penalty confirmed': 'Pênalti confirmado',
  'penalty cancelled': 'Pênalti cancelado',
  'card upgrade confirmed': 'Cartão modificado',
  'card upgrade': 'Cartão modificado',
  'red card cancelled': 'Vermelho cancelado',
  'card reviewed': 'Cartão revisado',
};

/**
 * Lance a lance da partida, em ordem cronológica (o primeiro lance em cima): gols (com o placar depois de cada um),
 * pênaltis perdidos, cartões (com o motivo), substituições e decisões do VAR, separados por
 * "Intervalo", "Fim do tempo normal" e "Fim de jogo". Nomes saem da escalação quando dá ("D. Santos"),
 * que são mais curtos que os dos eventos ("Danilo dos Santos de Oliveira"), com o primeiro nome abreviado.
 */
export function timeline(f: Fixture): TimelineItem[] {
  const events = [...(f.events ?? [])]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => minuteValue(a.e) - minuteValue(b.e) || a.i - b.i)
    .map(({ e }) => e);
  const names = lineupNames(f);
  // Nome da escalação (mais curto) ou do evento, sempre com o primeiro nome abreviado ("C. Miguel").
  const name = (p: { id: number | null; name: string | null }) => shortName((p.id !== null && names.get(p.id)) || p.name || '');
  const goalSide = goalSideOf(f);
  const onPitch = new Set((f.lineups ?? []).flatMap((l) => l.startXI.map((s) => s.player.id)));

  let home = 0;
  let away = 0;
  const items: Array<TimelineEvent & { period: number }> = [];
  for (const e of events) {
    const side = e.team.id === f.teams.home.id ? 'home' : 'away';
    const base = { type: 'event' as const, side: side as 'home' | 'away', minute: minuteText(e), period: period(e) };

    if (isGoal(e)) {
      const scoredFor = goalSide(e);
      if (scoredFor === 'home') home++;
      else away++;
      const note = e.detail === 'Penalty' ? 'Pênalti' : e.detail === 'Own Goal' ? 'Gol contra' : null;
      items.push({
        ...base,
        side: scoredFor,
        kind: 'goal',
        main: name(e.player),
        secondary: note ?? (e.assist.name ? name(e.assist) : null),
        score: `${home} - ${away}`,
        assist: !note && !!e.assist.name,
      });
    } else if (e.type === 'Goal' && e.detail === 'Missed Penalty') {
      items.push({ ...base, kind: 'missed-penalty', main: name(e.player), secondary: 'Pênalti perdido' });
    } else if (e.type === 'Card') {
      const kind = e.detail === 'Red Card' ? 'red' : e.detail === 'Second Yellow card' ? 'second-yellow' : 'yellow';
      items.push({ ...base, kind, main: name(e.player), secondary: cardReason(e) });
    } else if (e.type === 'subst') {
      // `player` costuma ser quem sai e `assist` quem entra; se vier invertido, quem estava em campo é quem sai.
      let leaving = e.player;
      let entering = e.assist;
      if (leaving.id !== null && entering.id !== null && !onPitch.has(leaving.id) && onPitch.has(entering.id)) {
        [leaving, entering] = [entering, leaving];
      }
      if (leaving.id !== null) onPitch.delete(leaving.id);
      if (entering.id !== null) onPitch.add(entering.id);
      items.push({ ...base, kind: 'sub', main: name(entering), secondary: name(leaving) || null });
    } else if (e.type === 'Var') {
      // Como nos outros lances: jogador em destaque e a decisão em cinza. Sem jogador, só a decisão.
      const decision = VAR_DECISIONS[e.detail.toLowerCase()] ?? e.detail;
      const player = name(e.player);
      items.push({ ...base, kind: 'var', main: player || decision, secondary: player ? decision : null });
    }
  }

  // Do primeiro lance ao último, com os separadores ao fim de cada etapa.
  const result: TimelineItem[] = [];
  const short = f.fixture.status.short;
  const score = (s?: { home: number | null; away: number | null }) =>
    s && s.home !== null && s.away !== null ? `${s.home} - ${s.away}` : null;
  // Etapa encerrada sem nenhum lance ganha um aviso (a que está em andamento, não: lá ficam os três
  // pontinhos do lance a lance).
  // Etapas encerradas, pela ordem das situações: 1º tempo a partir do intervalo, 2º a partir do intervalo
  // da prorrogação (ou do fim), prorrogação a partir dos pênaltis.
  const progress = PROGRESS[short] ?? 0;
  const closed = [false, progress >= PROGRESS['HT'], progress >= PROGRESS['BT'], EXTRA_TIME.has(short) && progress >= PROGRESS['P']];
  for (const p of [1, 2, 3]) {
    const ofPeriod = items.filter((i) => i.period === p);
    result.push(...ofPeriod.map(({ period: _, ...item }) => item));
    if (!ofPeriod.length && closed[p]) {
      result.push({ type: 'note', text: `Nenhum lance marcante ${PERIOD_NAMES[p]}` });
    }
    if (p === 1 && closed[1]) {
      result.push({ type: 'divider', label: 'Intervalo', score: score(f.score?.halftime) ?? scoreUntil(items, 1) });
    }
    if (p === 2 && (items.some((i) => i.period === 3) || EXTRA_TIME.has(short))) {
      result.push({ type: 'divider', label: 'Fim do tempo normal', score: score(f.score?.fulltime) ?? scoreUntil(items, 2) });
    }
  }
  if (FINISHED.has(short)) {
    result.push({ type: 'divider', label: 'Fim de jogo', score: `${f.goals.home ?? 0} - ${f.goals.away ?? 0}` });
  }
  return result;
}

/**
 * 1: primeiro tempo; 2: segundo; 3: prorrogação. Acréscimos contam no tempo em que aconteceram.
 * Substituição no minuto 45 (sem acréscimo) é a do intervalo: vale para o 2º tempo.
 */
function period(e: FixtureEvent): number {
  const m = e.time.elapsed ?? 0;
  if (e.type === 'subst' && m === 45 && !e.time.extra) return 2;
  return m <= 45 ? 1 : m <= 90 ? 2 : 3;
}

/** Placar ao fim da etapa, pelos gols do lance a lance (quando a API não manda o placar da etapa). */
function scoreUntil(items: Array<TimelineEvent & { period: number }>, last: number): string {
  const goals = items.filter((i) => i.kind === 'goal' && i.period <= last);
  return goals.at(-1)?.score ?? '0 - 0';
}

function minuteText(e: FixtureEvent): string {
  return `${e.time.elapsed ?? ''}${e.time.extra ? `+${e.time.extra}` : ''}'`;
}

function cardReason(e: FixtureEvent): string | null {
  const c = e.comments?.trim();
  if (!c) return null;
  return CARD_REASONS[c.toLowerCase()] ?? c;
}

/** Nomes curtos da escalação (titulares e reservas), pelo id do jogador. */
function lineupNames(f: Fixture): Map<number, string> {
  const names = new Map<number, string>();
  for (const l of f.lineups ?? []) {
    for (const { player } of [...l.startXI, ...l.substitutes]) if (player.id) names.set(player.id, player.name);
  }
  return names;
}
