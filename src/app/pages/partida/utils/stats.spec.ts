import { Fixture } from '../../../api/api-football';
import { matchStats } from './stats';

const home = { id: 132, name: 'Chapecoense', logo: '' };
const away = { id: 121, name: 'Palmeiras', logo: '' };

function match(statistics: Fixture['statistics']): Fixture {
  return {
    fixture: { id: 1, date: '', timestamp: 0, venue: { name: null, city: null }, status: { long: '', short: 'FT', elapsed: 90, extra: null } },
    teams: { home, away },
    goals: { home: 3, away: 0 },
    statistics,
  };
}

describe('Estatísticas da partida', () => {
  it('mandante x visitante na ordem definida, com %, xG em vírgula e precisão dos passes', () => {
    // A API pode mandar o visitante primeiro.
    const rows = matchStats(
      match([
        { team: away, statistics: [{ type: 'Total passes', value: 556 }, { type: 'Passes accurate', value: 502 }, { type: 'expected_goals', value: '1.23' }, { type: 'Ball Possession', value: '56%' }] },
        { team: home, statistics: [{ type: 'Total passes', value: 433 }, { type: 'Passes accurate', value: 376 }, { type: 'expected_goals', value: '1.74' }, { type: 'Ball Possession', value: '44%' }] },
      ]),
    );
    expect(rows.map((g) => [g.title, g.rows.map((r) => [r.label, r.home, r.away, r.leader])])).toEqual([
      [
        'Geral',
        [
          ['Posse de bola', '44%', '56%', 'away'],
          ['Gols esperados (xG)', '1,74', '1,23', 'home'],
        ],
      ],
      [
        'Passes',
        [
          ['Total', '433', '556', 'away'],
          ['Passes certos', '376 (87%)', '502 (90%)', 'away'],
        ],
      ],
    ]);
    expect(rows[0].rows[0].homeShare).toBeCloseTo(0.44);
  });

  it('valor nulo conta como zero; empate não tem destaque; zero a zero não tem barra', () => {
    const rows = matchStats(
      match([
        { team: home, statistics: [{ type: 'Red Cards', value: null }, { type: 'Offsides', value: 2 }] },
        { team: away, statistics: [{ type: 'Red Cards', value: null }, { type: 'Offsides', value: 2 }] },
      ]),
    );
    expect(rows.flatMap((g) => g.rows).map((r) => [r.label, r.home, r.away, r.leader, r.homeShare])).toEqual([['Impedimentos', '2', '2', null, 0.5]]);
  });

  it('soma os números dos jogadores: duelos com a parte ganha, dribles certos/tentados; pênalti só se houver', () => {
    const f = match([
      { team: home, statistics: [] },
      { team: away, statistics: [] },
    ]);
    const player = (duels: [number, number], dribbles: [number, number], penaltyWon: number | null = null) => ({
      player: { id: 0, name: '', photo: '' },
      statistics: [
        {
          games: { minutes: 90, rating: null, captain: false, substitute: false },
          duels: { total: duels[0], won: duels[1] },
          dribbles: { attempts: dribbles[0], success: dribbles[1] },
          penalty: { won: penaltyWon, commited: null },
        },
      ],
    });
    f.players = [
      { team: home, players: [player([10, 4], [3, 2]), player([8, 4], [0, 0])] },
      { team: away, players: [player([18, 10], [5, 1])] },
    ];
    const rows = matchStats(f);
    expect(rows.map((g) => [g.title, g.rows.map((r) => [r.label, r.home, r.away])])).toEqual([
      [
        'Duelos',
        [
          ['Duelos ganhos', '8 (44%)', '10 (56%)'],
          ['Dribles certos', '2/3', '1/5'],
        ],
      ],
    ]);
    f.players[1].players[0].statistics[0].penalty!.won = 1;
    expect(matchStats(f).find((g) => g.title === 'Disciplina')?.rows.map((r) => [r.label, r.home, r.away])).toEqual([['Pênaltis sofridos', '0', '1']]);
  });

  it('antes do início (sem estatísticas), lista vazia', () => {
    expect(matchStats(match(undefined))).toEqual([]);
    expect(matchStats(match([]))).toEqual([]);
  });
});
