import { roundStarted } from './fixture-status';

const DAY = 24 * 3600;
const game = (timestamp: number, short = 'NS') => ({ fixture: { timestamp, status: { short } } });
// Rodada de 10 jogos num fim de semana (sábado a segunda).
const weekend = (start: number) => Array.from({ length: 10 }, (_, i) => game(start + Math.floor(i / 4) * DAY + (i % 4) * 7200));

describe('roundStarted', () => {
  const start = 1_800_000_000;

  it('nenhum jogo começou: não', () => {
    expect(roundStarted(weekend(start))).toBe(false);
  });

  it('um jogo em andamento ou encerrado na data da rodada: sim', () => {
    const live = weekend(start);
    live[0] = game(start, '1H');
    expect(roundStarted(live)).toBe(true);
    const done = weekend(start);
    done[1] = game(start + 7200, 'FT');
    expect(roundStarted(done)).toBe(true);
  });

  it('só encerrado (finishedOnly): jogo em andamento não conta', () => {
    const live = weekend(start);
    live[0] = game(start, '2H');
    expect(roundStarted(live, true)).toBe(false);
    live[1] = game(start + 7200, 'FT');
    expect(roundStarted(live, true)).toBe(true);
  });

  it('jogo antecipado semanas antes do resto da rodada: não conta', () => {
    const fixtures = weekend(start);
    fixtures[9] = game(start - 30 * DAY, 'FT');
    expect(roundStarted(fixtures)).toBe(false);
  });

  it('jogo adiado sem data não muda a data típica da rodada', () => {
    const fixtures = [...weekend(start), game(start + 90 * DAY, 'PST'), game(start + 90 * DAY, 'PST')];
    fixtures[0] = game(start, 'FT');
    expect(roundStarted(fixtures)).toBe(true);
  });
});
