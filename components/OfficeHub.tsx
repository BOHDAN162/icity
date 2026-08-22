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
  },
  {
    id: 'corridor',
    src: '/renders/render_3_corridor.jpg',
    label: 'Проход вдоль опенспейса',
    alt: 'Проход вдоль опенспейса со стеклянными перегородками и дубовым полом',
    side: 'right',
    lines: ['Стеклянные перегородки, дубовый пол.', 'Проект и согласования сделаны.'],
  },
  {
    id: 'openspace',
    src: '/renders/render_1_openspace.jpg',
    label: 'Опенспейс',
    alt: 'Опенспейс на 26 рабочих мест с панорамным остеклением',
    side: 'left',
    lines: ['26 рабочих мест.', 'Мебель входит в аренду, докупать нечего.'],
  },
  {
    id: 'meeting',
    src: '/renders/render_5_meeting.jpg',
    label: 'Переговорная',
    alt: 'Переговорная на шесть человек с круглым дубовым столом',
    side: 'right',
    lines: ['На 6–8 человек.', 'Срок до въезда: день обращения, а не месяцы.'],
  },
  {
    id: 'kitchen',
    src: '/renders/render_4_kitchen.jpg',
    label: 'Кухня-лаунж',
    alt: 'Кухня-столовая с барной стойкой на пять мест',
    side: 'left',
    lines: ['Барная группа на пять мест, техника установлена.'],
  },
];

/* Строка обязательная. Она стоит ноль и снимает риск целиком: ЛПР приедет
   смотреть в тот же день, и если картинка окажется красивее реальности,
   сделка умрёт на пороге. Не удалять. */
const DISCLAIMER =
  'Визуализация по дизайн-проекту. Помещение готово — приезжайте и сверьте с оригиналом.';

export default function OfficeHub({ open, onExit }: { open: boolean; onExit: () => void }) {
  const [index, setIndex] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const go = useCallback((dir: 1 | -1) => {
    setIndex((i) => (i + dir + ZONES.length) % ZONES.length);
  }, []);

  /* Обход всегда начинается от двери. Сбрасываем на выходе, а не эффектом
     на open: setState в теле эффекта — ошибка линтера и лишний рендер. */
  const exit = useCallback(() => {
    setPlanOpen(false);
    setIndex(0);
    onExit();
  }, [onExit]);

  /* Клавиатура: стрелки листают зоны, Esc уводит назад на башню.
     Пока открыт план, он забирает Esc себе. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (planOpen) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); exit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, planOpen, go, exit]);

  // фокус переносим внутрь, иначе клавиатура остаётся на странице под офисом
  useEffect(() => {
    if (open) rootRef.current?.focus();
  }, [open]);

  const zone = ZONES[index];

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
        {ZONES.map((z, i) => (
          <Image
            key={z.id}
            className={`${styles.shot} ${i === index ? styles.shotOn : ''}`}
            src={z.src}
            alt={i === index ? z.alt : ''}
            aria-hidden={i !== index}
            draggable={false}
            fill
            sizes="100vw"
            style={{ objectFit: 'cover' }}
            /* первый кадр нужен сразу, остальные — по мере надобности */
            loading={i === 0 ? 'eager' : 'lazy'}
          />
        ))}
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
            <p className={`label ${styles.counter}`}>
              {index + 1} / {ZONES.length} · Помещение 113Н
            </p>
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

          <div className={styles.nav}>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => go(-1)}
              aria-label={`Предыдущая зона: ${ZONES[(index - 1 + ZONES.length) % ZONES.length].label}`}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => go(1)}
              aria-label={`Следующая зона: ${ZONES[(index + 1) % ZONES.length].label}`}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <PlanOverlay open={planOpen} onClose={() => setPlanOpen(false)} />
    </div>
  );
}
