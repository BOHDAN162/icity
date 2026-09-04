/* iCITY 113Н — счётчик чисел, один на весь сайт.
   Путь в проекте: lib/countUp.ts

   ЧТО ЭТО. Один rAF, который на входе блока в кадр прокручивает числа
   от нуля к их настоящему значению за две секунды и больше не живёт.
   Работает по разметке: любой элемент с атрибутом `data-count` внутри
   области действия считается числом, а значение атрибута — это его
   ФИНАЛЬНЫЙ текст.

   ПОЧЕМУ ФИНАЛ ЛЕЖИТ В АТРИБУТЕ, А НЕ ЧИТАЕТСЯ ИЗ textContent.
   В разработке React монтирует эффекты дважды (StrictMode). Второй
   проход прочитал бы уже подменённый текст — «0,0» — и принял бы его
   за финал: число досчитывало бы до нуля. Атрибут не меняется никогда,
   поэтому оба прохода видят одно и то же.

   ЧТО СЧИТАЕТСЯ ЧИСЛОМ. Любая цепочка цифр с разрядами через узкий
   неразрывный пробел и десятичной запятой: «244,1», «1 300 000»,
   «23 / 61» (два числа, не одно). Формат сохраняется покадрово:
   разрядность, разделитель и знаки после запятой берутся из финальной
   строки, поэтому «1 300 000 ₽ / мес» на любом кадре остаётся
   «~ ₽ / мес», а не превращается в «1300000».

   РАСКЛАДКУ СЧЁТЧИК НЕ ДВИГАЕТ. Пока число растёт, знаков в нём меньше,
   чем в финале. Ширину ячейки держит призрачный дубль на весе 700
   (.numGhost в Landing, .markerGhost в Economics) — тот же приём, что
   и под ховером. Без него строка дёргалась бы на каждом переносе разряда.

   РЕ-РЕНДЕРОВ РЕАКТА НА КАДРАХ НЕТ. Текст пишется прямо в узел, как
   `--p` в OfficeStop: 120 коммитов ради счётчика — не та цена.

   Просьбу убрать движение уважаем целиком: наблюдатель не создаётся,
   разметка остаётся ровно такой, какой приехала с сервера. */

import { useEffect, type RefObject } from 'react';
import { bezier, EASE_VIEW } from '@/lib/motion';

/** Разделители разрядов, которые встречаются в проекте. */
const GROUP = '\u202F\u00A0 ';
/** Цепочка цифр: «244,1», «1 300 000», «64 000». */
const NUM_RE = /\d+(?:[\u202F\u00A0 ]\d{3})*(?:,\d+)?/g;

const groupDigits = (int: string, sep: string) =>
  (sep ? int.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : int);

/** Кадр счётчика: та же строка, но все числа в ней умножены на `t`. */
export function countFrame(final: string, t: number): string {
  if (t >= 1) return final;
  return final.replace(NUM_RE, (m) => {
    const sep = [...m].find((c) => GROUP.includes(c)) ?? '';
    const plain = sep ? m.split(sep).join('') : m;
    const dec = plain.includes(',') ? plain.length - plain.indexOf(',') - 1 : 0;
    const out = (Number(plain.replace(',', '.')) * t).toFixed(dec);
    const [int, frac] = out.split('.');
    return groupDigits(int, sep) + (frac ? `,${frac}` : '');
  });
}

/* СИММЕТРИЧНАЯ КРИВАЯ, ПАРА К --ease-view. Здесь стоял easeOutCubic
   («быстрый разгон, мягкое торможение»), и на счётчике он читался
   резко: за первые 200 мс из тысячи проходило ПОЛОВИНА пути — цифры
   мелькали нечитаемо, а последние полсекунды еле ползли. Заказчик
   попросил 4 сентября 2026 «медленнее и плавнее, но не дольше»:
   длительность осталась прежней, сменился характер. Симметричная
   отдаёт половину ровно на середине времени, и число успевает
   прочитаться на всём ходу.

   Кривая берётся из общего места, а не пишется формулой заново:
   ей же едут выезды кадров вида и полоса в экономике, и разъехаться
   они не должны. */
const easeCount = bezier(EASE_VIEW);

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

type Options = {
  /** сколько идёт счёт, мс */
  duration?: number;
  /** ждать перед стартом, мс: под уже занятое чем-то другим начало */
  delay?: number;
  /** доля блока в кадре, после которой счёт начинается */
  threshold?: number;
};

/**
 * Прокручивает числа внутри `ref` один раз — когда блок появился в кадре.
 * Числа помечаются атрибутом `data-count` с финальным текстом.
 */
export function useCountUpOnView(
  ref: RefObject<HTMLElement | null>,
  { duration = 2000, delay = 0, threshold = 0.5 }: Options = {},
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    if (window.matchMedia(REDUCE_QUERY).matches) return undefined;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-count]'));
    if (nodes.length === 0) return undefined;

    const finals = nodes.map((n) => n.dataset.count ?? '');
    const write = (t: number) => {
      nodes.forEach((n, i) => { n.textContent = countFrame(finals[i], t); });
    };

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = 0;

    const frame = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      write(easeCount(t));
      if (t < 1) raf = requestAnimationFrame(frame);
      else raf = 0;
    };

    const play = () => {
      started = performance.now();
      raf = requestAnimationFrame(frame);
    };

    /* Нули ставим сразу, не дожидаясь наблюдателя: блок ещё под сгибом,
       и подмена никому не видна, зато к его появлению счётчик уже
       в исходном состоянии и не мигнёт финалом. */
    write(0);

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();               /* one-shot: второго прогона нет */
        if (delay > 0) timer = setTimeout(play, delay);
        else play();
      },
      { threshold },
    );
    io.observe(root);

    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      /* Размонтировались посреди счёта — оставляем настоящие числа. */
      write(1);
    };
  }, [ref, duration, delay, threshold]);
}
