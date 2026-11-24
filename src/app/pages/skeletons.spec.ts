import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import { ApiFootball } from '../api/api-football';
import { Estatisticas } from './estatisticas/estatisticas';
import { Rodada } from './rodada/rodada';

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

function render<T>(component: Type<T>): HTMLElement {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideRouter([]), { provide: ApiFootball, useValue: pendingApi }],
  });
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Esqueletos de carregamento', () => {
  it('Classificação: partidas de hoje, rodada, tabela e notas dos times', () => {
    const el = render(Rodada);
    expect(el.querySelector('.hoje[aria-busy="true"] app-fixture-card-skeleton')).toBeTruthy();
    expect(el.querySelectorAll('.skeleton app-fixture-card-skeleton').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.tabela tr.sk-row').length).toBe(20);
    expect(el.querySelectorAll('app-team-ratings .rows[aria-busy="true"] .sk').length).toBeGreaterThan(0);
  });

  it('Estatísticas: os três quadros, o time da rodada e a tabela de jogadores', () => {
    const el = render(Estatisticas);
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
      imports: [Estatisticas],
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
    const fixture = TestBed.createComponent(Estatisticas);
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

describe('Seletor de rodada em esqueleto', () => {
  it('fica em esqueleto enquanto as partidas (ou o time da rodada) carregam, mesmo com as rodadas prontas', async () => {
    const { of } = await import('rxjs');
    const rounds = () => of(['Regular Season - 1']);
    const current = () => of('Regular Season - 1');
    TestBed.configureTestingModule({
      imports: [Rodada, Estatisticas],
      providers: [
        provideRouter([]),
        { provide: ApiFootball, useValue: { ...pendingApi, rounds, currentRound: current, teamOfRound: () => NEVER } },
      ],
    });
    for (const component of [Rodada, Estatisticas] as const) {
      const fixture = TestBed.createComponent(component as Type<unknown>);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const nav = component === Rodada ? el.querySelector('.jogos')! : el.querySelector('app-round-team')!;
      expect(nav.querySelector('.round-nav .sk-nav-select')).toBeTruthy();
      expect(nav.querySelector('mat-select')).toBeNull();
    }
  });
});
