import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { ApiFootball, Fixture, LIVE_STATUSES, Standing } from '../../api/api-football';
import { Crest } from '../../shared/crest';

const TZ = 'America/Sao_Paulo';

// Intervalo de atualização: rápido com jogo rolando, lento no resto do tempo.
const REFRESH_LIVE_MS = 30_000;
const REFRESH_IDLE_MS = 5 * 60_000;

interface FixtureDay {
  label: string;
  fixtures: Fixture[];
}

interface Zone {
  id: string;
  label: string;
}

interface StandingGroup {
  zone: Zone | null;
  rows: Standing[];
}

type FormResult = 'V' | 'E' | 'D';

@Component({
  selector: 'app-rodada',
  imports: [Crest],
  templateUrl: './rodada.html',
  styleUrl: './rodada.scss',
})
export class Rodada {
  private api = inject(ApiFootball);
  private timer?: ReturnType<typeof setTimeout>;

  protected rounds = signal<string[]>([]);
  protected round = signal<string | null>(null);
  protected fixtures = signal<Fixture[]>([]);
  // Data típica (mediana) da rodada seguinte: jogos desta rodada disputados depois dela são atrasados.
  protected nextRoundStart = signal<number | null>(null);
  protected standings = signal<Standing[]>([]);
  protected error = signal<string | null>(null);
  protected loading = signal(true);

  protected roundIndex = computed(() => this.rounds().indexOf(this.round() ?? ''));
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
    return [...groups].map(([label, fixtures]) => ({ label: label[0].toUpperCase() + label.slice(1), fixtures }));
  });

  protected standingGroups = computed<StandingGroup[]>(() => {
    const groups: StandingGroup[] = [];
    for (const s of this.standings()) {
      const zone = zoneOf(s);
      const last = groups.at(-1);
      if (last && last.zone?.id === zone?.id) last.rows.push(s);
      else groups.push({ zone, rows: [s] });
    }
    return groups;
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

  protected selectRound(round: string) {
    this.round.set(round);
    this.fixtures.set([]);
    this.nextRoundStart.set(null);
    this.loading.set(true);
    this.load();
  }

  private load() {
    clearTimeout(this.timer);
    const round = this.round();
    if (!round) return;
    const nextRound = this.rounds()[this.rounds().indexOf(round) + 1];
    forkJoin([
      this.api.fixtures(round),
      this.api.standings(),
      nextRound ? this.api.fixtures(nextRound) : of([]),
    ]).subscribe({
      next: ([fixtures, standings, next]) => {
        if (round !== this.round()) return;
        this.fixtures.set(fixtures);
        this.standings.set(standings);
        // Mediana, e não o primeiro jogo: um jogo antecipado da rodada seguinte não deve marcar os desta como atrasados.
        const nextStarts = next
          .filter((f) => f.fixture.status.short !== 'PST')
          .map((f) => f.fixture.timestamp)
          .sort((a, b) => a - b);
        this.nextRoundStart.set(nextStarts.length ? nextStarts[Math.floor(nextStarts.length / 2)] : null);
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
  protected roundName = roundName;

  protected kickoff(f: Fixture): string {
    return new Date(f.fixture.date).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }

  protected isDelayed(f: Fixture): boolean {
    const start = this.nextRoundStart();
    return start !== null && f.fixture.timestamp > start;
  }

  protected statusLabel(f: Fixture): string {
    const { short, elapsed, extra } = f.fixture.status;
    switch (short) {
      case 'NS':
      case 'TBD':
        return this.kickoff(f);
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

  /** Últimos 5 jogos, do mais antigo para o mais recente (a API manda o mais recente primeiro). */
  protected form(s: Standing): FormResult[] {
    const map: Record<string, FormResult> = { W: 'V', D: 'E', L: 'D' };
    return [...(s.form ?? '')].reverse().map((c) => map[c]).filter(Boolean);
  }

  protected legend = computed(() => {
    const seen = new Map<string, Zone>();
    for (const g of this.standingGroups()) if (g.zone) seen.set(g.zone.id, g.zone);
    return [...seen.values()];
  });
}

function zoneOf(s: Standing): Zone | null {
  const d = s.description ?? '';
  if (d.includes('Libertadores') && d.includes('Qualification')) return { id: 'pre-libertadores', label: 'Pré-Libertadores' };
  if (d.includes('Libertadores')) return { id: 'libertadores', label: 'Libertadores' };
  if (d.includes('Sudamericana')) return { id: 'sulamericana', label: 'Sul-Americana' };
  if (d.includes('Relegation')) return { id: 'rebaixamento', label: 'Rebaixamento' };
  return null;
}

function isLive(f: Fixture): boolean {
  return LIVE_STATUSES.includes(f.fixture.status.short);
}

/** "Regular Season - 36" → "36ª rodada" */
function roundName(round: string | null): string {
  const n = round?.match(/(\d+)$/)?.[1];
  return n ? `${n}ª rodada` : (round ?? '');
}
