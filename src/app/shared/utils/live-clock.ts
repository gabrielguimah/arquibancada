import { signal } from '@angular/core';
import { Fixture } from '../../api/api-football';

// Fim de cada período: depois dele, o relógio mostra só o minuto de acréscimo ("45'+2").
const PERIOD_ENDS = [45, 90, 105, 120];
const RUNNING = new Set(['1H', '2H', 'ET']);
// Estimativa do Worker mais longe que isso do minuto informado é descartada (dado inconsistente).
const SERVER_TOLERANCE_S = 120;

/**
 * Relógio dos jogos ao vivo. A API só informa o minuto, e ele não vira a cada 60 s certinhos. O Worker
 * estima quando o período começou (mediana das viradas de minuto que ele viu) e manda em
 * `status.clockStart`; com ela, o relógio anda segundo a segundo, sem travar nem voltar a cada minuto
 * que chega, e quem abre a página no meio do jogo já vê o relógio acertado.
 *
 * Sem essa estimativa (no começo de cada período, antes de o Worker ver uma virada), o relógio conta os
 * segundos desde que o site recebeu o minuto atual, e para em um minuto à frente dele se a API atrasar.
 */
export type Anchor = {
  /** Período ("1H", "2H", "ET1", "ET2"): cada um tem seu próprio início. */
  period: string;
  /** Maior minuto já visto neste período (com acréscimo somado). */
  minute: number;
  /** Instante (ms) em que o relógio do jogo marcaria 00:00 neste período. */
  start: number;
};

const anchors = new Map<number, Anchor>();
const now = signal(Date.now());
let ticking = false;

// Versões anteriores guardavam o relógio no localStorage; hoje a estimativa vem do Worker.
try {
  localStorage.removeItem('live-clock');
} catch {
  // Sem localStorage: nada a limpar.
}

function tick() {
  if (ticking) return;
  ticking = true;
  setInterval(() => now.set(Date.now()), 1000);
}

/** "67:12" no tempo normal, "45'+2" nos acréscimos; `null` se o jogo não está com a bola rolando. */
export function liveClock(f: Fixture): string | null {
  const { short, elapsed, extra, clockStart } = f.fixture.status;
  if (!RUNNING.has(short) || elapsed == null) return null;
  tick();
  const current = now();
  const minute = elapsed + (extra ?? 0);

  const server = clockStart != null ? serverClock(clockStart, minute, current) : null;
  if (server != null) return formatClock(server, elapsed);

  const anchor = updateAnchor(anchors.get(f.fixture.id), period(short, elapsed), minute, current);
  anchors.set(f.fixture.id, anchor);
  return formatClock(localClock(anchor, current), elapsed);
}

/** Segundos de jogo pela estimativa do Worker, ou `null` se ela não bate com o minuto informado. */
export function serverClock(start: number, minute: number, at: number): number | null {
  const total = Math.floor((at - start) / 1000);
  const ok = total >= (minute - 1) * 60 - SERVER_TOLERANCE_S && total < minute * 60 + SERVER_TOLERANCE_S;
  return ok ? Math.max(0, total) : null;
}

/** Reserva sem o Worker: recomeça a contagem quando chega um minuto novo; dado mais velho é ignorado. */
export function updateAnchor(anchor: Anchor | undefined, period: string, minute: number, at: number): Anchor {
  if (anchor && anchor.period === period && minute <= anchor.minute) return anchor;
  return { period, minute, start: at - (minute - 1) * 60_000 };
}

/** Segundos de jogo pela reserva: no máximo um minuto à frente do informado, se a API atrasar. */
export function localClock(anchor: Anchor, at: number): number {
  return Math.min(anchor.minute * 60 + 59, Math.floor((at - anchor.start) / 1000));
}

/** Texto do relógio; `elapsed` (o minuto da API) diz em que período estamos. */
export function formatClock(total: number, elapsed: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const end = PERIOD_ENDS.find((e) => elapsed <= e) ?? elapsed;
  // Acréscimo: só o minuto, contado como no futebol (o primeiro minuto depois dos 45 é o "45'+1").
  if (minutes >= end) return `${end}'+${minutes - end + 1}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

// A prorrogação tem um intervalo curto no meio sem mudar o status: cada metade é um período.
function period(short: string, elapsed: number): string {
  if (short !== 'ET') return short;
  return elapsed > 105 ? 'ET2' : 'ET1';
}

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, '0');
}
