/* iCITY 113Н — подвал страницы.
   Путь в проекте: components/Footer.tsx

   Последний элемент страницы, после Contact. Перфорированный разделитель
   плюс одна строка реквизитов — без анимаций, без растра фритты: страница
   уже отыграла кульминацию в форме выше, здесь только спокойный выход.

   Ссылка на политику ведёт туда же, куда легал-строка под кнопкой формы —
   POLICY_HREF импортируется из Contact.tsx, второго источника правды нет.
   Юрлицо «ООО «Столия»» — из докс/copy.md §«Подвал»; там же пометка
   AGENTS.md сверить реквизиты с заказчиком перед публикацией. */

import styles from './Footer.module.css';
import { POLICY_HREF } from './Contact';

export default function Footer() {
  return (
    <footer>
      <div className={styles.divider} aria-hidden="true" />
      <div className={styles.row}>
        <p className={styles.item}>Офис 244,1 м² · Помещение 113Н · Space Tower, iCITY</p>
        <p className={styles.item}>Москва, Ермакова Роща, 1с1</p>
        <p className={styles.item}>
          <a className={styles.link} href={POLICY_HREF}>
            Политика обработки данных
          </a>
        </p>
        <p className={styles.item}>© ООО «Столия», 2026</p>
      </div>
    </footer>
  );
}
