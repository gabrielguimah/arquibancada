import { Broadcast, Fixture } from '../../../api/api-football';
import { channelsFor } from './broadcast';

const fixture = (home: { id: number; name: string }, away: { id: number; name: string }) =>
  ({ teams: { home: { ...home, logo: '' }, away: { ...away, logo: '' } } }) as Fixture;

const game = (extra: Partial<Broadcast>): Broadcast => ({
  home: 1062,
  away: 131,
  homeName: 'Atlético Mineiro',
  awayName: 'Corinthians',
  channels: ['Premiere'],
  ...extra,
});

describe('Onde assistir', () => {
  const atletico = { id: 1062, name: 'Atlético-MG' };
  const corinthians = { id: 131, name: 'Corinthians' };

  it('acha o jogo pelos ids dos times', () => {
    const games = [game({ home: 127, away: 128, channels: ['Globo'] }), game({ channels: ['Premiere', 'SporTV'] })];
    expect(channelsFor(fixture(atletico, corinthians), games)).toEqual(['Premiere', 'SporTV']);
  });

  it('mandante e visitante trocados não são o mesmo jogo', () => {
    expect(channelsFor(fixture(corinthians, atletico), [game({})])).toEqual([]);
  });

  it('clube que o Worker não conhece: casa pelo nome (sem acento e sem "SAF")', () => {
    const games = [game({ home: null, homeName: 'Coritiba SAF', away: null, awayName: 'Grêmio', channels: ['Globo'] })];
    expect(channelsFor(fixture({ id: 147, name: 'Coritiba' }, { id: 130, name: 'Gremio' }), games)).toEqual(['Globo']);
  });
});
