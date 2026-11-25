import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { finalize } from 'rxjs';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { ApiFootball, Coach, Fixture, Injury, LEAGUE } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { MatchLineups } from './match-lineups';
import { MatchStats } from './match-stats';
import { LineupsSkeleton, StatsSkeleton, TimelineSkeleton } from './match-skeletons';
import { NgTemplateOutlet } from '@angular/common';
import { MatchTimeline } from './match-timeline';
import { TZ, isLive } from '../../shared/fixture-card';
import { FINISHED, OVER, dayInBrasilia } from '../../shared/fixture-status';
import { liveClock } from '../../shared/live-clock';
import { LiveFixtures } from '../../shared/live-fixtures';
import { Highlight, HighlightKind, highlights, statusLabel } from './match-header';
import { matchStats } from './stats';
import { channelsFor } from './broadcast';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';

interface HighlightRow {
  kind: HighlightKind;
  label: string;
  home: Highlight[];
  away: Highlight[];
}

// Uma linha por tipo de lance, nesta ordem, cada uma com o seu ícone no meio.
const ROWS: Array<{ kind: HighlightKind; label: string }> = [
  { kind: 'goal', label: 'Gols' },
  { kind: 'red', label: 'Cartões vermelhos' },
  { kind: 'missed', label: 'Pênaltis perdidos' },
];

// Com a bola rolando, atualiza no mesmo ritmo dos jogos ao vivo (o Worker guarda por 15 s).
const REFRESH_LIVE_MS = 15_000;
// Antes do jogo (a partir de 1 h antes: escalação) e logo depois (notas finais), a cada minuto.
const REFRESH_AROUND_MS = 60_000;
const BEFORE_KICKOFF_MS = 60 * 60_000;
// Nos 15 min antes do horário (e enquanto a API não marcar o início), no ritmo do ao vivo: o relógio
// aparece assim que o jogo começa, como na Classificação.
const NEAR_KICKOFF_MS = 15 * 60_000;
// Depois do fim, a API ainda ajusta notas e eventos: segue atualizando até 3 h depois do início.
const AFTER_KICKOFF_MS = 3 * 3600_000;
// Jogo ainda longe: confere de novo de tempos em tempos (no máximo 30 min), até entrar na janela de 1 h.
const IDLE_CHECK_MS = 30 * 60_000;

const NOT_STARTED = new Set(['NS', 'TBD']);


/**
 * Daqui a quanto tempo buscar a partida de novo; `null` para parar (adiada, cancelada, encerrada há
 * tempo). Ao vivo: 15 s. Antes do início: a cada minuto a partir de 1 h antes (sai a escalação), e uma
 * conferência de vez em quando antes disso. Depois do fim: a cada minuto, até 3 h após o início.
 */
export function refreshDelay(f: Fixture, now: number): number | null {
  const short = f.fixture.status.short;
  const kickoff = f.fixture.timestamp * 1000;
  if (isLive(f)) return REFRESH_LIVE_MS;
  if (NOT_STARTED.has(short)) {
    if (kickoff - now <= NEAR_KICKOFF_MS) return REFRESH_LIVE_MS;
    const untilWindow = kickoff - BEFORE_KICKOFF_MS - now;
    return untilWindow <= 0 ? REFRESH_AROUND_MS : Math.min(untilWindow, IDLE_CHECK_MS);
  }
  if (FINISHED.has(short) && now - kickoff < AFTER_KICKOFF_MS) return REFRESH_AROUND_MS;
  return null;
}

/** Página de uma partida (`/partida/:id`): por enquanto, o cabeçalho com placar, gols e informações. */
@Component({
  selector: 'app-partida',
  imports: [Crest, LineupsSkeleton, MatIcon, MatMenu, MatMenuTrigger, MatchLineups, MatchStats, MatchTimeline, NgTemplateOutlet, RouterLink, StatsSkeleton, TimelineSkeleton],
  templateUrl: './partida.html',
  styleUrl: './partida.scss',
})
export class Partida {
  private api = inject(ApiFootball);
  private liveFixtures = inject(LiveFixtures);
  private title = inject(Title);
  private timer?: ReturnType<typeof setTimeout>;
  private route = inject(ActivatedRoute);

  protected sides = ['home', 'away'] as const;
  /** Seção visível no celular (no computador, as duas aparecem lado a lado). */
  protected tab = signal<'timeline' | 'stats' | 'lineups'>('timeline');
  // Partida como veio da busca desta página; `fixture` prefere a dos jogos ao vivo do site (a mesma
  // que a Classificação usa, atualizada a cada 15 s), quando ela está sendo acompanhada.
  private loaded = signal<Fixture | null>(null);
  protected fixture = computed(() => {
    const f = this.loaded();
    return (f && this.liveFixtures.byId().get(f.fixture.id)) ?? f;
  });
  protected loading = signal(true);
  /** Lesionados, suspensos e dúvidas dos dois times; vazio se a API não tiver (ou falhar). */
  protected injuries = signal<Injury[]>([]);
  /** Técnico atual de cada time, pelo id (não depende da partida: aparece mesmo sem escalação). */
  protected coaches = signal<Record<number, Coach | null>>({});
  // Buscas de desfalques e técnicos em andamento: enquanto houver, o card de escalações mostra o esqueleto
  // dessa parte (antes da escalação sair).
  private extrasPending = signal(0);
  protected extrasLoading = computed(() => this.extrasPending() > 0);
  protected error = signal<string | null>(null);
  /** Canais de transmissão (do "Onde assistir" da CBF); vazio: o botão não aparece. */
  protected channels = signal<string[]>([]);
  /** Buscando os canais: no lugar do botão, um esqueleto. */
  private channelsLoading = signal(false);
  protected watchLoading = computed(() => {
    const f = this.fixture();
    return this.channelsLoading() && !!f && !OVER.has(f.fixture.status.short);
  });
  /** "Onde assistir" só antes e durante o jogo: encerrado (ou adiado, cancelado), some. */
  protected showChannels = computed(() => {
    const f = this.fixture();
    return this.channels().length > 0 && !!f && !OVER.has(f.fixture.status.short);
  });

  /** A API só manda estatísticas depois do início: sem elas, o card some no computador. */
  protected hasStats = computed(() => {
    const f = this.fixture();
    return !!f && matchStats(f).length > 0;
  });
  protected live = computed(() => {
    const f = this.fixture();
    return !!f && isLive(f);
  });
  protected started = computed(() => {
    const f = this.fixture();
    return !!f && f.goals.home !== null && f.goals.away !== null;
  });
  protected clock = computed(() => {
    const f = this.fixture();
    return f ? liveClock(f) : null;
  });
  protected status = computed(() => {
    const f = this.fixture();
    return f ? statusLabel(f) : '';
  });
  // Gols, cartões vermelhos e pênaltis perdidos de cada lado.
  protected highlights = computed(() => {
    const f = this.fixture();
    return f ? highlights(f) : { home: [], away: [] };
  });
  // Gols em cima; embaixo, cartões vermelhos e depois pênaltis perdidos. Linha sem lance não aparece.
  protected highlightRows = computed<HighlightRow[]>(() => {
    const h = this.highlights();
    return ROWS.map(({ kind, label }) => ({
      kind,
      label,
      home: h.home.filter((x) => x.kind === kind),
      away: h.away.filter((x) => x.kind === kind),
    })).filter((r) => r.home.length + r.away.length > 0);
  });

  protected kickoff = computed(() => {
    const f = this.fixture();
    if (!f) return { date: '', time: '' };
    const d = new Date(f.fixture.date);
    return {
      date: d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
    };
  });

  protected league = computed(() => {
    const l = this.fixture()?.league;
    if (!l) return null;
    const name = l.id === LEAGUE ? 'Campeonato Brasileiro Série A' : l.name;
    const n = l.round.match(/(\d+)$/)?.[1];
    return { name, logo: l.logo, round: n ? `${n}ª rodada` : '' };
  });

  protected venue = computed(() => {
    const v = this.fixture()?.fixture.venue;
    return v ? [v.name, v.city].filter(Boolean).join(', ') : '';
  });

  constructor() {
    this.liveFixtures.start();
    // Aba em segundo plano atrasa os timers: ao voltar para ela, busca a partida na hora.
    const onVisible = () => {
      const f = this.loaded();
      if (document.visibilityState !== 'visible' || !f || refreshDelay(f, Date.now()) === null) return;
      clearTimeout(this.timer);
      this.load(f.fixture.id);
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
    // Trocar de partida (outro link /partida/:id) reaproveita a página: recarrega pelo id novo.
    this.route.paramMap.subscribe((params) => {
      const id = Number(params.get('id'));
      clearTimeout(this.timer);
      this.loaded.set(null);
      this.injuries.set([]);
      this.coaches.set({});
      this.extrasPending.set(0);
      this.channels.set([]);
      this.channelsLoading.set(false);
      this.error.set(null);
      this.loading.set(true);
      if (!Number.isInteger(id) || id <= 0) {
        this.notFound();
        return;
      }
      this.load(id);
      // Uma vez por partida aberta: a lista muda pouco (o Worker guarda por 30 min).
      this.extrasPending.update((n) => n + 1);
      this.api
        .injuries(id)
        .pipe(finalize(() => this.extrasPending.update((n) => n - 1)))
        .subscribe({ next: (list) => this.injuries.set(list), error: () => this.injuries.set([]) });
    });
  }

  private load(id: number) {
    // Jogo acompanhado pelos jogos ao vivo do site (a cada 15 s, com eventos, escalação e notas): a página
    // já mostra esses dados, então não busca a partida de novo (seria outra chamada à API, com outra chave).
    if (this.loaded() && this.liveFixtures.byId().has(id)) {
      this.timer = setTimeout(() => this.load(id), REFRESH_LIVE_MS);
      return;
    }
    this.api.fixture(id).subscribe({
      next: (f) => {
        this.loading.set(false);
        if (!f) {
          this.notFound();
          return;
        }
        const first = !this.loaded();
        this.loaded.set(f);
        this.loadCoaches(f);
        if (first && !OVER.has(f.fixture.status.short)) this.loadBroadcasts(f);
        this.title.setTitle(`${f.teams.home.name} x ${f.teams.away.name} · Arquibancada`);
        const next = refreshDelay(f, Date.now());
        if (next !== null) this.timer = setTimeout(() => this.load(id), next);
      },
      error: () => {
        this.loading.set(false);
        // Sem dados ainda: mostra o erro. Já com a partida na tela (atualização ao vivo): tenta de novo.
        if (!this.loaded()) this.error.set('Não foi possível carregar a partida.');
        this.timer = setTimeout(() => this.load(id), REFRESH_LIVE_MS);
      },
    });
  }

  /**
   * Técnicos dos dois times, uma vez por partida aberta. Se a escalação desta partida já traz o técnico,
   * não busca (economiza as chamadas do último jogo do time).
   */
  private loadCoaches(f: Fixture) {
    for (const team of [f.teams.home, f.teams.away]) {
      if (team.id in this.coaches()) continue;
      if (f.lineups?.some((l) => l.team.id === team.id && l.coach?.name)) continue;
      this.coaches.update((c) => ({ ...c, [team.id]: null }));
      this.extrasPending.update((n) => n + 1);
      this.api
        .coach(team.id)
        .pipe(finalize(() => this.extrasPending.update((n) => n - 1)))
        .subscribe({
        next: (coach) => this.coaches.update((c) => ({ ...c, [team.id]: coach })),
        error: () => undefined,
      });
    }
  }

  /** Onde assistir, uma vez por partida aberta (a lista é do dia do jogo, no horário de Brasília). */
  private loadBroadcasts(f: Fixture) {
    const date = dayInBrasilia(new Date(f.fixture.date));
    this.channelsLoading.set(true);
    this.api.broadcasts(date).subscribe((games) => {
      if (this.loaded()?.fixture.id !== f.fixture.id) return;
      this.channels.set(channelsFor(f, games));
      this.channelsLoading.set(false);
    });
  }

  private notFound() {
    this.loading.set(false);
    this.error.set('Partida não encontrada.');
    this.title.setTitle('Partida não encontrada · Arquibancada');
  }
}
