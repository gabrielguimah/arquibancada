import { ratingClass } from './rating';

describe('ratingClass', () => {
  it('separa as notas em faixas de 0,5 ponto, de 6 a 10', () => {
    const cases: Array<[number, string]> = [
      [10, 'r-100'],
      [9.99, 'r-95'],
      [9.5, 'r-95'],
      [9.49, 'r-90'],
      [8.71, 'r-85'],
      [8.2, 'r-80'],
      [7.99, 'r-75'],
      [7.42, 'r-70'],
      [6.5, 'r-65'],
      [6, 'r-60'],
      [5.99, 'r-0'],
    ];
    for (const [value, bin] of cases) expect(ratingClass(value)).toBe(`rating-badge ${bin}`);
  });
});
