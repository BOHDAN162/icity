'use client';

/* iCITY 113Н — офис. Полноэкранное состояние после входа в стекло.
   Путь в проекте: components/OfficeHub.tsx

   ЧТО ЭТО. Камера вошла в фасад — страница дальше не листается, вместо
   неё открывается офис. Пять зон в порядке обхода, как ходит человек:
   ресепшн, проход, опенспейс, переговорная, кухня-лаунж. Смена зоны —
   мягкое перекрёстное растворение, без сдвигов.

   ЗАЧЕМ КАРТОЧКИ. Аргументы, которые закрывают сделку, раньше жили на
   отдельных экранах. Здесь они привязаны к зоне: человек смотрит на
   опенспейс и рядом читает, что мест 26 и мебель входит в аренду.
   Карточка меняет сторону от зоны к зоне, чтобы не закрывать то, что
   в кадре главное.

   КОНТРАСТ. Рендеры светлые, поэтому текст никогда не ложится прямо на
   картинку: и подпись зоны, и карточка стоят на сплошной --paper.
   Теней нет ни одной — вместо них плотный фон и линия --alu.

   ЧИСЛА. Только из docs/facts.md: 26 рабочих мест, переговорная на 6–8,
   барная группа на 5 мест, 0 ₽ капитальных затрат. */

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import PlanOverlay from './PlanOverlay';
import styles from './OfficeHub.module.css';

type Zone = {
  id: string;
  src: string;
  label: string;
  alt: string;
  /** сторона, с которой встаёт карточка */
  side: 'left' | 'right';
  lines: string[];
  /** первая карточка несёт единственное красное на экране — ноль капзатрат */
  zero?: { before: string; after: string };
  /** куда можно уйти отсюда и в какую сторону это на плане */
  exits: Exit[];
};

/* Направления взяты от лица человека, который стоит в зоне и смотрит
   вперёд по ходу обхода. Обратный переход — зеркало прямого: если сюда
   пришли «вперёд-налево», то назад это «назад-направо». */
type Dir = 'forward-left' | 'forward' | 'forward-right' | 'back-right' | 'back';
type Exit = { dir: Dir; to: string };

/** Поворот стрелки в градусах. Базовая стрелка смотрит вверх. */
const DIR_ANGLE: Record<Dir, number> = {
  'forward-left': -45,
  forward: 0,
  'forward-right': 45,
  'back-right': 135,
  back: 180,
};

const IS_BACK: Record<Dir, boolean> = {
  'forward-left': false,
  forward: false,
  'forward-right': false,
  'back-right': true,
  back: true,
};

const ZONES: Zone[] = [
  {
    id: 'reception',
    src: '/renders/render_2_reception.jpg',
    label: 'Ресепшн',
    alt: 'Ресепшн с рифлёной плиткой и отделкой из светлого дуба',
    side: 'left',
    lines: ['Отделка PRIDEX.'],
    zero: { before: 'Капитальных затрат до въезда', after: '₽' },
    exits: [{ dir: 'forward-left', to: 'corridor' }],
  },
  {
    id: 'corridor',
    src: '/renders/render_3_corridor.jpg',
    label: 'Проход вдоль опенспейса',
    alt: 'Проход вдоль опенспейса со стеклянными перегородками и дубовым полом',
    side: 'right',
    lines: ['Стеклянные перегородки, дубовый пол.', 'Проект и согласования сделаны.'],
    /* Развилка обхода: кухня раньше по ходу и левее, переговорная прямо
       по курсу, опенспейс идёт справа вдоль всего прохода. Ресепшн
       остался позади и правее — зеркало входа «вперёд-налево». */
    exits: [
      { dir: 'forward-left', to: 'kitchen' },
      { dir: 'forward', to: 'meeting' },
      { dir: 'forward-right', to: 'openspace' },
      { dir: 'back-right', to: 'reception' },
    ],
  },
  {
    id: 'openspace',
    src: '/renders/render_1_openspace.jpg',
    label: 'Опенспейс',
    alt: 'Опенспейс на 26 рабочих мест с панорамным остеклением',
    side: 'left',
    lines: ['26 рабочих мест.', 'Мебель входит в аренду, докупать нечего.'],
    exits: [{ dir: 'back', to: 'corridor' }],
  },
  {
    id: 'meeting',
    src: '/renders/render_5_meeting.jpg',
    label: 'Переговорная',
    alt: 'Переговорная на шесть человек с круглым дубовым столом',
    side: 'right',
    lines: ['На 6–8 человек.', 'Срок до въезда: день обращения, а не месяцы.'],
    exits: [{ dir: 'back', to: 'corridor' }],
  },
  {
    id: 'kitchen',
    src: '/renders/render_4_kitchen.jpg',
    label: 'Кухня-лаунж',
    alt: 'Кухня-столовая с барной стойкой на пять мест',
    side: 'left',
    lines: ['Барная группа на пять мест, техника установлена.'],
    exits: [{ dir: 'back', to: 'corridor' }],
  },
];

const BY_ID = new Map(ZONES.map((z) => [z.id, z]));

/* Строка обязательная. Она стоит ноль и снимает риск целиком: ЛПР приедет
   смотреть в тот же день, и если картинка окажется красивее реальности,
   сделка умрёт на пороге. Не удалять. */
const DISCLAIMER =
  'Визуализация по дизайн-проекту. Помещение готово — приезжайте и сверьте с оригиналом.';

export default function OfficeHub({ open, onExit }: { open: boolean; onExit: () => void }) {
  const [zoneId, setZoneId] = useState('reception');
  const [planOpen, setPlanOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const go = useCallback((to: string) => setZoneId(to), []);

  /* Обход всегда начинается от двери. Сбрасываем на выходе, а не эффектом
     на open: setState в теле эффекта — ошибка линтера и лишний рендер. */
  const exit = useCallback(() => {
    setPlanOpen(false);
    setZoneId('reception');
    onExit();
  }, [onExit]);

  /* Клавиатура: стрелки листают зоны, Esc уводит назад на башню.
     Пока открыт план, он забирает Esc себе. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (planOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); exit(); return; }

      /* Стрелки повторяют пространственные направления, а не ленту:
         вверх — прямо, влево и вправо — по диагоналям вперёд,
         вниз — любой из обратных выходов. */
      const exits = BY_ID.get(zoneId)?.exits ?? [];
      const pick = (...dirs: Dir[]) => exits.find((x) => dirs.includes(x.dir));
      const hit =
        e.key === 'ArrowUp' ? pick('forward')
        : e.key === 'ArrowLeft' ? pick('forward-left')
        : e.key === 'ArrowRight' ? pick('forward-right')
        : e.key === 'ArrowDown' ? pick('back', 'back-right')
        : undefined;
      if (hit) { e.preventDefault(); go(hit.to); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, planOpen, go, exit, zoneId]);

  // фокус переносим внутрь, иначе клавиатура остаётся на странице под офисом
  useEffect(() => {
    if (open) rootRef.current?.focus();
  }, [open]);

  const zone = BY_ID.get(zoneId) ?? ZONES[0];

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${open ? styles.open : ''}`}
      // пока офис закрыт — он не в потоке чтения и не ловит фокус
      aria-hidden={!open}
      inert={!open}
      tabIndex={-1}
      role="dialog"
      aria-label="Помещение 113Н, обход по зонам"
    >
      {/* Кадры лежат стопкой и переключаются прозрачностью — без сдвигов */}
      <div className={styles.stage}>
        {ZONES.map((z) => {
          const on = z.id === zoneId;
          return (
            <Image
              key={z.id}
              className={`${styles.shot} ${on ? styles.shotOn : ''}`}
              src={z.src}
              alt={on ? z.alt : ''}
              aria-hidden={!on}
              draggable={false}
              fill
              sizes="100vw"
              style={{ objectFit: 'cover' }}
              /* ресепшн нужен сразу, остальные — по мере надобности */
              loading={z.id === 'reception' ? 'eager' : 'lazy'}
            />
          );
        })}
      </div>

      <div className={styles.ui}>
        <div className={styles.topRow}>
          <button type="button" className={styles.back} onClick={exit}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            К башне
          </button>

          <a className={`btn ${styles.cta}`} href="#contact">
            Записаться на просмотр
          </a>
        </div>

        <div className={`${styles.body} ${zone.side === 'right' ? styles.bodyRight : ''}`}>
          <div className={styles.card} key={zone.id}>
            <p className={`label ${styles.counter}`}>Помещение 113Н</p>
            <h2 className={styles.zoneLabel}>{zone.label}</h2>

            {zone.zero && (
              <p className={styles.zeroRow}>
                <span className={`label ${styles.zeroCaption}`}>{zone.zero.before}</span>
                <span className={styles.zero}>
                  0<span className={styles.zeroUnit}>{zone.zero.after}</span>
                </span>
                {/* полоса растра под ключевым числом — design-system.md §1 */}
                <span className={styles.zeroStrip} aria-hidden="true" />
              </p>
            )}

            {zone.lines.map((line) => (
              <p key={line} className={styles.line}>{line}</p>
            ))}

            <button type="button" className={styles.planLink} onClick={() => setPlanOpen(true)}>
              Открыть планировку
            </button>
          </div>
        </div>

        <div className={styles.bottomRow}>
          <p className={styles.disclaimer}>{DISCLAIMER}</p>

          {/* Направления, а не лента: стрелка повёрнута туда, где зона
              лежит на плане, рядом — куда именно ведёт кнопка. */}
          <nav className={styles.nav} aria-label="Переходы по помещению">
            {zone.exits.map((ex) => {
              const dest = BY_ID.get(ex.to);
              if (!dest) return null;
              const back = IS_BACK[ex.dir];
              return (
                <button
                  key={ex.to}
                  type="button"
                  className={`${styles.move} ${back ? styles.moveBack : ''}`}
                  onClick={() => go(ex.to)}
                >
                  <span className={styles.moveArrow} aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      style={{ transform: `rotate(${DIR_ANGLE[ex.dir]}deg)` }}
                    >
                      <path
                        d="M12 19V5m0 0-6 6m6-6 6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {dest.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <PlanOverlay open={planOpen} onClose={() => setPlanOpen(false)} />
    </div>
  );
}
