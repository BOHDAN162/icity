/* iCITY 113Н — комплекс (вариант C1: список удобств с растровым проявлением).
   Путь в проекте: components/Complex.tsx

   Пять строк слева, одна рамка справа. Наведение на строку меняет кадр,
   и каждый кадр открывается из растра: поверх фотографии лежит холст
   с её полутоновой версией (lib/halftone.ts), он вспыхивает без перехода
   и тает за 550 мс. Приём тот же, что несёт вся дизайн-система, —
   фритта фасада iCITY, только здесь она проявляет кадр, а не украшает
   стык секций.

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
   и больше не живёт. Растр считается после img.decode() внутри rAF —
   getImageData на 560×420 стоит порядка 4 мс, и попасть этими
   миллисекундами в кадр прокрутки не хочется.

   ДОСТУПНОСТЬ. Строки — настоящие <button>: Enter и Space приходят
   сами, фокус ведёт кадр так же, как мышь, aria-pressed говорит,
   какая строка открыта. Глобальных обработчиков клавиш нет — их на
   сайте нет нигде, кроме Esc в офисе (AGENTS.md). */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { paletteFrom, renderHalftone, type HalftonePalette } from '@/lib/halftone';
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
const RESIZE_DEBOUNCE = 200;

export default function Complex() {
  const [near, setNear] = useState(false);
  const [active, setActive] = useState(0);

  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* Готовые растры и сами <img> — вне состояния: React не должен
     перерисовываться из-за них ни разу. */
  const rasters = useRef(new Map<string, HTMLCanvasElement>());
  const images = useRef(new Map<string, HTMLImageElement>());
  /* Ключ, который ждёт своего растра: наведение опередило расчёт. */
  const pending = useRef<string | null>(null);
  const rafId = useRef(0);

  /* Ховером ведём кадр только на точной мыши. Тач-события приходят
     кликом — он же обслуживает и клавиатуру. */
  const fine = useRef(false);
  /* Запрос на покой — в ref, а не в состоянии: он не меняет разметку,
     только поведение, и лишний рендер на монтировании ни к чему. */
  const reduced = useRef(false);

  /* --- 1. подход к секции: монтируем кадры и запоминаем reduce ------ */
  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  /* --- 2. проявление ------------------------------------------------- */

  /* Вспышка и растворение. Класс .snap ставит opacity 1 и снимает
     переход; чтение offsetWidth заставляет браузер зафиксировать это
     состояние, и только следующим кадром класс снимается — тогда
     переход 550 мс отрабатывает от единицы к нулю. Без принудительного
     пересчёта обе правки схлопнулись бы в одну и перехода не было бы. */
  const play = useCallback(
    (key: string) => {
      const cv = canvasRef.current;
      if (!cv) return;

      const raster = rasters.current.get(key);
      if (reduced.current || !raster) {
        /* без растра и при reduce кадр просто стоит открытым */
        cv.classList.remove(styles.snap);
        pending.current = reduced.current ? null : key;
        return;
      }
      pending.current = null;

      const ctx = cv.getContext('2d');
      if (!ctx) return;
      cv.width = raster.width;
      cv.height = raster.height;
      ctx.drawImage(raster, 0, 0);

      cv.classList.add(styles.snap);
      void cv.offsetWidth;
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        cv.classList.remove(styles.snap);
      });
    },
    []
  );

  const compute = useCallback(
    (key: string, img: HTMLImageElement) => {
      const frame = frameRef.current;
      if (!frame || reduced.current) return;
      const palette: HalftonePalette = paletteFrom(frame);
      const raster = renderHalftone(img, frame.clientWidth, frame.clientHeight, palette);
      if (!raster) return;
      /* Прежний растр этого кадра больше не нужен: Safari не отпускает
         canvas-память без явного обнуления размеров. */
      const prev = rasters.current.get(key);
      if (prev) {
        prev.width = 0;
        prev.height = 0;
      }
      rasters.current.set(key, raster);
      if (pending.current === key) play(key);
    },
    [play]
  );

  /* Расчёт только после декодирования и только внутри rAF: getImageData
     на неготовой картинке вернёт пустоту, а вне кадра — попадёт
     в прокрутку. */
  const onShotLoad = useCallback(
    (key: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      images.current.set(key, img);
      if (reduced.current) return;
      const run = () => requestAnimationFrame(() => compute(key, img));
      img.decode().then(run, run);
    },
    [compute]
  );

  /* Первый показ: как только кадры смонтированы, первая строка
     открывается тем же проявлением, что и все следующие. */
  useEffect(() => {
    if (!near || reduced.current) return;
    pending.current = AMENITIES[active].key;
    play(AMENITIES[active].key);
    /* active намеренно не в зависимостях: смену строки ведёт activate */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, play]);

  /* --- 3. ресайз: пересчёт всех растров, 200 мс дребезга ------------- */
  useEffect(() => {
    if (!near || reduced.current) return;
    const frame = frameRef.current;
    if (!frame) return;

    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        for (const [key, img] of images.current) compute(key, img);
      }, RESIZE_DEBOUNCE);
    });
    ro.observe(frame);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [near, compute]);

  /* --- 4. размонтирование ------------------------------------------- */
  useEffect(() => {
    const cache = rasters.current;
    const cv = canvasRef.current;
    return () => {
      cancelAnimationFrame(rafId.current);
      /* Safari не отпускает canvas-память без обнуления размеров */
      for (const raster of cache.values()) {
        raster.width = 0;
        raster.height = 0;
      }
      cache.clear();
      if (cv) {
        cv.width = 0;
        cv.height = 0;
      }
    };
  }, []);

  const activate = useCallback(
    (index: number) => {
      setActive(index);
      play(AMENITIES[index].key);
    },
    [play]
  );

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
                    <span className={styles.sub} id={`complex-sub-${a.key}`}>
                      {a.sub}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className={styles.frameWrap}>
          <div ref={frameRef} className={styles.frame}>
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
                  onLoad={onShotLoad(a.key)}
                />
              ))}

            {/* Растр. aria-hidden: он ничего не сообщает, это та же
                картинка, только точками. */}
            <canvas ref={canvasRef} className={styles.raster} aria-hidden="true" />

            <p className={styles.caption}>{captionFor(AMENITIES[active])}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
