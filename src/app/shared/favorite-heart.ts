import { Component, computed, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { FavoriteTeam } from './favorite-team';
import { MatTooltip } from '@angular/material/tooltip';

/** Coração ao lado do nome do time, só se ele for o time do coração escolhido no cabeçalho. */
@Component({
  selector: 'app-favorite-heart',
  imports: [MatTooltip, MatIcon],
  template: `
    @if (favorite()) {
      <mat-icon class="heart" role="img" aria-label="Time do coração" matTooltip="Time do coração">favorite</mat-icon>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: middle;
    }

    // Preenchido, na cor da paleta (a mesma do coração da modal), no tamanho do texto ao lado.
    .heart {
      width: 1em;
      height: 1em;
      margin-left: 0.3em;
      color: var(--button-text);
      font-size: 1em;
      font-variation-settings: 'FILL' 1;
    }
  `,
})
export class FavoriteHeart {
  /** Id do time ao lado do qual o coração aparece. */
  team = input.required<number>();
  private chosen = inject(FavoriteTeam);
  protected favorite = computed(() => this.chosen.team()?.id === this.team());
}
