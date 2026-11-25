import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { retry, throwError, timer } from 'rxjs';
import { API_URL } from './api-football';

// Pausas antes de cada nova tentativa (duas a mais, depois da primeira falha).
const RETRY_DELAYS_MS = [800, 2000];
// Falhas passageiras: sem rede/conexão caiu (0), limite por minuto da API (429), erro do Worker ou da API
// (500, 502, 504). 503 (cota do dia esgotada, ranking sendo montado) não melhora em segundos.
const TRANSIENT = new Set([0, 429, 500, 502, 504]);

/**
 * Buscas ao Worker que falham por motivo passageiro são repetidas duas vezes, com uma pausa curta, antes
 * de virar erro na tela. A API-Football às vezes recusa uma chamada (limite nos endereços compartilhados
 * da Cloudflare) e a seguinte passa: sem isto, a página mostrava "não foi possível carregar".
 */
export const retryTransientErrors: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET' || !req.url.startsWith(API_URL)) return next(req);
  return next(req).pipe(
    retry({
      count: RETRY_DELAYS_MS.length,
      delay: (err: unknown, attempt) =>
        err instanceof HttpErrorResponse && TRANSIENT.has(err.status) ? timer(RETRY_DELAYS_MS[attempt - 1]) : throwError(() => err),
    }),
  );
};
