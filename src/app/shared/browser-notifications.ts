import { Injectable, signal } from '@angular/core';
import { API_URL, PUSH_PUBLIC_KEY } from '../api/api-football';

const STORAGE_KEY = 'arquibancada:notificacoes';
// Última confirmação da inscrição com o Worker ({ endpoint, at }): no máximo uma por dia, não uma por visita.
const SYNC_KEY = 'arquibancada:push';
const SYNC_EVERY_MS = 24 * 3600_000;

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
  /**
   * Inscrição no push confirmada pelo Worker? Aí as notificações do sistema vêm de lá, não da página. É
   * uma promessa: um gol logo ao abrir o site espera a confirmação antes de decidir quem mostra.
   */
  private pushReady: Promise<boolean> = Promise.resolve(false);

  constructor() {
    if (!this.supported || !this.enabled()) return;
    this.register();
    // Confirma a inscrição com o Worker (ele pode ter apagado uma inscrição expirada), uma vez por dia.
    this.pushReady = this.subscribePush();
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
    this.pushReady = this.subscribePush();
  }

  /** O próximo aviso vai para o sistema? (Ativado e o site não está na frente.) */
  willNotify(): boolean {
    return this.enabled() && !(document.visibilityState === 'visible' && document.hasFocus());
  }

  /**
   * Mostra no sistema se estiver ativado, o site não estiver na frente e o push não cuidar disso. Quem
   * mostra é o service worker (sw.js), o mesmo que mostra os do push: ele nunca mostra duas vezes o mesmo
   * aviso (`tag`), venha da página ou do push.
   */
  async show(n: SystemNotification) {
    if (!this.willNotify() || (await this.pushReady)) return;
    const worker = (await this.register())?.active;
    if (worker) worker.postMessage({ source: 'arquibancada-page', notification: n });
    else new Notification(n.title, { body: n.body, icon: n.icon, tag: n.tag });
  }

  /** Inscreve este navegador no push do Worker (ou confirma a inscrição que já existe); devolve se deu certo. */
  private async subscribePush(): Promise<boolean> {
    if (!('PushManager' in window)) return false;
    try {
      if (!(await this.register())) return false;
      const registration = await navigator.serviceWorker.ready;
      const serverKey = base64UrlToBytes(PUSH_PUBLIC_KEY);
      let subscription = await registration.pushManager.getSubscription();
      // Inscrição feita com outra chave do servidor (trocada): não serve mais.
      if (subscription && !sameBytes(subscription.options.applicationServerKey, serverKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
      const synced = readJson<{ endpoint: string; at: number }>(SYNC_KEY);
      if (synced?.endpoint === subscription.endpoint && Date.now() - synced.at < SYNC_EVERY_MS) return true;
      const res = await postToWorker('/push/subscribe', subscription);
      // Desligado enquanto inscrevia: desfaz.
      if (!this.enabled()) {
        void this.unsubscribePush();
        return false;
      }
      if (res.ok) writeJson(SYNC_KEY, { endpoint: subscription.endpoint, at: Date.now() });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async unsubscribePush() {
    this.pushReady = Promise.resolve(false);
    writeJson(SYNC_KEY, null);
    if (!('PushManager' in window)) return;
    try {
      const registration = await this.register();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      await postToWorker('/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => undefined);
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

/**
 * POST ao Worker com o corpo em JSON, mas enviado como texto simples: assim o navegador não faz a consulta
 * CORS prévia (preflight), uma requisição a menos. O Worker lê o JSON do texto.
 */
function postToWorker(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, { method: 'POST', body: JSON.stringify(body) });
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

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Armazenamento bloqueado: confirma de novo na próxima visita.
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
