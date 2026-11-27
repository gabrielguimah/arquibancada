import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiFootball, Fixture } from '../api/api-football';
import { LiveFixtures, fresher } from './live-fixtures';

const NOW = Date.UTC(2026, 10, 23, 22, 0);

function game(id: number, short: string, startsInMinutes: number): Fixture {
  return {
    fixture: {
      id,
      date: '',
      timestamp: NOW / 1000 + startsInMinutes * 60,
      venue: { name: null, city: null },
      status: { long: '', short, elapsed: null, extra: null },
    },
    teams: { home: { id: id * 10, name: 'A', logo: '' }, away: { id: id * 10 + 1, name: 'B', logo: '' } },
    goals: { home: null, away: null },
  };
}

describe('LiveFixtures', () => {
  it('acompanha jogos em andamento e os que começam em até 5 min, numa só busca', async () => {
    const today = [game(1, '2H', -60), game(2, 'NS', 4), game(3, 'NS', -1), game(4, 'NS', 90), game(5, 'FT', -150)];
    let asked: number[] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiFootball,
          useValue: {
            fixturesOn: () => of(today),
            fixturesByIds: (ids: number[]) => {
              asked = ids;
              return of(today.filter((f) => ids.includes(f.fixture.id)));
            },
          },
        },
      ],
    });
    const live = TestBed.inject(LiveFixtures);
    expect(await live.poll(NOW)).toBe(15_000);
    // 3: a lista ainda diz "não iniciado", mas o horário já passou (a lista tem cache de 1 min).
    expect(asked).toEqual([1, 2, 3]);
    expect([...live.byId().keys()]).toEqual([1, 2, 3]);
  });

  it('resposta mais velha que a já mostrada (cache de outra hora) não volta o placar', async () => {
    const at = (elapsed: number, home: number) => {
      const f = game(1, '2H', -80);
      f.fixture.status.elapsed = elapsed;
      f.goals = { home, away: 1 };
      return f;
    };
    const responses = [at(70, 3), at(62, 2), at(71, 3)];
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiFootball, useValue: { fixturesOn: () => of([game(1, '2H', -80)]), fixturesByIds: () => of([responses.shift()!]) } },
      ],
    });
    const live = TestBed.inject(LiveFixtures);
    await live.poll(NOW);
    expect(live.byId().get(1)?.goals.home).toBe(3);
    // 3 x 1 aos 70', e chega uma resposta de 62' com 2 x 1: fica o 3 x 1.
    await live.poll(NOW);
    expect(live.byId().get(1)?.goals.home).toBe(3);
    expect(live.byId().get(1)?.fixture.status.elapsed).toBe(70);
    await live.poll(NOW);
    expect(live.byId().get(1)?.fixture.status.elapsed).toBe(71);
  });

  it('sem jogo para acompanhar, espera até 5 min antes do próximo início', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: ApiFootball, useValue: { fixturesOn: () => of([game(1, 'NS', 20)]), fixturesByIds: () => of([]) } }],
    });
    const live = TestBed.inject(LiveFixtures);
    expect(await live.poll(NOW)).toBe(15 * 60_000);
    expect(live.byId().size).toBe(0);
  });

  it('fica com a situação e o placar da resposta mais adiantada, mas com os eventos da busca por id', () => {
    const byId = { ...game(1, 'NS', -2), events: [] };
    const listed = { ...game(1, '1H', -2), goals: { home: 0, away: 0 } };
    listed.fixture.status.elapsed = 2;
    const merged = fresher(byId, listed);
    expect(merged.fixture.status.short).toBe('1H');
    expect(merged.goals).toEqual({ home: 0, away: 0 });
    expect(merged.events).toBe(byId.events);
    // Busca por id já mais adiantada (ou igual): fica como está.
    expect(fresher(listed, byId)).toBe(listed);
    expect(fresher(byId, undefined)).toBe(byId);
  });
});
