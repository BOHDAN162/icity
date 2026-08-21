'use client';

/* iCITY 113Н — экран 1. Герой и подъём вдоль башни.
   Путь в проекте: components/TowerSequence.tsx
   Версия 4. Управление переведено с удержания на скролл — см. ИСТОРИЯ.

   КАК УСТРОЕНО. Секция высокая: 100svh экрана плюс дистанция прокрутки.
   Внутри — липкий блок с canvas на 100svh. Прогресс секвенции считается
   из положения секции относительно вьюпорта. Листаешь — камера едет.
   Долистал — секция кончилась, дальше обычная страница.

   ПОЧЕМУ НЕ ScrollTrigger И НЕ ПИННИНГ. На свежих iOS адресная строка
   дёргает закреплённые секции, авторы GSAP считают это неустранимым.
   Нативный position: sticky этой болезнью не страдает. ScrollTrigger
   здесь просто не нужен: прогресс — это одно вычитание.

   ПОЧЕМУ РАБОТАЕТ С LENIS. Позиция читается через getBoundingClientRect
   в общем rAF. Lenis двигает нативный скролл, поэтому когда он появится
   на других экранах, этот файл менять не придётся.

   ПАМЯТЬ. Декодированный кадр занимает ширина×высота×4 байта независимо
   от веса файла: 1600×900 = 5,76 МБ при файле в 30 КБ. Лимит canvas-памяти
   на iOS — от 224 МБ. Превышение не тормозит, а убивает вкладку.
   Десктоп: окно вокруг плейхеда, резидентных около 40 кадров ≈ 230 МБ.
   Мобильный: 90 × 828×466×4 ≈ 132 МБ, держим целиком. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from './TowerSequence.module.css';

type Variant = {
  dir: string;
  count: number;
  width: number;
  height: number;
  windowed: boolean;
};

const DESKTOP: Variant = { dir: '/sequence/desktop', count: 150, width: 1600, height: 900, windowed: true };
const MOBILE: Variant = { dir: '/sequence/mobile', count: 90, width: 828, height: 466, windowed: false };

const MOBILE_MAX_WIDTH = 828;

const PRELOAD_AHEAD = 30;    // кадров впереди плейхеда
const RELEASE_BEHIND = 10;   // кадров позади, дальше освобождаем
const PRIME_FRAMES = 20;     // сплошной блок с начала, грузится сразу

const TEXT_FADE_END = 0.14;  // на этой доле прогресса заголовок исчезает полностью
const TRAVEL_MS = 4200;      // столько едет автопроход по кнопке

const frameSrc = (v: Variant, i: number) =>
  `${v.dir}/f_${String(i + 1).padStart(4, '0')}.webp`;

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/* Системная настройка анимации — внешний источник, не состояние React */
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getMotionSnapshot = () => window.matchMedia(MOTION_QUERY).matches;
const getMotionServerSnapshot = () => false;

export default function TowerSequence({ onComplete }: { onComplete?: () => void }) {
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
  const [travelling, setTravelling] = useState(false);

  const imagesRef = useRef<HTMLImageElement[]>([]);
  const seenRef = useRef<Uint8Array>(new Uint8Array(0));
  const variantRef = useRef<Variant>(DESKTOP);
  const progressRef = useRef(0);
  const lastDrawnRef = useRef(-1);
  const overlayShownRef = useRef(true);
  const rafRef = useRef(0);
  const travelRafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

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
    const scale = Math.min(cw / v.width, ch / v.height);
    const dw = v.width * scale;
    const dh = v.height * scale;

    ctx.clearRect(0, 0, cw, ch);
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

    let loadedOnce = 0;
    let cancelled = false;

    const assign = (i: number) => {
      if (i < 0 || i >= v.count) return;
      const img = images[i];
      if (img.src) return;
      img.decoding = 'async';
      img.onload = () => {
        if (cancelled) return;
        if (!seen[i]) {
          seen[i] = 1;
          loadedOnce += 1;
          setLoadedRatio(loadedOnce / v.count);
          if (loadedOnce >= PRIME_FRAMES) setPrimed(true);
        }
        // кадр мог доехать позже, чем до него долистали
        if (i === lastDrawnRef.current + 1 || i === lastDrawnRef.current) draw(i);
      };
      img.src = frameSrc(v, i);
    };

    const release = (i: number) => {
      const img = images[i];
      if (!img.src) return;
      img.onload = null;
      img.src = '';
    };

    // ПРАВИЛО 9: первый кадр с приоритетом и сразу на экран
    const boot = async () => {
      resize();
      const first = images[0];
      first.decoding = 'sync';
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
        // ПРАВИЛО 10: статичный кадр, весь текст сохраняется
        setPrimed(true);
        return;
      }

      const prime = v.windowed ? Math.min(PRIME_FRAMES + PRELOAD_AHEAD, v.count) : v.count;
      for (let i = 1; i < prime; i += 1) assign(i);
    };

    void boot();

    // ПРАВИЛО 8: окно живёт в собственном таймере, а НЕ в цикле отрисовки
    if (v.windowed && !reduced) {
      timerRef.current = setInterval(() => {
        const center = Math.round(progressRef.current * (v.count - 1));
        for (let i = center; i <= center + PRELOAD_AHEAD; i += 1) assign(i);
        for (let i = 0; i < center - RELEASE_BEHIND; i += 1) release(i);
      }, 120);
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

  /* --- единственный rAF: читает скролл, рисует кадр ------------------- */
  useEffect(() => {
    if (reduced) return;
    const v = variantRef.current;

    const tick = () => {
      const wrap = wrapRef.current;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        const travel = rect.height - window.innerHeight;
        const p = travel > 0 ? clamp01(-rect.top / travel) : 0;
        progressRef.current = p;

        // ПРАВИЛО 2: drawImage только если индекс кадра сменился
        const index = Math.round(p * (v.count - 1));
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
          }
        }

        if (p >= 0.999 && !doneRef.current) {
          doneRef.current = true;
          onComplete?.();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, reduced, onComplete]);

  /* --- кнопка: сама доводит до конца секции ---------------------------- */
  const cancelTravel = useCallback(() => {
    cancelAnimationFrame(travelRafRef.current);
    travelRafRef.current = 0;
    setTravelling(false);
  }, []);

  const travel = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const from = window.scrollY;
    const to = wrap.offsetTop + wrap.offsetHeight - window.innerHeight;
    if (to <= from) return;

    setTravelling(true);
    const start = performance.now();

    const step = (now: number) => {
      const t = clamp01((now - start) / TRAVEL_MS);
      window.scrollTo(0, from + (to - from) * easeInOutCubic(t));
      if (t < 1) {
        travelRafRef.current = requestAnimationFrame(step);
      } else {
        travelRafRef.current = 0;
        setTravelling(false);
      }
    };
    travelRafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    if (!travelling) return;
    // любое действие пользователя отменяет автопроход
    const off = () => cancelTravel();
    window.addEventListener('wheel', off, { passive: true });
    window.addEventListener('touchstart', off, { passive: true });
    window.addEventListener('keydown', off);
    return () => {
      window.removeEventListener('wheel', off);
      window.removeEventListener('touchstart', off);
      window.removeEventListener('keydown', off);
      cancelAnimationFrame(travelRafRef.current);
    };
  }, [travelling, cancelTravel]);

  return (
    <section ref={wrapRef} className={styles.wrap}>
      <div ref={stickyRef} className={styles.sticky}>
        <div className={styles.sky} aria-hidden="true" />
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

   v3 → v4. УДЕРЖАНИЕ УБРАНО, УПРАВЛЕНИЕ — СКРОЛЛ.

   Жест удержания стоял на входе в сайт и был там ошибкой. Он взят из
   quadplex80, но там работает потому, что это редкий момент внутри
   обычной страницы. У нас он оказался первым, что видит человек:
   незнакомый жест ровно в той точке, где трение стоит дороже всего.
   Кто крутит колесо — не понимает, почему ничего не происходит.

   Теперь: листаешь — камера едет. Кнопка «Подняться на 23 этаж» делает
   тот же проход сама за 4,2 с и отменяется любым действием пользователя.
   Заголовок живёт на первых кадрах и растворяется за первые 14 %
   прокрутки — попутно исчезает проблема нечитаемого тёмного текста
   на тёмном фасаде, ради которой пришлось бы двигать композицию.

   Пиннинга по-прежнему нет: высокая секция плюс нативный sticky.
   ScrollTrigger не нужен — прогресс это одно вычитание из
   getBoundingClientRect. Баг iOS с адресной строкой не воспроизводится,
   потому что нечего закреплять.

   Удержание остаётся ровно в одном месте на всём сайте — экран 3,
   открывание окна. Там жест означает физическое действие.

   Ушла и блокировка «пока не загрузилось — не листать». Скролл работает
   сразу; если кадр ещё не доехал, на экране остаётся предыдущий и
   дорисовывается по факту загрузки. Ждать пользователя не заставляем.

   v2 → v3. setState в эффекте переписан на useSyncExternalStore.

   v1 → v2. Дедлок разблокировки и отсутствие вытеснения кадров:
   окно только назначало src и никогда не снимало, за полный проход
   резидентными становились все 150 кадров, около 864 МБ.

   Проверять на реальном iPhone обязательно. Ни один инструмент лимит
   canvas-памяти iOS не измеряет — только расчёт и живое устройство. */
