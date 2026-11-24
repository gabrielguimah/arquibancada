import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect } from '@angular/material/select';
import { catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import { ApiFootball, Fixture, Standing } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { FixtureCard, TZ, isLive, todayInBrasilia } from '../../shared/fixture-card';
import { FixtureCardSkeleton } from '../../shared/fixture-card-skeleton';
import { LiveFixtures } from '../../shared/live-fixtures';
import { FINISHED, liveStandings } from './live-standings';
import { TeamRatingsTables } from './team-ratings';

// Jogos encerrados: os eventos deles (cartões) vêm de uma busca própria, com cache longo no Worker.
// Os jogos ao vivo vêm de LiveFixtures, compartilhado com os avisos de gol.

// Jogo encerrado há menos que isso pode ainda não estar na classificação da API (ela demora a atualizar).
const STANDINGS_LAG_MS = 6 * 3600_000;

// Intervalo de atualização das listas: com jogo rolando, 1 min (o Worker guarda as listas por 1 min;
// placar, relógio e cartões ao vivo chegam a cada 15 s por LiveFixtures). Sem jogo, 5 min.
const REFRESH_LIVE_MS = 60_000;
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

interface FormResult {
  result: 'V' | 'E' | 'D';
  /** Parcial de jogo em andamento. */
  live: boolean;
}

@Component({
  selector: 'app-rodada',
  imports: [
    Crest,
    FixtureCard,
    FixtureCardSkeleton,
    MatIcon,
    MatFormField,
    MatSelect,
    MatOption,
    TeamRatingsTables,
  ],
  templateUrl: './rodada.html',
  styleUrl: './rodada.scss',
})
export class Rodada {
  private api = inject(ApiFootball);
  private live = inject(LiveFixtures);
  private timer?: ReturnType<typeof setTimeout>;
  private standingsLoading = false;

  protected rounds = signal<string[]>([]);
  protected round = signal<string | null>(null);
  protected fixtures = signal<Fixture[]>([]);
  // Data típica (mediana) da rodada seguinte: jogos desta rodada disputados depois dela são atrasados.
  protected nextRoundStart = signal<number | null>(null);
  // null até a primeira resposta: a seção "Partidas de hoje" mostra o esqueleto.
  protected today = signal<Fixture[] | null>(null);
  protected standings = signal<Standing[]>([]);
  // Jogos encerrados da temporada: só carregados com jogo rolando ou encerrado há pouco (classificação ao vivo).
  private seasonFinished = signal<Fixture[] | null>(null);
  protected error = signal<string | null>(null);
  protected loading = signal(true);

  // Listas com os dados ao vivo por cima (placar, status, eventos), quando o jogo está em LiveFixtures.
  private roundView = computed(() => this.withLive(this.fixtures()));
  private todayView = computed(() => this.withLive(this.today() ?? []));

  // Jogos (da rodada e de hoje) já carregaram uma vez; trocar de rodada depois não volta a esperar.
  private fixturesLoaded = signal(false);
  // Classificação e jogos carregados, ou falhou: libera a seção Times, que fica no esqueleto até lá
  // para não aparecer antes do resto da página.
  protected pageLoaded = computed(
    () => !!this.error() || (this.standings().length > 0 && this.fixturesLoaded()),
  );

  protected roundIndex = computed(() => this.rounds().indexOf(this.round() ?? ''));
  protected hasLive = computed(() =>
    [...this.roundView(), ...this.todayView()].some((f) => isLive(f)),
  );
  // Times em campo agora, para a bolinha ao vivo na tabela.
  protected liveTeams = computed(() => {
    const ids = new Set<number>();
    for (const f of [...this.roundView(), ...this.todayView()]) {
      if (isLive(f)) ids.add(f.teams.home.id).add(f.teams.away.id);
    }
    return ids;
  });
  protected todaySorted = computed(() =>
    [...this.todayView()].sort((a, b) => a.fixture.timestamp - b.fixture.timestamp),
  );
  protected days = computed<FixtureDay[]>(() => {
    const groups = new Map<string, Fixture[]>();
    for (const f of [...this.roundView()].sort(
      (a, b) => a.fixture.timestamp - b.fixture.timestamp,
    )) {
      const label = new Date(f.fixture.date).toLocaleDateString('pt-BR', {
        timeZone: TZ,
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
      });
      groups.set(label, [...(groups.get(label) ?? []), f]);
    }
    return [...groups].map(([label, fixtures]) => ({
      label: label[0].toUpperCase() + label.slice(1),
      fixtures,
    }));
  });

  // Classificação com os jogos em andamento (e os encerrados que a API ainda não contou).
  private liveTable = computed(() =>
    liveStandings(this.standings(), [...this.roundView(), ...this.todayView()], this.seasonFinished()),
  );

  protected standingGroups = computed<StandingGroup[]>(() => {
    const groups: StandingGroup[] = [];
    for (const s of this.liveTable()) {
      const zone = zoneOf(s);
      const last = groups.at(-1);
      if (last && last.zone?.id === zone?.id) last.rows.push(s);
      else groups.push({ zone, rows: [s] });
    }
    return groups;
  });

  constructor() {
    this.live.start();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // A classificação não depende da rodada: busca já, sem esperar rodadas, jogos e eventos.
    this.loadStandings();
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
    this.loadStandings();
    forkJoin([
      this.api.fixtures(round),
      nextRound ? this.api.fixtures(nextRound) : of([]),
      this.api.fixturesOn(todayInBrasilia()),
    ])
      .pipe(
        switchMap(([fixtures, next, today]) =>
          this.withEvents(fixtures, today).pipe(map(([f, t]) => [f, next, t] as const)),
        ),
      )
      .subscribe({
        next: ([fixtures, next, today]) => {
          if (round !== this.round()) return;
          this.fixtures.set(fixtures);
          this.today.set(today);
          // Mediana, e não o primeiro jogo: um jogo antecipado da rodada seguinte não deve marcar os desta como atrasados.
          const nextStarts = next
            .filter((f) => f.fixture.status.short !== 'PST')
            .map((f) => f.fixture.timestamp)
            .sort((a, b) => a - b);
          this.nextRoundStart.set(
            nextStarts.length ? nextStarts[Math.floor(nextStarts.length / 2)] : null,
          );
          this.loadSeasonFinished([...fixtures, ...today]);
          this.error.set(null);
          this.loading.set(false);
          this.fixturesLoaded.set(true);
          this.timer = setTimeout(
            () => this.load(),
            this.hasLive() ? REFRESH_LIVE_MS : REFRESH_IDLE_MS,
          );
        },
        error: () => {
          this.fail();
          this.timer = setTimeout(() => this.load(), REFRESH_LIVE_MS);
        },
      });
  }

  /**
   * Só com jogo rolando ou encerrado há pouco a classificação ao vivo precisa saber quais jogos a API
   * já contou; fora disso, não baixa a lista da temporada. Se a busca falhar, conta só os em andamento.
   */
  private loadSeasonFinished(fixtures: Fixture[]) {
    const now = Date.now();
    const recent = this.withLive(fixtures).some(
      (f) =>
        isLive(f) ||
        (FINISHED.has(f.fixture.status.short) && now - f.fixture.timestamp * 1000 < STANDINGS_LAG_MS),
    );
    if (!recent) {
      this.seasonFinished.set(null);
      return;
    }
    this.api
      .finishedFixtures()
      .pipe(catchError(() => of(null)))
      .subscribe((list) => this.seasonFinished.set(list));
  }

  /** Busca a classificação, a não ser que já haja uma busca dela em andamento (a do construtor, na primeira carga). */
  private loadStandings() {
    if (this.standingsLoading) return;
    this.standingsLoading = true;
    this.api
      .standings()
      .pipe(finalize(() => (this.standingsLoading = false)))
      .subscribe({
        next: (standings) => this.standings.set(standings),
        error: () => this.fail(),
      });
  }

  private withLive(list: Fixture[]): Fixture[] {
    const live = this.live.byId();
    return list.map((f) => live.get(f.fixture.id) ?? f);
  }

  /**
   * Junta os eventos (cartões vermelhos, gols) aos jogos encerrados da rodada e de hoje: as listas da
   * API não trazem eventos, só a busca por id. Se essa busca falhar, segue sem eles.
   */
  private withEvents(round: Fixture[], today: Fixture[]) {
    const finished = (f: Fixture) => FINISHED.has(f.fixture.status.short);
    const ids = [...new Set([...round, ...today].filter(finished).map((f) => f.fixture.id))];
    return this.api.fixturesByIds(ids).pipe(
      catchError(() => of([] as Fixture[])),
      map((detailed) => {
        const byId = new Map(detailed.map((f) => [f.fixture.id, f]));
        const merge = (list: Fixture[]) => list.map((f) => byId.get(f.fixture.id) ?? f);
        return [merge(round), merge(today)] as const;
      }),
    );
  }

  private fail() {
    this.loading.set(false);
    // Sem dados de hoje: esconde a seção em vez de deixar o esqueleto girando.
    if (this.today() === null) this.today.set([]);
    this.error.set('Não foi possível carregar os dados. Tentando de novo em instantes…');
  }

  protected roundName = roundName;

  // Critérios de desempate do Campeonato Brasileiro (regulamento da CBF), na ordem.
  protected tiebreakRules = [
    'Número de vitórias',
    'Saldo de gols',
    'Gols marcados',
    'Confronto direto',
    'Menos cartões vermelhos',
    'Menos cartões amarelos',
    'Sorteio',
  ];

  // Siglas das colunas da classificação.
  protected glossary = [
    { term: 'Pts', meaning: 'Pontos' },
    { term: 'J', meaning: 'Jogos disputados' },
    { term: 'V', meaning: 'Vitórias' },
    { term: 'E', meaning: 'Empates' },
    { term: 'D', meaning: 'Derrotas' },
    { term: 'SG', meaning: 'Saldo de gols' },
    { term: 'Gols', meaning: 'Gols marcados : gols sofridos' },
    {
      term: 'Últimas 5',
      meaning:
        'Resultados dos últimos 5 jogos, do mais antigo ao mais recente (V, E, D); com contorno azul, o parcial do jogo em andamento',
    },
  ];
  // Uma rodada tem 10 jogos; 6 cards de esqueleto já preenchem a tela.
  protected skeletonCards = [0, 1, 2, 3, 4, 5];
  protected skeletonStandings = Array.from({ length: 20 }, (_, i) => i);

  protected isDelayed(f: Fixture): boolean {
    const start = this.nextRoundStart();
    return start !== null && f.fixture.timestamp > start;
  }

  /**
   * Últimos 5 jogos, do mais antigo para o mais recente (a API manda o mais recente primeiro).
   * Com jogo em andamento, o mais recente é o resultado parcial dele.
   */
  protected form(s: Standing): FormResult[] {
    const map: Record<string, FormResult['result']> = { W: 'V', D: 'E', L: 'D' };
    const results = [...(s.form ?? '')].map((c, i) => ({ result: map[c], live: i === 0 && !!s.liveForm }));
    return results.filter((r) => r.result).reverse();
  }

  protected moveLabel(change: number): string {
    const n = Math.abs(change);
    return `${change > 0 ? 'Subiu' : 'Caiu'} ${n} ${n === 1 ? 'posição' : 'posições'} com os jogos em andamento`;
  }

  protected legend = computed(() => {
    const seen = new Map<string, Zone>();
    for (const g of this.standingGroups()) if (g.zone) seen.set(g.zone.id, g.zone);
    return [...seen.values()];
  });
}

function zoneOf(s: Standing): Zone | null {
  const d = s.description ?? '';
  if (d.includes('Libertadores') && d.includes('Qualification'))
    return { id: 'pre-libertadores', label: 'Pré-Libertadores' };
  if (d.includes('Libertadores')) return { id: 'libertadores', label: 'Libertadores' };
  if (d.includes('Sudamericana')) return { id: 'sulamericana', label: 'Sul-Americana' };
  if (d.includes('Relegation')) return { id: 'rebaixamento', label: 'Rebaixamento' };
  return null;
}

/** "Regular Season - 36" → "36ª rodada" */
function roundName(round: string | null): string {
  const n = round?.match(/(\d+)$/)?.[1];
  return n ? `${n}ª rodada` : (round ?? '');
}
