import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'arquibancada:som';

/**
 * Sons dos avisos de gol, criados na hora com a Web Audio (sem arquivos): uma badalada de sino no gol e
 * um "bloop" (tom despencando) no gol anulado. Ligar/desligar pelo ícone de som do cabeçalho.
 *
 * Navegadores (principalmente no celular) só liberam áudio depois de um toque ou clique na página: o
 * primeiro toque em qualquer lugar destrava o som para o resto da visita. Sem esse toque, o som não
 * toca (fica só a notificação do sistema, com o som dela). No iPhone, a chave de silencioso cala o site.
 */
@Injectable({ providedIn: 'root' })
export class GoalSounds {
  private ctx: AudioContext | null = null;
  private output: AudioNode | null = null;

  readonly supported = typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
  readonly enabled = signal(readPreference());

  constructor() {
    if (!this.supported) return;
    // Primeiro toque/clique/tecla na página destrava o áudio (exigência dos navegadores).
    const unlock = () => {
      this.context();
      ['pointerdown', 'touchend', 'keydown'].forEach((e) => document.removeEventListener(e, unlock, true));
    };
    ['pointerdown', 'touchend', 'keydown'].forEach((e) => document.addEventListener(e, unlock, true));
  }

  toggle() {
    this.enabled.update((on) => !on);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ on: this.enabled() }));
    } catch {
      // Sem localStorage: a escolha vale só nesta visita.
    }
  }

  /** Toca o som do aviso (se o som estiver ligado): sino no gol, bloop no gol anulado. */
  play(type: 'goal' | 'cancelled') {
    if (!this.enabled()) return;
    const ctx = this.context();
    if (!ctx || !this.output) return;
    const at = ctx.currentTime + 0.03;
    if (type === 'goal') bell(ctx, this.output, at);
    else bloop(ctx, this.output, at);
  }

  /** Cria (ou retoma) o contexto de áudio; no celular, só funciona dentro de um toque. */
  private context(): AudioContext | null {
    if (!this.supported) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.output = master;
      // iOS: tocar um som vazio dentro do toque é o que destrava o áudio de vez.
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }
}

/** Som ligado? Começa ligado; guarda só a escolha de ligar/desligar (formato `{ on }`). */
function readPreference(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { on?: boolean } | null;
    return saved?.on ?? true;
  } catch {
    return true;
  }
}

/** Sino: uma badalada longa (sol), com harmônicos "metálicos" (fora da série harmônica). */
function bell(ctx: AudioContext, out: AudioNode, at: number) {
  const decay = 1.6;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.3, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  gain.connect(out);
  for (const [ratio, level] of [
    [1, 1],
    [2.76, 0.4],
    [5.4, 0.15],
  ]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = 783.99 * ratio;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

/** Bloop: uma "bolha", com o tom despencando rápido. */
function bloop(ctx: AudioContext, out: AudioNode, at: number) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(700, at);
  osc.frequency.exponentialRampToValueAtTime(160, at + 0.28);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.4, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.35);
}
