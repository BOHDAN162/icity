/* iCITY 113Н — экономика сделки (вариант B3: бенчмарк-шкала как герой).
   Путь в проекте: components/Economics.tsx

   Числа — docs/facts.md: ставка 1 300 000 ₽/мес ≈ 64 000 ₽/м²·год,
   рынок сопоставимых готовых блоков 150–350 м² в iCITY — 80–100 тыс.
   В ставку входят только эксплуатация и НДС — состав полосы фактов
   ниже ровно такой и расширять его нечем.

   Красное здесь ровно одно место: маркер нашей ставки на шкале.
   Линия маркера 2 px — --frit (линии 1–2 px), его число — --frit-deep
   (красный текст), по design-system.md §1.

   Движение — one-shot по входу шкалы в кадр (IntersectionObserver,
   threshold 0.5, отписка после срабатывания). Вместе с ним от нуля
   прокручиваются и сами числа — ставка на маркере, границы рынка
   и строка «СТАВКА» в полосе фактов (lib/countUp.ts). Заголовок
   и абзацы статичны, это сознательно.

   Три фазы:
   idle   — состояние SSR и prefers-reduced-motion: всё в финальном
            виде, наблюдатель не создаётся вовсе;
   armed  — JS жив, движение разрешено: полоса и маркер спрятаны;
   played — шкала в кадре: полоса растёт 500ms, маркер и подписи
            приходят следом с задержкой 275ms. Тайминги в CSS,
            кривая — общий токен --ease-soft.

   ВДВОЕ БЫСТРЕЕ ДЕФОЛТА. Заказчик попросил ускорить именно эту секцию
   и «Помещение 113Н»: COUNT_MS и задержка марера здесь вполовину от
   стандартных 2000/550 (lib/countUp.ts, Landing.tsx), CSS-тайминги
   ниже уменьшены той же пропорцией, чтобы полоса, маркер и счёт
   остались синхронны. */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountUpOnView } from '@/lib/countUp';
import styles from './Economics.module.css';

/* Узкий неразрывный пробел записан кодом, а не символом: невидимый
   U+202F теряется при переносе файла между редакторами. Тот же приём,
   что у NBSP в PlanDollhouse.tsx.

   `count: true` — значение прокручивается счётчиком. Помечена одна
   ставка: в «эксплуатация · НДС» считать нечего, а «2 месяца · от 11
   месяцев» — условия договора, а не величина, и мельтешение цифр
   в них читалось бы как ошибка. */
const NNBSP = '\u202F';

const FACTS = [
  { key: 'СТАВКА', value: `1${NNBSP}300${NNBSP}000 ₽ / мес`, count: true },
  { key: 'ВКЛЮЧЕНО В СТАВКУ', value: 'эксплуатация · НДС' },
  { key: 'ДЕПОЗИТ · СРОК', value: '2 месяца · от 11 месяцев' },
];

/* Шкала 0…100 000 ₽/м²·год. Проценты — прямое отображение значений:
   маркер 64 000 → 64%, рыночная полоса 80 000–100 000 → от 80% на 20%. */
const MARKER_LEFT = '64%';
const BAND_LEFT = '80%';
const BAND_WIDTH = '20%';

/* Тексты чисел шкалы — константами: они же уезжают в data-count
   как финал счёта, и держать их в двух местах нельзя. */
const MARKER_VALUE = `≈ 64${NNBSP}000 ₽`;
const BAND_TEXT = `рынок · 80${NNBSP}000 – 100${NNBSP}000`;

/* Числа шкалы стартуют не с появлением секции, а вместе с маркером:
   его подписи до 275 мс держит opacity: 0 (см. .played .markerLabels),
   и счёт, начатый раньше, прошёл бы четверть пути за занавесом. */
const SCALE_COUNT_DELAY = 275;
const COUNT_MS = 1000;

type Phase = 'idle' | 'armed' | 'played';

export default function Economics() {
  const scaleRef = useRef<HTMLDivElement>(null);
  const factsRef = useRef<HTMLDListElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  /* Два счётчика, а не один на секцию: шкала и полоса фактов разъезжаются
     по экрану на добрую его половину, и общий наблюдатель запускал бы
     нижние числа задолго до того, как их видно. Каждый ждёт своего. */
  useCountUpOnView(scaleRef, { duration: COUNT_MS, delay: SCALE_COUNT_DELAY });
  useCountUpOnView(factsRef, { duration: COUNT_MS });

  useEffect(() => {
    /* reduce: остаёмся в idle — финальный вид без движения,
       наблюдатель пропускается целиком */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = scaleRef.current;
    if (!el) return;

    setPhase('armed');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase('played');
          io.disconnect(); /* one-shot: второго прогона нет */
        }
      },
      { threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const scaleClass = [
    styles.scale,
    phase === 'armed' ? styles.armed : '',
    phase === 'played' ? styles.played : '',
  ]
    .join(' ')
    .trim();

  return (
    <section
      className={styles.section}
      id="economics"
      aria-labelledby="economics-eyebrow"
    >
      <div className={styles.inner}>
        <p className={`label ${styles.eyebrow}`} id="economics-eyebrow">
          ЭКОНОМИКА СДЕЛКИ
        </p>

        <h2 className={styles.title}>Ниже рынка на 20–36%</h2>

        <p className={styles.para}>
          Сопоставимые готовые к въезду блоки 150–350 м² в iCITY
          предлагаются по 80 000–100 000 ₽ за м² в год.
          Здесь — около 64 000 ₽.
        </p>

        {/* Диаграмма избыточна для скринридера: итог отдаём одной
            фразой через role="img", внутренние подписи — оформление */}
        <div
          ref={scaleRef}
          className={scaleClass}
          role="img"
          aria-label="Шкала ставок аренды: рынок — от 80 000 до 100 000 ₽ за м² в год, помещение 113Н — около 64 000 ₽"
        >
          <span className={styles.track} aria-hidden="true" />
          <span
            className={styles.band}
            style={{ left: BAND_LEFT, width: BAND_WIDTH }}
            aria-hidden="true"
          />
          <span className={styles.bandLabel} data-count={BAND_TEXT} aria-hidden="true">
            {BAND_TEXT}
          </span>
          <span
            className={styles.marker}
            style={{ left: MARKER_LEFT }}
            aria-hidden="true"
          />
          <span
            className={styles.markerLabels}
            style={{ left: MARKER_LEFT }}
            aria-hidden="true"
          >
            {/* Сетка 1×1 с призрачным дублем: пока идёт счёт, знаков
                в числе меньше, а .markerLabels отцентрован по маркеру
                через translateX(-50%) — без дубля подпись ездила бы
                влево-вправо на каждом разряде. Тот же приём, что
                у .numGhost в Landing. */}
            <span className={styles.markerValue}>
              <span data-count={MARKER_VALUE}>{MARKER_VALUE}</span>
              <span className={styles.markerGhost} aria-hidden="true">{MARKER_VALUE}</span>
            </span>
            <span className={styles.markerCaption}>113Н · SPACE TOWER</span>
          </span>
          <span className={styles.ruler} aria-hidden="true">
            <span className={styles.tick} style={{ left: '0%' }}>
              0
            </span>
            <span
              className={`${styles.tick} ${styles.tickMid} ${styles.tickOptional}`}
              style={{ left: '25%' }}
            >
              25{' '}000
            </span>
            <span className={`${styles.tick} ${styles.tickMid}`} style={{ left: '50%' }}>
              50{' '}000
            </span>
            <span
              className={`${styles.tick} ${styles.tickMid} ${styles.tickOptional}`}
              style={{ left: '75%' }}
            >
              75{' '}000
            </span>
            <span className={`${styles.tick} ${styles.tickEnd}`}>
              100{' '}000 ₽/м²·год
            </span>
          </span>
        </div>

        <p className={styles.para}>
          Разница не в качестве, а в модели: прямая аренда от собственника,
          готовая дизайнерская отделка от PRIDEX. Ремонт помещения
          в бетоне занял бы от трёх до шести месяцев — здесь же всё уже
          готово.
        </p>

        <dl ref={factsRef} className={styles.facts}>
          {FACTS.map((f) => (
            <div key={f.key} className={styles.fact}>
              <dt className={styles.factKey}>{f.key}</dt>
              <dd className={styles.factValue} data-count={f.count ? f.value : undefined}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
