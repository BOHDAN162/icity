'use client';

/* iCITY 113Н — экран 1. Герой и подъём вдоль башни.
   Путь в проекте: components/TowerSequence.tsx

   ЧТО ЭТО. Полноэкранное состояние, НЕ ScrollTrigger-пиннинг. На свежих iOS
   адресная строка дёргает закреплённые секции, и авторы GSAP считают это
   неустранимым. Нет пиннинга — нечему прыгать. Поэтому здесь нет ни GSAP,
   ни Lenis: на этом экране скролл не участвует вообще.

   Кадры прозрачные, фон — отдельный слой под canvas (позже туда ляжет
   панорама Москва-Сити с параллаксом).

   ПАМЯТЬ — главный риск. Декодированный кадр занимает ширина×высота×4 байта
   независимо от веса файла. 1600×900 = 5,76 МБ при файле в 30 КБ.
   Лимит canvas-памяти на iOS: 224 МБ (iOS 12) — 384 МБ (iOS 15).
   Превышение не тормозит, а убивает вкладку.
   Десктоп: скользящее окно ±20. Мобильный: 90 × 828×466×4 ≈ 132 МБ, держим всё.
   Если на реальном айфоне вкладка падает — поставить MOBILE.window = 12. */

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './TowerSequence.module.css';

type Variant = {
  dir: string;
  count: number;
  width: number;
  height: number;
  /** null = держим все кадры; число = скользящее окно ±N */
  window: number | null;
};

const DESKTOP: Variant = { dir: '/sequence/desktop', count: 150, width: 1600, height: 900, window: 20 };
const MOBILE: Variant = { dir: '/sequence/mobile', count: 90, width: 828, height: 466, window: null };

const MOBILE_MAX_WIDTH = 828;

const HOLD_FULL = 5000;      // полный проход при удержании, мс
const HOLD_RELEASE = 900;    // торможение после отпускания, мс
const IDLE_START = 6500;     // автостарт, если не тронули. На герое есть текст — 3 с мало
const IDLE_SPEED = 0.6;      // автостарт идёт медленнее ручного
const READY_RATIO = 0.4;     // доля буфера, после которой разблокируется удержание
const DOTS = 6;              // точек в индикаторе

const frameSrc = (v: Variant, i: number) =>
  `${v.dir}/f_${String(i + 1).padStart(4, '0')}.webp`;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export default function TowerSequence({ onComplete }: { onComplete?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [ready, setReady] = useState(false);
  const [loadedRatio, setLoadedRatio] = useState(0);
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);

  // всё, что меняется каждый кадр, живёт в ref — состояние не трогаем
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const variantRef = useRef<Variant>(DESKTOP);
  const progressRef = useRef(0);
  const lastDrawnRef = useRef(-1);
  const holdingRef = useRef(false);
  const releaseAtRef = useRef(0);
  const releaseFromSpeedRef = useRef(0);
  const touchedRef = useRef(false);
  const mountedAtRef = useRef(0);
  const rafRef = useRef(0);
  const windowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  /* --- отрисовка: contain, DPR капим двойкой ------------------------- */
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
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    // ПРАВИЛО 3: без капа айфон отрисует кадр в 13 мегапикселей
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = wrap.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const frame = lastDrawnRef.current;
    lastDrawnRef.current = -1;
    if (frame >= 0) draw(frame);
  }, [draw]);

  /* --- инициализация ------------------------------------------------- */
  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isReduced = motionQuery.matches;
    setReduced(isReduced);

    // ПРАВИЛО 7: две секвенции, мобильная до 828 px
    const v = window.innerWidth <= MOBILE_MAX_WIDTH ? MOBILE : DESKTOP;
    variantRef.current = v;
    mountedAtRef.current = performance.now();

    // ПРАВИЛО 1: Image создаются ОДИН раз. Ни одного new Image() ниже по коду
    const images: HTMLImageElement[] = Array.from({ length: v.count }, () => new Image());
    imagesRef.current = images;

    let loaded = 0;
    let cancelled = false;

    const assign = (i: number) => {
      const img = images[i];
      if (img.src) return;
      img.decoding = 'async';
      img.onload = () => {
        loaded += 1;
        if (!cancelled) setLoadedRatio(loaded / v.count);
      };
      img.src = frameSrc(v, i);
    };

    // ПРАВИЛО 9: первый кадр с приоритетом и сразу на экран, пустой canvas — никогда
    const boot = async () => {
      resize();
      const first = images[0];
      first.decoding = 'sync';
      first.src = frameSrc(v, 0);
      try {
        await first.decode();
      } catch {
        /* Safari иногда падает на decode() при отменённой загрузке — не критично */
      }
      if (cancelled) return;
      loaded = Math.max(loaded, 1);
      setLoadedRatio(loaded / v.count);
      draw(0);

      if (isReduced) {
        // ПРАВИЛО 10: три статичных кадра, без анимации. Текст и числа сохраняются
        [v.count - 1, Math.floor(v.count / 2)].forEach(assign);
        setReady(true);
        return;
      }

      // порядок прогрева: последний → 50% → 25% → 75% → всё подряд
      const order = [
        v.count - 1,
        Math.floor(v.count * 0.5),
        Math.floor(v.count * 0.25),
        Math.floor(v.count * 0.75),
      ];
      order.forEach(assign);

      const upTo = v.window ? Math.min(v.window * 2, v.count) : v.count;
      for (let i = 1; i < upTo; i += 1) assign(i);
    };

    void boot();

    // ПРАВИЛО 8: окно живёт в собственном таймере, а НЕ в цикле отрисовки
    if (v.window && !isReduced) {
      windowTimerRef.current = setInterval(() => {
        const center = Math.round(progressRef.current * (v.count - 1));
        const lo = Math.max(0, center - v.window!);
        const hi = Math.min(v.count - 1, center + v.window!);
        for (let i = lo; i <= hi; i += 1) assign(i);
      }, 150);
    }

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (windowTimerRef.current) clearInterval(windowTimerRef.current);

      // ПРАВИЛО 6: Safari не отпускает canvas-память без обнуления размеров
      images.forEach((img) => {
        img.onload = null;
        img.src = '';
      });
      imagesRef.current = [];
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [draw, resize]);

  /* --- разблокировка удержания по буферу ----------------------------- */
  useEffect(() => {
    if (!ready && loadedRatio >= READY_RATIO) setReady(true);
  }, [loadedRatio, ready]);

  /* --- цикл: единственный rAF на весь экран -------------------------- */
  useEffect(() => {
    if (reduced) return;
    const v = variantRef.current;
    let prev = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - prev, 50); // защита от прыжка после сворачивания вкладки
      prev = now;

      const base = 1 / HOLD_FULL;
      let speed = 0;

      if (holdingRef.current && ready) {
        speed = base;
      } else if (releaseAtRef.current > 0) {
        const t = (now - releaseAtRef.current) / HOLD_RELEASE;
        speed = t >= 1 ? 0 : releaseFromSpeedRef.current * (1 - easeOutCubic(t));
        if (t >= 1) releaseAtRef.current = 0;
      } else if (
        ready &&
        !touchedRef.current &&
        now - mountedAtRef.current > IDLE_START
      ) {
        speed = base * IDLE_SPEED;
      }

      if (speed > 0) {
        progressRef.current = Math.min(1, progressRef.current + speed * dt);
      }

      // ПРАВИЛО 2: drawImage только если индекс кадра сменился
      const index = Math.round(progressRef.current * (v.count - 1));
      if (index !== lastDrawnRef.current) {
        draw(index);
        setProgress(progressRef.current);
      }

      if (progressRef.current >= 1 && !doneRef.current) {
        doneRef.current = true;
        onComplete?.();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, ready, reduced, onComplete]);

  /* --- ввод: указатель, клавиатура, первый скролл -------------------- */
  const engage = useCallback(() => {
    if (!ready || reduced) return;
    touchedRef.current = true;
    holdingRef.current = true;
    releaseAtRef.current = 0;
  }, [ready, reduced]);

  const release = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    releaseFromSpeedRef.current = 1 / HOLD_FULL;
    releaseAtRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (reduced) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        engage();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') release();
    };
    // кто-то рефлекторно крутит колесо вместо удержания — тоже запускаем
    const onWheel = () => {
      if (touchedRef.current) return;
      engage();
      window.setTimeout(release, 400);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('wheel', onWheel, { passive: true, once: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('wheel', onWheel);
    };
  }, [engage, release, reduced]);

  const litDots = Math.round(progress * DOTS);

  return (
    <section
      ref={wrapRef}
      className={styles.stage}
      onPointerDown={engage}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <div className={styles.sky} aria-hidden="true" />
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />

      <div className={styles.overlay}>
        <p className={styles.eyebrow}>iCITY · Space Tower · 23 этаж</p>
        <h1 className={styles.title}>
          Офис, в который
          <br />
          въезжают завтра
        </h1>
        <p className={styles.lead}>
          Потолки 3,8 метра. Окна открываются. Отделка и мебель уже внутри.
        </p>

        <div className={styles.hint} aria-live="polite">
          <span className={styles.dots} aria-hidden="true">
            {Array.from({ length: DOTS }, (_, i) => (
              <span
                key={i}
                className={i < litDots ? styles.dotOn : styles.dot}
              />
            ))}
          </span>
          <span className="label">
            {reduced
              ? 'Анимация отключена в системе'
              : ready
                ? 'Держите, чтобы подняться'
                : `Загрузка ${Math.round(loadedRatio * 100)}%`}
          </span>
        </div>
      </div>
    </section>
  );
}
