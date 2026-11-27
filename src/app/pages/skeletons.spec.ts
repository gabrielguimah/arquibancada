import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import { ApiFootball } from '../api/api-football';
import { Jogadores } from './jogadores/jogadores';
import { Campeonato } from './campeonato/campeonato';
import { Times } from './times/times';

/** Motivo da opção Chances bloqueada: o texto que o tooltip liga ao botão (aria-describedby). */
function reason(el: HTMLElement): string | undefined {
  const button = el.querySelectorAll<HTMLElement>('.section-tabs button')[2] ?? el.querySelectorAll<HTMLElement>('.view-switch button')[1];
  const ids = button?.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

// API que nunca responde: as páginas ficam no estado de carregamento.
const pendingApi: Partial<Record<keyof ApiFootball, () => typeof NEVER>> = {
  rounds: () => NEVER,
  currentRound: () => NEVER,
  fixtures: () => NEVER,
  fixturesOn: () => NEVER,
  standings: () => NEVER,
  teamRatings: () => NEVER,
  topScorers: () => NEVER,
  topAssists: () => NEVER,
  topRated: () => NEVER,
  playerStats: () => NEVER,
};

// A página Campeonato tem bloco @defer (a tabela das chances): o TestBed precisa compilar antes (compileComponents).
async function render<T>(component: Type<T>): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideRouter([]), { provide: ApiFootball, useValue: pendingApi }],
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Esqueletos de carregamento', () => {
  it('Classificação: partidas de hoje, rodada e tabela', async () => {
    const el = await render(Campeonato);
    expect(el.querySelector('.hoje[aria-busy="true"] app-fixture-card-skeleton')).toBeTruthy();
    expect(el.querySelectorAll('.skeleton app-fixture-card-skeleton').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.tabela tr.sk-row').length).toBe(20);
    expect(el.querySelector('app-team-ratings')).toBeNull();
    // Troca já na tela e o título do card (Classificação) desde o carregamento; Chances bloqueada, sem cadeado, enquanto carrega.
    expect(el.querySelector('.tabela app-card h2')?.textContent).toContain('Classificação');
    const chances = el.querySelectorAll('.view-switch button')[1];
    expect(chances.getAttribute('aria-disabled')).toBe('true');
    expect(chances.querySelector('.lock')).toBeNull();
    expect(reason(el)).toContain('Carregando');
  });

  it('Times: título e filtros já na tela, tabela em esqueleto', async () => {
    const el = await render(Times);
    expect(el.querySelector('app-team-ratings h1')?.textContent?.trim()).toBe('Times');
    // Botão Filtros já na tela (os seletores de período e mando ficam dentro dele, fechado).
    expect(el.querySelector('app-team-ratings app-filters .collapsible-toggle')).toBeTruthy();
    expect(el.querySelectorAll('app-team-ratings table[aria-busy="true"] .sk-name').length).toBe(20);
  });

  it('Jogadores: os três quadros, o time da rodada e a tabela de jogadores', async () => {
    const el = await render(Jogadores);
    expect(el.querySelectorAll('.board .rows[aria-busy="true"]').length).toBe(3);
    expect(el.querySelectorAll('app-round-team .pitch[aria-busy="true"] .sk-photo').length).toBe(11);
    expect(el.querySelectorAll('app-players-table table[aria-busy="true"] .sk-name').length).toBe(10);
  });
});

describe('Quadros de estatísticas', () => {
  it('a paginação no rodapé troca a página só do quadro clicado', async () => {
    const { of } = await import('rxjs');
    const player = (id: number) => ({
      player: { id, name: `Jogador ${id}`, photo: '' },
      statistics: [{ team: { id: 1, name: 'Time', logo: '' }, games: { appearences: 30, minutes: 2000, rating: null }, goals: { total: 30 - id, assists: 30 - id }, penalty: { scored: 0 } }],
    });
    const players = Array.from({ length: 20 }, (_, i) => player(i + 1));
    TestBed.configureTestingModule({
      imports: [Jogadores],
      providers: [
        provideRouter([]),
        {
          provide: ApiFootball,
          useValue: {
            topScorers: () => of(players),
            topAssists: () => of(players),
            topRated: () => NEVER,
            playerStats: () => NEVER,
            rounds: () => NEVER,
            currentRound: () => NEVER,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(Jogadores);
    fixture.detectChanges();
    const boards = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('.board')] as HTMLElement[];
    const ranks = (board: HTMLElement) => [...board.querySelectorAll('.rank')].map((r) => r.textContent?.trim());
    (boards()[0].querySelector('app-pager [aria-label="Página 2"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // 20 jogadores, 10 por página.
    expect(ranks(boards()[0])[0]).toBe('11');
    expect(ranks(boards()[0]).length).toBe(10);
    expect(ranks(boards()[1])[0]).toBe('1');
  });
});

describe('Jogadores no celular', () => {
  it('abas dos quadros: começa em Artilheiros; cada aba mostra o seu quadro (com o título dele)', async () => {
    const el = await render(Jogadores);
    const page = () => el.querySelector('.page')!;
    const tabs = () => [...el.querySelectorAll<HTMLButtonElement>('.section-tabs button')];
    // Ícones (o nome no aria-label) e, na última, o nome.
    const name = (t: HTMLElement) => t.getAttribute('aria-label') ?? t.textContent?.trim();
    expect(tabs().map(name)).toEqual(['Artilheiros', 'Assistências', 'Time da rodada', 'Melhores notas', 'Estatísticas']);
    expect(tabs().slice(0, 4).every((t) => t.querySelector('mat-icon'))).toBe(true);
    expect(page().getAttribute('data-section')).toBe('scorers');
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');

    tabs()[3].click();
    TestBed.tick();
    expect(page().getAttribute('data-section')).toBe('rated');
    expect(tabs()[3].getAttribute('aria-selected')).toBe('true');
    // Os títulos dos quadros continuam lá.
    expect(el.querySelector('.area-rated h2')?.textContent).toContain('Melhores notas');

    // Filtro do celular: dentro do botão Filtros (com o escolhido no resumo), no padrão dos seletores.
    const toggle = el.querySelector<HTMLButtonElement>('.area-filter .collapsible-toggle')!;
    expect(toggle.querySelector('.filters-summary')?.textContent?.trim()).toBe('Regulares · Total');
    expect(el.querySelector('.area-filter .view-switch')).toBeNull();
    toggle.click();
    TestBed.tick();
    const groups = [...el.querySelectorAll('.area-filter .view-switch')];
    expect(groups.length).toBe(2);
    const options = [...groups[0].querySelectorAll<HTMLButtonElement>('button')];
    expect(options.map((b) => b.textContent?.replace('info', '').trim())).toEqual(['Regulares', 'Todos os jogadores']);
    options[1].click();
    TestBed.tick();
    expect(toggle.querySelector('.filters-summary')?.textContent?.trim()).toBe('Todos os jogadores · Total');
    // O acumulado (antes dentro da tabela) também fica nos filtros.
    const modes = [...groups[1].querySelectorAll<HTMLButtonElement>('button')];
    modes[1].click();
    TestBed.tick();
    expect(toggle.querySelector('.filters-summary')?.textContent?.trim()).toBe(`Todos os jogadores · ${modes[1].textContent?.trim()}`);
  });
});

describe('Seletor de rodada em esqueleto', () => {
  it('fica em esqueleto enquanto as partidas (ou o time da rodada) carregam, mesmo com as rodadas prontas', async () => {
    const { of } = await import('rxjs');
    const rounds = () => of(['Regular Season - 1']);
    const current = () => of('Regular Season - 1');
    TestBed.configureTestingModule({
      imports: [Campeonato, Jogadores],
      providers: [
        provideRouter([]),
        { provide: ApiFootball, useValue: { ...pendingApi, rounds, currentRound: current, teamOfRound: () => NEVER } },
      ],
    });
    await TestBed.compileComponents();
    for (const component of [Campeonato, Jogadores] as const) {
      const fixture = TestBed.createComponent(component as Type<unknown>);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const nav = component === Campeonato ? el.querySelector('.jogos')! : el.querySelector('app-round-team')!;
      expect(nav.querySelector('.round-nav .sk-nav-select')).toBeTruthy();
      expect(nav.querySelector('mat-select')).toBeNull();
    }
  });
});
