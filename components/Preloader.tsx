'use client';

/* iCITY 113Н — экран 0: прелоадер «лифт + занавес».
   Путь в проекте: components/Preloader.tsx

   ЧТО ЭТО. Полноэкранная накладка поверх всего на первой загрузке.
   Слева лестница этажей 01→23 (буквальная метафора «подняться на 23»,
   не проценты), справа крупный номер этажа моно, снизу растёт красная
   рельса. По завершении интерфейс гаснет, двери-створки расходятся
   в стороны, открывая {children} страницы — компонент размонтируется.

   ПРОГРЕСС: СЕЙЧАС ТАЙМЕР, ПОЗЖЕ — РЕАЛЬНАЯ ЗАГРУЗКА. Единственное
   место, читающее elapsed, — readProgress() ниже. Сейчас она считает
   по DURATION_MS; когда появится реальный источник (загруженные
   ассеты), заменится только её тело — draw()/open()/разметка сигнатуру
   { p, done } не увидят и трогать их не придётся.

   Один rAF на компонент, ре-рендеров React на кадрах нет: floor
   и рельса пишутся в DOM напрямую (textContent, style.transform),
   классы тиков — через classList. Единственное состояние React —
   `visible`, и меняется оно ровно один раз, на размонтировании. */

import {
  useEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import styles from './Preloader.module.css';

const DURATION_MS = 1900;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getMotionSnapshot = () => window.matchMedia(MOTION_QUERY).matches;
const getMotionServerSnapshot = () => false;

const STORAGE_KEY = 'icity-preloaded';

/* === PROGRESS SOURCE — заменить тело позже на реальную загрузку ===
   Контракт неизменен: { p: 0..1, done }. При переходе на реальный сигнал —
   realRatio из загруженных ассетов, p = Math.min(realRatio, тайм-кап
   на MIN_MS для не-мгновенного лифта), done = realRatio>=1 && elapsed>=MIN_MS,
   плюс жёсткий потолок MAX_MS на случай зависшей загрузки. */
function readProgress(elapsed: number): { p: number; done: boolean } {
  const t = Math.min(1, elapsed / DURATION_MS);
  return { p: easeOut(t), done: t >= 1 };
}

export default function Preloader() {
  const reduced = useSyncExternalStore(
    subscribeMotion,
    getMotionSnapshot,
    getMotionServerSnapshot,
  );
  const [visible, setVisible] = useState(true);

  const rootRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const doorLRef = useRef<HTMLDivElement>(null);
  const doorRRef = useRef<HTMLDivElement>(null);
  const ladderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY)) {
      /* setState вызывается из колбэка, а не синхронно из тела эффекта —
         так требует react-hooks/set-state-in-effect; микротаск успевает
         до отрисовки кадра, вспышки интерфейса нет. */
      queueMicrotask(() => setVisible(false));
      return;
    }

    const ticks = ladderRef.current
      ? (Array.from(ladderRef.current.children) as HTMLElement[])
      : [];
    const start = performance.now();
    let raf = 0;
    let finished = false;

    const finish = () => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setVisible(false);
    };

    const open = () => {
      if (reduced) {
        rootRef.current?.classList.add(styles.fade);
        window.setTimeout(finish, 260);
        return;
      }
      uiRef.current?.classList.add(styles.uiOut);
      window.setTimeout(() => {
        doorLRef.current?.classList.add(styles.openL);
        doorRRef.current?.classList.add(styles.openR);
        window.setTimeout(finish, 900);
      }, 220);
    };

    const draw = (p: number) => {
      const floor = Math.max(1, Math.round(1 + p * 22));
      if (numRef.current) numRef.current.textContent = String(floor).padStart(2, '0');
      if (railRef.current) railRef.current.style.transform = `scaleX(${p})`;
      for (const tick of ticks) {
        const f = Number(tick.dataset.f);
        tick.classList.toggle(styles.past, f < floor);
        tick.classList.toggle(styles.cur, f === floor);
      }
    };

    /* Reduced-motion: без анимации лестницы и створок, но временная
       линия остаётся — она же будущий сигнал реальной загрузки. */
    if (reduced) {
      draw(1);
      const poll = () => {
        const { done } = readProgress(performance.now() - start);
        if (done) { open(); return; }
        raf = requestAnimationFrame(poll);
      };
      raf = requestAnimationFrame(poll);
      return () => cancelAnimationFrame(raf);
    }

    const loop = () => {
      const { p, done } = readProgress(performance.now() - start);
      draw(p);
      if (!finished && done) {
        finished = true;
        draw(1);
        open();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  if (!visible) return null;

  const rungs = [];
  for (let f = 23; f >= 1; f -= 1) {
    rungs.push(
      <div key={f} className={styles.tick} data-f={f}>
        <i className={styles.tickLine} />
        <span className={styles.tickNum}>{String(f).padStart(2, '0')}</span>
      </div>,
    );
  }

  return (
    <div ref={rootRef} className={styles.root} aria-hidden="true">
      <div ref={doorLRef} className={`${styles.door} ${styles.doorL}`} />
      <div ref={doorRRef} className={`${styles.door} ${styles.doorR}`} />
      <div ref={uiRef} className={styles.ui}>
        <p className={`label ${styles.mark}`}>Подъём на 23 этаж</p>
        <div ref={ladderRef} className={styles.ladder}>{rungs}</div>
        <div className={styles.big}>
          <span ref={numRef} className={styles.num}>01</span>
          <span className={`label ${styles.numLabel}`}>Этаж</span>
        </div>
        <div className={styles.rail}>
          <span ref={railRef} className={styles.railFill} />
        </div>
      </div>
    </div>
  );
}
