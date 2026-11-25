import { Injury } from '../../api/api-football';
import { PLAYER_PLACEHOLDER } from '../../shared/player-photo';
import { absences } from './absences';

const home = { id: 121, name: 'Palmeiras', logo: '' };
const away = { id: 132, name: 'Chapecoense', logo: '' };

const injury = (team: typeof home, id: number | null, name: string, reason: string | null, type = 'Missing Fixture'): Injury => ({
  player: { id, name, photo: id ? `foto-${id}` : null, type, reason },
  team,
});

describe('Desfalques', () => {
  it('do time pedido, traduzidos, fora antes das dúvidas e sem repetir jogador', () => {
    const list = absences(
      [
        injury(home, 1, 'Raphael Veiga', 'Hamstring Injury', 'Questionable'),
        injury(home, 2, 'Gustavo Gómez', 'Yellow Cards'),
        injury(home, 2, 'Gustavo Gómez', 'Yellow Cards'),
        injury(away, 3, 'Fulano', 'Red Card'),
        injury(home, null, 'Sem Cadastro', 'Knee Injury'),
        injury(home, 4, 'Weverton', 'Coach Decision'),
      ],
      home.id,
    );
    // Vermelho, amarelos, lesão (fora antes de dúvida) e os demais.
    expect(list.map((a) => [a.name, a.reason, a.kind, a.doubtful])).toEqual([
      ['G. Gómez', 'Suspenso (3º amarelo)', 'yellow', false],
      ['S. Cadastro', 'Lesão no joelho', 'injury', false],
      ['R. Veiga', 'Lesão na posterior da coxa', 'injury', true],
      ['Weverton', 'Opção do técnico', 'other', false],
    ]);
    expect(list.find((a) => a.name === 'S. Cadastro')?.photo).toBe(PLAYER_PLACEHOLDER);
  });

  it('motivo desconhecido fica em inglês; suspenso por vermelho tem o cartão vermelho e vem primeiro', () => {
    const list = absences(
      [injury(away, 5, 'Beltrano', 'Visa Problems'), injury(away, 6, 'Ciclano', 'Yellow Cards'), injury(away, 3, 'Fulano', 'Red Card')],
      away.id,
    );
    expect(list.map((a) => [a.reason, a.kind])).toEqual([
      ['Suspenso (cartão vermelho)', 'red'],
      ['Suspenso (3º amarelo)', 'yellow'],
      ['Visa Problems', 'other'],
    ]);
  });

  it('com a escalação divulgada, não há dúvida: relacionado sai da lista, os demais ficam como fora', () => {
    const list = absences(
      [injury(home, 1, 'Raphael Veiga', 'Hamstring Injury', 'Questionable'), injury(home, 7, 'Mauricio', 'Knock', 'Questionable')],
      home.id,
      new Set(['id:1']),
    );
    expect(list.map((a) => [a.name, a.doubtful])).toEqual([['Mauricio', false]]);
  });
});
