import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SEASON } from './api/api-football';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly season = SEASON;
}
