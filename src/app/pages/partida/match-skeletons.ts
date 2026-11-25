import { Component } from '@angular/core';

// Cards de carregamento da página da partida: mesmo formato dos cards de verdade, com blocos no lugar
// do conteúdo (`.sk`, o brilho vem de styles.scss).

const CARD = `
  :host {
    display: block;
  }

  .card {
    padding: 14px 16px 16px;
    background: var(--surface);
    border-radius: 12px;
    box-shadow: 0 1px 2px var(--shadow);
  }

  .sk-title {
    width: 120px;
    height: 18px;
    margin-bottom: 14px;
  }
`;

/** Lance a lance: linhas alternando mandante (à esquerda) e visitante (à direita). */
@Component({
  selector: 'app-timeline-skeleton',
  template: `
    <div class="card" aria-busy="true" aria-label="Carregando lance a lance">
      <span class="sk sk-title"></span>
      @for (side of rows; track $index) {
        <div class="row" [class.away]="side === 'away'" aria-hidden="true">
          <span class="sk minute"></span>
          <span class="sk icon"></span>
          <span class="sk text" [style.width.px]="70 + ($index % 3) * 25"></span>
        </div>
      }
    </div>
  `,
  styles:
    CARD +
    `
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 0;

      & + & {
        border-top: 1px solid var(--line);
      }

      &.away {
        flex-direction: row-reverse;
      }
    }

    .minute {
      width: 26px;
      height: 12px;
    }

    .icon {
      width: 16px;
      height: 16px;
      border-radius: 50%;
    }

    .text {
      height: 12px;
    }
  `,
})
export class TimelineSkeleton {
  protected rows = ['home', 'away', 'home', 'home', 'away', 'away'];
}

/** Estatísticas: valor, nome e valor, com as duas barras embaixo. */
@Component({
  selector: 'app-stats-skeleton',
  template: `
    <div class="card" aria-busy="true" aria-label="Carregando estatísticas">
      <span class="sk sk-title"></span>
      @for (i of rows; track i) {
        <div class="row" aria-hidden="true">
          <div class="values">
            <span class="sk value"></span>
            <span class="sk label" [style.width.px]="80 + (i % 3) * 20"></span>
            <span class="sk value"></span>
          </div>
          <span class="sk bar"></span>
        </div>
      }
    </div>
  `,
  styles:
    CARD +
    `
    .row + .row {
      margin-top: 14px;
    }

    .values {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .value {
      width: 28px;
      height: 12px;
    }

    .label {
      height: 11px;
    }

    .bar {
      height: 6px;
      border-radius: 999px;
    }
  `,
})
export class StatsSkeleton {
  protected rows = [0, 1, 2, 3, 4, 5, 6];
}

/**
 * Escalações: faixas dos dois times, o campo e, embaixo, técnico e reservas de cada time. O campo segue
 * o de verdade: deitado (105 x 68) no card largo, em pé no estreito.
 */
@Component({
  selector: 'app-lineups-skeleton',
  template: `
    <div class="card" aria-busy="true" aria-label="Carregando escalações">
      <span class="sk sk-title"></span>
      <div class="bars" aria-hidden="true">
        <span class="sk team-bar"></span>
        <span class="sk team-bar"></span>
      </div>
      <span class="sk pitch" aria-hidden="true"></span>
      <div class="bench" aria-hidden="true">
        @for (t of [0, 1]; track t) {
          <div>
            <div class="person">
              <span class="sk photo"></span>
              <span class="sk name"></span>
            </div>
            <span class="sk subtitle"></span>
            @for (i of [0, 1, 2, 3]; track i) {
              <div class="person">
                <span class="sk photo"></span>
                <span class="sk name" [style.width.px]="80 + (i % 2) * 30"></span>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles:
    CARD +
    `
    :host {
      container-type: inline-size;
    }

    .bars {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 8px;
    }

    .team-bar {
      height: 22px;
    }

    .pitch {
      height: 520px;
      border-radius: 8px;
    }

    @container (min-width: 560px) {
      .pitch {
        height: auto;
        aspect-ratio: 105 / 68;
      }
    }

    .bench {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 20px;

      @container (max-width: 480px) {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .person {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
    }

    .photo {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border-radius: 50%;
    }

    .name {
      width: 110px;
      height: 12px;
    }

    .subtitle {
      width: 70px;
      height: 13px;
      margin: 12px 0 4px;
    }
  `,
})
export class LineupsSkeleton {}
