import { Component, computed, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Fixture, Team, TeamForm } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { TZ } from '../../shared/fixture-status';
import { formatRating, ratingClass } from '../../shared/rating';

interface FormRow {
  id: number;
  date: string;
  result: 'V' | 'E' | 'D';
  home: Team;
  away: Team;
  homeGoals: number;
  awayGoals: number;
  /** O time do bloco é o mandante (o nome dele fica em destaque). */
  atHome: boolean;
}

interface FormBlock {
  team: Team;
  /** Nota média do time nos últimos jogos. */
  rating: number | null;
  /** Do mais antigo ao mais recente, como na classificação. */
  chips: Array<FormRow['result']>;
  /** Do mais recente ao mais antigo. */
  rows: FormRow[];
}

/** Últimos 5 jogos de cada time antes desta partida: resultado, data, adversário e placar. */
@Component({
  selector: 'app-match-form',
  imports: [Crest, MatIcon],
  templateUrl: './match-form.html',
  styleUrl: './match-form.scss',
})
export class MatchForm {
  fixture = input.required<Fixture>();
  /** `null` enquanto carrega. */
  forms = input<TeamForm[] | null>(null);
  failed = input(false);

  protected blocks = computed<FormBlock[]>(() => {
    const forms = this.forms() ?? [];
    const { home, away } = this.fixture().teams;
    return [home, away].map((team) => {
      const form = forms.find((f) => f.team === team.id);
      const rows = (form?.matches ?? []).map((m) => {
        const atHome = m.home.id === team.id;
        const [own, other] = atHome ? [m.goals.home, m.goals.away] : [m.goals.away, m.goals.home];
        return {
          id: m.id,
          date: new Date(m.timestamp * 1000).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }),
          result: own > other ? 'V' : own < other ? 'D' : 'E',
          home: m.home,
          away: m.away,
          homeGoals: m.goals.home,
          awayGoals: m.goals.away,
          atHome,
        } satisfies FormRow;
      });
      return { team, rating: form?.rating ?? null, rows, chips: rows.map((r) => r.result).reverse() };
    });
  });

  protected ratingClass = ratingClass;
  protected formatRating = formatRating;
  /** Jogos com placar à mostra; fechado, só o resumo de cada time. */
  protected expanded = signal(false);

  protected toggle() {
    this.expanded.update((open) => !open);
  }

  protected resultLabel = { V: 'Vitória', E: 'Empate', D: 'Derrota' };
  protected skeletonRows = [0, 1, 2, 3, 4];
}
