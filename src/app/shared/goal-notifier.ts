import { Injectable, inject, signal } from '@angular/core';
import { Fixture, FixtureEvent } from '../api/api-football';
import { BrowserNotifications, SystemNotification } from './browser-notifications';
import { GoalSounds } from './goal-sounds';
import { LiveFixtures } from './live-fixtures';

// Aviso some sozinho depois deste tempo.
const TOAST_MS = 10_000;

const GOAL_DETAILS = new Set(['Normal Goal', 'Own Goal', 'Penalty']);

// Gol anulado pelo VAR: "Goal cancelled" ou "Goal Disallowed - <motivo>".
const CANCEL_REASONS: Record<string, string> = {
  'Goal cancelled': '',
  'Goal Disallowed - offside': 'impedimento',
  'Goal Disallowed - handball': 'mão na bola',
  'Goal Disallowed - foul': 'falta',
};

export interface GoalToast {
  id: string;
  /** `cancelled`: gol anulado (evento do VAR ou gol que sumiu da lista da API). */
  type: 'goal' | 'cancelled';
  fixture: Fixture;
  goal: FixtureEvent;
  minute: string;
  kind: 'normal' | 'penalty' | 'own';
  /** Só em gol anulado, quando a API informa: impedimento, mão na bola, falta. */
  reason?: string;
}

/**
 * Avisa quando sai gol nos jogos do dia, a cada atualização de LiveFixtures. Os gols que já existiam
 * quando o site abriu (ou quando o jogo entrou no acompanhamento) não geram aviso; só os novos.
 */
@Injectable({ providedIn: 'root' })
export class GoalNotifier {
  private live = inject(LiveFixtures);
  private system = inject(BrowserNotifications);
  private sounds = inject(GoalSounds);
  private seen = new Set<string>();
  private tracked = new Set<number>();
  // Gols e placar da última verificação de cada jogo, para notar quando um gol some (anulado).
  private goalsByFixture = new Map<number, Map<string, FixtureEvent>>();
  private scoreByFixture = new Map<number, number>();
  // Gols já avisados como anulados (jogo:time:jogador), para não avisar duas vezes.
  private cancelled = new Set<string>();

  readonly toasts = signal<GoalToast[]>([]);

  constructor() {
    this.live.onUpdate((fixtures) => fixtures.forEach((f) => this.check(f)));
  }

  start() {
    this.live.start();
  }

  dismiss(id: string) {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }

  private check(f: Fixture) {
    const firstLook = !this.tracked.has(f.fixture.id);
    this.tracked.add(f.fixture.id);
    const goals = new Map<string, FixtureEvent>();

    for (const e of f.events ?? []) {
      const id = eventId(f, e);
      if (e.type === 'Goal' && GOAL_DETAILS.has(e.detail)) {
        goals.set(id, e);
        if (this.seen.has(id)) continue;
        this.seen.add(id);
        if (!firstLook) this.show({ id, type: 'goal', fixture: f, goal: e, minute: minute(e), kind: kind(e) });
      } else if (e.type === 'Var' && e.detail in CANCEL_REASONS) {
        const key = cancelKey(f, e);
        if (this.seen.has(id) || this.cancelled.has(key)) continue;
        this.seen.add(id);
        this.cancelled.add(key);
        if (!firstLook) {
          this.show({ id, type: 'cancelled', fixture: f, goal: e, minute: minute(e), kind: 'normal', reason: CANCEL_REASONS[e.detail] || undefined });
        }
      }
    }

    // Gol que estava na lista e sumiu: a API às vezes só retira o gol anulado, sem evento do VAR.
    // Só conta se o placar também diminuiu (lista vazia por falha da API não é gol anulado).
    const score = (f.goals.home ?? 0) + (f.goals.away ?? 0);
    const scoreDropped = score < (this.scoreByFixture.get(f.fixture.id) ?? score);
    for (const [id, e] of scoreDropped ? (this.goalsByFixture.get(f.fixture.id) ?? []) : []) {
      const key = cancelKey(f, e);
      if (goals.has(id) || this.cancelled.has(key)) continue;
      this.cancelled.add(key);
      this.show({ id: `sumiu:${id}`, type: 'cancelled', fixture: f, goal: e, minute: minute(e), kind: kind(e) });
    }
    this.goalsByFixture.set(f.fixture.id, goals);
    this.scoreByFixture.set(f.fixture.id, score);
  }

  private show(toast: GoalToast) {
    this.toasts.update((t) => [...t, toast]);
    // Notificação do sistema já toca o som dela: o do site só quando ela não aparece (site na frente
    // ou notificações desligadas), para não tocar dois sons.
    if (!this.system.willNotify()) this.sounds.play(toast.type);
    void this.system.show(systemNotification(toast));
    setTimeout(() => this.dismiss(toast.id), TOAST_MS);
  }
}

/** Texto da notificação do sistema (popup no PC, notificação no celular). */
function systemNotification(t: GoalToast): SystemNotification {
  const { home, away } = t.fixture.teams;
  const score = `${home.name} ${t.fixture.goals.home ?? 0} × ${t.fixture.goals.away ?? 0} ${away.name}`;
  const extra = t.kind === 'penalty' ? ' (pênalti)' : t.kind === 'own' ? ' (contra)' : '';
  const who = `${t.goal.player.name ?? ''} ${t.minute}${extra}`;
  const second =
    t.type === 'cancelled'
      ? `Anulado pelo VAR${t.reason ? `: ${t.reason}` : ''}`
      : t.goal.assist.name
        ? `Assistência: ${t.goal.assist.name}`
        : '';
  return {
    title: t.type === 'cancelled' ? `🚫 Gol anulado do ${t.goal.team.name}` : `⚽ Gol do ${t.goal.team.name}!`,
    body: [who, second, score].filter(Boolean).join('\n'),
    icon: t.goal.team.logo,
    tag: t.id,
  };
}

function eventId(f: Fixture, e: FixtureEvent): string {
  return `${f.fixture.id}:${e.type}:${e.time.elapsed}:${e.time.extra ?? 0}:${e.team.id}:${e.player.id ?? e.player.name}`;
}

/** Mesmo gol no evento do gol e no evento do VAR que o anula: jogo, time e autor. */
function cancelKey(f: Fixture, e: FixtureEvent): string {
  return `${f.fixture.id}:${e.team.id}:${e.player.id ?? e.player.name}`;
}

function minute(e: FixtureEvent): string {
  return `${e.time.elapsed ?? ''}${e.time.extra ? `+${e.time.extra}` : ''}'`;
}

function kind(e: FixtureEvent): GoalToast['kind'] {
  return e.detail === 'Penalty' ? 'penalty' : e.detail === 'Own Goal' ? 'own' : 'normal';
}
