// Números na tela, iguais em todo o site: no padrão brasileiro (vírgula nos decimais, ponto nos milhares:
// 6,8 · 57,1% · 1,70 · 13.791). Todo número com casa decimal passa por aqui.

const formats = new Map<string, Intl.NumberFormat>();

function format(min: number, max: number): Intl.NumberFormat {
  const key = `${min}-${max}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
    formats.set(key, f);
  }
  return f;
}

/**
 * Número com `digits` casas decimais fixas (ex.: 1,70; 6,8; 13.791). `maxDigits` maior que `digits`
 * deixa as casas extras só quando houver (ex.: 57,1% e 57%).
 */
export function formatNumber(value: number, digits = 0, maxDigits = digits): string {
  return format(digits, Math.max(digits, maxDigits)).format(value);
}

/** Porcentagem com até `maxDigits` casas (ex.: 57,1%). */
export function formatPercent(value: number, digits = 1, maxDigits = digits): string {
  return `${formatNumber(value, digits, maxDigits)}%`;
}
