import { Component, computed, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/** Aviso com o tipo (para quem guarda a mensagem num sinal e mostra com app-notice). */
export interface NoticeMessage {
  kind: 'empty' | 'wait' | 'error';
  text: string;
}

/**
 * Aviso no lugar do conteúdo, num padrão só para o site todo: ícone e texto (o texto vem de quem usa).
 *
 * - `empty`: nada para mostrar ainda (nenhum lance, nenhum jogador no filtro);
 * - `wait`: o Worker ainda está montando os dados, e a página tenta de novo sozinha;
 * - `error`: falhou ao carregar (com `retryable`, o botão "Tentar de novo" emite `retry`).
 *
 * Sem margens próprias: quem usa põe o respiro (e pode trocar a cor, ex.: aviso em cima do campo).
 */
@Component({
  selector: 'app-notice',
  imports: [MatIcon],
  host: {
    class: 'app-notice',
    '[attr.data-kind]': 'kind()',
    '[attr.role]': "kind() === 'error' ? 'alert' : 'status'",
  },
  template: `
    <mat-icon class="notice-icon" aria-hidden="true">{{ icon() }}</mat-icon>
    <span class="notice-text"><ng-content /></span>
    @if (retryable()) {
      <button type="button" class="notice-retry" (click)="retry.emit()">
        <mat-icon aria-hidden="true">refresh</mat-icon>Tentar de novo
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      margin: 0;
      color: var(--muted);
      font-size: 0.85rem;
      line-height: 1.35;
    }

    .notice-icon {
      flex: none;
      width: 18px;
      height: 18px;
      font-size: 18px;
    }

    :host([data-kind='error']) .notice-icon {
      color: var(--error-text);
    }

    .notice-text {
      flex: 1 1 12em;
      min-width: 0;
    }

    .notice-retry {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border: 0;
      border-radius: 999px;
      background: var(--button-bg);
      color: var(--button-text);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .notice-retry mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }

    .notice-retry:hover {
      background: var(--button-bg-hover);
    }
  `,
})
export class Notice {
  kind = input<'empty' | 'wait' | 'error'>('empty');
  retryable = input(false);
  retry = output<void>();

  protected icon = computed(() => ({ empty: 'info', wait: 'hourglass_top', error: 'error' })[this.kind()]);
}
