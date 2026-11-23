import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

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

  rounds(): Observable<string[]> {
    return this.get('fixtures/rounds', {});
  }

  currentRound(): Observable<string> {
    return this.get<string[]>('fixtures/rounds', { current: true }).pipe(map((r) => r[0]));
  }

  fixtures(round: string): Observable<Fixture[]> {
    return this.get('fixtures', { round });
  }

  standings(): Observable<Standing[]> {
    return this.get<{ league: { standings: Standing[][] } }[]>('standings', {}).pipe(
      map((r) => r[0]?.league.standings[0] ?? []),
    );
  }
}
