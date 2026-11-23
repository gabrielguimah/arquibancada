/**
 * Nomes dos clubes como escritos no Brasil, por id da API-Football.
 * A API devolve nomes sem acento e com grafias próprias (ex.: "Vasco DA Gama", "Sao Paulo").
 * Times fora desta lista mantêm o nome da API.
 */
const TEAM_NAMES: Record<number, string> = {
  118: 'Bahia',
  119: 'Internacional',
  120: 'Botafogo',
  121: 'Palmeiras',
  124: 'Fluminense',
  126: 'São Paulo',
  127: 'Flamengo',
  128: 'Santos',
  130: 'Grêmio',
  131: 'Corinthians',
  132: 'Chapecoense',
  133: 'Vasco da Gama',
  134: 'Athletico-PR',
  135: 'Cruzeiro',
  136: 'Vitória',
  147: 'Coritiba',
  794: 'Bragantino',
  1062: 'Atlético-MG',
  1198: 'Remo',
  7848: 'Mirassol',
};

export function teamName(team: { id: number; name: string }): string {
  return TEAM_NAMES[team.id] ?? team.name;
}
