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
  | 'office_e' | 'wardrobe' | 'skype_1' | 'skype_2' | 'corridor' | 'openspace';

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
  wardrobe: 'Гардероб',
  skype_1: 'Skype room 1',
  skype_2: 'Skype room 2',
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

/* Амплитуды параллакса переехали в lib/motion.ts — там же слежение
   плана за курсором и наклон телефона. Их крутят вместе после живого
   просмотра, значит и лежать они должны рядом. */

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

/* --- тайминги перехода «план → зона» -----------------------------------
   Одни и те же числа нужны сцене (она ведёт камеру) и оболочке
   (она растворяет оверлей). Держим в одном месте.

   ПЕРЕХОД ОДИН, А НЕ ТРИ. Раньше зритель получал три отдельных события
   подряд, и каждое читалось как рывок:

     1. камера прилетала и ЗАМИРАЛА на белой нетекстурированной модели.
        Виновата была кривая: easeOutQuart проходит 97 % пути за 58 %
        времени, то есть 42 % перелёта камера ехала только формально.
        Кривая заменена на easeInOutCubic (мёртвый хвост 19 %), и это
        не косметика — на ней держится весь порядок ниже;
     2. на 800 мс поверх неё начинал проявляться кадр зоны — «второй
        кадр через секунду»;
     3. оверлей снимался, и разом появлялись вуали OfficeHub
        (.scrimInfo — белая заливка на 56 % ширины, тот самый «белый
        туман»), подписи и стрелки.

   Теперь событие одно: камера ныряет к точке съёмки, доезжает — и ровно
   в этот момент оверлей целиком растворяется в готовый экран зоны.
   Порядок «сначала погружение, потом сразу экран», без промежуточных
   состояний между ними.

   ПОЧЕМУ REVEAL_AT ИМЕННО ЗДЕСЬ. Он привязан не к миллисекундам, а
   к ДОЛЕ ПРОЙДЕННОГО ПУТИ. Растворение обязано начаться в тот момент,
   когда нырок УЖЕ прочитан как завершённый, но камера ещё не встала
   намертво: это 97,6 % пути, а при easeInOutCubic они приходятся
   на 81,8 % времени перелёта. Оставшиеся 2,4 % камера проходит уже
   под растворением — поэтому кадра, где всё замерло, не существует.

   Мимо этого окна промахнуться легко в обе стороны:
     раньше — подрезаешь само погружение, зритель не доехал;
     позже — камера встаёт, и пауза до экрана читается как рывок.

   ОТСЮДА ПРАВИЛО СКОРОСТИ. Темп нырка меняется ОДНИМ числом, FLIGHT_MS,
   но следом обязан переехать и REVEAL_AT — он равен 0,818 × FLIGHT_MS.
   Поменяешь одно и забудешь второе — вернёшь ровно тот баг, из-за
   которого всё это писалось. Заказчик просил медленнее: было 1100,
   стало 1700 (2026-09-01). */
export const FLIGHT_MS = 1700;
/** старт растворения: 0,818 × FLIGHT_MS — это 97,6 % пути, нырок дочитан */
export const REVEAL_AT = 1390;
/** длительность растворения; конец на 1870 мс. Пара к --plan-out в CSS */
export const REVEAL_MS = 480;
/* Растворять в НЕЗАГРУЖЕННЫЙ кадр нельзя: под оверлеем оказался бы
   белый прямоугольник вместо фотографии. Ждём загрузки, но не вечно —
   на этом потолке уходим в любом случае, пустой кадр лучше зависшего
   оверлея.
   Считается от клика, поэтому едет вместе с FLIGHT_MS: запас на
   медленную сеть — это РАЗНИЦА с REVEAL_AT, и держать её надо около
   полутора секунд. Оставишь потолок на месте, замедлив нырок, —
   молча срежешь весь запас. */
export const REVEAL_CAP_MS = 2900;

/* 3D-ТУР — ВНЕШНЯЯ ПАНОРАМА, а не наш рендер. Живёт на kuula.co, поэтому
   открывается новой вкладкой: увести зрителя со страницы посреди
   переговоров нельзя. Параметры в адресе сняты заказчиком в интерфейсе
   Kuula (логотип, русские подсказки, миниатюры) — руками их не собирать,
   меняется ссылка целиком. */
export const TOUR_URL =
  'https://kuula.co/share/LM8c8/collection/7TWtd?logo=1&info=0&logosize=123&fs=1&vr=1&thumbs=1&inst=ru';
