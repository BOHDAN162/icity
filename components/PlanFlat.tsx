'use client';

/* iCITY 113Н — плоский план: запасной путь кукольного дома.
   Путь в проекте: components/PlanFlat.tsx

   КОГДА ВКЛЮЧАЕТСЯ. Медленная сеть (slow-2g, 2g или Save-Data), нет WebGL,
   или система просит убрать движение. Во всех трёх случаях three.js не
   грузится вообще: этот путь стоит четыре килобайта JSON и ноль байт
   библиотек.

   ЧТО ЗДЕСЬ ВАЖНО. Информационный слой и переходы по зонам те же, что
   в объёмной версии, — их держит оболочка PlanDollhouse. Отличается
   только способ показать этаж. Требование из AGENTS.md про
   prefers-reduced-motion выполняется буквально: статичная картинка,
   весь текст и все числа на месте.

   ДОСТУПНОСТЬ. Полигон — это role="button" с aria-label и обработкой
   Enter и Space. Обводка фокуса нарисована штрихом, а не outline:
   у SVG-фигур outline лежит по габаритному прямоугольнику, а не по форме,
   и на скошенном опенспейсе это выглядит ошибкой. */

import { useMemo } from 'react';
import type { Plan, PlanZone, RenderKey, ZoneKey } from '@/lib/interior';
import styles from './PlanDollhouse.module.css';

const PAD = 0.5;                 // поля вокруг плана, в метрах
const LABEL_MIN_WIDTH = 3.2;     // зона уже — подпись не влезает, остаётся наведение

/* Шаг растра в метрах — тот же, что в объёмной версии (FRIT_STEP_M
   в PlanScene). Активная зона на плане заливается растром, а не ровным
   красным: design-system.md §1 отдаёт растру ровно четыре места, и это
   одно из них. Плоская заливка была бы нарушением в обеих версиях. */
const FRIT_STEP = 0.42;
const FRIT_DOT = FRIT_STEP * 0.175;

const bboxWidth = (poly: PlanZone['poly']) => {
  let min = Infinity;
  let max = -Infinity;
  for (const [x] of poly) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return max - min;
};

type Props = {
  plan: Plan;
  hovered: ZoneKey | null;
  onHover: (k: ZoneKey | null) => void;
  onPick: (k: RenderKey) => void;
};

export default function PlanFlat({ plan, hovered, onHover, onPick }: Props) {
  const [minX, minY, maxX, maxY] = plan.bounds;
  const view = `${minX - PAD} ${minY - PAD} ${maxX - minX + PAD * 2} ${maxY - minY + PAD * 2}`;

  const zones = useMemo(
    () => plan.zones.map((z) => ({
      z,
      points: z.poly.map(([x, y]) => `${x},${y}`).join(' '),
      wide: bboxWidth(z.poly) >= LABEL_MIN_WIDTH,
    })),
    [plan],
  );

  return (
    <div className={styles.canvasWrap}>
      <svg className={styles.flat} viewBox={view} role="group" aria-label="План помещения 113Н">
        <defs>
          <pattern id="frit" width={FRIT_STEP} height={FRIT_STEP} patternUnits="userSpaceOnUse">
            <circle cx={FRIT_STEP / 2} cy={FRIT_STEP / 2} r={FRIT_DOT} fill="var(--frit)" />
          </pattern>
        </defs>
        {zones.map(({ z, points, wide }) => {
          const on = hovered === z.key;
          const live = z.target !== null;
          return (
            <g key={z.key}>
              <polygon
                points={points}
                className={`${styles.flatZone} ${live ? styles.flatLive : styles.flatQuiet} ${on ? styles.flatOn : ''}`}
                role={live ? 'button' : undefined}
                tabIndex={live ? 0 : undefined}
                aria-label={live ? `${z.label}: войти в зону` : z.label}
                onMouseEnter={() => onHover(z.key)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(z.key)}
                onBlur={() => onHover(null)}
                onClick={() => z.target && onPick(z.target)}
                onKeyDown={(e) => {
                  if (!z.target) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(z.target); }
                }}
              />
              {wide && (
                <text
                  x={z.centroid[0]}
                  y={z.centroid[1]}
                  className={`${styles.flatLabel} ${on ? styles.flatLabelOn : ''}`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  aria-hidden="true"
                >
                  {z.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
