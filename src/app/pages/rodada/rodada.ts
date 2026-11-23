import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { forkJoin, of } from 'rxjs';
import { ApiFootball, Fixture, Standing } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { FixtureCard, TZ, isLive } from '../../shared/fixture-card';
import { FixtureCardSkeleton } from '../../shared/fixture-card-skeleton';
import { TeamRatingsTables } from './team-ratings';

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
  imports: [Crest, FixtureCard, FixtureCardSkeleton, MatIcon, MatFormField, MatSelect, MatOption, TeamRatingsTables],
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
  // null até a primeira resposta: a seção "Partidas de hoje" mostra o esqueleto.
  protected today = signal<Fixture[] | null>(null);
  protected standings = signal<Standing[]>([]);
  protected error = signal<string | null>(null);
  protected loading = signal(true);

  protected roundIndex = computed(() => this.rounds().indexOf(this.round() ?? ''));
  protected hasLive = computed(() => [...this.fixtures(), ...(this.today() ?? [])].some((f) => isLive(f)));
  // Times em campo agora, para a bolinha ao vivo na tabela.
  protected liveTeams = computed(() => {
    const ids = new Set<number>();
    for (const f of [...this.fixtures(), ...(this.today() ?? [])]) {
      if (isLive(f)) ids.add(f.teams.home.id).add(f.teams.away.id);
    }
    return ids;
  });
  protected todaySorted = computed(() => [...(this.today() ?? [])].sort((a, b) => a.fixture.timestamp - b.fixture.timestamp));
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
      this.api.fixturesOn(todayInBrasilia()),
    ]).subscribe({
      next: ([fixtures, standings, next, today]) => {
        if (round !== this.round()) return;
        this.fixtures.set(fixtures);
        this.today.set(today);
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
    // Sem dados de hoje: esconde a seção em vez de deixar o esqueleto girando.
    if (this.today() === null) this.today.set([]);
    this.error.set('Não foi possível carregar os dados. Tentando de novo em instantes…');
  }

  protected roundName = roundName;
  // Uma rodada tem 10 jogos; 6 cards de esqueleto já preenchem a tela.
  protected skeletonCards = [0, 1, 2, 3, 4, 5];
  protected skeletonStandings = Array.from({ length: 20 }, (_, i) => i);

  protected isDelayed(f: Fixture): boolean {
    const start = this.nextRoundStart();
    return start !== null && f.fixture.timestamp > start;
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

/** Data de hoje em Brasília, no formato AAAA-MM-DD. */
function todayInBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** "Regular Season - 36" → "36ª rodada" */
function roundName(round: string | null): string {
  const n = round?.match(/(\d+)$/)?.[1];
  return n ? `${n}ª rodada` : (round ?? '');
}
