'use client';

/* iCITY 113Н — кнопка «Записаться на просмотр» на экране 2.
   Путь в проекте: components/ScrollToContactAction.tsx

   Прокручивает страницу к самому низу поездкой ScrollTrip
   (lib/motion.ts, requestSmoothScrollToBottom), а не мгновенным
   браузерным прыжком по #contact — тот читался как «сайт сразу
   показал форму».

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

import { requestSmoothScrollToBottom } from '@/lib/motion';

export default function ScrollToContactAction({ className }: { className: string }) {
  return (
    <a
      className={className}
      href="#contact"
      onClick={(e) => {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (requestSmoothScrollToBottom()) e.preventDefault();
      }}
    >
      Записаться на просмотр
    </a>
  );
}
