import { Component, input } from '@angular/core';

/** Resultado de um jogo nas "Últimas 5" (V, E, D). */
export type FormResult = 'V' | 'E' | 'D';

/**
 * Quadradinho do resultado (V, E, D) nas "Últimas 5", igual em todo o site (classificação, últimos jogos da
 * partida): verde, cinza ou vermelho; com `live`, o parcial do jogo em andamento, com o contorno no azul do
 * ao vivo. Atributos, eventos e dicas (foco, cartão do jogo, matTooltip) ficam no próprio elemento, em quem usa.
 */
@Component({
  selector: 'app-form-chip',
  template: `{{ result() }}`,
  host: {
    '[class]': "'r-' + result()",
    '[class.live]': 'live()',
  },
  styles: `
    :host {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 18px;
      height: 18px;
      border-radius: 4px;
      color: #fff;
      font-size: 0.65rem;
      font-weight: 700;
    }

    :host(.r-V) {
      background: var(--win);
    }

    :host(.r-E) {
      background: #9aa8a2;
    }

    :host(.r-D) {
      background: #dc2626;
    }

    /* Parcial do jogo em andamento: contorno no azul do ao vivo. */
    :host(.live) {
      outline: 2px solid var(--live);
      outline-offset: 1px;
    }

    /* Com o jogo (cartão ao passar o mouse / focar): dá para focar pelo teclado. */
    :host(:focus-visible) {
      outline: 2px solid var(--text);
      outline-offset: 1px;
    }
  `,
})
export class FormChip {
  result = input.required<FormResult>();
  /** Parcial de jogo em andamento. */
  live = input(false);
}
