import { Fixture, FixtureTeamPlayers, FixtureTeamStats } from '../../api/api-football';

/** Uma linha das estatísticas: valor do mandante, nome, valor do visitante e a parte de cada um. */
export interface StatRow {
  label: string;
  home: string;
  away: string;
  /** Fração do total de cada lado (0 a 1), para as barras; 0 e 0 quando os dois são zero. */
  homeShare: number;
  awayShare: number;
  /** Quem tem o maior número (a barra fica em destaque); `null` no empate. */
  leader: 'home' | 'away' | null;
}

/** Bloco de estatísticas com título ("Finalizações", "Passes"…). */
export interface StatGroup {
  title: string;
  rows: StatRow[];
}

/** Dados de um time: estatísticas da API e números dos jogadores (somados quando a API não dá por time). */
interface Side {
  team: FixtureTeamStats;
  players: FixtureTeamPlayers['players'];
}

type PlayerStats = FixtureTeamPlayers['players'][number]['statistics'][number];

interface RowDef {
  label: string;
  /** Número que compara os dois times (barras e destaque). */
  value: (s: Side) => number | null;
  /** Texto do valor; por padrão, o próprio número. */
  text?: (v: number, s: Side) => string;
  /** Linha só aparece se algum dos dois tiver mais que zero (pênaltis). */
  hideZero?: boolean;
}

/** Estatística do time como a API manda (`type` em inglês); "56%" e "1.74" viram número. */
const team =
  (type: string) =>
  (s: Side): number | null => {
    const v = s.team.statistics.find((x) => x.type === type)?.value;
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

/** Soma de um número dos jogadores; `null` se nenhum jogador tem o dado. */
const players =
  (pick: (p: PlayerStats) => number | null | undefined) =>
  (s: Side): number | null => {
    const values = s.players.map((p) => pick(p.statistics[0] ?? ({} as PlayerStats))).filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((t, v) => t + v, 0) : null;
  };

/** "376 (87%)": a parte em relação a um total do mesmo time. */
const withRate = (total: (s: Side) => number | null) => (v: number, s: Side) => {
  const t = total(s);
  return t ? `${v} (${Math.round((v / t) * 100)}%)` : String(v);
};

// Estatísticas por bloco, na ordem em que aparecem. As da API vêm por time; as demais são a soma dos
// jogadores (mesma busca da partida), que pode ficar um pouco abaixo da real se faltar dado de alguém.
const GROUPS: Array<{ title: string; rows: RowDef[] }> = [
  {
    title: 'Geral',
    rows: [
      { label: 'Posse de bola', value: team('Ball Possession'), text: (v) => `${v}%` },
      { label: 'Gols esperados (xG)', value: team('expected_goals'), text: (v) => v.toFixed(2).replace('.', ',') },
      { label: 'Escanteios', value: team('Corner Kicks') },
      { label: 'Tiros livres', value: team('Free Kicks') },
      { label: 'Impedimentos', value: team('Offsides') },
    ],
  },
  {
    title: 'Finalizações',
    rows: [
      { label: 'Total', value: team('Total Shots') },
      { label: 'No gol', value: team('Shots on Goal') },
      { label: 'Para fora', value: team('Shots off Goal') },
      { label: 'Bloqueadas', value: team('Blocked Shots') },
      { label: 'Dentro da área', value: team('Shots insidebox') },
      { label: 'Fora da área', value: team('Shots outsidebox') },
    ],
  },
  {
    title: 'Passes',
    rows: [
      { label: 'Total', value: team('Total passes') },
      { label: 'Passes certos', value: team('Passes accurate'), text: withRate(team('Total passes')) },
      { label: 'Passes decisivos', value: players((p) => p.passes?.key) },
    ],
  },
  {
    title: 'Defesa',
    rows: [
      { label: 'Desarmes', value: players((p) => p.tackles?.total) },
      { label: 'Interceptações', value: players((p) => p.tackles?.interceptions) },
      { label: 'Defesas do goleiro', value: team('Goalkeeper Saves') },
    ],
  },
  {
    title: 'Duelos',
    rows: [
      { label: 'Duelos ganhos', value: players((p) => p.duels?.won), text: withRate(players((p) => p.duels?.total)) },
      {
        label: 'Dribles certos',
        value: players((p) => p.dribbles?.success),
        text: (v, s) => {
          const tried = players((p) => p.dribbles?.attempts)(s);
          return tried ? `${v}/${tried}` : String(v);
        },
      },
    ],
  },
  {
    title: 'Disciplina',
    rows: [
      { label: 'Faltas cometidas', value: team('Fouls') },
      { label: 'Faltas sofridas', value: players((p) => p.fouls?.drawn) },
      { label: 'Pênaltis cometidos', value: players((p) => p.penalty?.commited), hideZero: true },
      { label: 'Pênaltis sofridos', value: players((p) => p.penalty?.won), hideZero: true },
      { label: 'Cartões amarelos', value: team('Yellow Cards') },
      { label: 'Cartões vermelhos', value: team('Red Cards') },
    ],
  },
];

/**
 * Estatísticas da partida, mandante x visitante, em blocos. Linha sem dado para os dois times fica de
 * fora, e bloco sem linha também; lista vazia antes do início (a API só manda com a bola rolando).
 */
export function matchStats(f: Fixture): StatGroup[] {
  const side = (id: number): Side | null => {
    const stats = f.statistics?.find((s) => s.team.id === id);
    return stats ? { team: stats, players: f.players?.find((p) => p.team.id === id)?.players ?? [] } : null;
  };
  const home = side(f.teams.home.id);
  const away = side(f.teams.away.id);
  if (!home || !away) return [];

  return GROUPS.map(({ title, rows }) => ({
    title,
    rows: rows.flatMap(({ label, value, text = (v: number) => String(v), hideZero }): StatRow[] => {
      const h = value(home);
      const a = value(away);
      if (h === null && a === null) return [];
      const [hv, av] = [h ?? 0, a ?? 0];
      if (hideZero && !hv && !av) return [];
      const total = hv + av;
      return [
        {
          label,
          home: text(hv, home),
          away: text(av, away),
          homeShare: total ? hv / total : 0,
          awayShare: total ? av / total : 0,
          leader: hv > av ? 'home' : av > hv ? 'away' : null,
        },
      ];
    }),
  })).filter((g) => g.rows.length > 0);
}
