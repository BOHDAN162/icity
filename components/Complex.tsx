/* iCITY 113Н — комплекс (вариант C1: список удобств и кадр рядом).
   Путь в проекте: components/Complex.tsx

   Пять строк слева, одна рамка справа. Наведение на строку меняет кадр
   спокойным кроссфейдом на 250 мс — и это всё движение, какое здесь есть.

   РАСТРОВОГО ПРОЯВЛЕНИЯ ЗДЕСЬ БОЛЬШЕ НЕТ И ВОЗВРАЩАТЬ ЕГО НЕ НАДО.
   Кадр открывался из полутоновой сетки точек поверх фотографии
   (lib/halftone.ts, холст с getImageData). Заказчик посмотрел вживую
   и снял эффект: точки читались как артефакт загрузки, а не как приём.
   Вместе с ним уехали холст, ResizeObserver, кэш из пяти растров
   и весь модуль halftone.

   ЧИСЛА — docs/facts.md: стилобат 14 760 м², паркинг 950 мест на шести
   уровнях, Space Tower 258 м и 61 этаж. Высота башен в ТЗ заказчика
   указана неверно, сверяться можно только с docs/facts.md. Обстановка
   помещения в этой секции не упоминается вовсе: речь про комплекс,
   а не про 113Н.

   КАДРЫ — public/complex/{atrium,garden,gallery,parking,smart}.jpg.
   Сейчас все пять заглушки: съёмки комплекса ещё не было. Признак
   заглушки не угадывается по имени файла, а лежит в манифесте
   public/complex/placeholders.json, который пишет
   scripts/gen-complex-placeholders.mjs. Приедут настоящие кадры —
   их кладут теми же именами, скрипт правит манифест, код не меняется.

   ЧТО ГРУЗИТСЯ И КОГДА. Ни одного байта до подхода к секции:
   IntersectionObserver с rootMargin 200px монтирует <img>, отписывается
   и больше не живёт. Дальше секция не считает вообще ничего —
   ни на кадрах прокрутки, ни на ресайзе.

   ДОСТУПНОСТЬ. Строки — настоящие <button>: Enter и Space приходят
   сами, фокус ведёт кадр так же, как мышь, aria-pressed говорит,
   какая строка открыта. Глобальных обработчиков клавиш нет — их на
   сайте нет нигде, кроме Esc в офисе (AGENTS.md). */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import manifest from '@/public/complex/placeholders.json';
import styles from './Complex.module.css';

type Shot = { file: string; placeholder: boolean };
const SHOTS = manifest.items as Record<string, Shot>;

type Amenity = {
  key: string;
  title: string;
  sub: string;
  /** короткое имя для подписи внутри рамки */
  caption: string;
  /** описание настоящего кадра; для заглушки alt собирается отдельно */
  alt: string;
};

const AMENITIES: Amenity[] = [
  {
    key: 'atrium',
    title: 'Атриум под стеклянным куполом',
    sub: 'ФУД-ХОЛЛ · КАФЕ · ЗИМНИЙ САД',
    caption: 'АТРИУМ',
    alt: 'Атриум между башнями iCITY под стеклянным куполом',
  },
  {
    key: 'garden',
    title: 'Сад на высоте',
    sub: 'СТИЛОБАТ 14 760 М² · ТЕРРАСЫ',
    caption: 'САД НА СТИЛОБАТЕ',
    alt: 'Озеленённый стилобат iCITY с террасами',
  },
  {
    key: 'gallery',
    title: 'Торговая галерея',
    sub: 'РЕСТОРАНЫ · СЕРВИСЫ · МИНИ-МАРКЕТ',
    caption: 'ТОРГОВАЯ ГАЛЕРЕЯ',
    alt: 'Торговая галерея iCITY',
  },
  {
    key: 'parking',
    title: 'Паркинг на 950 мест',
    sub: '6 УРОВНЕЙ · ЗАЕЗД С ТТК · ЗАРЯДКИ EV',
    caption: 'ПАРКИНГ',
    alt: 'Подземный паркинг iCITY',
  },
  {
    key: 'smart',
    title: 'Smart Building',
    sub: 'БИОМЕТРИЯ · КЛИМАТ · БЕСШУМНЫЕ ЛИФТЫ',
    caption: 'SMART BUILDING',
    alt: 'Лобби Space Tower с биометрическим доступом',
  },
];

/* Подпись внутри рамки не даёт принять заглушку за съёмку. Строка
   обязана оставаться честной и после подмены файлов — поэтому её
   вторая половина приходит из манифеста, а не из кода. */
function captionFor(a: Amenity): string {
  const shot = SHOTS[a.key];
  return `${a.caption} · ${shot?.placeholder ? 'ПЛЕЙСХОЛДЕР' : 'ФОТО РЕАЛЬНОГО ОБЪЕКТА'}`;
}

function altFor(a: Amenity): string {
  return SHOTS[a.key]?.placeholder ? `Заглушка вместо кадра: ${a.caption}` : a.alt;
}

const REVEAL_ROOT_MARGIN = '200px';

export default function Complex() {
  const [near, setNear] = useState(false);
  const [active, setActive] = useState(0);

  const sectionRef = useRef<HTMLElement>(null);

  /* Ховером ведём кадр только на точной мыши. Тач-события приходят
     кликом — он же обслуживает и клавиатуру. */
  const fine = useRef(false);

  /* --- подход к секции: монтируем кадры и больше не живём ----------- */
  useEffect(() => {
    fine.current = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const el = sectionRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect(); /* one-shot, второго прогона нет */
        }
      },
      { rootMargin: REVEAL_ROOT_MARGIN }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* Смена кадра — это только смена состояния. Кроссфейд ведёт CSS,
     JS в него не вмешивается ни одним кадром. */
  const activate = useCallback((index: number) => setActive(index), []);

  return (
    <section
      ref={sectionRef}
      className={styles.section}
      id="complex"
      aria-labelledby="complex-eyebrow"
    >
      <div className={styles.inner}>
        <div className={styles.head}>
          <p className={`label ${styles.eyebrow}`} id="complex-eyebrow">
            КОМПЛЕКС iCITY
          </p>

          <h2 className={styles.title}>Всё, что этажами ниже</h2>
        </div>

        <ul className={styles.list}>
          {AMENITIES.map((a, i) => {
            const on = i === active;
            return (
              <li key={a.key} className={styles.item}>
                <button
                  type="button"
                  className={`${styles.row} ${on ? styles.rowOn : ''}`}
                  aria-pressed={on}
                  aria-describedby={`complex-sub-${a.key}`}
                  onClick={() => activate(i)}
                  onFocus={() => activate(i)}
                  onPointerEnter={(e) => {
                    if (fine.current && e.pointerType === 'mouse') activate(i);
                  }}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.text}>
                    {/* Двойник в конечном весе держит ширину и высоту
                        строки: при 550 текст шире, и без него смена веса
                        могла бы перенести слово на вторую строку. Тот же
                        приём, что у .numGhost в Landing. */}
                    <span className={styles.rowTitle}>{a.title}</span>
                    <span className={styles.rowTitleGhost} aria-hidden="true">
                      {a.title}
                    </span>
                    {/* Два узла, а не один: внешний .sub — обрезающая
                        коробка, её высоту гонит грид-ряд .text от 0fr к 1fr;
                        внутренний несёт отступ сверху. Отступ обязан лежать
                        ВНУТРИ трека — снаружи он не сжимается до нуля
                        и держал бы по 8 px в каждой строке. */}
                    <span className={styles.sub} id={`complex-sub-${a.key}`}>
                      <span className={styles.subInner}>{a.sub}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className={styles.frameWrap}>
          <div className={styles.frame}>
            {near &&
              AMENITIES.map((a, i) => (
                /* eslint-disable-next-line @next/next/no-img-element --
                   next/image здесь не нужен: кадры отдаются одним
                   размером 1600×1200 и заменяются на настоящие снимки
                   по тем же именам; оптимизатор добавил бы к каждой
                   подмене пересборку кэша и ничего не выиграл. */
                <img
                  key={a.key}
                  className={`${styles.shot} ${i === active ? styles.shotOn : ''}`}
                  src={`/complex/${SHOTS[a.key]?.file ?? `${a.key}.jpg`}`}
                  alt={i === active ? altFor(a) : ''}
                  width={1600}
                  height={1200}
                  draggable={false}
                  decoding="async"
                  loading="lazy"
                  fetchPriority={i === 0 ? 'high' : 'low'}
                />
              ))}

            <p className={styles.caption}>{captionFor(AMENITIES[active])}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
