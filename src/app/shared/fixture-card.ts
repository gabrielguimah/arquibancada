import { Component, computed, input } from '@angular/core';
import { Fixture, LIVE_STATUSES } from '../api/api-football';
import { Crest } from './crest';

export const TZ = 'America/Sao_Paulo';

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
      default:
        return elapsed != null ? `${elapsed}${extra ? '+' + extra : ''}'` : long;
    }
  });

  protected venue = computed(() => {
    const { name, city } = this.fixture().fixture.venue;
    return [name, city].filter(Boolean).join(', ');
  });
}
