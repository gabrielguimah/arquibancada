import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatFormField } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import { ApiFootball, TeamRating, TeamRatings } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { Pager } from '../../shared/pager';
import { formatRating, ratingClass } from '../../shared/rating';
import { TEAM_METRICS, TeamMetric } from './team-metrics';

// Linhas por página (a altura da tabela).
const PAGE = 5;
// As estatísticas são calculadas em segundo plano no Worker; enquanto não ficam prontas, tenta de novo.
const RETRY_MS = 60_000;

interface RankedRow {
  row: TeamRating;
  rank: number;
  value: number;
}

interface RatingTable {
  id: 'season' | 'last5';
  subtitle: string;
  /** `null` enquanto carrega (esqueleto). */
  rows: RankedRow[] | null;
}

/** Duas tabelas de times (temporada inteira e últimas 5 partidas), ordenadas pelo critério do select. */
@Component({
  selector: 'app-team-ratings',
  imports: [Crest, MatTooltip, MatFormField, MatSelect, MatOption, Pager],
  templateUrl: './team-ratings.html',
  styleUrl: './team-ratings.scss',
})
export class TeamRatingsTables {
  private api = inject(ApiFootball);
  private retry?: ReturnType<typeof setTimeout>;

  /**
   * Libera a exibição: a página da rodada só mostra as tabelas depois que a classificação e os jogos
   * carregaram, para a seção não aparecer antes do resto. Até lá, fica no esqueleto.
   */
  ready = input(true);

  private data = signal<TeamRatings | null>(null);
  /** Título e filtro aparecem junto com as tabelas (ou com o aviso, se não carregarem). */
  protected showToolbar = computed(() => this.ready() && (this.data() !== null || this.message() !== null));
  protected message = signal<string | null>(null);
  // Página atual de cada tabela.
  protected page = signal<Record<RatingTable['id'], number>>({ season: 1, last5: 1 });

  protected metrics = TEAM_METRICS;
  protected metric = signal<TeamMetric>(TEAM_METRICS[0]);

  protected tables = computed<RatingTable[]>(() => {
    const d = this.ready() ? this.data() : null;
    return [
      { id: 'season', subtitle: 'Temporada inteira', rows: rank(d?.season ?? null, this.metric()) },
      { id: 'last5', subtitle: 'Últimas 5 partidas', rows: rank(d?.last5 ?? null, this.metric()) },
    ];
  });

  protected ratingClass = ratingClass;
  protected skeleton = Array.from({ length: PAGE }, (_, i) => i);

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

  protected selectMetric(id: TeamMetric['id']) {
    this.metric.set(TEAM_METRICS.find((m) => m.id === id) ?? TEAM_METRICS[0]);
    this.page.set({ season: 1, last5: 1 });
  }

  protected pages(t: RatingTable): number {
    return Math.max(1, Math.ceil((t.rows?.length ?? 0) / PAGE));
  }

  protected setPage(t: RatingTable, page: number) {
    this.page.update((p) => ({ ...p, [t.id]: page }));
  }

  protected visible(t: RatingTable): RankedRow[] {
    const start = (this.page()[t.id] - 1) * PAGE;
    return (t.rows ?? []).slice(start, start + PAGE);
  }

  protected tip(r: TeamRating): string {
    if (this.metric().id === 'rating') {
      return r.matches?.length ? `Do jogo mais recente ao mais antigo: ${r.matches.map(formatRating).join(' · ')}` : '';
    }
    return r.games ? `Em ${r.games} jogos` : '';
  }
}

/** Ordena do maior para o menor; a posição é sempre a da linha (empate não repete número). */
function rank(rows: TeamRating[] | null, metric: TeamMetric): RankedRow[] | null {
  if (!rows) return null;
  // Sem o valor (ex.: ainda calculando a parte das estatísticas): a tabela fica no esqueleto.
  const valued = rows.map((row) => ({ row, value: metric.value(row) })).filter((r): r is { row: TeamRating; value: number } => r.value !== null);
  if (!valued.length) return null;
  valued.sort((a, b) => b.value - a.value);
  return valued.map((r, i) => ({ ...r, rank: i + 1 }));
}

function complete(d: TeamRatings): boolean {
  return !!d.season?.length && !!d.last5?.length && d.season.every((r) => r.stats && r.rating !== null);
}
