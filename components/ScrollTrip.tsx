'use client';

/* iCITY 113Н — поездка к якорю по кнопке.
   Путь в проекте: components/ScrollTrip.tsx

   ЧТО ЭТО. Единственный оставшийся на сайте программный ход страницы:
   «Записаться на просмотр» довозит зрителя до формы за время, а не
   мгновенным прыжком по хэшу. Больше ничего этот модуль не делает.

   ПОЧЕМУ ЗДЕСЬ БОЛЬШЕ НЕТ ПЛАВНОЙ ПРОКРУТКИ. Прежде на этом месте жил
   SmoothScroll: он перехватывал колесо, гасил событие и вёл страницу
   сам — экспонентой, со своим коэффициентом. Затея снята 4 сентября
   2026 после четырёх заходов и живого просмотра на MacBook, и вот
   почему её не надо заводить снова.

   Чтобы вести прокрутку самим, нужен `wheel` с `passive: false` и
   `preventDefault`. Одного этого достаточно, чтобы прокрутка съехала
   с композитора на главный поток: браузер обязан дождаться JS, прежде
   чем сдвинуть страницу. Пока она шла композитором, её не касался
   ни один дорогой кадр; на главном потоке каждый такой кадр
   становится рывком.

   Проверено сравнением на одной странице и одном жесте: с нашим
   приводом заказчик видел подёргивание, с выключенным — ни разу.
   При этом счётчик кадров показывал 120 Гц и НОЛЬ срывов в обоих
   случаях. То есть дело не в стоимости кадра — её мы к тому моменту
   уже сократили втрое, — а в том, что системная прокрутка macOS
   приколочена к развёртке экрана, а наша ложится на кадры чуть иначе
   каждый раз. Догнать её с главного потока нечем.

   Отсюда правило: КОЛЕСО И ТРЕКПАД НЕ ПЕРЕХВАТЫВАТЬ. Захочется
   «киношной» прокрутки снова — делать её не приводом, а содержимым:
   секции, которые отвечают на прокрутку, читаются как плавность и не
   могут дёргаться, потому что считаются композитором.

   ВСЕ СЛУШАТЕЛИ ЗДЕСЬ ПАССИВНЫЕ, и это несущее требование, а не
   аккуратность. Непассивный слушатель колеса вернул бы ровно ту
   беду, ради ухода от которой всё и переписано. */

import { useEffect } from 'react';
import {
  SCROLL_TRIP_MS_PER_1000PX,
  SCROLL_TRIP_MIN_MS,
  SCROLL_TRIP_MAX_MS,
  EASE_VIEW,
  bezier,
  onScrollRequest,
} from '@/lib/motion';

/* Та же --ease-view, что у выездов кадров вида и у счёта чисел:
   симметричная, с мягким началом и мягким концом. */
const easeTrip = bezier(EASE_VIEW);

/* Клавиши, которыми листают страницу: любая из них посреди поездки
   означает, что зритель забрал управление. */
const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
]);

export default function ScrollTrip() {
  useEffect(() => {
    /* matchMedia спрашивается живьём, а не через React: на гидрации тот
       обязан вернуть серверный снимок «reduced-motion нет», и первый
       проход эффектов случился бы именно с ним. Та же причина, что
       у Cursor.tsx и startHeroPreload(). */
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let raf = 0;
    let trip: { from: number; to: number; t0: number; dur: number } | null = null;

    const maxScroll = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    const stop = () => {
      trip = null;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const draw = (t: number) => {
      if (!trip) {
        raf = 0;
        return;
      }
      /* Страницу могли запереть посреди поездки — оверлеем из подвала
         или шаговым переходом офиса. Под замком window.scrollTo не
         двигает ничего, и поездку честнее прекратить. */
      if (document.body.style.overflow === 'hidden') {
        stop();
        return;
      }

      /* ЦЕЛЬ СНИМАЕТСЯ КАЖДЫЙ КАДР, А НЕ В МОМЕНТ КЛИКА. По дороге вниз
         страница растёт: кадр комплекса монтируется по
         IntersectionObserver, ниже подъезжают картинки. Цель, снятая
         на клике, оказалась бы выше настоящего низа — и поездка
         заканчивалась бы посреди страницы. */
      const raw = (t - trip.t0) / trip.dur;
      const goal = Math.min(maxScroll(), Math.max(0, trip.to));
      window.scrollTo(0, trip.from + (goal - trip.from) * easeTrip(Math.min(1, raw)));

      if (raw >= 1) {
        stop();
        return;
      }
      raf = requestAnimationFrame(draw);
    };

    const offScrollRequest = onScrollRequest((to: number): boolean => {
      if (document.body.style.overflow === 'hidden') return false;
      const from = window.scrollY;
      const goal = Math.min(maxScroll(), Math.max(0, to));
      /* Ехать некуда — отказываемся, и вызывающий уходит штатным
         прыжком по якорю вместо того, чтобы не сделать ничего. */
      if (Math.abs(goal - from) < 2) return false;

      const dur = Math.min(
        SCROLL_TRIP_MAX_MS,
        Math.max(SCROLL_TRIP_MIN_MS, (Math.abs(goal - from) / 1000) * SCROLL_TRIP_MS_PER_1000PX),
      );
      trip = { from, to, t0: performance.now(), dur };
      if (!raf) raf = requestAnimationFrame(draw);
      return true;
    });

    /* ЗРИТЕЛЬ ВСЕГДА СИЛЬНЕЕ ПОЕЗДКИ. Колесо, палец или листающая
       клавиша посреди пути отдают страницу там, где она сейчас.
       Чужой scrollTo поездку НЕ отменяет: так выглядит якорь браузера
       при сдвиге раскладки, и это не жест. */
    const onWheel = () => stop();
    const onPointerDown = () => stop();
    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) stop();
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onWheel, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKeyDown, { passive: true });

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onWheel);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      offScrollRequest();
      stop();
    };
  }, []);

  return null;
}
