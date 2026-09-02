'use client';

/* iCITY 113Н — кнопка «Записаться на просмотр» на экране 2.
   Путь в проекте: components/ScrollToContactAction.tsx

   Прокручивает страницу к самому низу той же плавной огибающей, что
   и колесо (lib/motion.ts, requestSmoothScrollTo), а не мгновенным
   браузерным прыжком по #contact — тот читался как «сайт сразу
   показал форму».

   href остаётся якорем: без JS и под prefers-reduced-motion клик
   уходит браузеру штатно, мгновенным прыжком к секции формы.

   ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ. Landing — серверный компонент (см. шапку
   CountUpScope.tsx), и обработчик клика клиентский по определению —
   вынесен в свою обёртку, а не тащит в клиентский бандл весь экран. */

import { requestSmoothScrollTo } from '@/lib/motion';

export default function ScrollToContactAction({ className }: { className: string }) {
  return (
    <a
      className={className}
      href="#contact"
      onClick={(e) => {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        e.preventDefault();
        requestSmoothScrollTo(document.documentElement.scrollHeight);
      }}
    >
      Записаться на просмотр
    </a>
  );
}
