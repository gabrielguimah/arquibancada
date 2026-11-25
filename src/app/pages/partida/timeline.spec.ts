import { Fixture, FixtureEvent } from '../../api/api-football';
import { TimelineEvent, timeline } from './timeline';

const botafogo = { id: 120, name: 'Botafogo', logo: '' };
const saoPaulo = { id: 126, name: 'São Paulo', logo: '' };

function ev(
  team: typeof botafogo,
  elapsed: number,
  type: string,
  detail: string,
  player: [number, string],
  assist: [number, string] | null = null,
  comments: string | null = null,
  extra: number | null = null,
): FixtureEvent {
  return {
    time: { elapsed, extra },
    team,
    player: { id: player[0], name: player[1] },
    assist: { id: assist?.[0] ?? null, name: assist?.[1] ?? null },
    type,
    detail,
    comments,
  };
}

// Lances do Botafogo 1 x 1 São Paulo (rodada 36), resumidos.
function match(): Fixture {
  return {
    fixture: { id: 1, date: '', timestamp: 0, venue: { name: null, city: null }, status: { long: '', short: 'FT', elapsed: 90, extra: null } },
    teams: { home: botafogo, away: saoPaulo },
    goals: { home: 1, away: 1 },
    score: {
      halftime: { home: 0, away: 1 },
      fulltime: { home: 1, away: 1 },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
    lineups: [
      {
        team: botafogo,
        formation: null,
        startXI: [{ player: { id: 10, name: 'G. Justino', number: 34, pos: 'D', grid: null } }],
        substitutes: [{ player: { id: 11, name: 'D. Santos', number: 3, pos: 'D', grid: null } }],
        coach: null,
      },
    ],
    events: [
      ev(saoPaulo, 23, 'Card', 'Yellow Card', [20, 'Newton'], null, 'Foul'),
      ev(saoPaulo, 28, 'Goal', 'Normal Goal', [21, 'Pedro Lima'], [22, 'Luciano']),
      ev(botafogo, 45, 'subst', 'Substitution 1', [10, 'Gabriel Justino'], [11, 'Danilo dos Santos de Oliveira']),
      ev(botafogo, 81, 'Goal', 'Normal Goal', [12, 'Tiquinho Soares']),
      ev(botafogo, 90, 'Card', 'Red Card', [13, 'Marçal'], null, 'Violent Conduct', 2),
      ev(saoPaulo, 90, 'Var', 'Card upgrade confirmed', [23, 'Wendell'], null, null, 6),
    ],
  };
}

describe('Lance a lance', () => {
  it('em ordem cronológica, com "Intervalo" e "Fim de jogo" e o placar de cada um', () => {
    const items = timeline(match());
    const summary = items.map((i) => (i.type === 'divider' ? `— ${i.label} ${i.score}` : `${i.minute} ${i.side} ${i.kind}`));
    expect(summary).toEqual([
      "23' away yellow",
      "28' away goal",
      '— Intervalo 0 - 1',
      "45' home sub",
      "81' home goal",
      "90+2' home red",
      "90+6' away var",
      '— Fim de jogo 1 - 1',
    ]);
  });

  it('gol mostra o placar depois dele e a assistência', () => {
    const goals = timeline(match()).filter((i): i is TimelineEvent => i.type === 'event' && i.kind === 'goal');
    expect(goals.map((g) => [g.main, g.secondary, g.score, g.assist])).toEqual([
      ['P. Lima', 'Luciano', '0 - 1', true],
      ['T. Soares', null, '1 - 1', false],
    ]);
  });

  it('traduz motivo do cartão e decisão do VAR; substituição usa os nomes curtos da escalação', () => {
    const events = timeline(match()).filter((i): i is TimelineEvent => i.type === 'event');
    const find = (kind: string) => events.find((e) => e.kind === kind)!;
    expect([find('red').main, find('red').secondary]).toEqual(['Marçal', 'Conduta violenta']);
    expect(find('yellow').secondary).toBe('Falta');
    expect([find('var').main, find('var').secondary]).toEqual(['Wendell', 'Cartão modificado']);
    expect([find('sub').main, find('sub').secondary]).toEqual(['D. Santos', 'G. Justino']);
  });

  it('jogo no 1º tempo não tem separadores', () => {
    const f = match();
    f.fixture.status.short = '1H';
    f.events = f.events!.slice(0, 2);
    expect(timeline(f).some((i) => i.type === 'divider')).toBe(false);
  });
});
