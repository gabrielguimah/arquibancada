import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { ApiFootball, Fixture, LEAGUE } from '../../api/api-football';
import { Crest } from '../../shared/crest';
import { MatchLineups } from './match-lineups';
import { MatchTimeline } from './match-timeline';
import { TZ, isLive } from '../../shared/fixture-card';
import { liveClock } from '../../shared/live-clock';
import { LiveFixtures } from '../../shared/live-fixtures';
import { Highlight, HighlightKind, highlights, statusLabel } from './match-header';

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
const FINISHED = new Set(['FT', 'AET', 'PEN']);

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
  imports: [Crest, MatIcon, MatchLineups, MatchTimeline, RouterLink],
  templateUrl: './partida.html',
  styleUrl: './partida.scss',
})
export class Partida {
  private api = inject(ApiFootball);
  private liveFixtures = inject(LiveFixtures);
  private title = inject(Title);
  private timer?: ReturnType<typeof setTimeout>;

  protected sides = ['home', 'away'] as const;
  /** Seção visível no celular (no computador, as duas aparecem lado a lado). */
  protected tab = signal<'timeline' | 'lineups'>('timeline');
  // Partida como veio da busca desta página; `fixture` prefere a dos jogos ao vivo do site (a mesma
  // que a Classificação usa, atualizada a cada 15 s), quando ela está sendo acompanhada.
  private loaded = signal<Fixture | null>(null);
  protected fixture = computed(() => {
    const f = this.loaded();
    return (f && this.liveFixtures.byId().get(f.fixture.id)) ?? f;
  });
  protected loading = signal(true);
  protected error = signal<string | null>(null);

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
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // Trocar de partida (outro link /partida/:id) reaproveita a página: recarrega pelo id novo.
    inject(ActivatedRoute).paramMap.subscribe((params) => {
      const id = Number(params.get('id'));
      clearTimeout(this.timer);
      this.loaded.set(null);
      this.error.set(null);
      this.loading.set(true);
      if (!Number.isInteger(id) || id <= 0) {
        this.notFound();
        return;
      }
      this.load(id);
    });
  }

  private load(id: number) {
    this.api.fixture(id).subscribe({
      next: (f) => {
        this.loading.set(false);
        if (!f) {
          this.notFound();
          return;
        }
        this.loaded.set(f);
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

  private notFound() {
    this.loading.set(false);
    this.error.set('Partida não encontrada.');
    this.title.setTitle('Partida não encontrada · Arquibancada');
  }
}
