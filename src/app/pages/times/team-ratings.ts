import { Component, DestroyRef, ElementRef, Injector, computed, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ApiFootball, TeamRating, TeamRatings } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { PillSwitch } from '../../shared/pill-switch';
import { FavoriteHeart } from '../../shared/favorite-heart';
import { FavoriteTeam } from '../../shared/favorite-team';
import { openFavoriteTeamDialog } from '../../shared/favorite-team-dialog';
import { formatRating, ratingClass } from '../../shared/rating';
import { TEAM_METRICS, TEAM_TABS, TeamMetric, TeamTab } from './team-metrics';

// As estatísticas são calculadas em segundo plano no Worker; enquanto não ficam prontas, tenta de novo.
const RETRY_MS = 60_000;

type Period = 'season' | 'last5';
type Venue = 'all' | 'home' | 'away';

interface Sort {
  column: TeamMetric['id'];
  ascending: boolean;
}

/** Posição do time do coração numa estatística (1º = o melhor, mesmo onde menor é melhor). */
interface FavoriteRank {
  metric: TeamMetric;
  /** Nome na linha: onde menor é melhor, "Menos …" (o 1º é quem tem menos). */
  label: string;
  text: string;
  rank: number;
  /** 1º lugar (azul do melhor da partida), entre os 3 melhores ou os 3 piores; senão, sem destaque. */
  tone: 'first' | 'top' | 'bottom' | null;
}

/** Líder de uma categoria no card Destaques. */
interface Highlight {
  label: string;
  metric: TeamMetric;
  row: TeamRating;
  text: string;
}

// Estatísticas do card do time do coração e dos Destaques (as de mais leitura, na ordem da tabela).
const FAVORITE_METRICS: Array<TeamMetric['id']> = [
  'rating',
  'goalsFor',
  'goalsAgainst',
  'xg',
  'cleanSheets',
  'possession',
  'shots',
  'passesAccurate',
  'tackles',
  'yellowCards',
  'redCards',
];
const HIGHLIGHTS: Array<{ label: string; metric: TeamMetric['id'] }> = [
  { label: 'Melhor nota', metric: 'rating' },
  { label: 'Melhor ataque', metric: 'goalsFor' },
  { label: 'Melhor defesa', metric: 'goalsAgainst' },
  { label: 'Mais jogos sem sofrer gols', metric: 'cleanSheets' },
  { label: 'Mais posse de bola', metric: 'possession' },
];

const metricById = (id: TeamMetric['id']) => TEAM_METRICS.find((m) => m.id === id)!;

interface Line {
  rank: number;
  row: TeamRating;
  cells: Array<{ metric: TeamMetric; value: number | null; text: string }>;
}

/**
 * Tabela dos times: as estatísticas em colunas, separadas por categoria (abas, como na tabela de
 * jogadores), da temporada inteira ou das últimas 5 partidas (o seletor no topo). Clique no título
 * ordena.
 */
@Component({
  selector: 'app-team-ratings',
  imports: [Crest, FavoriteHeart, MatIcon, MatTooltip, PillSwitch],
  host: { class: 'times' },
  templateUrl: './team-ratings.html',
  styleUrl: './team-ratings.scss',
})
export class TeamRatingsTables {
  private api = inject(ApiFootball);
  private retry?: ReturnType<typeof setTimeout>;

  protected periods: Array<{ id: Period; label: string }> = [
    { id: 'season', label: 'Temporada' },
    { id: 'last5', label: 'Últimas 5 partidas' },
  ];
  protected venues: Array<{ id: Venue; label: string; icon?: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'home', label: 'Casa', icon: 'home' },
    { id: 'away', label: 'Fora', icon: 'flight' },
  ];
  protected tabs = TEAM_TABS;
  // Esqueletos do mesmo tamanho do conteúdo carregado: 20 times na tabela, uma linha por estatística no
  // card do time do coração e uma por destaque.
  protected skeleton = Array.from({ length: 20 }, (_, i) => i);
  protected favSkeleton = FAVORITE_METRICS.map((_, i) => i);
  protected highlightSkeleton = HIGHLIGHTS.map((_, i) => i);

  private data = signal<TeamRatings | null>(null);
  protected message = signal<string | null>(null);
  protected period = signal<Period>('season');
  protected venue = signal<Venue>('all');
  /** Seletores de período e mando à mostra (o botão Filtros abre e fecha). */
  protected filtersOpen = signal(false);
  /** O que está escolhido, no botão Filtros (para ver sem abrir). */
  protected filtersSummary = computed(() => {
    const period = this.period() === 'season' ? 'Temporada' : 'Últimas 5';
    const venue = { all: 'Todos', home: 'Casa', away: 'Fora' }[this.venue()];
    return `${period} · ${venue}`;
  });
  /** Celular e tela média: o que aparece, a tabela ou o resumo (no computador, os dois lado a lado). */
  protected section = signal<'tabela' | 'resumo'>('tabela');
  protected tab = signal<TeamTab>(TEAM_TABS[0]);
  protected sort = signal<Sort>(initialSort(TEAM_TABS[0]));

  /** Linhas da tabela, ordenadas pela coluna escolhida; `null` enquanto carrega (esqueleto). */
  protected lines = computed<Line[] | null>(() => {
    const rows = this.rows();
    if (!rows) return null;
    const { column, ascending } = this.sort();
    const tab = this.tab();
    const metric = TEAM_METRICS.find((m) => m.id === column) ?? tab.columns[0];
    const sorted = rows
      .map((row) => ({ row, key: metric.value(row) }))
      .sort((a, b) => {
        // Sem valor (ainda calculando) vai para o fim; empate: nota média, depois o nome.
        if (a.key === null || b.key === null) return a.key === null ? (b.key === null ? 0 : 1) : -1;
        return (
          (ascending ? a.key - b.key : b.key - a.key) ||
          (b.row.rating ?? 0) - (a.row.rating ?? 0) ||
          a.row.team.name.localeCompare(b.row.team.name, 'pt-BR')
        );
      });
    return sorted.map(({ row }, i) => ({
      rank: i + 1,
      row,
      cells: tab.columns.map((metric) => {
        const value = metric.value(row);
        return { metric, value, text: value === null ? '–' : metric.format(value) };
      }),
    }));
  });

  protected ratingClass = ratingClass;

  protected favorite = inject(FavoriteTeam);
  private injector = inject(Injector);
  private tableCard = viewChild<ElementRef<HTMLElement>>('tableCard');

  /** Linhas do período (temporada ou últimas 5) e do mando escolhidos; `null` enquanto carrega. */
  private rows = computed(() => {
    const d = this.data();
    const venue = this.venue();
    const rows = venue === 'all' ? d?.[this.period()] : d?.[venue]?.[this.period()];
    return rows?.length ? rows : null;
  });

  /** Card do time do coração: a posição dele em cada estatística, no período escolhido. */
  protected favoriteCard = computed(() => {
    const chosen = this.favorite.team();
    const rows = this.rows();
    if (!chosen || !rows) return null;
    const row = rows.find((r) => r.team.id === chosen.id);
    if (!row) return { team: chosen, row: null, ranks: [] as FavoriteRank[], total: rows.length };
    const ranks = FAVORITE_METRICS.map(metricById).flatMap((metric): FavoriteRank[] => {
      const value = metric.value(row);
      if (value === null) return [];
      // Posição: 1 + quantos times estão melhores (empate divide a posição).
      const better = rows.filter((r) => {
        const v = metric.value(r);
        return v !== null && (metric.ascending ? v < value : v > value);
      }).length;
      const rank = better + 1;
      const tone = rank === 1 ? 'first' : rank <= 3 ? 'top' : rank > rows.length - 3 ? 'bottom' : null;
      const label = metric.ascending ? `Menos ${metric.title[0].toLowerCase()}${metric.title.slice(1)}` : metric.title;
      return [{ metric, label, text: metric.format(value), rank, tone }];
    });
    return { team: row.team, row, ranks, total: rows.length };
  });

  /** Destaques: o líder de cada categoria no período escolhido (desempate pela nota média). */
  protected highlights = computed<Highlight[] | null>(() => {
    const rows = this.rows();
    if (!rows) return null;
    return HIGHLIGHTS.flatMap(({ label, metric: id }) => {
      const metric = metricById(id);
      const leader = rows
        .filter((r) => metric.value(r) !== null)
        .sort((a, b) => {
          const [x, y] = [metric.value(a)!, metric.value(b)!];
          return (metric.ascending ? x - y : y - x) || (b.rating ?? 0) - (a.rating ?? 0);
        })[0];
      return leader ? [{ label, metric, row: leader, text: metric.format(metric.value(leader)!) }] : [];
    });
  });

  protected periodLabel = computed(() => {
    const period = this.period() === 'season' ? 'Na temporada' : 'Nas últimas 5 partidas';
    const venue = { all: '', home: ', em casa', away: ', fora de casa' }[this.venue()];
    return period + venue;
  });

  protected chooseFavorite() {
    openFavoriteTeamDialog(this.injector);
  }

  /**
   * Mostra a estatística na tabela: abre a aba em que ela é a principal (ou a primeira que a tem),
   * ordenada por ela, e rola até a tabela se ela estiver fora da tela. No celular, troca para a aba Tabela.
   */
  protected showMetric(id: TeamMetric['id']) {
    const tab = TEAM_TABS.find((t) => t.sort === id) ?? TEAM_TABS.find((t) => t.columns.some((c) => c.id === id)) ?? TEAM_TABS[0];
    this.tab.set(tab);
    this.sort.set({ column: id, ascending: !!metricById(id).ascending });
    // No celular, o resumo e a tabela ficam em abas: volta para a tabela.
    this.section.set('tabela');
    const card = this.tableCard()?.nativeElement;
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.retry));
    this.load(false);
  }

  private load(fresh: boolean) {
    this.api.teamRatings(fresh).subscribe({
      next: (d) => {
        this.data.set(d);
        this.message.set(null);
        // Algo ainda sendo calculado. Se a resposta pode ter vindo do cache do navegador,
        // pergunta ao Worker na hora; se já veio dele, espera o cálculo terminar.
        if (!complete(d)) this.retry = setTimeout(() => this.load(true), fresh ? RETRY_MS : 0);
      },
      error: (err: HttpErrorResponse) => {
        this.message.set(
          err.status === 503 ? 'Estatísticas dos times sendo calculadas. Elas aparecem aqui em alguns minutos.' : 'Não foi possível carregar.',
        );
        this.retry = setTimeout(() => this.load(true), RETRY_MS);
      },
    });
  }

  /** Troca a categoria: só as colunas dela, ordenadas pela principal. */
  protected selectTab(tab: TeamTab) {
    this.tab.set(tab);
    this.sort.set(initialSort(tab));
  }

  /** Clique no título: ordena pela coluna; de novo na mesma, inverte a ordem. */
  protected sortBy(m: TeamMetric) {
    const current = this.sort();
    this.sort.set(current.column === m.id ? { column: m.id, ascending: !current.ascending } : { column: m.id, ascending: !!m.ascending });
  }

  protected ariaSort(m: TeamMetric): 'ascending' | 'descending' | null {
    const s = this.sort();
    return s.column === m.id ? (s.ascending ? 'ascending' : 'descending') : null;
  }

  /** Tooltip da nota: as notas de cada jogo (só nas últimas 5 partidas). */
  protected ratingTip(r: TeamRating): string {
    return r.matches?.length ? `Do jogo mais recente ao mais antigo: ${r.matches.map(formatRating).join(' · ')}` : '';
  }
}

/** Ordenação inicial da aba: pela coluna principal, crescente se menor é melhor (ex.: cartões). */
function initialSort(tab: TeamTab): Sort {
  return { column: tab.sort, ascending: !!TEAM_METRICS.find((m) => m.id === tab.sort)?.ascending };
}

function complete(d: TeamRatings): boolean {
  return !!d.season?.length && !!d.last5?.length && d.season.every((r) => r.stats && r.rating !== null) && !!d.home && !!d.away;
}
