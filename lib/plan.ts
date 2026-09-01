/* iCITY 113Н — данные чертежа: контур, стены, зоны, мебель.
   Путь в проекте: lib/plan.ts

   ОДИН ИСТОЧНИК. Всё, что рисует чертёж, лежит в
   public/interior/geometry.json — там же, откуда собран кукольный дом.
   Ключи зон совпадают с zones_cameras.json и с именами рендеров:
   переименуешь здесь — разъедется с 3D-планом.

   ПЛОЩАДИ СЧИТАЕТ СКРИПТ. `area_m2` каждой зоны получен растеризацией
   с шагом 1 см в scripts/plan-rooms.mjs: каждая клетка чистого пола
   отдана ровно одной зоне, поэтому сумма сходится по построению.
   Руками эти числа не править — прогонять скрипт.

   ПОЧЕМУ ТРИ ЧИСЛА, А НЕ ОДНО. 244,1 м² — по документам, по контуру
   плиты. Чистого пола 221,2: разницу занимают перегородки и колонны.
   Сумма подписей на чертеже равна чистому полу, и в подвале листа
   стоит строка со всеми тремя числами — иначе финдир поймает
   несходимость раньше, чем мы успеем её объяснить.

   ФАЙЛ КАЧАЕТСЯ ТОЛЬКО ПО КЛИКУ «Чертёж». В бюджет первого экрана
   он не входит и входить не должен. */

export type Pt = readonly [number, number];
export type Ring = Pt[];

export type Room = {
  key: string;
  label: string;
  /** короткое имя: подставляется, когда полное не влезает в зону */
  short: string;
  /** есть свои стены — площадь обмерная, а не по линии зонирования */
  enclosed: boolean;
  poly: Ring[];
  area_m2: number;
  gross_m2: number;
  /** точка подписи: самое просторное место зоны, считает plan-rooms.mjs */
  anchor: Pt;
  /** сколько места под подпись есть вокруг якоря, в метрах */
  fit_w: number;
  fit_h: number;
};

/** t: r прямоугольник · c круг · cab секционный шкаф · rail вешало ·
    hob плита · sink мойка · wc унитаз · fridge холодильник · tv экран */
export type Furn = {
  z: string;
  t: 'r' | 'c' | 'cab' | 'rail' | 'hob' | 'sink' | 'wc' | 'fridge' | 'tv';
  x?: number; y?: number; w?: number; h?: number;
  cx?: number; cy?: number; rad?: number;
  rr?: number; a?: number; n?: number; dir?: 'h' | 'v'; x2?: boolean;
};

export type Door = { hx: number; hy: number; r: number; a0: number; a1: number };
export type Dim = {
  kind: 'w' | 'h' | 'g';
  x1: number; y1: number; x2: number; y2: number;
  off: number; text: string;
};

export type Seg = { x1: number; y1: number; x2: number; y2: number };
export type Column = { cx: number; cy: number; d: number };

export type Drawing = {
  slab: Ring;
  walls: Ring[];
  diag: Seg[];
  wallTh: number;
  columns: Column[];
  glazingFacade: Seg[];
  glazingInterior: Seg[];
  mullions: { cx: number; cy: number }[];
  mullionW: number;
  rooms: Room[];
  furniture: Furn[];
  doors: Door[];
  dimensions: Dim[];
  areaDoc: number;
  areaNet: number;
  areaStructure: number;
  /** [minX, minY, maxX, maxY] по контуру плиты, в метрах */
  bounds: readonly [number, number, number, number];
};

type Raw = {
  slab: number[][];
  wall_polygons: { outer: number[][] }[];
  walls_diag: Seg[];
  wall_th: number;
  columns: Column[];
  glazing_facade: Seg[];
  glazing_interior: Seg[];
  mullions: { cx: number; cy: number }[];
  mullion_w: number;
  rooms: (Omit<Room, 'poly'> & { poly: number[][][] })[];
  furniture: Furn[];
  doors: Door[];
  dimensions: Dim[];
  area_check_m2: number;
  area_net_m2: number;
  structure_m2: number;
};

export const DRAWING_URL = '/interior/geometry.json';

const ring = (r: number[][]): Ring => r.map(([x, y]) => [x, y] as Pt);

const parse = (raw: Raw): Drawing => {
  const xs = raw.slab.map((p) => p[0]);
  const ys = raw.slab.map((p) => p[1]);
  return {
    slab: ring(raw.slab),
    walls: raw.wall_polygons.map((w) => ring(w.outer)),
    diag: raw.walls_diag,
    wallTh: raw.wall_th,
    columns: raw.columns,
    glazingFacade: raw.glazing_facade,
    glazingInterior: raw.glazing_interior,
    mullions: raw.mullions,
    mullionW: raw.mullion_w,
    rooms: raw.rooms.map((r) => ({ ...r, poly: r.poly.map(ring) })),
    furniture: raw.furniture,
    doors: raw.doors,
    dimensions: raw.dimensions,
    areaDoc: raw.area_check_m2,
    areaNet: raw.area_net_m2,
    areaStructure: raw.structure_m2,
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
};

/* Один промис на модуль: чертёж открывают и закрывают по нескольку раз
   за просмотр — второй раз файл уже разобран. Провал не кэшируем. */
let promise: Promise<Drawing> | null = null;

export const loadDrawing = (): Promise<Drawing> => {
  if (!promise) {
    promise = fetch(DRAWING_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`drawing ${r.status}`);
        return r.json() as Promise<Raw>;
      })
      .then(parse)
      .catch((e) => { promise = null; throw e; });
  }
  return promise;
};

/** Греем по наведению на кнопку «Чертёж» — к клику файл уже разобран. */
export const prefetchDrawing = () => { void loadDrawing().catch(() => {}); };

/* --- геометрия для подписей ------------------------------------------- */

export const bboxOf = (rings: Ring[]) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
};

/* Подпись шире помещения — это ошибка чертежа, а не мелочь: имя
   наезжает на перегородку и читается как чужое. Поэтому у каждой зоны
   есть короткое имя, а решение принимается по фактической ширине зоны
   на экране. Ширину знака берём приближённо: у Geist Sans средняя
   ширина строчной около 0,55 кегля, для наших коротких имён этого
   достаточно, а измерять текст через DOM на каждом кадре зума дорого. */
const CHAR = 0.53;

export type Label = { name: string | null; area: string; rot: boolean };

export const fmtArea = (v: number) => `${v.toFixed(1).replace('.', ',')} м²`;

/**
 * @param room зона
 * @param k пикселей на метр при текущем зуме
 * @param nameSize кегль имени в пикселях
 */
export const pickLabel = (room: Room, k: number, nameSize: number, areaSize: number): Label => {
  const W = room.fit_w * k;
  const H = room.fit_h * k;
  const width = (s: string, size: number) => s.length * CHAR * size;
  const area = fmtArea(room.area_m2);

  /* Порядок перебора — как на бумажном чертеже: сначала пробуем поставить
     подпись горизонтально, и только если помещение слишком узкое —
     кладём её вдоль, снизу вверх. Так подписаны узкие комнаты во всех
     нормальных планах, и это лучше, чем оставить кабину без имени. */
  const tryFit = (along: number, across: number, rot: boolean): Label | null => {
    const avail = along - 10;                     // поля по 5 px с каждой стороны
    if (across < 34 || avail <= 0) return null;
    const withArea = width(area, areaSize) <= avail ? area : '';
    if (width(room.label, nameSize) <= avail) return { name: room.label, area: withArea, rot };
    if (width(room.short, nameSize) <= avail) return { name: room.short, area: withArea, rot };
    return null;
  };

  const flat = tryFit(W, H, false);
  if (flat) return flat;
  const upright = tryFit(H, W, true);
  if (upright) return upright;

  // имя не влезло никак — оставляем хотя бы метраж, он важнее
  const areaFlat = width(area, areaSize) <= W - 10 && H >= 15;
  return { name: null, area: areaFlat ? area : '', rot: false };
};
