import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, Observable, of } from 'rxjs';
import { ApiFootball, Fixture, Standing } from '../../api/api-football';
import { Rodada } from './rodada';

const ROUND = 'Regular Season - 37';

/** Classificação de 20 times, todos com `played` jogos. */
function table(played: number): Standing[] {
  return Array.from({ length: 20 }, (_, i) => ({
    rank: i + 1,
    team: { id: i + 1, name: `Time ${i + 1}`, logo: '' },
    points: 60 - i * 2,
    goalsDiff: 10 - i,
    form: null,
    description: null,
    all: { played, win: 15 - i, draw: 5, lose: i, goals: { for: 50 - i, against: 40 + i } },
  }));
}

/** Jogo ainda não iniciado entre os times `home` e `away`. */
function upcoming(home: number, away: number): Fixture {
  return {
    fixture: { id: home * 100 + away, date: '2026-12-06T19:00:00-03:00', timestamp: 1_796_594_400, status: { short: 'NS', long: '', elapsed: null } },
    league: { round: 'Regular Season - 38' },
    teams: { home: { id: home, name: `Time ${home}`, logo: '' }, away: { id: away, name: `Time ${away}`, logo: '' } },
    goals: { home: null, away: null },
  } as unknown as Fixture;
}

// A Rodada tem bloco @defer (a tabela das chances): o TestBed precisa compilar antes (compileComponents).
async function render(standings: Standing[], remaining: Observable<Fixture[]>) {
  const empty = () => of([]);
  TestBed.configureTestingModule({
    imports: [Rodada],
    providers: [
      provideRouter([]),
      {
        provide: ApiFootball,
        useValue: {
          rounds: () => of([ROUND]),
          currentRound: () => of(ROUND),
          fixtures: empty,
          fixturesOn: empty,
          fixturesByIds: empty,
          finishedFixtures: empty,
          standings: () => of(standings),
          remainingFixtures: () => remaining,
        },
      },
    ],
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(Rodada);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const chances = () => el.querySelectorAll<HTMLButtonElement>('.view-switch button')[1];
  return { fixture, el, chances };
}

describe('Classificação: opção Chances', () => {
  it('começo da temporada (menos de 5 jogos): cadeado e o motivo', async () => {
    const { chances, el } = await render(table(3), of([upcoming(1, 2)]));
    expect(chances().getAttribute('aria-disabled')).toBe('true');
    expect(chances().querySelector('.lock')).toBeTruthy();
    expect(el.querySelector('#chances-motivo')?.textContent).toContain('depois que os times disputarem 5 jogos');
  });

  it('campeonato encerrado (nenhum jogo pela frente): cadeado e o motivo', async () => {
    const { chances, el } = await render(table(38), of([]));
    expect(chances().querySelector('.lock')).toBeTruthy();
    expect(el.querySelector('#chances-motivo')?.textContent).toContain('Campeonato encerrado');
  });

  it('carregando: bloqueada, mas sem cadeado', async () => {
    const { chances, el } = await render(table(36), NEVER);
    expect(chances().getAttribute('aria-disabled')).toBe('true');
    expect(chances().querySelector('.lock')).toBeNull();
    expect(el.querySelector('#chances-motivo')?.textContent).toContain('Carregando');
  });

  it('bloqueada: o toque mostra o tooltip com o motivo e não troca a grade', async () => {
    const { fixture, chances, el } = await render(table(3), of([upcoming(1, 2)]));
    chances().click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.querySelector('.mat-mdc-tooltip')?.textContent).toContain('depois que os times disputarem 5 jogos');
    expect(el.querySelector('#tabela-titulo')?.textContent?.trim()).toBe('Classificação');
    expect(el.querySelector('app-season-chances')).toBeNull();
  });

  it('liberada: sem cadeado, e o clique mostra as chances', async () => {
    const { fixture, chances, el } = await render(table(36), of([upcoming(1, 2), upcoming(3, 4)]));
    expect(chances().getAttribute('aria-disabled')).toBeNull();
    expect(chances().querySelector('.lock')).toBeNull();
    chances().click();
    fixture.detectChanges();
    // A tabela das chances é carregada à parte (@defer): espera chegar.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('app-season-chances')).toBeTruthy();
    expect(el.querySelector('#tabela-titulo')?.textContent?.trim()).toBe('Chances');
  });

  it('abas do celular: começa em Jogos; Classificação e Chances trocam a grade', async () => {
    const { fixture, el } = await render(table(36), of([upcoming(1, 2), upcoming(3, 4)]));
    const layout = () => el.querySelector('.layout')!;
    const tabs = () => [...el.querySelectorAll<HTMLButtonElement>('.section-tabs button')];
    const click = (b: HTMLElement) => {
      b.click();
      fixture.detectChanges();
    };
    expect(tabs().map((t) => t.textContent?.trim())).toEqual(['Jogos', 'Classificação', 'Chances']);
    expect(layout().getAttribute('data-section')).toBe('jogos');

    click(tabs()[2]);
    expect(layout().getAttribute('data-section')).toBe('chances');
    expect(el.querySelector('app-season-chances')).toBeTruthy();

    click(tabs()[1]);
    expect(layout().getAttribute('data-section')).toBe('tabela');
    expect(el.querySelector('app-season-chances')).toBeNull();
  });

  it('aba Chances bloqueada no celular: cadeado, e o toque não troca de aba', async () => {
    const { fixture, el } = await render(table(3), of([upcoming(1, 2)]));
    const chancesTab = el.querySelectorAll<HTMLButtonElement>('.section-tabs button')[2];
    expect(chancesTab.getAttribute('aria-disabled')).toBe('true');
    expect(chancesTab.querySelector('.lock')).toBeTruthy();
    chancesTab.click();
    fixture.detectChanges();
    expect(el.querySelector('.layout')?.getAttribute('data-section')).toBe('jogos');
  });
});
