// Envio de Web Push (notificação que chega com o site fechado), só com a WebCrypto, sem bibliotecas:
// - VAPID (RFC 8292): o Worker se identifica ao serviço de push (Google, Apple, Mozilla) com um JWT
//   assinado pela chave privada do servidor; a pública é a que o navegador recebeu ao se inscrever.
// - Conteúdo criptografado (RFC 8291, aes128gcm): só o navegador inscrito consegue ler a mensagem.

export interface PushTarget {
  endpoint: string;
  /** Chave pública do navegador (P-256, 65 bytes em base64url). */
  p256dh: string;
  /** Segredo de autenticação do navegador (16 bytes em base64url). */
  auth: string;
}

export interface Vapid {
  /** Chave privada (JWK de ECDSA P-256). */
  privateJwk: JsonWebKey;
  /** Chave pública (65 bytes em base64url), a mesma que o site usa ao se inscrever. */
  publicKey: string;
  /** Contato do remetente: `mailto:` ou URL `https:`. */
  subject: string;
}

export interface PushOptions {
  /** Por quanto tempo (s) o serviço de push guarda a mensagem se o aparelho estiver desligado. */
  ttl: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Criptografa `payload` para um navegador (RFC 8291): o corpo da requisição ao serviço de push. */
export async function encryptPayload(target: Pick<PushTarget, 'p256dh' | 'auth'>, payload: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Chaves da inscrição inválidas');

  // Par de chaves de uso único do servidor, para o acordo de chaves (ECDH) com o navegador.
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256),
  );

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // Um registro só: o conteúdo seguido do delimitador de último registro (0x02), sem preenchimento.
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plain));

  // Cabeçalho: salt (16), tamanho do registro (4, big-endian), tamanho da chave (1), chave pública (65).
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// JWT do VAPID por serviço de push (o `aud` é a origem do endpoint), reaproveitado por algumas horas.
const jwtCache = new Map<string, { token: string; exp: number }>();
let signingKey: { jwk: JsonWebKey; key: Promise<CryptoKey> } | null = null;

/** Cabeçalho `Authorization` do VAPID para o serviço de push de `endpoint`. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cached = jwtCache.get(aud);
  if (!cached || cached.exp - now / 1000 < 3600) {
    if (signingKey?.jwk !== vapid.privateJwk) {
      signingKey = {
        jwk: vapid.privateJwk,
        key: crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
      };
    }
    // Validade máxima aceita pelos serviços: 24 h. Fica em 12 h.
    const exp = Math.floor(now / 1000) + 12 * 3600;
    const part = (o: object) => b64urlEncode(enc.encode(JSON.stringify(o)));
    const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp, sub: vapid.subject })}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey.key, enc.encode(unsigned));
    jwtCache.set(aud, { token: `${unsigned}.${b64urlEncode(new Uint8Array(signature))}`, exp });
  }
  return `vapid t=${jwtCache.get(aud)!.token}, k=${vapid.publicKey}`;
}

/** Envia uma mensagem a um navegador inscrito. 404/410 na resposta: a inscrição não existe mais. */
export async function sendPush(target: PushTarget, payload: string, vapid: Vapid, options: PushOptions): Promise<Response> {
  const body = await encryptPayload(target, payload);
  return fetch(target.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuthorization(target.endpoint, vapid),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(options.ttl),
      urgency: options.urgency ?? 'normal',
    },
    body,
  });
}
