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
  // Melhor da rodada (estrela): maior nota; no empate, quem jogou mais minutos.
  protected bestId = computed(() => {
    const players = [...(this.team()?.players ?? [])];
    players.sort((a, b) => b.rating - a.rating || b.minutes - a.minutes);
    return players[0]?.player.id ?? null;
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

  /** Sobrenome para caber embaixo da foto ("K. Viveros" → "Viveros"). */
  protected shortName(name: string): string {
    const parts = name.split(' ');
    return parts.length > 1 && /\.$/.test(parts[0]) ? parts.slice(1).join(' ') : name;
  }
}

/** "Regular Season - 36" → "36ª rodada" */
function roundName(round: string | null): string {
  const n = round?.match(/(\d+)$/)?.[1];
  return n ? `${n}ª rodada` : (round ?? '');
}
