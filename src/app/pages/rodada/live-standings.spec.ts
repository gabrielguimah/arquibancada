import { Fixture, Standing } from '../../api/api-football';
import { liveStandings } from './live-standings';

function row(rank: number, id: number, points: number, played: number, win: number, gd: number, gf = 40): Standing {
  return {
    rank,
    team: { id, name: `Time ${id}`, logo: '' },
    points,
    goalsDiff: gd,
    form: 'WWWWW',
    description: `zona ${rank}`,
    all: { played, win, draw: 0, lose: played - win, goals: { for: gf, against: gf - gd } },
  };
}

let nextId = 1;
function game(home: number, away: number, short: string, goals: [number, number], timestamp = 1000): Fixture {
  return {
    fixture: {
      id: nextId++,
      date: '',
      timestamp,
      venue: { name: null, city: null },
      status: { long: '', short, elapsed: short === 'FT' ? 90 : 60, extra: null },
    },
    teams: { home: { id: home, name: '', logo: '' }, away: { id: away, name: '', logo: '' } },
    goals: { home: goals[0], away: goals[1] },
  };
}

// 1: 50 pts, 2: 49 pts, 3: 48 pts, 4: 40 pts; todos com 10 jogos.
const base = () => [row(1, 1, 50, 10, 16, 10), row(2, 2, 49, 10, 16, 8), row(3, 3, 48, 10, 15, 6), row(4, 4, 40, 10, 12, 0)];
// Temporada: 10 jogos encerrados de cada time (pares 1x2 e 3x4), já contados.
const season = () => Array.from({ length: 10 }, () => [game(1, 2, 'FT', [1, 1]), game(3, 4, 'FT', [1, 1])]).flat();

describe('liveStandings', () => {
  it('sem jogo rolando nem pendente, devolve a classificação da API', () => {
    const b = base();
    expect(liveStandings(b, [game(1, 2, 'NS', [0, 0])], season())).toBe(b);
  });

  it('soma o placar do jogo em andamento e reordena, com a zona seguindo a posição', () => {
    const table = liveStandings(base(), [game(3, 1, '2H', [2, 0])], null);
    expect(table.map((s) => s.team.id)).toEqual([3, 1, 2, 4]);
    const [first, second] = table;
    expect(first).toEqual(
      expect.objectContaining({ rank: 1, points: 51, goalsDiff: 8, description: 'zona 1', form: 'WWWWW', liveForm: true }),
    );
    expect(first.all).toEqual(expect.objectContaining({ played: 11, win: 16 }));
    expect(second).toEqual(expect.objectContaining({ rank: 2, points: 50, goalsDiff: 8, description: 'zona 2' }));
    // Posições em relação à classificação da API: 3 subiu duas, 1 e 2 caíram uma, 4 ficou.
    expect(table.map((s) => s.change)).toEqual([2, -1, -1, 0]);
  });

  it('põe o resultado parcial nas "Últimas 5", marcado como em andamento', () => {
    const b = base();
    b[3].form = 'WWDLL';
    const table = liveStandings(b, [game(1, 4, '1H', [0, 0])], null);
    expect(table.find((s) => s.team.id === 4)).toEqual(expect.objectContaining({ form: 'DWWDL', liveForm: true }));
    expect(table.find((s) => s.team.id === 2)!.liveForm).toBeUndefined();
  });

  it('desempata por vitórias antes do saldo', () => {
    // 2 empata em pontos com 1 (50), mas com mais vitórias.
    const table = liveStandings(base(), [game(2, 4, 'HT', [1, 0])], null);
    expect(table[0].team.id).toBe(2);
    expect(table[0].points).toBe(52);
  });

  it('conta o jogo encerrado que a API ainda não contou, e só ele', () => {
    const counted = game(1, 2, 'FT', [0, 0], 500);
    const pending = game(4, 3, 'FT', [3, 0], 2000);
    // Temporada com 11 jogos de 1 e 2 (todos contados: disputados = 11) e 11 de 3 e 4 (um a mais que os disputados).
    const b = base();
    b[0].all.played = b[1].all.played = 11;
    const table = liveStandings(b, [counted, pending], [...season(), counted, pending]);
    const four = table.find((s) => s.team.id === 4)!;
    expect(four.points).toBe(43);
    expect(four.all.played).toBe(11);
    expect(four.form).toBe('WWWWW');
    expect(table.find((s) => s.team.id === 1)!.points).toBe(50);
  });

  it('jogo encerrado que ainda não está na lista da temporada também conta', () => {
    const pending = game(4, 3, 'FT', [1, 0], 2000);
    const b = base();
    b[3].form = 'LLDDL';
    const table = liveStandings(b, [pending], season());
    expect(table.find((s) => s.team.id === 4)!.points).toBe(43);
    // "Últimas 5" ganha a vitória na frente (a API manda o mais recente primeiro).
    expect(table.find((s) => s.team.id === 4)!.form).toBe('WLLDD');
  });

  it('jogo encerrado muda a classificação, mas não mostra seta', () => {
    // 4 vence 3 por 10 a 0 num jogo que a API ainda não contou: sobe, mas o jogo já acabou.
    const table = liveStandings(base(), [game(4, 3, 'FT', [10, 0], 2000)], season());
    expect(table.find((s) => s.team.id === 4)!.points).toBe(43);
    expect(table.every((s) => s.change === undefined)).toBe(true);
    expect(table.some((s) => s.liveForm)).toBe(false);
  });

  it('a seta compara com a classificação que já inclui os encerrados', () => {
    // Encerrado: 3 vence 4 (3 vai a 51 pts, 1º). Em andamento: 1 vence 2 (1 vai a 53, volta ao 1º).
    const table = liveStandings(
      base(),
      [game(3, 4, 'FT', [1, 0], 2000), game(1, 2, '2H', [1, 0])],
      season(),
    );
    expect(table.map((s) => s.team.id)).toEqual([1, 3, 2, 4]);
    // Antes dos jogos em andamento: 3, 1, 2, 4. Só 1 e 3 trocaram por causa do jogo rolando.
    expect(table.map((s) => s.change)).toEqual([1, -1, 0, 0]);
  });

  it('sem a lista da temporada, considera os encerrados já contados', () => {
    const b = base();
    expect(liveStandings(b, [game(4, 3, 'FT', [1, 0])], null)).toBe(b);
  });
});
