/**
 * Clubes da Série A: id na API-Football, nome como escrito no Brasil e id na CBF (usado pelo Worker no
 * "Onde assistir"). A API devolve nomes sem acento e com grafias próprias (ex.: "Vasco DA Gama", "Sao
 * Paulo"). Times fora desta lista mantêm o nome da API. Clube promovido: uma linha nova aqui.
 */
const CLUBS: Array<{ id: number; name: string; cbf: string }> = [
  { id: 118, name: 'Bahia', cbf: '61377' },
  { id: 119, name: 'Internacional', cbf: '20011' },
  { id: 120, name: 'Botafogo', cbf: '60175' },
  { id: 121, name: 'Palmeiras', cbf: '20002' },
  { id: 124, name: 'Fluminense', cbf: '20014' },
  { id: 126, name: 'São Paulo', cbf: '20005' },
  { id: 127, name: 'Flamengo', cbf: '20016' },
  { id: 128, name: 'Santos', cbf: '20008' },
  { id: 130, name: 'Grêmio', cbf: '20013' },
  { id: 131, name: 'Corinthians', cbf: '20001' },
  { id: 132, name: 'Chapecoense', cbf: '20086' },
  { id: 133, name: 'Vasco da Gama', cbf: '60646' },
  { id: 134, name: 'Athletico-PR', cbf: '20052' },
  { id: 135, name: 'Cruzeiro', cbf: '59849' },
  { id: 136, name: 'Vitória', cbf: '20018' },
  { id: 147, name: 'Coritiba', cbf: '61590' },
  { id: 794, name: 'Bragantino', cbf: '20007' },
  { id: 1062, name: 'Atlético-MG', cbf: '62194' },
  { id: 1198, name: 'Remo', cbf: '20022' },
  { id: 7848, name: 'Mirassol', cbf: '20385' },
];

const TEAM_NAMES = new Map(CLUBS.map((c) => [c.id, c.name]));

/** Id na API-Football de cada clube, pelo id na CBF. */
export const TEAM_ID_BY_CBF = new Map(CLUBS.map((c) => [c.cbf, c.id]));

export function teamName(team: { id: number; name: string }): string {
  return TEAM_NAMES.get(team.id) ?? team.name;
}
