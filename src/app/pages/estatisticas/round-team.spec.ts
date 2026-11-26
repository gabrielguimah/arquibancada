import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiFootball, RoundPlayer, RoundTeam } from '../../api/api-football';
import { RoundTeamCard } from './round-team';

let nextId = 1;
const player = (rating: number, extra: Partial<RoundPlayer> = {}): RoundPlayer => ({
  player: { id: nextId, name: `Jogador ${nextId++}`, photo: '' },
  team: { id: 1, name: 'Time', logo: '' },
  rating,
  minutes: 90,
  position: 'M',
  goals: 0,
  assists: 0,
  yellowCards: 0,
  redCards: 0,
  result: 'D',
  ...extra,
});

function render(players: RoundPlayer[]) {
  const team: RoundTeam = { round: 'Regular Season - 36', formation: '4-3-3', games: 10, totalGames: 10, players };
  TestBed.configureTestingModule({
    imports: [RoundTeamCard],
    providers: [
      {
        provide: ApiFootball,
        useValue: { rounds: () => of(['Regular Season - 36']), currentRound: () => of('Regular Season - 36'), teamOfRound: () => of(team) },
      },
    ],
  });
  const fixture = TestBed.createComponent(RoundTeamCard);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return {
    stars: () => [...el.querySelectorAll('.spot.best .name')].map((n) => n.textContent?.trim()),
    ratings: () => [...el.querySelectorAll('.spot .rating')].map((r) => r.textContent?.trim()),
  };
}

describe('Melhor da rodada', () => {
  it('desempata pela participação em gols e ignora expulsos', () => {
    const { stars } = render([
      player(8.2),
      player(8.2, { goals: 1 }),
      player(8.2, { goals: 1, assists: 1, redCards: 1 }),
      player(7.9, { goals: 2 }),
    ]);
    expect(stars()).toEqual(['Jogador 2']);
  });

  it('dá a estrela a todos se o empate seguir em todos os critérios', () => {
    const { stars } = render([player(8.5, { result: 'W' }), player(8.5, { result: 'W' }), player(8.5, { result: 'L' })]);
    expect(stars().length).toBe(2);
  });

  it('notas sempre com uma casa, mesmo repetidas; a nota máxima é só "10"', () => {
    const { ratings } = render([player(10), player(8.24), player(8.2), player(7.5)]);
    expect(ratings()).toEqual(['10', '8.2', '8.2', '7.5']);
  });
});

describe('Time da rodada ao vivo', () => {
  afterEach(() => vi.useRealTimers());

  it('com jogo por terminar, confere de novo a cada minuto e mostra o time novo; rodada completa para', () => {
    vi.useFakeTimers();
    const round = 'Regular Season - 36';
    const partial: RoundTeam = { round, formation: '4-3-3', games: 8, totalGames: 10, players: [player(7.5)] };
    const complete: RoundTeam = { ...partial, games: 10, players: [player(9.1)] };
    const teamOfRound = vi.fn().mockReturnValueOnce(of(partial)).mockReturnValueOnce(of(complete));
    TestBed.configureTestingModule({
      imports: [RoundTeamCard],
      providers: [{ provide: ApiFootball, useValue: { rounds: () => of([round]), currentRound: () => of(round), teamOfRound } }],
    });
    const fixture = TestBed.createComponent(RoundTeamCard);
    fixture.detectChanges();
    const ratings = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('.spot .rating')].map((r) => r.textContent?.trim());
    expect(ratings()).toEqual(['7.5']);

    vi.advanceTimersByTime(60_000);
    fixture.detectChanges();
    expect(teamOfRound).toHaveBeenCalledTimes(2);
    expect(ratings()).toEqual(['9.1']);

    // Rodada completa: não busca mais.
    vi.advanceTimersByTime(5 * 60_000);
    expect(teamOfRound).toHaveBeenCalledTimes(2);
  });
});

describe('Rodada que o time da rodada abre', () => {
  function open(teams: Record<string, Pick<RoundTeam, 'games' | 'totalGames'>>, current: string) {
    const rounds = Object.keys(teams);
    TestBed.configureTestingModule({
      imports: [RoundTeamCard],
      providers: [
        {
          provide: ApiFootball,
          useValue: {
            rounds: () => of(rounds),
            currentRound: () => of(current),
            teamOfRound: (round: string) => of({ round, formation: '4-3-3', players: [player(7)], ...teams[round] }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(RoundTeamCard);
    fixture.detectChanges();
    return (fixture.componentInstance as unknown as { round: () => string }).round();
  }

  it('atual completa e a seguinte já com jogo encerrado: abre na seguinte', () => {
    expect(open({ R36: { games: 10, totalGames: 10 }, R37: { games: 1, totalGames: 10 } }, 'R36')).toBe('R37');
  });

  it('atual completa e a seguinte sem jogo encerrado: fica na atual', () => {
    expect(open({ R36: { games: 10, totalGames: 10 }, R37: { games: 0, totalGames: 10 } }, 'R36')).toBe('R36');
  });

  it('atual sem jogo encerrado: abre na anterior', () => {
    expect(open({ R35: { games: 10, totalGames: 10 }, R36: { games: 0, totalGames: 10 } }, 'R36')).toBe('R35');
  });
});
