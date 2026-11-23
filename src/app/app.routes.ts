import { Routes } from '@angular/router';
import { Rodada } from './pages/rodada/rodada';

export const routes: Routes = [
  { path: '', component: Rodada, title: 'Arquibancada · Brasileirão ao vivo' },
  { path: '**', redirectTo: '' },
];
