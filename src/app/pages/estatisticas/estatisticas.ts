import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ApiFootball, PlayerStat, RatedPlayer, Team, TopRated } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { RoundTeamCard } from './round-team';
import { nearBottom } from '../../shared/infinite-scroll';
import { ratingClass } from '../../shared/rating';

// Linhas visíveis (a altura dos quadros) e quantas a rolagem infinita acrescenta por vez.
const COLLAPSED = 10;
const STEP = 5;
// Fração dos jogos de quem mais jogou exigida no filtro "Regulares".
const REGULAR_FRACTION = 0.5;
// O ranking de notas é montado em segundo plano no Worker; enquanto não fica pronto, tenta de novo.
const RATED_RETRY_MS = 60_000;

type Filter = 'todos' | 'regulares';

/** Linha de um ranking, no mesmo formato para gols, assistências e notas. */
interface Leader {
  id: number;
  rank: number;
  name: string;
  photo: string;
  team: Team;
  value: number;
  appearances: number;
  detail: string;
}

interface Board {
  /** Lugar do quadro na grade da página (grid-area). */
  id: 'scorers' | 'assists' | 'rated';
  title: string;
  subtitle: string;
  unit: string;
  rating: boolean;
  rows: Leader[];
  loading: boolean;
  message: string | null;
}

/** Dados de um ranking como chegaram da API, antes do filtro. */
interface Source<T> {
  data: T | null;
  message: string | null;
}

@Component({
  selector: 'app-estatisticas',
  imports: [Crest, MatIcon, MatTooltip, RoundTeamCard],
  templateUrl: './estatisticas.html',
  styleUrl: './estatisticas.scss',
})
export class Estatisticas {
  private api = inject(ApiFootball);
  private retry?: ReturnType<typeof setTimeout>;

  protected collapsed = COLLAPSED;
  protected filter = signal<Filter>('regulares');
  // "Ver mais" de cada quadro (pelo título) não muda o tamanho dele: liga a rolagem
  // dentro do quadro, que vai carregando mais linhas.
  private expanded = signal<Record<string, boolean>>({});
  private shown = signal<Record<string, number>>({});

  private scorers = signal<Source<Leader[]>>({ data: null, message: null });
  private assists = signal<Source<Leader[]>>({ data: null, message: null });
  private rated = signal<Source<TopRated>>({ data: null, message: null });

  /** Mínimo de jogos do filtro "Regulares": metade dos jogos de quem mais jogou no campeonato. */
  protected minAppearances = computed(() => {
    const rated = this.rated().data;
    if (rated) return rated.minAppearances;
    const apps = [...(this.scorers().data ?? []), ...(this.assists().data ?? [])].map((r) => r.appearances);
    return apps.length ? Math.ceil(Math.max(...apps) * REGULAR_FRACTION) : 0;
  });

  protected regularTip = computed(() => {
    const min = this.minAppearances();
    return `Pelo menos metade dos jogos de quem mais jogou${min ? `: mínimo de ${min} jogos` : ''}.`;
  });

  protected boards = computed<Board[]>(() => {
    // O filtro Regulares/Todos vale só para as notas; artilharia e assistências mostram todos.
    const regulars = this.filter() === 'regulares';
    const rated = this.rated();
    return [
      board('scorers', 'Artilheiros', 'Gols marcados', 'Gols', false, this.scorers(), withRanks),
      board('assists', 'Assistências', 'Passes para gol', 'Assist.', false, this.assists(), withRanks),
      board('rated', 'Melhores notas', 'Nota média na temporada', 'Nota', true, {
        data: rated.data ? (regulars ? rated.data.response : rated.data.all).map(fromRated) : null,
        message: rated.message,
      }, withRanks),
    ];
  });

  protected canExpand = computed(() => this.boards().some((b) => b.rows.length > COLLAPSED));

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.retry));

    this.api.topScorers().subscribe({
      next: (players) => this.scorers.set({ data: fromStats(players, (s) => s.goals.total ?? 0, scorerDetail), message: null }),
      error: () => this.scorers.set({ data: null, message: 'Não foi possível carregar.' }),
    });
    this.api.topAssists().subscribe({
      next: (players) => this.assists.set({ data: fromStats(players, (s) => s.goals.assists ?? 0, gamesDetail), message: null }),
      error: () => this.assists.set({ data: null, message: 'Não foi possível carregar.' }),
    });
    this.loadRated();
  }

  private loadRated() {
    this.api.topRated().subscribe({
      next: (data) => this.rated.set({ data, message: null }),
      error: (err: HttpErrorResponse) => {
        if (err.status === 503) {
          this.rated.set({ data: null, message: 'Ranking de notas sendo montado. Ele aparece aqui em alguns minutos.' });
          this.retry = setTimeout(() => this.loadRated(), RATED_RETRY_MS);
        } else {
          this.rated.set({ data: null, message: 'Não foi possível carregar.' });
        }
      },
    });
  }

  protected visible(b: Board): Leader[] {
    return b.rows.slice(0, this.isExpanded(b) ? (this.shown()[b.title] ?? COLLAPSED + STEP) : COLLAPSED);
  }

  protected isExpanded(b: Board): boolean {
    return !!this.expanded()[b.title];
  }

  protected toggle(b: Board) {
    this.expanded.update((e) => ({ ...e, [b.title]: !e[b.title] }));
    this.shown.update((s) => ({ ...s, [b.title]: COLLAPSED + STEP }));
  }

  protected onScroll(b: Board, event: Event) {
    const shown = this.visible(b).length;
    if (nearBottom(event) && shown < b.rows.length) {
      this.shown.update((s) => ({ ...s, [b.title]: shown + STEP }));
    }
  }

  protected ratingClass = ratingClass;
}

function board(
  id: Board['id'],
  title: string,
  subtitle: string,
  unit: string,
  rating: boolean,
  source: Source<Leader[]>,
  shape: (rows: Leader[]) => Leader[],
): Board {
  const rows = source.data ? shape(source.data) : [];
  const message = source.message ?? (source.data && !rows.length ? 'Nenhum jogador neste filtro.' : null);
  return { id, title, subtitle, unit, rating, rows, loading: !source.data && !source.message, message };
}

function fromStats(
  players: PlayerStat[],
  value: (s: PlayerStat['statistics'][number]) => number,
  detail: (s: PlayerStat['statistics'][number]) => string,
): Leader[] {
  return players.map((p) => {
    const s = p.statistics[0];
    return {
      id: p.player.id,
      rank: 0,
      name: p.player.name,
      photo: p.player.photo,
      team: s.team,
      value: value(s),
      appearances: s.games.appearences ?? 0,
      detail: detail(s),
    };
  });
}

function fromRated(p: RatedPlayer): Leader {
  return {
    id: p.player.id,
    rank: 0,
    name: p.player.name,
    photo: p.player.photo,
    team: p.team,
    value: p.rating,
    appearances: p.appearances,
    detail: `${p.appearances} jogos · ${p.goals} G · ${p.assists} A`,
  };
}

function scorerDetail(s: PlayerStat['statistics'][number]): string {
  const pens = s.penalty.scored ?? 0;
  return gamesDetail(s) + (pens ? ` · ${pens} de pênalti` : '');
}

function gamesDetail(s: PlayerStat['statistics'][number]): string {
  return `${s.games.appearences ?? 0} jogos`;
}

/** Posição de cada linha (empate não repete número). */
function withRanks(rows: Leader[]): Leader[] {
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
