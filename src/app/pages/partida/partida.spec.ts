import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiFootball, Fixture, FixtureEvent } from '../../api/api-football';
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
  function render(f: Fixture | null, id = '1492463') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Partida],
      providers: [
        provideRouter([]),
        { provide: ApiFootball, useValue: { fixture: () => of(f), injuries: () => of([]), coach: () => of(null) } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id })) } },
      ],
    });
    const fixture = TestBed.createComponent(Partida);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

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

  it('ao vivo, a bolinha fica acima do placar (e não na linha do relógio)', () => {
    const el = render(match([1, 0], [], '2H'));
    expect(el.querySelector('.header')?.classList).toContain('live');
    const center = el.querySelector('.center')!;
    expect(center.firstElementChild?.classList).toContain('live-dot');
    expect(el.querySelector('.status .live-dot')).toBeNull();
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
