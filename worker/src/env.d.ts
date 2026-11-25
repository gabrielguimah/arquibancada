// Segredos definidos com `wrangler secret put` (não aparecem no wrangler.jsonc):
// - API_FOOTBALL_KEY: chave da API-Football;
// - VAPID_PRIVATE_KEY: chave privada (JWK) que assina as notificações de gol por push.
interface Env {
  API_FOOTBALL_KEY: string;
  VAPID_PRIVATE_KEY: string;
}
