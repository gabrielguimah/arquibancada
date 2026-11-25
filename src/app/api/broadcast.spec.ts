import { channelName } from './broadcast';

describe('Nomes dos canais (Onde assistir)', () => {
  it('traduz os nomes da CBF para os do site; desconhecidos ficam como vieram', () => {
    expect(channelName('Sportv')).toBe('SporTV');
    expect(channelName('Amazon Prime')).toBe('Prime Video');
    expect(channelName('YouTube / Cazé TV')).toBe('CazéTV (YouTube)');
    expect(channelName(' Record ')).toBe('Record');
  });
});
