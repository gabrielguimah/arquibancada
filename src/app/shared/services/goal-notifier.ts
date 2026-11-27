import { Injectable, inject, signal } from '@angular/core';
import { Fixture, FixtureEvent } from '../../api/api-football';
import { BrowserNotifications, SystemNotification } from './browser-notifications';
import { WatchState, detectGoals, minuteLabel, notificationText } from '../utils/goal-detect';
import { GoalSounds } from './goal-sounds';
import { LiveFixtures } from './live-fixtures';

// Aviso some sozinho depois deste tempo.
const TOAST_MS = 10_000;

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
  // O que já foi visto de cada jogo (regras em goal-detect, as mesmas do push do Worker).
  private states = new Map<number, WatchState<FixtureEvent>>();
  // Avisos que já tocaram o som (o mesmo gol chega pela página e pelo push, com o mesmo id).
  private played = new Set<string>();

  readonly toasts = signal<GoalToast[]>([]);

  constructor() {
    this.live.onUpdate((fixtures) => fixtures.forEach((f) => this.check(f)));
    // Push recebido pelo service worker (sw.js avisa as abas abertas): toca o som do site, mesmo com a
    // aba em segundo plano. O push costuma chegar antes da busca da própria página.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
        const d = e.data as { source?: string; tag?: string; sound?: string } | null;
        if (d?.source === 'arquibancada-push' && d.tag && (d.sound === 'goal' || d.sound === 'cancelled')) this.pushArrived(d.tag, d.sound);
      });
      // Com `addEventListener`, as mensagens ficam na fila até isto (o Safari não libera sozinho).
      navigator.serviceWorker.startMessages();
    }
  }

  /** Aviso que chegou por push com o site aberto: só o som (a notificação o sistema já mostrou). */
  pushArrived(id: string, type: GoalToast['type']) {
    this.playOnce(id, type);
  }

  start() {
    this.live.start();
  }

  dismiss(id: string) {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }

  private check(f: Fixture) {
    const { state, alerts } = detectGoals(this.states.get(f.fixture.id), f);
    this.states.set(f.fixture.id, state);
    for (const a of alerts) {
      this.show({ id: a.id, type: a.type, fixture: f, goal: a.event, minute: minuteLabel(a.event), kind: kind(a.event), reason: a.reason });
    }
  }

  private playOnce(id: string, type: GoalToast['type']) {
    if (this.played.has(id)) return;
    this.played.add(id);
    this.sounds.play(type);
  }

  private show(toast: GoalToast) {
    this.toasts.update((t) => [...t, toast]);
    // Com o site aberto, o som do site toca sempre (no PC, a notificação do sistema pode vir muda).
    this.playOnce(toast.id, toast.type);
    void this.system.show(systemNotification(toast));
    setTimeout(() => this.dismiss(toast.id), TOAST_MS);
  }
}

/** Notificação do sistema (popup no PC, notificação no celular): mesmo texto do push (goal-detect). */
function systemNotification(t: GoalToast): SystemNotification {
  const { home, away } = t.fixture.teams;
  const alert = { id: t.id, type: t.type, event: t.goal, reason: t.reason };
  return {
    ...notificationText(alert, { home: home.name, away: away.name, team: t.goal.team.name }, t.fixture.goals),
    icon: t.goal.team.logo,
    tag: t.id,
  };
}

function kind(e: FixtureEvent): GoalToast['kind'] {
  return e.detail === 'Penalty' ? 'penalty' : e.detail === 'Own Goal' ? 'own' : 'normal';
}
