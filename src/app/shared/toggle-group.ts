import { Component, input, model } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { PillSwitch } from './pill-switch';

/** Opção do seletor em pílula: nome, com ícone antes, ícone de informação depois (tooltip) ou bloqueada. */
export interface ToggleOption<T extends string = string> {
  id: T;
  label: string;
  /** Ícone antes do nome (ex.: casa, avião). */
  icon?: string;
  /** Explicação no ícone de informação depois do nome (ex.: quem conta como regular). */
  info?: string;
  /** Indisponível: o toque mostra o motivo (tooltip); com `lock`, aparece um cadeado. */
  blocked?: { text: string; lock: boolean } | null;
}

/**
 * Seletor em pílula (Classificação | Chances, período, mando, Regulares | Todos): a opção escolhida
 * preenchida, com o fundo deslizando ao trocar (PillSwitch). `stretch`: na largura toda, as opções
 * dividindo o espaço. `kind`: abas (`tablist`) ou escolha de filtro (`radiogroup`). O desenho é o global
 * `.view-switch`.
 */
@Component({
  selector: 'app-toggle-group',
  imports: [MatIcon, MatTooltip, PillSwitch],
  template: `
    <div class="view-switch" [class.stretch]="stretch()" [attr.role]="kind()" [attr.aria-label]="label()">
      @for (o of options(); track o.id) {
        @let selected = value() === o.id;
        <button
          #tip="matTooltip"
          type="button"
          [attr.role]="kind() === 'radiogroup' ? 'radio' : 'tab'"
          [attr.aria-selected]="kind() === 'tablist' ? selected : null"
          [attr.aria-checked]="kind() === 'radiogroup' ? selected : null"
          [attr.aria-disabled]="o.blocked ? true : null"
          [class.active]="selected"
          [class.blocked]="!!o.blocked"
          [matTooltip]="o.blocked?.text ?? ''"
          [matTooltipDisabled]="!o.blocked"
          (click)="o.blocked ? tip.show() : value.set(o.id)"
        >
          @if (o.icon) {
            <mat-icon class="option-icon" aria-hidden="true">{{ o.icon }}</mat-icon>
          }
          {{ o.label }}
          @if (o.info) {
            <mat-icon class="info" [matTooltip]="o.info" matTooltipPosition="below" [attr.aria-label]="o.info">info</mat-icon>
          }
          @if (o.blocked?.lock) {
            <mat-icon class="lock" aria-hidden="true">lock</mat-icon>
          }
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .view-switch.stretch {
      display: flex;
    }

    .view-switch.stretch button {
      flex: 1 1 auto;
    }

    .option-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
      font-variation-settings: 'FILL' 1;
    }

    .info {
      width: 16px;
      height: 16px;
      font-size: 16px;
      cursor: help;
    }
  `,
})
export class ToggleGroup<T extends string = string> {
  options = input.required<ToggleOption<T>[]>();
  /** Opção escolhida. */
  value = model.required<T>();
  label = input('');
  /** Na largura toda, as opções dividindo o espaço. */
  stretch = input(false);
  kind = input<'tablist' | 'radiogroup'>('tablist');
}
