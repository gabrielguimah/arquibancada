// Situação dos jogos (códigos `status.short` da API-Football) e data de Brasília, num lugar só. Sem
// Angular: o Worker importa este arquivo (push dos gols, "Onde assistir").

export const TZ = 'America/Sao_Paulo';

/** Jogo em andamento (inclusive intervalo, suspenso e interrompido). */
export const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
/** Bola rolando: 1º e 2º tempo, prorrogação e pênaltis (no intervalo, suspenso ou encerrado, não). */
export const RUNNING = new Set(['1H', '2H', 'ET', 'P', 'LIVE']);
/** Encerrado no campo. */
export const FINISHED = new Set(['FT', 'AET', 'PEN']);
/** Não vai mais rolar: encerrado, adiado, cancelado, abandonado ou W.O. */
export const OVER = new Set([...FINISHED, 'PST', 'CANC', 'ABD', 'AWD', 'WO']);

// Ordem das situações de um jogo, para saber qual de duas respostas está mais adiantada.
export const PROGRESS: Record<string, number> = { TBD: 0, NS: 0, '1H': 1, HT: 2, '2H': 3, BT: 4, ET: 5, P: 6, AET: 7, PEN: 7, FT: 7 };

/** Data (AAAA-MM-DD) em Brasília. */
export function dayInBrasilia(date: Date | number = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}

interface Progress {
  fixture: { status: { short: string; elapsed: number | null; extra?: number | null } };
  goals: { home: number | null; away: number | null };
  score?: unknown;
}

/**
 * A busca por id (com eventos) e a lista do dia têm caches separados no Worker e na API, e às vezes a
 * lista já mostra o jogo começado (ou o gol) enquanto a busca por id ainda não. Fica com a situação e o
 * placar da mais adiantada; eventos, escalações e notas vêm sempre da busca por id.
 */
export function fresher<F extends Progress>(byId: F, listed: Progress | undefined): F {
  if (!listed) return byId;
  const progress = (f: Progress) => [PROGRESS[f.fixture.status.short] ?? 0, f.fixture.status.elapsed ?? 0, f.fixture.status.extra ?? 0];
  const [a, b] = [progress(byId), progress(listed)];
  const ahead = b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  if (ahead <= 0) return byId;
  const merged = { ...byId, fixture: { ...byId.fixture, status: listed.fixture.status }, goals: listed.goals };
  return 'score' in listed || 'score' in byId ? { ...merged, score: listed.score ?? byId.score } : merged;
}
