import { Component, input, model } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { PillSwitch } from './pill-switch';

/** Aba das abas de seção: nome ou ícone (o nome vai no tooltip e no aria-label); bloqueada, com o motivo. */
export interface TabOption<T extends string = string> {
  id: T;
  label: string;
  /** Ícone da fonte Material Symbols no lugar do nome. */
  icon?: string;
  /** Ícone SVG registrado (ex.: a chuteira) no lugar do nome. */
  svgIcon?: string;
  /** Ícone preenchido. */
  filled?: boolean;
  /** Indisponível: o toque mostra o motivo (tooltip); com `lock`, aparece um cadeado. */
  blocked?: { text: string; lock: boolean } | null;
}

/**
 * Abas de seção do celular (Campeonato, Times, Jogadores, partida): pílula com as opções dividindo a
 * largura e o fundo da escolhida deslizando (PillSwitch). A página decide quando aparecem (`display` no
 * elemento `app-section-tabs`) e o espaço em volta; o desenho é o global `.section-tabs`.
 */
@Component({
  selector: 'app-section-tabs',
  imports: [MatIcon, MatTooltip, PillSwitch],
  template: `
    <div class="section-tabs" role="tablist" [attr.aria-label]="label()">
      @for (o of options(); track o.id) {
        @let iconOnly = !!(o.icon || o.svgIcon);
        <button
          #tip="matTooltip"
          type="button"
          role="tab"
          [class.icon-tab]="iconOnly"
          [class.blocked]="!!o.blocked"
          [attr.aria-selected]="value() === o.id"
          [attr.aria-disabled]="o.blocked ? true : null"
          [attr.aria-label]="iconOnly ? o.label : null"
          [matTooltip]="o.blocked?.text ?? (iconOnly ? o.label : '')"
          [matTooltipDisabled]="!o.blocked && !iconOnly"
          (click)="o.blocked ? tip.show() : value.set(o.id)"
        >
          @if (o.svgIcon) {
            <mat-icon class="tab-icon" [svgIcon]="o.svgIcon" aria-hidden="true" />
          } @else if (o.icon) {
            <mat-icon class="tab-icon" [class.filled]="o.filled" aria-hidden="true">{{ o.icon }}</mat-icon>
          } @else {
            {{ o.label }}
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

    /* Abas de ícone mais estreitas; as de nome ficam com o resto. */
    .section-tabs:has(.icon-tab) button:not(.icon-tab) {
      flex: 2;
    }

    .tab-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }

    .tab-icon.filled {
      font-variation-settings: 'FILL' 1;
    }
  `,
})
export class SectionTabs<T extends string = string> {
  options = input.required<TabOption<T>[]>();
  /** Aba escolhida. */
  value = model.required<T>();
  label = input('Seções da página');
}
