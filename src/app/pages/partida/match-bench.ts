import { Component, computed, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Crest } from '../../shared/crest';
import { PlayerPhoto } from '../../shared/player-photo';
import { NO_RATING_CLASS, NO_RATING_LABEL, NO_RATING_TITLE, formatRating, ratingClass } from '../../shared/rating';
import { Coach, Injury } from '../../api/api-football';
import { absences } from './absences';
import { TeamLineup, playerTip } from './lineups';
import { MatchAbsences } from './match-absences';
import { MatchCoach } from './match-coach';

/**
 * Reservas e técnico de cada time, abaixo do campo: quem entrou primeiro (com o minuto), gols,
 * assistências, cartões e nota de quem jogou; quem não entrou fica mais apagado e sem nota.
 */
@Component({
  selector: 'app-match-bench',
  imports: [Crest, MatchAbsences, MatchCoach, MatIcon, PlayerPhoto],
  templateUrl: './match-bench.html',
  styleUrl: './match-bench.scss',
})
export class MatchBench {
  /** Mandante e visitante. */
  teams = input.required<TeamLineup[]>();
  /** Desfalques da partida (dos dois times). */
  injuries = input<Injury[]>([]);

  private absences = computed(() => {
    const list = this.injuries();
    // Escalação divulgada: os relacionados (titulares e reservas) saem da lista e não há mais "Dúvida".
    return new Map(
      this.teams().map((t) => [t.team.id, absences(list, t.team.id, new Set([...t.lines.flat(), ...t.substitutes].map((p) => p.key)))]),
    );
  });
  protected absencesOf = (teamId: number) => this.absences().get(teamId) ?? [];
  /** Técnico atual de cada time (pelo id), para quando a escalação não traz o técnico ou a foto dele. */
  coaches = input<Record<number, Coach | null>>({});

  /** Técnico da escalação, completado com a foto do técnico atual do time, se faltar. */
  protected coachOf(t: TeamLineup): Coach | null {
    const current = this.coaches()[t.team.id] ?? null;
    if (!t.coach) return current;
    return { name: t.coach.name, photo: t.coach.photo || (current?.name === t.coach.name ? current.photo : null) };
  }

  // Reservas e desfalques fechados por padrão; abrem e fecham os dois times juntos (colunas alinhadas).
  protected benchOpen = signal(false);
  protected absencesOpen = signal(false);

  protected tip = playerTip;
  protected ratingClass = ratingClass;
  protected formatRating = formatRating;
  protected noRating = { class: NO_RATING_CLASS, label: NO_RATING_LABEL, title: NO_RATING_TITLE };
}
