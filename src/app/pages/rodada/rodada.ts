import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiFootball, Fixture, LIVE_STATUSES, Standing } from '../../api/api-football';

const TZ = 'America/Sao_Paulo';

// Intervalo de atualização: rápido com jogo rolando, lento no resto do tempo.
const REFRESH_LIVE_MS = 30_000;
const REFRESH_IDLE_MS = 5 * 60_000;

interface FixtureDay {
  label: string;
  fixtures: Fixture[];
}

@Component({
  selector: 'app-rodada',
  templateUrl: './rodada.html',
  styleUrl: './rodada.scss',
})
export class Rodada {
  private api = inject(ApiFootball);
  private timer?: ReturnType<typeof setTimeout>;

  protected rounds = signal<string[]>([]);
  protected round = signal<string | null>(null);
  protected fixtures = signal<Fixture[]>([]);
  protected standings = signal<Standing[]>([]);
  protected error = signal<string | null>(null);
  protected loading = signal(true);

  protected roundIndex = computed(() => this.rounds().indexOf(this.round() ?? ''));
  protected roundLabel = computed(() => roundName(this.round()));
  protected hasLive = computed(() => this.fixtures().some((f) => isLive(f)));
  protected days = computed<FixtureDay[]>(() => {
    const groups = new Map<string, Fixture[]>();
    for (const f of [...this.fixtures()].sort((a, b) => a.fixture.timestamp - b.fixture.timestamp)) {
      const label = new Date(f.fixture.date).toLocaleDateString('pt-BR', {
        timeZone: TZ,
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
      });
      groups.set(label, [...(groups.get(label) ?? []), f]);
    }
    return [...groups].map(([label, fixtures]) => ({ label, fixtures }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    forkJoin([this.api.rounds(), this.api.currentRound()]).subscribe({
      next: ([rounds, current]) => {
        this.rounds.set(rounds);
        this.selectRound(current);
      },
      error: () => this.fail(),
    });
  }

  protected step(delta: number) {
    const next = this.rounds()[this.roundIndex() + delta];
    if (next) this.selectRound(next);
  }

  private selectRound(round: string) {
    this.round.set(round);
    this.fixtures.set([]);
    this.loading.set(true);
    this.load();
  }

  private load() {
    clearTimeout(this.timer);
    const round = this.round();
    if (!round) return;
    forkJoin([this.api.fixtures(round), this.api.standings()]).subscribe({
      next: ([fixtures, standings]) => {
        if (round !== this.round()) return;
        this.fixtures.set(fixtures);
        this.standings.set(standings);
        this.error.set(null);
        this.loading.set(false);
        this.timer = setTimeout(() => this.load(), this.hasLive() ? REFRESH_LIVE_MS : REFRESH_IDLE_MS);
      },
      error: () => {
        this.fail();
        this.timer = setTimeout(() => this.load(), REFRESH_LIVE_MS);
      },
    });
  }

  private fail() {
    this.loading.set(false);
    this.error.set('Não foi possível carregar os dados. Tentando de novo em instantes…');
  }

  protected isLive = isLive;

  protected statusLabel(f: Fixture): string {
    const { short, elapsed, extra } = f.fixture.status;
    switch (short) {
      case 'NS':
      case 'TBD':
        return new Date(f.fixture.date).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
      case 'HT':
        return 'Intervalo';
      case 'FT':
      case 'AET':
      case 'PEN':
        return 'Encerrado';
      case 'PST':
        return 'Adiado';
      case 'CANC':
        return 'Cancelado';
      case 'SUSP':
      case 'INT':
        return 'Interrompido';
      default:
        return elapsed != null ? `${elapsed}${extra ? '+' + extra : ''}'` : f.fixture.status.long;
    }
  }

  protected zone(s: Standing): string {
    const d = s.description ?? '';
    if (d.includes('Libertadores')) return 'libertadores';
    if (d.includes('Sudamericana')) return 'sulamericana';
    if (d.includes('Relegation')) return 'rebaixamento';
    return '';
  }
}

function isLive(f: Fixture): boolean {
  return LIVE_STATUSES.includes(f.fixture.status.short);
}

/** "Regular Season - 36" → "36ª rodada" */
function roundName(round: string | null): string {
  const n = round?.match(/(\d+)$/)?.[1];
  return n ? `${n}ª rodada` : (round ?? '');
}
