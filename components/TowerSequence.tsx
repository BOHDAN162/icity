'use client';

/* iCITY 113Н — экран 1. Герой и подъём вдоль башни.
   Путь в проекте: components/TowerSequence.tsx
   Версия 7. Скролл в обе стороны, офис наезжает занавесом. См. ИСТОРИЯ.

   КАК УСТРОЕНО. Секция высокая: 100svh экрана плюс дистанция прокрутки.
   Внутри — липкий блок с canvas на 100svh. Прогресс считается из положения
   секции относительно вьюпорта. Листаешь вниз — камера поднимается,
   листаешь вверх — опускается. Долистал — секция кончилась.

   ПОЧЕМУ НЕ ScrollTrigger И НЕ ПИННИНГ. На свежих iOS адресная строка
   дёргает закреплённые секции, авторы GSAP считают это неустранимым.
   Нативный position: sticky этим не страдает. ScrollTrigger не нужен:
   прогресс — это одно вычитание из getBoundingClientRect.

   ПОЧЕМУ РАБОТАЕТ С LENIS. Позиция читается в общем rAF, Lenis двигает
   нативный скролл. Когда он появится на других экранах, этот файл менять
   не придётся. Сглаживание здесь и сглаживание Lenis не конфликтуют.

   КАДРЫ. Облака, небо и соседние башни Москва-Сити запечены в кадры,
   альфа-канала нет. Отдельного слоя облаков и градиентного неба под canvas
   больше нет: под холстом лежит сплошная заливка --paper и нужна ровно
   для одного — не мигнуть белым до отрисовки первого кадра.

   ПАМЯТЬ. Декодированный кадр занимает ширина×высота×4 байта независимо
   от веса файла: 1600×900 = 5,76 МБ при файле в 31 КБ. Лимит canvas-памяти
   на iOS — от 224 МБ. Превышение не тормозит, а убивает вкладку.
   Десктоп: симметричное окно ±16, резидентных 34 кадра ≈ 196 МБ.
   Мобильный: 144 × 640×360×4 ≈ 133 МБ, держим целиком. Кадры пересняты
   с 828×466 именно ради этой строки: на прежнем разрешении те же
   144 кадра давали 222 МБ против лимита в 224.

   Числа не живут в этом файле: кадры, радиус окна и производные от них
   бюджеты памяти лежат в lib/sequence.ts и считаются оттуда. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  DESKTOP,
  MOBILE,
  MOBILE_MAX_WIDTH,
  PRIME_FRAMES,
  WINDOW_POLL_MS,
  WINDOW_RADIUS,
  CURTAIN_SVH,
  frameSrc,
  type Variant,
} from '@/lib/sequence';
import styles from './TowerSequence.module.css';

const SMOOTH_TAU = 90;        // постоянная времени сглаживания, мс
const TEXT_FADE_END = 0.14;   // на этой доле прогресса заголовок исчезает
const TRAVEL_MS = 4200;       // автопроход по кнопке

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getMotionSnapshot = () => window.matchMedia(MOTION_QUERY).matches;
const getMotionServerSnapshot = () => false;

export default function TowerSequence() {
  const wrapRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const reduced = useSyncExternalStore(
    subscribeMotion,
    getMotionSnapshot,
    getMotionServerSnapshot,
  );

  const [primed, setPrimed] = useState(false);
  const [loadedRatio, setLoadedRatio] = useState(0);

  const imagesRef = useRef<HTMLImageElement[]>([]);
  const seenRef = useRef<Uint8Array>(new Uint8Array(0));
  /* Состояние слота НЕЛЬЗЯ читать через img.src: присваивание пустой строки
     резолвится в URL документа, и img.src навсегда остаётся истинным.
     Отсюда отдельный массив: 1 — на слоте висит настоящий src. */
  const assignedRef = useRef<Uint8Array>(new Uint8Array(0));
  const variantRef = useRef<Variant>(DESKTOP);
  const targetRef = useRef(0);        // прогресс по позиции скролла
  const smoothRef = useRef(0);        // прогресс с инерцией, по нему и рисуем
  const desiredIndexRef = useRef(0);  // какой кадр нужен прямо сейчас
  const lastDrawnRef = useRef(-1);
  const overlayShownRef = useRef(true);
  const rafRef = useRef(0);
  const travelRafRef = useRef(0);
  const travelOffRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* --- отрисовка. DPR капим двойкой --------------------------------- */
  const draw = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[index];
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const v = variantRef.current;
    const cw = canvas.width;
    const ch = canvas.height;
    /* cover, а не contain: Math.min оставлял фоновые полосы сверху и снизу
       на широких вьюпортах. Кадр закрывает экран целиком, лишнее срезается. */
    const scale = Math.max(cw / v.width, ch / v.height);
    const dw = v.width * scale;
    const dh = v.height * scale;

    /* clearRect не нужен: кадры непрозрачные, а cover гарантирует, что
       отрисованный кадр закрывает холст целиком. Чистить нечего. */
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    lastDrawnRef.current = index;
  }, []);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const sticky = stickyRef.current;
    if (!canvas || !sticky) return;

    // ПРАВИЛО 3: без капа айфон отрисует кадр в 13 мегапикселей
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = sticky.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const frame = lastDrawnRef.current;
    lastDrawnRef.current = -1;
    if (frame >= 0) draw(frame);
  }, [draw]);

  /* --- загрузка кадров ----------------------------------------------- */
  useEffect(() => {
    // ПРАВИЛО 7: две секвенции, мобильная до 828 px
    const v = window.innerWidth <= MOBILE_MAX_WIDTH ? MOBILE : DESKTOP;
    variantRef.current = v;

    // ПРАВИЛО 1: Image создаются ОДИН раз. Ни одного new Image() ниже
    const images: HTMLImageElement[] = Array.from({ length: v.count }, () => new Image());
    imagesRef.current = images;

    const seen = new Uint8Array(v.count);
    seenRef.current = seen;
    const assigned = new Uint8Array(v.count);
    assignedRef.current = assigned;

    let loadedOnce = 0;
    let cancelled = false;

    const assign = (i: number) => {
      if (i < 0 || i >= v.count) return;
      const img = images[i];
      if (assigned[i]) return;   // НЕ `if (img.src)` — см. комментарий у assignedRef
      assigned[i] = 1;
      img.decoding = 'async';
      img.onload = () => {
        if (cancelled) return;
        if (!seen[i]) {
          seen[i] = 1;
          loadedOnce += 1;
          setLoadedRatio(loadedOnce / v.count);
          if (loadedOnce >= PRIME_FRAMES) setPrimed(true);
        }
        // кадр доехал позже, чем до него долистали — дорисовываем
        if (i === desiredIndexRef.current) draw(i);
      };
      img.src = frameSrc(v, i);
    };

    const release = (i: number) => {
      if (!assigned[i]) return;
      const img = images[i];
      img.onload = null;
      img.src = '';
      assigned[i] = 0;   // слот снова свободен и его можно переназначить
      seen[i] = 0;       // кадр придётся загрузить заново, если вернёмся
      loadedOnce = Math.max(0, loadedOnce - 1);
    };

    // ПРАВИЛО 9: первый кадр с приоритетом и сразу на экран
    const boot = async () => {
      resize();
      const first = images[0];
      first.decoding = 'sync';
      assigned[0] = 1;
      first.src = frameSrc(v, 0);
      try {
        await first.decode();
      } catch {
        /* Safari иногда падает на decode() при отменённой загрузке */
      }
      if (cancelled) return;
      if (!seen[0]) {
        seen[0] = 1;
        loadedOnce += 1;
        setLoadedRatio(loadedOnce / v.count);
      }
      draw(0);

      if (reduced) {
        setPrimed(true);   // ПРАВИЛО 10: статичный кадр, весь текст сохраняется
        return;
      }

      const prime = v.windowed ? Math.min(PRIME_FRAMES + WINDOW_RADIUS, v.count) : v.count;
      for (let i = 1; i < prime; i += 1) assign(i);
    };

    void boot();

    /* ПРАВИЛО 8: окно живёт в собственном таймере, а НЕ в цикле отрисовки.
       Окно симметричное — плейхед ходит в обе стороны. */
    if (v.windowed && !reduced) {
      timerRef.current = setInterval(() => {
        const center = desiredIndexRef.current;
        const lo = Math.max(0, center - WINDOW_RADIUS);
        const hi = Math.min(v.count - 1, center + WINDOW_RADIUS);
        for (let i = lo; i <= hi; i += 1) assign(i);
        for (let i = 1; i < lo; i += 1) release(i);   // кадр 0 держим всегда
        for (let i = hi + 1; i < v.count; i += 1) release(i);
      }, WINDOW_POLL_MS);
    }

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    const canvasAtMount = canvasRef.current;

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (timerRef.current) clearInterval(timerRef.current);

      // ПРАВИЛО 6: Safari не отпускает canvas-память без обнуления размеров
      images.forEach((img) => {
        img.onload = null;
        img.src = '';
      });
      imagesRef.current = [];
      if (canvasAtMount) {
        canvasAtMount.width = 0;
        canvasAtMount.height = 0;
      }
    };
  }, [draw, resize, reduced]);

  /* --- единственный rAF: читает скролл, сглаживает, рисует ------------ */
  useEffect(() => {
    if (reduced) return;
    const v = variantRef.current;
    let prev = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - prev, 50);
      prev = now;

      const wrap = wrapRef.current;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        /* Липкий блок — это ровно 100svh в пикселях. Берём его высоту,
           а не window.innerHeight: на мобильных они расходятся, пока
           адресная строка развёрнута, и прогресс уезжал бы вместе с ней. */
        const svh = stickyRef.current?.offsetHeight || window.innerHeight;
        /* Занавес в скраб НЕ входит. Секция выше на CURTAIN_SVH, но кадры
           по нему уже не идут: индекс упирается в последний и стоит, пока
           офис наезжает сверху. Отсюда вычитание. */
        const travel = rect.height - svh - (svh * CURTAIN_SVH) / 100;
        targetRef.current = travel > 0 ? clamp01(-rect.top / travel) : 0;

        /* Инерция. Без неё кадры дёргаются рывками по щелчкам колеса:
           прогресс равен позиции скролла один в один. Коэффициент
           нормирован по времени кадра, поэтому не зависит от частоты. */
        const k = 1 - Math.exp(-dt / SMOOTH_TAU);
        const diff = targetRef.current - smoothRef.current;
        smoothRef.current = Math.abs(diff) < 0.0002
          ? targetRef.current
          : smoothRef.current + diff * k;

        const p = smoothRef.current;

        /* Засветки стекла здесь больше нет. Стык с офисом закрывает
           занавес: офис наезжает снизу и накрывает башню, а башня при
           этом не двигается вообще. Белая вспышка и занавес — две разные
           метафоры одного момента, и одновременно они читались как брак. */
        const index = Math.round(p * (v.count - 1));
        desiredIndexRef.current = index;

        // ПРАВИЛО 2: drawImage только если индекс кадра сменился
        if (index !== lastDrawnRef.current) draw(index);

        // заголовок уводим напрямую по стилю, без ре-рендера React
        const overlay = overlayRef.current;
        if (overlay) {
          const o = 1 - clamp01(p / TEXT_FADE_END);
          overlay.style.opacity = String(o);
          const shown = o > 0.01;
          if (shown !== overlayShownRef.current) {
            overlayShownRef.current = shown;
            overlay.style.visibility = shown ? 'visible' : 'hidden';
            overlay.style.pointerEvents = shown ? 'auto' : 'none';
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, reduced]);

  /* --- проезд камерой -------------------------------------------------
     Кнопка «Подняться на 23 этаж»: тот же путь сам, за TRAVEL_MS.
     Обратного проезда здесь больше нет. «К башне» из офиса — это
     обычная прокрутка страницы к `#tower` (см. OfficeStop), и секвенция
     отыгрывает подъём назад сама, кадр за кадром, потому что прогресс
     считается от положения секции. */
  /* Слушатели отмены вешаются и снимаются здесь же, а не через состояние
     React: setState в теле эффекта — ошибка линтера, а сам факт «едем
     или нет» рендеру не нужен, на экране от него ничего не зависит. */
  const cancelTravel = useCallback(() => {
    cancelAnimationFrame(travelRafRef.current);
    travelRafRef.current = 0;
    const off = travelOffRef.current;
    travelOffRef.current = null;
    off?.();
  }, []);

  const startTravel = useCallback((to: number, ms: number) => {
    const from = window.scrollY;
    if (Math.abs(to - from) < 1) return;

    cancelTravel();

    // любое действие пользователя прерывает проезд — в обе стороны
    const stop = () => cancelTravel();
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    travelOffRef.current = () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };

    const start = performance.now();
    const step = (now: number) => {
      const t = clamp01((now - start) / ms);
      window.scrollTo(0, from + (to - from) * easeInOutCubic(t));
      if (t < 1) {
        travelRafRef.current = requestAnimationFrame(step);
      } else {
        cancelTravel();
      }
    };
    travelRafRef.current = requestAnimationFrame(step);
  }, [cancelTravel]);

  /* Цель кнопки — конец секции, то есть конец занавеса: человек
     приезжает не к последнему кадру фасада, а на 23 этаж, ради которого
     кнопка и нажата. Занавес по дороге отыгрывается сам. */
  const travel = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const svh = stickyRef.current?.offsetHeight || window.innerHeight;
    startTravel(wrap.offsetTop + wrap.offsetHeight - svh, TRAVEL_MS);
  }, [startTravel]);

  // при размонтировании проезд гасим вместе со слушателями
  useEffect(() => cancelTravel, [cancelTravel]);

  return (
    /* id — цель прокрутки для кнопки «К башне» и Esc в офисе */
    <section ref={wrapRef} className={styles.wrap} id="tower">
      <div ref={stickyRef} className={styles.sticky}>
        <div className={styles.backdrop} aria-hidden="true" />
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />

        <div ref={overlayRef} className={styles.overlay}>
          <p className={styles.eyebrow}>iCITY · Space Tower · 23 этаж</p>
          <h1 className={styles.title}>
            Офис, в который
            <br />
            въезжают завтра
          </h1>
          <p className={styles.lead}>
            Потолки 3,8 метра. Окна открываются.
            <br />
            Отделка PRIDEX и мебель уже внутри.
          </p>

          <div className={styles.actions}>
            <button type="button" className="btn" onClick={travel}>
              Подняться на 23 этаж
            </button>
            <span className={`label ${styles.scrollHint}`}>
              {primed ? 'или листайте вниз' : `Загрузка ${Math.round(loadedRatio * 100)} %`}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ИСТОРИЯ

   v6 → v7. ЗАНАВЕС ВМЕСТО ЗАСВЕТКИ.

   `.glass` и ведущий её код удалены. Секция стала выше на CURTAIN_SVH,
   и на этом хвосте офис наезжает снизу и накрывает башню. Башня при этом
   не получает ничего: ни трансформации, ни прозрачности, ни масштаба —
   её накрывают, а не анимируют. Кадры по занавесу не идут, индекс стоит
   на последнем; дистанция скраба поэтому считается с вычитанием занавеса,
   а travelSvh в lib/sequence.ts не тронут.

   v5 → v6. ОФИС СТАЛ СЕКЦИЕЙ, А НЕ ОВЕРЛЕЕМ.

   Секвенция больше никого не открывает и никого не возвращает: пропсы
   onEnterOffice и returnRequestId сняты вместе с гистерезисом входа
   и обратным проездом на 3,5 с. Офис стоит следующей секцией страницы
   (OfficeStop), «К башне» — обычная прокрутка к `#tower`, и подъём
   отыгрывается назад сам собой, потому что прогресс всегда считался
   от положения секции.

   v4 → v5. СКРОЛЛ В ОБЕ СТОРОНЫ.

   Прогресс и в v4 считался от позиции секции, то есть назад он ходил.
   Но вытеснение кадров осталось от версии с удержанием: всё позади
   плейхеда освобождалось, и в комментарии стояло допущение «прогресс
   монотонный, назад не ходит». Со скроллом оно перестало быть верным —
   при прокрутке вверх кадры оказывались выгружены и картинка замирала
   на последнем нарисованном. Окно теперь симметричное, ±16 кадров,
   освобождается всё за его пределами в обе стороны. Резидентных 33.

   Добавлена инерция прогресса. Без неё кадры шли рывками по щелчкам
   колеса, потому что прогресс равнялся позиции скролла один в один.
   Коэффициент сглаживания нормирован по времени кадра, поэтому ход
   одинаков на 60 и на 120 Гц.

   v3 → v4. Удержание заменено скроллом: жест стоял на входе в сайт
   и был там ошибкой. Удержание осталось ровно в одном месте на всём
   сайте — экран 3, открывание окна, где жест означает физическое действие.

   v2 → v3. setState в эффекте переписан на useSyncExternalStore.

   v1 → v2. Дедлок разблокировки и полное отсутствие вытеснения кадров.

   Проверять на реальном iPhone обязательно. Ни один инструмент лимит
   canvas-памяти iOS не измеряет — только расчёт и живое устройство. */
