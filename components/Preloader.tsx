'use client';

/* iCITY 113Н — экран 0: прелоадер «лифт + занавес».
   Путь в проекте: components/Preloader.tsx

   ЧТО ЭТО. Полноэкранная накладка поверх всего на первой загрузке.
   Слева лестница этажей 01→23 (буквальная метафора «подняться на 23»,
   не проценты), справа крупный номер этажа моно. По завершении двери-
   створки расходятся в стороны, открывая {children} страницы, и УНОСЯТ
   ИНТЕРФЕЙС С СОБОЙ: лестница и число написаны на створках и стоят
   неподвижно, пока уходящий край их срезает — не гаснут, а исчезают
   по кромке. Устройство — в .module.css, .keep. Дальше компонент
   размонтируется.

   ПРОГРЕСС — РЕАЛЬНЫЕ БАЙТЫ ДВУХ ВИДЕО ПЕРВОГО ЭКРАНА. Луп облаков плюс
   ролик полёта, вариант под текущую ориентацию; счётчик — lib/heroPreload.ts,
   он же их и качает. Единственное место, читающее прогресс, — advance()
   ниже; draw() / open() / разметка про источник не знают.

   ТРИ ПРАВИЛА ПОЕЗДКИ, И КАЖДОЕ ЗАКРЫВАЕТ СВОЮ БЕДУ:

   1. СГЛАЖИВАНИЕ. Байты приходят рывками — чанк на 64 КБ, потом пауза.
      Показанный этаж догоняет реальный экспоненциально (CATCH_RATE)
      и никогда не быстрее RUSH_RATE: скачок прогресса 0,3 → 0,8
      превращается в проезд, а не в телепорт. CREEP_RATE — обратное:
      минимальная скорость, иначе экспонента вечно доползала бы
      последний процент.
   2. МИНИМУМ ТРИ СЕКУНДЫ. Из кэша файлы приходят мгновенно, и лифт
      мигнул бы 1→23 за кадр. Потолок скорости — линейный cap = t/MIN_MS:
      23 этажа не быстрее трёх секунд. Замер на прогретом кэше: 3,04 с.
   3. ПРЕДОХРАНИТЕЛЬ. На 7,4 с (MAX_MS минус добор) поездка досрочно
      доводится до 23 за FUSE_SLEW_MS и створки идут — ровно на 8-й
      секунде. Ждать нечего: луп в шесть раз легче ролика и к этому
      моменту почти наверняка играет под створками. Кнопку «Войти»
      придержит уже сам HeroVideo, пока ролик не догрузится.

   ПОЕЗДКА КОНЧАЕТСЯ, КОГДА НА ТАБЛО 23, а не когда float дошёл до 1:
   этаж — это метафора, а не проценты. 23 загорается на 21,5/22 = 0,9773,
   и ждать оставшиеся два процента незачем — они нигде не видны.

   Один rAF на компонент, ре-рендеров React на кадрах нет: floor
   пишется в DOM напрямую (textContent), классы тиков — через
   classList. Единственное состояние React — `visible`, и меняется
   оно ровно один раз, на размонтировании.

   ЖЁСТКАЯ ПЕРЕЗАГРУЗКА ПОКАЗЫВАЕТ ЭКРАН СНОВА. sessionStorage помнит
   показ до конца вкладки, но Cmd/Ctrl+Shift+R должен пробивать эту
   память — это метит proxy.ts кукой icity-hard-reload (см. её комментарий
   про Cache-Control: no-cache и оговорку про Safari). */

import {
  useEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import { openCurtain } from '@/lib/curtain';
import {
  currentHeroVariant, heroPreloadProgress, startHeroPreload, type HeroVariant,
} from '@/lib/heroPreload';
import styles from './Preloader.module.css';

/* 23 этажа не быстрее трёх секунд — даже из кэша. */
const MIN_MS = 3000;
/* Предохранитель: во столько створки идут при любой загрузке. */
const MAX_MS = 8000;
/* Досрочный добор до 23 перед створками — чтобы предохранитель
   не выглядел обрывом на одиннадцатом этаже. */
const FUSE_SLEW_MS = 600;
/* Догон рывка, 1/с. Держит постоянное отставание v/CATCH_RATE ≈ 0,037
   (меньше этажа) и закрывает разрыв 0,3 за четверть секунды. */
const CATCH_RATE = 9;
/* Минимальная скорость добора, 1/с: экспонента сама последний процент
   не доедет. */
const CREEP_RATE = 0.3;
/* Потолок скорости, 1/с ≈ 12,6 этажа в секунду. Это и есть запрет
   на телепорт: сколько бы байт ни пришло одним куском, лифт едет. */
const RUSH_RATE = 0.55;
/* Порог, на котором на табло загорается 23: round(1 + p*22) === 23. */
const FLOOR_23 = 21.5 / 22;
/* Стоянка на 23-м этаже перед створками. Лифт доехал — и секунду стоит:
   без неё прибытие читается как проскок, номер загорается и тут же
   гаснет вместе с интерфейсом. Это часть впечатления, а не задержка:
   поездка кончилась, дальше открываются двери.
   К предохранителю прибавляется тоже — иначе на медленной сети финал
   поездки выглядел бы обрубленным ровно там, где он и так вынужденный.
   Створки в худшем случае идут на MAX_MS + HOLD_23_MS = 9 с. */
const HOLD_23_MS = 1000;

/* Ветка reduced-motion: ни лестницы, ни створок, ни единого байта видео —
   ждать нечего и держать зрителя три секунды не за чем. Прежняя пауза,
   ровно столько, сколько нужно openCurtain() и .fade. */
const REDUCED_MS = 1900;

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getMotionSnapshot = () => window.matchMedia(MOTION_QUERY).matches;
const getMotionServerSnapshot = () => false;

const STORAGE_KEY = 'icity-preloaded';
const HARD_RELOAD_COOKIE = 'icity-hard-reload';

/* Кука ставится proxy.ts на один запрос при Cache-Control: no-cache
   (жёсткая перезагрузка) и сама гаснет через несколько секунд (maxAge
   в proxy.ts) — чистим только чтение, без побочного стирания: эффект
   в StrictMode дев-режима вызывается дважды при монтировании, и если
   первый вызов гасит куку, второй её уже не увидит и скроет прелоадер. */
function hasHardReloadFlag(): boolean {
  return document.cookie
    .split('; ')
    .some((entry) => entry.startsWith(`${HARD_RELOAD_COOKIE}=`));
}

type Ride = { shown: number; fuseAt: number; fuseFrom: number };

/* Один шаг поездки. Состояние снаружи (Ride), чтобы функция осталась
   чистой и её можно было читать сверху вниз. */
function advance(ride: Ride, variant: HeroVariant, elapsed: number, dt: number): {
  p: number; done: boolean;
} {
  const { metered, ratio } = heroPreloadProgress(variant);
  /* Без честного знаменателя (нет Content-Length, fetch отвалился,
     reduced-motion — видео вообще не грузится) ждать нечего: едем
     номинальные три секунды, их задаст cap. Выдуманный процент
     рисовать нельзя — лифт врал бы уверенно. */
  const real = metered ? ratio : 1;

  if (!ride.fuseAt && real < 1 && elapsed >= MAX_MS - FUSE_SLEW_MS) {
    ride.fuseAt = elapsed;
    ride.fuseFrom = ride.shown;
  }
  if (ride.fuseAt) {
    const k = Math.min(1, (elapsed - ride.fuseAt) / FUSE_SLEW_MS);
    ride.shown = ride.fuseFrom + (1 - ride.fuseFrom) * k;
    return { p: ride.shown, done: k >= 1 };
  }

  const target = Math.min(real, elapsed / MIN_MS);
  const gap = target - ride.shown;
  if (gap > 0) {
    ride.shown += Math.min(
      gap,
      Math.max(gap * (1 - Math.exp(-CATCH_RATE * dt)), CREEP_RATE * dt),
      RUSH_RATE * dt,
    );
  }
  return {
    p: ride.shown,
    done: real >= 1 && elapsed >= MIN_MS && ride.shown >= FLOOR_23,
  };
}

export default function Preloader() {
  const reduced = useSyncExternalStore(
    subscribeMotion,
    getMotionSnapshot,
    getMotionServerSnapshot,
  );
  const [visible, setVisible] = useState(true);

  const rootRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const doorLRef = useRef<HTMLDivElement>(null);
  const doorRRef = useRef<HTMLDivElement>(null);
  const ladderRef = useRef<HTMLDivElement>(null);

  /* Загрузка стартует раньше всего остального: прелоадер монтируется
     первым в layout, а лифту нужны уже текущие байты. Вызов идемпотентен —
     HeroVideo зовёт его же, на случай второй загрузки во вкладке, когда
     прелоадера нет вовсе. Под reduced-motion не зовётся ни тем, ни другим:
     видео там не монтируется, трафика ноль. */
  useEffect(() => {
    if (reduced) return;
    startHeroPreload(currentHeroVariant());
  }, [reduced]);

  useEffect(() => {
    const forcedByHardReload = hasHardReloadFlag();
    if (!forcedByHardReload && sessionStorage.getItem(STORAGE_KEY)) {
      /* Занавеса не будет вовсе — открываем его сразу, иначе копия
         первого экрана осталась бы на нуле непрозрачности навсегда. */
      openCurtain();
      /* setState вызывается из колбэка, а не синхронно из тела эффекта —
         так требует react-hooks/set-state-in-effect; микротаск успевает
         до отрисовки кадра, вспышки интерфейса нет. */
      queueMicrotask(() => setVisible(false));
      return;
    }

    const ticks = ladderRef.current
      ? (Array.from(ladderRef.current.children) as HTMLElement[])
      : [];
    const start = performance.now();
    let raf = 0;
    let hold = 0;
    let finished = false;

    const finish = () => {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setVisible(false);
    };

    const open = () => {
      /* Занавес объявляется открытым ЗДЕСЬ, а не после разъезда створок:
         следом идут 220 мс паузы, и задержка проявления копии
         (--hero-in-delay, 200 мс) как раз в неё укладывается — створки
         трогаются ровно тогда, когда копия начинает проявляться.
         Правишь одно из двух чисел — сверяйся со вторым.
         Ветка reduced проходит здесь же, поэтому сигнал приходит всегда. */
      openCurtain();
      if (reduced) {
        rootRef.current?.classList.add(styles.fade);
        window.setTimeout(finish, 260);
        return;
      }
      window.setTimeout(() => {
        /* Один класс на створку — и всё. Интерфейс отдельной команды
           на уход не получает: он лежит внутри створок и уходит вместе
           с их кромкой (разбор — .module.css, .keep). Прежде здесь
           стоял ещё .uiOut, гасивший лестницу и число прозрачностью;
           заказчик посмотрел живьём 1 сентября 2026 и попросил срез
           кромкой, как в референсе. */
        doorLRef.current?.classList.add(styles.openL);
        doorRRef.current?.classList.add(styles.openR);
        /* 1550 = 1400 (длительность разъезда в .module.css) + запас,
           чтобы finish() не размонтировал прелоадер раньше, чем
           створки долетят до края. */
        window.setTimeout(finish, 1550);
      }, 220);
    };

    const draw = (p: number) => {
      const floor = Math.max(1, Math.round(1 + p * 22));
      if (numRef.current) numRef.current.textContent = String(floor).padStart(2, '0');
      for (const tick of ticks) {
        const f = Number(tick.dataset.f);
        tick.classList.toggle(styles.past, f < floor);
        tick.classList.toggle(styles.cur, f === floor);
      }
    };

    /* Reduced-motion: ни лестницы, ни створок, и ждать нечего —
       видео не грузится вовсе. Простая пауза таймером. */
    if (reduced) {
      draw(1);
      const poll = () => {
        if (performance.now() - start >= REDUCED_MS) { open(); return; }
        raf = requestAnimationFrame(poll);
      };
      raf = requestAnimationFrame(poll);
      return () => cancelAnimationFrame(raf);
    }

    const ride: Ride = { shown: 0, fuseAt: 0, fuseFrom: 0 };
    /* Вариант замеряется один раз: поворот экрана в первые три секунды
       не должен переписать знаменатель поездки на середине. */
    const variant = currentHeroVariant();
    let last = start;

    const loop = () => {
      const now = performance.now();
      /* dt подрезан: вкладка уходила в фон, rAF молчал, и один кадр
         с dt в десять секунд провёз бы лифт мимо обоих ограничителей
         скорости разом. */
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { p, done } = advance(ride, variant, now - start, dt);
      draw(p);
      if (!finished && done) {
        finished = true;
        /* rAF останавливается здесь: на табло 23, рельса доведена, менять
           больше нечего — секунду стоянки незачем крутить кадрами. */
        draw(1);
        hold = window.setTimeout(open, HOLD_23_MS);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(hold); };
  }, [reduced]);

  if (!visible) return null;

  const rungs = [];
  for (let f = 23; f >= 1; f -= 1) {
    rungs.push(
      <div key={f} className={styles.tick} data-f={f}>
        <i className={styles.tickLine} />
        <span className={styles.tickNum}>{String(f).padStart(2, '0')}</span>
      </div>,
    );
  }

  /* ЛЕСТНИЦА ЛЕЖИТ ВНУТРИ ЛЕВОЙ СТВОРКИ, ЧИСЛО — ВНУТРИ ПРАВОЙ, и это
     не вольность вёрстки, а весь приём: створка обрезает своё
     содержимое (overflow: hidden), поэтому уходящий край СРЕЗАЕТ
     интерфейс, а не гасит его. Стоять на месте, пока его срезают,
     элементу даёт .keep — встречный сдвиг ровно на ход створки,
     разбор в .module.css.
     Координаты от этого не меняются: левая створка начинается на левой
     кромке экрана, правая кончается на правой, поэтому `left: --pad-x`
     у лестницы и `right: …` у числа значат ровно то же, что значили
     на общем слое во весь экран. */
  return (
    <div ref={rootRef} className={styles.root} aria-hidden="true">
      <div ref={doorLRef} className={`${styles.door} ${styles.doorL}`}>
        <div className={styles.keep}>
          <div ref={ladderRef} className={styles.ladder}>{rungs}</div>
        </div>
      </div>
      <div ref={doorRRef} className={`${styles.door} ${styles.doorR}`}>
        <div className={styles.keep}>
          <div className={styles.big}>
            <span ref={numRef} className={styles.num}>01</span>
            <span className={`label ${styles.numLabel}`}>Этаж</span>
          </div>
        </div>
      </div>
    </div>
  );
}
