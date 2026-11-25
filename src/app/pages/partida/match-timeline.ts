import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Fixture } from '../../api/api-football';
import { isLive } from '../../shared/fixture-card';
import { timeline } from './timeline';

// Bola rolando: 1º e 2º tempo, prorrogação e pênaltis (no intervalo, suspenso ou encerrado, não).
const RUNNING = new Set(['1H', '2H', 'ET', 'P', 'LIVE']);

/** Lance a lance: mandante à esquerda, visitante à direita, do primeiro lance (em cima) ao último. */
@Component({
  selector: 'app-match-timeline',
  imports: [MatIcon],
  templateUrl: './match-timeline.html',
  styleUrl: './match-timeline.scss',
})
export class MatchTimeline {
  fixture = input.required<Fixture>();

  protected items = computed(() => timeline(this.fixture()));
  /** Com o jogo rolando, o título fica no azul do ao vivo, com a bolinha piscando. */
  protected live = computed(() => isLive(this.fixture()));
  /** Bola rolando: a última linha é a dos três pontinhos (vem mais lance por aí). */
  protected running = computed(() => RUNNING.has(this.fixture().fixture.status.short));

  protected readonly labels: Record<string, string> = {
    goal: 'Gol',
    'missed-penalty': 'Pênalti perdido',
    yellow: 'Cartão amarelo',
    red: 'Cartão vermelho',
    'second-yellow': 'Segundo amarelo',
    sub: 'Substituição',
    var: 'VAR',
  };
}
