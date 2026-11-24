import { pageItems } from './pager';

describe('pageItems', () => {
  it('com poucas páginas, mostra todas', () => {
    expect(pageItems(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('no começo, mostra as primeiras, "…" e a última', () => {
    expect(pageItems(1, 37)).toEqual([1, 2, 3, 4, '…', 37]);
  });

  it('no meio, mostra as vizinhas da atual entre as pontas', () => {
    expect(pageItems(10, 37)).toEqual([1, '…', 9, 10, 11, '…', 37]);
  });

  it('no fim, mostra a primeira, "…" e as últimas', () => {
    expect(pageItems(37, 37)).toEqual([1, '…', 34, 35, 36, 37]);
  });

  it('buraco de uma página só mostra o número no lugar de "…"', () => {
    expect(pageItems(4, 10)).toEqual([1, 2, 3, 4, 5, '…', 10]);
  });
});
