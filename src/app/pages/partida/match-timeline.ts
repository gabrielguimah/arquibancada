import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Fixture } from '../../api/api-football';
import { timeline } from './timeline';

/** Lance a lance: mandante à esquerda, visitante à direita, do mais recente para o mais antigo. */
@Component({
  selector: 'app-match-timeline',
  imports: [MatIcon],
  templateUrl: './match-timeline.html',
  styleUrl: './match-timeline.scss',
})
export class MatchTimeline {
  fixture = input.required<Fixture>();

  protected items = computed(() => timeline(this.fixture()));

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
