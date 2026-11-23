import { Component, computed, input } from '@angular/core';
import { Fixture, LIVE_STATUSES } from '../api/api-football';
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
  imports: [Crest],
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
      case 'HT':
        return 'Intervalo';
      case 'FT':
      case 'AET':
      case 'PEN':
        return 'Encerrado';
      case 'PST':
        return 'Adiado';
      case 'CANC':
        return 'Cancelado';
      case 'SUSP':
      case 'INT':
        return 'Interrompido';
      // Bola rolando: o relógio fica na linha de cima; aqui vai o período.
      case '1H':
        return '1º tempo';
      case '2H':
        return '2º tempo';
      case 'ET':
        return 'Prorrogação';
      case 'BT':
        return 'Intervalo';
      case 'P':
        return 'Pênaltis';
      default:
        return elapsed != null ? `${elapsed}${extra ? '+' + extra : ''}'` : long;
    }
  });

  /** Relógio do jogo ("67:12", "45'+04:26") no lugar do horário, enquanto a bola rola. */
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
