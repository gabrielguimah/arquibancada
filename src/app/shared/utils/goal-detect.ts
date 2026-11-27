// Regras dos avisos de gol, usadas pelo site (GoalNotifier) e pelo Worker (push). Sem Angular: o Worker
// importa este arquivo. Assim os dois avisam os mesmos lances, com o mesmo id (a `tag` da notificação),
// e um mesmo gol nunca vira duas notificações.

export interface GoalEvent {
  time: { elapsed: number | null; extra: number | null };
  team: { id: number; name: string; logo: string };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
}

export interface GoalFixture<E extends GoalEvent = GoalEvent> {
  fixture: { id: number };
  goals: { home: number | null; away: number | null };
  events?: E[];
}

/** O que se lembra de cada jogo entre uma verificação e outra. */
export interface WatchState<E extends GoalEvent = GoalEvent> {
  /** Ids de eventos já vistos e gols já avisados como anulados (`x:` + jogo:time:jogador). */
  seen: string[];
  /** Gols na lista da última verificação (para notar um gol que some: anulado). */
  goals: Array<[string, E]>;
  score: number;
  /** Gols de cada time na lista da última verificação. */
  perTeam: Record<number, number>;
}

export interface GoalAlert<E extends GoalEvent = GoalEvent> {
  /** Id do aviso: também a `tag` da notificação (a mesma no site e no push). */
  id: string;
  type: 'goal' | 'cancelled';
  event: E;
  /** Só em gol anulado, quando a API informa: impedimento, mão na bola, falta. */
  reason?: string;
}

export const GOAL_DETAILS = new Set(['Normal Goal', 'Own Goal', 'Penalty']);

// Gol anulado pelo VAR: "Goal cancelled" ou "Goal Disallowed - <motivo>".
export const CANCEL_REASONS: Record<string, string> = {
  'Goal cancelled': '',
  'Goal Disallowed - offside': 'impedimento',
  'Goal Disallowed - handball': 'mão na bola',
  'Goal Disallowed - foul': 'falta',
};

/**
 * Gols novos e gols anulados de um jogo desde a última verificação (`prev`). A primeira vez que o jogo é
 * visto só guarda o estado, sem avisar (gols que já existiam quando o acompanhamento começou).
 *
 * Contra avisos repetidos:
 * - cada lance é avisado uma vez (`seen`);
 * - a API às vezes corrige um gol (minuto, autor) e ele ganha outro id: só conta como gol novo se o time
 *   tem mais gols na lista que antes;
 * - gol anulado é avisado uma vez, venha do evento do VAR ou do gol que some da lista com o placar caindo;
 * - gol e anulação na mesma verificação: só a anulação (o gol nem chegou a ser avisado).
 */
export function detectGoals<E extends GoalEvent>(prev: WatchState<E> | undefined, f: GoalFixture<E>): { state: WatchState<E>; alerts: GoalAlert<E>[] } {
  const seen = new Set(prev?.seen);
  const goals = new Map<string, E>();
  const perTeam: Record<number, number> = {};
  const fresh: Array<[string, E]> = [];
  const alerts: GoalAlert<E>[] = [];

  for (const e of f.events ?? []) {
    const id = eventId(f, e);
    if (e.type === 'Goal' && GOAL_DETAILS.has(e.detail)) {
      goals.set(id, e);
      perTeam[e.team.id] = (perTeam[e.team.id] ?? 0) + 1;
      if (seen.has(id)) continue;
      seen.add(id);
      if (prev) fresh.push([id, e]);
    } else if (e.type === 'Var' && e.detail in CANCEL_REASONS) {
      const key = `x:${cancelKey(f, e)}`;
      if (seen.has(id) || seen.has(key)) continue;
      seen.add(id);
      seen.add(key);
      if (prev) alerts.push({ id, type: 'cancelled', event: e, reason: CANCEL_REASONS[e.detail] || undefined });
    }
  }

  // Gols novos de cada time: no máximo quantos a lista ganhou (os últimos); o resto é correção.
  for (const teamId of new Set(fresh.map(([, e]) => e.team.id))) {
    const added = (perTeam[teamId] ?? 0) - (prev?.perTeam[teamId] ?? 0);
    const ofTeam = fresh.filter(([, e]) => e.team.id === teamId);
    for (const [id, event] of ofTeam.slice(Math.max(0, ofTeam.length - Math.max(0, added)))) alerts.push({ id, type: 'goal', event });
  }

  // Gol que estava na lista e sumiu, com o placar diminuindo: anulado (às vezes sem evento do VAR). Só
  // com o placar caindo: lista vazia por falha da API não é gol anulado.
  const score = (f.goals.home ?? 0) + (f.goals.away ?? 0);
  if (prev && score < prev.score) {
    for (const [id, e] of prev.goals) {
      const key = `x:${cancelKey(f, e)}`;
      if (goals.has(id) || seen.has(key)) continue;
      seen.add(key);
      alerts.push({ id: `sumiu:${id}`, type: 'cancelled', event: e });
    }
  }

  const cancelledNow = new Set(alerts.filter((a) => a.type === 'cancelled').map((a) => cancelKey(f, a.event)));
  const result = alerts.filter((a) => a.type === 'cancelled' || !cancelledNow.has(cancelKey(f, a.event)));
  result.sort((a, b) => minuteOrder(a.event) - minuteOrder(b.event));
  return { state: { seen: [...seen], goals: [...goals], score, perTeam }, alerts: result };
}

/**
 * Título e texto da notificação de um aviso, iguais no site e no push. O placar vai no título: no iPhone
 * a notificação mostra só o ícone do app (o iOS ignora o escudo), então os times aparecem logo de cara.
 * `names`: nomes dos times como o site mostra.
 */
export function notificationText(
  a: GoalAlert,
  names: { home: string; away: string; team: string },
  goals: { home: number | null; away: number | null },
): { title: string; body: string } {
  const score = `${names.home} ${goals.home ?? 0} × ${goals.away ?? 0} ${names.away}`;
  const extra = a.event.detail === 'Penalty' ? ' (pênalti)' : a.event.detail === 'Own Goal' ? ' (contra)' : '';
  const who = `${a.event.player.name ?? ''} ${minuteLabel(a.event)}${extra}`.trim();
  if (a.type === 'cancelled') {
    return { title: `🚫 ${score}`, body: [`Gol anulado do ${names.team} — ${who}`, `Anulado pelo VAR${a.reason ? `: ${a.reason}` : ''}`].join('\n') };
  }
  const assist = a.event.assist.name ? `Assistência: ${a.event.assist.name}` : '';
  return { title: `⚽ ${score}`, body: [`Gol do ${names.team}! ${who}`, assist].filter(Boolean).join('\n') };
}

export function eventId(f: GoalFixture, e: GoalEvent): string {
  return `${f.fixture.id}:${e.type}:${e.time.elapsed}:${e.time.extra ?? 0}:${e.team.id}:${e.player.id ?? e.player.name}`;
}

/** Mesmo gol no evento do gol e no evento do VAR que o anula: jogo, time e autor. */
export function cancelKey(f: GoalFixture, e: GoalEvent): string {
  return `${f.fixture.id}:${e.team.id}:${e.player.id ?? e.player.name}`;
}

export function minuteLabel(e: GoalEvent): string {
  return `${e.time.elapsed ?? ''}${e.time.extra ? `+${e.time.extra}` : ''}'`;
}

function minuteOrder(e: GoalEvent): number {
  return (e.time.elapsed ?? 0) * 100 + (e.time.extra ?? 0);
}
