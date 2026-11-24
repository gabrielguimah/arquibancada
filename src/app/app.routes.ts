import { Routes } from '@angular/router';
import { Rodada } from './pages/rodada/rodada';

export const routes: Routes = [
  { path: '', component: Rodada, title: 'Arquibancada · Brasileirão ao vivo' },
  // Carregada só ao abrir a aba, para não pesar na primeira página.
  {
    path: 'estatisticas',
    loadComponent: () => import('./pages/estatisticas/estatisticas').then((m) => m.Estatisticas),
    title: 'Estatísticas · Arquibancada',
  },
  {
    path: 'partida/:id',
    loadComponent: () => import('./pages/partida/partida').then((m) => m.Partida),
    title: 'Partida · Arquibancada',
  },
  { path: '**', redirectTo: '' },
];
