import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { API_URL, ApiFootball } from './api-football';

describe('ApiFootball.coach', () => {
  const team = { id: 121, name: 'Palmeiras', logo: '' };
  const lastGame = (coach: { name: string; photo: string | null } | null) => ({
    response: [
      {
        fixture: { id: 77 },
        teams: { home: team, away: { id: 1, name: 'B', logo: '' } },
        lineups: coach ? [{ team, formation: null, startXI: [], substitutes: [], coach: { id: 1, ...coach } }] : [],
      },
    ],
  });

  it('é o técnico da escalação do último jogo do time', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const result = firstValueFrom(TestBed.inject(ApiFootball).coach(121));
    http.expectOne(`${API_URL}/fixtures?team=121&last=1`).flush({ response: [{ fixture: { id: 77 } }] });
    http.expectOne(`${API_URL}/fixtures?ids=77`).flush(lastGame({ name: 'Abel Ferreira', photo: 'abel.png' }));
    expect(await result).toEqual({ name: 'Abel Ferreira', photo: 'abel.png' });
    http.verify();
  });

  it('sem escalação no último jogo, usa o cadastro: sem data de saída, o que começou por último', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(ApiFootball);
    const http = TestBed.inject(HttpTestingController);
    const job = (team: number, start: string, end: string | null) => ({ team: { id: team }, start, end });
    const result = firstValueFrom(api.coach(121));
    http.expectOne(`${API_URL}/fixtures?team=121&last=1`).flush({ response: [{ fixture: { id: 77 } }] });
    http.expectOne(`${API_URL}/fixtures?ids=77`).flush(lastGame(null));
    http.expectOne(`${API_URL}/coachs?team=121`).flush({
      response: [
        { name: 'Antigo', photo: 'a.png', career: [job(121, '2018-01-01', '2020-10-01')] },
        // Dado desatualizado na API: saiu e não marcaram a saída, mas outro começou depois.
        { name: 'Esquecido', photo: 'b.png', career: [job(121, '2020-10-30', null)] },
        { name: 'Atual', photo: null, career: [job(99, '2015-01-01', '2019-01-01'), job(121, '2025-01-10', null)] },
      ],
    });
    expect(await result).toEqual({ name: 'Atual', photo: null });
  });

  it('sem técnico em lugar nenhum (nem jogo anterior), devolve null', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const result = firstValueFrom(TestBed.inject(ApiFootball).coach(121));
    http.expectOne(`${API_URL}/fixtures?team=121&last=1`).flush({ response: [] });
    http.expectOne(`${API_URL}/coachs?team=121`).flush({ response: [] });
    expect(await result).toBeNull();
  });
});

describe('ApiFootball.teamRatings', () => {
  it('corrige o nome dos times em todas as listas, inclusive casa e fora', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const result = firstValueFrom(TestBed.inject(ApiFootball).teamRatings());
    const rows = [{ team: { id: 126, name: 'Sao Paulo', logo: '' }, rating: 7 }];
    http
      .expectOne(`${API_URL}/teams/ratings`)
      .flush({ updatedAt: '', season: rows, last5: rows, home: { season: rows, last5: rows }, away: { season: rows, last5: null } });
    const r = await result;
    const names = [r.season, r.last5, r.home?.season, r.home?.last5, r.away?.season].map((list) => list?.[0].team.name);
    expect(names).toEqual(['São Paulo', 'São Paulo', 'São Paulo', 'São Paulo', 'São Paulo']);
    expect(r.away?.last5).toBeNull();
    http.verify();
  });
});
