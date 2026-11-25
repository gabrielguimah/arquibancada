import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SEASON } from './api/api-football';
import { BrowserNotifications } from './shared/browser-notifications';
import { GoalNotifier } from './shared/goal-notifier';
import { GoalSounds } from './shared/goal-sounds';
import { GoalToasts } from './shared/goal-toasts';
import { ThemeService } from './shared/theme';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIcon, MatMenu, MatMenuItem, MatMenuTrigger, MatTooltip, GoalToasts],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly season = SEASON;
  protected readonly theme = inject(ThemeService);
  protected readonly notifications = inject(BrowserNotifications);
  protected readonly sounds = inject(GoalSounds);

  /** Desligar as notificações desliga também o som. */
  protected async toggleNotifications() {
    await this.notifications.toggle();
    if (!this.notifications.enabled() && this.sounds.enabled()) this.sounds.toggle();
  }

  /**
   * Ligar o som liga também as notificações (na primeira vez, o navegador pede a permissão; precisa vir
   * deste clique). Desligar o som não mexe nas notificações.
   */
  protected toggleSound() {
    this.sounds.toggle();
    if (this.sounds.enabled() && this.notifications.supported && !this.notifications.enabled()) void this.notifications.toggle();
  }

  constructor() {
    // Avisos de gol valem para o site todo, em qualquer página.
    inject(GoalNotifier).start();
  }
}
