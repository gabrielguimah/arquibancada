import { Component, booleanAttribute, computed, input, output } from '@angular/core';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';

/** "Regular Season - 36" → "36ª rodada" */
export function roundName(round: string | null): string {
  const n = round?.match(/(\d+)$/)?.[1];
  return n ? `${n}ª rodada` : (round ?? '');
}

/**
 * Seletor de rodada (Classificação e Time da rodada): setas para a anterior/próxima e a lista de
 * rodadas no meio. Em esqueleto enquanto `loading`. `compact` usa botões menores (32 px em vez de 36).
 */
@Component({
  selector: 'app-round-nav',
  imports: [MatFormField, MatIcon, MatOption, MatSelect],
  host: { '[class.compact]': 'compact()' },
  template: `
    @if (loading()) {
      <div class="round-nav" aria-hidden="true">
        <span class="sk sk-nav-btn"></span>
        <span class="sk sk-nav-select"></span>
        <span class="sk sk-nav-btn"></span>
      </div>
    } @else {
      <div class="round-nav">
        <button type="button" (click)="step(-1)" [disabled]="index() <= 0" aria-label="Rodada anterior">
          <mat-icon>chevron_left</mat-icon>
        </button>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="dense select-pill">
          <mat-select
            panelClass="select-panel"
            hideSingleSelectionIndicator
            aria-label="Escolher rodada"
            [value]="round()"
            (selectionChange)="roundChange.emit($event.value)"
          >
            @for (r of rounds(); track r) {
              <mat-option [value]="r">{{ roundName(r) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <button type="button" (click)="step(1)" [disabled]="index() >= rounds().length - 1" aria-label="Próxima rodada">
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      --nav-btn: 36px;
      --nav-gap: 12px;
    }

    :host(.compact) {
      --nav-btn: 32px;
      --nav-gap: 8px;
    }

    .round-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--nav-gap);
    }

    button {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: var(--nav-btn);
      height: var(--nav-btn);
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--button-bg);
      color: var(--button-text);
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--button-bg-hover);
      }

      &:disabled {
        opacity: 0.3;
        cursor: default;
      }
    }

    mat-form-field {
      width: 150px;
    }

    .sk-nav-btn {
      width: var(--nav-btn);
      height: var(--nav-btn);
      border-radius: 50%;
    }

    .sk-nav-select {
      width: 150px;
      height: 40px;
      border-radius: 4px;
    }
  `,
})
export class RoundNav {
  rounds = input.required<string[]>();
  round = input.required<string | null>();
  /** Mostra o esqueleto no lugar do seletor. */
  loading = input(false);
  compact = input(false, { transform: booleanAttribute });
  roundChange = output<string>();

  protected index = computed(() => this.rounds().indexOf(this.round() ?? ''));
  protected roundName = roundName;

  protected step(delta: number) {
    const next = this.rounds()[this.index() + delta];
    if (next) this.roundChange.emit(next);
  }
}
