import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiFootball, PlayerRow, PlayerStats } from '../../api/api-football';
import { columnValue, formatValue, PLAYER_TABS } from './player-columns';
import { PAGE_SIZE, PlayersTable } from './players-table';

function player(id: number, over: Partial<PlayerRow> = {}): PlayerRow {
  return {
    id,
    name: `Jogador ${String(id).padStart(2, '0')}`,
    photo: '',
    team: { id: 1, name: 'Time', logo: '' },
    position: 'M',
    appearances: 20,
    minutes: 1800,
    rating: 7,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOn: 0,
    passes: 0,
    keyPasses: 0,
    passAccuracy: null,
    tackles: 0,
    interceptions: 0,
    blocks: 0,
    duels: 0,
    duelsWon: 0,
    dribbles: 0,
    dribblesWon: 0,
    foulsDrawn: 0,
    foulsCommitted: 0,
    yellowCards: 0,
    redCards: 0,
    penaltiesScored: 0,
    penaltiesMissed: 0,
    penaltiesWon: 0,
    penaltiesCommitted: 0,
    saves: 0,
    goalsConceded: 0,
    penaltiesSaved: 0,
    ...over,
  };
}

// 30 regulares com notas de 6.00 a 8.90; um reserva (2 jogos) com a maior nota; um goleiro.
const players: PlayerRow[] = [
  ...Array.from({ length: 30 }, (_, i) => player(i + 1, { rating: 6 + i * 0.1, goals: i % 7 })),
  player(98, { appearances: 2, minutes: 90, rating: 9.5, goals: 1 }),
  player(99, { position: 'G', saves: 80, goalsConceded: 20, rating: 7.2 }),
];
const data: PlayerStats = { updatedAt: '', minAppearances: 10, players };

function render() {
  TestBed.configureTestingModule({
    imports: [PlayersTable],
    providers: [{ provide: ApiFootball, useValue: { playerStats: () => of(data) } }],
  });
  const fixture = TestBed.createComponent(PlayersTable);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const names = () => [...el.querySelectorAll('tbody td.name .text')].map((td) => td.textContent?.trim());
  const ranks = () => [...el.querySelectorAll('tbody td.rank')].map((td) => td.textContent?.trim());
  const click = (selector: string) => {
    (el.querySelector(selector) as HTMLElement).click();
    fixture.detectChanges();
  };
  return { fixture, el, names, ranks, click };
}

describe('Tabela de jogadores', () => {
  it('abre em Geral, só regulares, pela nota, 10 por página com paginação embaixo', () => {
    const { el, names, ranks } = render();
    expect(names().length).toBe(PAGE_SIZE);
    // O reserva com 9.50 fica de fora; o primeiro é o regular de nota mais alta.
    expect(names()[0]).toBe('Jogador 30');
    expect(ranks()[0]).toBe('1');
    // 30 regulares + o goleiro = 31 linhas, 4 páginas.
    expect([...el.querySelectorAll('app-pager .number')].map((b) => b.textContent?.trim())).toEqual(['1', '2', '3', '4']);
  });

  it('sem o filtro de regulares (vem da página), inclui quem jogou pouco e volta à primeira página', () => {
    const { fixture, names, ranks, click } = render();
    click('app-pager [aria-label="Próxima página"]');
    fixture.componentRef.setInput('regulars', false);
    fixture.detectChanges();
    expect(names()[0]).toBe('Jogador 98');
    expect(ranks()[0]).toBe('1');
  });

  it('a próxima página continua a numeração', () => {
    const { ranks, click } = render();
    click('app-pager [aria-label="Próxima página"]');
    expect(ranks()[0]).toBe('11');
    expect(ranks().length).toBe(10);
  });

  it('clicar no cabeçalho ordena pela coluna; de novo, inverte', () => {
    const { el, names, click } = render();
    click('[role="tab"]:nth-child(2)'); // Ataque, pelos gols
    const goalsHeader = () => el.querySelector('thead th.sorted') as HTMLElement;
    expect(goalsHeader().textContent).toContain('Gols');
    expect(goalsHeader().getAttribute('aria-sort')).toBe('descending');
    // Mais gols (6); empate desempatado pela nota.
    expect(names()[0]).toBe('Jogador 28');

    click('thead th.sorted button');
    expect(goalsHeader().getAttribute('aria-sort')).toBe('ascending');
    expect(names()[0]).toBe('Jogador 29');
  });

  it('a aba Goleiro mostra só goleiros', () => {
    const { names, click } = render();
    click('[role="tab"]:nth-child(5)');
    expect(names()).toEqual(['Jogador 99']);
  });
});

describe('Colunas da tabela de jogadores', () => {
  const goals = PLAYER_TABS[1].columns.find((c) => c.id === 'goals')!;
  const accuracy = PLAYER_TABS[3].columns.find((c) => c.id === 'passAccuracy')!;
  const p = player(1, { goals: 9, appearances: 18, minutes: 1350, passAccuracy: 84 });

  it('divide as contagens por jogo e por 90 minutos', () => {
    expect(columnValue(goals, p, 'total')).toBe(9);
    expect(formatValue(goals, columnValue(goals, p, 'game'), 'game')).toBe('0,50');
    expect(formatValue(goals, columnValue(goals, p, 'p90'), 'p90')).toBe('0,60');
  });

  it('porcentagens não mudam com o modo', () => {
    expect(formatValue(accuracy, columnValue(accuracy, p, 'p90'), 'p90')).toBe('84%');
  });
});
