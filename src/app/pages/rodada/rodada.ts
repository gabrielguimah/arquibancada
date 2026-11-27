import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import { ApiFootball, Fixture, FormMatch, Standing, Team } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { SectionTabs, TabOption } from '../../shared/section-tabs';
import { ToggleGroup, ToggleOption } from '../../shared/toggle-group';
import { FavoriteHeart } from '../../shared/favorite-heart';
import { FixtureCard, TZ, isLive, todayInBrasilia } from '../../shared/fixture-card';
import { FixtureCardSkeleton } from '../../shared/fixture-card-skeleton';
import { LiveFixtures } from '../../shared/live-fixtures';
import { RoundNav } from '../../shared/round-nav';
import { FINISHED, liveStandings } from './live-standings';
import { OVER, roundStarted } from '../../shared/fixture-status';
import { ChanceZone, SimMatch, simulateChances } from './chances';
import type { ChanceRow, UpcomingGame } from './season-chances';
import { SeasonChances } from './season-chances';

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
  /** O jogo (para o cartão ao passar o mouse), se o Worker mandou e ele confere com o resultado. */
  match: FormGame | null;
}

interface FormGame {
  date: string;
  home: Team;
  away: Team;
  homeGoals: number;
  awayGoals: number;
}

/** Cartão do jogo das "Últimas 5": acima do resultado (`x`, `y` na tela). */
interface FormTip {
  game: FormGame;
  live: boolean;
  x: number;
  y: number;
}

@Component({
  selector: 'app-rodada',
  imports: [
    Crest,
    FavoriteHeart,
    FixtureCard,
    FixtureCardSkeleton,
    MatIcon,
    SectionTabs,
    ToggleGroup,
    RoundNav,
    SeasonChances,
  ],
  templateUrl: './rodada.html',
  styleUrl: './rodada.scss',
  // Rolou a página: o cartão do jogo ficaria solto no lugar antigo.
  host: { '(window:scroll)': 'hideFormTip()' },
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

  // Jogos da temporada que ainda não começaram (chances); null até a primeira resposta.
  private remaining = signal<Fixture[] | null>(null);

  /**
   * Chances de título, Libertadores, Sul-Americana e rebaixamento: simula os jogos que faltam a partir da
   * classificação com os encerrados. Jogos em andamento entram com o placar e o tempo que falta, então as
   * chances mudam com os gols. `null` sem jogos pela frente (ou enquanto a lista não chegou).
   */
  protected chances = computed(() => {
    const remaining = this.remaining();
    const table = this.liveTable();
    if (!remaining || !table.length) return null;
    // Só depois dos primeiros jogos: antes disso, a força de cada time sai de quase nada e as chances
    // não dizem muito. Vale o número de jogos da maioria (mediana): um jogo adiado não esconde o painel.
    if (medianPlayed(table) < CHANCES_MIN_GAMES) return null;
    const pageGames = [...this.roundView(), ...this.todayView()];
    const live = [...new Map(pageGames.filter(isLive).map((f) => [f.fixture.id, f])).values()];
    // Status mais recente que a página conhece: a lista de não iniciados fica em cache por até 10 min.
    const known = new Map(pageGames.map((f) => [f.fixture.id, f.fixture.status.short]));
    const upcoming = this.withLive(remaining).filter((f) => {
      const status = known.get(f.fixture.id) ?? f.fixture.status.short;
      return NOT_STARTED.has(status);
    });
    if (!upcoming.length && !live.length) return null;

    // Base: a classificação sem os jogos em andamento (eles entram na simulação, com o placar atual).
    const settled = live.length
      ? liveStandings(this.standings(), pageGames.filter((f) => !isLive(f)), this.seasonFinished())
      : table;
    const matches: SimMatch[] = [
      ...live.map((f) => ({
        home: f.teams.home.id,
        away: f.teams.away.id,
        homeGoals: f.goals.home ?? 0,
        awayGoals: f.goals.away ?? 0,
        remaining: remainingFraction(f),
      })),
      ...upcoming.map((f) => ({ home: f.teams.home.id, away: f.teams.away.id, homeGoals: 0, awayGoals: 0, remaining: 1 })),
    ];
    const zones = this.positionZones();
    const result = simulateChances(settled, matches, zones);

    const games = new Map<number, UpcomingGame[]>();
    const add = (team: number, game: UpcomingGame) => games.set(team, [...(games.get(team) ?? []), game]);
    for (const f of [...live, ...[...upcoming].sort((a, b) => a.fixture.timestamp - b.fixture.timestamp)]) {
      const { home, away } = f.teams;
      const running = isLive(f);
      const [hg, ag] = [f.goals.home ?? 0, f.goals.away ?? 0];
      // Data do jogo; adiado ou sem data definida ainda: "a definir".
      const date = ['TBD', 'PST'].includes(f.fixture.status.short)
        ? 'a definir'
        : new Date(f.fixture.timestamp * 1000).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
      add(home.id, { id: f.fixture.id, opponent: away, home: true, date, live: running ? `${hg}-${ag}` : null });
      add(away.id, { id: f.fixture.id, opponent: home, home: false, date, live: running ? `${ag}-${hg}` : null });
    }
    const rows: ChanceRow[] = table.map((s) => ({
      team: s.team,
      rank: s.rank,
      points: s.points,
      upcoming: games.get(s.team.id) ?? [],
      chances: result.get(s.team.id)!,
    }));
    const present = new Set(zones);
    const columns = new Set<'title' | 'libertadores' | 'sulamericana' | 'relegation'>(['title']);
    if (present.has('libertadores')) columns.add('libertadores');
    if (present.has('sulamericana')) columns.add('sulamericana');
    if (present.has('rebaixamento')) columns.add('relegation');
    return { rows, columns, live: live.length > 0 };
  });

  /**
   * Por que a opção Chances está bloqueada (`null`: liberada). Com cadeado quando não há o que mostrar
   * (começo da temporada ou campeonato encerrado); sem cadeado enquanto os dados ainda carregam.
   */
  protected chancesBlocked = computed<{ text: string; lock: boolean } | null>(() => {
    if (this.chances()) return null;
    const table = this.liveTable();
    if (!table.length || !this.remaining()) return CHANCES_LOCKS.carregando;
    return medianPlayed(table) < CHANCES_MIN_GAMES ? CHANCES_LOCKS.inicio : CHANCES_LOCKS.encerrado;
  });

  // Grade exibida: a classificação (padrão) ou as chances. Sem chances para mostrar, sempre a classificação.
  private view = signal<'tabela' | 'chances'>('tabela');
  protected showChances = computed(() => this.view() === 'chances' && !!this.chances() && !this.chancesBlocked());

  protected setView(view: 'tabela' | 'chances') {
    this.hideFormTip();
    this.view.set(view);
  }

  /** Celular e tela média: aba escolhida. Classificação e Chances trocam também a grade da coluna da tabela. */
  protected section = signal<'jogos' | 'tabela' | 'chances'>('jogos');

  // Abas do celular e troca do computador: Chances bloqueada (com o motivo no tooltip) quando não há chances.
  protected sectionOptions = computed<TabOption<'jogos' | 'tabela' | 'chances'>[]>(() => [
    { id: 'jogos', label: 'Jogos' },
    { id: 'tabela', label: 'Classificação' },
    { id: 'chances', label: 'Chances', blocked: this.chancesBlocked() },
  ]);
  protected viewOptions = computed<ToggleOption<'tabela' | 'chances'>[]>(() => [
    { id: 'tabela', label: 'Classificação' },
    { id: 'chances', label: 'Chances', blocked: this.chancesBlocked() },
  ]);

  protected setSection(section: 'jogos' | 'tabela' | 'chances') {
    this.section.set(section);
    if (section !== 'jogos') this.setView(section);
  }

  /** Zona de cada posição (1ª, 2ª…), como na tabela: Libertadores e pré-Libertadores juntas. */
  private positionZones = computed<ChanceZone[]>(() =>
    this.standingGroups().flatMap((g) => {
      const id = g.zone?.id;
      const zone: ChanceZone =
        id === 'libertadores' || id === 'pre-libertadores' ? 'libertadores' : id === 'sulamericana' || id === 'rebaixamento' ? id : null;
      return g.rows.map(() => zone);
    }),
  );

  protected standingGroups = computed<StandingGroup[]>(() => {
    const groups: StandingGroup[] = [];
    let continental = true;
    for (const s of this.liveTable()) {
      let zone = zoneOf(s);
      // Vagas continentais só no bloco do topo. A API marca também quem se classificou por fora (ex.:
      // campeão de copa no meio da tabela), mas a zona vai com a posição, não com o time: na tabela ao
      // vivo, ela passaria para quem ocupasse aquela posição.
      if (!zone || !CONTINENTAL.has(zone.id)) continental = false;
      else if (!continental) zone = null;
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
        this.selectRound(current, true);
      },
      error: () => this.fail(),
    });
  }

  /**
   * `auto`: rodada escolhida pelo site (a atual da API), não pelo usuário. Aí, quando todos os jogos dela
   * acabam, passa sozinha para a seguinte (a API demora a virar a rodada atual).
   */
  protected selectRound(round: string, auto = false) {
    this.autoRound = auto;
    this.round.set(round);
    this.fixtures.set([]);
    this.nextRoundStart.set(null);
    this.loading.set(true);
    this.load();
  }

  private autoRound = false;

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
          // Rodada escolhida pelo site: vai para a seguinte quando todos os jogos desta acabaram (ou foram
          // adiados/cancelados) ou quando a seguinte já começou. Um jogo atrasado (às vezes por meses) não
          // prende a página na rodada dele; ele continua em "Partidas de hoje" no dia em que for jogado.
          const over = fixtures.length > 0 && fixtures.every((f) => OVER.has(f.fixture.status.short));
          if (this.autoRound && nextRound && (over || roundStarted(this.withLive(next)))) {
            return this.selectRound(nextRound, true);
          }
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
          this.loadRemaining();
          this.error.set(null);
          this.loading.set(false);
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

  /** Jogos que faltam (chances). Se falhar, mantém a lista anterior. */
  private loadRemaining() {
    this.api
      .remainingFixtures()
      .pipe(catchError(() => of(null)))
      .subscribe((list) => {
        if (list) this.remaining.set(list);
      });
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
  // Linhas antes das quais o esqueleto põe um título de zona (1º, 5º, 7º e 17º: as zonas de sempre).
  protected skeletonZones = [0, 4, 6, 16];

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
    const results = [...(s.form ?? '')].map((c, i) => ({
      result: map[c],
      live: i === 0 && !!s.liveForm,
      match: this.formGame(s.team.id, c, s.formMatches?.[i]),
    }));
    return results.filter((r) => r.result).reverse();
  }

  // Times da classificação pelo id (nome e escudo do adversário no cartão do jogo).
  private teamsById = computed(() => new Map(this.standings().map((s) => [s.team.id, s.team])));

  /** Jogo de um resultado das "Últimas 5"; `null` se não veio ou não confere com a letra (W/D/L). */
  private formGame(teamId: number, letter: string, m: FormMatch | undefined): FormGame | null {
    const teams = this.teamsById();
    const [home, away] = m ? [teams.get(m.h), teams.get(m.a)] : [];
    if (!m || !home || !away) return null;
    const [own, other] = m.h === teamId ? [m.hg, m.ag] : [m.ag, m.hg];
    if ((own > other ? 'W' : own < other ? 'L' : 'D') !== letter) return null;
    const date = new Date(m.t * 1000).toLocaleDateString('pt-BR', { timeZone: TZ, day: 'numeric', month: 'long' });
    return { date, home, away, homeGoals: m.hg, awayGoals: m.ag };
  }

  protected formTip = signal<FormTip | null>(null);

  /** Mostra o cartão do jogo acima do resultado (mouse em cima, foco pelo teclado ou toque no celular). */
  protected showFormTip(event: Event, r: FormResult) {
    if (!r.match) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Centralizado no resultado, sem passar da borda da tela (o cartão tem até 300 px).
    const half = Math.min(150, (window.innerWidth - 32) / 2);
    const x = Math.min(Math.max(rect.left + rect.width / 2, 16 + half), window.innerWidth - 16 - half);
    this.formTip.set({ game: r.match, live: r.live, x, y: rect.top - 8 });
  }

  protected hideFormTip() {
    this.formTip.set(null);
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

// Jogos que cada time precisa ter disputado (a maioria deles) para as chances aparecerem.
const CHANCES_MIN_GAMES = 5;

// Jogo que ainda não começou (adiado e sem data também: ainda vai ser disputado).
const NOT_STARTED = new Set(['NS', 'TBD', 'PST']);

// Motivos da opção Chances bloqueada (tooltip): com cadeado quando não há o que mostrar; sem cadeado
// enquanto os dados carregam.
const CHANCES_LOCKS = {
  carregando: { text: 'Carregando as chances…', lock: false },
  inicio: { text: `As chances aparecem depois que os times disputarem ${CHANCES_MIN_GAMES} jogos.`, lock: true },
  encerrado: { text: 'Campeonato encerrado: não há mais jogos para simular.', lock: true },
};

/** Jogos disputados pela maioria dos times (mediana): um jogo adiado não muda a conta. */
function medianPlayed(table: Standing[]): number {
  const played = table.map((s) => s.all.played).sort((a, b) => a - b);
  return played[Math.floor(played.length / 2)] ?? 0;
}

/** Fração do jogo em andamento que ainda falta (pelo minuto): 1 no início, 0,5 no intervalo. */
function remainingFraction(f: Fixture): number {
  const { short, elapsed } = f.fixture.status;
  if (short === 'HT') return 0.5;
  if (!['1H', '2H', 'LIVE'].includes(short)) return 0;
  return Math.max(0, Math.min(1, (90 - (elapsed ?? 0)) / 90));
}

const CONTINENTAL = new Set(['libertadores', 'pre-libertadores', 'sulamericana']);

function zoneOf(s: Standing): Zone | null {
  const d = s.description ?? '';
  if (d.includes('Libertadores') && d.includes('Qualification'))
    return { id: 'pre-libertadores', label: 'Pré-Libertadores' };
  if (d.includes('Libertadores')) return { id: 'libertadores', label: 'Libertadores' };
  if (d.includes('Sudamericana')) return { id: 'sulamericana', label: 'Sul-Americana' };
  if (d.includes('Relegation')) return { id: 'rebaixamento', label: 'Rebaixamento' };
  return null;
}
