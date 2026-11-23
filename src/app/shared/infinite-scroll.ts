/** Distância (px) do fim da lista em que já se carrega o próximo bloco de linhas. */
const THRESHOLD = 24;

/** Rolagem infinita: true quando a lista rolável chegou perto do fim. */
export function nearBottom(event: Event): boolean {
  const el = event.target as HTMLElement;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - THRESHOLD;
}
