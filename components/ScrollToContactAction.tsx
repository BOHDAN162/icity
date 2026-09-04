'use client';

/* iCITY 113Н — кнопка «Записаться на просмотр» на экране 2.
   Путь в проекте: components/ScrollToContactAction.tsx

   Прокручивает страницу поездкой ScrollTrip (lib/motion.ts), а не
   мгновенным браузерным прыжком по #contact — тот читался как «сайт
   сразу показал форму». На десктопе цель — самый низ страницы,
   на телефоне — сама форма по центру экрана (разбор ниже).

   НИЗ — ЭТО НЕ ЧИСЛО, СНЯТОЕ ЗДЕСЬ. Прежде кнопка передавала
   scrollHeight на момент клика, а страница по дороге вниз растёт
   (кадр комплекса монтируется по IntersectionObserver, ниже подъезжают
   картинки) — цель оказывалась выше настоящего низа. Теперь цель живая,
   её пересчитывает сам цикл прокрутки на каждом кадре.

   href остаётся якорем, и preventDefault ставится ТОЛЬКО когда поездку
   действительно взяли. Не взяли (нет JS, prefers-reduced-motion,
   заперта страница) — клик уходит браузеру штатно, мгновенным прыжком
   к секции формы. Прежде отказ терялся молча, и клик не делал ничего:
   ровно то «иногда не срабатывает», на которое жаловался Богдан.

   ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ. Landing — серверный компонент (см. шапку
   CountUpScope.tsx), и обработчик клика клиентский по определению —
   вынесен в свою обёртку, а не тащит в клиентский бандл весь экран. */

import { requestSmoothScrollTo, requestSmoothScrollToBottom } from '@/lib/motion';

/* НА ТЕЛЕФОНЕ ЦЕЛЬ ДРУГАЯ, И ЭТО ПРОСЬБА ЗАКАЗЧИКА 5 сентября 2026.
   На десктопе низ страницы и есть нужный кадр: форма записи занимает
   его целиком, подвал под ней узкий. На узкой колонке та же поездка
   до низа оставляет форму сверху, наполовину за краем, а в кадре стоит
   подвал. Поэтому здесь целимся не в низ, а в саму форму — ставим её
   по центру экрана.

   Цель ЖИВАЯ, функцией: пока идёт поездка, страница ниже кнопки растёт
   (кадр комплекса монтируется по IntersectionObserver, подъезжают
   картинки), и форма едет вместе с ней. Число, снятое на клике,
   промахнулось бы ровно на этот прирост — та же причина, по которой
   «низ» тоже не снимается заранее.

   Если форма выше экрана, центрировать нечего: прижимаем её верх
   к кромке с полем в --s-4. Не нашли форму — возвращаем низ страницы,
   то есть прежнее поведение. */
const MOBILE = '(max-width: 767px)';
const GAP_MIN = 16;
/* Тот же адрес, что в href ниже. Константа CONTACT_ID живёт в Contact.tsx,
   но импортировать её отсюда нельзя: кнопка стоит на экране 2, и импорт
   утащил бы в её чанк весь модуль формы вместе с холстом и оверлеями. */
const CONTACT_ID = 'contact';

const centerContactForm = (): number => {
  const form = document.querySelector(`#${CONTACT_ID} form`);
  if (!form) return Number.POSITIVE_INFINITY;
  const rect = form.getBoundingClientRect();
  const gap = Math.max(GAP_MIN, (window.innerHeight - rect.height) / 2);
  return rect.top + window.scrollY - gap;
};

export default function ScrollToContactAction({ className }: { className: string }) {
  return (
    <a
      className={className}
      href="#contact"
      onClick={(e) => {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const took = matchMedia(MOBILE).matches
          ? requestSmoothScrollTo(centerContactForm)
          : requestSmoothScrollToBottom();
        if (took) e.preventDefault();
      }}
    >
      Записаться на просмотр
    </a>
  );
}
