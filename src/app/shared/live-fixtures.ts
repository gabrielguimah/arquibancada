import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiFootball, Fixture } from '../api/api-football';
import { isLive, todayInBrasilia } from './fixture-card';

// Com jogo rolando, pergunta a cada 15 s: o mesmo tempo que o Worker guarda jogo ao vivo, então não gasta
// mais chamadas à API, e o Worker vê as viradas de minuto com mais precisão (relógio do jogo).
const POLL_LIVE_MS = 15_000;
// Sem jogo rolando: espera até pouco antes do próximo início, no máximo 30 min.
const POLL_IDLE_MAX_MS = 30 * 60_000;
// Jogos passam a ser acompanhados este tempo antes do início, para pegar o apito inicial na hora.
const KICKOFF_MARGIN_MS = 5 * 60_000;

/**
 * Fonte única dos jogos ao vivo do site: uma só busca (`fixtures?ids=`, com eventos) dos jogos de hoje
 * em andamento ou começando em até 5 min. A página da rodada usa placar, relógio e cartões daqui;
 * os avisos de gol, os eventos. Assim o Worker busca esses dados na API uma vez, não um por tela.
 */
@Injectable({ providedIn: 'root' })
export class LiveFixtures {
  private api = inject(ApiFootball);
  private timer?: ReturnType<typeof setTimeout>;
  private listeners: Array<(fixtures: Fixture[]) => void> = [];

  /** Jogos acompanhados agora, com eventos, pelo id. */
  readonly byId = signal(new Map<number, Fixture>());

  start() {
    if (this.timer) return;
    void this.tick();
    // Aba em segundo plano: o navegador atrasa (ou congela) os timers. Ao voltar, atualiza na hora.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(this.timer);
      void this.tick();
    });
  }

  /** Chamado a cada atualização com os jogos acompanhados (os avisos de gol usam isto). */
  onUpdate(listener: (fixtures: Fixture[]) => void) {
    this.listeners.push(listener);
  }

  private async tick() {
    let next = POLL_IDLE_MAX_MS;
    try {
      next = await this.poll();
    } catch {
      next = POLL_LIVE_MS;
    }
    this.timer = setTimeout(() => this.tick(), next);
  }

  /** Uma rodada de verificação; devolve em quanto tempo verificar de novo. */
  async poll(now = Date.now()): Promise<number> {
    const today = await firstValueFrom(this.api.fixturesOn(todayInBrasilia()));
    const watch = today.filter(
      (f) => isLive(f) || (f.fixture.status.short === 'NS' && f.fixture.timestamp * 1000 - now < KICKOFF_MARGIN_MS),
    );
    if (watch.length) {
      const listed = new Map(today.map((f) => [f.fixture.id, f]));
      const fixtures = (await firstValueFrom(this.api.fixturesByIds(watch.map((f) => f.fixture.id)))).map((f) =>
        fresher(f, listed.get(f.fixture.id)),
      );
      this.byId.set(new Map(fixtures.map((f) => [f.fixture.id, f])));
      this.listeners.forEach((l) => l(fixtures));
      return POLL_LIVE_MS;
    }
    this.byId.set(new Map());
    const upcoming = today
      .filter((f) => f.fixture.status.short === 'NS')
      .map((f) => f.fixture.timestamp * 1000 - KICKOFF_MARGIN_MS - now)
      .filter((ms) => ms > 0);
    return Math.min(POLL_IDLE_MAX_MS, ...upcoming);
  }
}

// Ordem das situações de um jogo, para saber qual de duas respostas está mais adiantada.
const PROGRESS: Record<string, number> = { TBD: 0, NS: 0, '1H': 1, HT: 2, '2H': 3, BT: 4, ET: 5, P: 6, AET: 7, PEN: 7, FT: 7 };

/**
 * A busca por id (com eventos) e a lista do dia têm caches separados no Worker e na API, e às vezes a
 * lista já mostra o jogo começado (ou o gol) enquanto a busca por id ainda não. Fica com a situação e o
 * placar da mais adiantada; eventos, escalações e notas vêm sempre da busca por id.
 */
export function fresher(byId: Fixture, listed: Fixture | undefined): Fixture {
  if (!listed) return byId;
  const progress = (f: Fixture) => [PROGRESS[f.fixture.status.short] ?? 0, f.fixture.status.elapsed ?? 0, f.fixture.status.extra ?? 0];
  const [a, b] = [progress(byId), progress(listed)];
  const ahead = b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  if (ahead <= 0) return byId;
  return { ...byId, fixture: { ...byId.fixture, status: listed.fixture.status }, goals: listed.goals, score: listed.score ?? byId.score };
}
