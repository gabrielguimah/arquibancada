import { AfterViewInit, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Fundo da opção escolhida que desliza de um lado para o outro nos seletores em pílula (`.view-switch`:
 * Classificação | Chances, período, mando) e nas abas de seção (`.section-tabs`: celular). Entra sozinha
 * em todo elemento com uma dessas classes, no componente que a importa.
 *
 * Guarda a posição e a largura da opção escolhida (botão `.active` ou `aria-selected="true"`) em
 * `--pill-x` e `--pill-w`; o desenho e a transição ficam em styles.scss. Mede de novo quando a escolha
 * muda e quando o seletor muda de tamanho (ex.: as abas do celular saindo de `display: none`). Na
 * primeira medida, o fundo já aparece no lugar, sem deslizar.
 */
@Directive({ selector: '.view-switch, .section-tabs' })
export class PillSwitch implements AfterViewInit {
  private el: HTMLElement = inject(ElementRef<HTMLElement>).nativeElement;
  private destroyRef = inject(DestroyRef);

  ngAfterViewInit() {
    const update = () => this.update();
    const mutations = new MutationObserver(update);
    mutations.observe(this.el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
    // ResizeObserver não existe em alguns ambientes (testes com jsdom): aí só a troca de opção conta.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(this.el);
    this.destroyRef.onDestroy(() => {
      mutations.disconnect();
      resize?.disconnect();
    });
    this.update();
  }

  private update() {
    const active = this.el.querySelector<HTMLElement>(':scope > button.active, :scope > button[aria-selected="true"]');
    // Escondido (largura zero) ou sem escolha: nada a desenhar ainda.
    if (!active || !active.offsetWidth) {
      if (!active) delete this.el.dataset['pill'];
      return;
    }
    this.el.style.setProperty('--pill-x', `${active.offsetLeft}px`);
    this.el.style.setProperty('--pill-w', `${active.offsetWidth}px`);
    // Primeira medida: mostra o fundo no lugar e só no quadro seguinte liga a transição.
    if (!this.el.dataset['pill']) {
      this.el.dataset['pill'] = 'on';
      requestAnimationFrame(() => (this.el.dataset['pill'] = 'ready'));
    }
  }
}
