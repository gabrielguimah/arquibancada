// "Onde assistir" (canais de transmissão, do site da CBF): o formato que o Worker manda ao site e a
// limpeza dos nomes dos canais. Sem Angular: o Worker importa este arquivo.

/** Jogo da Série A com os canais, como o Worker manda (`/onde-assistir?date=`). */
export interface Broadcast {
  /** Id do time na API-Football; `null` se o clube não está na tabela (aí vale o nome). */
  home: number | null;
  away: number | null;
  homeName: string;
  awayName: string;
  channels: string[];
}

// Nomes dos canais como a CBF manda → como o site mostra.
const CHANNEL_NAMES: Record<string, string> = {
  sportv: 'SporTV',
  'amazon prime': 'Prime Video',
  'amazon prime video': 'Prime Video',
  'youtube / cazé tv': 'CazéTV (YouTube)',
  'cazé tv': 'CazéTV',
  'ge tv': 'ge tv (YouTube)',
};

export function channelName(name: string): string {
  return CHANNEL_NAMES[name.trim().toLowerCase()] ?? name.trim();
}
