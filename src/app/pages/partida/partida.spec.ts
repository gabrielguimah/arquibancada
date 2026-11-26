import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { ApiFootball, Broadcast, Fixture, FixtureEvent, TeamForm } from '../../api/api-football';
import { highlights } from './match-header';
import { Partida, refreshDelay } from './partida';

const botafogo = { id: 120, name: 'Botafogo', logo: '' };
const saoPaulo = { id: 126, name: 'São Paulo', logo: '' };

function goal(team: typeof botafogo, player: string, elapsed: number, detail = 'Normal Goal', extra: number | null = null, type = 'Goal'): FixtureEvent {
  return { time: { elapsed, extra }, team, player: { id: null, name: player }, assist: { id: null, name: null }, type, detail };
}

function match(goals: [number, number], events: FixtureEvent[], short = 'FT'): Fixture {
  return {
    fixture: {
      id: 1492463,
      date: '2026-11-23T23:00:00+00:00',
      timestamp: 1795474800,
      venue: { name: 'Estádio Nilton Santos', city: 'Rio de Janeiro' },
      status: { long: '', short, elapsed: 90, extra: null },
    },
    league: { id: 71, name: 'Serie A', logo: '', round: 'Regular Season - 36' },
    teams: { home: botafogo, away: saoPaulo },
    goals: { home: goals[0], away: goals[1] },
    events,
  };
}

describe('Lances do cabeçalho', () => {
  it('gols, cartões vermelhos e pênaltis perdidos por lado, na ordem, juntando os do mesmo jogador', () => {
    const f = match([2, 1], [
      goal(botafogo, 'Tiquinho Soares', 81),
      goal(saoPaulo, 'Pedro Lima', 28),
      goal(botafogo, 'Tiquinho Soares', 45, 'Penalty', 2),
      goal(saoPaulo, 'Calleri', 60, 'Missed Penalty'),
      goal(botafogo, 'Barboza', 70, 'Second Yellow card', null, 'Card'),
      goal(saoPaulo, 'Arboleda', 88, 'Red Card', null, 'Card'),
      goal(saoPaulo, 'Lucas', 50, 'Yellow Card', null, 'Card'),
    ]);
    expect(highlights(f)).toEqual({
      home: [
        { kind: 'goal', name: 'Tiquinho Soares', minutes: ["45+2' (P)", "81'"] },
        { kind: 'red', name: 'Barboza', minutes: ["70'"] },
      ],
      away: [
        { kind: 'goal', name: 'Pedro Lima', minutes: ["28'"] },
        { kind: 'missed', name: 'Calleri', minutes: ["60'"] },
        { kind: 'red', name: 'Arboleda', minutes: ["88'"] },
      ],
    });
  });

  it('cartão e pênalti perdido ficam sempre abaixo dos gols, mesmo acontecendo antes', () => {
    const f = match([1, 0], [
      goal(botafogo, 'Barboza', 10, 'Red Card', null, 'Card'),
      goal(botafogo, 'Savarino', 20, 'Missed Penalty'),
      goal(botafogo, 'Tiquinho Soares', 81),
    ]);
    expect(highlights(f).home.map((h) => h.kind)).toEqual(['goal', 'red', 'missed']);
  });

  it('gol contra fica do lado de quem se beneficiou, conferindo com o placar', () => {
    // A API marcou o gol contra no time do jogador (Botafogo), mas o placar diz que foi do São Paulo.
    const f = match([0, 1], [goal(botafogo, 'Bastos', 30, 'Own Goal')]);
    expect(highlights(f).away).toEqual([{ kind: 'goal', name: 'Bastos', minutes: ["30' (GC)"] }]);
    // Se a API já marcou no time beneficiado, fica onde está.
    const g = match([0, 1], [goal(saoPaulo, 'Bastos', 30, 'Own Goal')]);
    expect(highlights(g).away).toEqual([{ kind: 'goal', name: 'Bastos', minutes: ["30' (GC)"] }]);
  });
});

describe('Página da partida', () => {
  // "Onde assistir" da CBF no dia (cada teste define; `pending`: a resposta ainda não chegou).
  let broadcasts: Broadcast[] = [];
  let teamForms: TeamForm[] = [];
  let pending: Subject<Broadcast[]> | null = null;
  beforeEach(() => {
    broadcasts = [];
    teamForms = [];
    pending = null;
  });

  // Busca da partida (cada teste pode trocar; padrão: responde com `f`).
  let fixtureCall: ((f: Fixture | null) => Observable<Fixture | null>) | null = null;
  afterEach(() => (fixtureCall = null));

  function render(f: Fixture | null, id = '1492463') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Partida],
      providers: [
        provideRouter([]),
        { provide: ApiFootball, useValue: { fixture: () => (fixtureCall ? fixtureCall(f) : of(f)), injuries: () => of([]), coach: () => of(null), broadcasts: () => pending ?? of(broadcasts), teamForm: () => of(teamForms) } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id })) } },
      ],
    });
    const fixture = TestBed.createComponent(Partida);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('últimos 5 jogos: resultado do ponto de vista de cada time, data, adversário e placar', () => {
    const flamengo = { id: 127, name: 'Flamengo', logo: '' };
    teamForms = [
      { team: botafogo.id, rating: 6.84, matches: [{ id: 1, timestamp: 1795048200, home: flamengo, away: botafogo, goals: { home: 1, away: 2 }, rating: 6.84 }] },
      { team: saoPaulo.id, matches: [{ id: 2, timestamp: 1793838600, home: saoPaulo, away: flamengo, goals: { home: 0, away: 0 } }] },
    ];
    const el = render(match([1, 1], []));
    const blocks = [...el.querySelectorAll('app-match-form .block')];
    expect(blocks.map((b) => b.querySelector('.team strong')?.textContent?.trim())).toEqual(['Botafogo', 'São Paulo']);
    const row = (b: Element) => b.querySelector('.rows li')!;
    expect(row(blocks[0]).querySelector('.chip')?.textContent?.trim()).toBe('V');
    const parts = (li: Element) => [...li.querySelectorAll('.date, .name, .score')].map((n) => n.textContent?.trim());
    expect(parts(row(blocks[0]))).toEqual(['18/11', 'Flamengo', '1 - 2', 'Botafogo']);
    expect(row(blocks[0]).querySelector('.own')?.textContent?.trim()).toBe('Botafogo');
    expect(row(blocks[1]).querySelector('.chip')?.textContent?.trim()).toBe('E');
    // Média ao lado do nome; sem nota, sem selo.
    expect(blocks[0].querySelector('.team .team-rating')?.textContent?.trim()).toBe('6.8');
    expect(blocks[1].querySelector('.team .team-rating')).toBeNull();
  });

  it('mostra times, placar, situação, gols e informações da partida', () => {
    const el = render(match([1, 1], [goal(saoPaulo, 'Pedro Lima', 28), goal(botafogo, 'Tiquinho Soares', 81)]));
    expect([...el.querySelectorAll('.team .name')].map((n) => n.textContent?.trim())).toEqual(['Botafogo', 'São Paulo']);
    expect(el.querySelector('.score')?.textContent?.replace(/\s/g, '')).toBe('1-1');
    expect(el.querySelector('.status')?.textContent?.trim()).toBe('Finalizado');
    expect(el.querySelector('.scorers .home')?.textContent).toContain("Tiquinho Soares 81'");
    expect(el.querySelector('.scorers .away')?.textContent).toContain("Pedro Lima 28'");
    const meta = el.querySelector('.meta')?.textContent?.replace(/\s+/g, ' ');
    expect(meta).toContain('23/11/2026 • 20:00');
    expect(meta).toContain('Campeonato Brasileiro Série A • 36ª rodada');
    expect(meta).toContain('Estádio Nilton Santos, Rio de Janeiro');
  });

  it('cartão vermelho fica numa linha abaixo da dos gols, mesmo sendo do outro time', () => {
    const el = render(
      match([0, 1], [goal(saoPaulo, 'Breno Lopes', 74), goal(botafogo, 'Nicolas Acevedo', 82, 'Red Card', null, 'Card')]),
    );
    const rows = [...el.querySelectorAll('.scorers')];
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.away')?.textContent).toContain("Breno Lopes 74'");
    expect(rows[0].querySelector('.home')?.textContent?.trim()).toBe('');
    // O ícone do cartão fica no meio da linha, como a bola na dos gols.
    expect(rows[1].getAttribute('aria-label')).toBe('Cartões vermelhos');
    expect(rows[1].querySelector('.icon .red-card')).toBeTruthy();
    expect(rows[1].querySelector('.home')?.textContent).toContain("Nicolas Acevedo 82'");
  });

  it('o seletor (celular) troca entre lance a lance, estatísticas e escalações', () => {
    const el = render(match([1, 1], []));
    const sections = el.querySelector('.sections') as HTMLElement;
    expect(sections.dataset['tab']).toBe('timeline');
    const tabs = [...el.querySelectorAll('.tabs [role="tab"]')] as HTMLButtonElement[];
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Lance a lance', 'Estatísticas', 'Escalações']);
    tabs[1].click();
    TestBed.inject(ApplicationRef).tick();
    expect(sections.dataset['tab']).toBe('stats');
    tabs[2].click();
    TestBed.inject(ApplicationRef).tick();
    expect(sections.dataset['tab']).toBe('lineups');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
  });

  it('ao vivo, a bolinha fica no lugar do traço do placar; encerrado, volta o traço', () => {
    const live = render(match([1, 0], [], '2H'));
    expect(live.querySelector('.header')?.classList).toContain('live');
    expect(live.querySelector('.score .live-dot')).not.toBeNull();
    expect(live.querySelector('.score .dash')).toBeNull();
    expect(live.querySelector('.status .live-dot')).toBeNull();
    const done = render(match([1, 0], []));
    expect(done.querySelector('.score .live-dot')).toBeNull();
    expect(done.querySelector('.score .dash')).not.toBeNull();
  });

  it('"Onde assistir" só aparece se a CBF tiver canais, e só antes e durante o jogo', () => {
    expect(render(match([0, 0], [], '2H')).querySelector('.watch')).toBeNull();
    broadcasts = [{ home: botafogo.id, away: saoPaulo.id, homeName: 'Botafogo', awayName: 'São Paulo', channels: ['Premiere'] }];
    expect(render(match([0, 0], [], '2H')).querySelector('.watch')?.textContent).toContain('Onde assistir');
    expect(render(match([0, 0], [], 'NS')).querySelector('.watch')).not.toBeNull();
    expect(render(match([0, 0], [], 'FT')).querySelector('.watch')).toBeNull();
  });

  it('lance a lance: com a bola rolando, a última linha são os três pontinhos; no intervalo e no fim, não', () => {
    const rolling = render(match([1, 0], [goal(botafogo, 'Tiquinho Soares', 20)], '2H'));
    expect(rolling.querySelector('.items > li:last-child')?.classList).toContain('typing');
    // Sem nenhum lance ainda, os pontinhos aparecem no lugar do "Nenhum lance ainda".
    expect(render(match([0, 0], [], '1H')).querySelector('.typing')).not.toBeNull();
    expect(render(match([1, 0], [goal(botafogo, 'Tiquinho Soares', 20)], 'HT')).querySelector('.typing')).toBeNull();
    expect(render(match([1, 0], [goal(botafogo, 'Tiquinho Soares', 20)], 'FT')).querySelector('.typing')).toBeNull();
  });

  it('"Onde assistir": esqueleto enquanto busca os canais; sem canais, a linha some', () => {
    pending = new Subject<Broadcast[]>();
    const el = render(match([0, 0], [], 'NS'));
    expect(el.querySelector('.watch-sk')).not.toBeNull();
    pending.next([]);
    TestBed.inject(ApplicationRef).tick();
    expect(el.querySelector('.watch-row')).toBeNull();
  });

  it('primeira busca falhou: segue no esqueleto, tenta de novo e mostra a partida, sem a tela de erro', () => {
    vi.useFakeTimers();
    let calls = 0;
    fixtureCall = (f) => (++calls === 1 ? throwError(() => new Error('429')) : of(f));
    const el = render(match([1, 0], []));
    expect(el.querySelector('section.message')).toBeNull();
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    vi.advanceTimersByTime(2000);
    TestBed.inject(ApplicationRef).tick();
    expect(calls).toBe(2);
    expect(el.querySelector('.team .name')?.textContent?.trim()).toBe('Botafogo');
    expect(el.querySelector('section.message')).toBeNull();
    vi.useRealTimers();
  });

  it('partida que não existe mostra o aviso', () => {
    expect(render(null).querySelector('.message')?.textContent).toContain('Partida não encontrada.');
    expect(render(null, 'abc').querySelector('.message')?.textContent).toContain('Partida não encontrada.');
  });
});

describe('Atualização da página da partida', () => {
  const kickoff = Date.UTC(2026, 10, 23, 23, 0) / 1000;
  const at = (short: string) => {
    const f = match([0, 0], [], short);
    f.fixture.timestamp = kickoff;
    return f;
  };
  const min = 60_000;

  it('ao vivo e no intervalo, a cada 15 s', () => {
    expect(refreshDelay(at('2H'), kickoff * 1000 + 60 * min)).toBe(15_000);
    expect(refreshDelay(at('HT'), kickoff * 1000 + 50 * min)).toBe(15_000);
  });

  it('antes do jogo: de tempos em tempos; a partir de 1 h antes, a cada minuto; perto do início, a cada 15 s', () => {
    // 5 h antes: volta em 30 min. 1 h 10 min antes: volta quando faltar 1 h.
    expect(refreshDelay(at('NS'), kickoff * 1000 - 300 * min)).toBe(30 * min);
    expect(refreshDelay(at('NS'), kickoff * 1000 - 70 * min)).toBe(10 * min);
    expect(refreshDelay(at('NS'), kickoff * 1000 - 40 * min)).toBe(min);
    // Nos 15 min antes do horário e depois dele (a API ainda não marcou o início): a cada 15 s.
    expect(refreshDelay(at('NS'), kickoff * 1000 - 10 * min)).toBe(15_000);
    expect(refreshDelay(at('NS'), kickoff * 1000 + 5 * min)).toBe(15_000);
  });

  it('depois do fim, a cada minuto até 3 h após o início; depois disso, para', () => {
    expect(refreshDelay(at('FT'), kickoff * 1000 + 120 * min)).toBe(min);
    expect(refreshDelay(at('FT'), kickoff * 1000 + 200 * min)).toBeNull();
  });

  it('adiada ou cancelada, não atualiza', () => {
    expect(refreshDelay(at('PST'), kickoff * 1000)).toBeNull();
    expect(refreshDelay(at('CANC'), kickoff * 1000)).toBeNull();
  });
});
