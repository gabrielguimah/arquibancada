import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiFootball, Fixture } from '../api/api-football';
import { LiveFixtures } from './live-fixtures';

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

  it('sem jogo para acompanhar, espera até 5 min antes do próximo início', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: ApiFootball, useValue: { fixturesOn: () => of([game(1, 'NS', 20)]), fixturesByIds: () => of([]) } }],
    });
    const live = TestBed.inject(LiveFixtures);
    expect(await live.poll(NOW)).toBe(15 * 60_000);
    expect(live.byId().size).toBe(0);
  });
});
