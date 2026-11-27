import { NgTemplateOutlet } from '@angular/common';
import { Component, input, model } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

let nextId = 0;

/**
 * Seção que abre e fecha, num estilo só para o site todo: o cabeçalho (o rótulo vem de quem usa, no
 * elemento com o atributo `collapsible-label`) e a seta no fim; aberto, o conteúdo logo abaixo.
 *
 * Aparências:
 * - `plain`: título de seção ou de card (Reservas, Desfalques, Últimos 5 jogos), sem fundo;
 * - `bar`: barra do card (Regras e legenda);
 * - `pill`: pílula na linha inteira (Filtros).
 *
 * `heading` põe o cabeçalho dentro de um h2 ou h3 (o botão fica dentro do título, para leitores de tela).
 * Sem conteúdo (ex.: Últimos 5 jogos, que mostra o resumo dos times sempre e os jogos só aberto), quem usa
 * lê o `open` e decide o que mostrar.
 */
@Component({
  selector: 'app-collapsible',
  imports: [MatIcon, NgTemplateOutlet],
  template: `
    @switch (heading()) {
      @case (2) {
        <h2 class="collapsible-heading"><ng-container [ngTemplateOutlet]="toggle" /></h2>
      }
      @case (3) {
        <h3 class="collapsible-heading"><ng-container [ngTemplateOutlet]="toggle" /></h3>
      }
      @default {
        <ng-container [ngTemplateOutlet]="toggle" />
      }
    }
    <ng-template #toggle>
      <button
        type="button"
        class="collapsible-toggle"
        [class]="'is-' + appearance()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="bodyId"
        (click)="open.set(!open())"
      >
        <ng-content select="[collapsible-label]" />
        <mat-icon class="chevron" aria-hidden="true">expand_more</mat-icon>
      </button>
    </ng-template>
    @if (open()) {
      <div class="collapsible-body" [class]="'is-' + appearance()" [id]="bodyId">
        <ng-content />
      </div>
    }
  `,
  styleUrl: './collapsible.scss',
})
export class Collapsible {
  open = model(false);
  appearance = input<'plain' | 'bar' | 'pill'>('plain');
  heading = input<2 | 3 | null>(null);
  protected bodyId = `collapsible-${++nextId}`;
}
