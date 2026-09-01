/* iCITY 113Н — комплекс (вариант C1: список удобств и кадр рядом).
   Путь в проекте: components/Complex.tsx

   Пять строк слева, одна рамка справа. Наведение на строку меняет кадр
   спокойным кроссфейдом на 250 мс — и это всё движение, какое здесь есть.
   Подпись в углу рамки идёт с кадром одним движением: тот же кроссфейд
   и та же кривая, и появляется она не раньше, чем загрузился сам кадр.

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

   КАДРЫ — public/complex/{park.jpg,lobby.webp,gallery.jpg,elevators.webp,
   parking.webp}, все пять настоящие. Признак заглушки не угадывается
   по имени файла, а лежит в манифесте public/complex/placeholders.json,
   который пишет scripts/gen-complex-placeholders.mjs. Понадобится новый
   кадр — кладут тем же именем и убирают ключ из манифеста (или удаляют
   манифест целиком и гоняют скрипт заново), код не меняется.

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
    key: 'park',
    title: 'Ландшафтный парк',
    sub: 'ЗЕЛЁНАЯ ЗОНА, РАСПОЛОЖЕННАЯ НА 6 ЭТАЖЕ',
    caption: 'ЛАНДШАФТНЫЙ ПАРК',
    alt: 'Ландшафтный парк на кровле iCITY между башнями',
  },
  {
    key: 'lobby',
    title: 'Лобби',
    sub: 'Монументальный мраморный атриум',
    caption: 'ЛОББИ',
    alt: 'Мраморное лобби Space Tower с турникетами',
  },
  {
    key: 'gallery',
    title: 'Торговая галлерея',
    sub: 'РЕСТОРАНЫ · СЕРВИСЫ · МИНИ-МАРКЕТЫ',
    caption: 'ТОРГОВАЯ ГАЛЛЕРЕЯ',
    alt: 'Торговая галлерея iCITY',
  },
  {
    key: 'elevators',
    title: 'Лифты',
    sub: '48 скоростных лифтов',
    caption: 'ЛИФТЫ',
    alt: 'Лифтовый холл Space Tower',
  },
  {
    key: 'parking',
    title: 'Паркинг',
    sub: 'Интеллектуальный паркинг на более 940 машин',
    caption: 'ПАРКИНГ',
    alt: 'Подземный паркинг iCITY',
  },
];

function altFor(a: Amenity): string {
  return SHOTS[a.key]?.placeholder ? `Заглушка вместо кадра: ${a.caption}` : a.alt;
}

const REVEAL_ROOT_MARGIN = '200px';

export default function Complex() {
  const [near, setNear] = useState(false);
  const [active, setActive] = useState(0);
  /* Какие кадры браузер уже вытянул. Подпись зоны показывается только
     под загруженным кадром — см. комментарий у .caption ниже. */
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());

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

  /* Кадр доехал. Множество, а не флаг на активном: зритель бегает
     по строкам туда-обратно, и уже загруженный кадр не должен
     во второй раз прятать подпись. */
  const markLoaded = useCallback((key: string) => {
    setLoaded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

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

          <h2 className={styles.title}>Благоустройство</h2>
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
                  onLoad={() => markLoaded(a.key)}
                  /* Кадр из кэша бывает готов раньше, чем React повесит
                     onLoad, и события уже не будет. Проверяем complete
                     в момент привязки — иначе подпись не появилась бы
                     никогда именно на быстром повторном заходе. */
                  ref={(el) => { if (el?.complete) markLoaded(a.key); }}
                />
              ))}

            {/* Подписи лежат стопкой и растворяются друг в друге ровно
                тем же переходом, что и кадры под ними. Раньше здесь был
                один <p>, менявший текст мгновенно: кадр ехал 250 мс,
                надпись переключалась в первом же кадре — и читалось это
                как «плашка не поспела за картинкой». Теперь у них одна
                длительность и одна кривая.

                Второе условие того же требования — плашка не выходит
                раньше своего кадра: пока картинка не загрузилась, класса
                .captionOn нет, и в рамке стоит чистая --paper без
                подписи к тому, чего ещё не видно. */}
            {AMENITIES.map((a, i) => (
              <p
                key={a.key}
                className={`${styles.caption} ${
                  i === active && loaded.has(a.key) ? styles.captionOn : ''
                }`}
                aria-hidden={i !== active}
              >
                {a.caption}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
