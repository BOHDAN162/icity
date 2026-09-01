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
   threshold 0.5, отписка после срабатывания). Всё остальное —
   заголовок, абзацы, полоса фактов — статично, это сознательно.

   Три фазы:
   idle   — состояние SSR и prefers-reduced-motion: всё в финальном
            виде, наблюдатель не создаётся вовсе;
   armed  — JS жив, движение разрешено: полоса и маркер спрятаны;
   played — шкала в кадре: полоса растёт 1000ms, маркер и подписи
            приходят следом с задержкой 550ms. Тайминги в CSS,
            кривая — общий токен --ease-soft. */

'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './Economics.module.css';

const FACTS = [
  { key: 'СТАВКА', value: '1 300 000 ₽ / мес' },
  { key: 'ВКЛЮЧЕНО В СТАВКУ', value: 'эксплуатация · НДС' },
  { key: 'ДЕПОЗИТ · СРОК', value: '2 месяца · от 11 месяцев' },
];

/* Шкала 0…100 000 ₽/м²·год. Проценты — прямое отображение значений:
   маркер 64 000 → 64%, рыночная полоса 80 000–100 000 → от 80% на 20%. */
const MARKER_LEFT = '64%';
const BAND_LEFT = '80%';
const BAND_WIDTH = '20%';

type Phase = 'idle' | 'armed' | 'played';

export default function Economics() {
  const scaleRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');

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
          <span className={styles.bandLabel} aria-hidden="true">
            рынок · 80{' '}000 – 100{' '}000
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
            <span className={styles.markerValue}>≈ 64{' '}000 ₽</span>
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

        <dl className={styles.facts}>
          {FACTS.map((f) => (
            <div key={f.key} className={styles.fact}>
              <dt className={styles.factKey}>{f.key}</dt>
              <dd className={styles.factValue}>{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
