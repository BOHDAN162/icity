/* iCITY 113Н — данные интерьера: зоны, камеры, рендеры.
   Путь в проекте: lib/interior.ts

   ОДИН СЛОВАРЬ НА ВЕСЬ ОФИС. Ключ зоны здесь, в public/interior/zones_cameras.json
   и в именах файлов рендеров — один и тот же. Поэтому `meeting_lg`, а не
   `meeting`: переименовывать выгруженные ассеты дороже, чем один тип.

   СИСТЕМА КООРДИНАТ. Полигоны зон — план в метрах, пары [x, y].
   В three.js это (x, высота, y): X плана — это X, Y плана — это Z.
   Ничего не переставляем и не отрицаем. Камеры уже приходят готовыми
   тройками pos3/target3 — азимут пересчитывать не нужно.

   ЧЕГО ЗДЕСЬ НЕТ. Площадей отдельных зон. Полигоны — это области
   попадания курсора, а не обмер: их сумма 200,9 м² против 244,1 м²
   по документам, то есть 82 %. Подписывать их метражом значит выдумать
   число — docs/facts.md, раздел «Чисел нет». На плане подписано только
   имя зоны, метраж — общий. */

export type ZoneKey =
  | 'reception' | 'wc' | 'kitchen' | 'lounge' | 'meeting_lg'
  | 'office_e' | 'office_w' | 'corridor' | 'openspace';

/** Зоны, у которых есть рендер: в них можно войти. */
export type RenderKey = 'reception' | 'corridor' | 'openspace' | 'kitchen' | 'meeting_lg';

export type Pt = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export type PlanZone = {
  key: ZoneKey;
  /** имя берём отсюда, а не из JSON: подписи должны совпасть с офисом */
  label: string;
  poly: Pt[];
  centroid: Pt;
  /** есть рендер — зона кликабельна */
  target: RenderKey | null;
};

export type PlanCamera = { pos3: Vec3; target3: Vec3; fov: number };

export type Plan = {
  zones: PlanZone[];
  cameras: Record<RenderKey, PlanCamera>;
  /** габарит плана в метрах: [minX, minY, maxX, maxY] */
  bounds: readonly [number, number, number, number];
};

/* Подписи. JSON пришёл из модели и знает зоны, но не знает тон сайта:
   там «Санузлы» и «Кабинет восток» — рабочие имена разметки. Держим
   подписи здесь, рядом с теми, что уже стоят в OfficeHub. */
const LABEL: Record<ZoneKey, string> = {
  reception: 'Ресепшн',
  wc: 'Санузлы',
  kitchen: 'Кухня-лаунж',
  lounge: 'Зона отдыха',
  meeting_lg: 'Переговорная',
  office_e: 'Кабинет',
  office_w: 'Кабинеты',
  corridor: 'Коридор',
  openspace: 'Опенспейс',
};

const RENDER_KEYS: readonly RenderKey[] = ['reception', 'corridor', 'openspace', 'kitchen', 'meeting_lg'];

const isRenderKey = (k: string): k is RenderKey => (RENDER_KEYS as readonly string[]).includes(k);

/* Ширины вариантов. Источник — public/interior/renders/manifest.json;
   продублировано здесь, чтобы построить srcset без ожидания сети:
   кадр нужен на первом же экране офиса. Пересобираешь рендеры —
   сверь эту таблицу с манифестом. */
export const RENDER_WIDTHS: Record<RenderKey, readonly number[]> = {
  openspace: [640, 900, 1280, 1664],
  corridor: [640, 900, 1280, 1664],
  kitchen: [640, 900, 1280, 1672],
  reception: [700, 1100, 1600, 2400],
  meeting_lg: [640, 900, 1280, 1664],
};

/** Родное разрешение кадра — чтобы у <img> были честные width/height. */
export const RENDER_NATIVE: Record<RenderKey, readonly [number, number]> = {
  openspace: [1664, 936],
  corridor: [1664, 936],
  kitchen: [1672, 940],
  reception: [2731, 1536],
  meeting_lg: [1664, 936],
};

const RENDERS_DIR = '/interior/renders';

export const renderSrcSet = (key: RenderKey, ext: 'avif' | 'webp') =>
  RENDER_WIDTHS[key].map((w) => `${RENDERS_DIR}/${key}-${w}.${ext} ${w}w`).join(', ');

/** Самый мелкий вариант: он же fallback для <img> и он же то, что греем заранее. */
export const renderSmallest = (key: RenderKey) =>
  `${RENDERS_DIR}/${key}-${RENDER_WIDTHS[key][0]}.webp`;

/* --- геометрия ------------------------------------------------------- */

/** Центроид по формуле площади, а не среднее вершин: у Г-образного
    ресепшна и у опенспейса со скосом среднее уезжает за пределы зоны. */
export const centroidOf = (poly: Pt[]): Pt => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) return poly[0];
  return [cx / (6 * a), cy / (6 * a)];
};

/* --- загрузка -------------------------------------------------------- */

type RawZone = { name: string; poly: number[][]; render: string | null };
type RawCamera = { pos3: number[]; target3: number[]; fov: number };
type RawPlan = { zones: Record<string, RawZone>; cameras: Record<string, RawCamera> };

export const PLAN_URL = '/interior/zones_cameras.json';
export const GLB_URL = '/interior/dollhouse.glb';

/* Один промис на модуль. Кукольный дом открывают и закрывают по нескольку
   раз за просмотр — второй раз файл уже разобран. */
let planPromise: Promise<Plan> | null = null;

const parsePlan = (raw: RawPlan): Plan => {
  const zones: PlanZone[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const [key, z] of Object.entries(raw.zones)) {
    const poly = z.poly.map(([x, y]) => [x, y] as Pt);
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    zones.push({
      key: key as ZoneKey,
      label: LABEL[key as ZoneKey] ?? z.name,
      poly,
      centroid: centroidOf(poly),
      // кликабельность решает наличие рендера, а не имя файла в JSON:
      // имена там от исходников выгрузки (IMG_3547.PNG), нам нужен ключ
      target: z.render && isRenderKey(key) ? (key as RenderKey) : null,
    });
  }

  const cameras = {} as Record<RenderKey, PlanCamera>;
  for (const [key, c] of Object.entries(raw.cameras)) {
    if (!isRenderKey(key)) continue;
    cameras[key] = {
      pos3: [c.pos3[0], c.pos3[1], c.pos3[2]],
      target3: [c.target3[0], c.target3[1], c.target3[2]],
      fov: c.fov,
    };
  }

  return { zones, cameras, bounds: [minX, minY, maxX, maxY] };
};

export const loadPlan = (): Promise<Plan> => {
  if (!planPromise) {
    planPromise = fetch(PLAN_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`plan ${r.status}`);
        return r.json() as Promise<RawPlan>;
      })
      .then(parsePlan)
      .catch((e) => {
        // не кэшируем провал: сеть могла моргнуть, следующий заход честный
        planPromise = null;
        throw e;
      });
  }
  return planPromise;
};

/** Греем ассеты по наведению на кнопку — к клику всё уже в кэше. */
export const prefetchPlan = () => {
  void loadPlan().catch(() => {});
  if (typeof document === 'undefined') return;
  if (document.head.querySelector(`link[href="${GLB_URL}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = GLB_URL;
  link.as = 'fetch';
  link.crossOrigin = 'anonymous';
  document.head.append(link);
};

/* Кадр зоны греем заранее — по наведению на неё в плане. Preload с
   imagesrcset даёт браузеру тот же выбор варианта, что и <picture>
   потом: он возьмёт из кэша ровно ту ширину, которую сам же и выбрал.
   Через new Image() так не получится — там нет ни srcset, ни sizes. */
const warmed = new Set<RenderKey>();

export const prefetchRender = (key: RenderKey) => {
  if (typeof document === 'undefined' || warmed.has(key)) return;
  warmed.add(key);
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.type = 'image/avif';
  link.setAttribute('imagesrcset', renderSrcSet(key, 'avif'));
  link.setAttribute('imagesizes', '100vw');
  document.head.append(link);
};

/* --- карты глубины ---------------------------------------------------- */

/* Полукадровая карта обратной глубины на зону: 34–42 КБ, 8 бит, серый.
   Считана относительной моделью Depth-Anything V2 и подрезана по p99 —
   подробности в docs/parallax.md. Гистограмма НЕ растянута сознательно:
   значение — это 1/Z, а экранный сдвиг при смещении камеры пропорционален
   как раз 1/Z. Сжатая середина здесь физика, а не дефект. */
export type DepthEntry = {
  w: number;
  h: number;
  /** нормированная медиана кадра: плоскость нулевого параллакса */
  d50: number;
};

export const depthUrl = (key: RenderKey) => `/interior/depth/${key}.webp`;

const DEPTH_MANIFEST_URL = '/interior/depth/depth.json';

let depthPromise: Promise<Record<RenderKey, DepthEntry>> | null = null;

export const loadDepthManifest = (): Promise<Record<RenderKey, DepthEntry>> => {
  if (!depthPromise) {
    depthPromise = fetch(DEPTH_MANIFEST_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`depth ${r.status}`);
        return r.json() as Promise<Record<RenderKey, DepthEntry>>;
      })
      .catch((e) => {
        depthPromise = null;
        throw e;
      });
  }
  return depthPromise;
};

/* Амплитуда сдвига в экранных пикселях. Кухня тише остальных: у неё
   передний план сидит в 7,2 раза выше медианы кадра, и на общей
   амплитуде ближняя перегородка ездила бы заметно сильнее всего
   остального. Числа стартовые, крутить здесь. */
export const PARALLAX_AMPLITUDE: Record<RenderKey, number> = {
  openspace: 14,
  corridor: 14,
  kitchen: 10,
  reception: 14,
  meeting_lg: 14,
};

/* --- условия показа --------------------------------------------------- */

/** Медленная сеть: 3D не грузим совсем, отдаём векторный план. */
export const isSlowNetwork = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  if (!c) return false;
  return c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g';
};

/** Параллаксу нужен именно WebGL2: шейдер на GLSL ES 300 и одноканальная
    текстура R8. На WebGL1 он не соберётся, и это нормально — под холстом
    остаётся обычный кадр. */
export const hasWebGL2 = (): boolean => {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    return true;
  } catch {
    return false;
  }
};

/** Нет WebGL — нет сцены. Контекст сразу отпускаем, иначе он занимает слот. */
export const hasWebGL = (): boolean => {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    return true;
  } catch {
    return false;
  }
};

/* --- тайминги перелёта ------------------------------------------------
   Одни и те же числа нужны сцене (она ведёт камеру) и оболочке
   (она гасит холст кадром). Держим в одном месте. */
export const FLIGHT_MS = 1200;
export const CROSSFADE_AT = 800;   // на этой миллисекунде начинается проявление кадра
export const CROSSFADE_MS = 400;   // FLIGHT_MS − CROSSFADE_AT: кадр доходит ровно к посадке
