import { TestBed } from '@angular/core/testing';
import { ChanceRow, SeasonChances, UpcomingGame } from './season-chances';

const team = (id: number) => ({ id, name: `Time ${id}`, logo: '' });
const games = (n: number): UpcomingGame[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, opponent: team(100 + i), home: i % 2 === 0, date: `${10 + (i % 18)}/04`, live: null }));
const row = (id: number, upcoming: UpcomingGame[]): ChanceRow => ({
  team: team(id),
  rank: id,
  points: 0,
  upcoming,
  chances: { title: 0.5, libertadores: 0.9, sulamericana: 0.1, relegation: 0 },
});

function render(rows: ChanceRow[]) {
  const fixture = TestBed.createComponent(SeasonChances);
  fixture.componentRef.setInput('rows', rows);
  fixture.detectChanges();
  return fixture;
}

describe('SeasonChances', () => {
  it('até 5 jogos: todos na linha, sem "+N"', () => {
    const el = render([row(1, games(2))]).nativeElement as HTMLElement;
    expect(el.querySelectorAll('td.jogos .game').length).toBe(2);
    expect(el.querySelector('.more')).toBeNull();
    expect(el.querySelector('th.jogos')?.textContent?.trim()).toBe('Próximos jogos');
  });

  it('começo do campeonato: 5 próximos jogos e o resto no "+N", com a lista ao passar o mouse', () => {
    const fixture = render([row(1, games(38))]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('td.jogos .game').length).toBe(5);
    const more = el.querySelector<HTMLElement>('.more')!;
    expect(more.textContent?.trim()).toBe('+33');
    expect(el.querySelector('th.jogos')?.textContent?.trim()).toBe('Próximos jogos');

    more.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    const items = el.querySelectorAll('.games-tip li');
    expect(items.length).toBe(33);
    // O 6º jogo (índice 5) é fora de casa.
    expect(items[0].querySelector('.where')?.textContent?.trim()).toBe('F');

    more.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    expect(el.querySelector('.games-tip')).toBeNull();
  });

  it('time jogando agora: bolinha ao vivo ao lado do nome', () => {
    const live: UpcomingGame = { id: 99, opponent: team(200), home: true, date: '26/11', live: '1-0' };
    const el = render([row(1, [live, ...games(1)]), row(2, games(2))]).nativeElement as HTMLElement;
    const dots = [...el.querySelectorAll('tbody tr')].map((tr) => !!tr.querySelector('.clube .live-dot'));
    expect(dots).toEqual([true, false]);
  });
});
