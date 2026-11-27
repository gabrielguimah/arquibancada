import { Card } from '../../../shared/components/card/card';
import { Component, computed, input } from '@angular/core';
import { Fixture } from '../../../api/api-football';
import { isLive } from '../../../shared/components/fixture-card/fixture-card';
import { matchStats } from '../utils/stats';
import { Notice } from '../../../shared/components/notice/notice';

/**
 * Estatísticas da partida: valor do mandante à esquerda, do visitante à direita e, embaixo de cada
 * linha, as barras com a parte de cada um. Só aparece depois do início (antes, a API não manda nada).
 */
@Component({
  selector: 'app-match-stats',
  imports: [Notice, Card],
  templateUrl: './match-stats.html',
  styleUrl: './match-stats.scss',
})
export class MatchStats {
  fixture = input.required<Fixture>();

  protected groups = computed(() => matchStats(this.fixture()));
  /** Com o jogo rolando, o título fica no azul do ao vivo, com a bolinha piscando. */
  protected live = computed(() => isLive(this.fixture()));
}
