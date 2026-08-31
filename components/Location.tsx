/* iCITY 113Н — локация (вариант D1: схема-чертёж + таблица времени).
   Путь в проекте: components/Location.tsx

   Слева — абзац и таблица времени в пути с точечным выносом (dot leader),
   справа — рамка со схемой района. Схема нарисована руками во встроенном
   SVG: никакого картографического API здесь нет и в этой итерации
   не появится. Отсюда и подпись в углу — «СХЕМА · НЕ МАСШТАБ»: пропорции
   выбраны под читаемость, а не под метры.

   ЧИСЛА — docs/facts.md, раздел «Время в пути»: МЦД «Тестовская» 1 мин
   пешком, м. «Шелепиха» 5 мин пешком, «Москва-Сити» 15 мин пешком,
   Кутузовский проспект 5 мин на машине. Про ТТК в фактах стоит «1 мин
   на машине»; в строке написано «прямой», потому что речь про заезд —
   у комплекса прямой съезд с ТТК в паркинг (та же формулировка, что
   в списке удобств Complex.tsx). Строка «Шелепиха · метро + МЦК» несёт
   5 мин по метро; до платформы МЦК в фактах 6 мин.

   ГЕОГРАФИЯ СХЕМЫ. Space Tower в центре, МЦД «Тестовская» — восточнее
   и вплотную (та самая минута пешком), «Шелепиха» — на северо-западе,
   ТТК идёт с севера на юг вдоль восточного края, железнодорожный
   коридор — параллельно ему, Шмитовский проезд пересекает кадр с
   запада на восток севернее башни, башни Москва-Сити стоят на
   юго-востоке за ТТК. Все координаты — в комментариях у групп ниже.

   ДВИЖЕНИЕ. Единственное на секцию: три красных маршрута прочерчивают
   себя через stroke-dashoffset, когда схема входит в кадр. Длины путей
   снимаются getTotalLength — только в браузере, в эффекте: на сервере
   этого метода нет. Наблюдатель одноразовый: сработал — отписался
   и отключился. При prefers-reduced-motion наблюдателя нет вовсе,
   маршруты стоят прочерченными с первого кадра.

   ДОСТУПНОСТЬ. Схема декоративна по содержанию, но не пуста: role="img"
   и <title> пересказывают её словами, а вся фактура продублирована
   таблицей рядом. Колонка способа («ПЕШКОМ» / «АВТО») на узком экране
   уходит из вёрстки, но не из разметки — она прячется визуально,
   скринридер её читает. */

'use client';

import { useEffect, useRef } from 'react';
import styles from './Location.module.css';

type Leg = {
  place: string;
  /* U+202F между числом и единицей — узкий неразрывный, как в Economics */
  time: string;
  mode: 'ПЕШКОМ' | 'АВТО';
  /* выделенная строка: та самая минута до МЦД */
  hot?: boolean;
};

const LEGS: Leg[] = [
  { place: 'Тестовская · МЦД',       time: '1 мин',  mode: 'ПЕШКОМ', hot: true },
  { place: 'Шелепиха · метро + МЦК', time: '5 мин',  mode: 'ПЕШКОМ' },
  { place: 'Москва-Сити',            time: '15 мин', mode: 'ПЕШКОМ' },
  { place: 'ТТК — выезд из паркинга', time: 'прямой', mode: 'АВТО' },
  { place: 'Кутузовский проспект',   time: '5 мин',  mode: 'АВТО' },
];

/* Шаг каскада между маршрутами. 180 мс — не --stagger (100 мс): маршрут
   рисуется 450 мс, и при сотне шаг читается как один общий росчерк,
   а не как три отдельных. */
const ROUTE_STAGGER = 180;

export default function Location() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const routes = Array.from(svg.querySelectorAll<SVGPathElement>('[data-route]'));
    if (routes.length === 0) return;

    /* getTotalLength живёт только в браузере: на сервере DOM-узла нет,
       поэтому длины снимаются здесь, а не в разметке. До этого момента
       маршруты спрятаны запасной длиной --len из CSS-модуля. */
    const lengths = routes.map((p) => p.getTotalLength());
    routes.forEach((p, i) => p.style.setProperty('--len', String(lengths[i])));

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      /* покой: прочерчено сразу, наблюдателя не заводим */
      routes.forEach((p) => p.classList.add(styles.routeDrawn));
      return;
    }

    routes.forEach((p, i) => p.style.setProperty('--route-delay', `${i * ROUTE_STAGGER}ms`));

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.unobserve(svg);
        io.disconnect(); /* одноразовый: второго прочерчивания нет */
        routes.forEach((p) => p.classList.add(styles.routeDrawn));
      },
      { threshold: 0.5 }
    );
    io.observe(svg);
    return () => io.disconnect();
  }, []);

  return (
    <section className={styles.section} id="location" aria-labelledby="location-eyebrow">
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
            <svg
              ref={svgRef}
              className={styles.map}
              viewBox="0 0 640 520"
              role="img"
              aria-labelledby="location-map-title"
            >
              <title id="location-map-title">
                Схема района: Space Tower в центре, МЦД «Тестовская» восточнее,
                метро и МЦК «Шелепиха» на северо-западе, ТТК вдоль восточного
                края, башни Москва-Сити на юго-востоке
              </title>

              {/* --- кварталы: шесть светлых пятен ------------------------
                  B1 северо-запад, B2 север за Шмитовским, B3 запад,
                  B4 юг под башней, B5 юго-запад, B6 — кластер Москва-Сити
                  за ТТК тремя пластинами. */}
              <g className={styles.block}>
                <rect x="30" y="40" width="92" height="62" />
                <rect x="300" y="58" width="140" height="112" />
                <rect x="35" y="240" width="110" height="110" />
                <rect x="170" y="372" width="150" height="92" />
                <rect x="40" y="404" width="118" height="86" />
                <rect x="556" y="414" width="24" height="86" />
                <rect x="582" y="390" width="24" height="110" />
                <rect x="608" y="430" width="24" height="70" />
              </g>

              {/* --- дороги: две крупные и две второстепенные -------------
                  ТТК x≈530 с севера на юг вдоль восточного края,
                  Шмитовский проезд y≈200 с запада на восток севернее
                  башни, Шелепихинское шоссе — диагональ с северо-запада
                  через станцию, Ермакова Роща — короткая с севера на юг
                  у самой башни. */}
              <g className={styles.roadMinor}>
                <path d="M 62 28 L 132 118 L 198 204" />
                <path d="M 300 204 L 298 300 L 318 382" />
              </g>
              <g className={styles.roadMajor}>
                <path d="M 530 12 L 528 190 L 534 340 L 530 508" />
                <path d="M 12 208 L 300 201 L 546 197" />
              </g>

              {/* --- железная дорога: коридор параллельно ТТК, x≈445 ----- */}
              <path className={styles.rail} d="M 445 12 L 445 508" />

              {/* --- маршруты: станция → башня, станция → башня,
                  башня → ТТК. Порядок в разметке = порядок каскада. --- */}
              <path
                className={styles.route}
                data-route=""
                d="M 437 266 C 416 262 396 258 373 257"
              />
              <path
                className={styles.route}
                data-route=""
                d="M 142 122 C 210 152 272 200 340 245"
              />
              <path
                className={styles.route}
                data-route=""
                d="M 360 274 C 390 330 440 354 531 348"
              />

              {/* --- станции: кружок r=7, заливка бумаги, красный контур - */}
              <circle className={styles.station} cx="445" cy="268" r="7" />
              <circle className={styles.station} cx="135" cy="118" r="7" />

              {/* --- башня: красный квадрат на 45°, центр (355, 258) ----- */}
              <rect
                className={styles.tower}
                x="-11"
                y="-11"
                width="22"
                height="22"
                transform="translate(355 258) rotate(45)"
              />

              {/* --- подписи ---------------------------------------------- */}
              <g className={styles.mapLabel}>
                <text x="24" y="188">ШМИТОВСКИЙ ПР.</text>
                <text x="546" y="40">ТТК</text>
                <text x="452" y="40">МЦД-1</text>
                <text x="628" y="378" textAnchor="end">МОСКВА-СИТИ</text>
                <text x="445" y="296" textAnchor="middle">ТЕСТОВСКАЯ · 1 МИН</text>
                <text x="152" y="122">ШЕЛЕПИХА · 5 МИН</text>
                <text x="286" y="320" transform="rotate(-90 286 320)" textAnchor="middle">
                  ЕРМАКОВА РОЩА
                </text>
              </g>
              <text className={styles.mapLabelRed} x="355" y="232" textAnchor="middle">
                SPACE TOWER · 113Н
              </text>
            </svg>

            {/* Подпись в углу — обычный HTML, а не <text>: SVG тянется
                вместе с viewBox, и 9 px в пользовательских единицах
                на телефоне превратились бы в пять. */}
            <p className={styles.caption}>СХЕМА · НЕ МАСШТАБ</p>
          </div>
        </div>
      </div>
    </section>
  );
}
