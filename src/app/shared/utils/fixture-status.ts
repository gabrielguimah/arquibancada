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

// Distância máxima até a data típica da rodada para um jogo contar como "a rodada começou". Rodadas
// duram de 2 a 4 dias; jogo antecipado (semanas antes) fica de fora.
const ROUND_WINDOW_S = 4 * 24 * 3600;

/**
 * A rodada já começou: algum jogo dela já rolou ou está rolando (`finishedOnly`: já terminou), perto da
 * data típica da rodada (a mediana dos horários). Um jogo antecipado, disputado semanas antes do resto,
 * não conta: senão a rodada "começaria" com a anterior ainda em andamento.
 */
export function roundStarted(
  fixtures: Array<{ fixture: { timestamp: number; status: { short: string } } }>,
  finishedOnly = false,
): boolean {
  const dated = fixtures.filter((f) => !['PST', 'TBD'].includes(f.fixture.status.short)).map((f) => f.fixture.timestamp).sort((a, b) => a - b);
  if (!dated.length) return false;
  const median = dated[Math.floor(dated.length / 2)];
  return fixtures.some((f) => {
    const s = f.fixture.status.short;
    const counts = FINISHED.has(s) || s === 'AWD' || s === 'WO' || (!finishedOnly && LIVE_STATUSES.has(s));
    return counts && Math.abs(f.fixture.timestamp - median) <= ROUND_WINDOW_S;
  });
}

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
 * Resposta que chegou depois mas está atrás da que já está na tela (situação, minuto e acréscimo): veio de
 * um cache mais velho (outra chave no Worker, ou o Worker devolvendo a última guardada quando a API
 * recusa). Fica com a anterior: o placar nunca "volta no tempo" (ex.: 3 x 1 voltando a 2 x 1). Empate fica
 * com a nova (gol anulado no mesmo minuto ainda passa). Situação fora da ordem conhecida (suspenso,
 * interrompido…): aceita a nova.
 */
export function notBehind<F extends Progress>(previous: F | null | undefined, next: F): F {
  if (!previous) return next;
  const rank = (f: Progress) => PROGRESS[f.fixture.status.short];
  const [a, b] = [rank(previous), rank(next)];
  if (a === undefined || b === undefined) return next;
  const behind =
    b - a || (next.fixture.status.elapsed ?? 0) - (previous.fixture.status.elapsed ?? 0) || (next.fixture.status.extra ?? 0) - (previous.fixture.status.extra ?? 0);
  return behind < 0 ? previous : next;
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
