/* iCITY 113Н — растровая (полутоновая) отрисовка кадра.
   Путь в проекте: lib/halftone.ts

   ЗАЧЕМ. Секция «Комплекс iCITY» открывает каждый кадр из растра:
   поверх фотографии лежит холст с её же полутоновой версией, и он
   тает за 550 мс. Растр здесь не украшение — это тот же приём, что
   несёт вся дизайн-система: фритта на фасаде iCITY, из которой снят
   и красный, и точечная сетка (docs/design-system.md).

   ПОЧЕМУ СЫРОЙ CANVAS 2D, А НЕ three.js. Правило проекта: three.js
   не должен попадать ни в один модуль, который импортируется со
   страницы напрямую (AGENTS.md). Секция комплекса — обычная секция
   в потоке, значит ей доступен только 2D-контекст. Здесь его хватает
   с запасом: расчёт разовый, на кадр приходится порядка 4–5 тысяч
   точек, анимируется потом только opacity.

   ЦВЕТА НЕ ЗАШИТЫ. Их читает вызывающий из вычисленных стилей узла
   (--paper, --ink, --frit) и передаёт сюда. Иначе в файле завёлся бы
   второй набор цветов рядом с app/tokens.css, и первая же правка
   палитры разъехалась бы с растром.

   ПАМЯТЬ. Правило секвенции («память важнее веса файлов») действует
   и тут: холст 560×420 при DPR 2 — это 1120×840×4 ≈ 3,8 МБ, пять
   кадров ≈ 19 МБ. Поэтому DPR капится двойкой, а исходники читаются
   в CSS-пикселях: шаг сетки не меньше 8 px, точнее сэмплировать
   незачем. */

export type HalftonePalette = {
  /** фон растра — --paper */
  paper: string;
  /** обычная точка — --ink */
  ink: string;
  /** точка на «сильно красном» пикселе — --frit */
  red: string;
};

/* Шаг сетки. Восемь пикселей — нижняя граница: мельче начинается муар
   на телефоне, ровно по той же причине, по которой --frit-dense
   на ≤767 px подменяется на --frit-mid в app/tokens.css. */
const MIN_STEP = 8;
const STEP_DIVISOR = 72;

/* Радиус точки: (1 − яркость) × шаг × 0,52. Коэффициент чуть больше
   половины — на чёрном соседние точки смыкаются, и заливка читается
   сплошной, как на настоящей фритте. */
const RADIUS_K = 0.52;

/* Точки тоньше трети пикселя не видно, а arc + fill на них всё равно
   тратится. На светлом небе это половина сетки. */
const MIN_RADIUS = 0.34;

/* «Сильно красный» пиксель — порог из спецификации блока. Осторожный
   намеренно: тёплая штукатурка и дерево не должны краснеть, красным
   на кадрах комплекса бывает только фирменная фритта. */
const RED_R = 170;
const RED_G = 90;

export function halftoneStep(cssWidth: number): number {
  return Math.max(MIN_STEP, cssWidth / STEP_DIVISOR);
}

/**
 * Считает полутоновую версию кадра и возвращает готовый холст.
 * Вызывать один раз на кадр (и заново на ресайзе): внутри
 * getImageData, это самая дорогая строка функции.
 *
 * @param img    уже декодированная картинка (см. img.decode())
 * @param cssW   ширина рамки в CSS-пикселях
 * @param cssH   высота рамки в CSS-пикселях
 */
export function renderHalftone(
  img: HTMLImageElement,
  cssW: number,
  cssH: number,
  palette: HalftonePalette
): HTMLCanvasElement | null {
  const w = Math.round(cssW);
  const h = Math.round(cssH);
  if (w < 2 || h < 2) return null;
  if (!img.naturalWidth || !img.naturalHeight) return null;

  /* --- 1. кадр в офскрин под сэмплирование, в CSS-пикселях ---------- */
  const sample = document.createElement('canvas');
  sample.width = w;
  sample.height = h;
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;

  /* object-fit: cover руками — рамка 4:3, а кадр может приехать любой */
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  sctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

  let data: Uint8ClampedArray;
  try {
    data = sctx.getImageData(0, 0, w, h).data;
  } catch {
    /* кадр с другого origin испортил бы холст — растра просто не будет */
    return null;
  }

  /* --- 2. отрисовка точек ------------------------------------------- */
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const out = document.createElement('canvas');
  out.width = Math.round(w * dpr);
  out.height = Math.round(h * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, w, h);

  const step = halftoneStep(w);

  /* Красные точки собираем отдельно и кладём вторым проходом: смена
     fillStyle между двумя цветами на каждой точке стоит дороже, чем
     один лишний массив. */
  const reds: number[] = [];

  ctx.fillStyle = palette.ink;
  ctx.beginPath();

  for (let y = step / 2; y < h; y += step) {
    const py = Math.min(h - 1, y | 0);
    for (let x = step / 2; x < w; x += step) {
      const px = Math.min(w - 1, x | 0);
      const i = (py * w + px) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      /* Rec. 709 — та же яркость, по которой считаются контрасты
         в docs/design-system.md */
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const radius = (1 - lum) * step * RADIUS_K;
      if (radius < MIN_RADIUS) continue;

      if (r > RED_R && g < RED_G) {
        reds.push(x, y, radius);
        continue;
      }
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  if (reds.length) {
    ctx.fillStyle = palette.red;
    ctx.beginPath();
    for (let i = 0; i < reds.length; i += 3) {
      const x = reds[i];
      const y = reds[i + 1];
      const radius = reds[i + 2];
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /* Офскрин под сэмплирование больше не нужен. Safari не отпускает
     canvas-память без явного обнуления размеров — то же правило,
     что при размонтировании секвенции (AGENTS.md). */
  sample.width = 0;
  sample.height = 0;

  return out;
}

/** Палитра из вычисленных стилей узла: единственный источник — tokens.css. */
export function paletteFrom(el: Element): HalftonePalette {
  const cs = getComputedStyle(el);
  const read = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    paper: read('--paper', '#F2F4F5'),
    ink: read('--ink', '#101619'),
    red: read('--frit', '#ED1C29'),
  };
}
