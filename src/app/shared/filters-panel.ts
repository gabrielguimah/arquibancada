import { Component, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

let nextId = 0;

/**
 * Botão "Filtros" na linha inteira: fechado, mostra o que está escolhido (`summary`); aberto, o conteúdo
 * de dentro (os seletores de cada página, ex.: período e mando em Times, Regulares / Todos em Jogadores).
 */
@Component({
  selector: 'app-filters',
  imports: [MatIcon],
  template: `
    <button type="button" class="filters-toggle" [attr.aria-expanded]="open()" [attr.aria-controls]="panelId" (click)="open.set(!open())">
      <mat-icon class="filters-icon" aria-hidden="true">tune</mat-icon>
      Filtros
      <span class="filters-summary">{{ summary() }}</span>
      <mat-icon class="chevron" aria-hidden="true">expand_more</mat-icon>
    </button>
    @if (open()) {
      <div class="filters-panel" [id]="panelId">
        <ng-content />
      </div>
    }
  `,
  styleUrl: './filters-panel.scss',
})
export class FiltersPanel {
  /** O que está escolhido, mostrado no botão (para ver sem abrir). */
  summary = input('');
  protected open = signal(false);
  protected panelId = `filters-${++nextId}`;
}
