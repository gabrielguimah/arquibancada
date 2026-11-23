/**
 * Classe do selo de nota (0–10): faixas de 0,5 ponto de 6 a 10 (`r-60` … `r-95`, e `r-100` para o 10)
 * e `r-0` abaixo de 6. As cores de cada faixa vêm da paleta (rating-scale em styles.scss).
 */
export function ratingClass(value: number): string {
  const bin = value >= 10 ? 100 : value >= 6 ? Math.floor(value * 2) * 5 : 0;
  return `rating-badge r-${bin}`;
}
