import { Component } from '@angular/core';

/** Esqueleto do app-fixture-card: mesma grade, com blocos no lugar do conteúdo. */
@Component({
  selector: 'app-fixture-card-skeleton',
  host: { 'aria-hidden': 'true' },
  template: `
    <div class="sk-card">
      <div class="sk-status">
        <span class="sk sk-time"></span>
        <span class="sk sk-state"></span>
      </div>
      <div class="sk-teams">
        @for (t of [0, 1]; track t) {
          <div class="sk-team">
            <span class="sk sk-crest"></span>
            <span class="sk sk-name"></span>
            <span class="sk sk-goal"></span>
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './fixture-card-skeleton.scss',
})
export class FixtureCardSkeleton {}
