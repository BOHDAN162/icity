'use client';

/* iCITY 113Н — облачный пролог первого экрана.
   Путь в проекте: components/CloudLayer.tsx

   ЗАЧЕМ. Башня в секвенции стоит на белом подиуме-диске посреди белой
   пустоты, и первый экран читается как схема, а не как здание. Облака
   закрывают подиум и нижние этажи — задача решается без перерендера
   секвенции. Референс: 111 West 57th.

   ПОЧЕМУ ДВА СЛОЯ, А НЕ ОДИН. Сквозь облако летят внутри его толщи:
   часть облаков остаётся позади предмета, часть проходит перед ним.
   Поэтому компонент ставится дважды. `far` лежит между фоновым
   градиентом и canvas и работает как атмосфера за башней. `near` лежит
   поверх canvas и делает главное — прячет подиум и основание. Одним
   слоем за canvas этого не сделать: кадры прозрачные, но сама башня
   в них непрозрачна, и всё, что позади, ею перекрыто.

   КАК ИДЁТ ПРОЛЁТ. `near` начинается со сплошной пелены — экран белый,
   башни не видно вообще. Пелена уходит первой, обнажая отдельные клубы;
   клубы разъезжаются на камеру и растворяются, ближние раньше дальних.
   К концу пролога остаётся только дымка у нижней кромки — она не уходит
   никогда, иначе проявится подиум.

   ПРОИЗВОДИТЕЛЬНОСТЬ. Анимируются transform и opacity, обе композиторные.
   Своего rAF нет: значения пишет единый цикл TowerSequence через
   setProgress. Теней нет, палитра холодная — по дизайн-системе.

   КОГДА ПРИЕДУТ КАДРЫ ИЗ BLENDER. Облака отрендерят в той же сцене, что
   и башню, двумя проходами — за башней и перед ней. Менять придётся
   только внутренности этого файла: вместо градиентных слоёв встанет
   canvas или <img> с покадровой секвенцией. Контракт наружу —
   `variant`, `apiRef.setProgress(p)` и `PROLOGUE_END` — остаётся,
   TowerSequence править не нужно. */

import { useImperativeHandle, useRef } from 'react';
import styles from './CloudLayer.module.css';

/** Доля прогресса секции, на которой облака полностью расходятся. */
export const PROLOGUE_END = 0.2;

export type CloudApi = { setProgress: (p: number) => void };

/* depth — во сколько раз слой разъезжается к концу пролога,
   out   — доля пролога, на которой слой уже растворился полностью. */
const FAR = [
  { depth: 1.5, out: 1.00 },
  { depth: 2.1, out: 0.90 },
];

const NEAR = [
  { depth: 3.2, out: 0.80 },
  { depth: 4.8, out: 0.64 },
  { depth: 7.0, out: 0.48 },
];

/** Пелена внутри облака: экран белый, пока не начали выходить. */
const VEIL_OUT = 0.42;

/* Дымка держится плотной до HAZE_HOLD и сжимается к HAZE_SHRINK_END.
   Значения подобраны по кадрам: диск подиума уходит из кадра примерно
   к трети подъёма. */
const HAZE_HOLD = 0.06;
const HAZE_SHRINK_END = 0.34;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type Props = {
  variant: 'far' | 'near';
  apiRef: React.RefObject<CloudApi | null>;
};

export default function CloudLayer({ variant, apiRef }: Props) {
  const near = variant === 'near';
  const spec = near ? NEAR : FAR;

  const layerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const veilRef = useRef<HTMLDivElement>(null);
  const hazeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef(false);

  useImperativeHandle(apiRef, () => ({
    setProgress(p: number) {
      // t — прогресс внутри пролога: 0 на старте, 1 когда облака разошлись
      const t = clamp01(p / PROLOGUE_END);

      /* Клубы и пелена отработали — снимаем их из отрисовки.
         В near-слое корень не прячем никогда: в нём живёт дымка. */
      const spent = t >= 1;
      if (spent !== hiddenRef.current) {
        hiddenRef.current = spent;
        const root = rootRef.current;
        if (root && !near) root.style.visibility = spent ? 'hidden' : 'visible';
      }

      if (!spent) {
        for (let i = 0; i < spec.length; i += 1) {
          const el = layerRefs.current[i];
          if (!el) continue;
          const { depth, out } = spec[i];
          const e = easeOutCubic(clamp01(t / out));
          el.style.transform = `scale(${1 + (depth - 1) * e})`;
          el.style.opacity = String(1 - e);
        }
      } else {
        for (let i = 0; i < spec.length; i += 1) {
          const el = layerRefs.current[i];
          if (el) el.style.opacity = '0';
        }
      }

      const veil = veilRef.current;
      if (veil) veil.style.opacity = String(1 - easeOutCubic(clamp01(t / VEIL_OUT)));

      /* Дымка живёт по прогрессу всей секции, а не только пролога:
         подиум держится в кадре примерно до трети подъёма, и всё это
         время низ должен быть закрыт. Дальше — тонкая постоянная полоса. */
      const h = easeOutCubic(clamp01((p - HAZE_HOLD) / (HAZE_SHRINK_END - HAZE_HOLD)));
      const haze = hazeRef.current;
      if (haze) {
        haze.style.transform = `scaleY(${1 - 0.62 * h})`;
        haze.style.opacity = String(1 - 0.15 * h);
      }
    },
  }), [near, spec]);

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${near ? styles.near : styles.far}`}
      aria-hidden="true"
    >
      {near && <div ref={veilRef} className={styles.veil} />}
      {spec.map((_, i) => (
        <div
          key={i}
          ref={(el) => { layerRefs.current[i] = el; }}
          className={`${styles.layer} ${styles[`${variant}${i}`]}`}
        />
      ))}
      {near && <div ref={hazeRef} className={styles.haze} />}
    </div>
  );
}
