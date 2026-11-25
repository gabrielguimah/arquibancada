import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Team } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { PlayerPhoto } from '../../shared/player-photo';
import { Absence } from './absences';

/** Desfalques de um time (lesionados, suspensos e dúvidas), com o motivo de cada um. */
@Component({
  selector: 'app-match-absences',
  imports: [Crest, MatIcon, PlayerPhoto],
  templateUrl: './match-absences.html',
  styleUrl: './match-absences.scss',
})
export class MatchAbsences {
  team = input.required<Team>();
  absences = input.required<Absence[]>();
}
