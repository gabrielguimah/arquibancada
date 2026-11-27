import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { MatIconRegistry } from '@angular/material/icon';
import { MAT_TOOLTIP_DEFAULT_OPTIONS, MatTooltipDefaultOptions } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { PreloadAllModules, provideRouter, withPreloading } from '@angular/router';

import { routes } from './app.routes';
import { retryTransientErrors } from './api/retry';
import { BOOT_SVG } from './shared/utils/boot.svg';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Depois da primeira página, baixa as outras em segundo plano: trocar de aba não espera o download.
    provideRouter(routes, withPreloading(PreloadAllModules)),
    // Falha passageira ao buscar no Worker: tenta de novo antes de mostrar erro.
    provideHttpClient(withFetch(), withInterceptors([retryTransientErrors])),
    // Dicas (matTooltip) no site todo. No toque, o Material bloqueia a rolagem que começa em cima do elemento
    // com dica (touch-action: none) para abrir no toque longo: com dicas em células de tabela, cartões de jogo
    // e jogadores no campo, a página não rolava. Desligado: no celular, abrem só as dicas que abrem no toque
    // (ícones de informação, opções bloqueadas), como a dica nativa, que também não aparecia no toque.
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: { showDelay: 0, hideDelay: 0, touchendHideDelay: 1500, touchGestures: 'off' } satisfies MatTooltipDefaultOptions,
    },
    // mat-icon usa a fonte Material Symbols (carregada no index.html) em vez da Material Icons antiga.
    provideAppInitializer(() => {
      const icons = inject(MatIconRegistry);
      icons.setDefaultFontSetClass('material-symbols-outlined');
      const sanitizer = inject(DomSanitizer);
      icons.addSvgIconLiteral('chuteira', sanitizer.bypassSecurityTrustHtml(BOOT_SVG));
    }),
  ]
};
