import { Injectable, effect, signal } from '@angular/core';

const STORAGE_KEY = 'arquibancada:tema';

/**
 * Modo claro/escuro. A escolha fica salva no navegador; sem escolha, segue o sistema.
 * O tema é aplicado pela classe `dark` no <html> (cores em styles.scss); o index.html
 * aplica a mesma regra antes do Angular carregar, para a página não piscar clara.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal(initialDark());

  constructor() {
    effect(() => document.documentElement.classList.toggle('dark', this.dark()));
  }

  setDark(dark: boolean) {
    this.dark.set(dark);
    try {
      localStorage.setItem(STORAGE_KEY, dark ? 'escuro' : 'claro');
    } catch {
      // Armazenamento bloqueado (ex.: navegação privada): vale só nesta visita.
    }
  }
}

function initialDark(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved === 'escuro';
  } catch {
    // Sem acesso ao armazenamento: usa a preferência do sistema.
  }
  // matchMedia não existe em alguns ambientes (ex.: testes com jsdom).
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}
