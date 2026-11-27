import { Component, input, model } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Collapsible } from '../../../../shared/components/collapsible/collapsible';
import { Team } from '../../../../api/api-football';
import { Crest } from '../../../../shared/directives/crest';
import { PlayerPhoto } from '../../../../shared/directives/player-photo';
import { Absence } from '../../utils/absences';
import { MatTooltip } from '@angular/material/tooltip';

/**
 * Desfalques de um time (lesionados, suspensos e dúvidas), com o motivo de cada um. Fechado por padrão
 * (só o título com a quantidade), para não ocupar espaço; quem usa decide se abre os dois times juntos.
 */
@Component({
  selector: 'app-match-absences',
  imports: [MatTooltip, Collapsible, Crest, MatIcon, PlayerPhoto],
  templateUrl: './match-absences.html',
  styleUrl: './match-absences.scss',
})
export class MatchAbsences {
  team = input.required<Team>();
  absences = input.required<Absence[]>();
  open = model(false);
}
