'use client';

/* iCITY 113Н — экран 1. Герой и подъём вдоль башни.
   Путь в проекте: components/TowerSequence.tsx
   Версия 3. См. блок ИСТОРИЯ внизу файла.

   ЧТО ЭТО. Полноэкранное состояние, НЕ ScrollTrigger-пиннинг. На свежих iOS
   адресная строка дёргает закреплённые секции, и авторы GSAP считают это
   неустранимым. Нет пиннинга — нечему прыгать. Поэтому здесь нет ни GSAP,
   ни Lenis: на этом экране скролл не участвует.

   Кадры прозрачные, фон — отдельный слой под canvas.

   ПАМЯТЬ. Декодированный кадр занимает ширина×высота×4 байта независимо
   от веса файла: 1600×900 = 5,76 МБ при файле в 30 КБ. Лимит canvas-памяти
   на iOS — от 224 МБ. Превышение не тормозит, а убивает вкладку.
   Десктоп: держим PRELOAD_AHEAD впереди и RELEASE_BEHIND позади плейхеда,
   резидентных около 33 кадров ≈ 190 МБ. Мобильный: 90 × 828×466×4 ≈ 132 МБ,
   держим целиком. Если на живом айфоне вкладка падает — поставить
   MOBILE.windowed = true. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from './TowerSequence.module.css';

type Variant = {
  dir: string;
  count: number;
  width: number;
  height: number;
  /** true = работает скользящее окно; false = держим все кадры */
  windowed: boolean;
};

const DESKTOP: Variant = { dir: '/sequence/desktop', count: 150, width: 1600, height: 900, windowed: true };
const MOBILE: Variant = { dir: '/sequence/mobile', count: 90, width: 828, height: 466, windowed: false };

const MOBILE_MAX_WIDTH = 828;

const PRELOAD_AHEAD = 24;    // кадров впереди плейхеда
const RELEASE_BEHIND = 8;    // кадров позади плейхеда, дальше освобождаем
const PRIME_FRAMES = 24;     // сколько нужно подряд с начала, чтобы разблокировать удержание

const HOLD_FULL = 5000;      // полный проход при удержании, мс
const HOLD_RELEASE = 900;    // торможение после отпускания, мс
const IDLE_START = 6500;     // автостарт. На герое есть заголовок — 3 с мало
const IDLE_SPEED = 0.6;
const STALL_AFTER = 700;     // столько упираемся в границу буфера, прежде чем сказать об этом
const DOTS = 6;

const frameSrc = (v: Variant, i: number) =>
  `${v.dir}/f_${String(i + 1).padStart(4, '0')}.webp`;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/* Системная настройка анимации — внешний источник, а не состояние React.
   useSyncExternalStore даёт корректный серверный снапшот и подхватывает
   изменение настройки на лету. setState в теле эффекта здесь не нужен. */
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getMotionSnapshot = () => window.matchMedia(MOTION_QUERY).matches;
const getMotionServerSnapshot = () => false;

export default function TowerSequence({ onComplete }: { onComplete?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const reduced = useSyncExternalStore(
    subscribeMotion,
    getMotionSnapshot,
    getMotionServerSnapshot,
  );

  const [ready, setReady] = useState(false);
  const [loadedRatio, setLoadedRatio] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stalled, setStalled] = useState(false);
  const [done, setDone] = useState(false);

  const imagesRef = useRef<HTMLImageElement[]>([]);
  const seenRef = useRef<Uint8Array>(new Uint8Array(0));
  const frontierRef = useRef(-1);       // докуда кадры загружены подряд от нуля
  const variantRef = useRef<Variant>(DESKTOP);
  const progressRef = useRef(0);
  const lastDrawnRef = useRef(-1);
  const holdingRef = useRef(false);
  const releaseAtRef = useRef(0);
  const touchedRef = useRef(false);
  const mountedAtRef = useRef(0);
  const stalledSinceRef = useRef(0);
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  /* --- отрисовка. DPR капим двойкой ---------------------------------- */
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

  /* --- инициализация -------------------------------------------------- */
  useEffect(() => {
    // ПРАВИЛО 7: две секвенции, мобильная до 828 px
    const v = window.innerWidth <= MOBILE_MAX_WIDTH ? MOBILE : DESKTOP;
    variantRef.current = v;
    mountedAtRef.current = performance.now();

    // ПРАВИЛО 1: Image создаются ОДИН раз. Ни одного new Image() ниже
    const images: HTMLImageElement[] = Array.from({ length: v.count }, () => new Image());
    imagesRef.current = images;

    const seen = new Uint8Array(v.count);
    seenRef.current = seen;
    frontierRef.current = -1;

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
        }
        // граница подряд загруженного от нуля — она только растёт
        let f = frontierRef.current;
        while (f + 1 < v.count && seen[f + 1]) f += 1;
        frontierRef.current = f;
        if (f + 1 >= PRIME_FRAMES) setReady(true);
      };
      img.src = frameSrc(v, i);
    };

    const release = (i: number) => {
      const img = images[i];
      if (!img.src) return;
      img.onload = null;
      img.src = '';   // seen[i] не сбрасываем: плейхед сюда уже не вернётся
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
      frontierRef.current = Math.max(frontierRef.current, 0);
      draw(0);

      if (reduced) {
        // ПРАВИЛО 10: три статичных кадра. Текст и числа сохраняются
        assign(Math.floor(v.count / 2));
        assign(v.count - 1);
        setReady(true);
        setDone(true);
        doneRef.current = true;
        return;
      }

      // прогрев: сплошной блок от начала, дальше окно доберёт остальное
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

  /* --- цикл: единственный rAF на весь экран --------------------------- */
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
        speed = t >= 1 ? 0 : base * (1 - easeOutCubic(t));
        if (t >= 1) releaseAtRef.current = 0;
      } else if (ready && !touchedRef.current && now - mountedAtRef.current > IDLE_START) {
        speed = base * IDLE_SPEED;
      }

      if (speed > 0) {
        // прогресс не убегает за границу загруженного — иначе замирание на пустых кадрах
        const ceiling = frontierRef.current / (v.count - 1);
        const wanted = progressRef.current + speed * dt;
        const next = Math.min(1, Math.min(wanted, ceiling));

        if (wanted > ceiling + 1e-6 && ceiling < 1) {
          if (stalledSinceRef.current === 0) stalledSinceRef.current = now;
          if (now - stalledSinceRef.current > STALL_AFTER) setStalled(true);
        } else if (stalledSinceRef.current !== 0) {
          stalledSinceRef.current = 0;
          setStalled(false);
        }

        progressRef.current = next;
      }

      // ПРАВИЛО 2: drawImage только если индекс кадра сменился
      const index = Math.round(progressRef.current * (v.count - 1));
      if (index !== lastDrawnRef.current) {
        draw(index);
        setProgress(progressRef.current);
      }

      if (progressRef.current >= 1 && !doneRef.current) {
        doneRef.current = true;
        holdingRef.current = false;
        setDone(true);        // снимает перехват тача, дальше страница скроллится
        onComplete?.();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw, ready, reduced, onComplete]);

  /* --- ввод ------------------------------------------------------------ */
  const engage = useCallback(() => {
    if (!ready || reduced || doneRef.current) return;
    touchedRef.current = true;
    holdingRef.current = true;
    releaseAtRef.current = 0;
  }, [ready, reduced]);

  const stop = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    releaseAtRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (reduced) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (doneRef.current) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        engage();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') stop();
    };
    // кто-то рефлекторно крутит колесо вместо удержания — тоже запускаем
    const onWheel = () => {
      if (touchedRef.current || doneRef.current) return;
      engage();
      window.setTimeout(stop, 400);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('wheel', onWheel, { passive: true, once: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('wheel', onWheel);
    };
  }, [engage, stop, reduced]);

  const litDots = Math.round(progress * DOTS);

  const hint = reduced
    ? 'Анимация отключена в системе'
    : !ready
      ? `Загрузка ${Math.round(loadedRatio * 100)} %`
      : done
        ? 'Листайте дальше'
        : stalled
          ? 'Догружаем кадры…'
          : 'Держите, чтобы подняться';

  return (
    <section
      ref={wrapRef}
      className={styles.stage}
      data-done={done ? 'true' : 'false'}
      onPointerDown={engage}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
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
          Потолки 3,8 метра. Окна открываются.
          <br />
          Отделка PRIDEX и мебель уже внутри.
        </p>

        <div className={styles.hint} aria-live="polite">
          <span className={styles.dots} aria-hidden="true">
            {Array.from({ length: DOTS }, (_, i) => (
              <span key={i} className={i < litDots ? styles.dotOn : styles.dot} />
            ))}
          </span>
          <span className="label">{hint}</span>
        </div>
      </div>
    </section>
  );
}

/* ИСТОРИЯ

   v2 → v3.

   3. ЛИНТЕР БЫЛ ПРАВ. setReduced() в теле эффекта — это ошибка по существу,
      а не придирка нового правила: системная настройка анимации является
      внешним источником, а не состоянием React. Переписано на
      useSyncExternalStore, который для того и сделан. Побочно исчез
      риск рассинхрона при SSR и появилась реакция на смену настройки
      на лету, без перезагрузки страницы.

   4. ПЕРЕХВАТ ТАЧА СНИМАЕТСЯ ПОСЛЕ ФИНИША. У секции стоит
      touch-action: none, иначе удержание пальцем скроллило бы страницу.
      Пока экран один, это незаметно. Как только под героем появится
      экран 2, с телефона стало бы невозможно уйти вниз. Теперь после
      завершения подъёма выставляется data-done="true", touch-action
      возвращается в auto, а подсказка меняется на «Листайте дальше».
      При отключённой анимации done выставляется сразу.

   v1 → v2.

   1. ДЕДЛОК. Разблокировка удержания висела на доле загруженных кадров
      (READY_RATIO = 0,4, то есть 60 кадров), а прогрев грузил только 43.
      Таймер окна центрировался на progress = 0, и добирать ему было нечего:
      прогресс не двигался без ready, ready не наступал без прогресса.
      Экран навсегда застревал на «Загрузка 29 %». Мобильная ветка выживала
      случайно — там окна нет, грузились все 90.
      Теперь готовность считается по границе подряд загруженного от нуля
      (PRIME_FRAMES), и то же число управляет прогревом. Порог физически
      не может оказаться недостижимым. Плюс прогресс ограничен этой
      границей: на медленной сети подъём притормаживает, а не рвётся.

   2. ОКНО НЕ ОСВОБОЖДАЛО ПАМЯТЬ. Таймер только назначал src и никогда
      его не снимал — за полный проход резидентными становились все
      150 кадров, около 864 МБ декодированного. Файл, написанный ради
      контроля памяти, память не контролировал.
      Теперь есть release(): всё, что дальше RELEASE_BEHIND позади
      плейхеда, освобождается. Прогресс монотонный, назад не ходит,
      поэтому освобождённые кадры больше не понадобятся.
      Резидентных ≈ PRELOAD_AHEAD + RELEASE_BEHIND + 1 ≈ 33 ≈ 190 МБ.

   Проверять на реальном iPhone обязательно. Ни один инструмент лимит
   canvas-памяти iOS не измеряет — только расчёт и живое устройство. */
