import { Component, Injector, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogClose, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { ApiFootball, Team } from '../api/api-football';
import { Crest } from './crest';
import { FavoriteTeam } from './favorite-team';
import { Notice } from './notice';

/**
 * Modal do time do coração: os clubes do campeonato (da classificação, em ordem alfabética) com
 * escudo e nome. Escolher um salva e fecha; "Remover" limpa a escolha.
 */
@Component({
  selector: 'app-favorite-team-dialog',
  imports: [Notice, MatIcon, MatDialogClose, Crest],
  templateUrl: './favorite-team-dialog.html',
  styleUrl: './favorite-team-dialog.scss',
})
export class FavoriteTeamDialog {
  private readonly api = inject(ApiFootball);
  private readonly dialog = inject(MatDialogRef<FavoriteTeamDialog>);
  protected readonly favorite = inject(FavoriteTeam);

  private readonly loaded = signal<Team[] | null>(null);
  protected readonly failed = signal(false);
  protected readonly teams = computed(() => this.loaded()?.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) ?? null);

  constructor() {
    this.load();
  }

  protected load() {
    this.failed.set(false);
    this.api.standings().subscribe({
      next: (rows) => this.loaded.set(rows.map((r) => r.team)),
      error: () => this.failed.set(true),
    });
  }

  protected choose(team: Team | null) {
    this.favorite.set(team);
    this.dialog.close();
  }
}

/**
 * Abre a modal do time do coração (botão do cabeçalho e o card da aba Times). Recebe o injector, e não o
 * MatDialog: assim quem chama pode importar este arquivo só no clique, e o código da modal (com a
 * biblioteca de diálogos) fica fora do carregamento inicial do site.
 */
export function openFavoriteTeamDialog(injector: Injector) {
  return injector.get(MatDialog).open(FavoriteTeamDialog, {
    panelClass: 'favorite-dialog',
    width: '800px',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100dvh - 48px)',
    autoFocus: 'dialog',
    ariaLabelledBy: 'favorite-title',
  });
}
