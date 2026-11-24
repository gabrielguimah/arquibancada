import { Component, computed, input } from '@angular/core';
import { Fixture, LIVE_STATUSES } from '../api/api-football';
import { RouterLink } from '@angular/router';
import { Crest } from './crest';
import { liveClock } from './live-clock';

export const TZ = 'America/Sao_Paulo';

const RED_CARDS = new Set(['Red Card', 'Second Yellow card']);

/** Data de hoje em Brasília, no formato AAAA-MM-DD. */
export function todayInBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function isLive(f: Fixture): boolean {
  return LIVE_STATUSES.includes(f.fixture.status.short);
}

/** Card compacto de partida: horário e situação à esquerda, times empilhados, placar à direita. */
@Component({
  selector: 'app-fixture-card',
  imports: [Crest, RouterLink],
  templateUrl: './fixture-card.html',
  styleUrl: './fixture-card.scss',
})
export class FixtureCard {
  fixture = input.required<Fixture>();
  delayed = input(false);

  protected sides = ['home', 'away'] as const;
  protected live = computed(() => isLive(this.fixture()));

  protected kickoff = computed(() =>
    new Date(this.fixture().fixture.date).toLocaleTimeString('pt-BR', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
    }),
  );

  // Linha abaixo do horário; vazia para jogo ainda não iniciado.
  protected status = computed(() => {
    const { short, elapsed, extra, long } = this.fixture().fixture.status;
    switch (short) {
      case 'NS':
      case 'TBD':
        return '';
      // Intervalo: vai na linha de cima, no lugar do horário; aqui fica só a bolinha de ao vivo.
      case 'HT':
      case 'BT':
        return '';
      case 'FT':
      case 'AET':
      case 'PEN':
        return 'Finalizado';
      case 'PST':
        return 'Adiado';
      case 'CANC':
        return 'Cancelado';
      case 'SUSP':
      case 'INT':
        return 'Interrompido';
      // Bola rolando: o relógio já diz o período; aqui fica só a bolinha de ao vivo.
      case '1H':
      case '2H':
      case 'ET':
        return elapsed != null ? '' : long;
      case 'P':
        return 'Pênaltis';
      default:
        return elapsed != null ? `${elapsed}${extra ? '+' + extra : ''}'` : long;
    }
  });

  /** Intervalo do jogo ou antes da prorrogação: "Intervalo" no lugar do horário de início. */
  protected halftime = computed(() => ['HT', 'BT'].includes(this.fixture().fixture.status.short));

  /** Relógio do jogo ("67:12", "45'+2") no lugar do horário, enquanto a bola rola. */
  protected clock = computed(() => liveClock(this.fixture()));

  /** Cartões vermelhos de cada time (inclui o segundo amarelo), pelos eventos da partida; um item por cartão. */
  protected redCards = computed(() => {
    const cards: Record<'home' | 'away', string[]> = { home: [], away: [] };
    const { home } = this.fixture().teams;
    for (const e of this.fixture().events ?? []) {
      if (e.type !== 'Card' || !RED_CARDS.has(e.detail)) continue;
      cards[e.team.id === home.id ? 'home' : 'away'].push(`${e.player.name ?? ''} ${e.time.elapsed ?? ''}'`.trim());
    }
    return cards;
  });

  protected venue = computed(() => {
    const { name, city } = this.fixture().fixture.venue;
    return [name, city].filter(Boolean).join(', ');
  });
}
