/**
 * Chave de cache de uma busca à API: caminho + parâmetros em ordem alfabética. A mesma para o site e para
 * o push dos gols, então os dois compartilham o cache (e as chamadas à API).
 */
export function keyFor(path: string, params: Iterable<[string, string]> | Record<string, string>): string {
  const entries = Symbol.iterator in params ? [...(params as Iterable<[string, string]>)] : Object.entries(params);
  return `${path}?${new URLSearchParams(entries.sort(([a], [b]) => a.localeCompare(b)))}`;
}
