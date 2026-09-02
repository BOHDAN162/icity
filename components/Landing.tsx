/* iCITY 113Н — экран 2. Приземление.
   Путь в проекте: components/Landing.tsx

   Тексты — docs/copy.md, раздел «2 · Приземление», дословно.
   Числа — docs/facts.md. Ничего сверх этих двух файлов здесь нет.

   Красное в покое ровно одно: четвёртое число «0» (design-system.md §4,
   «Ряд чисел»). Полоса растра под ним больше не постоянная — точечный
   подчерк появляется под любым числом только на ховере (десктоп).
   Больше --frit и --frit-deep на этом экране не появляются нигде.

   Внутри каждого dd — сетка 1×1: видимое число плюс скрытый дубликат
   на весе 700 (aria-hidden). Дубликат резервирует ширину ячейки под
   жирное начертание, чтобы утолщение на ховере не сдвигало раскладку.
   Он же держит ширину, пока идёт счёт: у «244,1» на середине пути
   знаков меньше, и без дубликата ряд дёргался бы на каждом разряде. */

import CountUpScope from './CountUpScope';
import ScrollToContactAction from './ScrollToContactAction';
import styles from './Landing.module.css';

type Figure = { value: string; caption: string; accent?: boolean };

const FIGURES: Figure[] = [
  { value: '244,1', caption: 'М²' },
  { value: '23 / 61', caption: 'ЭТАЖ' },
  { value: '3,8', caption: 'ПОТОЛКИ, М' },
  { value: '0', caption: 'КАПЗАТРАТ', accent: true },
];

export default function Landing() {
  return (
    <section className={styles.section} id="landing" aria-labelledby="landing-eyebrow">
      <div className={styles.inner}>
        <p className={`label ${styles.eyebrow}`} id="landing-eyebrow">
          ПОМЕЩЕНИЕ 113Н
        </p>

        {/* dt перед dd — семантика пары «имя—значение».
            Визуальный порядок переворачивает column-reverse,
            порядок чтения скринридером остаётся правильным.

            CountUpScope прокручивает числа от нуля, когда ряд входит
            в кадр: `data-count` — финальный текст, он же остаётся
            в разметке для сервера, скринридера и ветки без JS.
            Секунда, не дефолтные две: заказчик попросил счёт вдвое
            быстрее именно в этом ряду. */}
        <CountUpScope as="dl" className={styles.figures} duration={1000}>
          {FIGURES.map((f) => (
            <div
              key={f.caption}
              className={f.accent ? `${styles.item} ${styles.itemAccent}` : styles.item}
            >
              <dt className={`label ${styles.caption}`}>{f.caption}</dt>
              <dd className={styles.value}>
                <span className={styles.num} data-count={f.value}>{f.value}</span>
                <span className={styles.numGhost} aria-hidden="true">
                  {f.value}
                </span>
              </dd>
            </div>
          ))}
        </CountUpScope>

        <p className={styles.para}>
          Прямая аренда от собственника, дизайнерская отделка от PRIDEX.
        </p>

        <div className={styles.actions}>
          <ScrollToContactAction className={`btn ${styles.action}`} />
        </div>
      </div>
    </section>
  );
}
