import { Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { Fixture } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { MatchBench } from './match-bench';
import { NO_RATING_CLASS, NO_RATING_LABEL, NO_RATING_TITLE, ratingClass } from '../../shared/rating';
import { lineups, pitchPositions, playerTip } from './lineups';

/**
 * Escalações no campo, com nota, gols, assistências, cartões e substituições de cada jogador; reservas e
 * técnicos embaixo (MatchBench). Campo horizontal no computador (mandante à esquerda), vertical no
 * celular (mandante em cima).
 */
@Component({
  selector: 'app-match-lineups',
  imports: [Crest, MatchBench, MatIcon, NgTemplateOutlet],
  templateUrl: './match-lineups.html',
  styleUrl: './match-lineups.scss',
})
export class MatchLineups {
  fixture = input.required<Fixture>();

  protected sides = ['home', 'away'] as const;
  protected data = computed(() => lineups(this.fixture()));
  /** Titulares de cada time com a posição no campo (ver `pitchPositions`). */
  protected placed = computed(() => {
    const d = this.data();
    return d ? { home: pitchPositions(d.home.lines), away: pitchPositions(d.away.lines) } : null;
  });

  protected ratingClass = ratingClass;
  protected noRating = { class: NO_RATING_CLASS, label: NO_RATING_LABEL, title: NO_RATING_TITLE };

  protected tip = playerTip;

}
