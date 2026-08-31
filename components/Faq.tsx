/* iCITY 113Н — вопросы (вариант E1: аккордеон-оглавление).
   Путь в проекте: components/Faq.tsx

   Десять вопросов, нативный <details>/<summary>. Все элементы делят один
   атрибут name="faq" — браузер сам держит «открыт только один», второго
   слушателя и стейта нет. Первый вопрос открыт атрибутом open с первого
   рендера; дальше React в него не вмешивается, это некотролируемое поле,
   как у обычного <details> без onToggle.

   ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ. У нативной группы open-состояние переключается
   мгновенно: закрытие предыдущего пункта не анимируется, анимируется
   только раскрытие следующего (grid-template-rows в CSS-модуле). Это
   принято как есть — оркестровка закрытия через JS ради одной анимации
   не стоит второго слушателя на весь список.

   ДАННЫЕ. FAQ_ITEMS — единственный источник: из него рендерится и список,
   и JSON-LD FAQPage ниже. Тексты — из docs с фактами по сделке, дословно,
   переписывать нельзя. Группы разрядов в числах — через узкий
   неразрывный пробел U+202F, как everywhere по проекту (AGENTS.md). */

import styles from './Faq.module.css';

type FaqItem = {
  id: string;
  q: string;
  a: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    id: '01',
    q: 'Что входит в ставку 1 300 000 ₽ в месяц?',
    a: 'Эксплуатационные расходы и НДС включены в ставку. Отдельно оплачиваются только коммунальные услуги — по счётчикам.',
  },
  {
    id: '02',
    q: 'Сколько нужно заплатить при заключении договора?',
    a: 'Депозит два месяца — 2 600 000 ₽ — и первый месяц аренды 1 300 000 ₽. Итого 3 900 000 ₽.',
  },
  {
    id: '03',
    q: 'Какой минимальный срок аренды?',
    a: 'Одиннадцать месяцев. Более длинный срок обсуждается.',
  },
  {
    id: '04',
    q: 'Сколько человек размещается в офисе?',
    a: 'Двадцать шесть рабочих мест в пяти кластерах. Плюс отдельный кабинет, переговорная и кухня-столовая с барной стойкой.',
  },
  {
    id: '05',
    q: 'Нужен ли ремонт перед въездом?',
    a: 'Нет. Дизайнерская отделка PRIDEX полностью выполнена — помещение готово. Мебель в ставку не входит; для неё есть готовый дизайн-проект расстановки.',
  },
  {
    id: '06',
    q: 'Можно ли переставить или убрать перегородки?',
    a: 'Да, по согласованию с собственником. При расстановке учитывайте пять круглых колонн — три из них стоят в открытой части.',
  },
  {
    id: '07',
    q: 'Насколько ставка отличается от рынка?',
    a: 'Сопоставимые готовые блоки 150–350 м² в iCITY просят 80 000–100 000 ₽ за м² в год. Здесь около 64 000 — на 20–36% ниже.',
  },
  {
    id: '08',
    q: 'Есть ли парковка?',
    a: 'Паркинг на шести уровнях, 950 мест, заезд прямо с ТТК. Есть зарядки для электромобилей и велопарковка.',
  },
  {
    id: '09',
    q: 'Как добраться на общественном транспорте?',
    a: 'МЦД «Тестовская» — минута пешком. Метро и МЦК «Шелепиха» — пять минут. «Деловой центр» и «Международная» — десять.',
  },
  {
    id: '10',
    q: 'С кем заключается договор?',
    a: 'Аренда прямая, от собственника. Показ возможен в день обращения.',
  },
];

const FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.a,
    },
  })),
};

export default function Faq() {
  return (
    <section className={styles.section} id="faq" aria-labelledby="faq-eyebrow">
      <div className={styles.inner}>
        <p className={`label ${styles.eyebrow}`} id="faq-eyebrow">
          ВОПРОСЫ
        </p>

        <h2 className={styles.title}>Десять вопросов до просмотра</h2>

        <div className={styles.list}>
          {FAQ_ITEMS.map((item) => (
            <details key={item.id} className={styles.item} name="faq" open={item.id === '01'}>
              <summary className={styles.summary}>
                <span className={styles.index}>{item.id}</span>
                <span className={styles.question}>{item.q}</span>
                <span className={styles.dots} aria-hidden="true" />
                <span className={styles.icon} aria-hidden="true">
                  <span className={`${styles.iconBar} ${styles.iconBarH}`} />
                  <span className={`${styles.iconBar} ${styles.iconBarV}`} />
                </span>
              </summary>
              <div className={styles.body}>
                <div className={styles.bodyInner}>
                  <p className={styles.answer}>{item.a}</p>
                </div>
              </div>
            </details>
          ))}
        </div>

        <p className={styles.note}>Не нашли свой — позвоните управляющей, ответ займёт минуту.</p>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
    </section>
  );
}
