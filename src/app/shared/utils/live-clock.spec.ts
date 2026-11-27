import { formatClock, localClock, serverClock, updateAnchor } from './live-clock';

const MIN = 60_000;
const SEC = 1000;

describe('live-clock', () => {
  describe('com a estimativa do Worker', () => {
    it('anda segundo a segundo a partir do início estimado', () => {
      // Período começou em 0; o site abre em 9:40 com a API ainda no minuto 10.
      expect(serverClock(0, 10, 9 * MIN + 40 * SEC)).toBe(9 * 60 + 40);
    });

    it('não trava quando a API demora a virar o minuto', () => {
      // API ainda no minuto 73 (72:xx), mas o relógio já está em 73:31: segue andando.
      expect(serverClock(0, 73, 73 * MIN + 31 * SEC)).toBe(73 * 60 + 31);
      expect(serverClock(0, 73, 73 * MIN + 50 * SEC)).toBe(73 * 60 + 50);
    });

    it('descarta estimativa que não bate com o minuto informado', () => {
      expect(serverClock(0, 10, 20 * MIN)).toBeNull();
      expect(serverClock(5 * MIN, 30, 10 * MIN)).toBeNull();
    });
  });

  describe('reserva, sem o Worker', () => {
    it('começa o minuto informado do zero', () => {
      const a = updateAnchor(undefined, '2H', 67, 0);
      expect(formatClock(localClock(a, 0), 67)).toBe('66:00');
      expect(formatClock(localClock(a, 12 * SEC), 67)).toBe('66:12');
    });

    it('recomeça quando chega um minuto novo e ignora dado mais velho', () => {
      const a = updateAnchor(undefined, '1H', 10, 0);
      expect(updateAnchor(a, '1H', 10, 50 * SEC)).toBe(a);
      expect(updateAnchor(a, '1H', 9, 50 * SEC)).toBe(a);
      const b = updateAnchor(a, '1H', 11, 70 * SEC);
      expect(formatClock(localClock(b, 70 * SEC), 11)).toBe('10:00');
    });

    it('recomeça quando muda o período', () => {
      const first = updateAnchor(undefined, '1H', 45, 0);
      const second = updateAnchor(first, '2H', 46, 20 * MIN);
      expect(formatClock(localClock(second, 20 * MIN), 46)).toBe('45:00');
    });

    it('para em um minuto à frente do informado se a API atrasar', () => {
      const a = updateAnchor(undefined, '1H', 45, 0);
      expect(formatClock(localClock(a, 70 * SEC), 45)).toBe("45'+1");
      expect(formatClock(localClock(a, 10 * MIN), 45)).toBe("45'+1");
    });
  });

  it('nos acréscimos, mostra o fim do tempo mais o minuto de acréscimo, sem segundos', () => {
    expect(formatClock(90 * 60, 90)).toBe("90'+1");
    expect(formatClock(92 * 60 + 26, 90)).toBe("90'+3");
    expect(formatClock(44 * 60 + 59, 45)).toBe('44:59');
  });
});
