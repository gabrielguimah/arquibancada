import { Component, DestroyRef, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ApiFootball, PlayerRow, PlayerStats } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { PlayerPhoto } from '../../shared/player-photo';
import { Pager } from '../../shared/pager';
import { NO_RATING_CLASS, NO_RATING_LABEL, NO_RATING_TITLE, ratingClass } from '../../shared/rating';
import {
  ACCUMULATIONS,
  Accumulation,
  PLAYER_TABS,
  PlayerColumn,
  PlayerTab,
  columnValue,
  formatValue,
} from './player-columns';

export const PAGE_SIZE = 10;
// A tabela é montada em segundo plano no Worker; enquanto não fica pronta, tenta de novo.
const RETRY_MS = 60_000;

interface Sort {
  column: string;
  ascending: boolean;
}

interface Line {
  rank: number;
  player: PlayerRow;
  cells: Array<{ column: PlayerColumn; value: number | null; text: string }>;
}

/**
 * Grade de jogadores: abas por tipo de estatística, totais ou médias (por jogo, por 90 minutos),
 * ordenação por qualquer coluna e paginação no rodapé. O filtro Regulares/Todos vem da página, que o
 * divide com o quadro de melhores notas.
 */
@Component({
  selector: 'app-players-table',
  imports: [Crest, MatIcon, Pager, MatTooltip, PlayerPhoto],
  templateUrl: './players-table.html',
  styleUrl: './players-table.scss',
})
export class PlayersTable {
  private api = inject(ApiFootball);
  private retry?: ReturnType<typeof setTimeout>;

  protected tabs = PLAYER_TABS;
  protected accumulations = ACCUMULATIONS;
  protected skeleton = Array.from({ length: 10 }, (_, i) => i);

  /** Só jogadores regulares (mínimo de jogos); `false` mostra todos. */
  regulars = input(true);

  private data = signal<PlayerStats | null>(null);
  protected message = signal<string | null>(null);
  protected tab = signal<PlayerTab>(PLAYER_TABS[0]);
  protected mode = signal<Accumulation>('total');
  protected sort = signal<Sort>({ column: PLAYER_TABS[0].sort, ascending: false });
  // Volta para a primeira página quando muda o filtro, a aba, o modo ou a ordenação.
  protected page = linkedSignal({
    source: () => [this.regulars(), this.tab(), this.mode(), this.sort()],
    computation: () => 1,
  });

  /** Todas as linhas, já filtradas e ordenadas (a paginação recorta daqui). */
  private lines = computed<Line[] | null>(() => {
    const d = this.data();
    if (!d) return null;
    const tab = this.tab();
    const mode = this.mode();
    const { column, ascending } = this.sort();
    const sortColumn = tab.columns.find((c) => c.id === column) ?? tab.columns[0];

    const players = d.players.filter(
      (p) =>
        (!this.regulars() || p.appearances >= d.minAppearances) &&
        (!tab.goalkeepers || p.position === 'G'),
    );
    const sorted = players
      .map((p) => ({ p, key: columnValue(sortColumn, p, mode) }))
      .sort((a, b) => {
        // Sem valor fica sempre no fim; empate desempata pela nota e pelo nome.
        if (a.key === null || b.key === null) return a.key === null ? (b.key === null ? 0 : 1) : -1;
        return (
          (ascending ? a.key - b.key : b.key - a.key) ||
          (b.p.rating ?? 0) - (a.p.rating ?? 0) ||
          a.p.name.localeCompare(b.p.name)
        );
      });
    return sorted.map(({ p }, i) => ({
      rank: i + 1,
      player: p,
      cells: tab.columns.map((c) => {
        const value = columnValue(c, p, mode);
        return { column: c, value, text: formatValue(c, value, mode) };
      }),
    }));
  });

  protected pages = computed(() => Math.max(1, Math.ceil((this.lines()?.length ?? 0) / PAGE_SIZE)));
  protected visible = computed(() => {
    const start = (this.page() - 1) * PAGE_SIZE;
    return this.lines()?.slice(start, start + PAGE_SIZE) ?? null;
  });
  protected empty = computed(() => this.lines()?.length === 0);

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.retry));
    this.load();
  }

  private load() {
    this.api.playerStats().subscribe({
      next: (d) => {
        this.data.set(d);
        this.message.set(null);
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 503) {
          this.message.set('Tabela de jogadores sendo montada. Ela aparece aqui em alguns minutos.');
          this.retry = setTimeout(() => this.load(), RETRY_MS);
        } else {
          this.message.set('Não foi possível carregar.');
        }
      },
    });
  }

  protected selectTab(tab: PlayerTab) {
    this.tab.set(tab);
    this.sort.set({ column: tab.sort, ascending: false });
  }

  /** Clique no cabeçalho: ordena pela coluna; de novo na mesma, inverte a ordem. */
  protected sortBy(c: PlayerColumn) {
    const current = this.sort();
    this.sort.set(
      current.column === c.id ? { column: c.id, ascending: !current.ascending } : { column: c.id, ascending: !!c.ascending },
    );
  }

  protected ariaSort(c: PlayerColumn): 'ascending' | 'descending' | null {
    const s = this.sort();
    return s.column === c.id ? (s.ascending ? 'ascending' : 'descending') : null;
  }

  protected ratingClass = ratingClass;
  protected noRating = { class: NO_RATING_CLASS, label: NO_RATING_LABEL, title: NO_RATING_TITLE };
}
