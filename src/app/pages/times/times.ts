import { Component } from '@angular/core';
import { TeamRatingsTables } from './team-ratings';

/** Aba Times: nota média e estatísticas dos times (temporada e últimas 5 partidas). */
@Component({
  selector: 'app-times',
  imports: [TeamRatingsTables],
  template: `<div class="page"><app-team-ratings /></div>`,
  styles: `
    .page {
      max-width: 1240px;
      margin: 0 auto;
      padding: 24px 16px;
    }
  `,
})
export class Times {}
