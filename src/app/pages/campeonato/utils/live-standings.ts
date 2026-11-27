import { Fixture, FormMatch, Standing } from '../../../api/api-football';
import { isLive } from '../../../shared/components/fixture-card/fixture-card';

/** Status de jogo encerrado que conta na classificação. */
export const FINISHED = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

/**
 * Classificação ao vivo: a da API mais os jogos que ela ainda não contou. A API só atualiza a
 * classificação um tempo depois do apito final, então entram aqui:
 * - jogos em andamento, com o placar do momento (pontos, saldo, gols e "Últimas 5" provisórios);
 * - jogos já encerrados que a API ainda não contou. Para saber quais, compara os jogos encerrados
 *   de cada time na temporada (`seasonFinished`) com os jogos disputados na classificação: se o time
 *   tem mais jogos encerrados que disputados, os mais recentes ainda não entraram. Sem essa lista,
 *   os encerrados são considerados já contados.
 *
 * Depois reordena pelos critérios do Brasileirão (pontos, vitórias, saldo, gols marcados; o resto
 * fica na ordem anterior). As zonas (Libertadores, rebaixamento…) acompanham a posição, não o time.
 * `change` diz quantas posições cada time ganhou (+) ou perdeu (−) só com os jogos em andamento, em
 * relação à classificação com todos os encerrados (inclusive os que a API ainda não contou). Sem jogo
 * em andamento, não há `change`.
 */
export function liveStandings(base: Standing[], fixtures: Fixture[], seasonFinished: Fixture[] | null): Standing[] {
  const rows = new Map(base.map((s) => [s.team.id, s]));
  const known = [...new Map(fixtures.map((f) => [f.fixture.id, f])).values()].filter(
    (f) => rows.has(f.teams.home.id) && rows.has(f.teams.away.id) && f.goals.home != null && f.goals.away != null,
  );

  const finished = seasonFinished ? uncounted(base, known, seasonFinished) : [];
  const settled = finished.length ? withGames(base, finished) : base;
  const live = known.filter(isLive);
  if (!live.length) return settled;

  const before = new Map(settled.map((s) => [s.team.id, s.rank]));
  return withGames(settled, live).map((s) => ({ ...s, change: before.get(s.team.id)! - s.rank }));
}

/** Classificação `table` com os jogos `games` somados e reordenada; empate total mantém a ordem anterior. */
function withGames(table: Standing[], games: Fixture[]): Standing[] {
  const next = new Map(table.map((s) => [s.team.id, clone(s)]));
  for (const f of games) {
    const final = FINISHED.has(f.fixture.status.short);
    const match = { id: f.fixture.id, t: f.fixture.timestamp, h: f.teams.home.id, a: f.teams.away.id, hg: f.goals.home!, ag: f.goals.away! };
    apply(next.get(f.teams.home.id)!, f.goals.home!, f.goals.away!, final, match);
    apply(next.get(f.teams.away.id)!, f.goals.away!, f.goals.home!, final, match);
  }
  return [...next.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.all.win - a.all.win ||
        b.goalsDiff - a.goalsDiff ||
        b.all.goals.for - a.all.goals.for ||
        a.rank - b.rank,
    )
    .map((s, i) => ({ ...s, rank: i + 1, description: table[i].description }));
}

/** Jogos encerrados (entre os conhecidos) que a classificação da API ainda não contou. */
function uncounted(base: Standing[], known: Fixture[], seasonFinished: Fixture[]): Fixture[] {
  const finished = new Map(seasonFinished.map((f) => [f.fixture.id, f]));
  for (const f of known) if (FINISHED.has(f.fixture.status.short)) finished.set(f.fixture.id, f);

  // Jogos encerrados que faltam contar, por time.
  const missing = new Map(base.map((s) => [s.team.id, -s.all.played]));
  for (const f of finished.values()) {
    for (const id of [f.teams.home.id, f.teams.away.id]) {
      if (missing.has(id)) missing.set(id, missing.get(id)! + 1);
    }
  }

  // Do mais recente para o mais antigo; a API conta os dois times de uma vez, então os dois precisam faltar.
  const result: Fixture[] = [];
  const recent = known
    .filter((f) => FINISHED.has(f.fixture.status.short))
    .sort((a, b) => b.fixture.timestamp - a.fixture.timestamp);
  for (const f of recent) {
    const { home, away } = f.teams;
    if ((missing.get(home.id) ?? 0) > 0 && (missing.get(away.id) ?? 0) > 0) {
      missing.set(home.id, missing.get(home.id)! - 1);
      missing.set(away.id, missing.get(away.id)! - 1);
      result.push(f);
    }
  }
  return result;
}

function apply(s: Standing, scored: number, conceded: number, final: boolean, match: FormMatch) {
  const result = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
  s.all.played++;
  s.all.goals.for += scored;
  s.all.goals.against += conceded;
  s.goalsDiff += scored - conceded;
  if (result === 'W') {
    s.all.win++;
    s.points += 3;
  } else if (result === 'D') {
    s.all.draw++;
    s.points += 1;
  } else {
    s.all.lose++;
  }
  // "Últimas 5": a API manda o mais recente primeiro. Resultado parcial de jogo em andamento fica marcado.
  s.form = (result + (s.form ?? '')).slice(0, 5);
  if (s.formMatches) s.formMatches = [match, ...s.formMatches].slice(0, 5);
  if (!final) s.liveForm = true;
}

function clone(s: Standing): Standing {
  return { ...s, all: { ...s.all, goals: { ...s.all.goals } } };
}
