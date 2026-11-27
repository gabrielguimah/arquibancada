import { notBehind, roundStarted } from './fixture-status';

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

describe('notBehind', () => {
  const at = (short: string, elapsed: number | null, home: number, extra: number | null = null) => ({
    fixture: { status: { short, elapsed, extra } },
    goals: { home, away: 1 },
  });

  it('resposta atrás da da tela (minuto ou situação anterior): fica a da tela', () => {
    expect(notBehind(at('2H', 70, 3), at('2H', 62, 2)).goals.home).toBe(3);
    expect(notBehind(at('2H', 50, 3), at('HT', 45, 2)).goals.home).toBe(3);
    expect(notBehind(at('2H', 90, 3, 4), at('2H', 90, 2, 2)).goals.home).toBe(3);
  });

  it('mais adiantada ou empatada: fica a nova (gol anulado no mesmo minuto passa)', () => {
    expect(notBehind(at('2H', 70, 3), at('2H', 71, 3)).fixture.status.elapsed).toBe(71);
    expect(notBehind(at('2H', 70, 3), at('2H', 70, 2)).goals.home).toBe(2);
    expect(notBehind(null, at('1H', 5, 0)).fixture.status.elapsed).toBe(5);
  });

  it('situação fora da ordem conhecida (suspenso, interrompido): aceita a nova', () => {
    expect(notBehind(at('2H', 70, 3), at('SUSP', 70, 3)).fixture.status.short).toBe('SUSP');
  });
});
