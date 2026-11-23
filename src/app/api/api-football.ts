import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
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
    status: { long: string; short: string; elapsed: number | null; extra: number | null };
  };
  teams: { home: Team; away: Team };
  goals: { home: number | null; away: number | null };
}

export interface Standing {
  rank: number;
  team: Team;
  points: number;
  goalsDiff: number;
  form: string | null;
  description: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
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

  /** Time da rodada (4-3-3), montado no Worker a partir das notas dos jogos encerrados. */
  teamOfRound(round: string): Observable<RoundTeam> {
    return this.http
      .get<RoundTeam>(`${API_URL}/players/team-of-round`, { params: { round } })
      .pipe(map((r) => ({ ...r, players: r.players.map((p) => ({ ...p, team: rename(p.team) })) })));
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
  return fixtures.map((f) => ({ ...f, teams: { home: rename(f.teams.home), away: rename(f.teams.away) } }));
}
