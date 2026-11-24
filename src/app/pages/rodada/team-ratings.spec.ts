import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiFootball, TeamRating, TeamRatings } from '../../api/api-football';
import { TeamRatingsTables } from './team-ratings';

// 20 times; o 4º e o 5º empatados em 6.88.
const rows: TeamRating[] = Array.from({ length: 20 }, (_, i) => ({
  team: { id: i + 1, name: `Time ${i + 1}`, logo: '' },
  rating: i === 4 ? 6.88 : 7 - i * 0.03,
  stats: { goalsFor: 20 - i } as TeamRating['stats'],
}));
rows[3].rating = 6.88;
const data: TeamRatings = { updatedAt: '', season: rows, last5: rows };

function render() {
  TestBed.configureTestingModule({
    imports: [TeamRatingsTables],
    providers: [{ provide: ApiFootball, useValue: { teamRatings: () => of(data) } }],
  });
  const fixture = TestBed.createComponent(TeamRatingsTables);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const firstTable = () => el.querySelector('.table-card') as HTMLElement;
  const ranks = () => [...firstTable().querySelectorAll('.rank')].map((r) => r.textContent?.trim());
  return { fixture, el, firstTable, ranks };
}

describe('Tabelas de times', () => {
  it('numera todas as posições, mesmo com empate', () => {
    const { ranks } = render();
    expect(ranks()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('pagina no rodapé: as setas e os números trocam a página só da tabela clicada', () => {
    const { fixture, el, firstTable, ranks } = render();
    const pager = () => firstTable().querySelector('app-pager') as HTMLElement;
    const click = (label: string) => {
      (pager().querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
      fixture.detectChanges();
    };

    // 20 times, 5 por página.
    expect([...pager().querySelectorAll('.number')].map((b) => b.textContent?.trim())).toEqual(['1', '2', '3', '4']);
    click('Próxima página');
    expect(ranks()).toEqual(['6', '7', '8', '9', '10']);
    click('Página 4');
    expect(ranks()).toEqual(['16', '17', '18', '19', '20']);
    expect((pager().querySelector('[aria-label="Próxima página"]') as HTMLButtonElement).disabled).toBe(true);

    // A outra tabela continua na primeira página.
    const other = el.querySelectorAll('.table-card')[1] as HTMLElement;
    expect([...other.querySelectorAll('.rank')].map((r) => r.textContent?.trim())).toEqual(['1', '2', '3', '4', '5']);
  });
});
