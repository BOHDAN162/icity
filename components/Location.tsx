/* iCITY 113Н — локация (карта Яндекса + таблица времени).
   Путь в проекте: components/Location.tsx

   Слева таблица времени в пути с точечным выносом, справа рамка
   с картой. Наведение на строку ведёт карту: до выбранной точки
   прочерчивается красная связка, камера подбирает под неё рамку.
   Приём тот же, что у списка удобств в Complex.tsx — одна строка,
   один кадр, — только кадром здесь работает карта.

   ДАННЫЕ ОДНИ НА ДВОИХ. И таблица, и карта читают LEGS из lib/geo.ts.
   Строка таблицы и связка на карте обязаны быть одним объектом,
   иначе они разъедутся при первой же правке. Числа — docs/facts.md.

   ИМЯ СТАНЦИИ. МЦД-1 «Тестовскую» переименовали в «Москва-Сити».
   В заголовке и таблице оставлено прежнее имя — по нему объект знают,
   а на карте Яндекс подписывает станцию сам.

   ЧТО ГРУЗИТСЯ И КОГДА. Карта начинает грузиться за два экрана до
   секции — на границе ряда чисел и экономики. Замерено: от верха
   «Экономики» до верха «Локации» 1841 px при экране 900, поэтому
   запас 1600 px даёт тайлам порядка двух экранов прокрутки, чтобы
   доехать. К моменту, когда зритель добирается до локации, карта
   уже стоит. Наблюдатель одноразовый.

   ЦЕНА АВТОЗАГРУЗКИ. Бесплатный тариф даёт 100 показов карты в сутки,
   и теперь их тратит каждый, кто долистал до экономики, а не только
   тот, кто захотел карту. Для лендинга на десятки просмотров это
   с запасом; счётчик виден в кабинете Яндекса. Остальные внешние
   условия — в AGENTS.md.

   ЕСЛИ КАРТЫ НЕТ. Нет ключа, отказала сеть, отказал сам API — в рамке
   остаётся адрес со ссылкой на Яндекс Карты, а не пустой прямоугольник.
   Таблица статична и несёт всю фактуру в любом случае.

   ВЫБОР СТРОКИ — ПО КЛИКУ, НЕ ПО НАВЕДЕНИЮ. В покое не выбрана
   ни одна: карта стоит общим планом, связок нет. Клик строит связку
   и ведёт камеру, повторный клик по той же строке всё снимает.
   Наведение ничего не строит — иначе связка дёргалась бы под
   курсором, пока зритель просто ведёт мышь к нужной строке.

   ДОСТУПНОСТЬ. Строки — настоящие <button>: Enter и Space приходят
   сами и работают тем же переключателем, что и клик, aria-pressed
   говорит, какая строка открыта. Фокус связку НЕ строит: перебор
   табом не должен гонять камеру. Глобальных обработчиков клавиш
   нет — их на сайте нет нигде, кроме Esc в офисе (AGENTS.md). */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { LEGS } from '@/lib/geo';
import styles from './Location.module.css';

/* ssr: false обязателен — модуль трогает document и window.ymaps3. */
const YandexMap = dynamic(() => import('./YandexMap'), { ssr: false });

/* Ссылка на объект в Яндекс Картах — из неё же взята точка комплекса. */
const YANDEX_URL = 'https://yandex.ru/maps/-/CTTVAU6r';

/* Запас, за который до секции начинает грузиться карта. Замер на
   1440×900: от верха «Экономики» до верха «Локации» 1841 px. */
const PRELOAD_MARGIN = '1600px';

export default function Location() {
  const sectionRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState(false);
  /* null — не выбрана ни одна строка: связок на карте нет */
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.unobserve(el);
        io.disconnect(); /* одноразовый: второго монтирования нет */
        setOpen(true);
      },
      { rootMargin: PRELOAD_MARGIN }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* Клик по открытой строке её закрывает. Отсюда и весь переключатель:
     зритель убирает связку тем же движением, которым построил. */
  const toggle = useCallback((i: number) => {
    setActive((prev) => (prev === i ? null : i));
  }, []);

  const onFail = useCallback((reason: string) => {
    setFailed(true);
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Location] карта не поехала: ${reason}`);
    }
  }, []);

  const onReady = useCallback(() => setLive(true), []);

  return (
    <section ref={sectionRef} className={styles.section} id="location" aria-labelledby="location-eyebrow">
      <div className={styles.inner}>
        <div className={styles.text}>
          <p className={`label ${styles.eyebrow}`} id="location-eyebrow">
            ЛОКАЦИЯ
          </p>

          <h2 className={styles.title}>Шаг от «Тестовской»</h2>

          <p className={styles.lead}>
            Москва, улица Ермакова Роща, 1с1 — Москва-Сити, между ТТК и рекой.
          </p>

          <ul className={styles.table}>
            {LEGS.map((leg, i) => {
              const on = i === active;
              return (
                <li key={leg.key} className={styles.item}>
                  <button
                    type="button"
                    className={`${styles.row} ${on ? styles.rowOn : ''}`}
                    aria-pressed={on}
                    onClick={() => toggle(i)}
                  >
                    <span className={styles.place}>{leg.place}</span>
                    {/* Вынос. aria-hidden: точки ничего не сообщают,
                        они ведут глаз от названия к цифре. */}
                    <span className={styles.dots} aria-hidden="true" />
                    <span className={styles.time}>{leg.time}</span>
                    <span className={styles.mode}>{leg.mode}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={styles.mapWrap}>
          <div className={styles.frame}>
            {open && !failed && <YandexMap active={active} onFail={onFail} onReady={onReady} />}

            {/* Заглушка. Уходит, когда карта отрисовалась: пока тайлы
                едут, в рамке стоит адрес, а не пустота. */}
            {!live && (
              <div className={styles.stub}>
                <p className={styles.stubAddr}>
                  Москва, улица Ермакова Роща, 1с1
                  <br />
                  Space Tower, 23 этаж
                </p>
              </div>
            )}

            <p className={styles.caption}>МОСКВА-СИТИ · ЕРМАКОВА РОЩА, 1С1</p>

            {/* Ссылка «Открыть в Картах» — ТРЕБОВАНИЕ условий использования
                API Яндекса, пункт 4.1.3.1. Когда карта жива, API рисует
                эту кнопку сам, в левом нижнем углу, и своя вторая только
                налезала бы на неё. Поэтому она держится ровно там, где
                кнопки Яндекса нет: до загрузки и при отказе. */}
            {!live && (
              <a
                className={styles.mapsLink}
                href={YANDEX_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                Открыть в Яндекс Картах
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
