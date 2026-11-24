import { ratingClass } from './rating';

describe('ratingClass', () => {
  it('uma classe por décimo, de 5,0 a 10', () => {
    const cases: Array<[number, string]> = [
      [10, 'r-100'],
      [9.99, 'r-99'],
      [8.71, 'r-87'],
      [7.49, 'r-74'],
      [7.3, 'r-73'],
      [7, 'r-70'],
      [6.05, 'r-60'],
      [5, 'r-50'],
      [4.2, 'r-50'],
    ];
    for (const [value, tenth] of cases) expect(ratingClass(value)).toBe(`rating-badge ${tenth}`);
  });
});
