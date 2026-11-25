import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { retryTransientErrors } from './api/retry';
import { BOOT_SVG } from './shared/boot.svg';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Falha passageira ao buscar no Worker: tenta de novo antes de mostrar erro.
    provideHttpClient(withFetch(), withInterceptors([retryTransientErrors])),
    // mat-icon usa a fonte Material Symbols (carregada no index.html) em vez da Material Icons antiga.
    provideAppInitializer(() => {
      const icons = inject(MatIconRegistry);
      icons.setDefaultFontSetClass('material-symbols-outlined');
      const sanitizer = inject(DomSanitizer);
      icons.addSvgIconLiteral('chuteira', sanitizer.bypassSecurityTrustHtml(BOOT_SVG));
    }),
  ]
};
