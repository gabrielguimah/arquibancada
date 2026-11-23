import { Component, computed, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SEASON } from './api/api-football';
import { BrowserNotifications } from './shared/browser-notifications';
import { GoalNotifier } from './shared/goal-notifier';
import { GoalToasts } from './shared/goal-toasts';
import { ThemeService } from './shared/theme';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIcon, MatSlideToggle, MatTooltip, GoalToasts],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly season = SEASON;
  protected readonly theme = inject(ThemeService);
  protected readonly notifications = inject(BrowserNotifications);
  protected readonly bellTip = computed(() =>
    this.notifications.enabled()
      ? 'Notificações de gol ligadas (clique para desligar)'
      : this.notifications.permission() === 'denied'
        ? 'Notificações bloqueadas no navegador: libere nas configurações do site'
        : 'Receber notificações de gol com o site em segundo plano',
  );

  constructor() {
    // Avisos de gol valem para o site todo, em qualquer página.
    inject(GoalNotifier).start();
  }
}
