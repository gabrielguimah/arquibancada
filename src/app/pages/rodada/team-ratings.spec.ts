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

  it('"Ver mais" liga a rolagem sem aumentar a tabela, e rolar carrega mais linhas', () => {
    const { fixture, firstTable, ranks } = render();
    const button = firstTable().querySelector('button.more') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Ver mais');

    button.click();
    fixture.detectChanges();
    const list = firstTable().querySelector('.rows') as HTMLElement;
    expect(list.classList).toContain('scroll');
    expect(ranks().length).toBe(10);
    // A outra tabela não muda.
    const other = fixture.nativeElement.querySelectorAll('.table-card')[1] as HTMLElement;
    expect(other.querySelectorAll('.rank').length).toBe(5);
    expect((other.querySelector('.rows') as HTMLElement).classList).not.toContain('scroll');
    expect(button.textContent?.trim()).toBe('Ver menos');

    // Sem layout no jsdom, a lista está sempre "no fim": cada rolagem carrega mais um bloco.
    list.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(ranks().length).toBe(15);

    button.click();
    fixture.detectChanges();
    expect(ranks().length).toBe(5);
    expect((firstTable().querySelector('.rows') as HTMLElement).classList).not.toContain('scroll');
  });
});
