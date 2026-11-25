import { Injectable, signal } from '@angular/core';
import { API_URL } from '../api/api-football';

const STORAGE_KEY = 'arquibancada:notificacoes';

export interface SystemNotification {
  title: string;
  body: string;
  icon?: string;
  /** Mesma `tag` substitui a notificação anterior em vez de empilhar. */
  tag?: string;
}

/**
 * Notificações do sistema (popup no PC, notificação no celular) para os gols. Precisa da permissão do
 * navegador, pedida pelo sino do cabeçalho.
 *
 * Ao ligar, o navegador se inscreve no push do Worker: os gols chegam mesmo com o site fechado e o
 * celular bloqueado (no iPhone, só com o site instalado na tela de início). Sem push (navegador sem
 * suporte ou inscrição falhou), a própria página mostra a notificação enquanto estiver aberta.
 */
@Injectable({ providedIn: 'root' })
export class BrowserNotifications {
  /** Navegador sem suporte (ex.: Safari do iPhone fora de app instalado): o sino não aparece. */
  readonly supported = typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  readonly permission = signal<NotificationPermission>(this.supported ? Notification.permission : 'denied');
  /** Ativadas pelo usuário (e com permissão concedida). */
  readonly enabled = signal(this.supported && Notification.permission === 'granted' && readPreference() !== 'off');

  private registration: Promise<ServiceWorkerRegistration | null> | null = null;
  /** Inscrição no push confirmada pelo Worker: as notificações do sistema vêm de lá, não da página. */
  private pushActive = false;
  /** Hora (ms) em que chega a notificação de teste pedida pelo botão; `null` se não há teste pendente. */
  readonly testAt = signal<number | null>(null);
  private testTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    if (!this.supported || !this.enabled()) return;
    this.register();
    // A cada visita, confirma a inscrição com o Worker (ele pode ter apagado uma inscrição expirada).
    void this.subscribePush();
  }

  /** Liga ou desliga; ao ligar pela primeira vez, pede a permissão (precisa vir de um clique). */
  async toggle() {
    if (!this.supported) return;
    if (this.enabled()) {
      this.enabled.set(false);
      savePreference('off');
      void this.unsubscribePush();
      return;
    }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    this.permission.set(permission);
    if (permission !== 'granted') return;
    this.enabled.set(true);
    savePreference('on');
    this.register();
    void this.subscribePush();
  }

  /** O próximo aviso vai para o sistema? (Ativado e o site não está na frente.) */
  willNotify(): boolean {
    return this.enabled() && !(document.visibilityState === 'visible' && document.hasFocus());
  }

  /** Mostra no sistema se estiver ativado e o site não estiver na frente (e o push não cuidar disso). */
  async show(n: SystemNotification) {
    if (!this.willNotify() || this.pushActive) return;
    const registration = await this.register();
    const options: NotificationOptions = { body: n.body, icon: n.icon, tag: n.tag };
    if (registration) await registration.showNotification(n.title, options);
    else new Notification(n.title, options);
  }

  /** Inscreve este navegador no push do Worker (ou confirma a inscrição que já existe). */
  private async subscribePush() {
    if (!('PushManager' in window)) return;
    try {
      if (!(await this.register())) return;
      const registration = await navigator.serviceWorker.ready;
      const { key } = (await (await fetch(`${API_URL}/push/key`)).json()) as { key: string };
      const serverKey = base64UrlToBytes(key);
      let subscription = await registration.pushManager.getSubscription();
      // Inscrição feita com outra chave do servidor (trocada): não serve mais.
      if (subscription && !sameBytes(subscription.options.applicationServerKey, serverKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
      const res = await fetch(`${API_URL}/push/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription),
      });
      // Desligado enquanto inscrevia: desfaz.
      if (!this.enabled()) return void this.unsubscribePush();
      this.pushActive = res.ok;
    } catch {
      this.pushActive = false;
    }
  }

  /**
   * Pede ao Worker uma notificação de teste para este navegador, daqui a 10 s (dá tempo de sair do site
   * ou bloquear o celular). Devolve se o pedido foi aceito.
   */
  async sendTest(): Promise<boolean> {
    if (!this.enabled() || !('PushManager' in window)) return false;
    try {
      if (!this.pushActive) await this.subscribePush();
      const registration = await this.register();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return false;
      const res = await fetch(`${API_URL}/push/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!res.ok) return false;
      const { at } = (await res.json()) as { at: number };
      this.testAt.set(at);
      clearTimeout(this.testTimer);
      this.testTimer = setTimeout(() => this.testAt.set(null), Math.max(0, at - Date.now()));
      return true;
    } catch {
      return false;
    }
  }

  private async unsubscribePush() {
    this.pushActive = false;
    if (!('PushManager' in window)) return;
    try {
      const registration = await this.register();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      await fetch(`${API_URL}/push/unsubscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => undefined);
      await subscription.unsubscribe();
    } catch {
      // Sem como cancelar agora: o Worker apaga a inscrição quando o serviço de push recusar.
    }
  }

  private register(): Promise<ServiceWorkerRegistration | null> {
    // sw.js fica ao lado do index.html (no GitHub Pages, dentro de /arquibancada/).
    this.registration ??= navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => null);
    return this.registration;
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((x, i) => x === b[i]);
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
