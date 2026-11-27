import { Component } from '@angular/core';
import { Card } from '../../../shared/components/card/card';

// Cards de carregamento da página da partida: mesmo formato dos cards de verdade, com blocos no lugar
// do conteúdo (`.sk`, o brilho vem de styles.scss).

// O card do site (app-card), com os títulos de verdade (são fixos): o esqueleto fica com a mesma altura do
// card pronto.
const CARD = `
  :host {
    display: block;
  }
`;

/** Lance a lance: linhas alternando mandante (à esquerda) e visitante (à direita). */
@Component({
  selector: 'app-timeline-skeleton',
  imports: [Card],
  template: `
    <app-card icon="history" heading="Lance a lance" subtitle="Gols, cartões e substituições" aria-busy="true">
      @for (side of rows; track $index) {
        <div class="row" [class.away]="side === 'away'" aria-hidden="true">
          <span class="sk minute"></span>
          <span class="sk icon"></span>
          <span class="sk text" [style.width.px]="70 + ($index % 3) * 25"></span>
        </div>
      }
    </app-card>
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
  imports: [Card],
  template: `
    <app-card icon="bar_chart" heading="Estatísticas" subtitle="Comparação entre os times" aria-busy="true">
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
    </app-card>
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
  imports: [Card],
  template: `
    <app-card icon="stadium" heading="Escalações" subtitle="Formação, notas e banco" aria-busy="true">
      <!-- Como o campo de verdade: no estreito, faixa do mandante, campo e faixa do visitante; no largo,
           as duas faixas lado a lado em cima do campo deitado. -->
      <div class="field" aria-hidden="true">
        <span class="sk team-bar home"></span>
        <span class="sk pitch"></span>
        <span class="sk team-bar away"></span>
      </div>
      <!-- Embaixo do campo, como no card pronto: técnico e os títulos (fechados) de reservas e desfalques. -->
      <div class="bench" aria-hidden="true">
        @for (t of [0, 1]; track t) {
          <div class="bench-team">
            <div class="coach">
              <div class="heading"><span class="sk crest"></span><span class="sk sk-label"></span></div>
              <div class="person">
                <span class="sk photo"></span>
                <span class="sk name"></span>
              </div>
            </div>
            @for (i of [0, 1]; track i) {
              <div class="heading toggle"><span class="sk crest"></span><span class="sk sk-label"></span><span class="sk chevron"></span></div>
            }
          </div>
        }
      </div>
    </app-card>
  `,
  styles:
    CARD +
    `
    :host {
      container-type: inline-size;
    }

    .field {
      display: grid;
      grid-template-areas: 'home' 'pitch' 'away';
      gap: 8px;
    }

    .team-bar {
      height: 22px;
    }

    .team-bar.home {
      grid-area: home;
    }

    .team-bar.away {
      grid-area: away;
    }

    // Mesma altura do campo de verdade: em pé, no mínimo 760 px mais o respiro; deitado, 105 x 68.
    .pitch {
      grid-area: pitch;
      box-sizing: border-box;
      height: 780px;
      border-radius: 8px;
    }

    @container (min-width: 560px) {
      .field {
        grid-template-areas: 'home away' 'pitch pitch';
        grid-template-columns: 1fr 1fr;
      }

      .pitch {
        height: auto;
        aspect-ratio: 105 / 68;
      }
    }

    .bench {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 16px;
      margin-top: 20px;
    }

    // Divisória entre os times, como no card pronto. (Sem aninhar regras: o estilo do componente não as
    // aceita.)
    .bench-team {
      display: flow-root;
    }

    .bench-team + .bench-team {
      padding-left: 16px;
      border-left: 1px solid var(--line);
    }

    @container (max-width: 480px) {
      .bench {
        grid-template-columns: minmax(0, 1fr);
      }

      .bench-team + .bench-team {
        margin-top: 14px;
        padding-top: 12px;
        padding-left: 0;
        border-top: 1px solid var(--line);
        border-left: 0;
      }
    }

    // Alturas do card pronto: técnico (63 px e 14 px de respiro) e os títulos fechados de reservas e
    // desfalques (24 px cada, 14 px entre eles).
    .coach {
      height: 63px;
      margin-bottom: 14px;
    }

    // Título de seção (escudo e nome; os de reservas e desfalques com a seta à direita).
    .heading {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 6px;
    }

    .toggle {
      height: 24px;
      margin-bottom: 0;
    }

    // 20 px acima: no card pronto, os 6 px de baixo das reservas e os 14 px de cima dos desfalques somam
    // (aqui as duas margens se juntariam na maior).
    // Reservas e Desfalques fechados: 24 px cada; entre eles, os 14 px de cima dos desfalques.
    .toggle + .toggle {
      height: 24px;
      margin: 14px 0 0;
    }

    .crest {
      width: 18px;
      height: 18px;
      border-radius: 50%;
    }

    .chevron {
      width: 14px;
      height: 10px;
      margin-left: auto;
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

    .sk-label {
      width: 80px;
      height: 13px;
    }
  `,
})
export class LineupsSkeleton {}

/** Últimos 5 jogos (fechado): título com a seta e, por time, escudo, nome, média e os 5 resultados. */
@Component({
  selector: 'app-form-skeleton',
  imports: [Card],
  template: `
    <!-- O mesmo card do pronto (fechado): ícone, nome, subtítulo e a seta. -->
    <app-card icon="event_repeat" heading="Últimos 5 jogos" subtitle="Antes desta partida" [collapsible]="true" aria-busy="true">
      <div class="teams" aria-hidden="true">
        @for (t of [0, 1]; track t) {
          <div class="team">
            <span class="sk crest"></span>
            <span class="sk name"></span>
            <span class="sk badge"></span>
            <span class="chips">
              @for (i of [0, 1, 2, 3, 4]; track i) {
                <span class="sk chip"></span>
              }
            </span>
          </div>
        }
      </div>
    </app-card>
  `,
  styles:
    CARD +
    `
    :host {
      container-type: inline-size;
    }

    .teams {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 16px;
    }

    @container (max-width: 560px) {
      .teams {
        grid-template-columns: minmax(0, 1fr);
      }

      .team + .team {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--line);
      }
    }

    .team {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 21px;
    }

    .crest {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
    }

    .name {
      width: 90px;
      height: 12px;
    }

    .badge {
      width: 30px;
      height: 20px;
    }

    .chips {
      display: inline-flex;
      gap: 3px;
      margin-left: auto;
    }

    .chip {
      width: 18px;
      height: 18px;
      border-radius: 4px;
    }
  `,
})
export class FormSkeleton {}
