'use client';

/* iCITY 113Н — ворота первого экрана.
   Путь в проекте: components/HeroGate.tsx

   ЧТО ЭТО. Обёртка всей страницы: пока стадия 'hero', первой в потоке
   стоит секция HeroVideo (100lvh), контент лежит сразу за ней — на один
   экран ниже — и накрыт inert. Скролл заблокирован. Во время финала
   ролика HeroVideo пишет сюда прогресс 0→1, и контент выезжает снизу
   трансформом ровно на 100lvh. На 'done' hero размонтируется и класс
   с трансформом снимается ОДНИМ setState — один коммит React, контент
   оказывается в потоке на том же месте, где стоял с transform: рывка нет.

   ПОЧЕМУ TRANSFORM ЖИВЁТ В КЛАССЕ, А НЕ В STYLE. После свапа на обёртке
   не должно остаться никакого transform — даже translateY(0): предок
   с трансформом становится содержащим блоком для position: fixed,
   а внутри контента живёт кукольный дом плана именно в fixed. Пока
   hero жив, план недостижим (inert + скролл заблокирован), поэтому
   на время выезда transform безопасен.

   ПРОГРЕСС — НАПРЯМУЮ В STYLE, БЕЗ РЕ-РЕНДЕРОВ. onLift пишет CSS-
   переменную --hero-lift на узле; сдвиг считает calc в HeroGate.module.css.
   Ре-рендеров React на кадрах нет — дисциплина проекта.

   ВОЗВРАТА НЕТ. Стадия ходит только 'hero' → 'done'. К первому экрану
   возвращает исключительно перезагрузка страницы. Esc нигде глобально
   не слушается (единственный Esc остался внутри планировки). */

import {
  useCallback, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react';
import HeroVideo from './HeroVideo';
import { focusQuietly } from '@/lib/focus';
import { lockScroll, unlockScroll, HERO_LOCK } from '@/lib/scrollLock';
import styles from './HeroGate.module.css';

export default function HeroGate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<'hero' | 'done'>('hero');
  const contentRef = useRef<HTMLDivElement>(null);

  const onLift = useCallback((lift: number) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.setProperty('--hero-lift', lift.toFixed(4));
    /* Контент показывается ровно в тот кадр, когда выезд действительно
       пошёл. До этого он скрыт (visibility в .lifted) — иначе на iPhone
       из-под первого экрана снизу торчит лента с кромкой офиса, и никакой
       единицей высоты это не лечится, см. комментарий в HeroGate.module.css.
       Мигания на старте нет: при lift чуть больше нуля контент ещё стоит
       ниже кромки экрана. */
    if (lift > 0 && el.style.visibility !== 'visible') el.style.visibility = 'visible';
  }, []);

  const onDone = useCallback(() => setStage('done'), []);

  /* Замок страницы. Ставится с гидрацией: до неё скролл технически
     возможен пару сотен мс — scrollTo(0,0) закрывает и это окно.
     scrollRestoration = 'manual' на время hero: перезагрузка с середины
     страницы не должна восстановить прокрутку под заблокированным body.
     Cleanup срабатывает ровно в момент свапа: отдаёт скролл, снимает
     переменную выезда и переносит фокус на контент — кнопка «Войти»
     умерла вместе с hero, клавиатура продолжает с начала страницы. */
  useLayoutEffect(() => {
    if (stage !== 'hero') return undefined;
    const content = contentRef.current;
    lockScroll(HERO_LOCK);
    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    return () => {
      unlockScroll(HERO_LOCK);
      /* именно 'auto', а не запомненное значение: браузер хранит
         scrollRestoration на записи истории между перезагрузками,
         и «запомнить и вернуть» навсегда закрепил бы manual */
      window.history.scrollRestoration = 'auto';
      content?.style.removeProperty('--hero-lift');
      content?.style.removeProperty('visibility');
      focusQuietly(content);
    };
  }, [stage]);

  return (
    <>
      {stage === 'hero' && <HeroVideo onLift={onLift} onDone={onDone} />}
      <div
        ref={contentRef}
        className={stage === 'hero' ? styles.lifted : undefined}
        inert={stage === 'hero'}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}
