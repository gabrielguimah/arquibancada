import { Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { Coach, Fixture, Injury } from '../../api/api-football';
import { absences } from './absences';
import { MatchAbsences } from './match-absences';
import { MatchCoach } from './match-coach';
import { Crest } from '../../shared/crest';
import { PlayerPhoto } from '../../shared/player-photo';
import { MatchBench } from './match-bench';
import { NO_RATING_CLASS, NO_RATING_LABEL, NO_RATING_TITLE, formatRating, ratingClass } from '../../shared/rating';
import { lineups, pitchPositions, playerTip } from './lineups';

/**
 * Escalações no campo, com nota, gols, assistências, cartões e substituições de cada jogador; reservas e
 * técnicos embaixo (MatchBench). Campo horizontal no computador (mandante à esquerda), vertical no
 * celular (mandante em cima).
 */
@Component({
  selector: 'app-match-lineups',
  imports: [Crest, MatchAbsences, MatchBench, MatchCoach, MatIcon, NgTemplateOutlet, PlayerPhoto],
  templateUrl: './match-lineups.html',
  styleUrl: './match-lineups.scss',
})
export class MatchLineups {
  fixture = input.required<Fixture>();
  /** Desfalques da partida: embaixo dos reservas de cada time ou, sem escalação, no lugar dela. */
  injuries = input<Injury[]>([]);

  /** Técnico atual de cada time (pelo id): não depende da partida, aparece mesmo sem escalação. */
  coaches = input<Record<number, Coach | null>>({});
  /** Técnicos e desfalques ainda carregando: sem escalação, mostra o esqueleto dessa parte. */
  extrasLoading = input(false);

  /** Antes da escalação: técnico e desfalques de cada time; time sem nenhum dos dois fica de fora. */
  protected before = computed(() => {
    const { home, away } = this.fixture().teams;
    return [home, away]
      .map((team) => ({ team, coach: this.coaches()[team.id] ?? null, absences: absences(this.injuries(), team.id) }))
      .filter((b) => b.coach || b.absences.length > 0);
  });

  protected sides = ['home', 'away'] as const;
  protected data = computed(() => lineups(this.fixture()));
  /** Titulares de cada time com a posição no campo (ver `pitchPositions`). */
  protected placed = computed(() => {
    const d = this.data();
    return d ? { home: pitchPositions(d.home.lines), away: pitchPositions(d.away.lines) } : null;
  });

  protected ratingClass = ratingClass;
  protected formatRating = formatRating;
  protected noRating = { class: NO_RATING_CLASS, label: NO_RATING_LABEL, title: NO_RATING_TITLE };

  protected tip = playerTip;

}
