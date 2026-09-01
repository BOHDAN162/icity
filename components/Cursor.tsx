'use client';

/* iCITY 113Н — свой курсор.
   Путь в проекте: components/Cursor.tsx

   Красная точка и тонкое кольцо вокруг неё вместо системной стрелки.
   Над любой кнопкой кольцо плавно садится на точку и растворяется —
   остаётся одна точка. Амплитуды и постоянные времени — в lib/motion.ts,
   рядом с остальным движением, отвечающим на зрителя.

   ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ. Хвоста из копий, следа, частиц и лишних
   слоёв: запрет на «блобы за курсором» из AGENTS.md остаётся в силе.
   Элементов ровно два, и второй нужен затем, чтобы отставать.

   Ре-рендеров React на кадрах нет: позиция пишется прямо в узел,
   как --p в OfficeStop и как текст числа в countUp. Состояние
   компонента не меняется ни разу за всё время жизни страницы. */

import { useEffect, useRef } from 'react';
import {
  CURSOR_DOT_TAU,
  CURSOR_RING_TAU,
  CURSOR_HOT_TAU,
  CURSOR_HOT_SCALE,
} from '@/lib/motion';
import styles from './Cursor.module.css';

/* Что считается кнопкой. Список именно такой, а не «[tabindex]»:
   у зон плоского плана tabIndex стоит и на неживых полигонах, а вот
   role="button" — только на тех, по которым есть куда перейти.
   Отключённые кнопки и поля не в счёт — на них и наводиться незачем.
   [data-cursor="hot"] — щель для целей, которых нет в DOM
   (зоны внутри canvas): вешается на сам холст, когда луч попал в зону. */
const HOT_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  '[role="button"]',
  '[role="link"]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'summary',
  'label[for]',
  '[data-cursor="hot"]',
].join(',');

/* Класс на <html>, снимающий системный курсор. Литерал, а не styles.*:
   элемент <html> не принадлежит ни одному модулю. Пара к :global()
   в Cursor.module.css — правишь имя здесь, правь и там. */
const HIDE_NATIVE = 'cursor-off';

/* Разметка могла смениться под неподвижным указателем: закрылся оверлей,
   схлопнулся пункт FAQ. Ждём коммита React, потом пересматриваем, что
   под курсором. 100 мс — с запасом на любой из наших переходов. */
const RESAMPLE_MS = 100;
/* Прокрутка возит кнопки под стоящим курсором. Опрашивать точку на каждом
   тике прокрутки нельзя — elementFromPoint форсирует раскладку, а на
   странице и без того один слушатель скролла на компонент. */
const SCROLL_SETTLE_MS = 120;

export default function Cursor() {
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!root || !ring || !dot) return;

    /* matchMedia спрашивается ЖИВЬЁМ, а не через useSyncExternalStore.
       Тот на гидрации обязан вернуть серверный снимок — «мышь есть,
       reduced-motion нет», — и первый проход эффектов случился бы
       именно с ним: на телефоне системный курсор снимать нечему,
       а при reduced-motion его нельзя снимать вовсе. Та же причина,
       по которой startHeroPreload() спрашивает медиазапросы сам. */
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const html = document.documentElement;
    html.classList.add(HIDE_NATIVE);

    /* цель — настоящий указатель */
    let tx = 0;
    let ty = 0;
    /* точка и кольцо: две координаты, два сглаживания */
    let dx = 0;
    let dy = 0;
    let rx = 0;
    let ry = 0;
    /* 0 — кольцо раскрыто, 1 — село на точку и растворилось */
    let hot = 0;
    let tgtHot = 0;

    let placed = false;
    let raf = 0;
    let last = 0;
    let over: EventTarget | null = null;
    let settle = 0;

    const isHot = (t: EventTarget | null) =>
      t instanceof Element && t.closest(HOT_SELECTOR) !== null;

    const draw = (t: number) => {
      /* Шаг сглаживания считается от РЕАЛЬНОГО dt, а не «столько-то
         за кадр»: доля за кадр — скрытая привязка к 60 Гц, и на
         120-герцевом экране слежение вышло бы вдвое резче. Потолок
         в 100 мс — на возврат из фоновой вкладки: там dt в секунды,
         k вырождается в единицу, и курсор просто оказывается там,
         где указатель, без полёта через весь экран. */
      const dt = last ? Math.min(t - last, 100) : 16.7;
      last = t;
      const kd = 1 - Math.exp(-dt / CURSOR_DOT_TAU);
      const kr = 1 - Math.exp(-dt / CURSOR_RING_TAU);
      const kh = 1 - Math.exp(-dt / CURSOR_HOT_TAU);

      dx += (tx - dx) * kd;
      dy += (ty - dy) * kd;
      rx += (tx - rx) * kr;
      ry += (ty - ry) * kr;
      hot += (tgtHot - hot) * kh;

      const alive =
        Math.abs(tx - dx) > 0.05 ||
        Math.abs(ty - dy) > 0.05 ||
        Math.abs(tx - rx) > 0.05 ||
        Math.abs(ty - ry) > 0.05 ||
        Math.abs(tgtHot - hot) > 0.002;

      /* Последний кадр приезжает в точное значение. Иначе цикл
         останавливался бы на остатке: кольцо над кнопкой доживало бы
         с непрозрачностью 0,002 и масштабом чуть больше нужного. */
      if (!alive) {
        dx = tx; dy = ty;
        rx = tx; ry = ty;
        hot = tgtHot;
      }

      dot.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      ring.style.transform =
        `translate3d(${rx}px, ${ry}px, 0) scale(${1 - (1 - CURSOR_HOT_SCALE) * hot})`;
      ring.style.opacity = `${1 - hot}`;

      raf = alive ? requestAnimationFrame(draw) : 0;
    };

    /* Цикл живёт только пока что-то едет. Курсор стоит на месте
       большую часть времени, и держать под него постоянный rAF —
       это кадр в кадр на пустом месте, включая ноутбук на батарее. */
    const wake = () => {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(draw);
    };

    const aim = (t: EventTarget | null) => {
      over = t;
      const next = isHot(t) ? 1 : 0;
      if (next !== tgtHot) {
        tgtHot = next;
        wake();
      }
    };

    /* Пересмотр цели без движения указателя: под ним могла смениться
       разметка. elementFromPoint читает то же, что дало бы событие. */
    const resample = () => {
      if (!placed) return;
      aim(document.elementFromPoint(tx, ty));
    };

    const move = (e: PointerEvent) => {
      /* Гибридный ноутбук: медиазапрос выше пропустил его как «мышь
         есть», но касание к своему курсору отношения не имеет. */
      if (e.pointerType !== 'mouse') return;

      tx = e.clientX;
      ty = e.clientY;

      if (!placed) {
        /* Первое появление — сразу в точке указателя, без полёта
           из левого верхнего угла. Тот же приём после возврата
           в окно: hide() сбрасывает флаг, и курсор проявляется
           там, где вернулся, а не летит через весь экран. */
        placed = true;
        dx = rx = tx;
        dy = ry = ty;
        root.classList.add(styles.on);
      }

      /* closest() на КАЖДОМ движении — лишняя работа: цель меняется
         на порядок реже, чем приходит pointermove. */
      if (e.target !== over) aim(e.target);

      wake();
    };

    const hide = () => {
      root.classList.remove(styles.on);
      placed = false;
    };

    const onUp = () => {
      clearTimeout(settle);
      settle = window.setTimeout(resample, RESAMPLE_MS);
    };

    const onScroll = () => {
      clearTimeout(settle);
      settle = window.setTimeout(resample, SCROLL_SETTLE_MS);
    };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('blur', hide);
    document.addEventListener('pointerleave', hide);
    /* capture: прокрутка внутренних областей (лист чертежа, оверлеи)
       до window не всплывает. */
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', hide);
      document.removeEventListener('pointerleave', hide);
      document.removeEventListener('scroll', onScroll, { capture: true });
      clearTimeout(settle);
      if (raf) cancelAnimationFrame(raf);
      html.classList.remove(HIDE_NATIVE);
    };
  }, []);

  /* Разметка одинаковая на сервере и на клиенте и ничего не стоит
     без класса .on: три пустых узла, непрозрачность ноль. Решение
     «работать или не работать» принимает эффект — так гидрация
     не зависит от медиазапросов. */
  return (
    <div ref={rootRef} className={styles.root} aria-hidden="true">
      <div ref={ringRef} className={styles.ring} />
      <div ref={dotRef} className={styles.dot} />
    </div>
  );
}
