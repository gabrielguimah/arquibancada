import { Component, computed, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Card } from '../../../shared/components/card/card';
import { Fixture, Team, TeamForm } from '../../../api/api-football';
import { Crest } from '../../../shared/directives/crest';
import { FormChip } from '../../../shared/components/form-chip/form-chip';
import { LIVE_STATUSES, TZ } from '../../../shared/utils/fixture-status';
import { formatRating, ratingClass } from '../../../shared/utils/rating';
import { MatTooltip } from '@angular/material/tooltip';
import { Notice } from '../../../shared/components/notice/notice';

// Jogos de cada time no card.
const FORM_GAMES = 5;

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
  /** Esta partida, em andamento: o resultado é o parcial (contorno azul, como na classificação). */
  live: boolean;
}

interface FormBlock {
  team: Team;
  /** Nota média do time nos últimos jogos. */
  rating: number | null;
  /** Do mais antigo ao mais recente, como na classificação (com o parcial desta partida, se rolando). */
  chips: Array<{ result: FormRow['result']; live: boolean }>;
  /** Do mais recente ao mais antigo. */
  rows: FormRow[];
}

/**
 * Últimos 5 jogos de cada time antes desta partida: resultado, data, adversário e placar. Com a partida
 * em andamento, ela entra como o jogo mais recente, com o placar do momento (como as "Últimas 5" da
 * classificação), e o mais antigo sai.
 */
@Component({
  selector: 'app-match-form',
  imports: [Notice, MatTooltip, Card, Crest, FormChip],
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
      const rows = (form?.matches ?? []).map((m): FormRow => {
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
          live: false,
        };
      });
      const current = this.liveRow(team);
      if (current) rows.unshift(current);
      const recent = rows.slice(0, FORM_GAMES);
      return { team, rating: form?.rating ?? null, rows: recent, chips: recent.map((r) => ({ result: r.result, live: r.live })).reverse() };
    });
  });

  /** Jogo em andamento: o título fica no azul do ao vivo, com a bolinha (como nos outros cards). */
  protected live = computed(() => LIVE_STATUSES.has(this.fixture().fixture.status.short));

  /** Esta partida como linha dos últimos jogos, do ponto de vista de `team`; `null` se não está rolando. */
  private liveRow(team: Team): FormRow | null {
    const f = this.fixture();
    const [hg, ag] = [f.goals.home, f.goals.away];
    if (!LIVE_STATUSES.has(f.fixture.status.short) || hg == null || ag == null) return null;
    const atHome = f.teams.home.id === team.id;
    const [own, other] = atHome ? [hg, ag] : [ag, hg];
    return {
      id: f.fixture.id,
      date: 'ao vivo',
      result: own > other ? 'V' : own < other ? 'D' : 'E',
      home: f.teams.home,
      away: f.teams.away,
      homeGoals: hg,
      awayGoals: ag,
      atHome,
      live: true,
    };
  }

  protected ratingClass = ratingClass;
  protected formatRating = formatRating;
  /** Jogos com placar à mostra; fechado, só o resumo de cada time. */
  protected expanded = signal(false);

  protected resultLabel = { V: 'Vitória', E: 'Empate', D: 'Derrota' };
  protected skeletonRows = [0, 1, 2, 3, 4];
}
