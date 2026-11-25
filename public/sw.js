// Service worker do Arquibancada: só serve para as notificações de gol. Não guarda nada em cache. É ele
// quem mostra todas, para nunca aparecer o mesmo aviso duas vezes (ver `firstShow`):
// - avisos da própria página (site aberto em segundo plano), pelo evento `message`;
// - push do Worker (site fechado, celular bloqueado), pelo evento `push`.
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
      const onScreen = clients.some((c) => c.focused && c.visibilityState === 'visible');
      // Aviso de gol (com `sound`): uma vez só. Os outros (confirmação de inscrição) sempre.
      return show(data, { once: !!data.sound, skip: onScreen && !data.always && !SAFARI });
    }),
  );
});

// Aviso da própria página (site aberto em segundo plano, sem push): mostra daqui, com a mesma regra.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.source === 'arquibancada-page' && data.notification && data.notification.title) {
    event.waitUntil(show(data.notification, { once: true, skip: false }));
  }
});

/**
 * Mostra a notificação. `once`: aviso de gol já mostrado (o serviço de push entregou de novo, ou a página
 * mostrou antes) não repete; se ele ainda está na tela, "mostra" por cima com a mesma tag, sem som (nada
 * muda para quem vê; o navegador exige uma notificação para cada push). `skip`: não mostra (site na frente,
 * a página já avisa), mas conta como mostrado.
 */
async function show(data, { once, skip }) {
  const options = { body: data.body, icon: data.icon || 'icon-192.png', tag: data.tag, data: { path: data.path || '' } };
  if (once && data.tag && !(await firstShow(data.tag))) {
    const open = await self.registration.getNotifications({ tag: data.tag });
    if (open.length) return self.registration.showNotification(data.title, { ...options, silent: true });
    return;
  }
  if (!skip) return self.registration.showNotification(data.title, options);
}

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

// JSON enviado como texto simples (sem a consulta CORS prévia); o Worker lê o JSON do texto.
function post(path, body) {
  return fetch(API_URL + path, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
}

// Avisos já mostrados (tag e hora), no IndexedDB, para que um aviso nunca apareça duas vezes, venha da
// página ou do push. Registros com mais de 2 dias são apagados.
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
