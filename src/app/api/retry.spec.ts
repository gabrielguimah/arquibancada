import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_URL } from './api-football';
import { retryTransientErrors } from './retry';

describe('Nova tentativa em falha passageira', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([retryTransientErrors])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.useRealTimers());

  it('limite da API (429) ou erro do Worker (502): tenta de novo e entrega a resposta que deu certo', () => {
    let body: unknown;
    http.get(`${API_URL}/fixtures?ids=1`).subscribe((b) => (body = b));
    backend.expectOne(`${API_URL}/fixtures?ids=1`).flush({}, { status: 429, statusText: 'Too Many Requests' });
    vi.advanceTimersByTime(800);
    backend.expectOne(`${API_URL}/fixtures?ids=1`).flush({}, { status: 502, statusText: 'Bad Gateway' });
    vi.advanceTimersByTime(2000);
    backend.expectOne(`${API_URL}/fixtures?ids=1`).flush({ response: [] });
    expect(body).toEqual({ response: [] });
  });

  it('erro que não passa sozinho (404) vira erro na hora, sem nova tentativa', () => {
    let status = 0;
    http.get(`${API_URL}/nada`).subscribe({ error: (e) => (status = e.status) });
    backend.expectOne(`${API_URL}/nada`).flush({}, { status: 404, statusText: 'Not Found' });
    vi.advanceTimersByTime(5000);
    backend.expectNone(`${API_URL}/nada`);
    expect(status).toBe(404);
  });
});
