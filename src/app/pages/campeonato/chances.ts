import { Standing } from '../../api/api-football';

/** Zona de uma posição da tabela, para as chances (a pré-Libertadores conta como Libertadores). */
export type ChanceZone = 'libertadores' | 'sulamericana' | 'rebaixamento' | null;

/** Jogo que ainda falta (ou ainda está rolando) para a simulação. */
export interface SimMatch {
  home: number;
  away: number;
  /** Placar atual (jogo em andamento); 0 × 0 se não começou. */
  homeGoals: number;
  awayGoals: number;
  /** Fração do jogo que falta: 1 se não começou, 0,5 no intervalo, 0 nos acréscimos do fim. */
  remaining: number;
}

/** Chance (0 a 1) de cada desfecho para um time. */
export interface TeamChances {
  title: number;
  libertadores: number;
  sulamericana: number;
  relegation: number;
}

export const SIMULATIONS = 10_000;

// Peso (em jogos com média da liga) que puxa ataque e defesa de cada time para a média: com poucos jogos
// disputados, um placar fora da curva não vira "força" do time.
const PRIOR_GAMES = 6;
// Vantagem de jogar em casa: no Brasileirão, o mandante faz cerca de 1,3 vez os gols do visitante.
const HOME_FACTOR = 1.15;
const AWAY_FACTOR = 0.87;

/**
 * Chances de título, Libertadores, Sul-Americana e rebaixamento: simula os jogos que faltam `runs`
 * vezes a partir da classificação `table` (já com os jogos encerrados) e conta onde cada time termina.
 *
 * Gols de cada time num jogo: Poisson com média = gols por jogo da liga × ataque do time × defesa do
 * adversário (gols feitos/sofridos por jogo em relação à média), com o fator casa/fora. Jogo em
 * andamento parte do placar atual, com a média proporcional ao tempo que falta. Desempate: pontos,
 * vitórias, saldo, gols marcados e, no empate total, sorteio (o confronto direto e os cartões ficam de
 * fora). `zones[i]` é a zona da posição i + 1. A sequência aleatória é fixa (`seed`): com os mesmos
 * dados, os números não mudam a cada atualização da página.
 */
export function simulateChances(
  table: Standing[],
  matches: SimMatch[],
  zones: ChanceZone[],
  runs = SIMULATIONS,
  seed = 2026,
): Map<number, TeamChances> {
  const n = table.length;
  const index = new Map(table.map((s, i) => [s.team.id, i]));
  const played = table.reduce((t, s) => t + s.all.played, 0);
  const scored = table.reduce((t, s) => t + s.all.goals.for, 0);
  const mu = played ? scored / played : 1.2;
  const strength = (goals: number, games: number) => (goals + PRIOR_GAMES * mu) / ((games + PRIOR_GAMES) * mu);
  const attack = table.map((s) => strength(s.all.goals.for, s.all.played));
  const defense = table.map((s) => strength(s.all.goals.against, s.all.played));

  const games = matches
    .filter((m) => index.has(m.home) && index.has(m.away))
    .map((m) => {
      const h = index.get(m.home)!;
      const a = index.get(m.away)!;
      const left = Math.min(1, Math.max(0, m.remaining));
      return {
        h,
        a,
        hg: m.homeGoals,
        ag: m.awayGoals,
        lh: mu * HOME_FACTOR * attack[h] * defense[a] * left,
        la: mu * AWAY_FACTOR * attack[a] * defense[h] * left,
      };
    });

  const counts = table.map(() => ({ title: 0, libertadores: 0, sulamericana: 0, relegation: 0 }));
  const random = mulberry32(seed);
  const points = new Float64Array(n);
  const wins = new Float64Array(n);
  const diff = new Float64Array(n);
  const goals = new Float64Array(n);
  const lot = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);

  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < n; i++) {
      const s = table[i];
      points[i] = s.points;
      wins[i] = s.all.win;
      diff[i] = s.goalsDiff;
      goals[i] = s.all.goals.for;
      lot[i] = random();
    }
    for (const g of games) {
      const hg = g.hg + poisson(g.lh, random);
      const ag = g.ag + poisson(g.la, random);
      goals[g.h] += hg;
      goals[g.a] += ag;
      diff[g.h] += hg - ag;
      diff[g.a] += ag - hg;
      if (hg > ag) {
        points[g.h] += 3;
        wins[g.h]++;
      } else if (ag > hg) {
        points[g.a] += 3;
        wins[g.a]++;
      } else {
        points[g.h]++;
        points[g.a]++;
      }
    }
    order.sort((x, y) => points[y] - points[x] || wins[y] - wins[x] || diff[y] - diff[x] || goals[y] - goals[x] || lot[x] - lot[y]);
    for (let pos = 0; pos < n; pos++) {
      const c = counts[order[pos]];
      if (pos === 0) c.title++;
      const zone = zones[pos];
      if (zone === 'libertadores') c.libertadores++;
      else if (zone === 'sulamericana') c.sulamericana++;
      else if (zone === 'rebaixamento') c.relegation++;
    }
  }

  return new Map(
    table.map((s, i) => [
      s.team.id,
      {
        title: counts[i].title / runs,
        libertadores: counts[i].libertadores / runs,
        sulamericana: counts[i].sulamericana / runs,
        relegation: counts[i].relegation / runs,
      },
    ]),
  );
}

/** Gols de Poisson com média `lambda` (método de Knuth: médias pequenas, como as de futebol). */
function poisson(lambda: number, random: () => number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = random();
  while (p > limit) {
    k++;
    p *= random();
  }
  return k;
}

/** Gerador pseudoaleatório pequeno e rápido, com semente (mesma sequência a cada simulação). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chance em texto: "0%", "<1%", "37%", ">99%", "100%". */
export function formatChance(p: number): string {
  if (p <= 0) return '0%';
  if (p >= 1) return '100%';
  if (p < 0.005) return '<1%';
  if (p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}
