/* iCITY 113Н — карта локации на Яндекс JS API v3.
   Путь в проекте: components/YandexMap.tsx

   Монохромная схема Яндекса вместо прежнего рисованного SVG. Модуль
   грузится только через dynamic(..., { ssr: false }) из Location.tsx
   и только когда секция подошла к экрану: скрипт api-maps.yandex.ru
   весит порядка 250 КБ и в бюджет первого экрана не входит и входить
   не должен — то же правило, что у чанка three.js под кукольный дом.

   КЛЮЧ. NEXT_PUBLIC_YANDEX_MAPS_KEY, берётся в Кабинете разработчика
   Яндекса. Без ключа модуль ничего не рисует и сообщает об этом
   вызывающему через onFail — рамка тогда показывает адрес и ссылку
   на Яндекс Карты, а не пустоту.

   ЦВЕТА ЗДЕСЬ ХЕКСАМИ, И ЭТО ВЫНУЖДЕННО. Кастомизация тайлов уезжает
   в WebGL Яндекса, CSS-переменные туда не доходят. Каждое значение
   ниже — копия токена из app/tokens.css, и правится парой: сначала
   токен, потом эта таблица. Это тот же компромисс, что у --hold-*,
   продублированных в TowerSequence.tsx.

   ЧТО ВЫКЛЮЧЕНО. Весь слой poi — иначе поверх схемы стоят «Пятёрочка»,
   «Бэби-клуб» и «HookahPlace», и кадр перестаёт быть кадром о башне.
   Подписи транспорта тоже: свои станции мы подписываем сами. Оставлены
   только названия улиц и районов — ровно то, что несла рисованная схема.

   ЖЕСТЫ. behaviors: [] — карта не таскается, не зумится и не ловит
   прокрутку страницы. Это осознанно: AGENTS.md запрещает интерактивную
   карту проезда, и перехват скролла на середине лендинга был бы худшим
   из возможных решений. Карта здесь — живая подложка, а не инструмент.

   САМОПРОЧЕРК. Три красные связки «станция → башня» и «башня → ТТК»
   рисуют себя, наращивая геометрию линии от начала к концу за 450 мс
   с шагом 180 мс. Через stroke-dashoffset, как было в SVG, не выйдет:
   у StrokeStyle в API есть dash, но нет dash-offset. При запросе покоя
   линии стоят готовыми с первого кадра. */

'use client';

import { useEffect, useRef } from 'react';
import type { YMap, YMapFeature, YMapMarker } from '@yandex/ymaps3-types';
import type { Customization, LngLat } from '@yandex/ymaps3-types';
import { ICITY, MCD, SHELEPIKHA, TTK, MAP_CENTER, MAP_ZOOM } from '@/lib/geo';
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
  /* Свои станции подписываем сами, чужие подписи транспорта не нужны. */
  { tags: { any: ['transit_location', 'transit_stop', 'transit_entrance'] }, elements: 'label', stylers: [{ visibility: 'off' }] },

  /* Номера домов — вон. На кадре про башню «9с4», «34с10» и «13соор1»
     читаются мусором и спорят с нашими подписями. */
  { tags: { all: ['address'] }, elements: 'label', stylers: [{ visibility: 'off' }] },

  /* Остаются названия улиц и районов — ровно то, что несла схема. */
  { tags: { any: ['road', 'admin'] }, elements: 'label.text.fill', stylers: [{ color: INK_60 }] },
  { tags: { any: ['road', 'admin'] }, elements: 'label.text.outline', stylers: [{ color: WHITE }] },
  { tags: { any: ['road', 'admin'] }, elements: 'label.icon', stylers: [{ visibility: 'off' }] },
];

/* --- связки: порядок в массиве = порядок каскада ---------------------- */
const LINKS: { from: LngLat; to: LngLat; label: string }[] = [
  { from: MCD, to: ICITY, label: 'от МЦД к башне' },
  { from: SHELEPIKHA, to: ICITY, label: 'от Шелепихи к башне' },
  { from: ICITY, to: TTK, label: 'от башни к ТТК' },
];

const DRAW_MS = 450;
const DRAW_STAGGER = 180;

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

/* --- загрузка скрипта: один тег на страницу, один промис -------------- */
let loader: Promise<void> | null = null;

function loadApi(apikey: string): Promise<void> {
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (window.ymaps3) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(apikey)}&lang=ru_RU`;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('ymaps3: скрипт не загрузился'));
    document.head.appendChild(el);
  });
  return loader;
}

/* --- метки: обычный DOM, стили — из модуля секции --------------------- */
function towerPin(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = styles.pinTower;
  const dot = document.createElement('span');
  dot.className = styles.pinDiamond;
  const text = document.createElement('span');
  text.className = styles.pinLabelRed;
  text.textContent = 'SPACE TOWER · 113Н';
  wrap.append(dot, text);
  return wrap;
}

function stationPin(label: string, flip = false): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `${styles.pinStation}${flip ? ` ${styles.pinFlip}` : ''}`;
  const dot = document.createElement('span');
  dot.className = styles.pinCircle;
  const text = document.createElement('span');
  text.className = styles.pinLabel;
  text.textContent = label;
  wrap.append(dot, text);
  return wrap;
}

type Props = {
  /** зовётся, когда карта не поедет: нет ключа, отказ скрипта, отказ API */
  onFail: (reason: string) => void;
  /** зовётся один раз, когда карта отрисовалась */
  onReady: () => void;
};

export default function YandexMap({ onFail, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  /* Колбэки в ref: пересоздавать карту из-за новой ссылки на функцию
     нельзя, а класть их в зависимости эффекта пришлось бы. */
  const fail = useRef(onFail);
  const ready = useRef(onReady);
  /* Синхронизация — в эффекте, а не в теле: писать в ref во время
     рендера React запрещает, и правило react-hooks/refs это ловит.
     Эффект объявлен выше основного, поэтому к монтированию карты
     ссылки уже свежие. */
  useEffect(() => {
    fail.current = onFail;
    ready.current = onReady;
  });

  useEffect(() => {
    const host = hostRef.current;
    const apikey = process.env.NEXT_PUBLIC_YANDEX_MAPS_KEY;
    if (!host) return;
    if (!apikey) {
      fail.current('нет NEXT_PUBLIC_YANDEX_MAPS_KEY');
      return;
    }

    let alive = true;
    let map: YMap | null = null;
    let raf = 0;

    loadApi(apikey)
      .then(async () => {
        const ymaps3 = window.ymaps3;
        if (!alive || !ymaps3) return;
        await ymaps3.ready;
        if (!alive) return;

        const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapFeature, YMapMarker } = ymaps3;

        map = new YMap(host, {
          location: { center: MAP_CENTER, zoom: MAP_ZOOM },
          /* Ни одного жеста: карта не перехватывает прокрутку страницы */
          behaviors: [],
          theme: 'light',
          copyrightsPosition: 'bottom right',
        });

        map.addChild(new YMapDefaultSchemeLayer({ customization: CUSTOMIZATION }));
        map.addChild(new YMapDefaultFeaturesLayer({}));

        /* Связки. В покое — сразу целиком, иначе растут из начала. */
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const features: YMapFeature[] = LINKS.map((link) => {
          const feature = new YMapFeature({
            geometry: {
              type: 'LineString',
              coordinates: reduced ? [link.from, link.to] : [link.from, link.from],
            },
            style: { stroke: [{ color: FRIT, width: 2 }], zIndex: 10 },
            properties: { label: link.label },
          });
          map!.addChild(feature);
          return feature;
        });

        /* Метки поверх связок. */
        const markers: YMapMarker[] = [
          new YMapMarker({ coordinates: ICITY, zIndex: 30 }, towerPin()),
          /* Своё имя станции короткое: «Москва-Сити» карта подписывает
             сама, а 254 px подписи упирались в правый край кадра. */
          new YMapMarker({ coordinates: MCD, zIndex: 20 }, stationPin('ТЕСТОВСКАЯ · 1 МИН')),
          new YMapMarker({ coordinates: SHELEPIKHA, zIndex: 20 }, stationPin('ШЕЛЕПИХА · 5 МИН')),
        ];
        markers.forEach((m) => map!.addChild(m));

        ready.current();

        if (reduced) return;

        /* Прочерк. Один rAF на все три линии: три отдельных цикла
           дали бы три независимых кадра и рваный каскад. */
        const total = DRAW_MS + DRAW_STAGGER * (LINKS.length - 1);
        const started = performance.now();
        const tick = (now: number) => {
          if (!alive) return;
          const elapsed = now - started;
          LINKS.forEach((link, i) => {
            const local = (elapsed - i * DRAW_STAGGER) / DRAW_MS;
            const p = easeSoft(Math.min(1, Math.max(0, local)));
            const head: LngLat = [
              link.from[0] + (link.to[0] - link.from[0]) * p,
              link.from[1] + (link.to[1] - link.from[1]) * p,
            ];
            features[i].update({
              geometry: { type: 'LineString', coordinates: [link.from, head] },
            });
          });
          if (elapsed < total) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch((e: unknown) => {
        if (alive) fail.current(e instanceof Error ? e.message : 'ymaps3: отказ');
      });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      map?.destroy();
    };
  }, []);

  return <div ref={hostRef} className={styles.mapHost} />;
}
