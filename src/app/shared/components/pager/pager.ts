import { Component, computed, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/**
 * Números do paginador: todas as páginas, se forem poucas; senão a primeira, a última e as vizinhas da
 * atual, com "…" no lugar das que faltam (ex.: 1 2 … 37 / 1 … 9 10 11 … 37).
 */
export function pageItems(page: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const shown = new Set([1, total, page - 1, page, page + 1]);
  // Perto das pontas, mostra mais números do mesmo lado, para o paginador não encolher.
  if (page <= 3) [2, 3, 4].forEach((p) => shown.add(p));
  if (page >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => shown.add(p));
  const pages = [...shown].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const items: Array<number | '…'> = [];
  for (const p of pages) {
    const last = items.at(-1);
    // Buraco de uma página só: mostra o número em vez de "…".
    if (typeof last === 'number' && p - last === 2) items.push(last + 1);
    else if (typeof last === 'number' && p - last > 2) items.push('…');
    items.push(p);
  }
  return items;
}

/** Paginação no rodapé das grades: setas para os lados e o número das páginas. */
@Component({
  selector: 'app-pager',
  imports: [MatIcon],
  template: `
    @if (pages() > 1) {
      <nav class="pager" [attr.aria-label]="label()">
        <button type="button" class="arrow" [disabled]="page() <= 1" aria-label="Página anterior" (click)="go(page() - 1)">
          <mat-icon>chevron_left</mat-icon>
        </button>
        @for (item of items(); track $index) {
          @if (item === '…') {
            <span class="gap" aria-hidden="true">…</span>
          } @else {
            <button
              type="button"
              class="number"
              [class.on]="item === page()"
              [attr.aria-current]="item === page() ? 'page' : null"
              [attr.aria-label]="'Página ' + item"
              (click)="go(item)"
            >
              {{ item }}
            </button>
          }
        }
        <button type="button" class="arrow" [disabled]="page() >= pages()" aria-label="Próxima página" (click)="go(page() + 1)">
          <mat-icon>chevron_right</mat-icon>
        </button>
      </nav>
    }
  `,
  styles: `
    .pager {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }

    button {
      display: inline-grid;
      place-items: center;
      min-width: 30px;
      height: 30px;
      padding: 0 6px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      font: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--button-text);
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--button-bg);
      }

      &:disabled {
        color: var(--subtle);
        cursor: default;
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }

    .number.on {
      background: var(--button-bg-hover);
      color: var(--accent);
    }

    .arrow mat-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }

    .gap {
      min-width: 20px;
      text-align: center;
      color: var(--muted);
    }
  `,
})
export class Pager {
  /** Página atual, a partir de 1. */
  page = input.required<number>();
  pages = input.required<number>();
  label = input('Páginas');
  pageChange = output<number>();

  protected items = computed(() => pageItems(this.page(), this.pages()));

  protected go(page: number) {
    if (page >= 1 && page <= this.pages() && page !== this.page()) this.pageChange.emit(page);
  }
}
