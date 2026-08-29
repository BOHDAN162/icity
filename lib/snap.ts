/* iCITY 113Н — доводка занавесов.
   Путь в проекте: lib/snap.ts

   ЗАЧЕМ. Ни одно состояние покоя не должно показывать два экрана сразу.
   Полбашни над полуофисом — законный кадр в середине движения и незаконное
   место, где человек останавливается и читает. Занавес обязан довестись
   до конца или вернуться назад, третьего положения нет.

   ГДЕ. Только на двух границах: башня → офис и офис → кадр вида. Скраб
   секвенции и растровый шов листаются свободно. Глобальный CSS
   scroll-snap здесь запрещён: он превратил бы 240-кадровый скраб
   в череду прыжков.

   ГЛАВНАЯ ЛОВУШКА — ИНЕРЦИЯ. Доводка запускается не по событию прокрутки,
   а по «ввод прекратился»: таймер на IDLE_MS, который перезапускает каждый
   wheel, touchmove и keydown. Трекпад macOS продолжает слать события ещё
   до полусекунды после того, как пальцы ушли с панели, и доводка по сырому
   событию дерётся с инерцией — экран трясёт.

   Одного таймера мало: на iOS инерционная прокрутка не шлёт touchmove
   вообще, только scroll. Поэтому на срабатывании таймера сверяем положение
   с тем, каким оно было при взводе: уехало — страница ещё катится, взводим
   заново. Ждём ровно столько, сколько реально едет, и ни кадром больше. */

/** сколько тишины во вводе считаем концом жеста, мс */
export const SNAP_IDLE_MS = 90;

/** длительность доводки, мс */
export const SNAP_MS = 520;

/** доля границы, за которой занавес доводится, а не откатывается */
export const SNAP_THRESHOLD = 0.20;

/* На телефоне порог выше: обычный свайп пальцем длиннее щелчка колеса
   в разы, и на 20 % телефон проскакивал бы целые экраны по неосторожности. */
export const SNAP_THRESHOLD_TOUCH = 0.35;
export const SNAP_TOUCH_MAX_WIDTH = 640;

/* Дальше какого расхождения считаем, что прокрутку двигаем не мы.
   Два пикселя — запас на дробный scrollY при дробном DPR. */
const FOREIGN_PX = 2;

/** Граница в документных координатах: от какого y до какого идёт занавес. */
export type SnapRange = { id: string; from: number; to: number };

export type SnapController = { destroy: () => void };

/* --ease-out из tokens.css, cubic-bezier(0.16, 1, 0.30, 1).
   scroll-behavior: smooth не годится: его нельзя чисто прервать
   и он игнорирует нашу кривую. */
const cubicBezier = (p1x: number, p1y: number, p2x: number, p2y: number) => {
  const a = (u: number, v: number) => 1 - 3 * v + 3 * u;
  const b = (u: number, v: number) => 3 * v - 6 * u;
  const c = (u: number) => 3 * u;
  const calc = (t: number, u: number, v: number) =>
    ((a(u, v) * t + b(u, v)) * t + c(u)) * t;
  const slope = (t: number, u: number, v: number) =>
    3 * a(u, v) * t * t + 2 * b(u, v) * t + c(u);

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const s = slope(t, p1x, p2x);
      if (s === 0) break;
      t -= (calc(t, p1x, p2x) - x) / s;
    }
    return calc(t, p1y, p2y);
  };
};

const EASE = cubicBezier(0.16, 1, 0.3, 1);

/**
 * Вешает доводку на перечисленные границы.
 * `ranges` пересчитывается по требованию — вёрстка живая, а высоты в svh.
 */
export function createSnap(ranges: () => SnapRange[]): SnapController {
  /* У какого конца границы человек стоял в последний раз. Это и есть
     ответ на «в обе стороны»: порог отмеряется от того конца, откуда
     ушли, а не от начала диапазона. Уехал из офиса вверх на четверть
     занавеса — вернулся в офис; уехал на три четверти — приехал к башне. */
  const anchor = new Map<string, 0 | 1>();

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let armedAt = 0;

  let raf = 0;
  let animating = false;
  let lastSet = 0;

  const threshold = () =>
    window.innerWidth <= SNAP_TOUCH_MAX_WIDTH ? SNAP_THRESHOLD_TOUCH : SNAP_THRESHOLD;

  /* Якоря обновляются, пока человек ЗА пределами границы. Внутри неё
     трогать их нельзя — иначе доводка забудет, откуда начиналось.

     ДОПУСК ОБЯЗАТЕЛЕН, И ЭТО НЕ ПЕДАНТИЗМ. Конец границы считается
     из живой вёрстки и приходит дробным, scrollY после доводки садится
     на него же с точностью до долей пикселя. Со строгим сравнением
     `y >= r.to` якорь на самом конце не выставлялся: доводка думала,
     что человек всё ещё стоит у начала, и уход вверх из кадра вида
     доводил его обратно вниз вместо возврата в офис. Ровно тот случай,
     ради которого сказано «работает в обе стороны». */
  const trackAnchors = () => {
    const y = window.scrollY;
    for (const r of ranges()) {
      if (y <= r.from + FOREIGN_PX) anchor.set(r.id, 0);
      else if (y >= r.to - FOREIGN_PX) anchor.set(r.id, 1);
      else if (!anchor.has(r.id)) anchor.set(r.id, 0);
    }
  };

  /* Пока идём — гасим колесо и палец. Драг полосы прокрутки погасить
     нельзя, поэтому ниже, в onScroll, ещё и отменяем доводку, если
     пришло смещение, которого мы не делали. */
  const block = (e: Event) => e.preventDefault();

  /* Единственное место, где доводка заканчивается, — и по своей воле,
     и по отмене. Два выхода из одного состояния разъезжаются: слушатели
     остаются висеть, и колесо оказывается погашено навсегда. */
  const endAnim = () => {
    if (!animating) return;
    animating = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('wheel', block);
    window.removeEventListener('touchmove', block);
    trackAnchors();
  };

  const animateTo = (to: number) => {
    const from = window.scrollY;
    if (Math.abs(to - from) < 1) return;

    endAnim();
    animating = true;
    lastSet = from;

    window.addEventListener('wheel', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });

    const t0 = performance.now();
    const step = (now: number) => {
      if (!animating) return;
      raf = 0;
      const t = Math.min((now - t0) / SNAP_MS, 1);
      window.scrollTo(0, from + (to - from) * EASE(t));
      /* Читаем обратно: у краёв документа scrollTo зажимается, и хранить
         желаемое вместо фактического значило бы отменять доводку самим
         же расхождением. */
      lastSet = window.scrollY;
      if (t < 1) raf = requestAnimationFrame(step);
      else endAnim();
    };

    raf = requestAnimationFrame(step);
  };

  const decide = () => {
    const y = window.scrollY;
    for (const r of ranges()) {
      const span = r.to - r.from;
      if (span <= 0) continue;
      // тот же допуск: у самого конца доводить уже нечего
      if (y <= r.from + FOREIGN_PX || y >= r.to - FOREIGN_PX) continue;

      const frac = (y - r.from) / span;
      const from = anchor.get(r.id) ?? 0;
      // сколько прошли от того конца, у которого стояли
      const travelled = from === 0 ? frac : 1 - frac;
      const target = travelled > threshold()
        ? (from === 0 ? r.to : r.from)
        : (from === 0 ? r.from : r.to);
      animateTo(target);
      return;
    }
  };

  const evaluate = () => {
    idleTimer = null;
    /* Страница ещё катится по инерции — ждём. Именно здесь ловится
       трекпад macOS и инерционная прокрутка iOS, которая touchmove
       не шлёт вообще. */
    if (Math.abs(window.scrollY - armedAt) > FOREIGN_PX) { arm(); return; }
    decide();
  };

  function arm() {
    armedAt = window.scrollY;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(evaluate, SNAP_IDLE_MS);
  }

  const onInput = () => {
    // свой же жест доводку отменяет: человек передумал
    endAnim();
    arm();
  };

  /* Клавиатуру не гасим никогда: стрелка и PageDown должны листать
     страницу даже посреди доводки. Поэтому keydown её просто отменяет. */
  const onKey = () => onInput();

  const onScroll = () => {
    // прокрутку двигаем не мы — драг полосы, поиск по странице, якорь
    if (animating && Math.abs(window.scrollY - lastSet) > FOREIGN_PX) endAnim();
    if (!animating) trackAnchors();
  };

  window.addEventListener('wheel', onInput, { passive: true });
  window.addEventListener('touchmove', onInput, { passive: true });
  window.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, { passive: true });

  trackAnchors();

  return {
    destroy() {
      endAnim();
      if (idleTimer) clearTimeout(idleTimer);
      window.removeEventListener('wheel', onInput);
      window.removeEventListener('touchmove', onInput);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', block);
      window.removeEventListener('touchmove', block);
    },
  };
}
