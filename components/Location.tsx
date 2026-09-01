/* iCITY 113Н — локация (схема Яндекса + таблица времени).
   Путь в проекте: components/Location.tsx

   Слева абзац и таблица времени в пути с точечным выносом, справа
   рамка с картой. Рисованный SVG-чертёж, живший здесь раньше, удалён:
   в рамке теперь монохромная схема Яндекса, components/YandexMap.tsx.

   ЧИСЛА — docs/facts.md, раздел «Время в пути»: МЦД 1 мин пешком,
   м. «Шелепиха» 5 мин пешком, «Москва-Сити» 15 мин пешком,
   Кутузовский проспект 5 мин на машине. Про ТТК в фактах стоит
   «1 мин на машине»; в строке написано «прямой», потому что речь
   про заезд — у комплекса прямой съезд с ТТК в паркинг (та же
   формулировка, что в списке удобств Complex.tsx). Строка
   «Шелепиха · метро + МЦК» несёт 5 мин по метро; до платформы МЦК
   в фактах 6 мин. Координаты точек — lib/geo.ts.

   ИМЯ СТАНЦИИ. МЦД-1 «Тестовскую» переименовали в «Москва-Сити».
   В заголовке и в таблице оставлено прежнее имя — по нему объект
   ищут и его знают, — а метка на карте несёт оба.

   ЧТО ГРУЗИТСЯ И КОГДА. Ни одного байта карты до подхода к секции.
   IntersectionObserver с запасом 300 px монтирует YandexMap через
   dynamic(..., { ssr: false }), отписывается и больше не живёт. Сам
   модуль карты тянет скрипт Яндекса (порядка 250 КБ) уже после этого:
   в бюджет первого экрана он не входит и входить не должен.

   ЕСЛИ КАРТЫ НЕТ. Нет ключа, отказала сеть, отказал сам API — в рамке
   остаётся честная заглушка с адресом и ссылкой на Яндекс Карты,
   а не пустой прямоугольник. Вся фактура локации в любом случае
   продублирована таблицей рядом, и она статична. */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from './Location.module.css';

/* ssr: false обязателен — модуль трогает document и window.ymaps3. */
const YandexMap = dynamic(() => import('./YandexMap'), { ssr: false });

type Leg = {
  place: string;
  /* U+202F между числом и единицей — узкий неразрывный, как в Economics */
  time: string;
  mode: 'ПЕШКОМ' | 'АВТО';
  /* выделенная строка: та самая минута до МЦД */
  hot?: boolean;
};

const LEGS: Leg[] = [
  { place: 'Тестовская · МЦД',        time: '1 мин',  mode: 'ПЕШКОМ', hot: true },
  { place: 'Шелепиха · метро + МЦК',  time: '5 мин',  mode: 'ПЕШКОМ' },
  { place: 'Москва-Сити',             time: '15 мин', mode: 'ПЕШКОМ' },
  { place: 'ТТК — выезд из паркинга', time: 'прямой', mode: 'АВТО' },
  { place: 'Кутузовский проспект',    time: '5 мин',  mode: 'АВТО' },
];

/* Ссылка на объект в Яндекс Картах — из неё же взята точка комплекса. */
const YANDEX_URL = 'https://yandex.ru/maps/-/CTTVAU6r';

const MOUNT_ROOT_MARGIN = '300px';

export default function Location() {
  const sectionRef = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.unobserve(el);
        io.disconnect(); /* одноразовый: второго монтирования нет */
        setNear(true);
      },
      { rootMargin: MOUNT_ROOT_MARGIN }
    );
    io.observe(el);
    return () => io.disconnect();
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
            {LEGS.map((leg) => (
              <li key={leg.place} className={`${styles.row} ${leg.hot ? styles.rowHot : ''}`}>
                <span className={styles.place}>{leg.place}</span>
                {/* Вынос. aria-hidden: точки ничего не сообщают, они ведут
                    глаз от названия к цифре. */}
                <span className={styles.dots} aria-hidden="true" />
                <span className={styles.time}>{leg.time}</span>
                <span className={styles.mode}>{leg.mode}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.mapWrap}>
          <div className={styles.frame}>
            {near && !failed && <YandexMap onFail={onFail} onReady={onReady} />}

            {/* Заглушка. Лежит под картой и уходит, когда та отрисовалась:
                пока тайлы едут, в рамке стоит адрес, а не пустота. */}
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
                API Яндекса, пункт 4.1.3.1: её и копирайт скрывать нельзя.
                Поэтому она живёт постоянно, а не только в заглушке, как
                было сначала. Копирайт Яндекса рисует сам API в правом
                нижнем углу — он тоже не трогается. */}
            <a
              className={styles.mapsLink}
              href={YANDEX_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              Открыть в Яндекс Картах
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
