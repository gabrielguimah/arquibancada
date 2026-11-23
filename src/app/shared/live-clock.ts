import { signal } from '@angular/core';
import { Fixture } from '../api/api-football';

// Fim de cada período: depois dele, o relógio mostra os acréscimos ("45'+04:26").
const PERIOD_ENDS = [45, 90, 105, 120];
const RUNNING = new Set(['1H', '2H', 'ET']);

/**
 * Relógio dos jogos ao vivo. A API só informa o minuto (e o minuto de acréscimo); os segundos
 * são contados aqui, desde que o site recebeu aquele minuto. Para nunca voltar, o relógio para
 * em :59 até chegar o minuto seguinte.
 */
const anchors = new Map<number, { minute: string; at: number }>();
const now = signal(Date.now());
let ticking = false;

function tick() {
  if (ticking) return;
  ticking = true;
  setInterval(() => now.set(Date.now()), 1000);
}

/** "67:12" no tempo normal, "45'+04:26" nos acréscimos; `null` se o jogo não está com a bola rolando. */
export function liveClock(f: Fixture): string | null {
  const { short, elapsed, extra } = f.fixture.status;
  if (!RUNNING.has(short) || elapsed == null) return null;
  tick();
  const current = now();

  // Âncora: quando este minuto (ou minuto de acréscimo) apareceu pela primeira vez.
  const minute = `${short}:${elapsed}:${extra ?? ''}`;
  let anchor = anchors.get(f.fixture.id);
  if (!anchor || anchor.minute !== minute) {
    anchor = { minute, at: current };
    anchors.set(f.fixture.id, anchor);
  }
  const seconds = Math.min(59, Math.floor((current - anchor.at) / 1000));

  const end = PERIOD_ENDS.find((e) => elapsed <= e) ?? elapsed;
  // Acréscimo: a API manda o minuto do fim do período + extra (ex.: 45 e 4 → "45'+03:ss").
  if (extra != null && extra > 0 && elapsed >= end) {
    return `${end}'+${pad(extra - 1)}:${pad(seconds)}`;
  }
  return `${pad(elapsed - 1)}:${pad(seconds)}`;
}

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, '0');
}
