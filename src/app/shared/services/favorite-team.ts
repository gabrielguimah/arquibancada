import { Injectable, signal } from '@angular/core';
import { Team } from '../../api/api-football';

const STORAGE_KEY = 'arquibancada:time';

/** Time do coração: id, nome e escudo (o cabeçalho mostra o escudo sem buscar nada). */
export type FavoriteTeamRef = Pick<Team, 'id' | 'name' | 'logo'>;

/** Time do coração escolhido no cabeçalho. Fica salvo no navegador. */
@Injectable({ providedIn: 'root' })
export class FavoriteTeam {
  readonly team = signal<FavoriteTeamRef | null>(load());

  set(team: FavoriteTeamRef | null) {
    this.team.set(team ? { id: team.id, name: team.name, logo: team.logo } : null);
    try {
      if (team) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.team()));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Armazenamento bloqueado (ex.: navegação privada): vale só nesta visita.
    }
  }
}

function load(): FavoriteTeamRef | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as FavoriteTeamRef | null;
    if (saved && typeof saved.id === 'number' && typeof saved.name === 'string' && typeof saved.logo === 'string') return saved;
  } catch {
    // Sem acesso ao armazenamento ou valor inválido: sem time.
  }
  return null;
}
