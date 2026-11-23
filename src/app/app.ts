import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SEASON } from './api/api-football';
import { ThemeService } from './shared/theme';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIcon, MatSlideToggle],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly season = SEASON;
  protected readonly theme = inject(ThemeService);
}
