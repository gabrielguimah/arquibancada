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

  it('mostra duas casas quando a nota com uma casa se repete', () => {
    const { ratings } = render([player(8.24), player(8.2), player(7.5)]);
    expect(ratings()).toEqual(['8.24', '8.20', '7.5']);
  });
});
