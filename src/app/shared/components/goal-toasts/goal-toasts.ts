import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Crest } from '../../directives/crest';
import { GoalNotifier } from '../../services/goal-notifier';

/** Avisos de gol no canto da tela (ver GoalNotifier). */
@Component({
  selector: 'app-goal-toasts',
  imports: [Crest, MatIcon],
  templateUrl: './goal-toasts.html',
  styleUrl: './goal-toasts.scss',
})
export class GoalToasts {
  protected notifier = inject(GoalNotifier);
}
