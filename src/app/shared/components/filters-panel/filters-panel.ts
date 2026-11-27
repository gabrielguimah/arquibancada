import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Collapsible } from '../collapsible/collapsible';

/**
 * Botão "Filtros" na linha inteira (o expansível do site, na aparência de pílula): fechado, mostra o que
 * está escolhido (`summary`); aberto, o conteúdo de dentro (os seletores de cada página, ex.: período e
 * mando em Times, Regulares / Todos em Jogadores).
 */
@Component({
  selector: 'app-filters',
  imports: [Collapsible, MatIcon],
  template: `
    <app-collapsible appearance="pill">
      <span collapsible-label class="filters-label">
        <mat-icon class="filters-icon" aria-hidden="true">tune</mat-icon>
        Filtros
        <span class="filters-summary">{{ summary() }}</span>
      </span>
      <ng-content />
    </app-collapsible>
  `,
  styles: `
    :host {
      display: block;
    }

    /* Ícone, nome e, depois de um ponto, o que está escolhido. */
    .filters-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .filters-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }

    .filters-summary {
      font-weight: 500;
      opacity: 0.8;
    }

    .filters-summary::before {
      content: '·';
      margin-right: 6px;
    }
  `,
})
export class FiltersPanel {
  /** O que está escolhido, mostrado no botão (para ver sem abrir). */
  summary = input('');
}
