/* iCITY 113Н — липкая панель.
   Путь в проекте: components/StickyBar.tsx

   «Отсюда начинается липкая панель» (copy.md §2). Реализовано без JS
   и без IntersectionObserver: панель — первый ребёнок области, которая
   начинается сразу под героем, и position:sticky. На первом экране её
   в потоке просто нет, ниже она прилипает к верху.

   Побочный выигрыш: sticky остаётся в потоке и занимает свою высоту,
   поэтому панель физически не может перекрыть контент — ни на десктопе,
   ни на мобильном. */

import styles from './StickyBar.module.css';

export default function StickyBar() {
  return (
    <div className={styles.bar}>
      {/* на мобильном остаётся только кнопка во всю ширину (copy.md §2) */}
      <p className={`label ${styles.facts}`}>244,1 М² · 23 ЭТАЖ</p>
      <a className={`btn ${styles.action}`} href="#contact">
        Записаться на просмотр
      </a>
    </div>
  );
}
