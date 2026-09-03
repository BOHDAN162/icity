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

   ВТОРОЙ РЕЖИМ — ПОЕЗДКА ПО КНОПКЕ. «Записаться на просмотр» просит
   довезти до низа страницы, и это не «поставить колесу другую цель»:
   у поездки своя длительность, своя кривая и живая, пересчитываемая
   каждый кадр цель. Почему именно так — в шапке requestSmoothScrollTo
   в lib/motion.ts.

   ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО:
   — тач не трогаем вовсе. Мы просто не слушаем touch-события, поэтому
     на телефоне не меняется ничего, включая pull-to-refresh и уборку
     адресной строки. Инерция там своя, системная, и любая наша поверх
     неё читается как подтормаживание;
   — клавиатуру не перехватываем. Стрелки, PageDown и пробел листают
     нативно; свой обработчик клавиш отобрал бы их у полей формы.
     Пассивный keydown ниже ничего не отбирает: он только отменяет
     поездку, то есть отдаёт страницу зрителю;
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
  SCROLL_TRIP_MS_PER_1000PX,
  SCROLL_TRIP_MIN_MS,
  SCROLL_TRIP_MAX_MS,
  EASE_VIEW,
  bezier,
  wheelLooksLikeMouse,
  onScrollRequest,
} from '@/lib/motion';

/* Кривая поездки по кнопке. Та же --ease-view, что у выездов кадров
   вида и у счёта чисел: симметричная, с мягким началом и мягким концом.
   Считается один раз на модуль — таблица коэффициентов у неё
   неизменная. */
const easeTrip = bezier(EASE_VIEW);

/* Клавиши, которыми листают страницу: любая из них посреди поездки
   означает, что зритель забрал управление. */
const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
]);

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

    /* ПОЕЗДКА ПО КНОПКЕ — второй режим того же цикла, а не вторая цель
       колеса. Своя длительность, своя кривая и цель, которая
       пересчитывается каждый кадр (`to` может быть и бесконечностью —
       это «низ страницы»). Почему не экспонента колеса — в шапке
       requestSmoothScrollTo в lib/motion.ts. */
    let trip: { from: number; to: number; t0: number; dur: number } | null = null;

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
      /* ЗАМОК ПОСРЕДИ ХОДА. Страницу могли запереть, пока цикл жив:
         зритель листает вверх к секции офиса, та ставит свой замок
         на шаговый переход, — и с этого кадра window.scrollTo ниже
         не делает ничего. События scroll при этом тоже нет, значит
         onScroll не ресинхронизирует цель, и цикл досчитал бы до
         старого target вхолостую. Он бы даже уснул (пол шага), но
         cur и target остались бы в будущем, куда страница не доехала,
         и первое же колесо после снятия замка унесло бы её прыжком
         на весь недойденный остаток.

         Поэтому встаём там, где страницу застали. Это же чинит давний
         случай без шаговых переходов: открыть оверлей подвала и
         закрыть, ничего не выбрав, — единственный путь, где замок
         не сопровождается программным scrollTo. */
      if (document.body.style.overflow === 'hidden') {
        trip = null;
        target = window.scrollY;
        cur = target;
        raf = 0;
        return;
      }

      /* Поездка по кнопке. Идёт по времени, а не по остатку, поэтому
         не может ни выстрелить первым кадром, ни доползать хвостом.

         ЦЕЛЬ СНИМАЕТСЯ ЗДЕСЬ, А НЕ В МОМЕНТ КЛИКА. По дороге вниз
         страница растёт: кадр комплекса монтируется по
         IntersectionObserver, ниже подъезжают картинки. Цель, снятая
         на клике, оказалась бы выше настоящего низа — и поездка
         заканчивалась бы посреди страницы. */
      if (trip) {
        const raw = (t - trip.t0) / trip.dur;
        const done = raw >= 1;
        const goal = Math.min(maxScroll(), Math.max(0, trip.to));
        cur = trip.from + (goal - trip.from) * easeTrip(Math.min(1, raw));
        window.scrollTo(0, cur);
        /* Экспоненте колеса dt считается от предыдущего кадра, а кадры
           поездки для неё — сон: без этой строки первый щелчок после
           приезда взял бы dt за всю поездку. */
        last = t;
        if (done) {
          trip = null;
          target = cur;
          raf = 0;
          return;
        }
        raf = requestAnimationFrame(draw);
        return;
      }

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

    /* ЗРИТЕЛЬ ВСЕГДА СИЛЬНЕЕ ПОЕЗДКИ. Колесо, палец, полоса прокрутки
       или клавиша посреди пути — и мы отдаём страницу там, где она
       сейчас, а не доводим её до низа из-под руки. Ровно та беда,
       на которой обожглась автодоводка кадра вида (см. AGENTS.md,
       «Порядок экранов»): отбирать прокрутку у того, кто ей уже
       пользуется, нельзя. */
    const cancelTrip = () => {
      if (!trip) return;
      trip = null;
      target = window.scrollY;
      cur = target;
      sleep();
    };

    const onWheel = (e: WheelEvent) => {
      /* Ctrl+колесо — щипковый зум браузера, не прокрутка. */
      if (e.ctrlKey || e.defaultPrevented || e.deltaY === 0) return;

      /* Отменяется поездка ДО разбора типа ввода: трекпад уезжает
         нативно, ниже по коду его ветка выходит раньше — а забрать
         у него страницу надо всё равно. */
      cancelTrip();

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
      /* Пока идёт поездка, за рулём мы, и расхождение здесь — это не
         чужое вмешательство, а сдвиг раскладки под нами: секции ниже
         подгружают картинки, и браузер подправляет scrollY якорем.
         Прежде такое расхождение гасило цикл, и кнопка «Записаться»
         высаживала зрителя посреди страницы. Чужие жесты ловятся
         не здесь, а своими событиями — см. cancelTrip. */
      if (trip) return;
      if (Math.abs(window.scrollY - cur) <= SCROLL_SYNC_PX) return;
      target = window.scrollY;
      cur = target;
      sleep();
    };

    /* Смена размеров меняет и максимум прокрутки, и высоту секций.
       Дешевле встать там, где стоим, чем пересчитывать цель. */
    const onResize = () => {
      cacheNode = null;
      cacheOwner = null;
      /* Поездку смена размеров не рвёт: цель у неё живая и снимается
         каждый кадр. Иначе на телефоне её убивала бы уборка адресной
         строки — та самая, из-за которой высота hero считается в dvh. */
      if (trip) return;
      target = window.scrollY;
      cur = target;
      cacheNode = null;
      cacheOwner = null;
      sleep();
    };

    /* «Записаться на просмотр» и любая другая кнопка-якорь просят
       доехать сюда плавной поездкой вместо мгновенного браузерного
       прыжка по хэшу. Замок страницы действует и здесь — та же
       причина, что у onWheel; отказ уезжает вызывающему ответом,
       и тот отдаёт клик браузеру.

       Длительность — от длины пути, с полом и потолком: короткий
       переезд не мигает, а весь лендинг сверху донизу не тянется
       бесконечно. */
    const offScrollRequest = onScrollRequest((y) => {
      if (document.body.style.overflow === 'hidden') return false;
      const from = window.scrollY;
      const goal = Math.min(maxScroll(), Math.max(0, y));
      const dist = Math.abs(goal - from);
      if (dist < 1) return true;
      trip = {
        from,
        to: y,
        t0: performance.now(),
        dur: Math.min(
          SCROLL_TRIP_MAX_MS,
          Math.max(SCROLL_TRIP_MIN_MS, (dist / 1000) * SCROLL_TRIP_MS_PER_1000PX),
        ),
      };
      cur = from;
      target = from;
      wake();
      return true;
    });

    /* Палец и полоса прокрутки — тот же «зритель забрал управление».
       pointerdown приходит раньше click, так что клик по самой кнопке
       свою же поездку не рубит. */
    const onPointerDown = () => cancelTrip();
    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) cancelTrip();
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKeyDown, { passive: true });

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      offScrollRequest();
      sleep();
    };
  }, []);

  return null;
}
