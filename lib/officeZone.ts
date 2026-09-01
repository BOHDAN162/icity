/* iCITY 113Н — переход в зону офиса откуда угодно со страницы.
   Путь в проекте: lib/officeZone.ts

   ЗАЧЕМ. Кукольный дом теперь открывается двумя разными кнопками —
   «Открыть планировку» внутри офиса и «3D-модель» в подвале, у формы
   записи. В первом случае выбранную зону принимает сам OfficeHub, он же
   родитель. Во втором между ними полстраницы, и прокидывать колбэк через
   Landing, Economics, Complex, Location, Faq и Contact значило бы
   протащить состояние офиса через шесть секций, которые про офис ничего
   не знают и знать не должны.

   ЧТО ВМЕСТО ЭТОГО. Один объявительный канал: кто угодно зовёт
   requestZone(), OfficeHub на него подписан и делает свой обычный go().
   Ровно та же дисциплина, что у lib/curtain.ts, только там один флаг
   без возврата, а здесь событие, которое может повториться.

   ПОЧЕМУ НЕ useSyncExternalStore, КАК В CURTAIN. Это не состояние,
   а команда: «перейди в кухню» может прийти дважды подряд с одним и тем
   же ключом, и снимок между ними не меняется — подписчик просто не
   узнал бы о втором разе. Набор слушателей и прямой вызов честнее.

   СКРОЛЛ ДЕЛАЕТСЯ МГНОВЕННО И ЭТО НЕ ЛЕНЬ. К моменту вызова экран
   закрыт оверлеем планировки — он в position: fixed во весь вьюпорт,
   и под ним не видно ничего. Тот же шов, которым PlanDollhouse
   переключает офис за 400 мс до своего закрытия: страница переезжает
   к офису, пока её не видно, и оверлей уходит уже над нужной зоной.
   Плавная прокрутка через восемь секций заняла бы секунды и приехала
   бы позже, чем оверлей закроется. */

import type { RenderKey } from '@/lib/interior';

type Listener = (zone: RenderKey) => void;

const listeners = new Set<Listener>();

/** OfficeHub подписывается на монтировании и живёт с этим всю страницу. */
export function onZoneRequest(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** «Переключи офис на эту зону». Кто слушает — тот и переключает. */
export function requestZone(zone: RenderKey): void {
  for (const notify of listeners) notify(zone);
}

/** id секции офиса; она же якорь прокрутки. Дублируется в OfficeStop.tsx. */
export const OFFICE_ID = 'office';

/** Ставит страницу на верх секции с этим id. Мгновенно, см. шапку. */
export function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  /* Двухаргументная форма, а не { behavior }: она мгновенна всегда,
     чем бы ни было scroll-behavior в CSS у html. */
  window.scrollTo(0, top);
}

/**
 * Ставит страницу на верх офис-остановки — то есть в её прогресс 0,
 * где офис виден целиком, а кадр вида ещё не поднялся.
 */
export function scrollToOffice(): void {
  scrollToId(OFFICE_ID);
}

/* --- хлебная крошка «я пришёл в офис из подвала» ----------------------
   ЗАЧЕМ. В офис ведут два пути, и они не равны. Обычный — прокруткой
   сверху: уходить оттуда некуда, Esc просто переключает планировку.
   Второй — кнопкой «3D-модель» у формы записи: зрителя увозит через
   восемь секций, и обратной дороги, кроме ручной прокрутки, у него нет.
   Крошка — это ровно один уровень возврата для второго пути.

   ПРАВИЛА ЖИЗНИ, и каждое просил заказчик (2026-09-01):
     ставится  — когда из подвала ВЫБРАЛИ ЗОНУ (Contact.enterZone).
                 Открыть модель и закрыть, не выбрав, — не переход
                 в офис, крошки после такого оставаться не должно;
     тратится  — одноразово, при закрытии плана по Esc или «Закрыть»
                 (OfficeHub.closePlan). Выбор другой зоны внутри плана
                 её НЕ тратит: зритель ходит по офису, а не уходит из него;
     рвётся    — когда зритель сам уехал из офиса прокруткой. Прыжок
                 вниз к форме через минуту после того, как про него
                 забыли, читался бы как сбой.

   Почему не useSyncExternalStore: React о крошке знать не нужно, её
   читают императивно в обработчике. Тот же довод, что у cursorMode. */

type OfficeReturn = {
  /** id секции, куда вернуть страницу */
  id: string;
  /** куда вернуть фокус: кнопка, которой открыли модель */
  focus: HTMLElement | null;
};

let pending: OfficeReturn | null = null;
let watching = false;

/* Ушёл ли зритель от офиса. Мерим ГЕОМЕТРИЕЙ, а не фазой OfficeStop:
   фазовая машина под prefers-reduced-motion не запускается вовсе и
   навсегда остаётся на 'office' — связь не рвалась бы никогда у той
   части зрителей, что просит убрать движение. Здесь же нужен простой
   факт: секция офиса ушла с экрана целиком.

   Порога в пикселях нарочно нет. Секция офиса высокая (100svh + 220svh),
   и прокрутка внутри неё — это ещё не уход: зритель разглядывает
   панораму и может вернуться. Уход — когда секции на экране не осталось. */
function officeGone(): boolean {
  const el = document.getElementById(OFFICE_ID);
  if (!el) return true;
  const r = el.getBoundingClientRect();
  return r.bottom <= 0 || r.top >= window.innerHeight;
}

const onScroll = () => {
  if (officeGone()) clearOfficeReturn();
};

/* Слушатель живёт ровно столько же, сколько крошка, и снимается вместе
   с ней. Постоянного слушателя прокрутки на сайте от этого не заводится:
   крошка живёт минуты в редком сценарии, а не всю страницу. */
function watch(): void {
  if (watching) return;
  watching = true;
  window.addEventListener('scroll', onScroll, { passive: true });
}

function unwatch(): void {
  if (!watching) return;
  watching = false;
  window.removeEventListener('scroll', onScroll);
}

export function setOfficeReturn(to: OfficeReturn): void {
  pending = to;
  watch();
}

/** Читает и сразу гасит: крошка одноразовая по устройству. */
export function takeOfficeReturn(): OfficeReturn | null {
  const held = pending;
  pending = null;
  unwatch();
  return held;
}

export function clearOfficeReturn(): void {
  pending = null;
  unwatch();
}
