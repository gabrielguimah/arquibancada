import { Component, computed, inject, signal } from '@angular/core';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { forkJoin } from 'rxjs';
import { ApiFootball, RoundPlayer, RoundTeam } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { ratingClass } from '../../shared/rating';

// Linhas do campo, do ataque (em cima) ao goleiro (embaixo), na formação 4-3-3.
const LINES: Array<{ position: RoundPlayer['position']; count: number }> = [
  { position: 'F', count: 3 },
  { position: 'M', count: 3 },
  { position: 'D', count: 4 },
  { position: 'G', count: 1 },
];

/** Time da rodada em 4-3-3 (melhores notas por posição), com seletor de rodada. */
@Component({
  selector: 'app-round-team',
  imports: [Crest, MatFormField, MatSelect, MatOption, MatIcon],
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

  protected roundIndex = computed(() => this.rounds().indexOf(this.round() ?? ''));
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

  // Notas que aparecem iguais com uma casa (ex.: quatro "8.2") passam a mostrar duas.
  private repeatedRatings = computed(() => {
    const seen = new Map<string, number>();
    for (const p of this.team()?.players ?? []) {
      const label = p.rating.toFixed(1);
      seen.set(label, (seen.get(label) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([label]) => label));
  });
  protected skeletonLines = LINES.map((l) => ({ ...l, slots: Array.from({ length: l.count }, (_, i) => i) }));

  protected ratingClass = ratingClass;
  protected roundName = roundName;

  constructor() {
    forkJoin([this.api.rounds(), this.api.currentRound()]).subscribe({
      next: ([rounds, current]) => {
        this.rounds.set(rounds);
        this.select(current, true);
      },
      error: () => this.fail(),
    });
  }

  protected step(delta: number) {
    const next = this.rounds()[this.roundIndex() + delta];
    if (next) this.select(next);
  }

  /** `fallback`: na abertura, se a rodada atual ainda não tem jogo encerrado, mostra a anterior. */
  protected select(round: string, fallback = false) {
    this.round.set(round);
    this.loading.set(true);
    this.error.set(false);
    this.api.teamOfRound(round).subscribe({
      next: (team) => {
        if (round !== this.round()) return;
        const previous = this.rounds()[this.rounds().indexOf(round) - 1];
        if (fallback && team.games === 0 && previous) return this.select(previous);
        this.team.set(team);
        this.loading.set(false);
      },
      error: () => this.fail(),
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
    return this.repeatedRatings().has(p.rating.toFixed(1)) ? p.rating.toFixed(2) : p.rating.toFixed(1);
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

/** "Regular Season - 36" → "36ª rodada" */
function roundName(round: string | null): string {
  const n = round?.match(/(\d+)$/)?.[1];
  return n ? `${n}ª rodada` : (round ?? '');
}
