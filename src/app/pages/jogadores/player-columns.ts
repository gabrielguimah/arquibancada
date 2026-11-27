import { PlayerRow } from '../../api/api-football';
import { formatNumber, formatPercent } from '../../shared/number-format';
import { formatRating } from '../../shared/rating';

/** Como o número é mostrado e se muda com "Por jogo" / "Por 90 minutos". */
export type ColumnKind =
  /** Contagem (gols, desarmes…): divide por jogo ou por 90 minutos. */
  | 'count'
  /** Porcentagem ou total que não se divide (jogos, minutos). */
  | 'fixed'
  | 'percent'
  | 'rating';

export interface PlayerColumn {
  id: string;
  /** Cabeçalho (curto). */
  label: string;
  /** Explicação no tooltip do cabeçalho. */
  title: string;
  kind: ColumnKind;
  value: (p: PlayerRow) => number | null;
  /** Menor é melhor (ex.: gols sofridos): a primeira ordenação é crescente. */
  ascending?: boolean;
}

export interface PlayerTab {
  id: string;
  label: string;
  columns: PlayerColumn[];
  /** Coluna da ordenação inicial. */
  sort: string;
  /** Só goleiros. */
  goalkeepers?: boolean;
}

export type Accumulation = 'total' | 'game' | 'p90';

export const ACCUMULATIONS: Array<{ id: Accumulation; label: string }> = [
  { id: 'total', label: 'Total' },
  { id: 'game', label: 'Por jogo' },
  { id: 'p90', label: 'Por 90 minutos' },
];

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

const col = {
  apps: { id: 'apps', label: 'Jogos', title: 'Jogos disputados', kind: 'fixed', value: (p) => p.appearances },
  minutes: { id: 'minutes', label: 'Minutos', title: 'Minutos jogados', kind: 'fixed', value: (p) => p.minutes },
  goals: { id: 'goals', label: 'Gols', title: 'Gols marcados', kind: 'count', value: (p) => p.goals },
  assists: { id: 'assists', label: 'Assist.', title: 'Assistências', kind: 'count', value: (p) => p.assists },
  shots: { id: 'shots', label: 'Finaliz.', title: 'Finalizações', kind: 'count', value: (p) => p.shots },
  shotsOn: { id: 'shotsOn', label: 'No gol', title: 'Finalizações no gol', kind: 'count', value: (p) => p.shotsOn },
  conversion: {
    id: 'conversion',
    label: 'Conversão %',
    title: 'Gols a cada 100 finalizações',
    kind: 'percent',
    value: (p) => pct(p.goals, p.shots),
  },
  dribblesWon: { id: 'dribblesWon', label: 'Dribles', title: 'Dribles certos', kind: 'count', value: (p) => p.dribblesWon },
  penaltiesScored: {
    id: 'penaltiesScored',
    label: 'Pênaltis',
    title: 'Gols de pênalti',
    kind: 'count',
    value: (p) => p.penaltiesScored,
  },
  keyPasses: { id: 'keyPasses', label: 'Passes dec.', title: 'Passes decisivos (que viraram finalização)', kind: 'count', value: (p) => p.keyPasses },
  passes: { id: 'passes', label: 'Passes', title: 'Passes tentados', kind: 'count', value: (p) => p.passes },
  passAccuracy: {
    id: 'passAccuracy',
    label: 'Acerto %',
    title: 'Acerto no passe',
    kind: 'percent',
    value: (p) => p.passAccuracy,
  },
  tackles: { id: 'tackles', label: 'Desarmes', title: 'Desarmes', kind: 'count', value: (p) => p.tackles },
  interceptions: { id: 'interceptions', label: 'Intercep.', title: 'Interceptações', kind: 'count', value: (p) => p.interceptions },
  blocks: { id: 'blocks', label: 'Bloqueios', title: 'Chutes bloqueados', kind: 'count', value: (p) => p.blocks },
  duelsWon: { id: 'duelsWon', label: 'Duelos', title: 'Duelos ganhos', kind: 'count', value: (p) => p.duelsWon },
  duelsPct: {
    id: 'duelsPct',
    label: 'Duelos %',
    title: 'Duelos ganhos, em porcentagem dos disputados',
    kind: 'percent',
    value: (p) => pct(p.duelsWon, p.duels),
  },
  saves: { id: 'saves', label: 'Defesas', title: 'Defesas', kind: 'count', value: (p) => p.saves },
  conceded: {
    id: 'conceded',
    label: 'Gols sofr.',
    title: 'Gols sofridos',
    kind: 'count',
    value: (p) => p.goalsConceded,
    ascending: true,
  },
  penaltiesSaved: {
    id: 'penaltiesSaved',
    label: 'Pên. def.',
    title: 'Pênaltis defendidos',
    kind: 'count',
    value: (p) => p.penaltiesSaved,
  },
  yellow: { id: 'yellow', label: 'Amarelos', title: 'Cartões amarelos', kind: 'count', value: (p) => p.yellowCards },
  red: { id: 'red', label: 'Vermelhos', title: 'Cartões vermelhos (inclui o segundo amarelo)', kind: 'count', value: (p) => p.redCards },
  foulsCommitted: { id: 'foulsCommitted', label: 'Faltas', title: 'Faltas cometidas', kind: 'count', value: (p) => p.foulsCommitted },
  foulsDrawn: { id: 'foulsDrawn', label: 'Sofridas', title: 'Faltas sofridas', kind: 'count', value: (p) => p.foulsDrawn },
  penaltiesCommitted: {
    id: 'penaltiesCommitted',
    label: 'Pên. com.',
    title: 'Pênaltis cometidos',
    kind: 'count',
    value: (p) => p.penaltiesCommitted,
  },
  rating: { id: 'rating', label: 'Nota', title: 'Nota média na temporada', kind: 'rating', value: (p) => p.rating },
} satisfies Record<string, PlayerColumn>;

export const PLAYER_TABS: PlayerTab[] = [
  {
    id: 'geral',
    label: 'Geral',
    sort: 'rating',
    columns: [col.apps, col.minutes, col.goals, col.assists, col.shots, col.tackles, col.rating],
  },
  {
    id: 'ataque',
    label: 'Ataque',
    sort: 'goals',
    columns: [col.goals, col.shots, col.shotsOn, col.conversion, col.dribblesWon, col.penaltiesScored, col.rating],
  },
  {
    id: 'defesa',
    label: 'Defesa',
    sort: 'tackles',
    columns: [col.tackles, col.interceptions, col.blocks, col.duelsWon, col.duelsPct, col.rating],
  },
  {
    id: 'passe',
    label: 'Passe',
    sort: 'keyPasses',
    columns: [col.assists, col.keyPasses, col.passes, col.passAccuracy, col.rating],
  },
  {
    id: 'goleiro',
    label: 'Goleiro',
    sort: 'saves',
    goalkeepers: true,
    columns: [col.apps, col.saves, col.conceded, col.penaltiesSaved, col.rating],
  },
  {
    id: 'disciplina',
    label: 'Disciplina',
    sort: 'yellow',
    columns: [col.yellow, col.red, col.foulsCommitted, col.foulsDrawn, col.penaltiesCommitted, col.rating],
  },
];

/** Valor da coluna no modo escolhido: contagens divididas por jogo ou por 90 minutos. */
export function columnValue(c: PlayerColumn, p: PlayerRow, mode: Accumulation): number | null {
  const v = c.value(p);
  if (v === null || c.kind !== 'count' || mode === 'total') return v;
  if (mode === 'game') return p.appearances ? v / p.appearances : null;
  return p.minutes ? (v / p.minutes) * 90 : null;
}

/** Texto da célula: nota com uma casa, inteiro no total, duas casas nas médias, "%" nas porcentagens, "–" sem valor. */
export function formatValue(c: PlayerColumn, v: number | null, mode: Accumulation): string {
  if (v === null) return '–';
  if (c.kind === 'rating') return formatRating(v);
  if (c.kind === 'percent') return formatPercent(v, 0, 1);
  if (c.kind === 'count' && mode !== 'total') return formatNumber(v, 2);
  return formatNumber(v);
}
