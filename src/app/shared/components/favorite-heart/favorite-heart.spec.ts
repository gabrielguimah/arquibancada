import { TestBed } from '@angular/core/testing';
import { FavoriteHeart } from './favorite-heart';
import { FavoriteTeam } from '../../services/favorite-team';

describe('FavoriteHeart', () => {
  beforeEach(() => localStorage.clear());

  function render(team: number) {
    const fixture = TestBed.createComponent(FavoriteHeart);
    fixture.componentRef.setInput('team', team);
    fixture.detectChanges();
    return fixture;
  }

  it('só aparece ao lado do time do coração, e acompanha a troca', () => {
    const fixture = render(126);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.heart')).toBeNull();

    TestBed.inject(FavoriteTeam).set({ id: 126, name: 'São Paulo', logo: '' });
    fixture.detectChanges();
    expect(el.querySelector('.heart')?.getAttribute('aria-label')).toBe('Time do coração');

    TestBed.inject(FavoriteTeam).set({ id: 130, name: 'Grêmio', logo: '' });
    fixture.detectChanges();
    expect(el.querySelector('.heart')).toBeNull();
  });
});
