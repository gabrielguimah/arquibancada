import { Directive } from '@angular/core';

/**
 * Jogador sem foto: a mesma imagem padrão (silhueta cinza) que a API mostra para quem não tem foto,
 * guardada no site para os jogadores que nem id têm.
 */
export const PLAYER_PLACEHOLDER = 'player-placeholder.png';

/**
 * Foto de jogador (`<img playerPhoto>`): se a imagem não existir (404), troca pela imagem padrão em vez
 * do ícone de imagem quebrada.
 */
@Directive({
  selector: 'img[playerPhoto]',
  host: { '(error)': 'fallback($event)' },
})
export class PlayerPhoto {
  protected fallback(event: Event) {
    const img = event.target as HTMLImageElement;
    if (!img.src.endsWith(PLAYER_PLACEHOLDER)) img.src = PLAYER_PLACEHOLDER;
  }
}

// A API serve imagens de "sem foto" no próprio endereço da foto de alguns técnicos, e elas carregam
// normalmente (não dão erro):
// - a silhueta cinza "NO PHOTO YET" (ex.: E. Domínguez), reconhecida pelo tom de cinza;
// - um escudo cinza (já foi o caso do Seedorf), reconhecido pela transparência (alfa).
// As duas têm 150 x 150 e são conferidas numa grade de 7 x 7 pontos, exata (PNG) e que não depende das
// cores do navegador.
const PLACEHOLDER_SIZE = 150;
const GRID = [10, 30, 50, 70, 90, 110, 130];
const TOLERANCE = 40;

interface Fingerprint {
  /** Canal conferido em cada ponto: 0 = vermelho (a silhueta é cinza, R = G = B), 3 = alfa. */
  channel: 0 | 3;
  grid: number[][];
}

const PLACEHOLDERS: Fingerprint[] = [
  {
    channel: 0,
    grid: [
      [255, 255, 255, 199, 203, 255, 255],
      [255, 255, 255, 199, 197, 255, 255],
      [255, 255, 255, 199, 255, 255, 255],
      [255, 199, 199, 255, 255, 199, 255],
      [255, 201, 202, 201, 201, 197, 205],
      [255, 232, 255, 255, 247, 241, 196],
      [255, 199, 200, 255, 253, 199, 202],
    ],
  },
  {
    channel: 3,
    grid: [
      [0, 0, 109, 108, 108, 0, 0],
      [0, 0, 255, 254, 254, 0, 0],
      [0, 0, 0, 255, 255, 255, 0],
      [0, 0, 254, 255, 255, 255, 0],
      [0, 0, 0, 254, 0, 184, 0],
      [0, 0, 0, 0, 142, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ],
  },
];

/** A imagem é uma das de "sem foto" da API? (Precisa de CORS: `crossorigin` na imagem.) */
export function isApiPlaceholder(img: HTMLImageElement): boolean {
  if (img.naturalWidth !== PLACEHOLDER_SIZE || img.naturalHeight !== PLACEHOLDER_SIZE) return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PLACEHOLDER_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
    const at = (r: number, c: number) => (GRID[r] * PLACEHOLDER_SIZE + GRID[c]) * 4;
    return PLACEHOLDERS.some(({ channel, grid }) =>
      grid.every((row, r) =>
        row.every((value, c) => {
          const i = at(r, c);
          // Silhueta: o ponto também tem de ser cinza (foto colorida com o mesmo vermelho não conta).
          const grey = channel !== 0 || (Math.abs(data[i] - data[i + 1]) <= TOLERANCE && Math.abs(data[i + 1] - data[i + 2]) <= TOLERANCE);
          return grey && Math.abs(data[i + channel] - value) <= TOLERANCE;
        }),
      ),
    );
  } catch {
    // Imagem sem CORS (canvas "sujo"): não dá para olhar os pixels; fica como está.
    return false;
  }
}

/**
 * Foto de técnico (`<img coachPhoto>`): sem foto, foto quebrada ou uma imagem de "sem foto" da API viram a
 * mesma silhueta cinza dos jogadores sem foto.
 */
@Directive({
  selector: 'img[coachPhoto]',
  host: { crossorigin: 'anonymous', '(error)': 'fallback($event)', '(load)': 'check($event)' },
})
export class CoachPhoto {
  protected fallback(event: Event) {
    const img = event.target as HTMLImageElement;
    if (!img.src.endsWith(PLAYER_PLACEHOLDER)) img.src = PLAYER_PLACEHOLDER;
  }

  protected check(event: Event) {
    const img = event.target as HTMLImageElement;
    if (!img.src.endsWith(PLAYER_PLACEHOLDER) && isApiPlaceholder(img)) img.src = PLAYER_PLACEHOLDER;
  }
}
