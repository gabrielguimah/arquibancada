import { formatNumber, formatPercent } from './number-format';

describe('formatNumber / formatPercent', () => {
  it('vírgula nos decimais e ponto nos milhares, como no Brasil', () => {
    expect(formatNumber(1.7, 2)).toBe('1,70');
    expect(formatNumber(6.84, 1)).toBe('6,8');
    expect(formatNumber(13791)).toBe('13.791');
    expect(formatPercent(57.14, 1)).toBe('57,1%');
    // Casa extra só quando houver.
    expect(formatPercent(57, 0, 1)).toBe('57%');
    expect(formatPercent(57.5, 0, 1)).toBe('57,5%');
  });
});
