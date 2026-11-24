import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Crest } from '../../shared/crest';
import { NO_RATING_CLASS, NO_RATING_LABEL, NO_RATING_TITLE, ratingClass } from '../../shared/rating';
import { TeamLineup, playerTip } from './lineups';

/**
 * Reservas e técnico de cada time, abaixo do campo: quem entrou primeiro (com o minuto), gols,
 * assistências, cartões e nota de quem jogou; quem não entrou fica mais apagado e sem nota.
 */
@Component({
  selector: 'app-match-bench',
  imports: [Crest, MatIcon],
  templateUrl: './match-bench.html',
  styleUrl: './match-bench.scss',
})
export class MatchBench {
  /** Mandante e visitante. */
  teams = input.required<TeamLineup[]>();

  protected tip = playerTip;
  protected ratingClass = ratingClass;
  protected noRating = { class: NO_RATING_CLASS, label: NO_RATING_LABEL, title: NO_RATING_TITLE };
}
