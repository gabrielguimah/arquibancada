import { Broadcast, Fixture } from '../../api/api-football';

/**
 * Canais do jogo, pela lista do "Onde assistir" da CBF no dia. Casa pelo id dos times (a tabela do Worker)
 * e, para clube fora da tabela, pelo nome. Sem o jogo na lista: lista vazia (a seção não aparece).
 */
export function channelsFor(f: Fixture, games: Broadcast[]): string[] {
  const { home, away } = f.teams;
  const game =
    games.find((g) => g.home === home.id && g.away === away.id) ??
    games.find((g) => sameTeam(g.home, g.homeName, home) && sameTeam(g.away, g.awayName, away));
  return game?.channels ?? [];
}

function sameTeam(id: number | null, cbfName: string, team: { id: number; name: string }): boolean {
  if (id !== null) return id === team.id;
  const a = normalize(cbfName);
  const b = normalize(team.name);
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

/** Nome sem acento, sem sufixos de empresa ("SAF", "FC") e sem o que não é letra. */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(saf|fc|ec|sc|clube|futebol)\b/g, '')
    .replace(/[^a-z]/g, '');
}
