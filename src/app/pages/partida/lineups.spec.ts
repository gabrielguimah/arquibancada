import { TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { Fixture, FixtureEvent, LineupPlayer } from '../../api/api-football';
import { LineupSpot, lineups, pitchPositions, shortName } from './lineups';
import { MatchLineups } from './match-lineups';

const home = { id: 120, name: 'Botafogo', logo: '' };
const away = { id: 126, name: 'São Paulo', logo: '' };

const player = (id: number, name: string, grid: string | null, number = id): { player: LineupPlayer } => ({
  player: { id, name, number, pos: grid === '1:1' ? 'G' : 'M', grid },
});

function event(team: typeof home, type: string, detail: string, elapsed: number, playerId: number, assistId: number | null = null): FixtureEvent {
  return {
    time: { elapsed, extra: null },
    team,
    player: { id: playerId, name: `J${playerId}` },
    assist: { id: assistId, name: assistId ? `J${assistId}` : null },
    type,
    detail,
  };
}

const stat = (id: number, minutes: number, rating: string | null, captain = false) => ({
  player: { id, name: `J${id}`, photo: `foto-${id}` },
  statistics: [{ games: { minutes, rating, captain, substitute: false } }],
});

// Mandante: goleiro (1), defesa com 3 (colunas 1 a 3) e atacante (5). Visitante: goleiro e um atacante.
function match(): Fixture {
  return {
    fixture: { id: 1, date: '', timestamp: 0, venue: { name: null, city: null }, status: { long: '', short: 'FT', elapsed: 90, extra: null } },
    teams: { home, away },
    goals: { home: 1, away: 0 },
    lineups: [
      {
        team: home,
        formation: '3-1',
        startXI: [player(5, 'T. Soares', '3:1'), player(1, 'Goleiro', '1:1'), player(4, 'N. Ferraresi', '2:3'), player(2, 'Marçal', '2:1'), player(3, 'Justino', '2:2')],
        substitutes: [player(8, 'Não Entrou', null), player(7, 'D. Santos', null)],
        coach: { id: 1, name: 'Tite', photo: null },
      },
      {
        team: away,
        formation: '1',
        startXI: [player(21, 'Rafael', '1:1'), player(22, 'Calleri', '2:1')],
        substitutes: [],
        coach: null,
      },
    ],
    players: [
      { team: home, players: [stat(1, 90, '7.0'), stat(2, 90, '8.0', true), stat(3, 45, '6.0'), stat(4, 90, '7.0'), stat(5, 90, '7.5'), stat(7, 45, '6.5'), stat(8, 0, null)] },
      { team: away, players: [stat(21, 90, '6.0'), stat(22, 90, '6.2')] },
    ],
    events: [
      event(home, 'Goal', 'Normal Goal', 70, 5, 2),
      event(home, 'Card', 'Yellow Card', 30, 4),
      // Substituição com os papéis invertidos na API (quem entrou em `player`).
      event(home, 'subst', 'Substitution 1', 45, 7, 3),
    ],
  };
}

describe('Escalações', () => {
  it('monta as linhas do goleiro ao ataque, cada uma da esquerda para a direita do time', () => {
    const d = lineups(match())!;
    expect(d.home.lines.map((l) => l.map((p) => p.id))).toEqual([[1], [2, 3, 4], [5]]);
    expect(d.home.formation).toBe('3-1');
    expect(d.home.coach).toEqual({ name: 'Tite', photo: null });
  });

  it('junta nota, capitão, gols, assistências, cartões e substituições de cada jogador', () => {
    const d = lineups(match())!;
    const byId = new Map([...d.home.lines.flat(), ...d.home.substitutes].map((p) => [p.id, p]));
    expect(byId.get(5)).toEqual(expect.objectContaining({ name: 'T. Soares', goals: 1, rating: 7.5 }));
    expect(byId.get(2)).toEqual(expect.objectContaining({ assists: 1, captain: true }));
    expect(byId.get(4)?.yellow).toBe(true);
    // Mesmo com os papéis invertidos, quem estava em campo (3) é quem saiu.
    expect(byId.get(3)?.subOut).toBe("45'");
    expect(byId.get(7)?.subIn).toBe("45'");
    // Reservas: quem entrou primeiro; quem não jogou fica sem nota.
    expect(d.home.substitutes.map((p) => p.id)).toEqual([7, 8]);
    expect(byId.get(8)?.rating).toBeNull();
  });

  it('reserva que entrou sem nota mostra "Indef."; quem não jogou fica sem selo', () => {
    TestBed.configureTestingModule({ imports: [MatchLineups] });
    TestBed.inject(MatIconRegistry).addSvgIconLiteral('chuteira', TestBed.inject(DomSanitizer).bypassSecurityTrustHtml('<svg></svg>'));
    const f = match();
    // O reserva 7 entrou, mas a API ainda não deu nota.
    f.players![0].players.find((p) => p.player.id === 7)!.statistics[0].games.rating = null;
    const fixture = TestBed.createComponent(MatchLineups);
    fixture.componentRef.setInput('fixture', f);
    fixture.detectChanges();
    const bench = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.bench li')];
    const badge = (name: string) => bench.find((li) => li.textContent?.includes(name))!.querySelector('.rating-badge') as HTMLElement | null;
    expect(badge('D. Santos')?.textContent?.trim()).toBe('Indef.');
    expect(badge('D. Santos')?.title).toBe('Indefinido');
    expect(badge('N. Entrou')).toBeNull();
  });

  it('com gol e assistência, a assistência vai para o meio à direita', () => {
    TestBed.configureTestingModule({ imports: [MatchLineups] });
    TestBed.inject(MatIconRegistry).addSvgIconLiteral('chuteira', TestBed.inject(DomSanitizer).bypassSecurityTrustHtml('<svg></svg>'));
    const f = match();
    // Marçal (2) também marca.
    f.events!.push(event(home, 'Goal', 'Normal Goal', 85, 2));
    const fixture = TestBed.createComponent(MatchLineups);
    fixture.componentRef.setInput('fixture', f);
    fixture.detectChanges();
    const spot = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.spot')].find((li) => li.querySelector('.name')?.textContent?.includes('Marçal'))!;
    expect((spot.querySelector('.pos:has(.ev.assist)') as HTMLElement).classList).toContain('right');
    expect((spot.querySelector('.pos:has(.ev.goal)') as HTMLElement).classList).toContain('top-right');
  });

  it('reserva que entrou e depois saiu tem os dois minutos', () => {
    const f = match();
    f.events!.push(event(home, 'subst', 'Substitution 2', 80, 7, 8));
    const subs = lineups(f)!.home.substitutes;
    expect(subs.find((p) => p.id === 7)).toEqual(expect.objectContaining({ subIn: "45'", subOut: "80'" }));
    expect(subs.find((p) => p.id === 8)).toEqual(expect.objectContaining({ subIn: "80'", subOut: null }));
  });

  it('melhor da partida: a maior nota entre os dois times', () => {
    const d = lineups(match())!;
    const all = [d.home, d.away].flatMap((t) => [...t.lines.flat(), ...t.substitutes]);
    expect(all.filter((p) => p.best).map((p) => p.id)).toEqual([2]);
  });

  it('melhor da partida desempata como o melhor da rodada; expulso não concorre', () => {
    const best = (f: Fixture) =>
      [lineups(f)!.home, lineups(f)!.away].flatMap((t) => [...t.lines.flat(), ...t.substitutes]).filter((p) => p.best).map((p) => p.id);
    const tie = (rating: string) => {
      const f = match();
      // Goleiro (1) com a mesma nota do capitão (2, que tem assistência): ganha quem tem G + A.
      f.players![0].players.find((p) => p.player.id === 1)!.statistics[0].games.rating = rating;
      return f;
    };
    expect(best(tie('8.0'))).toEqual([2]);

    // Empate na nota e em G + A: o do time vencedor (mandante venceu 1 a 0) leva sobre o visitante.
    const f = match();
    f.events = [];
    f.players![1].players.find((p) => p.player.id === 22)!.statistics[0].games.rating = '8.0';
    expect(best(f)).toEqual([2]);

    // Expulso não concorre, mesmo com a maior nota.
    const g = match();
    g.events!.push(event(home, 'Card', 'Red Card', 89, 2));
    expect(best(g)).toEqual([5]);
  });

  it('nota do time é a média das notas, com peso pelos minutos', () => {
    // (7·90 + 8·90 + 6·45 + 7·90 + 7.5·90 + 6.5·45) / 450 = 7.15
    expect(lineups(match())!.home.rating).toBeCloseTo(7.15, 5);
  });

  it('posições no campo: goleiro colado no gol, linhas espaçadas por igual, jogadores centrados na largura', () => {
    const d = lineups(match())!;
    const pos = pitchPositions(d.home.lines);
    // Goleiro, linha de 3 e atacante: x cresce do gol para o meio-campo.
    const xs = pos.map((l) => l[0].x);
    [0.05, 0.27, 0.9].forEach((x, i) => expect(xs[i]).toBeCloseTo(x, 5));
    // Linha de 3: esquerda, meio e direita do time, com 30% entre vizinhos.
    expect(pos[1].map((p) => p.spot.id)).toEqual([2, 3, 4]);
    [0.2, 0.5, 0.8].forEach((y, i) => expect(pos[1][i].y).toBeCloseTo(y, 5));
    // Atacante sozinho: no meio da largura. Uma linha só depois do goleiro: no meio do caminho.
    expect(pos[2][0].y).toBeCloseTo(0.5, 5);
    expect(pitchPositions(lineups(match())!.away.lines)[1][0].x).toBeCloseTo(0.585, 5);
  });

  it('linha de 5 vai de uma lateral à outra, com o mesmo passo', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: i }) as LineupSpot);
    const ys = pitchPositions([[five[0]], five])[1].map((p) => p.y);
    [0.1, 0.3, 0.5, 0.7, 0.9].forEach((y, i) => expect(ys[i]).toBeCloseTo(y, 5));
  });

  it('abrevia o primeiro nome; já abreviado ou nome de uma palavra fica como está', () => {
    expect(shortName('Carlos Miguel')).toBe('C. Miguel');
    expect(shortName('Giorgian de Arrascaeta')).toBe('G. de Arrascaeta');
    expect(shortName('N. Ferraresi')).toBe('N. Ferraresi');
    expect(shortName('Marçal')).toBe('Marçal');
  });

  it('sem escalação divulgada, não monta nada', () => {
    expect(lineups({ ...match(), lineups: [] })).toBeNull();
  });

  it('no campo, cada time vem do goleiro ao ataque e da esquerda para a direita (o CSS espelha conforme a orientação)', () => {
    TestBed.configureTestingModule({ imports: [MatchLineups] });
    // Ícone da assistência (registrado no app.config na página de verdade).
    TestBed.inject(MatIconRegistry).addSvgIconLiteral('chuteira', TestBed.inject(DomSanitizer).bypassSecurityTrustHtml('<svg></svg>'));
    const fixture = TestBed.createComponent(MatchLineups);
    fixture.componentRef.setInput('fixture', match());
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const [home, away] = [...el.querySelectorAll('.side')];
    expect(home.classList).toContain('home');
    expect(away.classList).toContain('away');
    const names = (side: Element) =>
      [...side.querySelectorAll('.line')].map((l) => [...l.querySelectorAll('.spot')].map((s) => s.querySelector('.name')?.textContent?.replace(/\s+/g, ' ').trim()));
    expect(names(home)).toEqual([['1 Goleiro'], ['2 (c) Marçal', '3 Justino', '4 N. Ferraresi'], ['5 T. Soares']]);
    expect(names(away)).toEqual([['21 Rafael'], ['22 Calleri']]);

    // Assistência sem gol fica no lugar do gol (em cima à direita).
    const spot = (n: string) => [...el.querySelectorAll('.spot')].find((li) => li.querySelector('.name')?.textContent?.includes(n))!;
    const assistPos = spot('Marçal').querySelector('.pos:has(.ev.assist)') as HTMLElement;
    expect(assistPos.classList).toContain('top-right');
    expect(assistPos.classList).not.toContain('right');

    // Reserva que não jogou: sem selo. Reserva que entrou e ainda não tem nota: selo cinza "Indef.".
    const bench = [...el.querySelectorAll('.bench li')];
    const unused = bench.find((li) => li.textContent?.includes('N. Entrou'))!;
    expect(unused.querySelector('.rating-badge')).toBeNull();
  });
});
