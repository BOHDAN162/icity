/* iCITY 113Н — карта локации на Яндекс JS API v3.
   Путь в проекте: components/YandexMap.tsx

   Монохромная схема Яндекса. Модуль грузится только через
   dynamic(..., { ssr: false }) из Location.tsx и только по кнопке:
   бесплатный тариф даёт 100 показов карты в сутки, подробности
   и остальные внешние условия — в AGENTS.md, раздел «Карта локации».

   ЧТО ПОКАЗЫВАЕТ. Ноль или одну связку. В покое не выбрано ничего:
   карта стоит общим планом, на ней только башня. Клик по строке слева
   строит одну красную линию, ставит метку назначения и подбирает рамку;
   повторный клик по той же строке всё снимает и возвращает общий план.

   ПОЧЕМУ КАМЕРА ЕЗДИТ. Связки очень разной длины: до МЦД 105 м, до
   Кутузовского 1486 м. На одном зуме половина из них либо не влезает
   в кадр, либо вырождается в точку. Поэтому под каждую строку камера
   подбирает свою рамку — иначе «путь до каждого объекта» существует
   только на бумаге.

   РУЧНОЙ ЗУМ И КАМЕРА НЕ ДЕРУТСЯ. Как только зритель сам тронул карту
   (кнопки, щипок, перетаскивание, двойной клик), автоподбор рамки
   выключается насовсем — до кнопки сброса. Связки при этом продолжают
   слушаться курсора: они географические, живут на любом зуме сами
   и прятать их не нужно.

   scrollZoom НЕ ВКЛЮЧАТЬ НИКОГДА. Колесо над картой посреди лендинга
   перехватывало бы прокрутку страницы. Зум идёт кнопками, двойным
   кликом и щипком. На тач-устройствах перетаскивание тоже выключено:
   одним пальцем там прокручивают страницу, карту двигают двумя.

   ЦВЕТА ЗДЕСЬ ХЕКСАМИ, И ЭТО ВЫНУЖДЕННО. Кастомизация тайлов уезжает
   в WebGL Яндекса, CSS-переменные туда не доходят. Каждое значение
   ниже — копия токена из app/tokens.css, правится парой с ним. */

'use client';

import { useEffect, useRef, useState } from 'react';
import type { YMap, YMapFeature, YMapMarker } from '@yandex/ymaps3-types';
import type { BehaviorType, Customization, LngLat, LngLatBounds } from '@yandex/ymaps3-types';
import { ICITY, LEGS, MAP_CENTER, MAP_ZOOM, ZOOM_RANGE } from '@/lib/geo';
import styles from './Location.module.css';

declare global {
  interface Window {
    ymaps3?: typeof import('@yandex/ymaps3-types');
  }
}

/* --- палитра: копии токенов из app/tokens.css ------------------------- */
const PAPER = '#F2F4F5'; /* --paper   */
const PAPER_2 = '#E6EAEC'; /* --paper-2 */
const PAPER_3 = '#DDE2E5'; /* --paper-3 */
const ALU = '#B7BFC4'; /* --alu     */
const INK_60 = '#566065'; /* --ink-60  */
const WHITE = '#FFFFFF'; /* --white   */
const FRIT = '#ED1C29'; /* --frit: линии 1–2 px, правило 1 ДС */

/* --- монохром: земля бумажная, дороги белые, POI выключены ------------ */
const CUSTOMIZATION: Customization = [
  { tags: { any: ['landscape', 'land', 'landcover', 'urban_area'] }, elements: 'geometry', stylers: [{ color: PAPER }] },
  { tags: { any: ['vegetation', 'national_park', 'terrain'] }, elements: 'geometry', stylers: [{ color: PAPER_2 }] },
  { tags: { all: ['water'] }, elements: 'geometry', stylers: [{ color: PAPER_3 }] },
  { tags: { any: ['structure', 'building'] }, elements: 'geometry.fill', stylers: [{ color: PAPER_2 }] },
  { tags: { any: ['structure', 'building'] }, elements: 'geometry.outline', stylers: [{ color: PAPER_3 }] },

  /* Дороги: полотно белое, кант алюминиевый — та же пара, что несла
     рисованная схема (белая бумага, линии --alu). */
  { tags: { all: ['road'] }, elements: 'geometry.fill', stylers: [{ color: WHITE }] },
  { tags: { all: ['road'] }, elements: 'geometry.outline', stylers: [{ color: PAPER_3 }] },
  { tags: { any: ['road_1', 'road_2', 'road_3'] }, elements: 'geometry.outline', stylers: [{ color: ALU }] },

  /* Железная дорога остаётся: по ней стоит МЦД, ради которого секция. */
  { tags: { any: ['transit_line', 'transit_schema'] }, elements: 'geometry', stylers: [{ color: ALU }] },

  /* Чужие точки интереса — вон целиком, вместе с иконками и подписями. */
  { tags: { all: ['poi'] }, elements: 'label', stylers: [{ visibility: 'off' }] },
  { tags: { all: ['poi'] }, elements: 'geometry', stylers: [{ visibility: 'off' }] },
  { tags: { any: ['transit_location', 'transit_stop', 'transit_entrance'] }, elements: 'label', stylers: [{ visibility: 'off' }] },

  /* Номера домов — вон. На кадре про башню «9с4» и «13соор1» читаются
     мусором и спорят с нашими подписями. */
  { tags: { all: ['address'] }, elements: 'label', stylers: [{ visibility: 'off' }] },

  /* Остаются названия улиц и районов — ровно то, что несла схема. */
  { tags: { any: ['road', 'admin'] }, elements: 'label.text.fill', stylers: [{ color: INK_60 }] },
  { tags: { any: ['road', 'admin'] }, elements: 'label.text.outline', stylers: [{ color: WHITE }] },
  { tags: { any: ['road', 'admin'] }, elements: 'label.icon', stylers: [{ visibility: 'off' }] },
];

const DRAW_MS = 450;
const FLY_MS = 620;

/* Копия кривой --ease-soft из app/tokens.css: cubic-bezier(0.16,1,0.3,1).
   В JS она нужна потому, что геометрию линии наращивает rAF, а не CSS.
   Правится парой с токеном — как --hold-* в TowerSequence.tsx. */
const EASE_SOFT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* Ньютон по x, затем значение по y. Пятнадцать строк вместо зависимости. */
function bezier([x1, y1, x2, y2]: [number, number, number, number]) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (sampleX(t) - x) / d;
    }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}

const easeSoft = bezier(EASE_SOFT);

/* Рамка под связку. LngLatBounds — это ЛЕВЫЙ ВЕРХНИЙ и ПРАВЫЙ НИЖНИЙ
   углы, то есть [[запад, север], [восток, юг]], а не привычная пара
   юго-запад / северо-восток. Минимальный отступ держит короткие связки:
   без него кадр под 105-метровой линией до МЦД вырождался бы в улицу. */
const MIN_PAD_LON = 0.0042;
const MIN_PAD_LAT = 0.0023;

function boundsFor(target: LngLat): LngLatBounds {
  const padLon = Math.max(Math.abs(ICITY[0] - target[0]) * 0.4, MIN_PAD_LON);
  const padLat = Math.max(Math.abs(ICITY[1] - target[1]) * 0.4, MIN_PAD_LAT);
  return [
    [Math.min(ICITY[0], target[0]) - padLon, Math.max(ICITY[1], target[1]) + padLat],
    [Math.max(ICITY[0], target[0]) + padLon, Math.min(ICITY[1], target[1]) - padLat],
  ];
}

/* --- метки: обычный DOM, стили — из модуля секции ---------------------
   ymaps3 ставит на точку ЛЕВЫЙ ВЕРХНИЙ УГОЛ узла, а не его центр.
   Поэтому корень нулевого размера, а маркер и подпись висят на нём
   абсолютно — подробности в Location.module.css. */
function towerPin(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = styles.pinTower;
  const dot = document.createElement('span');
  dot.className = styles.pinDiamond;
  const text = document.createElement('span');
  text.className = styles.pinLabelRed;
  text.textContent = 'ICITY';
  wrap.append(dot, text);
  return wrap;
}

function targetPin(): { el: HTMLElement; text: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = styles.pinStation;
  const dot = document.createElement('span');
  dot.className = styles.pinCircle;
  const text = document.createElement('span');
  text.className = styles.pinLabel;
  wrap.append(dot, text);
  return { el: wrap, text };
}

type Props = {
  /** индекс выбранной строки таблицы; null — не выбрано ничего */
  active: number | null;
  /** зовётся, когда карта не поедет: нет ключа, отказ скрипта, отказ API */
  onFail: (reason: string) => void;
  /** зовётся один раз, когда карта отрисовалась */
  onReady: () => void;
};

/* --- загрузка скрипта: один тег на страницу, один промис --------------
   Отказ НЕ кэшируется. api-maps.yandex.ru отвечает не всегда — ловили
   живой ERR_CONNECTION_RESET на одной попытке из трёх. Оставь здесь
   отклонённый промис — и повтор по кнопке возвращал бы ту же ошибку
   до перезагрузки страницы. */
let loader: Promise<void> | null = null;

function loadApi(apikey: string): Promise<void> {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    if (window.ymaps3) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(apikey)}&lang=ru_RU`;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      el.remove(); /* мёртвый тег не должен мешать повтору */
      reject(new Error('ymaps3: скрипт не загрузился'));
    };
    document.head.appendChild(el);
  }).catch((e) => {
    loader = null;
    throw e;
  });
  return loader;
}

export default function YandexMap({ active, onFail, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  /* Колбэки в ref: пересоздавать карту из-за новой ссылки на функцию
     нельзя. Синхронизация в эффекте — писать в ref во время рендера
     React запрещает. */
  const fail = useRef(onFail);
  const ready = useRef(onReady);
  useEffect(() => {
    fail.current = onFail;
    ready.current = onReady;
  });

  /* Карта строится асинхронно: пока грузится скрипт и ждётся ymaps3.ready,
     mapRef пуст. Без этого флага эффект отрисовки связки отрабатывал бы
     на монтировании вхолостую и больше не перезапускался — active-то
     не менялся, и первая связка не появлялась вовсе. */
  const [built, setBuilt] = useState(false);
  const mapRef = useRef<YMap | null>(null);
  const routeRef = useRef<YMapFeature | null>(null);
  const targetRef = useRef<YMapMarker | null>(null);
  const targetTextRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef(0);
  const reducedRef = useRef(false);
  /* Зритель тронул карту сам — автоподбор рамки больше не вмешивается */
  const takenOverRef = useRef(false);
  /* Первая отрисовка кадрируется без анимации: ехать неоткуда */
  const firstFrameRef = useRef(true);

  /* --- 1. монтирование карты: один раз на жизнь модуля ---------------- */
  useEffect(() => {
    const host = hostRef.current;
    const apikey = process.env.NEXT_PUBLIC_YANDEX_MAPS_KEY;
    if (!host) return;
    if (!apikey) {
      fail.current('нет NEXT_PUBLIC_YANDEX_MAPS_KEY');
      return;
    }

    let alive = true;

    loadApi(apikey)
      .then(async () => {
        const ymaps3 = window.ymaps3;
        if (!alive || !ymaps3) return;
        await ymaps3.ready;
        if (!alive) return;

        const {
          YMap,
          YMapDefaultSchemeLayer,
          YMapDefaultFeaturesLayer,
          YMapFeature,
          YMapMarker,
          YMapListener,
        } = ymaps3;

        reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        /* Одним пальцем на телефоне прокручивают страницу, поэтому
           перетаскивание там выключено — карту двигают двумя пальцами.
           scrollZoom не включается ни при каких обстоятельствах. */
        const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const behaviors: BehaviorType[] = fine
          ? ['drag', 'pinchZoom', 'dblClick']
          : ['pinchZoom'];

        const map = new YMap(host, {
          location: { center: MAP_CENTER, zoom: MAP_ZOOM },
          behaviors,
          zoomRange: ZOOM_RANGE,
          theme: 'light',
          copyrightsPosition: 'bottom right',
        });
        mapRef.current = map;

        map.addChild(new YMapDefaultSchemeLayer({ customization: CUSTOMIZATION }));
        map.addChild(new YMapDefaultFeaturesLayer({}));

        /* Связка. Геометрия из двух одинаковых точек — это пустая линия;
           её наращивает эффект под active. */
        const route = new YMapFeature({
          geometry: { type: 'LineString', coordinates: [ICITY, ICITY] },
          style: { stroke: [{ color: FRIT, width: 2 }], zIndex: 10 },
        });
        map.addChild(route);
        routeRef.current = route;

        const { el, text } = targetPin();
        el.classList.add(styles.pinOff); /* в покое цели нет */
        targetTextRef.current = text;
        const target = new YMapMarker({ coordinates: ICITY, zIndex: 20 }, el);
        map.addChild(target);
        targetRef.current = target;

        map.addChild(new YMapMarker({ coordinates: ICITY, zIndex: 30 }, towerPin()));

        /* Любой жест зрителя навсегда отбирает камеру у автоподбора —
           до кнопки сброса. Иначе наведение на строку дёргало бы карту
           из-под руки того, кто её только что отмасштабировал. */
        map.addChild(
          new YMapListener({
            onActionStart: () => {
              takenOverRef.current = true;
            },
          })
        );

        setBuilt(true);
        ready.current();
      })
      .catch((e: unknown) => {
        if (alive) fail.current(e instanceof Error ? e.message : 'ymaps3: отказ');
      });

    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, []);

  /* --- 2. смена строки: перерисовать связку и подобрать рамку --------- */
  useEffect(() => {
    const map = mapRef.current;
    const route = routeRef.current;
    const target = targetRef.current;
    const text = targetTextRef.current;
    if (!map || !route || !target || !text) return;

    const leg = active === null ? null : LEGS[active];

    cancelAnimationFrame(rafRef.current);

    /* Ничего не выбрано: связка схлопывается в точку, метка прячется,
       камера возвращается к общему плану. Метку именно прячем классом,
       а не убираем из карты: пересоздавать маркер на каждый клик —
       лишняя работа и лишний мусор для сборщика. */
    if (!leg) {
      route.update({ geometry: { type: 'LineString', coordinates: [ICITY, ICITY] } });
      text.parentElement?.classList.add(styles.pinOff);
      if (!takenOverRef.current) {
        const duration = firstFrameRef.current || reducedRef.current ? 0 : FLY_MS;
        map.update({ location: { center: MAP_CENTER, zoom: MAP_ZOOM, duration, easing: 'ease-in-out' } });
      }
      firstFrameRef.current = false;
      return;
    }

    text.textContent = leg.pin;
    text.parentElement?.classList.remove(styles.pinOff);
    target.update({ coordinates: leg.point });

    /* Камера. Первый кадр ставится без анимации — ехать неоткуда;
       дальше плавно, и только пока зритель не взял карту в руки. */
    if (!takenOverRef.current) {
      const duration = firstFrameRef.current || reducedRef.current ? 0 : FLY_MS;
      map.update({ location: { bounds: boundsFor(leg.point), duration, easing: 'ease-in-out' } });
    }
    firstFrameRef.current = false;

    if (reducedRef.current) {
      route.update({ geometry: { type: 'LineString', coordinates: [ICITY, leg.point] } });
      return;
    }

    /* Прочерк: линия растёт от башни к цели. Через stroke-dashoffset,
       как было в SVG, не выйдет — у StrokeStyle в API есть dash,
       но нет dash-offset. */
    const started = performance.now();
    const tick = (now: number) => {
      const p = easeSoft(Math.min(1, (now - started) / DRAW_MS));
      const head: LngLat = [
        ICITY[0] + (leg.point[0] - ICITY[0]) * p,
        ICITY[1] + (leg.point[1] - ICITY[1]) * p,
      ];
      route.update({ geometry: { type: 'LineString', coordinates: [ICITY, head] } });
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [active, built]);

  /* --- 3. ручной зум ------------------------------------------------- */
  const nudge = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    takenOverRef.current = true;
    const zoom = Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, map.zoom + delta));
    map.update({ location: { center: map.center as LngLat, zoom, duration: 220, easing: 'ease-in-out' } });
  };

  const reset = () => {
    const map = mapRef.current;
    if (!map) return;
    takenOverRef.current = false;
    const leg = active === null ? null : LEGS[active];
    map.update(
      leg
        ? { location: { bounds: boundsFor(leg.point), duration: FLY_MS, easing: 'ease-in-out' } }
        : { location: { center: MAP_CENTER, zoom: MAP_ZOOM, duration: FLY_MS, easing: 'ease-in-out' } }
    );
  };

  return (
    <>
      <div ref={hostRef} className={styles.mapHost} />
      <div className={styles.zoom}>
        <button type="button" className={styles.zoomBtn} onClick={() => nudge(1)} aria-label="Приблизить карту">
          +
        </button>
        <button type="button" className={styles.zoomBtn} onClick={() => nudge(-1)} aria-label="Отдалить карту">
          −
        </button>
        <button type="button" className={styles.zoomBtn} onClick={reset} aria-label="Вернуть карту к маршруту">
          ⟲
        </button>
      </div>
    </>
  );
}
