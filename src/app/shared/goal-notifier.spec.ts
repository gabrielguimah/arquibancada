import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiFootball, Fixture, FixtureEvent } from '../api/api-football';
import { BrowserNotifications } from './browser-notifications';
import { GoalNotifier } from './goal-notifier';
import { GoalSounds } from './goal-sounds';
import { LiveFixtures } from './live-fixtures';

const goal = (elapsed: number, player: string, detail = 'Normal Goal', assist: string | null = null): FixtureEvent => ({
  time: { elapsed, extra: null },
  team: { id: 127, name: 'Flamengo', logo: '' },
  player: { id: elapsed, name: player },
  assist: { id: null, name: assist },
  type: 'Goal',
  detail,
});

function fixture(events: FixtureEvent[]): Fixture {
  return {
    fixture: { id: 1, date: '', timestamp: 0, venue: { name: null, city: null }, status: { long: '', short: '2H', elapsed: 60, extra: null } },
    teams: { home: { id: 127, name: 'Flamengo', logo: '' }, away: { id: 121, name: 'Palmeiras', logo: '' } },
    goals: { home: events.length, away: 0 },
    events,
  };
}

describe('GoalNotifier', () => {
  it('avisa só os gols novos, com autor e assistência, e ignora pênalti perdido', async () => {
    let current = fixture([goal(10, 'Pedro')]);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiFootball, useValue: { fixturesOn: () => of([current]), fixturesByIds: () => of([current]) } }],
    });
    const notifier = TestBed.inject(GoalNotifier);
    // Os gols chegam pelas atualizações da busca compartilhada de jogos ao vivo.
    const live = TestBed.inject(LiveFixtures);

    // Primeira olhada: o gol que já existia não gera aviso.
    expect(await live.poll()).toBe(15_000);
    expect(notifier.toasts()).toEqual([]);

    current = fixture([goal(10, 'Pedro'), goal(55, 'Bruno Henrique', 'Normal Goal', 'Arrascaeta'), goal(58, 'Plata', 'Missed Penalty')]);
    await live.poll();
    expect(notifier.toasts().map((t) => [t.goal.player.name, t.goal.assist.name, t.minute])).toEqual([
      ['Bruno Henrique', 'Arrascaeta', "55'"],
    ]);

    // O mesmo gol não é avisado de novo.
    await live.poll();
    expect(notifier.toasts().length).toBe(1);
  });
});

describe('GoalNotifier: gol anulado', () => {
  const varEvent = (elapsed: number, player: string, detail: string): FixtureEvent => ({
    ...goal(elapsed, player),
    type: 'Var',
    detail,
  });

  it('avisa o gol anulado pelo VAR com o motivo, e uma vez só mesmo se o gol sumir da lista', async () => {
    let current = fixture([]);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiFootball, useValue: { fixturesOn: () => of([current]), fixturesByIds: () => of([current]) } }],
    });
    const notifier = TestBed.inject(GoalNotifier);
    // Os gols chegam pelas atualizações da busca compartilhada de jogos ao vivo.
    const live = TestBed.inject(LiveFixtures);
    await live.poll();

    current = fixture([goal(30, 'Pedro')]);
    await live.poll();
    // A API retira o gol e manda o evento do VAR com o motivo.
    current = fixture([varEvent(30, 'Pedro', 'Goal Disallowed - offside')]);
    await live.poll();

    expect(notifier.toasts().map((t) => [t.type, t.goal.player.name, t.reason])).toEqual([
      ['goal', 'Pedro', undefined],
      ['cancelled', 'Pedro', 'impedimento'],
    ]);
  });

  it('avisa como anulado o gol que some da lista sem evento do VAR', async () => {
    let current = fixture([]);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiFootball, useValue: { fixturesOn: () => of([current]), fixturesByIds: () => of([current]) } }],
    });
    const notifier = TestBed.inject(GoalNotifier);
    // Os gols chegam pelas atualizações da busca compartilhada de jogos ao vivo.
    const live = TestBed.inject(LiveFixtures);
    await live.poll();
    current = fixture([goal(70, 'Plata')]);
    await live.poll();
    current = fixture([]);
    await live.poll();

    expect(notifier.toasts().map((t) => [t.type, t.goal.player.name])).toEqual([
      ['goal', 'Plata'],
      ['cancelled', 'Plata'],
    ]);
  });
});

describe('GoalNotifier: falha da API', () => {
  it('não avisa gol anulado se a lista de eventos vier vazia mas o placar continuar igual', async () => {
    let current = fixture([]);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiFootball, useValue: { fixturesOn: () => of([current]), fixturesByIds: () => of([current]) } }],
    });
    const notifier = TestBed.inject(GoalNotifier);
    // Os gols chegam pelas atualizações da busca compartilhada de jogos ao vivo.
    const live = TestBed.inject(LiveFixtures);
    await live.poll();
    current = fixture([goal(20, 'Pedro')]);
    await live.poll();
    current = { ...fixture([]), goals: { home: 1, away: 0 } };
    await live.poll();
    expect(notifier.toasts().map((t) => t.type)).toEqual(['goal']);
  });
});

describe('GoalNotifier: som', () => {
  async function newGoal(systemNotifies: boolean) {
    let current = fixture([]);
    const played: string[] = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiFootball, useValue: { fixturesOn: () => of([current]), fixturesByIds: () => of([current]) } },
        { provide: GoalSounds, useValue: { play: (type: string) => played.push(type) } },
        { provide: BrowserNotifications, useValue: { willNotify: () => systemNotifies, show: async () => undefined } },
      ],
    });
    TestBed.inject(GoalNotifier);
    const live = TestBed.inject(LiveFixtures);
    await live.poll();
    current = fixture([goal(30, 'Pedro')]);
    await live.poll();
    return played;
  }

  it('toca o som no gol novo com o site na frente', async () => {
    expect(await newGoal(false)).toEqual(['goal']);
  });

  it('toca também com o site em segundo plano (a notificação do sistema pode vir muda)', async () => {
    expect(await newGoal(true)).toEqual(['goal']);
  });

  it('o mesmo gol pelo push e pela página toca uma vez só', async () => {
    const played = await newGoal(false);
    const notifier = TestBed.inject(GoalNotifier);
    notifier.pushArrived(notifier.toasts()[0].id, 'goal');
    notifier.pushArrived('outro-gol', 'cancelled');
    expect(played).toEqual(['goal', 'cancelled']);
  });
});
