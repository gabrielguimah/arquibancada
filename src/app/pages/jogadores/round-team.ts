import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Card } from '../../shared/card';
import { forkJoin } from 'rxjs';
import { ApiFootball, RoundPlayer, RoundTeam } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { PlayerPhoto } from '../../shared/player-photo';
import { RoundNav } from '../../shared/round-nav';
import { roundStarted } from '../../shared/fixture-status';
import { formatRating, ratingClass } from '../../shared/rating';
import { Notice } from '../../shared/notice';

// Linhas do campo, do ataque (em cima) ao goleiro (embaixo), na formação 4-3-3.
const LINES: Array<{ position: RoundPlayer['position']; count: number }> = [
  { position: 'F', count: 3 },
  { position: 'M', count: 3 },
  { position: 'D', count: 4 },
  { position: 'G', count: 1 },
];

// Rodada com jogos por terminar: confere de novo a cada minuto (o Worker refaz o time quando um acaba).
const REFRESH_MS = 60_000;

/** Time da rodada em 4-3-3 (melhores notas por posição), com seletor de rodada. */
@Component({
  selector: 'app-round-team',
  imports: [Notice, Card, Crest, MatIcon, MatTooltip, PlayerPhoto, RoundNav],
  templateUrl: './round-team.html',
  styleUrl: './round-team.scss',
})
export class RoundTeamCard {
  private api = inject(ApiFootball);

  protected rounds = signal<string[]>([]);
  protected round = signal<string | null>(null);
  protected team = signal<RoundTeam | null>(null);
  protected loading = signal(true);
  protected error = signal(false);

  protected lines = computed(() => {
    const players = this.team()?.players ?? [];
    return LINES.map((l) => ({ ...l, players: players.filter((p) => p.position === l.position) }));
  });
  // Melhor(es) da rodada (estrela): o primeiro na ordem de desempate; expulso não concorre.
  // Se empatar em todos os critérios, todos os empatados ganham a estrela.
  protected bestIds = computed(() => {
    const players = (this.team()?.players ?? []).filter((p) => !p.redCards).sort(compareRoundPlayers);
    const first = players[0];
    return new Set(first ? players.filter((p) => compareRoundPlayers(p, first) === 0).map((p) => p.player.id) : []);
  });

  protected skeletonLines = LINES.map((l) => ({ ...l, slots: Array.from({ length: l.count }, (_, i) => i) }));

  protected ratingClass = ratingClass;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    forkJoin([this.api.rounds(), this.api.currentRound()]).subscribe({
      next: ([rounds, current]) => {
        this.rounds.set(rounds);
        this.select(current, true);
      },
      error: () => this.fail(),
    });
  }

  /**
   * `opening`: na abertura, parte da rodada atual da API e ajusta para a que tem jogo mais recente:
   * - atual ainda sem jogo encerrado: mostra a anterior;
   * - atual completa e a seguinte já com jogo encerrado (jogo antecipado, ou a API ainda não virou a
   *   rodada): mostra a seguinte;
   * - atual com jogo por terminar (atrasado, às vezes por meses), mas a seguinte já tem jogo encerrado
   *   na data dela (jogo antecipado não conta): mostra a seguinte.
   */
  protected select(round: string, opening = false) {
    clearTimeout(this.timer);
    this.round.set(round);
    this.loading.set(true);
    this.error.set(false);
    this.api.teamOfRound(round).subscribe({
      next: (team) => {
        if (round !== this.round()) return;
        const index = this.rounds().indexOf(round);
        const [previous, next] = [this.rounds()[index - 1], this.rounds()[index + 1]];
        if (opening && team.games === 0 && previous) return this.select(previous);
        if (opening && team.games === team.totalGames && next) return this.tryNext(round, team, next);
        if (opening && next) return this.tryStarted(round, team, next);
        this.show(round, team);
      },
      error: () => this.fail(),
    });
  }

  /** Rodada `round` completa: mostra a `next` se ela já tem jogo encerrado; senão, fica na completa. */
  private tryNext(round: string, team: RoundTeam, next: string) {
    this.api.teamOfRound(next).subscribe({
      next: (upcoming) => {
        if (round !== this.round()) return;
        if (upcoming.games > 0) {
          this.round.set(next);
          this.show(next, upcoming);
        } else {
          this.show(round, team);
        }
      },
      error: () => round === this.round() && this.show(round, team),
    });
  }

  /** Rodada `round` incompleta: passa para a `next` se ela já tem jogo encerrado na data dela. */
  private tryStarted(round: string, team: RoundTeam, next: string) {
    this.api.fixtures(next).subscribe({
      next: (fixtures) => {
        if (round !== this.round()) return;
        if (roundStarted(fixtures, true)) this.tryNext(round, team, next);
        else this.show(round, team);
      },
      error: () => round === this.round() && this.show(round, team),
    });
  }

  /** Mostra o time e, se a rodada ainda tem jogo por terminar, agenda a próxima conferência. */
  private show(round: string, team: RoundTeam) {
    this.team.set(team);
    this.loading.set(false);
    if (team.games < team.totalGames) this.timer = setTimeout(() => this.refresh(round), REFRESH_MS);
  }

  /** Atualiza em silêncio (sem esqueleto); falha mantém o que está na tela e tenta no próximo minuto. */
  private refresh(round: string) {
    if (round !== this.round()) return;
    this.api.teamOfRound(round).subscribe({
      next: (team) => round === this.round() && this.show(round, team),
      error: () => {
        if (round === this.round()) this.timer = setTimeout(() => this.refresh(round), REFRESH_MS);
      },
    });
  }

  private fail() {
    this.loading.set(false);
    this.error.set(true);
  }

  protected isBest(p: RoundPlayer): boolean {
    return this.bestIds().has(p.player.id);
  }

  protected ratingLabel(p: RoundPlayer): string {
    return formatRating(p.rating);
  }

  /** Dica ao passar o mouse: nome, time, minutos, resultado e participação em gols. */
  protected tip(p: RoundPlayer): string {
    const result = p.result ? { W: 'vitória', D: 'empate', L: 'derrota' }[p.result] : null;
    const contributions = [p.goals ? `${p.goals} G` : '', p.assists ? `${p.assists} A` : ''].filter(Boolean).join(' · ');
    return [this.isBest(p) ? 'Melhor da rodada' : '', p.player.name, p.team.name, `${p.minutes} min`, result, contributions]
      .filter(Boolean)
      .join(' · ');
  }

  /** Sobrenome para caber embaixo da foto ("K. Viveros" → "Viveros"). */
  protected shortName(name: string): string {
    const parts = name.split(' ');
    return parts.length > 1 && /\.$/.test(parts[0]) ? parts.slice(1).join(' ') : name;
  }
}

const RESULT_ORDER = { W: 2, D: 1, L: 0 };

/**
 * Ordem de desempate do melhor da rodada (a mesma do Worker para montar o time): nota com duas casas,
 * gols + assistências, resultado do time, menos minutos (mesma nota em menos tempo) e menos cartões.
 */
function compareRoundPlayers(a: RoundPlayer, b: RoundPlayer): number {
  const contributions = (p: RoundPlayer) => (p.goals ?? 0) + (p.assists ?? 0);
  const result = (p: RoundPlayer) => (p.result ? RESULT_ORDER[p.result] : 0);
  const cards = (p: RoundPlayer) => (p.yellowCards ?? 0) + (p.redCards ?? 0) * 2;
  return (
    b.rating - a.rating ||
    contributions(b) - contributions(a) ||
    result(b) - result(a) ||
    a.minutes - b.minutes ||
    cards(a) - cards(b)
  );
}

