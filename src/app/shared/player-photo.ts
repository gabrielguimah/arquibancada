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

/** Técnico sem foto: a imagem padrão da API para técnicos ("no photo yet"), guardada no site. */
export const COACH_PLACEHOLDER = 'coach-placeholder.png';

// A API também usa um escudo cinza como "sem foto" de alguns técnicos, servido no endereço da foto
// (ex.: Seedorf). Ele é reconhecido pela transparência (alfa) numa grade de 7 x 7 pontos da imagem de
// 150 x 150, que é exata (PNG) e não depende das cores do navegador.
const SHIELD_SIZE = 150;
const SHIELD_GRID = [10, 30, 50, 70, 90, 110, 130];
const SHIELD_ALPHA = [
  [0, 0, 109, 108, 108, 0, 0],
  [0, 0, 255, 254, 254, 0, 0],
  [0, 0, 0, 255, 255, 255, 0],
  [0, 0, 254, 255, 255, 255, 0],
  [0, 0, 0, 254, 0, 184, 0],
  [0, 0, 0, 0, 142, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
];
const ALPHA_TOLERANCE = 40;

/** A imagem é o escudo de "sem foto" da API? (Precisa de CORS: `crossorigin` na imagem.) */
export function isPlaceholderShield(img: HTMLImageElement): boolean {
  if (img.naturalWidth !== SHIELD_SIZE || img.naturalHeight !== SHIELD_SIZE) return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SHIELD_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, SHIELD_SIZE, SHIELD_SIZE);
    return SHIELD_ALPHA.every((row, r) =>
      row.every((alpha, c) => Math.abs(data[(SHIELD_GRID[r] * SHIELD_SIZE + SHIELD_GRID[c]) * 4 + 3] - alpha) <= ALPHA_TOLERANCE),
    );
  } catch {
    // Imagem sem CORS (canvas "sujo"): não dá para olhar os pixels; fica como está.
    return false;
  }
}

/**
 * Foto de técnico (`<img coachPhoto>`): sem foto, foto quebrada ou o escudo de "sem foto" da API viram a
 * mesma imagem padrão de técnico, para os dois técnicos ficarem iguais.
 */
@Directive({
  selector: 'img[coachPhoto]',
  host: { crossorigin: 'anonymous', '(error)': 'fallback($event)', '(load)': 'check($event)' },
})
export class CoachPhoto {
  protected fallback(event: Event) {
    const img = event.target as HTMLImageElement;
    if (!img.src.endsWith(COACH_PLACEHOLDER)) img.src = COACH_PLACEHOLDER;
  }

  protected check(event: Event) {
    const img = event.target as HTMLImageElement;
    if (!img.src.endsWith(COACH_PLACEHOLDER) && isPlaceholderShield(img)) img.src = COACH_PLACEHOLDER;
  }
}
