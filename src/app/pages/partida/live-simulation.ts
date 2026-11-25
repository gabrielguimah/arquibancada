import { isDevMode } from '@angular/core';
import { Fixture } from '../../api/api-football';

// SÓ PARA TESTES (remover depois): no `ng serve` (modo de desenvolvimento), toda partida aberta aparece
// como se estivesse rolando, no 2º tempo, com a bolinha de ao vivo e o relógio andando. Não vale no site
// publicado (build de produção) nem nos testes automáticos.
const vitest = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['VITEST'];
export const SIMULATE_LIVE = isDevMode() && !vitest;

// O jogo "começou" de modo que, ao abrir o site, o relógio marque 67 minutos.
const CLOCK_START = Date.now() - 67 * 60_000;

/** A partida como se estivesse no 2º tempo, com o relógio contando desde `CLOCK_START`. */
export function simulateLive(f: Fixture): Fixture {
  const elapsed = Math.min(90, Math.floor((Date.now() - CLOCK_START) / 60_000));
  return {
    ...f,
    fixture: { ...f.fixture, status: { long: 'Second Half', short: '2H', elapsed, extra: null, clockStart: CLOCK_START } },
    goals: { home: f.goals.home ?? 0, away: f.goals.away ?? 0 },
  };
}
