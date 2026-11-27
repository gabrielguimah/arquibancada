import { Standing } from '../../api/api-football';
import { ChanceZone, SimMatch, formatChance, simulateChances } from './chances';

function row(id: number, points: number, played = 36, gf = 50, ga = 50, win = Math.floor(points / 3)): Standing {
  return {
    rank: 0,
    team: { id, name: `Time ${id}`, logo: '' },
    points,
    goalsDiff: gf - ga,
    form: null,
    description: null,
    all: { played, win, draw: points - win * 3, lose: played - win - (points - win * 3), goals: { for: gf, against: ga } },
  };
}

const game = (home: number, away: number, extra: Partial<SimMatch> = {}): SimMatch => ({ home, away, homeGoals: 0, awayGoals: 0, remaining: 1, ...extra });

describe('simulateChances', () => {
  // 4 times, 1ª posição Libertadores, última rebaixada.
  const zones: ChanceZone[] = ['libertadores', null, null, 'rebaixamento'];

  it('quem não pode mais ser alcançado tem 100% e os outros 0% de título', () => {
    const table = [row(1, 80), row(2, 70), row(3, 60), row(4, 50)];
    const result = simulateChances(table, [game(1, 2), game(3, 4)], zones, 2000);
    expect(result.get(1)!.title).toBe(1);
    expect(result.get(1)!.libertadores).toBe(1);
    expect(result.get(2)!.title).toBe(0);
    expect(result.get(4)!.relegation).toBe(1);
  });

  it('cada posição vai para exatamente um time em cada simulação', () => {
    const table = [row(1, 60), row(2, 59), row(3, 58), row(4, 57)];
    const result = simulateChances(table, [game(1, 2), game(3, 4), game(1, 3), game(2, 4)], zones, 3000);
    const sum = (k: 'title' | 'relegation') => [...result.values()].reduce((t, c) => t + c[k], 0);
    expect(sum('title')).toBeCloseTo(1, 10);
    expect(sum('relegation')).toBeCloseTo(1, 10);
    // Disputa aberta: o líder é favorito, mas não garantido.
    expect(result.get(1)!.title).toBeGreaterThan(result.get(4)!.title);
    expect(result.get(1)!.title).toBeLessThan(1);
  });

  it('jogo em andamento no fim parte do placar atual', () => {
    const table = [row(1, 60), row(2, 60, 36, 50, 50)];
    // Time 2 vence por 1 a 0 e não falta tempo: título dele.
    const result = simulateChances(table, [game(1, 2, { homeGoals: 0, awayGoals: 1, remaining: 0 })], ['libertadores', null], 500);
    expect(result.get(2)!.title).toBe(1);
  });

  it('mesmos dados, mesmos números', () => {
    const table = [row(1, 60), row(2, 59), row(3, 58), row(4, 57)];
    const matches = [game(1, 2), game(3, 4)];
    expect(simulateChances(table, matches, zones, 1000)).toEqual(simulateChances(table, matches, zones, 1000));
  });
});

describe('formatChance', () => {
  it('arredonda e marca os extremos', () => {
    expect([0, 0.001, 0.374, 0.999, 1].map(formatChance)).toEqual(['0%', '<1%', '37%', '>99%', '100%']);
  });
});
