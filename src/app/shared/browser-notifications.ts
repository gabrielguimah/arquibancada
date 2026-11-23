import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'arquibancada:notificacoes';

export interface SystemNotification {
  title: string;
  body: string;
  icon?: string;
  /** Mesma `tag` substitui a notificação anterior em vez de empilhar. */
  tag?: string;
}

/**
 * Notificações do sistema (popup no PC, notificação no celular) para os gols, quando o site
 * está aberto mas em segundo plano. Precisa da permissão do navegador, pedida pelo sino do cabeçalho.
 */
@Injectable({ providedIn: 'root' })
export class BrowserNotifications {
  /** Navegador sem suporte (ex.: Safari do iPhone fora de app instalado): o sino não aparece. */
  readonly supported = typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  readonly permission = signal<NotificationPermission>(this.supported ? Notification.permission : 'denied');
  /** Ativadas pelo usuário (e com permissão concedida). */
  readonly enabled = signal(this.supported && Notification.permission === 'granted' && readPreference() !== 'off');

  private registration: Promise<ServiceWorkerRegistration | null> | null = null;

  constructor() {
    if (this.supported && this.enabled()) this.register();
  }

  /** Liga ou desliga; ao ligar pela primeira vez, pede a permissão (precisa vir de um clique). */
  async toggle() {
    if (!this.supported) return;
    if (this.enabled()) {
      this.enabled.set(false);
      savePreference('off');
      return;
    }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    this.permission.set(permission);
    if (permission !== 'granted') return;
    this.enabled.set(true);
    savePreference('on');
    this.register();
  }

  /** Mostra no sistema se estiver ativado e o site não estiver na frente. */
  async show(n: SystemNotification) {
    if (!this.enabled() || (document.visibilityState === 'visible' && document.hasFocus())) return;
    const registration = await this.register();
    const options: NotificationOptions = { body: n.body, icon: n.icon, tag: n.tag };
    if (registration) await registration.showNotification(n.title, options);
    else new Notification(n.title, options);
  }

  private register(): Promise<ServiceWorkerRegistration | null> {
    // sw.js fica ao lado do index.html (no GitHub Pages, dentro de /arquibancada/).
    this.registration ??= navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => null);
    return this.registration;
  }
}

function readPreference(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function savePreference(value: 'on' | 'off') {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Armazenamento bloqueado: vale só nesta visita.
  }
}
