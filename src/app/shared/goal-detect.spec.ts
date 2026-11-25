import { GoalEvent, GoalFixture, WatchState, detectGoals } from './goal-detect';

const home = { id: 130, name: 'Grêmio', logo: '' };
const away = { id: 131, name: 'Corinthians', logo: '' };

const goal = (min: number, team: GoalEvent['team'], name: string, detail = 'Normal Goal'): GoalEvent => ({
  time: { elapsed: min, extra: null },
  team,
  player: { id: null, name },
  assist: { id: null, name: null },
  type: 'Goal',
  detail,
});
const varCancel = (e: GoalEvent): GoalEvent => ({ ...e, type: 'Var', detail: 'Goal Disallowed - offside' });
const fx = (events: GoalEvent[], h: number, a: number): GoalFixture => ({ fixture: { id: 1 }, goals: { home: h, away: a }, events });

/** Aplica as verificações em sequência e devolve os avisos de cada uma. */
function run(...checks: GoalFixture[]): string[][] {
  let state: WatchState | undefined;
  return checks.map((f) => {
    const r = detectGoals(state, f);
    state = r.state;
    return r.alerts.map((a) => `${a.type} ${a.event.player.name} ${a.event.time.elapsed}'`);
  });
}

describe('detectGoals: cada aviso uma vez só', () => {
  it('não avisa os gols que já existiam na primeira olhada, e avisa o gol novo uma vez', () => {
    const a = goal(10, home, 'A');
    const b = goal(30, away, 'B', 'Penalty');
    expect(run(fx([a], 1, 0), fx([a, b], 1, 1), fx([a, b], 1, 1))).toEqual([[], ["goal B 30'"], []]);
  });

  it('gol corrigido pela API (outro minuto ou autor) não é avisado de novo', () => {
    const a = goal(10, home, 'A');
    expect(run(fx([], 0, 0), fx([a], 1, 0), fx([goal(11, home, 'A')], 1, 0), fx([goal(11, home, 'Autor certo')], 1, 0))).toEqual([
      [],
      ["goal A 10'"],
      [],
      [],
    ]);
  });

  it('gol anulado: uma vez, venha do VAR e depois o gol sumindo da lista', () => {
    const c = goal(50, home, 'C');
    expect(run(fx([], 0, 0), fx([c], 1, 0), fx([c, varCancel(c)], 1, 0), fx([], 0, 0))).toEqual([[], ["goal C 50'"], ["cancelled C 50'"], []]);
  });

  it('gol e anulação na mesma verificação: só a anulação', () => {
    const c = goal(50, home, 'C');
    expect(run(fx([], 0, 0), fx([c, varCancel(c)], 1, 0))).toEqual([[], ["cancelled C 50'"]]);
  });

  it('lista vazia por falha da API (placar igual) não vira gol anulado', () => {
    const a = goal(10, home, 'A');
    expect(run(fx([], 0, 0), fx([a], 1, 0), fx([], 1, 0), fx([a], 1, 0))).toEqual([[], ["goal A 10'"], [], []]);
  });

  it('dois gols novos do mesmo time na mesma verificação: os dois', () => {
    expect(run(fx([], 0, 0), fx([goal(20, home, 'A'), goal(22, home, 'B')], 2, 0))).toEqual([[], ["goal A 20'", "goal B 22'"]]);
  });
});
