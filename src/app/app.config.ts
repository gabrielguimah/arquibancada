import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { BOOT_SVG } from './shared/boot.svg';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    // mat-icon usa a fonte Material Symbols (carregada no index.html) em vez da Material Icons antiga.
    provideAppInitializer(() => {
      const icons = inject(MatIconRegistry);
      icons.setDefaultFontSetClass('material-symbols-outlined');
      const sanitizer = inject(DomSanitizer);
      icons.addSvgIconLiteral('chuteira', sanitizer.bypassSecurityTrustHtml(BOOT_SVG));
    }),
  ]
};
