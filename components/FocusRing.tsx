'use client';

/* iCITY 113Н — кольцо фокуса следует способу прихода фокуса.
   Путь в проекте: components/FocusRing.tsx

   ЧТО ЧИНИТ. Заказчик поймал живьём 4 сентября 2026: клик мышью
   по «Записаться на просмотр», следом Escape — и вокруг кнопки чёрная
   рамка. Механика такая. У кнопки href="#contact", но
   ScrollToContactAction зовёт preventDefault(), когда поездка взялась,
   и перехода по хешу не происходит — значит якорь УДЕРЖИВАЕТ фокус
   после клика. Кольца при этом нет: фокус пришёл мышью, :focus-visible
   ложно. А дальше Chrome поднимает :focus-visible у УЖЕ сфокусированного
   элемента на ЛЮБОМ нажатии клавиши — так он понимает «зритель перешёл
   на клавиатуру». Замер на живой странице, Chrome 148: после клика
   `outline: none`, после Escape (и после любой другой клавиши)
   `outline: solid 2px rgb(16, 22, 25)` от глобального правила
   в tokens.css.

   На этом сайте Escape — глобальный орган управления, тумблер
   планировки. Жать его мышевику совершенно нормально, и каждое такое
   нажатие обводило кольцом то, по чему в последний раз кликнули.

   ЧТО ДЕЛАЕМ. Замораживаем решение браузера в тот момент, когда фокус
   пришёл, и не даём поднять его задним числом. Если на focusin элемент
   под :focus-visible не подпадает — фокус пришёл мышью или программно, —
   вешаем на него data-focus-quiet; на focusout снимаем. Правила,
   рисующие кольцо, этот маркер учитывают (tokens.css и по одному
   в модулях, где у кольца своя замена).

   ЧЕГО НЕ ДЕЛАЕМ. Не глушим кольцо вообще: пришёл Tab-ом — маркера нет,
   кольцо на месте, и это требование раздела «Доступность» в AGENTS.md.
   Проверяется замером: клик → outline none, Escape → outline none,
   Tab → outline solid 2px rgb(16, 22, 25).

   Слушателей два, оба пассивные и оба ничего не перехватывают: клавиши
   этот модуль не слушает вовсе. Запрет «клавиши у сайта отбирает ровно
   один обработчик» не нарушен.

   ПОЧЕМУ Element, А НЕ HTMLElement. Зоны плоского плана (.flatZone
   в PlanDollhouse) — SVG-узлы, и у них тоже есть своё правило
   :focus-visible. matches и setAttribute живут на Element, этого хватает.

   ПОЧЕМУ В КОРНЕВОМ layout. Правило общее для всего сайта, включая
   страницу политики: там тоже есть ссылки и details. Тот же довод,
   что у Cursor и ScrollTrip. */

import { useEffect } from 'react';
import { QUIET_FOCUS_ATTR } from '@/lib/focus';

export default function FocusRing() {
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      /* Программный фокус маркер уже несёт — его ставит focusQuietly
         до вызова focus(), потому что в Safari focusVisible: false
         игнорируется и спрашивать браузер там бесполезно. */
      if (!el.matches(':focus-visible')) el.setAttribute(QUIET_FOCUS_ATTR, '');
    };
    const onFocusOut = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof Element) el.removeAttribute(QUIET_FOCUS_ATTR);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return null;
}
