import { formatNumber } from './number-format';

/**
 * Classe do selo de nota (0–10): uma por décimo, de `r-50` (5,0 ou menos) a `r-100` (10). As cores de
 * cada décimo vêm da paleta (rating-gradient em styles.scss).
 */
/** Selo cinza "Indef." para jogador sem nota (o tooltip diz "Indefinido"). */
export const NO_RATING_CLASS = 'rating-badge r-none';
export const NO_RATING_LABEL = 'Indef.';
export const NO_RATING_TITLE = 'Indefinido';

export function ratingClass(value: number): string {
  // Décimo da nota, sem arredondar para cima (7,49 é 7,4); o 1e-9 evita erro de ponto flutuante (7,3 * 10).
  const tenth = Math.min(100, Math.max(50, Math.floor(value * 10 + 1e-9)));
  return `rating-badge r-${tenth}`;
}

/** Nota com uma casa decimal ("8,2", nunca "8,20"); a nota máxima é só "10". */
export function formatRating(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded >= 10 ? '10' : formatNumber(rounded, 1);
}
