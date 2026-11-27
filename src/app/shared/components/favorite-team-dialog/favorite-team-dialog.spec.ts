import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ApiFootball, Standing } from '../../../api/api-football';
import { FavoriteTeam } from '../../services/favorite-team';
import { FavoriteTeamDialog } from './favorite-team-dialog';

const row = (id: number, name: string) => ({ team: { id, name, logo: `${id}.png` } }) as Standing;

describe('FavoriteTeamDialog', () => {
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [FavoriteTeamDialog],
      providers: [
        { provide: ApiFootball, useValue: { standings: () => of([row(131, 'Corinthians'), row(1062, 'Atlético-MG'), row(130, 'Grêmio')]) } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
  });

  it('lista os times em ordem alfabética e salva o escolhido', async () => {
    const fixture = TestBed.createComponent(FavoriteTeamDialog);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button.team')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Atlético-MG', 'Corinthians', 'Grêmio']);
    expect(el.querySelector('.clear')).toBeNull();

    buttons[2].click();
    expect(TestBed.inject(FavoriteTeam).team()).toEqual({ id: 130, name: 'Grêmio', logo: '130.png' });
    expect(JSON.parse(localStorage.getItem('arquibancada:time')!).id).toBe(130);
    expect(close).toHaveBeenCalled();

    fixture.detectChanges();
    expect(el.querySelector('.selected')?.textContent).toContain('Grêmio');
    (el.querySelector('.clear') as HTMLButtonElement).click();
    expect(TestBed.inject(FavoriteTeam).team()).toBeNull();
    expect(localStorage.getItem('arquibancada:time')).toBeNull();
  });
});
