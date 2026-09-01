'use client';

/* iCITY 113Н — плавная прокрутка страницы.
   Путь в проекте: components/SmoothScroll.tsx

   Колесо и трекпад ведут страницу через ту же огибающую, что и кольцо
   курсора: одна постоянная времени на двоих, SCROLL_TAU в lib/motion.ts.
   Страница под указателем обязана читаться одним с ним характером.

   ПРОКРУТКА ОСТАЁТСЯ НАСТОЯЩЕЙ. Модуль двигает window.scrollTo, а не
   везёт контент трансформом, как это делают Locomotive и его родня.
   Здесь второй способ запрещён физически: липкая сцена OfficeStop
   держится на нативном position: sticky, а кукольный дом — на
   position: fixed, и трансформированный предок убил бы обоих.

   ТРЕКПАД СЮДА НЕ ЗАХОДИТ. Сглаживается только дискретное колесо мыши —
   вход, который правда идёт рывками. У трекпада macOS инерция своя,
   системная и композиторная; поверх неё сглаживать нечего, а отнять оно
   может задержку, устойчивость к занятому главному потоку и главное —
   «поставил пальцы, страница встала». Тип ввода решается один раз
   на жест, см. looksLikeMouse ниже.

   ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО:
   — тач не трогаем вовсе. Мы просто не слушаем touch-события, поэтому
     на телефоне не меняется ничего, включая pull-to-refresh и уборку
     адресной строки. Инерция там своя, системная, и любая наша поверх
     неё читается как подтормаживание;
   — клавиатуру не перехватываем. Стрелки, PageDown и пробел листают
     нативно; свой обработчик клавиш отобрал бы их у полей формы;
   — scroll-behavior: smooth в CSS не появляется. Двухаргументный
     window.scrollTo(x, y) разрешается в auto, то есть в это самое
     свойство, и мгновенный переезд в шов из lib/officeZone.ts стал бы
     анимированным.

   Ре-рендеров React нет ни одного: компонент рисует null и живёт
   единственным эффектом. */

import { useEffect } from 'react';
import {
  SCROLL_TAU,
  SCROLL_LINE_PX,
  SCROLL_MIN_STEP_DPX,
  SCROLL_SYNC_PX,
  SCROLL_SMOOTH_TRACKPAD,
  SCROLL_GESTURE_GAP_MS,
  wheelLooksLikeMouse,
} from '@/lib/motion';

export default function SmoothScroll() {
  useEffect(() => {
    /* matchMedia спрашивается живьём, а не через React: на гидрации тот
       обязан вернуть серверный снимок «reduced-motion нет», и первый
       проход эффектов случился бы именно с ним. Та же причина, что
       у Cursor.tsx и startHeroPreload(). */
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /* Куда едем и где мы сейчас. Дробные: округляет их браузер сам,
       и округление возвращается к нам расхождением до половины пикселя —
       отсюда порог SCROLL_SYNC_PX ниже. */
    let target = window.scrollY;
    let cur = target;
    let raf = 0;
    let last = 0;

    /* Кэш «кто владеет колесом под этой целью». Колесо приходит десятками
       в секунду по одному и тому же узлу, а обход предков с
       getComputedStyle стоит заметно — считаем его только при смене цели.
       Тот же приём, что с `over` в Cursor.tsx. */
    let cacheNode: EventTarget | null = null;
    let cacheOwner: Element | null = null;

    /* Тип ввода текущего жеста и время последнего его события. */
    let gestureIsMouse = false;
    let lastWheelAt = -Infinity;

    const maxScroll = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    /* Ближайший предок со своей вертикальной прокруткой. Если такой есть
       и ему ещё есть куда ехать — колесо его, мы не вмешиваемся. Сейчас
       таких областей на сайте две (лист чертежа и ряд зон на телефоне),
       и обе живут внутри оверлеев, которые и так запирают страницу, —
       так что обход тут страховка на будущее, а не рабочая ветка. */
    const ownerOf = (from: EventTarget | null): Element | null => {
      let el = from instanceof Element ? from : null;
      const stop = document.body;
      while (el && el !== stop && el !== document.documentElement) {
        if (el.scrollHeight > el.clientHeight) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll') return el;
        }
        el = el.parentElement;
      }
      return null;
    };

    const draw = (t: number) => {
      /* Шаг от РЕАЛЬНОГО dt, а не «столько-то за кадр»: доля за кадр —
         скрытая привязка к 60 Гц. Потолок 100 мс — на возврат из фоновой
         вкладки, где dt в секунды: страница просто оказывается в цели,
         а не пролетает её. */
      const dt = Math.min(t - last, 100);
      last = t;

      const gap = target - cur;
      /* Пол шага в один физический пиксель: ниже него движения не видно,
         и экспонента вырождается в тик через несколько кадров. */
      const floor = SCROLL_MIN_STEP_DPX / (window.devicePixelRatio || 1);
      const done = Math.abs(gap) <= floor;

      if (done) {
        cur = target;
      } else {
        const step = gap * (1 - Math.exp(-dt / SCROLL_TAU));
        cur += Math.abs(step) < floor ? Math.sign(gap) * floor : step;
      }

      window.scrollTo(0, cur);
      raf = done ? 0 : requestAnimationFrame(draw);
    };

    /* Цикл живёт, только пока страница едет.

       last СТАВИТСЯ ЗДЕСЬ, а не обнуляется. Прежде первый кадр после сна
       считал dt по умолчанию 16,7 мс — и на 120-герцевом экране, где
       кадр 8,3, начинал КАЖДЫЙ жест двойным шагом. Замер: щелчок в 100 px
       из покоя двигал страницу на 9,5 px вместо 4,8. Отсчёт от момента
       пробуждения даёт настоящие несколько миллисекунд до первого кадра. */
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(draw);
    };

    const sleep = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onWheel = (e: WheelEvent) => {
      /* Ctrl+колесо — щипковый зум браузера, не прокрутка. */
      if (e.ctrlKey || e.defaultPrevented || e.deltaY === 0) return;

      /* Новый жест — заново решаем, чем скроллят. Внутри жеста решение
         не пересматривается ни разу: половина жеста нативно, половина
         через сглаживание — это два привода, дерущиеся за одну
         страницу. */
      const now = e.timeStamp;
      if (now - lastWheelAt > SCROLL_GESTURE_GAP_MS) gestureIsMouse = wheelLooksLikeMouse(e);
      lastWheelAt = now;
      if (!gestureIsMouse && !SCROLL_SMOOTH_TRACKPAD) return;

      /* Страница заперта — и на первом экране (HeroGate), и под обоими
         оверлеями (Contact). Оба ставят инлайновый overflow на body,
         поэтому замок читается отсюда даром, без раскладки и без единой
         правки в чужих файлах. */
      if (document.body.style.overflow === 'hidden') return;

      if (e.target !== cacheNode) {
        cacheNode = e.target;
        cacheOwner = ownerOf(e.target);
      }
      if (cacheOwner) {
        const el = cacheOwner;
        const room = e.deltaY > 0
          ? el.scrollTop < el.scrollHeight - el.clientHeight - 1
          : el.scrollTop > 1;
        if (room) return;
      }

      const max = maxScroll();
      if (max <= 0) return;

      e.preventDefault();

      /* deltaMode: 0 — пиксели (трекпад и почти все мыши), 1 — строки
         (Firefox, часть мышей под Windows), 2 — страницы. */
      const px = e.deltaMode === 1
        ? e.deltaY * SCROLL_LINE_PX
        : e.deltaMode === 2
          ? e.deltaY * window.innerHeight
          : e.deltaY;

      target = Math.min(max, Math.max(0, target + px));
      wake();
    };

    /* ОДНА ПРОВЕРКА, КОТОРАЯ ЗАКРЫВАЕТ ВСЮ ОСТАЛЬНУЮ ИНТЕГРАЦИЮ.
       Расхождение больше порога — значит страницу двинули не мы:
       полоса прокрутки, клавиатура, программный scrollTo из HeroGate
       и из подвала, прокрутка от focus(). Приравниваем цель к
       фактическому положению и гасим цикл — иначе он утащил бы
       страницу обратно, туда, куда ехал до чужого вмешательства. */
    const onScroll = () => {
      if (Math.abs(window.scrollY - cur) <= SCROLL_SYNC_PX) return;
      target = window.scrollY;
      cur = target;
      sleep();
    };

    /* Смена размеров меняет и максимум прокрутки, и высоту секций.
       Дешевле встать там, где стоим, чем пересчитывать цель. */
    const onResize = () => {
      target = window.scrollY;
      cur = target;
      cacheNode = null;
      cacheOwner = null;
      sleep();
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      sleep();
    };
  }, []);

  return null;
}
