// Service worker do Arquibancada: só serve para as notificações de gol. Não guarda nada em cache.
// - Avisos da própria página (site aberto em segundo plano), via `showNotification`.
// - Push do Worker (site fechado, celular bloqueado): o evento `push` abaixo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const API_URL = 'https://arquibancada-api.arquibancada-api.workers.dev';

// Safari (iPhone/Mac) cancela a inscrição de quem recebe push sem mostrar notificação; os outros
// navegadores aceitam não mostrar quando o site está na frente.
const SAFARI = /Safari/.test(self.navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(self.navigator.userAgent);

// Gol chegando por push. Com o site aberto e na frente, a página já avisa (com som): não repete.
self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || !data.title) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // Abas do site abertas (mesmo em segundo plano) tocam o som do site: no PC, a notificação do
      // sistema pode vir sem som. A página toca uma vez só por gol, mesmo se ela também o detectar.
      if (data.sound) clients.forEach((c) => c.postMessage({ source: 'arquibancada-push', tag: data.tag, sound: data.sound }));
      const options = { body: data.body, icon: data.icon || 'icon-192.png', tag: data.tag, data: { path: data.path || '' } };
      // Aviso de gol já mostrado (o serviço de push entregou de novo, ou a página mostrou antes): não
      // repete. Se ele ainda está na tela, "mostra" por cima com a mesma tag, sem som (nada muda para quem
      // vê; o navegador exige uma notificação para cada push).
      if (data.sound && data.tag && !(await firstShow(data.tag))) {
        const open = await self.registration.getNotifications({ tag: data.tag });
        if (open.length) return self.registration.showNotification(data.title, { ...options, silent: true });
        return;
      }
      const onScreen = clients.some((c) => c.focused && c.visibilityState === 'visible');
      if (onScreen && !data.always && !SAFARI) return;
      return self.registration.showNotification(data.title, options);
    }),
  );
});

// Clique na notificação: abre a partida (ou o site) numa aba do site já aberta, ou numa nova.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.path) || '', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const open = clients.find((c) => c.url.startsWith(self.registration.scope));
      if (!open) return self.clients.openWindow(url);
      const client = open.url === url || !('navigate' in open) ? open : ((await open.navigate(url).catch(() => null)) ?? open);
      return client.focus();
    }),
  );
});

// O navegador trocou a inscrição (expirou ou foi renovada): inscreve de novo e avisa o Worker.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options.applicationServerKey;
      const fresh = event.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (old) await post('/push/unsubscribe', { endpoint: old.endpoint });
      if (fresh) await post('/push/subscribe', fresh.toJSON());
    })(),
  );
});

function post(path, body) {
  return fetch(API_URL + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
}

// Avisos já mostrados, no IndexedDB: o mesmo banco que a página usa (browser-notifications.ts), para que
// um aviso nunca apareça duas vezes, venha da página ou do push. Registros com mais de 2 dias são apagados.
function firstShow(tag) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('arquibancada-avisos', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('mostrados');
      open.onerror = () => resolve(true);
      open.onsuccess = () => {
        const db = open.result;
        let first = true;
        const tx = db.transaction('mostrados', 'readwrite');
        const store = tx.objectStore('mostrados');
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
          if (typeof c.value === 'number' && now - c.value > 2 * 24 * 3600 * 1000) c.delete();
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
