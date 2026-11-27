import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiFootball, TeamRating, TeamRatings } from '../../api/api-football';
import { FavoriteTeam } from '../../shared/favorite-team';
import { TeamRatingsTables } from './team-ratings';

// 20 times: nota caindo 0,03 por time, gols subindo, sofridos variando; o 4º e o 5º empatados em 6.88.
const rows: TeamRating[] = Array.from({ length: 20 }, (_, i) => ({
  team: { id: i + 1, name: `Time ${i + 1}`, logo: '' },
  rating: i === 4 ? 6.88 : 7 - i * 0.03,
  games: 36,
  stats: { goalsFor: 20 + i, goalsAgainst: 40 - (i % 7), yellowCards: 60 + i, redCards: i % 3 } as TeamRating['stats'],
}));
rows[3].rating = 6.88;
// Últimas 5: outra ordem (o último da temporada é o melhor agora).
const last5: TeamRating[] = rows.map((r, i) => ({ ...r, games: 5, rating: 6 + i * 0.05 }));
// Em casa: Time 10 tem a melhor nota; fora: Time 15.
const venue = (best: number): TeamRating[] => rows.map((r) => ({ ...r, games: 18, rating: r.team.id === best ? 7.5 : 6.5 }));
const data: TeamRatings = {
  updatedAt: '',
  season: rows,
  last5,
  home: { season: venue(10), last5: venue(10) },
  away: { season: venue(15), last5: venue(15) },
};

function render(favorite: number | null = null) {
  localStorage.clear();
  TestBed.configureTestingModule({
    imports: [TeamRatingsTables],
    providers: [{ provide: ApiFootball, useValue: { teamRatings: () => of(data) } }],
  });
  if (favorite) TestBed.inject(FavoriteTeam).set({ id: favorite, name: `Time ${favorite}`, logo: '' });
  const fixture = TestBed.createComponent(TeamRatingsTables);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const names = () => [...el.querySelectorAll('tbody .team .text')].map((n) => n.textContent?.trim());
  const ranks = () => [...el.querySelectorAll('tbody .rank')].map((r) => r.textContent?.trim());
  const header = (label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('thead .stat button')].find((b) => b.textContent?.includes(label))!;
  const click = (b: HTMLElement) => {
    b.click();
    fixture.detectChanges();
  };
  /** Abre o botão Filtros (os seletores de período e mando começam escondidos). */
  const openFilters = () => click(el.querySelector<HTMLButtonElement>('app-filters .collapsible-toggle')!);
  return { el, names, ranks, header, click, openFilters };
}

describe('Tabela de times', () => {
  it('uma tabela só, com os 20 times e uma coluna por estatística, pela nota média', () => {
    const { el, names, ranks } = render();
    expect(el.querySelectorAll('table').length).toBe(1);
    expect(ranks()).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    expect(names().slice(0, 3)).toEqual(['Time 1', 'Time 2', 'Time 3']);
    expect([...el.querySelectorAll('thead .stat')].map((h) => h.textContent?.replace(/[▲▼]/g, '').trim())).toEqual([
      'Jogos',
      'Gols',
      'Sofridos',
      'Sem sofrer',
      'Posse',
      'Nota',
    ]);
    expect(el.querySelector('thead .sorted')?.textContent).toContain('Nota');
  });

  it('clicar no título ordena pela coluna; de novo, inverte', () => {
    const { names, header, click } = render();
    click(header('Gols'));
    expect(names()[0]).toBe('Time 20');
    click(header('Gols'));
    expect(names()[0]).toBe('Time 1');
  });

  it('menor é melhor (gols sofridos): a primeira ordenação é crescente', () => {
    const { names, header, click, el } = render();
    click(header('Sofridos'));
    // Sofridos 34 (i % 7 === 6): Time 7 e Time 14; empate pela nota média (Time 7 tem nota maior).
    expect(names().slice(0, 2)).toEqual(['Time 7', 'Time 14']);
    expect(el.querySelector('thead .sorted')?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('abas por categoria: cada uma com as suas colunas, ordenada pela principal', () => {
    const { el, click } = render();
    const tabs = () => [...el.querySelectorAll<HTMLButtonElement>('.tabs button')];
    const headers = () => [...el.querySelectorAll('thead .stat')].map((h) => h.textContent?.replace(/[▲▼]/g, '').trim());
    expect(tabs().map((t) => t.textContent?.trim())).toEqual(['Geral', 'Ataque', 'Defesa', 'Passe', 'Disciplina']);
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');

    click(tabs()[4]);
    expect(tabs()[4].getAttribute('aria-selected')).toBe('true');
    expect(headers()).toEqual(['Faltas', 'Amarelos', 'Vermelhos', 'Pên. contra', 'Nota']);
    // Cartões: menos é melhor, começa crescente.
    expect(el.querySelector('thead .sorted')?.textContent).toContain('Amarelos');
    expect(el.querySelector('thead .sorted')?.getAttribute('aria-sort')).toBe('ascending');

    click(tabs()[1]);
    expect(headers()[0]).toBe('Gols');
    expect(el.querySelector('thead .sorted')?.getAttribute('aria-sort')).toBe('descending');
  });

  it('filtros: fechados por padrão, com o que está escolhido no botão; abertos, os seletores', () => {
    const { el, click, openFilters } = render();
    const toggle = el.querySelector<HTMLButtonElement>('app-filters .collapsible-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('.filters-summary')?.textContent?.trim()).toBe('Temporada · Todos');
    expect(el.querySelector('.view-switch')).toBeNull();

    openFilters();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('.toolbar .view-switch').length).toBe(2);
    click(el.querySelectorAll<HTMLButtonElement>('[aria-label="Mando de campo"] button')[2]);
    expect(toggle.querySelector('.filters-summary')?.textContent?.trim()).toBe('Temporada · Fora');
  });

  it('o seletor troca para as últimas 5 partidas', () => {
    const { el, names, click, openFilters } = render();
    openFilters();
    const [season, recent] = [...el.querySelectorAll<HTMLButtonElement>('.view-switch button')];
    expect(season.getAttribute('aria-selected')).toBe('true');
    click(recent);
    expect(recent.getAttribute('aria-selected')).toBe('true');
    expect(names()[0]).toBe('Time 20');
    expect(el.querySelector('tbody .stat')?.textContent?.trim()).toBe('5');
  });

  it('sem time do coração: convite para escolher', () => {
    const { el } = render();
    expect(el.querySelector('.side-card .side-button')?.textContent?.trim()).toBe('Escolher time');
    expect(el.querySelector('.fav-ranks')).toBeNull();
  });

  it('time do coração: a posição dele em cada estatística (1º = melhor, também onde menor é melhor)', () => {
    const { el } = render(1);
    const rank = (label: string) =>
      [...el.querySelectorAll('.fav-ranks li')].find((li) => li.querySelector('.fav-label')?.textContent?.trim() === label);
    // Time 1: melhor nota, menos gols marcados (20) e 40 sofridos (o maior, junto com Time 8 e Time 15).
    expect(rank('Nota média')?.querySelector('.fav-rank')?.textContent?.trim()).toBe('1º');
    expect(rank('Nota média')?.querySelector('.fav-rank')?.classList).toContain('first');
    expect(rank('Gols marcados')?.querySelector('.fav-rank')?.textContent?.trim()).toBe('20º');
    expect(rank('Gols marcados')?.querySelector('.fav-rank')?.classList).toContain('bottom');
    expect(rank('Menos gols sofridos')?.querySelector('.fav-rank')?.textContent?.trim()).toBe('18º');
    // Menos amarelos: Time 1 (60) é o 1º. Vermelhos: 0 para Time 1, 4, 7… (empatados no 1º).
    expect(rank('Menos cartões amarelos')?.querySelector('.fav-rank')?.textContent?.trim()).toBe('1º');
    expect(rank('Menos cartões vermelhos')?.querySelector('.fav-rank')?.textContent?.trim()).toBe('1º');
  });

  it('destaques: o líder de cada categoria; o clique abre a aba ordenada por ela', () => {
    const { el, click } = render();
    const items = () => [...el.querySelectorAll<HTMLButtonElement>('.highlights button')];
    const attack = items().find((b) => b.textContent?.includes('Melhor ataque'))!;
    expect(attack.textContent).toContain('Time 20');
    const defense = items().find((b) => b.textContent?.includes('Melhor defesa'))!;
    // Menos gols sofridos (34): Time 7 e Time 14; desempate pela nota (Time 7).
    expect(defense.textContent).toContain('Time 7');

    click(defense);
    expect(el.querySelector('.tabs button[aria-selected="true"]')?.textContent?.trim()).toBe('Defesa');
    expect(el.querySelector('thead .sorted')?.textContent).toContain('Sofridos');
    expect(el.querySelector('thead .sorted')?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('o seletor de mando mostra só os jogos em casa ou só os fora (tabela, destaques e o resumo)', () => {
    const { el, names, click, openFilters } = render();
    openFilters();
    const venues = () => [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Mando de campo"] button')];
    // Nome de cada opção (sem o nome do ícone: casa e avião).
    expect(venues().map((b) => b.textContent?.replace(/home|flight/, '').trim())).toEqual(['Todos', 'Casa', 'Fora']);
    expect(venues().map((b) => b.querySelector('mat-icon')?.textContent?.trim() ?? null)).toEqual([null, 'home', 'flight']);
    expect(venues()[0].getAttribute('aria-selected')).toBe('true');

    click(venues()[1]);
    expect(names()[0]).toBe('Time 10');
    expect(el.querySelector('tbody .stat')?.textContent?.trim()).toBe('18');
    expect(el.querySelector('.highlights button')?.textContent).toContain('Time 10');
    expect(el.querySelector('.highlights-card .subtitle')?.textContent).toContain('em casa');

    click(venues()[2]);
    expect(names()[0]).toBe('Time 15');
  });

  it('abas Estatísticas / Resumo (celular): começa na tabela; clicar num destaque volta para ela', () => {
    const { el, click } = render();
    const layout = () => el.querySelector('.layout')!;
    const [table, summary] = [...el.querySelectorAll<HTMLButtonElement>('.section-tabs button')];
    expect([table.textContent?.trim(), summary.textContent?.trim()]).toEqual(['Estatísticas', 'Resumo']);
    expect(layout().getAttribute('data-section')).toBe('tabela');

    click(summary);
    expect(layout().getAttribute('data-section')).toBe('resumo');
    expect(summary.getAttribute('aria-selected')).toBe('true');

    click(el.querySelector<HTMLButtonElement>('.highlights button')!);
    expect(layout().getAttribute('data-section')).toBe('tabela');
  });
});
