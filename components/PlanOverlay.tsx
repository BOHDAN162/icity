'use client';

/* iCITY 113Н — чертёж помещения поверх всего.
   Путь в проекте: components/PlanOverlay.tsx

   ЧТО ЭТО. Ортогональный обмерный план 113Н с переключаемыми слоями.
   Открывается кнопкой «Чертёж» внутри кукольного дома, закрывается
   кнопкой, кликом мимо листа и Esc. Раньше здесь лежал растр 3652×2535
   на мегабайт; теперь вектор из public/interior/geometry.json — того
   самого файла, по которому собран сам кукольный дом.

   ТРИ ЧИСЛА В ПОДВАЛЕ. 244,1 м² по документам — это по контуру плиты.
   Сумма подписей на зонах равна чистому полу, 221,2. Разницу занимают
   перегородки и колонны. Без этой строки чертёж выглядит так, будто
   у него не сходится сумма, и объяснять это придётся на переговорах.

   ПАНЕЛЬ СЛОЁВ — ТРЕТЬЯ СТРОКА GRID, А НЕ АБСОЛЮТ. Абсолютом она
   накрывала нижние размерные подписи. Перекрыть лист ей теперь нечем.

   МАСШТАБ. Оболочка знает габарит листа в метрах и размер окна, значит
   знает `k` — пикселей на метр. Лист сам по себе безразмерный, кегль
   подписей внутри считается из `k`, и на любом зуме подпись остаётся
   13 px. Пересчёт идёт на изменении зума и размера окна, не на кадрах. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Drawing } from '@/lib/plan';
import { bboxOf, fmtArea, loadDrawing } from '@/lib/plan';
import { setCursorSheet } from '@/lib/cursorMode';
import PlanSheet, { MARGIN_PX, viewBoxOf, type Layers } from './PlanSheet';
import styles from './PlanOverlay.module.css';

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

const LAYER_LABEL: Record<keyof Layers, string> = {
  grid: 'Сетка',
  dim: 'Размеры',
  label: 'Названия',
  furn: 'Дизайн-проект мебели',
};

const num = (v: number) => v.toFixed(1).replace('.', ',');

export default function PlanOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [layers, setLayers] = useState<Layers>({ grid: true, dim: true, label: true, furn: false });
  const [hovered, setHovered] = useState<string | null>(null);
  /* Позиция курсора нужна только под подсказку, а подсказка живёт только
     при включённой мебели. В остальное время не пишем состояние вовсе:
     это движение мыши, и лишний setState на каждом кадре здесь не нужен. */
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [k0, setK0] = useState(0);            // пикселей на метр при зуме 100 %

  const closeRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  /* Свой курсор на листе — одна точка без кольца: кольцо в 56 px
     спорит с обмерными линиями и накрывает подписи зон целиком.
     Канал — lib/cursorMode.ts, курсор живёт в layout и пропом сюда
     не дотягивается. */
  useEffect(() => {
    setCursorSheet(open);
    return () => setCursorSheet(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    // capture: Esc принадлежит чертежу, пока он открыт, и не доходит до офиса
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadDrawing().then(
      (d) => { if (alive) setDrawing(d); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [open]);

  /* Вписать лист по меньшей стороне окна. Слушаем контейнер, а не window:
     панель слоёв на телефоне переносится в две строки и меняет высоту. */
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || !drawing) return;
    const [minX, minY, maxX, maxY] = drawing.bounds;
    const planW = maxX - minX;
    const planH = maxY - minY;
    const measure = () => {
      const cs = getComputedStyle(view);
      const w = view.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2 * MARGIN_PX;
      const h = view.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2 * MARGIN_PX;
      if (w > 0 && h > 0) setK0(Math.min(w / planW, h / planH));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    return () => ro.disconnect();
  }, [drawing]);

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

  const onMove = useCallback((e: React.PointerEvent) => {
    onPointerMove(e);
    if (!layers.furn) return;
    const box = e.currentTarget.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top });
  }, [onPointerMove, layers.furn]);

  /* Зум держит центр окна: иначе на 400 % уезжаешь в угол и теряешься. */
  const changeZoom = useCallback((next: number) => {
    const view = viewRef.current;
    setZoom((prev) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +next.toFixed(2)));
      if (view && z !== prev) {
        const ratio = z / prev;
        const cx = view.scrollLeft + view.clientWidth / 2;
        const cy = view.scrollTop + view.clientHeight / 2;
        requestAnimationFrame(() => {
          view.scrollLeft = cx * ratio - view.clientWidth / 2;
          view.scrollTop = cy * ratio - view.clientHeight / 2;
        });
      }
      return z;
    });
  }, []);

  if (!open) return null;

  const k = k0 * zoom;
  const vb = drawing && k > 0 ? viewBoxOf(drawing, k) : null;
  const sheetW = vb ? vb.w * k : 0;
  const room = drawing && hovered ? drawing.rooms.find((r) => r.key === hovered) ?? null : null;
  /* Габарит показываем только у изолированных помещений. У открытых зон
     он ничего не значит: описанный прямоугольник коридора — 18 × 8 м,
     хотя сам коридор шириной 1,2. Лучше не показать, чем соврать. */
  const roomBox = room && room.enclosed ? bboxOf(room.poly) : null;

  return (
    <div
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="Чертёж помещения 113Н"
      /* клик мимо листа закрывает: цель события — сама подложка */
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.bar}>
        <p className={`label ${styles.title}`}>Чертёж · 244,1 м²</p>

        <div className={styles.tools}>
          <button
            type="button"
            className={styles.tool}
            onClick={() => changeZoom(zoom - ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Отдалить"
          >−</button>
          <span className={`label ${styles.zoomValue}`}>{Math.round(zoom * 100)} %</span>
          <button
            type="button"
            className={styles.tool}
            onClick={() => changeZoom(zoom + ZOOM_STEP)}
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
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        /* палец уходит с листа без mouseleave — подсветка зависла бы
           вместе со строкой габарита в подвале */
        onPointerLeave={() => { endDrag(); setHovered(null); setTip(null); }}
      >
        {drawing && vb && sheetW > 0 && (
          <div className={styles.stage} style={{ width: sheetW, height: (sheetW * vb.h) / vb.w }}>
            <PlanSheet
              drawing={drawing}
              layers={layers}
              k={k}
              hovered={hovered}
              onHover={setHovered}
            />
          </div>
        )}
        {/* Подсказка у курсора: то же имя и метраж, что были бы на листе.
            Смещаем вправо; у правой кромки окна переставляем влево, иначе
            подсказка уезжает за край и её не прочитать. */}
        {layers.label && layers.furn && room && tip && (
          <p
            className={`label ${styles.tip}`}
            style={{
              left: tip.x + 16,
              top: tip.y - 10,
              transform: tip.x > (viewRef.current?.clientWidth ?? 0) - 220 ? 'translateX(-100%) translateX(-32px)' : undefined,
            }}
            aria-hidden="true"
          >
            {room.label} · {fmtArea(room.area_m2)}
          </p>
        )}
        {!drawing && (
          <p className={`label ${styles.state}`}>
            {failed ? 'Чертёж не загрузился' : 'Чертёж загружается'}
          </p>
        )}
      </div>

      <div className={styles.panel}>
        <div className={styles.toggles}>
          {(['grid', 'dim', 'label'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={styles.toggle}
              aria-pressed={layers[key]}
              onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
            >
              <span className={styles.swatch} aria-hidden="true" />
              {LAYER_LABEL[key]}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.toggle} ${styles.toggleWide}`}
            aria-pressed={layers.furn}
            onClick={() => setLayers((l) => ({ ...l, furn: !l.furn }))}
          >
            <span className={styles.swatch} aria-hidden="true" />
            {LAYER_LABEL.furn}
          </button>
        </div>

        {/* Строка сводных площадей снята по решению заказчика 1 сентября 2026:
            на листе остаётся только то, что показывает наведение. Место
            под неё держим всегда, иначе панель дёргается под курсором. */}
        <p className={`label ${styles.totals}`}>
          {room
            ? `${room.label} · ${fmtArea(room.area_m2)}${roomBox ? ` · ${num(roomBox.w)} × ${num(roomBox.h)} м` : ''}`
            : ''}
        </p>
      </div>

      {/* Тот же состав данных для клавиатуры и скринридера: полигоны на
          листе ничего не открывают, фокусировать там нечего. */}
      {drawing && (
        <ul className={styles.sr}>
          {drawing.rooms.map((r) => {
            const b = bboxOf(r.poly);
            return (
              <li key={r.key}>
                {r.label}: {fmtArea(r.area_m2)}
                {r.enclosed
                  ? `, изолированное помещение, габарит ${num(b.w)} на ${num(b.h)} метра`
                  : ', часть открытого пространства'}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
