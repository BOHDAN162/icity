'use client';

/* iCITY 113Н — планировка поверх всего.
   Путь в проекте: components/PlanOverlay.tsx

   Пока это растр 3652×2535 с зумом и перетаскиванием. Векторная трасса
   с интерактивными зонами придёт позже — тогда меняется только начинка
   .sheet, а поведение окна (Esc, клик вне, возврат фокуса) остаётся.

   Числа на самом чертеже не подписываем: площади отдельных зон по нему
   не обмерены, а выдумывать нельзя — docs/facts.md, раздел «Чисел нет». */

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './PlanOverlay.module.css';

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

export default function PlanOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* Сбрасывать зум не нужно: при закрытии компонент размонтируется
       (ниже return null), состояние уходит вместе с ним. */
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    // capture: Esc принадлежит плану, пока он открыт, и не доходит до офиса
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const view = viewRef.current;
    if (!view || zoom === ZOOM_MIN) return;
    dragRef.current = { x: e.clientX, y: e.clientY, sl: view.scrollLeft, st: view.scrollTop };
    view.setPointerCapture(e.pointerId);
  }, [zoom]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const view = viewRef.current;
    const d = dragRef.current;
    if (!view || !d) return;
    view.scrollLeft = d.sl - (e.clientX - d.x);
    view.scrollTop = d.st - (e.clientY - d.y);
  }, []);

  const endDrag = useCallback(() => { dragRef.current = null; }, []);

  if (!open) return null;

  return (
    <div
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="Планировка помещения 113Н"
      /* клик мимо листа закрывает: цель события — сама подложка */
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.bar}>
        <p className={`label ${styles.title}`}>Планировка · 244,1 м²</p>

        <div className={styles.tools}>
          <button
            type="button"
            className={styles.tool}
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Отдалить"
          >−</button>
          <span className={`label ${styles.zoomValue}`}>{Math.round(zoom * 100)} %</span>
          <button
            type="button"
            className={styles.tool}
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Приблизить"
          >+</button>

          <button ref={closeRef} type="button" className={styles.close} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>

      <div
        ref={viewRef}
        className={`${styles.view} ${zoom > ZOOM_MIN ? styles.grab : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element --
            next/image здесь не подходит: ширину листа произвольно меняет
            зум, а нужен один исходник в полном разрешении, который таскают
            мышью. Оптимизация по вьюпорту тут только мешает. */}
        <img
          className={styles.sheet}
          src="/plan_113n_3652px.png"
          alt="План помещения 113Н площадью 244,1 м²"
          style={{ width: `${zoom * 100}%` }}
          draggable={false}
        />
      </div>
    </div>
  );
}
