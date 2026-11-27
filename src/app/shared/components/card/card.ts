import { NgTemplateOutlet } from '@angular/common';
import { Component, input, model } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Collapsible } from '../collapsible/collapsible';

let nextId = 0;

/**
 * Card do site, num padrão só para todos os quadros (tabelas, rankings, cards da partida, esqueletos):
 * fundo, cantos e sombra no próprio elemento, e o cabeçalho com ícone, título, bolinha do ao vivo e
 * subtítulo. Sem título, é só a moldura (ex.: placar da partida).
 *
 * - `flush`: o conteúdo vai até as bordas (tabelas e listas, que têm o respiro nas linhas); o cabeçalho
 *   continua com o respiro do card. Sem ele, o conteúdo tem o respiro do card.
 * - `collapsible`: o cabeçalho vira o botão de abrir e fechar (com a seta); quem usa lê o `open` e decide o
 *   que mostrar (o conteúdo fica sempre à mostra).
 * - Encaixes: `[card-title-end]` dentro do título, logo depois do nome (ex.: ícone de informação);
 *   `[card-header-end]` no fim do cabeçalho, à direita (ex.: unidade da coluna, aviso).
 */
@Component({
  selector: 'app-card',
  imports: [Collapsible, MatIcon, MatTooltip, NgTemplateOutlet],
  host: {
    class: 'app-card',
    '[class.flush]': 'flush()',
    '[class.titled]': '!!heading()',
    '[attr.role]': 'heading() || label() ? "region" : null',
    '[attr.aria-labelledby]': 'heading() ? headingId() : null',
    '[attr.aria-label]': 'heading() ? null : label() || null',
  },
  template: `
    <ng-template #titleRow>
      <span class="card-title-row" [class.live]="live()" [id]="headingId()">
        @if (svgIcon(); as svg) {
          <mat-icon class="title-icon" [svgIcon]="svg" aria-hidden="true" />
        } @else if (icon(); as name) {
          <mat-icon class="title-icon" aria-hidden="true">{{ name }}</mat-icon>
        }
        {{ heading() }}
        <ng-content select="[card-title-end]" />
        @if (live()) {
          <span class="live-dot" role="img" aria-label="Ao vivo" matTooltip="Ao vivo"></span>
        }
      </span>
    </ng-template>

    @if (heading()) {
      <header class="card-header">
        @if (collapsible()) {
          <app-collapsible class="card-heading" [heading]="2" [(open)]="open">
            <span collapsible-label class="card-label">
              <ng-container [ngTemplateOutlet]="titleRow" />
              @if (subtitle()) {
                <span class="subtitle">{{ subtitle() }}</span>
              }
            </span>
          </app-collapsible>
        } @else {
          <div class="card-heading">
            <h2><ng-container [ngTemplateOutlet]="titleRow" /></h2>
            @if (subtitle()) {
              <p class="subtitle">{{ subtitle() }}</p>
            }
          </div>
        }
        <ng-content select="[card-header-end]" />
      </header>
    }
    <ng-content />
  `,
  styleUrl: './card.scss',
})
export class Card {
  /** Título do card (sem ele, só a moldura). Não é `title`, para não virar a dica nativa do navegador. */
  heading = input('');
  /** Nome do card sem título à mostra (ex.: placar), para leitores de tela. */
  label = input('');
  subtitle = input('');
  /** Ícone do Material Symbols ao lado do título (sempre preenchido, na cor do tema). */
  icon = input<string | null>(null);
  /** Ícone SVG registrado (ex.: chuteira), no lugar do `icon`. */
  svgIcon = input<string | null>(null);
  /** Jogo ao vivo: título no azul do ao vivo, com a bolinha piscando. */
  live = input(false);
  flush = input(false);
  collapsible = input(false);
  open = model(false);
  /** Id do título (para `aria-labelledby` de tabelas dentro do card); sem ele, um gerado. */
  titleId = input<string | null>(null);

  private readonly generatedId = `card-title-${++nextId}`;
  protected headingId = () => this.titleId() ?? this.generatedId;
}
