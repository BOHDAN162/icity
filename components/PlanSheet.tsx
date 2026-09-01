'use client';

/* iCITY 113Н — лист чертежа.
   Путь в проекте: components/PlanSheet.tsx

   ЧИСТЫЙ РЕНДЕР. Компонент ничего не считает и ничего не хранит: всё
   приходит из lib/plan.ts, состояние слоёв и зум держит оболочка
   PlanOverlay. Здесь только SVG.

   МАСШТАБ И ТЕКСТ. viewBox — в метрах, поэтому стены масштабируются
   честно: перегородка 250 мм и на бумаге 250 мм. А подписи и волосяные
   линии должны оставаться одного размера на экране при любом зуме —
   как на настоящем листе. Поэтому кегль считается из `k` (пикселей
   на метр), а обводки идут через vector-effect: non-scaling-stroke.
   Растр наведения тоже размечен в экранных пикселях — это буквально
   --frit-mid из токенов: точка 1,1 px с шагом 12 px.

   ПОРЯДОК СЛОЁВ ВАЖЕН. Пунктир границ зонирования рисуется ДО стен:
   там, где по этой линии стоит перегородка, поше её закрывает, и
   пунктир виден ровно там, где стены нет. Считать пересечения не нужно. */

import { useMemo } from 'react';
import type { Door, Drawing, Furn, Ring, Room, Wall } from '@/lib/plan';
import { pickLabel } from '@/lib/plan';
import styles from './PlanOverlay.module.css';

export type Layers = { grid: boolean; dim: boolean; label: boolean; furn: boolean };

type Props = {
  drawing: Drawing;
  layers: Layers;
  /** пикселей на метр при текущем зуме */
  k: number;
  hovered: string | null;
  onHover: (key: string | null) => void;
};

const NAME_PX = 13;
const AREA_PX = 11;
const DIM_PX = 11;

/* Поля под размерные цепочки задаются в ПИКСЕЛЯХ, а не в метрах.
   Размерная линия отступает от плана на метры, а её подпись — на кегль,
   то есть на пиксели. При зуме 100 % на телефоне метр это 16 px, на
   десктопе 44: поле, посчитанное в метрах, на телефоне срежет подписи,
   на десктопе оставит пустую рамку. Поэтому поле постоянное на экране,
   а в метры его переводит текущий масштаб. */
export const MARGIN_PX = 52;

/** Габарит листа. Нужен и здесь, и оболочке: она считает из него размер
    <svg> в пикселях, а k — сколько пикселей приходится на метр. */
export const viewBoxOf = (d: Drawing, k: number) => {
  const [minX, minY, maxX, maxY] = d.bounds;
  const m = MARGIN_PX / k;
  return { x: minX - m, y: minY - m, w: maxX - minX + 2 * m, h: maxY - minY + 2 * m };
};

const pts = (r: Ring) => r.map(([x, y]) => `${x},${y}`).join(' ');

/** Стена прямоугольником. Стены не сливаются в один полигон и не должны:
    на стыке два прямоугольника одного цвета дают ровно то же поше, что
    и объединение, а считать булеву операцию — лишний код и лишний риск. */
const wallRect = (w: Wall, th: number) => (w.o === 'h'
  ? { x: w.p1, y: w.pos - th / 2, width: w.p2 - w.p1, height: th }
  : { x: w.pos - th / 2, y: w.p1, width: th, height: w.p2 - w.p1 });

/** Прямоугольник вокруг отрезка — так диагональная стена получает толщину. */
const thick = (x1: number, y1: number, x2: number, y2: number, th: number): Ring => {
  const dx = x2 - x1; const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (th / 2); const ny = (dx / len) * (th / 2);
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
};

const rad = (deg: number) => (deg * Math.PI) / 180;

const doorPath = (d: Door) => {
  const p0 = [d.hx + d.r * Math.cos(rad(d.a0)), d.hy + d.r * Math.sin(rad(d.a0))];
  const p1 = [d.hx + d.r * Math.cos(rad(d.a1)), d.hy + d.r * Math.sin(rad(d.a1))];
  const delta = ((d.a1 - d.a0 + 540) % 360) - 180;
  const sweep = delta > 0 ? 1 : 0;
  return {
    leaf: `M${d.hx} ${d.hy}L${p0[0]} ${p0[1]}`,
    arc: `M${p0[0]} ${p0[1]}A${d.r} ${d.r} 0 0 ${sweep} ${p1[0]} ${p1[1]}`,
  };
};

/* --- мебель ------------------------------------------------------------ */

function Piece({ f, i }: { f: Furn; i: number }) {
  const x = f.x ?? 0; const y = f.y ?? 0; const w = f.w ?? 0; const h = f.h ?? 0;
  const spin = f.a ? `rotate(${f.a} ${x + w / 2} ${y + h / 2})` : undefined;

  if (f.t === 'c') {
    return <circle cx={f.cx} cy={f.cy} r={f.rad} />;
  }
  if (f.t === 'cab') {
    const n = f.n ?? 1;
    const vertical = f.dir === 'v';
    const step = (vertical ? w : h) / n;
    const lines = [];
    for (let s = 1; s < n; s += 1) {
      lines.push(vertical
        ? <line key={s} x1={x + step * s} y1={y} x2={x + step * s} y2={y + h} />
        : <line key={s} x1={x} y1={y + step * s} x2={x + w} y2={y + step * s} />);
    }
    const cross = [];
    if (f.x2) {
      // крест ставим в крайних секциях: так шкаф читается шкафом, а не сеткой
      const cells = n < 2 ? [0] : [0, n - 1];
      for (const c of cells) {
        const cx0 = vertical ? x + step * c : x;
        const cy0 = vertical ? y : y + step * c;
        const cw = vertical ? step : w;
        const ch = vertical ? h : step;
        cross.push(<path key={`x${c}`} d={`M${cx0} ${cy0}l${cw} ${ch}M${cx0 + cw} ${cy0}l${-cw} ${ch}`} />);
      }
    }
    return <g transform={spin}><rect x={x} y={y} width={w} height={h} />{lines}{cross}</g>;
  }
  if (f.t === 'rail') {
    // вешало: плечики поперёк штанги
    const ticks = [];
    const n = Math.max(2, Math.round(h / 0.19));
    for (let s = 0; s <= n; s += 1) {
      const yy = y + (h * s) / n;
      ticks.push(<line key={s} x1={x} y1={yy} x2={x + w} y2={yy + 0.10} />);
    }
    return <g><rect x={x} y={y} width={w} height={h} />{ticks}</g>;
  }
  if (f.t === 'hob') {
    const r = Math.min(w, h) * 0.19;
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={0.03} />
        <circle cx={x + w * 0.3} cy={y + h * 0.3} r={r} />
        <circle cx={x + w * 0.7} cy={y + h * 0.3} r={r} />
        <circle cx={x + w * 0.3} cy={y + h * 0.7} r={r} />
        <circle cx={x + w * 0.7} cy={y + h * 0.7} r={r} />
      </g>
    );
  }
  if (f.t === 'sink') {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={0.05} />
        <rect x={x + w * 0.12} y={y + h * 0.18} width={w * 0.76} height={h * 0.64} rx={0.05} />
        <circle cx={x + w / 2} cy={y + h / 2} r={0.035} />
      </g>
    );
  }
  if (f.t === 'wc') {
    return (
      <g>
        <rect x={x} y={y} width={w * 0.22} height={h} rx={0.03} />
        <rect x={x + w * 0.22} y={y + h * 0.08} width={w * 0.78} height={h * 0.84} rx={h * 0.32} />
      </g>
    );
  }
  if (f.t === 'fridge') {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} />
        <line x1={x + w * 0.5} y1={y} x2={x + w * 0.5} y2={y + h} />
      </g>
    );
  }
  if (f.t === 'tv') {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} />
        <rect x={x + w * 0.16} y={y + h * 0.2} width={w * 0.68} height={h * 0.6} />
      </g>
    );
  }
  return <rect key={i} x={x} y={y} width={w} height={h} rx={f.rr ?? 0} transform={spin} />;
}

/* --- лист --------------------------------------------------------------- */

export default function PlanSheet({ drawing, layers, k, hovered, onHover }: Props) {
  const [minX, minY, maxX, maxY] = drawing.bounds;
  const vb = viewBoxOf(drawing, k);
  const view = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;

  const slab = pts(drawing.slab);
  const u = 1 / k;                      // метров на пиксель

  const grid = useMemo(() => {
    const d: string[] = [];
    for (let x = Math.ceil(minX); x <= maxX; x += 1) d.push(`M${x} ${minY}V${maxY}`);
    for (let y = Math.ceil(minY); y <= maxY; y += 1) d.push(`M${minX} ${y}H${maxX}`);
    return d.join('');
  }, [minX, minY, maxX, maxY]);

  const labels = useMemo(
    () => drawing.rooms.map((r: Room) => ({
      key: r.key,
      c: r.anchor,
      ...pickLabel(r, k, NAME_PX, AREA_PX),
    })),
    [drawing.rooms, k],
  );

  return (
    <svg className={styles.sheet} viewBox={view} role="img"
      aria-label={`Чертёж помещения 113Н, ${drawing.areaDoc.toFixed(1).replace('.', ',')} м² по контуру`}>
      <defs>
        <pattern id="planFrit" width={12 * u} height={12 * u} patternUnits="userSpaceOnUse">
          <circle cx={6 * u} cy={6 * u} r={1.1 * u} fill="var(--frit)" />
        </pattern>
        <clipPath id="planSlab"><polygon points={slab} /></clipPath>
      </defs>

      <polygon className={styles.paper} points={slab} />

      {layers.grid && <path className={styles.grid} d={grid} clipPath="url(#planSlab)" />}

      <g clipPath="url(#planSlab)">
        {hovered && drawing.rooms.filter((r) => r.key === hovered).map((r) =>
          r.poly.map((ring, i) => (
            <polygon key={`${r.key}-${i}`} className={styles.hot} points={pts(ring)} />
          )))}
        {layers.label && (
          <g className={styles.zoneEdge}>
            {drawing.rooms.map((r) => r.poly.map((ring, i) => (
              <polygon key={`${r.key}-${i}`} points={pts(ring)} />
            )))}
          </g>
        )}
      </g>

      {/* Наружная стена — обводка контура двойной толщины, обрезанная самим
          контуром: внешняя половина уходит под clip, внутри остаётся ровно
          полоса shellTh. Смещать многоугольник со скошенным углом ради
          этого не нужно. Стены и колонны тоже режем контуром — трассировка
          местами на пару сантиметров выходит за плиту. */}
      <g className={styles.wall} clipPath="url(#planSlab)">
        <polygon className={styles.shell} points={slab} strokeWidth={drawing.shellTh * 2} />
        {drawing.walls.map((w, i) => <rect key={i} {...wallRect(w, drawing.wallTh)} />)}
        {drawing.diag.map((d, i) => (
          <polygon key={`d${i}`} points={pts(thick(d.x1, d.y1, d.x2, d.y2, drawing.shellTh))} />
        ))}
        {drawing.columns.map((c, i) => <circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.d / 2} />)}
        {drawing.solids.map((c, i) => (
          <rect key={`s${i}`} x={c.x} y={c.y} width={c.w} height={c.h} />
        ))}
      </g>
      <polygon className={styles.outline} points={slab} />

      {/* Окно — это разрыв в стене, а не линия поверх неё. Сначала пробиваем
          проём во всю толщину наружного кольца, потом кладём в него нитку
          стекла. Иначе на чёрном поше остекления просто не видно. */}
      <g className={styles.opening}>
        {drawing.glazingFacade.map((g, i) => (
          <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
            strokeWidth={drawing.shellTh} />
        ))}
      </g>
      <g className={styles.glazing}>
        {drawing.glazingFacade.map((g, i) => (
          <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
        ))}
      </g>
      <g className={styles.glazingIn}>
        {drawing.glazingInterior.map((g, i) => (
          <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
        ))}
      </g>
      <g className={styles.mullion}>
        {drawing.mullions.map((m, i) => (
          <circle key={i} cx={m.cx} cy={m.cy} r={drawing.mullionW / 2} />
        ))}
      </g>

      <g className={styles.door}>
        {drawing.doors.map((d, i) => {
          const p = doorPath(d);
          return <g key={i}><path className={styles.leaf} d={p.leaf} /><path d={p.arc} /></g>;
        })}
      </g>

      {layers.furn && (
        <g className={styles.furn}>
          {drawing.furniture.map((f, i) => <Piece key={i} f={f} i={i} />)}
        </g>
      )}

      <g>
        {drawing.rooms.map((r) => r.poly.map((ring, i) => (
          <polygon
            key={`${r.key}-${i}`}
            className={styles.hit}
            points={pts(ring)}
            clipPath="url(#planSlab)"
            onMouseEnter={() => onHover(r.key)}
            onMouseLeave={() => onHover(null)}
          />
        )))}
      </g>

      {/* Слой мебели и подписи зон на одном листе спорят: линии мебели
          лезут под текст. Поэтому при включённой мебели имя и метраж
          уходят к курсору — их показывает оболочка. */}
      {layers.label && !layers.furn && (
        <g className={styles.labels} aria-hidden="true">
          {labels.map((l) => (
            <g key={l.key} transform={l.rot ? `rotate(-90 ${l.c[0]} ${l.c[1]})` : undefined}>
              {l.name && (
                <text className={styles.zoneName} x={l.c[0]} y={l.c[1]}
                  fontSize={NAME_PX * u} dy={l.area ? -8 * u : 5 * u}>{l.name}</text>
              )}
              {l.area && (
                <text className={styles.zoneArea} x={l.c[0]} y={l.c[1]}
                  fontSize={AREA_PX * u} dy={l.name ? 9 * u : 5 * u}>{l.area}</text>
              )}
            </g>
          ))}
        </g>
      )}

      {layers.dim && (
        <g className={styles.dims} aria-hidden="true">
          {drawing.dimensions.map((d, i) => {
            const dx = d.x2 - d.x1; const dy = d.y2 - d.y1;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len; const ny = dx / len;
            const ax = d.x1 + nx * d.off; const ay = d.y1 + ny * d.off;
            const bx = d.x2 + nx * d.off; const by = d.y2 + ny * d.off;
            const tick = 4 * u;
            let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
            if (Math.abs(dx) < Math.abs(dy) && dy > 0) ang -= 180;
            const s = Math.sign(d.off) || 1;
            const tx = (ax + bx) / 2 + nx * s * 9 * u;
            const ty = (ay + by) / 2 + ny * s * 9 * u;
            return (
              <g key={i}>
                <path className={styles.ext} d={`M${d.x1} ${d.y1}L${ax + nx * s * 3 * u} ${ay + ny * s * 3 * u}M${d.x2} ${d.y2}L${bx + nx * s * 3 * u} ${by + ny * s * 3 * u}`} />
                <path className={styles.dimLine} d={`M${ax} ${ay}L${bx} ${by}`} />
                <path className={styles.dimTick}
                  d={`M${ax - nx * tick} ${ay - ny * tick}L${ax + nx * tick} ${ay + ny * tick}M${bx - nx * tick} ${by - ny * tick}L${bx + nx * tick} ${by + ny * tick}`} />
                <text x={tx} y={ty} fontSize={DIM_PX * u} transform={`rotate(${ang} ${tx} ${ty})`}>{d.text}</text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
