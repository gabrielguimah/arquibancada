import { TeamRating, TeamStats } from '../../api/api-football';
import { formatRating } from '../../shared/rating';

/** Critério de ordenação das tabelas de times (o select acima delas). */
export interface TeamMetric {
  id: 'rating' | keyof TeamStats;
  label: string;
  /** Valor exibido e usado na ordenação; `null` quando ainda não calculado. */
  value: (r: TeamRating) => number | null;
  format: (v: number) => string;
}

const count = (v: number) => String(v);
const stat = (key: keyof TeamStats) => (r: TeamRating) => r.stats?.[key] ?? null;

// Só o que a API-Football traz; nomes e ordem como no SofaScore.
export const TEAM_METRICS: TeamMetric[] = [
  { id: 'rating', label: 'Nota média', value: (r) => r.rating, format: formatRating },
  { id: 'goalsFor', label: 'Gols marcados', value: stat('goalsFor'), format: count },
  { id: 'goalsAgainst', label: 'Gols sofridos', value: stat('goalsAgainst'), format: count },
  { id: 'yellowCards', label: 'Cartões amarelos', value: stat('yellowCards'), format: count },
  { id: 'redCards', label: 'Cartões vermelhos', value: stat('redCards'), format: count },
  { id: 'possession', label: 'Posse de bola', value: stat('possession'), format: (v) => `${v.toFixed(1)}%` },
  { id: 'passesAccurate', label: 'Passes certos', value: stat('passesAccurate'), format: count },
  { id: 'shots', label: 'Finalizações', value: stat('shots'), format: count },
  { id: 'shotsOnGoal', label: 'Finalizações no gol', value: stat('shotsOnGoal'), format: count },
  { id: 'dribbles', label: 'Dribles certos', value: stat('dribbles'), format: count },
  { id: 'tackles', label: 'Desarmes', value: stat('tackles'), format: count },
  { id: 'interceptions', label: 'Interceptações', value: stat('interceptions'), format: count },
  { id: 'corners', label: 'Escanteios', value: stat('corners'), format: count },
  { id: 'fouls', label: 'Faltas', value: stat('fouls'), format: count },
  { id: 'penaltyGoals', label: 'Gols de pênalti', value: stat('penaltyGoals'), format: count },
  { id: 'penaltiesConceded', label: 'Pênaltis concedidos', value: stat('penaltiesConceded'), format: count },
  { id: 'cleanSheets', label: 'Jogos sem sofrer gols', value: stat('cleanSheets'), format: count },
  { id: 'xg', label: 'Gols esperados (xG)', value: stat('xg'), format: (v) => v.toFixed(2) },
  { id: 'keyPasses', label: 'Passes decisivos', value: stat('keyPasses'), format: count },
];
