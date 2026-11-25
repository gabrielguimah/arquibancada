import { Component, computed, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggle } from '@angular/material/slide-toggle';
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
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIcon, MatSlideToggle, MatTooltip, GoalToasts],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly season = SEASON;
  protected readonly theme = inject(ThemeService);
  protected readonly notifications = inject(BrowserNotifications);
  protected readonly sounds = inject(GoalSounds);
  protected readonly bellTip = computed(() =>
    this.notifications.enabled()
      ? 'Notificações de gol ligadas (clique para desligar)'
      : this.notifications.permission() === 'denied'
        ? 'Notificações bloqueadas no navegador: libere nas configurações do site'
        : 'Receber notificações de gol, mesmo com o site fechado',
  );

  /** Botão de teste: dica com a hora em que a notificação de teste chega. */
  protected readonly testTip = computed(() => {
    const at = this.notifications.testAt();
    if (at === null) return 'Testar: receber uma notificação de gol daqui a 10 s (dá tempo de sair do site)';
    return 'Notificação de teste a caminho: saia do site ou bloqueie o celular';
  });

  protected async sendTest() {
    if (!(await this.notifications.sendTest())) {
      alert('Não foi possível agendar o teste. Confira se as notificações estão permitidas para o site.');
    }
  }

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
