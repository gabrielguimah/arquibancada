import { TeamRating, TeamStats } from '../../api/api-football';
import { formatRating } from '../../shared/rating';

/** Coluna da tabela de times (cada uma ordena a tabela ao clicar no título). */
export interface TeamMetric {
  id: 'games' | 'rating' | keyof TeamStats;
  /** Título curto da coluna. */
  label: string;
  /** Nome completo, no tooltip do título. */
  title: string;
  /** Valor exibido e usado na ordenação; `null` quando ainda não calculado. */
  value: (r: TeamRating) => number | null;
  format: (v: number) => string;
  /** Menor é melhor (gols sofridos, cartões, faltas): a primeira ordenação é crescente. */
  ascending?: boolean;
  /** Mostra o selo colorido da nota. */
  rating?: boolean;
}

const count = (v: number) => String(v);
const stat = (key: keyof TeamStats) => (r: TeamRating) => r.stats?.[key] ?? null;

// Só o que a API-Football traz. Primeiro o resumo (jogos, nota, gols), depois ataque, posse, defesa e disciplina.
export const TEAM_METRICS: TeamMetric[] = [
  { id: 'games', label: 'Jogos', title: 'Jogos disputados', value: (r) => r.games ?? null, format: count },
  { id: 'rating', label: 'Nota', title: 'Nota média', value: (r) => r.rating, format: formatRating, rating: true },
  { id: 'goalsFor', label: 'Gols', title: 'Gols marcados', value: stat('goalsFor'), format: count },
  { id: 'goalsAgainst', label: 'Sofridos', title: 'Gols sofridos', value: stat('goalsAgainst'), format: count, ascending: true },
  { id: 'xg', label: 'xG', title: 'Gols esperados (xG)', value: stat('xg'), format: (v) => v.toFixed(2) },
  { id: 'cleanSheets', label: 'Sem sofrer', title: 'Jogos sem sofrer gols', value: stat('cleanSheets'), format: count },
  { id: 'shots', label: 'Finaliz.', title: 'Finalizações', value: stat('shots'), format: count },
  { id: 'shotsOnGoal', label: 'No gol', title: 'Finalizações no gol', value: stat('shotsOnGoal'), format: count },
  { id: 'possession', label: 'Posse', title: 'Posse de bola', value: stat('possession'), format: (v) => `${v.toFixed(1)}%` },
  { id: 'passesAccurate', label: 'Passes', title: 'Passes certos', value: stat('passesAccurate'), format: count },
  { id: 'keyPasses', label: 'Passes dec.', title: 'Passes decisivos', value: stat('keyPasses'), format: count },
  { id: 'dribbles', label: 'Dribles', title: 'Dribles certos', value: stat('dribbles'), format: count },
  { id: 'corners', label: 'Escanteios', title: 'Escanteios', value: stat('corners'), format: count },
  { id: 'tackles', label: 'Desarmes', title: 'Desarmes', value: stat('tackles'), format: count },
  { id: 'interceptions', label: 'Intercep.', title: 'Interceptações', value: stat('interceptions'), format: count },
  { id: 'fouls', label: 'Faltas', title: 'Faltas cometidas', value: stat('fouls'), format: count, ascending: true },
  { id: 'yellowCards', label: 'Amarelos', title: 'Cartões amarelos', value: stat('yellowCards'), format: count, ascending: true },
  { id: 'redCards', label: 'Vermelhos', title: 'Cartões vermelhos', value: stat('redCards'), format: count, ascending: true },
  { id: 'penaltyGoals', label: 'Gols pên.', title: 'Gols de pênalti', value: stat('penaltyGoals'), format: count },
  {
    id: 'penaltiesConceded',
    label: 'Pên. contra',
    title: 'Pênaltis cometidos',
    value: stat('penaltiesConceded'),
    format: count,
    ascending: true,
  },
];

/** Categoria de estatísticas (abas acima da tabela), como na tabela de jogadores. */
export interface TeamTab {
  id: string;
  label: string;
  /** Coluna da ordenação inicial (na ordem natural dela: crescente se menor é melhor). */
  sort: TeamMetric['id'];
  columns: TeamMetric[];
}

const metric = (id: TeamMetric['id']) => TEAM_METRICS.find((m) => m.id === id)!;
const columns = (...ids: Array<TeamMetric['id']>) => ids.map(metric);

// A nota média fica em todas as abas, sempre por último, como referência (como na tabela de jogadores).
export const TEAM_TABS: TeamTab[] = [
  { id: 'geral', label: 'Geral', sort: 'rating', columns: columns('games', 'goalsFor', 'goalsAgainst', 'cleanSheets', 'possession', 'rating') },
  {
    id: 'ataque',
    label: 'Ataque',
    sort: 'goalsFor',
    columns: columns('goalsFor', 'xg', 'shots', 'shotsOnGoal', 'dribbles', 'corners', 'penaltyGoals', 'rating'),
  },
  { id: 'defesa', label: 'Defesa', sort: 'goalsAgainst', columns: columns('goalsAgainst', 'cleanSheets', 'tackles', 'interceptions', 'rating') },
  { id: 'passe', label: 'Passe', sort: 'passesAccurate', columns: columns('possession', 'passesAccurate', 'keyPasses', 'rating') },
  {
    id: 'disciplina',
    label: 'Disciplina',
    sort: 'yellowCards',
    columns: columns('fouls', 'yellowCards', 'redCards', 'penaltiesConceded', 'rating'),
  },
];
