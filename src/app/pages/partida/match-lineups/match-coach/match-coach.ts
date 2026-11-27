import { Component, input } from '@angular/core';
import { Coach, Team } from '../../../../api/api-football';
import { Crest } from '../../../../shared/directives/crest';
import { PLAYER_PLACEHOLDER, CoachPhoto } from '../../../../shared/directives/player-photo';

/** Técnico do time: título "Técnico" com o escudo (como "Reservas" e "Desfalques"), foto e nome. */
@Component({
  selector: 'app-match-coach',
  imports: [CoachPhoto, Crest],
  template: `
    <h3>
      <img crest [src]="team().logo" alt="" width="18" height="18" />
      Técnico
    </h3>
    <p class="person">
      <img class="mini" coachPhoto [src]="coach().photo || placeholder" alt="" width="28" height="28" loading="lazy" />
      {{ coach().name }}
    </p>
  `,
  styles: `
    :host {
      display: block;
    }

    h3 {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 6px;
      font-size: 0.85rem;
    }

    .person {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 5px 0;
      font-size: 0.8rem;
      font-weight: 600;
    }

    .mini {
      box-sizing: border-box;
      width: 28px;
      height: 28px;
      border: 1.5px solid #fff;
      border-radius: 50%;
      background: var(--line-strong);
      object-fit: cover;
    }
  `,
})
export class MatchCoach {
  team = input.required<Team>();
  coach = input.required<Coach>();
  protected placeholder = PLAYER_PLACEHOLDER;
}
