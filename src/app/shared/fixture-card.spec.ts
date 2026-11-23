import { TestBed } from '@angular/core/testing';
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
  it('mostra a bolinha ao vivo e o minuto durante o jogo', () => {
    const el = render(fixture('2H', 67, [1, 0]));
    expect(el.querySelector('.live-dot')).toBeTruthy();
    expect(el.querySelector('.state')?.textContent).toContain("67'");
  });

  it('não mostra a bolinha em jogo encerrado nem antes do início', () => {
    expect(render(fixture('FT', 90, [1, 0])).querySelector('.live-dot')).toBeNull();
    const ns = render(fixture('NS', null, [null, null]));
    expect(ns.querySelector('.live-dot')).toBeNull();
    expect(ns.querySelector('time')?.textContent).toContain('19:30');
  });
});
