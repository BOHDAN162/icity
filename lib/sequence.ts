/* iCITY 113Н — контракт секвенции башни.
   Путь в проекте: lib/sequence.ts

   ЕДИНСТВЕННЫЙ ИСТОЧНИК КОЛИЧЕСТВА КАДРОВ. Число кадров в этом проекте —
   не настройка плеера, а бюджет оперативной памяти. Пока оно стояло
   литералом внутри компонента, а его последствия — прозой в трёх
   комментариях и в SEQUENCE.md, перерендер со 150 на 240 кадров оставил
   все расчёты памяти врать на 60 %. Поэтому здесь лежат и сами кадры,
   и то, что из них следует: резидентность и вес в памяти считаются
   функциями, а не переписываются руками.

   ПАМЯТЬ ВАЖНЕЕ ВЕСА ФАЙЛОВ. Декодированный кадр занимает
   ширина × высота × 4 байта независимо от размера файла: 1600×900 —
   это 5,76 МБ при файле в 31 КБ, инфляция в 190 раз. Лимит canvas-памяти
   на iOS — от 224 МБ, и превышение не тормозит, а убивает вкладку.

   МЕНЯЕШЬ COUNT — ПЕРЕСЧИТАЙ residentBytes. Для десктопа предел даёт
   maxWindowRadius: при 1600×900 в 224 МБ влезает 38 кадров, то есть
   радиус не больше 17. Расширять окно «потому что кадров стало больше»
   нельзя — оно упирается в память, а не в количество. */

export type Variant = {
  dir: string;
  count: number;
  width: number;
  height: number;
  /** true — держим скользящее окно вокруг плейхеда, false — всю секвенцию */
  windowed: boolean;
  /** дистанция прокрутки секции сверх экрана, svh: см. TowerSequence.module.css */
  travelSvh: number;
};

/* Кадры: /sequence/<dir>/f_0001.webp … f_<count>.webp, WebP без альфа-канала.
   Небо, облака и соседние башни Москва-Сити запечены в кадры. */
export const DESKTOP: Variant = {
  dir: '/sequence/desktop',
  count: 240,
  width: 1600,
  height: 900,
  windowed: true,
  travelSvh: 300,
};

export const MOBILE: Variant = {
  dir: '/sequence/mobile',
  count: 144,
  width: 828,
  height: 466,
  windowed: false,
  travelSvh: 220,
};

/** мобильная секвенция берётся при ширине окна не больше этой */
export const MOBILE_MAX_WIDTH = 828;

/* Окно симметричное: управление скролльное, плейхед ходит в обе стороны,
   и односторонняя выгрузка замораживает картинку при движении вверх.
   16 + 16 + 1 = 33 кадра в окне плюс вечный нулевой — см. residentBytes. */
export const WINDOW_RADIUS = 16;

/** сплошной блок с начала, грузится сразу; окно догружает остальное */
export const PRIME_FRAMES = 20;

/** как часто окно переезжает за плейхедом, мс */
export const WINDOW_POLL_MS = 120;

export const frameSrc = (v: Variant, i: number) =>
  `${v.dir}/f_${String(i + 1).padStart(4, '0')}.webp`;

/** байт оперативной памяти на один декодированный кадр */
export const frameBytes = (v: Variant) => v.width * v.height * 4;

/* Сколько кадров лежит декодированными в худший момент. Нулевой кадр
   не освобождается никогда — он подложка на случай, если следующий
   ещё не доехал, — поэтому к окну прибавляется единица. */
export const residentFrames = (v: Variant, radius = WINDOW_RADIUS) =>
  v.windowed ? Math.min(2 * radius + 2, v.count) : v.count;

/** пиковая canvas-память секвенции, МБ. Лимит iOS — от 224 */
export const residentMb = (v: Variant, radius = WINDOW_RADIUS) =>
  (residentFrames(v, radius) * frameBytes(v)) / 1e6;

/** предельный радиус окна, при котором вариант остаётся под лимитом iOS */
export const maxWindowRadius = (v: Variant, limitMb = 224) =>
  Math.floor((limitMb * 1e6) / frameBytes(v) / 2) - 1;

/* Сколько пикселей прокрутки приходится на кадр при данной высоте окна.
   Десктоп: 240 кадров на 300svh при вьюпорте 900 — 11,3 px на кадр
   (было 18 при 150 кадрах). Отсюда же считается запас окна: 16 кадров
   вперёд — это всего 180 px хода вместо прежних 288. */
export const pxPerFrame = (v: Variant, viewportPx: number) =>
  (viewportPx * v.travelSvh) / 100 / (v.count - 1);
