import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { GoalNotifier } from './shared/goal-notifier';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: GoalNotifier, useValue: { start: () => {}, dismiss: () => {}, toasts: signal([]) } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the header', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.logo')?.textContent).toContain('Arquibancada');
    // Primeira aba: "Classificação" no computador, "Campeonato" no celular (o CSS mostra um dos dois).
    const label = (a: Element) => (a.querySelector('.label-wide') ?? a).textContent?.trim();
    const links = [...compiled.querySelectorAll('nav a')].map(label);
    expect(links).toEqual(['Classificação', 'Times', 'Jogadores']);
    expect(compiled.querySelector('nav a .label-narrow')?.textContent?.trim()).toBe('Campeonato');
  });
});
