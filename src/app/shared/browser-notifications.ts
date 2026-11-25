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
  /**
   * Inscrição no push confirmada pelo Worker? Aí as notificações do sistema vêm de lá, não da página. É
   * uma promessa: um gol logo ao abrir o site espera a confirmação antes de decidir quem mostra.
   */
  private pushReady: Promise<boolean> = Promise.resolve(false);

  constructor() {
    if (!this.supported || !this.enabled()) return;
    this.register();
    // A cada visita, confirma a inscrição com o Worker (ele pode ter apagado uma inscrição expirada).
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
   * Mostra no sistema se estiver ativado, o site não estiver na frente e o push não cuidar disso. Nunca
   * mostra duas vezes o mesmo aviso (`tag`), nem se o push também o trouxer (ver `firstShow`).
   */
  async show(n: SystemNotification) {
    if (!this.willNotify() || (await this.pushReady)) return;
    if (n.tag && !(await firstShow(n.tag))) return;
    const registration = await this.register();
    const options: NotificationOptions = { body: n.body, icon: n.icon, tag: n.tag };
    if (registration) await registration.showNotification(n.title, options);
    else new Notification(n.title, options);
  }

  /** Inscreve este navegador no push do Worker (ou confirma a inscrição que já existe); devolve se deu certo. */
  private async subscribePush(): Promise<boolean> {
    if (!('PushManager' in window)) return false;
    try {
      if (!(await this.register())) return false;
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
      if (!this.enabled()) {
        void this.unsubscribePush();
        return false;
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  private async unsubscribePush() {
    this.pushReady = Promise.resolve(false);
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

// Avisos já mostrados (pela página ou pelo push), no IndexedDB: o service worker (sw.js) usa o mesmo
// banco, com o mesmo nome e formato. Guarda a `tag` e a hora; registros com mais de 2 dias são apagados.
const SHOWN_DB = 'arquibancada-avisos';
const SHOWN_STORE = 'mostrados';
const SHOWN_MAX_AGE_MS = 2 * 24 * 3600_000;

/**
 * Primeira vez deste aviso? Marca como mostrado na mesma transação (página e service worker não passam
 * os dois). Sem IndexedDB, deixa mostrar.
 */
function firstShow(tag: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(SHOWN_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(SHOWN_STORE);
      open.onerror = () => resolve(true);
      open.onsuccess = () => {
        const db = open.result;
        let first = true;
        const tx = db.transaction(SHOWN_STORE, 'readwrite');
        const store = tx.objectStore(SHOWN_STORE);
        const now = Date.now();
        const get = store.get(tag);
        get.onsuccess = () => {
          first = get.result === undefined;
          if (first) store.put(now, tag);
        };
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (typeof c.value === 'number' && now - c.value > SHOWN_MAX_AGE_MS) c.delete();
          c.continue();
        };
        tx.oncomplete = () => {
          db.close();
          resolve(first);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          resolve(true);
        };
      };
    } catch {
      resolve(true);
    }
  });
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
