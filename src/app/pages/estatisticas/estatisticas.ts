import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ApiFootball, PlayerStat, RatedPlayer, Team, TopRated } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { Pager } from '../../shared/pager';
import { PillSwitch } from '../../shared/pill-switch';
import { RoundTeamCard } from './round-team';
import { PlayersTable } from './players-table';
import { formatRating, ratingClass } from '../../shared/rating';

// Linhas por página de cada quadro (a altura dos quadros).
const PAGE_SIZE = 10;
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

/** Quadro da página (aba no celular). */
type Section = 'scorers' | 'assists' | 'team' | 'rated' | 'players';

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
  imports: [Crest, MatIcon, MatTooltip, Pager, PillSwitch, PlayersTable, RoundTeamCard],
  templateUrl: './estatisticas.html',
  styleUrl: './estatisticas.scss',
})
export class Estatisticas {
  private api = inject(ApiFootball);
  private retry?: ReturnType<typeof setTimeout>;

  protected filter = signal<Filter>('regulares');

  /** Celular e tela média: o quadro à mostra (no computador, todos na grade). */
  // Abas com o ícone do título de cada quadro (bola, chuteira, medalha, estrela); a tabela de jogadores,
  // sem ícone, fica com o nome. O nome vai também no aria-label e no tooltip das abas de ícone.
  protected sections: Array<{ id: Section; label: string; icon?: string; svgIcon?: string; filled?: boolean }> = [
    { id: 'scorers', label: 'Artilheiros', icon: 'sports_soccer' },
    { id: 'assists', label: 'Assistências', svgIcon: 'chuteira' },
    { id: 'team', label: 'Time da rodada', icon: 'military_tech', filled: true },
    { id: 'rated', label: 'Melhores notas', icon: 'star', filled: true },
    { id: 'players', label: 'Estatísticas' },
  ];
  protected section = signal<Section>('scorers');


  // Página atual de cada quadro, pelo título.
  private pages = signal<Record<string, number>>({});

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

  protected pagesOf(b: Board): number {
    return Math.max(1, Math.ceil(b.rows.length / PAGE_SIZE));
  }

  /** Página do quadro; se o filtro encolheu a lista, volta para a última que existe. */
  protected pageOf(b: Board): number {
    return Math.min(this.pages()[b.title] ?? 1, this.pagesOf(b));
  }

  protected setPage(b: Board, page: number) {
    this.pages.update((p) => ({ ...p, [b.title]: page }));
  }

  protected visible(b: Board): Leader[] {
    const start = (this.pageOf(b) - 1) * PAGE_SIZE;
    return b.rows.slice(start, start + PAGE_SIZE);
  }

  protected ratingClass = ratingClass;
  protected formatRating = formatRating;
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
