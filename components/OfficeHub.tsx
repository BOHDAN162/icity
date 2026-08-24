'use client';

/* iCITY 113Н — офис. Полноэкранное состояние после входа в стекло.
   Путь в проекте: components/OfficeHub.tsx

   ЧТО ЭТО. Камера вошла в фасад — страница дальше не листается, вместо
   неё открывается офис. Пять зон, между ними ходят как по этажу: связи
   двусторонние, из любой комнаты можно вернуться в любую соседнюю.

   ОТКУДА БЕРУТСЯ УГЛЫ СТРЕЛОК. Не из порядка списка, а из плана
   `public/plan_113n_3652px.png`. Ниже лежат центроиды зон, снятые
   с чертежа, азимут считается на месте функцией `bearing`. Так угол
   физически не может разойтись с планом: поменяется чертёж — поменяются
   координаты, а не пятнадцать захардкоженных чисел.

   ГДЕ НАПРАВЛЕНИЕ ЧЕСТНО НЕ РАБОТАЕТ. Опенспейс тянется вдоль всей южной
   кромки, поэтому из него всё остальное лежит «на севере»: ресепшн и кухня
   расходятся всего на 1°, коридор и переговорная — на 10°. Из переговорной
   коридор и опенспейс расходятся на 9°. Стрелки там показывают правду,
   но правда эта неразличима — различает подпись, которая появляется
   по наведению и по фокусу, и aria-label, который стоит всегда.

   КОНТРАСТ. Рендеры светлые, поэтому под текстом лежит не плашка,
   а градиентная вуаль от кромки кадра в прозрачность. Она не украшение:
   её единственная задача — держать контраст. См. design-system.md,
   раздел «Вуаль». */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import PlanOverlay from './PlanOverlay';
import styles from './OfficeHub.module.css';

type ZoneId = 'reception' | 'corridor' | 'openspace' | 'kitchen' | 'meeting';

type Zone = {
  id: ZoneId;
  src: string;
  label: string;
  alt: string;
  /** сторона, с которой встаёт текстовый блок */
  side: 'left' | 'right';
  lines: string[];
  /** единственное красное на экране — ноль капзатрат */
  zero?: { caption: string; unit: string };
};

/* Центроиды зон в координатах чертежа, север — вверх, ось Y растёт на юг.
   Ресепшн в северо-западном углу, кухня с длинным столом в центре-севере,
   переговорная восточнее кухни, опенспейс занимает всю южную кромку,
   коридор — полоса между севером и югом. */
const CENTROID: Record<ZoneId, readonly [number, number]> = {
  reception: [495, 195],
  kitchen: [670, 630],
  meeting: [1280, 630],
  corridor: [1000, 850],
  openspace: [840, 1100],
};

/** Связи двусторонние: куда можно уйти, оттуда можно и вернуться. */
const EXITS: Record<ZoneId, readonly ZoneId[]> = {
  reception: ['corridor', 'openspace'],
  corridor: ['reception', 'kitchen', 'openspace', 'meeting'],
  kitchen: ['corridor', 'openspace'],
  openspace: ['reception', 'corridor', 'kitchen', 'meeting'],
  meeting: ['corridor', 'openspace'],
};

/** Азимут от зоны к зоне: 0° — север, дальше по часовой. */
const bearing = (from: ZoneId, to: ZoneId) => {
  const [ax, ay] = CENTROID[from];
  const [bx, by] = CENTROID[to];
  return (Math.atan2(bx - ax, ay - by) * 180) / Math.PI;
};

const ZONES: Record<ZoneId, Zone> = {
  reception: {
    id: 'reception',
    src: '/renders/render_2_reception.jpg',
    label: 'Ресепшн',
    alt: 'Ресепшн с рифлёной плиткой и отделкой из светлого дуба',
    side: 'left',
    lines: ['Отделка PRIDEX.'],
    zero: { caption: 'Капитальных затрат до въезда', unit: '₽' },
  },
  corridor: {
    id: 'corridor',
    src: '/renders/render_3_corridor.jpg',
    label: 'Коридор',
    alt: 'Коридор со стеклянными перегородками и дубовым полом',
    side: 'right',
    lines: ['Стеклянные перегородки, дубовый пол.', 'Проект и согласования сделаны.'],
  },
  openspace: {
    id: 'openspace',
    src: '/renders/render_1_openspace.jpg',
    label: 'Опенспейс',
    alt: 'Опенспейс на 26 рабочих мест с панорамным остеклением',
    side: 'left',
    lines: ['26 рабочих мест.', 'Мебель входит в аренду, докупать нечего.'],
  },
  meeting: {
    id: 'meeting',
    src: '/renders/render_5_meeting.jpg',
    label: 'Переговорная',
    alt: 'Переговорная на шесть человек с круглым дубовым столом',
    side: 'right',
    lines: ['На 6–8 человек.', 'Срок до въезда: день обращения, а не месяцы.'],
  },
  kitchen: {
    id: 'kitchen',
    src: '/renders/render_4_kitchen.jpg',
    label: 'Кухня-лаунж',
    alt: 'Кухня-столовая с барной стойкой на пять мест',
    side: 'left',
    lines: ['Барная группа на пять мест, техника установлена.'],
  },
};

const ORDER: ZoneId[] = ['reception', 'corridor', 'openspace', 'meeting', 'kitchen'];

/* Строка обязательная. Она стоит ноль и снимает риск целиком: ЛПР приедет
   смотреть в тот же день, и если картинка окажется красивее реальности,
   сделка умрёт на пороге. Не удалять. */
const DISCLAIMER =
  'Визуализация по дизайн-проекту. Помещение готово — приезжайте и сверьте с оригиналом.';

export default function OfficeHub({ open, onExit }: { open: boolean; onExit: () => void }) {
  const [zoneId, setZoneId] = useState<ZoneId>('reception');
  const [cameFrom, setCameFrom] = useState<ZoneId | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const go = useCallback((to: ZoneId) => {
    setZoneId((current) => { setCameFrom(current); return to; });
  }, []);

  /* Обход всегда начинается от двери. Сбрасываем на выходе, а не эффектом
     на open: setState в теле эффекта — ошибка линтера и лишний рендер. */
  const exit = useCallback(() => {
    setPlanOpen(false);
    setZoneId('reception');
    setCameFrom(null);
    onExit();
  }, [onExit]);

  const zone = ZONES[zoneId];

  const moves = useMemo(
    () => EXITS[zoneId].map((to) => ({
      to,
      angle: bearing(zoneId, to),
      label: ZONES[to].label,
      isReturn: to === cameFrom,
    })),
    [zoneId, cameFrom],
  );

  /* Клавиатура: стрелка выбирает ближайший по азимуту выход. Esc уводит
     к башне. Пока открыт план, он забирает клавиши себе. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (planOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); exit(); return; }
      const want =
        e.key === 'ArrowUp' ? 0 : e.key === 'ArrowRight' ? 90
        : e.key === 'ArrowDown' ? 180 : e.key === 'ArrowLeft' ? 270 : null;
      if (want === null) return;
      let best = null as null | { to: ZoneId; d: number };
      for (const m of moves) {
        const d = Math.abs(((m.angle - want + 540) % 360) - 180);
        if (d <= 67.5 && (!best || d < best.d)) best = { to: m.to, d };
      }
      if (best) { e.preventDefault(); go(best.to); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, planOpen, moves, go, exit]);

  // фокус переносим внутрь, иначе клавиатура остаётся на странице под офисом
  useEffect(() => { if (open) rootRef.current?.focus(); }, [open]);

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${open ? styles.open : ''}`}
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      role="dialog"
      aria-label="Помещение 113Н, обход по зонам"
    >
      {/* Кадры лежат стопкой и переключаются прозрачностью — без сдвигов */}
      <div className={styles.stage}>
        {ORDER.map((id) => {
          const z = ZONES[id];
          const on = id === zoneId;
          return (
            <Image
              key={id}
              className={`${styles.shot} ${on ? styles.shotOn : ''}`}
              src={z.src}
              alt={on ? z.alt : ''}
              aria-hidden={!on}
              draggable={false}
              fill
              sizes="100vw"
              style={{ objectFit: 'cover' }}
              loading={id === 'reception' ? 'eager' : 'lazy'}
            />
          );
        })}
      </div>

      {/* Вуали. Не декор: держат контраст текста поверх светлого рендера. */}
      <div className={styles.scrimTop} aria-hidden="true" />
      <div
        className={`${styles.scrimInfo} ${zone.side === 'right' ? styles.scrimInfoRight : styles.scrimInfoLeft}`}
        aria-hidden="true"
      />
      <div className={styles.scrimBottom} aria-hidden="true" />

      <div className={styles.ui}>
        <div className={styles.topRow}>
          <button type="button" className={styles.back} onClick={exit}>
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            К башне
          </button>

          <a className={styles.cta} href="#contact">Записаться на просмотр</a>
        </div>

        <div className={styles.bottom}>
          <div className={`${styles.info} ${zone.side === 'right' ? styles.infoRight : ''}`} key={zoneId}>
            <p className={`label ${styles.eyebrow}`}>Помещение 113Н</p>
            <h2 className={styles.zoneName}>{zone.label}</h2>

            {zone.zero && (
              <p className={styles.zeroRow}>
                <span className={`label ${styles.zeroCaption}`}>{zone.zero.caption}</span>
                <span className={styles.zero}>
                  0<span className={styles.zeroUnit}>{zone.zero.unit}</span>
                </span>
                {/* полоса растра под ключевым числом — design-system.md §1 */}
                <span className={styles.zeroStrip} aria-hidden="true" />
              </p>
            )}

            {zone.lines.map((line) => <p key={line} className={styles.line}>{line}</p>)}

            <button type="button" className={styles.planLink} onClick={() => setPlanOpen(true)}>
              Открыть планировку
            </button>
          </div>

          <nav className={styles.nav} aria-label="Переходы по помещению">
            {moves.map((m) => (
              <button
                key={m.to}
                type="button"
                className={`${styles.move} ${m.isReturn ? styles.moveReturn : ''}`}
                onClick={() => go(m.to)}
                aria-label={m.label}
              >
                {/* подпись видна по наведению и по фокусу; для скринридера
                    имя кнопки несёт aria-label, поэтому здесь aria-hidden */}
                <span className={styles.moveLabel} aria-hidden="true">{m.label}</span>
                <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
                  style={{ transform: `rotate(${m.angle.toFixed(1)}deg)` }}>
                  <path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor"
                    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </nav>

          <p className={styles.fine}>{DISCLAIMER}</p>
        </div>
      </div>

      <PlanOverlay open={planOpen} onClose={() => setPlanOpen(false)} />
    </div>
  );
}
