import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { teamName } from './team-names';

/** Worker da Cloudflare que guarda a chave e faz cache das respostas da API-Football. */
export const API_URL = 'https://arquibancada-api.arquibancada-api.workers.dev';
export const LEAGUE = 71;
export const SEASON = 2026;

export const LIVE_STATUSES = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'];

export interface Team {
  id: number;
  name: string;
  logo: string;
  winner?: boolean | null;
}

export interface Fixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    venue: { name: string | null; city: string | null };
    status: {
      long: string;
      short: string;
      elapsed: number | null;
      extra: number | null;
      /** Só com bola rolando, vindo do Worker: instante (ms) em que o relógio do período marcaria 00:00. */
      clockStart?: number;
    };
  };
  /** Liga e rodada ("Regular Season - 36"). */
  league?: { id: number; name: string; logo: string; round: string };
  teams: { home: Team; away: Team };
  goals: { home: number | null; away: number | null };
  /** Placar por etapa (intervalo, fim do tempo normal, prorrogação, pênaltis). */
  score?: Record<'halftime' | 'fulltime' | 'extratime' | 'penalty', { home: number | null; away: number | null }>;
  /** Só nas buscas por id (`fixturesByIds`): gols, cartões, substituições… */
  events?: FixtureEvent[];
  /** Só nas buscas por id: escalações (sai cerca de 1 h antes do jogo). */
  lineups?: Lineup[];
  /** Só nas buscas por id: números de cada jogador na partida (nota, minutos, capitão…). */
  players?: FixtureTeamPlayers[];
  /** Só nas buscas por id, depois do início: estatísticas de cada time (posse, chutes, xG…). */
  statistics?: FixtureTeamStats[];
}

/** Estatísticas de um time na partida: `type` em inglês ("Ball Possession"), valor número, "56%" ou "1.74". */
export interface FixtureTeamStats {
  team: Team;
  statistics: Array<{ type: string; value: number | string | null }>;
}

/** Jogador na escalação. `grid` é "linha:coluna" (1:1 é o goleiro; coluna 1 é a esquerda do time). */
export interface LineupPlayer {
  /** `null` para jogador que a API não tem cadastrado. */
  id: number | null;
  name: string;
  number: number | null;
  pos: string | null;
  grid: string | null;
}

export interface Lineup {
  team: Team;
  /** "4-2-3-1", "3-4-1-2"… */
  formation: string | null;
  startXI: Array<{ player: LineupPlayer }>;
  substitutes: Array<{ player: LineupPlayer }>;
  coach: { id: number | null; name: string | null; photo: string | null } | null;
}

export interface FixtureTeamPlayers {
  team: Team;
  players: Array<{
    player: { id: number; name: string; photo: string };
    statistics: Array<{
      games: { minutes: number | null; rating: string | null; captain: boolean; substitute: boolean };
      // Números do jogador na partida (somados por time nas estatísticas da partida).
      passes?: { total: number | null; key: number | null };
      tackles?: { total: number | null; interceptions: number | null };
      duels?: { total: number | null; won: number | null };
      dribbles?: { attempts: number | null; success: number | null };
      fouls?: { drawn: number | null; committed: number | null };
      penalty?: { won: number | null; commited: number | null };
    }>;
  }>;
}

/**
 * Desfalque de uma partida (`injuries`): lesionado, suspenso ou fora por outro motivo. `type` é
 * "Missing Fixture" (fora) ou "Questionable" (dúvida); `reason` vem em inglês ("Knee Injury", "Red Card"…).
 */
export interface Injury {
  player: { id: number | null; name: string; photo: string | null; type: string; reason: string | null };
  team: Team;
}

/** Técnico (nome e foto). */
export interface Coach {
  name: string;
  photo: string | null;
}

/** Técnico como vem de `coachs`: com a carreira, para achar o atual de cada time (`end` nulo). */
interface CoachCareer extends Coach {
  career: Array<{ team: { id: number }; start: string | null; end: string | null }>;
}

/** Evento de uma partida. Gol: type "Goal", detail "Normal Goal", "Own Goal", "Penalty" ou "Missed Penalty". */
export interface FixtureEvent {
  time: { elapsed: number | null; extra: number | null };
  team: Team;
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
  /** Motivo do cartão ("Foul", "Time Wasting"…), quando a API informa. */
  comments?: string | null;
}

export interface Standing {
  rank: number;
  team: Team;
  points: number;
  goalsDiff: number;
  form: string | null;
  description: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
  /** Só na classificação ao vivo: posições ganhas (+) ou perdidas (−) com os jogos em andamento. */
  change?: number;
  /** Só na classificação ao vivo: o primeiro resultado de `form` é o parcial de um jogo em andamento. */
  liveForm?: boolean;
}

/** Item de `players/topscorers` e `players/topassists`. */
export interface PlayerStat {
  player: { id: number; name: string; photo: string };
  statistics: Array<{
    team: Team;
    games: { appearences: number | null; minutes: number | null; rating: string | null };
    goals: { total: number | null; assists: number | null };
    penalty: { scored: number | null };
  }>;
}

/** Item do ranking de notas montado pelo Worker (`players/toprated`). */
export interface RatedPlayer {
  player: { id: number; name: string; photo: string };
  team: Team;
  rating: number;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
}

/** Resposta de `players/toprated`: ranking dos regulares (`response`) e de todos (`all`). */
export interface TopRated {
  updatedAt: string;
  maxAppearances: number;
  minAppearances: number;
  response: RatedPlayer[];
  all: RatedPlayer[];
}

/** Números de um time somados nos jogos considerados (posse de bola é média). Calculados no Worker. */
export interface TeamStats {
  goalsFor: number;
  goalsAgainst: number;
  yellowCards: number;
  redCards: number;
  possession: number;
  passesAccurate: number;
  shots: number;
  shotsOnGoal: number;
  dribbles: number;
  tackles: number;
  interceptions: number;
  corners: number;
  fouls: number;
  penaltyGoals: number;
  penaltiesConceded: number;
  cleanSheets: number;
  xg: number;
  keyPasses: number;
}

/** Um time numa das tabelas de estatísticas (temporada ou últimas 5). */
export interface TeamRating {
  team: Team;
  /** Nota média; `null` enquanto ainda não foi calculada. */
  rating: number | null;
  games?: number;
  stats?: TeamStats;
  /** Só na tabela das últimas partidas: a nota do time em cada jogo, do mais recente ao mais antigo. */
  matches?: number[];
}

/** Resposta de `teams/ratings`; cada lista é `null` enquanto ainda não foi calculada. */
export interface TeamRatings {
  updatedAt: string;
  season: TeamRating[] | null;
  last5: TeamRating[] | null;
}

/** Jogador no time da rodada: nota e posição no jogo da rodada (G, D, M ou F). */
export interface RoundPlayer {
  player: { id: number; name: string; photo: string };
  team: Team;
  rating: number;
  minutes: number;
  position: 'G' | 'D' | 'M' | 'F';
  // Para o desempate do melhor da rodada (opcionais: respostas antigas do cache não têm).
  goals?: number;
  assists?: number;
  yellowCards?: number;
  redCards?: number;
  /** Resultado do time do jogador no jogo: vitória, empate ou derrota. */
  result?: 'W' | 'D' | 'L';
}

/** Resposta de `players/team-of-round`: 4-3-3 com as melhores notas dos jogos encerrados da rodada. */
export interface RoundTeam {
  round: string;
  formation: string;
  /** Jogos encerrados da rodada (`totalGames` é o total da rodada). */
  games: number;
  totalGames: number;
  players: RoundPlayer[];
}

/** Jogador na tabela de jogadores (`players/stats`): soma dos clubes dele no Brasileirão. */
export interface PlayerRow {
  id: number;
  name: string;
  photo: string;
  /** Clube onde mais jogou no campeonato. */
  team: Team;
  /** G (goleiro), D, M ou F (atacante). */
  position: string | null;
  appearances: number;
  minutes: number;
  rating: number | null;
  goals: number;
  assists: number;
  shots: number;
  shotsOn: number;
  passes: number;
  keyPasses: number;
  /** Acerto no passe (%). */
  passAccuracy: number | null;
  tackles: number;
  interceptions: number;
  blocks: number;
  duels: number;
  duelsWon: number;
  dribbles: number;
  dribblesWon: number;
  foulsDrawn: number;
  foulsCommitted: number;
  yellowCards: number;
  redCards: number;
  penaltiesScored: number;
  penaltiesMissed: number;
  penaltiesWon: number;
  penaltiesCommitted: number;
  saves: number;
  goalsConceded: number;
  penaltiesSaved: number;
}

/** Resposta de `players/stats`, montada no Worker. */
export interface PlayerStats {
  updatedAt: string;
  /** Mínimo de jogos do filtro "Regulares". */
  minAppearances: number;
  players: PlayerRow[];
}

interface ApiResponse<T> {
  response: T;
}

@Injectable({ providedIn: 'root' })
export class ApiFootball {
  private http = inject(HttpClient);

  private get<T>(path: string, params: Record<string, string | number | boolean>): Observable<T> {
    return this.http
      .get<ApiResponse<T>>(`${API_URL}/${path}`, { params: { league: LEAGUE, season: SEASON, ...params } })
      .pipe(map((r) => r.response));
  }

  /** Todas as rodadas da temporada, em ordem. */
  rounds(): Observable<string[]> {
    return this.get('fixtures/rounds', {});
  }

  currentRound(): Observable<string> {
    return this.get<string[]>('fixtures/rounds', { current: true }).pipe(map((r) => r[0]));
  }

  fixtures(round: string): Observable<Fixture[]> {
    return this.get<Fixture[]>('fixtures', { round }).pipe(map(renameFixtures));
  }

  /** Jogos do Brasileirão numa data (AAAA-MM-DD), no fuso de Brasília. */
  fixturesOn(date: string): Observable<Fixture[]> {
    return this.get<Fixture[]>('fixtures', { date, timezone: 'America/Sao_Paulo' }).pipe(map(renameFixtures));
  }

  topScorers(): Observable<PlayerStat[]> {
    return this.get<PlayerStat[]>('players/topscorers', {}).pipe(map(renamePlayerStats));
  }

  topAssists(): Observable<PlayerStat[]> {
    return this.get<PlayerStat[]>('players/topassists', {}).pipe(map(renamePlayerStats));
  }

  /** Melhores notas médias da temporada (mínimo de jogos definido no Worker). */
  topRated(): Observable<TopRated> {
    const renameAll = (players: RatedPlayer[] = []) => players.map((p) => ({ ...p, team: rename(p.team) }));
    // `v` só muda a URL: o navegador guarda a resposta por horas, e a versão antiga não tinha `all`.
    // Suba o número quando o formato do ranking mudar. O Worker ignora o parâmetro.
    return this.http
      .get<TopRated>(`${API_URL}/players/toprated`, { params: { v: 3 } })
      .pipe(map((r) => ({ ...r, response: renameAll(r.response), all: renameAll(r.all) })));
  }

  /**
   * Nota média dos times: na temporada e nas 5 últimas partidas.
   * `fresh` muda a URL para pular o cache do navegador, que pode ter guardado uma resposta
   * de quando uma das listas ainda estava sendo calculada (`null`). O Worker ignora o parâmetro.
   */
  teamRatings(fresh = false): Observable<TeamRatings> {
    const renameAll = (rows: TeamRating[] | null) => rows?.map((r) => ({ ...r, team: rename(r.team) })) ?? null;
    return this.http
      .get<TeamRatings>(`${API_URL}/teams/ratings`, { params: fresh ? { t: Date.now() } : {} })
      .pipe(map((r) => ({ ...r, season: renameAll(r.season), last5: renameAll(r.last5) })));
  }

  /** Números de todos os jogadores do campeonato na temporada (tabela de jogadores). */
  playerStats(): Observable<PlayerStats> {
    return this.http
      .get<PlayerStats>(`${API_URL}/players/stats`)
      .pipe(map((r) => ({ ...r, players: r.players.map((p) => ({ ...p, team: rename(p.team) })) })));
  }

  /** Time da rodada (4-3-3), montado no Worker a partir das notas dos jogos encerrados. */
  teamOfRound(round: string): Observable<RoundTeam> {
    return this.http
      .get<RoundTeam>(`${API_URL}/players/team-of-round`, { params: { round } })
      .pipe(map((r) => ({ ...r, players: r.players.map((p) => ({ ...p, team: rename(p.team) })) })));
  }

  /** Partidas pelo id, com os eventos. A API aceita até 20 por chamada; mais que isso vira várias. */
  fixturesByIds(ids: number[]): Observable<Fixture[]> {
    if (!ids.length) return of([]);
    const chunks = Array.from({ length: Math.ceil(ids.length / 20) }, (_, i) => ids.slice(i * 20, i * 20 + 20));
    // `ids` não aceita liga e temporada juntos.
    return forkJoin(
      chunks.map((chunk) =>
        this.http.get<ApiResponse<Fixture[]>>(`${API_URL}/fixtures`, { params: { ids: chunk.join('-') } }).pipe(map((r) => r.response)),
      ),
    ).pipe(map((parts) => renameFixtures(parts.flat())));
  }

  /**
   * Jogos encerrados da temporada (só para a classificação ao vivo saber quais a API já contou).
   * Mesma chave que o Worker usa nas estatísticas dos times, então o cache é compartilhado.
   */
  finishedFixtures(): Observable<Fixture[]> {
    return this.get<Fixture[]>('fixtures', { status: 'FT-AET-PEN' });
  }

  /** Desfalques (lesionados, suspensos, dúvidas) dos dois times de uma partida. */
  injuries(fixtureId: number): Observable<Injury[]> {
    return this.http
      .get<ApiResponse<Injury[]>>(`${API_URL}/injuries`, { params: { fixture: fixtureId } })
      .pipe(map((r) => r.response.map((i) => ({ ...i, team: rename(i.team) }))));
  }

  /**
   * Técnico atual de um time (independe da partida: aparece antes de sair a escalação): o da escalação do
   * último jogo do time, em qualquer competição. O cadastro de técnicos (`coachs`) fica desatualizado (o
   * Corinthians aparecia com Diniz, sem data de saída, já com Seedorf no cargo), então só entra se o
   * último jogo não tiver escalação.
   */
  coach(teamId: number): Observable<Coach | null> {
    return this.http.get<ApiResponse<Fixture[]>>(`${API_URL}/fixtures`, { params: { team: teamId, last: 1 } }).pipe(
      switchMap((r) => {
        const last = r.response[0];
        return last ? this.fixturesByIds([last.fixture.id]) : of([]);
      }),
      map((fixtures) => fixtures[0]?.lineups?.find((l) => l.team.id === teamId)?.coach),
      catchError(() => of(null)),
      switchMap((c) => (c?.name ? of({ name: c.name, photo: c.photo }) : this.registeredCoach(teamId))),
    );
  }

  /**
   * Técnico atual pelo cadastro de técnicos: a API devolve todos que já passaram pelo time; o atual é o
   * do trabalho sem data de saída, o que começou por último.
   */
  private registeredCoach(teamId: number): Observable<Coach | null> {
    return this.http.get<ApiResponse<CoachCareer[]>>(`${API_URL}/coachs`, { params: { team: teamId } }).pipe(
      map((r) => {
        const current = r.response
          .map((c) => ({ c, job: c.career.find((j) => j.team.id === teamId && !j.end) }))
          .filter((x) => x.job)
          .sort((a, b) => (b.job!.start ?? '').localeCompare(a.job!.start ?? ''))[0]?.c;
        return current ? { name: current.name, photo: current.photo } : null;
      }),
    );
  }

  /** Uma partida pelo id, com os eventos; `null` se não existir. */
  fixture(id: number): Observable<Fixture | null> {
    return this.fixturesByIds([id]).pipe(map((r) => r[0] ?? null));
  }

  standings(): Observable<Standing[]> {
    return this.get<{ league: { standings: Standing[][] } }[]>('standings', {}).pipe(
      map((r) => (r[0]?.league.standings[0] ?? []).map((s) => ({ ...s, team: rename(s.team) }))),
    );
  }
}

function renamePlayerStats(players: PlayerStat[]): PlayerStat[] {
  return players.map((p) => ({ ...p, statistics: p.statistics.map((s) => ({ ...s, team: rename(s.team) })) }));
}

function rename<T extends Team>(team: T): T {
  return { ...team, name: teamName(team) };
}

function renameFixtures(fixtures: Fixture[]): Fixture[] {
  return fixtures.map((f) => ({
    ...f,
    teams: { home: rename(f.teams.home), away: rename(f.teams.away) },
    events: f.events?.map((e) => ({ ...e, team: rename(e.team) })),
    lineups: f.lineups?.map((l) => ({ ...l, team: rename(l.team) })),
    players: f.players?.map((p) => ({ ...p, team: rename(p.team) })),
    statistics: f.statistics?.map((s) => ({ ...s, team: rename(s.team) })),
  }));
}
