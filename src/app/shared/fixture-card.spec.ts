import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Fixture } from '../api/api-football';
import { FixtureCard } from './fixture-card';

function fixture(short: string, elapsed: number | null, goals: [number | null, number | null]): Fixture {
  return {
    fixture: {
      id: 1,
      date: '2026-11-23T22:30:00+00:00',
      timestamp: 1795473000,
      venue: { name: 'Estádio Beira-Rio', city: 'Porto Alegre' },
      status: { long: '', short, elapsed, extra: null },
    },
    teams: {
      home: { id: 119, name: 'Internacional', logo: '', winner: null },
      away: { id: 136, name: 'Vitoria', logo: '', winner: null },
    },
    goals: { home: goals[0], away: goals[1] },
  };
}

function render(f: Fixture): HTMLElement {
  const ref = TestBed.createComponent(FixtureCard);
  ref.componentRef.setInput('fixture', f);
  ref.detectChanges();
  return ref.nativeElement as HTMLElement;
}

describe('FixtureCard', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('o card é um link para a página da partida', () => {
    const f = fixture('NS', null, [null, null]);
    f.fixture.id = 1492463;
    expect(render(f).querySelector('a.card')?.getAttribute('href')).toBe('/partida/1492463');
  });

  it('mostra a bolinha ao vivo e o relógio no lugar do horário, sem nome do período', () => {
    const el = render(fixture('2H', 67, [1, 0]));
    expect(el.querySelector('.live-dot')).toBeTruthy();
    expect(el.querySelector('.state')?.textContent?.trim()).toBe('');
    // Minuto 67 = de 66:00 a 66:59 de jogo; os segundos começam do zero quando o minuto chega.
    expect(el.querySelector('.clock')?.textContent?.trim()).toBe('66:00');
    expect(el.querySelector('time')).toBeNull();
  });

  it('nos acréscimos, mostra o fim do tempo mais o acréscimo', () => {
    const f = fixture('1H', 45, [0, 0]);
    f.fixture.status.extra = 5;
    f.fixture.id = 2;
    expect(render(f).querySelector('.clock')?.textContent?.trim()).toBe("45'+5");
  });

  it('no intervalo, mostra "Intervalo" no lugar do horário de início', () => {
    const f = fixture('HT', 45, [1, 0]);
    f.fixture.id = 4;
    const el = render(f);
    expect(el.querySelector('.clock')?.textContent?.trim()).toBe('Intervalo');
    expect(el.querySelector('time')).toBeNull();
    expect(el.querySelector('.live-dot')).toBeTruthy();
    expect(el.querySelector('.state')?.textContent?.trim()).toBe('');
  });

  it('mostra um cartão vermelho por expulsão, ao lado do time', () => {
    const f = fixture('2H', 70, [0, 0]);
    f.fixture.id = 3;
    const card = (team: 'home' | 'away', detail: string) => ({
      time: { elapsed: 60, extra: null },
      team: f.teams[team],
      player: { id: 1, name: 'Jogador' },
      assist: { id: null, name: null },
      type: 'Card',
      detail,
    });
    f.events = [card('home', 'Red Card'), card('away', 'Second Yellow card'), card('away', 'Red Card'), card('home', 'Yellow Card')];
    const teams = [...render(f).querySelectorAll('.team')];
    expect(teams.map((t) => t.querySelectorAll('.red-card').length)).toEqual([1, 2]);
  });

  it('não mostra a bolinha em jogo encerrado nem antes do início', () => {
    expect(render(fixture('FT', 90, [1, 0])).querySelector('.live-dot')).toBeNull();
    const ns = render(fixture('NS', null, [null, null]));
    expect(ns.querySelector('.live-dot')).toBeNull();
    expect(ns.querySelector('time')?.textContent).toContain('19:30');
  });
});
