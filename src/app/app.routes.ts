import { Routes } from '@angular/router';
import { Campeonato } from './pages/campeonato/campeonato';

export const routes: Routes = [
  { path: '', component: Campeonato, title: 'Arquibancada · Brasileirão ao vivo' },
  // Carregada só ao abrir a aba, para não pesar na primeira página.
  {
    path: 'times',
    loadComponent: () => import('./pages/times/times').then((m) => m.Times),
    title: 'Times · Arquibancada',
  },
  {
    path: 'jogadores',
    loadComponent: () => import('./pages/jogadores/jogadores').then((m) => m.Jogadores),
    title: 'Jogadores · Arquibancada',
  },
  // Endereço antigo da aba de jogadores (links salvos e compartilhados).
  { path: 'estatisticas', redirectTo: 'jogadores' },
  {
    path: 'partida/:id',
    loadComponent: () => import('./pages/partida/partida').then((m) => m.Partida),
    title: 'Partida · Arquibancada',
  },
  { path: '**', redirectTo: '' },
];
