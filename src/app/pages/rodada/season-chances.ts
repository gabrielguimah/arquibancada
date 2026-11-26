import { Component, computed, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Team } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { FavoriteHeart } from '../../shared/favorite-heart';
import { SIMULATIONS, TeamChances, formatChance } from './chances';

/** Jogo que falta para um time: adversário, mando, data e, se está rolando, o placar do time. */
export interface UpcomingGame {
  id: number;
  opponent: Team;
  home: boolean;
  /** "dd/MM", ou "a definir" (adiado ou sem data). */
  date: string;
  /** Placar do ponto de vista do time ("2-1"), só em jogo em andamento. */
  live: string | null;
}

export interface ChanceRow {
  team: Team;
  rank: number;
  points: number;
  upcoming: UpcomingGame[];
  chances: TeamChances;
}

type ChanceKey = keyof TeamChances;

interface ChanceColumn {
  key: ChanceKey;
  label: string;
  short: string;
}

/** Lista dos jogos escondidos atrás do "+N", perto dele (`x`, `y` na tela). */
interface GamesTip {
  team: Team;
  games: UpcomingGame[];
  x: number;
  y: number;
  /** Abre para baixo do "+N" (não cabe em cima). */
  below: boolean;
}

const COLUMNS: ChanceColumn[] = [
  { key: 'title', label: 'Título', short: 'Tít.' },
  { key: 'libertadores', label: 'Libertadores', short: 'Lib.' },
  { key: 'sulamericana', label: 'Sul-Americana', short: 'Sul.' },
  { key: 'relegation', label: 'Rebaixamento', short: 'Reb.' },
];

// Jogos com escudo na linha (os próximos 5); o resto fica no "+N" (no começo do campeonato são 38).
const SHOWN_GAMES = 5;
// Altura que a lista do "+N" pode ter; se não couber acima, abre embaixo.
const TIP_ROOM = 320;

/**
 * Chances de cada time ao fim do campeonato (título, Libertadores, Sul-Americana, rebaixamento), da
 * simulação dos jogos que faltam, com os próximos adversários de cada um.
 */
@Component({
  selector: 'app-season-chances',
  imports: [Crest, FavoriteHeart, MatIcon],
  templateUrl: './season-chances.html',
  styleUrl: './season-chances.scss',
  // Rolou a página: a lista ficaria solta no lugar antigo.
  host: { '(window:scroll)': 'hideTip()' },
})
export class SeasonChances {
  rows = input.required<ChanceRow[]>();
  /** Zonas que existem na tabela (sem Sul-Americana, por exemplo, a coluna some). */
  zones = input<Set<ChanceKey>>(new Set(COLUMNS.map((c) => c.key)));
  /** Há jogo rolando: as chances mudam com os placares. */
  live = input(false);

  protected columns = computed(() => COLUMNS.filter((c) => c.key === 'title' || this.zones().has(c.key)));
  protected simulations = SIMULATIONS.toLocaleString('pt-BR');
  protected format = formatChance;
  protected shown = SHOWN_GAMES;
  // Faixas da tabela na legenda (as vagas seguem as posições da classificação).
  protected legendLabel: Record<ChanceKey, string> = {
    title: 'Título: 1º lugar',
    libertadores: 'Libertadores: vagas diretas e pré-Libertadores',
    sulamericana: 'Sul-Americana',
    relegation: 'Rebaixamento',
  };
  /** Algum time tem mais jogos do que cabem na linha (aí a legenda explica o "+N"). */
  protected hasMore = computed(() => this.rows().some((r) => r.upcoming.length > SHOWN_GAMES));
  protected tip = signal<GamesTip | null>(null);

  /** Intensidade do fundo da célula (0 a 1), para a leitura de relance. */
  protected heat(p: number): number {
    return p <= 0 ? 0 : Math.max(0.08, p);
  }

  protected chanceTip(r: ChanceRow, c: ChanceColumn): string {
    return `${r.team.name}: ${formatChance(r.chances[c.key])} de chance (${c.label})`;
  }

  protected gameTip(g: UpcomingGame): string {
    const when = g.live ? `em andamento, ${g.live}` : g.date;
    return `${g.home ? 'Em casa' : 'Fora'} contra ${g.opponent.name} (${when})`;
  }

  protected moreLabel(r: ChanceRow): string {
    const n = r.upcoming.length - SHOWN_GAMES;
    return `Mais ${n} ${n === 1 ? 'jogo' : 'jogos'} de ${r.team.name}`;
  }

  /** Abre a lista dos jogos do "+N" (mouse em cima, foco pelo teclado ou toque no celular). */
  protected showTip(event: Event, r: ChanceRow) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Centralizada no "+N", sem passar da borda da tela (a lista tem até 320 px).
    const half = Math.min(160, (window.innerWidth - 32) / 2);
    const x = Math.min(Math.max(rect.left + rect.width / 2, 16 + half), window.innerWidth - 16 - half);
    const below = rect.top < TIP_ROOM;
    this.tip.set({ team: r.team, games: r.upcoming.slice(SHOWN_GAMES), x, y: below ? rect.bottom + 8 : rect.top - 8, below });
  }

  protected hideTip() {
    this.tip.set(null);
  }
}
