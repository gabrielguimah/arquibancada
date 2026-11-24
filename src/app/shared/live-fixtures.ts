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
    if (!this.timer) void this.tick();
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
      const fixtures = await firstValueFrom(this.api.fixturesByIds(watch.map((f) => f.fixture.id)));
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
