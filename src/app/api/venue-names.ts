// Cidades dos estádios como o site mostra. A API-Football manda a mesma cidade de vários jeitos: sem
// acento ("Sao Paulo", "Belem"), traduzida ("El Salvador", "Braganza") ou simplesmente errada ("Bello
// Harisanta", "Mirasol"). A chave é o nome da API sem acento e em minúsculas.
const CITIES: Record<string, string> = {
  'sao paulo': 'São Paulo',
  belem: 'Belém',
  chapeco: 'Chapecó',
  salvador: 'Salvador',
  'el salvador': 'Salvador',
  'belo horizonte': 'Belo Horizonte',
  'bello harisanta': 'Belo Horizonte',
  'braganca paulista': 'Bragança Paulista',
  braganza: 'Bragança Paulista',
  mirassol: 'Mirassol',
  mirasol: 'Mirassol',
  brasilia: 'Brasília',
  'rio de janeiro': 'Rio de Janeiro',
  'porto alegre': 'Porto Alegre',
  curitiba: 'Curitiba',
  santos: 'Santos',
  barueri: 'Barueri',
  campinas: 'Campinas',
  goiania: 'Goiânia',
  florianopolis: 'Florianópolis',
  fortaleza: 'Fortaleza',
  recife: 'Recife',
  cuiaba: 'Cuiabá',
};

// Estádio com a cidade errada na API (o nome está certo, a cidade não): a cidade vem do estádio.
const VENUE_CITIES: Record<string, string> = {
  'vila belmiro': 'Santos',
  'estadio urbano caldeira': 'Santos',
  'arena mrv': 'Belo Horizonte',
  'mrv arena': 'Belo Horizonte',
};

/** Estádio com a cidade corrigida (e com acento); cidade desconhecida fica como veio. */
export function venueWithCity<V extends { name: string | null; city: string | null }>(venue: V): V {
  const byVenue = venue.name ? VENUE_CITIES[key(venue.name)] : undefined;
  const city = byVenue ?? (venue.city ? (CITIES[key(venue.city)] ?? venue.city.trim()) : venue.city);
  return city === venue.city ? venue : { ...venue, city };
}

function key(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
