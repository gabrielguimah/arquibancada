import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatFormField } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import { ApiFootball, TeamRating, TeamRatings } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { nearBottom } from '../../shared/infinite-scroll';
import { ratingClass } from '../../shared/rating';
import { TEAM_METRICS, TeamMetric } from './team-metrics';

// Linhas visíveis (a altura da tabela) e quantas a rolagem infinita acrescenta por vez.
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
  imports: [Crest, MatTooltip, MatFormField, MatSelect, MatOption],
  templateUrl: './team-ratings.html',
  styleUrl: './team-ratings.scss',
})
export class TeamRatingsTables {
  private api = inject(ApiFootball);
  private retry?: ReturnType<typeof setTimeout>;

  private data = signal<TeamRatings | null>(null);
  protected message = signal<string | null>(null);
  // "Ver mais" não aumenta a tabela: liga a rolagem dentro dela, que vai carregando mais linhas.
  protected expanded = signal<Record<RatingTable['id'], boolean>>({ season: false, last5: false });
  protected shown = signal<Record<RatingTable['id'], number>>({ season: PAGE, last5: PAGE });

  protected metrics = TEAM_METRICS;
  protected metric = signal<TeamMetric>(TEAM_METRICS[0]);

  protected tables = computed<RatingTable[]>(() => {
    const d = this.data();
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
    this.collapseAll();
  }

  private collapseAll() {
    this.expanded.set({ season: false, last5: false });
    this.shown.set({ season: PAGE, last5: PAGE });
  }

  protected visible(t: RatingTable): RankedRow[] {
    return (t.rows ?? []).slice(0, this.shown()[t.id]);
  }

  protected toggle(t: RatingTable) {
    const open = !this.expanded()[t.id];
    this.expanded.update((e) => ({ ...e, [t.id]: open }));
    // Aberta, já carrega um bloco a mais para haver o que rolar.
    this.shown.update((s) => ({ ...s, [t.id]: open ? PAGE * 2 : PAGE }));
  }

  protected onScroll(t: RatingTable, event: Event) {
    if (nearBottom(event) && this.shown()[t.id] < (t.rows?.length ?? 0)) {
      this.shown.update((s) => ({ ...s, [t.id]: s[t.id] + PAGE }));
    }
  }

  protected tip(r: TeamRating): string {
    if (this.metric().id === 'rating') {
      return r.matches?.length ? `Do jogo mais recente ao mais antigo: ${r.matches.map((m) => m.toFixed(2)).join(' · ')}` : '';
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
