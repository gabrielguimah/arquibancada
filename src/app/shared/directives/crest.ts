import { Directive, ElementRef, HostListener, inject } from '@angular/core';

// Lado visível (média geométrica da caixa não transparente) que todos os escudos devem aparentar.
const TARGET_FILL = 0.86;

const scales = new Map<string, number>();

/**
 * Equaliza o tamanho aparente dos escudos. As imagens da API têm formatos diferentes:
 * escudos redondos preenchem o quadro inteiro e parecem maiores que os de outros formatos.
 */
@Directive({
  selector: 'img[crest]',
  host: { crossorigin: 'anonymous' },
})
export class Crest {
  private img = inject(ElementRef<HTMLImageElement>).nativeElement;

  @HostListener('load')
  protected onLoad() {
    const src = this.img.currentSrc;
    let scale = scales.get(src);
    if (scale === undefined) {
      scale = measure(this.img);
      scales.set(src, scale);
    }
    this.img.style.transform = scale < 1 ? `scale(${scale})` : '';
  }
}

function measure(img: HTMLImageElement): number {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !w || !h) return 1;
  ctx.drawImage(img, 0, 0);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return 1;
  }
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return 1;
  // object-fit: contain encaixa o lado maior no quadro; a fração visível é relativa a ele.
  const side = Math.max(w, h);
  const fill = Math.sqrt(((maxX - minX + 1) / side) * ((maxY - minY + 1) / side));
  return Math.min(1, TARGET_FILL / fill);
}
