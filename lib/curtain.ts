/* iCITY 113Н — сигнал «створки прелоадера пошли в стороны».
   Путь в проекте: lib/curtain.ts

   ЗАЧЕМ. Копия первого экрана проявляется медленно, ~1,9 с. Прелоадер
   держит экран закрытым непрозрачными створками --paper первые ~2,1 с
   (1900 мс отсчёта лифта плюс 220 мс на угасание его интерфейса),
   и анимация, запущенная на монтировании, целиком отыграла бы за
   закрытым занавесом: зритель увидел бы уже проявленный текст, а самого
   проявления — нет.

   ФИКСИРОВАННОЙ ЗАДЕРЖКОЙ ЭТО НЕ ЛЕЧИТСЯ. sessionStorage
   ('icity-preloaded') выключает прелоадер на второй загрузке во вкладке,
   и правильная задержка становится нулевой. Задержка «под створки»
   в этом случае подвесила бы пустой первый экран на две секунды.
   Нужен живой сигнал.

   ОДИН ФЛАГ, ОДИН ПЕРЕХОД: false → true, ровно как стадия в HeroGate.
   Возврата нет — занавес открывается один раз за загрузку страницы.

   Публикует Preloader, из ОБЕИХ веток: обычной и пропуска по
   sessionStorage. Читает HeroVideo через useSyncExternalStore — тем же
   приёмом, что prefers-reduced-motion и ориентацию, они уже в файле.
   Ровно один ре-рендер за всю жизнь первого экрана; на кадрах
   ре-рендеров нет, дальше анимацию ведёт композитор. */

let curtainOpen = false;
const listeners = new Set<() => void>();

export function openCurtain(): void {
  if (curtainOpen) return;
  curtainOpen = true;
  for (const notify of listeners) notify();
}

export function subscribeCurtain(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export const getCurtainSnapshot = () => curtainOpen;

/* На сервере занавес всегда закрыт: разметка уезжает без .revealed,
   и гидрация не расходится. Если к моменту гидрации занавес уже открыт,
   React перечитает снимок сразу после неё и перерисует — штатное
   поведение useSyncExternalStore. */
export const getCurtainServerSnapshot = () => false;
