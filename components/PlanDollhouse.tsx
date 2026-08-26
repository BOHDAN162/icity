'use client';

/* iCITY 113Н — планировка: кукольный дом поверх офиса.
   Путь в проекте: components/PlanDollhouse.tsx

   ЧТО ЭТО. Оболочка. Она решает, каким способом показать этаж, держит
   информационный слой и ведёт передачу управления обратно офису.
   Сам этаж рисует либо PlanScene (three.js), либо PlanFlat (SVG).

   ДВА СОСТОЯНИЯ И ОДИН ШОВ. Состояние A — план. Состояние B — рендер
   зоны, и это уже не наша забота: рендеры показывает OfficeHub, он это
   и так умеет. Наводим шов так, чтобы его не было видно:

     0 мс     клик по зоне, камера пошла к точке съёмки
     800 мс   офису сказано переключиться на эту зону — он кросс-фейдит
              под нами, за 620 мс, и этого никто не видит
     800 мс   поверх холста начинает проявляться тот же кадр, 400 мс
     1200 мс  оверлей закрывается. Под ним уже ровно та картинка,
              которая только что проявилась сверху. Мигания нет.

   Порядок важен: если закрыть оверлей раньше, чем офис доехал, зритель
   поймает кадр предыдущей зоны. Числа лежат в lib/interior.ts, чтобы
   сцена и оболочка считали по одним и тем же.

   ТРИ ПРИЧИНЫ НЕ ГРУЗИТЬ 3D: медленная сеть, отсутствие WebGL, просьба
   убрать движение. Во всех трёх — плоский план, и информационный слой
   там ровно тот же. Это требование, а не запасной вариант поскромнее.

   ЧЕГО ЗДЕСЬ НЕТ. Метража отдельных зон. Полигоны из zones_cameras.json —
   это области попадания курсора: их сумма 200,9 м² против 244,1 м²
   по документам. Подписать зону площадью значит выдумать число, а этого
   docs/facts.md прямо не разрешает. Подписано имя, метраж — общий. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  CROSSFADE_MS, RENDER_NATIVE, hasWebGL, isSlowNetwork, loadPlan,
  prefetchRender, renderSrcSet, renderSmallest,
  type Plan, type RenderKey, type ZoneKey,
} from '@/lib/interior';
import {
  PLAN_DRAG_SLOP, orbitFollow, orbitRelease, planOrbit, resetPlanOrbit,
} from '@/lib/motion';
import PlanOverlay from './PlanOverlay';
import styles from './PlanDollhouse.module.css';

/* three.js едет отдельным чанком и только сюда. На первый экран сайта
   он не влияет: до этого файла добираются кликом внутри офиса. */
const PlanScene = dynamic(() => import('./PlanScene'), {
  ssr: false,
  loading: () => <p className={`label ${styles.loading}`}>Собираем план…</p>,
});

const PlanFlat = dynamic(() => import('./PlanFlat'), { ssr: false });

/* Записан кодом, а не символом: невидимый U+00A0 теряется при
   переносе файла между редакторами, и «244,1 м²» ломается по строке. */
const NBSP = '\u00A0';

/* Числа — из docs/facts.md, других источников у сайта нет.
   Метраж скошенного угла сюда не попал сознательно: в facts.md его нет,
   а по геометрии выходит 8,82 м по плите и 9,56 м по линии остекления —
   то есть подтверждённого числа не существует. Пишем без числа. */
const FACTS: readonly { value: string; caption: string }[] = [
  { value: `244,1${NBSP}м²`, caption: 'Площадь' },
  { value: '26', caption: 'Рабочих мест' },
  { value: `3,8${NBSP}м`, caption: 'Потолки' },
  { value: '23', caption: 'Этаж из 61' },
];

const FACADE_NOTE = 'Панорамный фасад по трём сторонам, скошенный угол в зоне отдыха.';

type Props = {
  onClose: () => void;
  /** офис переключается на эту зону, пока оверлей ещё закрывает экран */
  onEnterZone: (key: RenderKey) => void;
};

/* Пропа `open` нет: смонтирован — значит открыт. Так чанк с three.js
   уезжает из первого экрана сам собой, а закрытие гарантированно
   отпускает WebGL-контекст, а не оставляет его висеть невидимым. */
export default function PlanDollhouse({ onClose, onEnterZone }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<ZoneKey | null>(null);
  const [flyTo, setFlyTo] = useState<RenderKey | null>(null);
  /* Две ступени одного кадра. `arriving` вешает <picture> в DOM в момент
     клика — с этой секунды браузер качает картинку, и у неё есть все
     800 мс перелёта. `revealed` включает проявление. Если делать это
     одним состоянием, загрузка стартует на 800-й миллисекунде и зритель
     ловит пустоту там, где должен быть кадр. */
  const [arriving, setArriving] = useState<RenderKey | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [chip, setChip] = useState<{ x: number; y: number } | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);

  /* Доворот плана ведём здесь, а не в сцене. Причина одна: палец должен
     двигать план откуда угодно в секции, включая пустой фон вокруг него,
     а холст занимает не всю секцию. Слушатели висят на поле плана,
     сцена только читает состояние.

     Захвата указателя нет намеренно. setPointerCapture увёл бы события
     у холста, и клик по зоне перестал бы доходить до три. Тап остаётся
     тапом: сцена сама смотрит, сколько жест проехал. */
  const viewRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);

  const closeRef = useRef<HTMLButtonElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /* Куда летим — держим ещё и в ref: фазы приходят из кадра сцены,
     а вызывать побочный эффект из апдейтера состояния нельзя. */
  const flyRef = useRef<RenderKey | null>(null);

  /* Способ показа решается один раз, при монтировании. Ленивый
     инициализатор, а не эффект: пересчитывать его на каждый рендер значит
     поймать смену WebGL-контекста в середине перелёта. SSR тут не мешает —
     компонент приезжает через dynamic({ ssr: false }). */
  const [{ mode, calm }] = useState(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
    return {
      // Медленная сеть, нет WebGL или просьба убрать движение — плоский план.
      mode: !reduced && !isSlowNetwork() && hasWebGL() ? ('solid' as const) : ('flat' as const),
      calm: coarse || reduced,
    };
  });

  useEffect(() => {
    let alive = true;
    loadPlan().then(
      (p) => { if (alive) setPlan(p); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, []);

  // таймеры шва живут не дольше оверлея
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; }, []);

  useEffect(() => { closeRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sheetOpen) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    // capture: пока план открыт, Esc принадлежит ему и до офиса не доходит
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, sheetOpen]);

  const crossfade = useCallback((key: RenderKey) => {
    setRevealed(true);
    onEnterZone(key);
  }, [onEnterZone]);

  const finish = useCallback(() => {
    flyRef.current = null;
    setFlyTo(null);
    setArriving(null);
    setRevealed(false);
    setHovered(null);
    onClose();
  }, [onClose]);

  const onPhase = useCallback((phase: 'crossfade' | 'done') => {
    if (phase === 'crossfade') {
      const key = flyRef.current;
      if (key) crossfade(key);
      return;
    }
    finish();
  }, [crossfade, finish]);

  /* Плоский план не летит: там шов держат таймеры, а не камера. */
  const pick = useCallback((key: RenderKey) => {
    if (flyRef.current) return;
    flyRef.current = key;
    setFlyTo(key);
    setArriving(key);           // качать начинаем сейчас, а не при проявлении
    if (mode === 'solid') return;
    crossfade(key);
    timersRef.current.push(setTimeout(finish, CROSSFADE_MS));
  }, [mode, crossfade, finish]);

  /* Слежение за указателем и перетаскивание. Оба живут на поле плана
     целиком; на плоском SVG не нужны — там доворачивать нечего. */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || mode !== 'solid') return;
    // Каждое открытие плана начинается с домашней позы, а не с той,
    // в которой его закрыли в прошлый раз.
    resetPlanOrbit();
    const o = planOrbit;

    /* Жест заводим только для пальца и пера. У мыши доворотом и так
       управляет положение курсора: заведи ей ещё и перетаскивание —
       и на отпускании кнопки цель прыгнет со «смещения» на «позицию». */
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      gesture.current = { x: e.clientX, y: e.clientY };
      o.dragging = true;
      o.moved = 0;
    };

    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (g) {
        /* Свайп через половину секции доворачивает ровно на столько же,
           на сколько курсор, уведённый в край: палец и мышь пишут в одну
           цель через одну огибающую. */
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        o.moved += Math.abs(dx) + Math.abs(dy);
        if (o.moved > PLAN_DRAG_SLOP) {
          const r = view.getBoundingClientRect();
          orbitFollow(o, (dx * 2) / r.width, (dy * 2) / r.height);
        }
        o.wake?.();
        return;
      }
      /* Слежение по положению — только для мыши. У пальца pointermove
         приходит лишь во время касания, и план дёргался бы к точке тапа
         вместо того, чтобы плавно идти за движением. */
      if (e.pointerType !== 'mouse') return;
      const r = view.getBoundingClientRect();
      orbitFollow(
        o,
        ((e.clientX - r.left) / r.width) * 2 - 1,
        ((e.clientY - r.top) / r.height) * 2 - 1,
      );
      o.wake?.();
    };

    const up = () => {
      o.dragging = false;
      /* Палец подняли — возвращаемся к покою, как и курсор, ушедший
         из секции. Иначе план застыл бы в случайном довороте. */
      if (gesture.current) orbitRelease(o);
      /* Пройденное обнуляем следующим кадром: клик по зоне прилетает
         сразу за pointerup и должен успеть увидеть, что это было
         перетаскивание, а не тап. */
      requestAnimationFrame(() => {
        gesture.current = null;
        o.moved = 0;
      });
    };

    const leave = () => { orbitRelease(o); o.wake?.(); };

    view.addEventListener('pointerdown', down, { passive: true });
    view.addEventListener('pointermove', move, { passive: true });
    view.addEventListener('pointerup', up, { passive: true });
    view.addEventListener('pointercancel', up, { passive: true });
    view.addEventListener('pointerleave', leave, { passive: true });

    return () => {
      view.removeEventListener('pointerdown', down);
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', up);
      view.removeEventListener('pointercancel', up);
      view.removeEventListener('pointerleave', leave);
    };
  }, [mode]);

  const hoveredZone = useMemo(
    () => plan?.zones.find((z) => z.key === hovered) ?? null,
    [plan, hovered],
  );

  /* Задержался на зоне — её кадр поехал, и к клику он уже в кэше.
     Именно задержался: кадр весит до 80 КБ, и качать его на каждое
     пересечение курсором значит скачать все пять, пока зритель просто
     ведёт мышь через план. Четверть секунды отделяет намерение
     от транзита. */
  useEffect(() => {
    const key = hoveredZone?.target;
    if (!key) return;
    const t = setTimeout(() => prefetchRender(key), 240);
    return () => clearTimeout(t);
  }, [hoveredZone]);

  const doors = useMemo(
    () => plan?.zones.filter((z) => z.target !== null) ?? [],
    [plan],
  );

  return (
    <div
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="Планировка помещения 113Н"
      onMouseMove={(e) => setChip({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setChip(null)}
    >
      <div className={styles.bar}>
        <p className={`label ${styles.title}`}>Планировка{NBSP}· 244,1{NBSP}м²</p>
        <div className={styles.tools}>
          {/* Растровый чертёж никуда не делся: объёмный план отвечает
              на «как тут ходят», чертёж — на «покажите размеры». */}
          <button type="button" className={styles.sheetLink} onClick={() => setSheetOpen(true)}>
            Чертёж
          </button>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>

      {/* Курсора «схватить» здесь больше нет: мышью план не таскают,
          он и так идёт за ней. Палец тащит откуда угодно, но ему курсор
          не нужен. */}
      <div ref={viewRef} className={styles.view}>
        {failed && (
          <p className={`label ${styles.loading}`}>План не загрузился. Обновите страницу.</p>
        )}

        {!failed && !plan && (
          <p className={`label ${styles.loading}`}>Собираем план…</p>
        )}

        {plan && mode === 'solid' && (
          <PlanScene
            plan={plan}
            hovered={hovered}
            onHover={setHovered}
            onPick={pick}
            flyTo={flyTo}
            onPhase={onPhase}
            wobble={!calm}
            compact={calm}
          />
        )}

        {plan && mode === 'flat' && (
          <PlanFlat plan={plan} hovered={hovered} onHover={setHovered} onPick={pick} />
        )}

        {/* Кадр зоны наезжает поверх плана и гасит его. К моменту, когда
            оверлей уйдёт, ровно этот кадр уже стоит в офисе под нами. */}
        {arriving && (
          <picture className={`${styles.arrival} ${revealed ? styles.arrivalOn : ''}`}>
            <source type="image/avif" srcSet={renderSrcSet(arriving, 'avif')} sizes="100vw" />
            <source type="image/webp" srcSet={renderSrcSet(arriving, 'webp')} sizes="100vw" />
            <img
              src={renderSmallest(arriving)}
              alt=""
              aria-hidden="true"
              width={RENDER_NATIVE[arriving][0]}
              height={RENDER_NATIVE[arriving][1]}
              decoding="async"
            />
          </picture>
        )}

        {/* Подпись зоны идёт за курсором. Имя и приглашение войти —
            больше ничего: метража отдельных зон в документах нет. */}
        {hoveredZone && chip && !flyTo && (
          <p
            className={`${styles.chip} ${hoveredZone.target ? styles.chipLive : ''}`}
            style={{ transform: `translate3d(${chip.x}px, ${chip.y}px, 0)` }}
            aria-hidden="true"
          >
            <span className={styles.chipName}>{hoveredZone.label}</span>
            {hoveredZone.target && <span className={styles.chipHint}>Войти</span>}
          </p>
        )}

        {/* Информационный слой. Mono, как все числа на сайте. Он одинаков
            в объёмной и плоской версии — это условие, а не совпадение. */}
        <div className={styles.facts}>
          <dl className={styles.factRow}>
            {FACTS.map((f) => (
              <div key={f.caption} className={styles.fact}>
                <dt className={`label ${styles.factCaption}`}>{f.caption}</dt>
                <dd className={styles.factValue}>{f.value}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.facade}>{FACADE_NOTE}</p>
        </div>

        {/* Клавиатура. Список видим, когда в нём есть фокус: мышью зоны
            берут прямо с плана, а с клавиатуры полигон не поймать. */}
        <nav className={styles.doors} aria-label="Перейти в зону">
          {doors.map((z) => (
            <button
              key={z.key}
              type="button"
              className={styles.door}
              onFocus={() => setHovered(z.key)}
              onBlur={() => setHovered(null)}
              onClick={() => z.target && pick(z.target)}
            >
              {z.label}
            </button>
          ))}
        </nav>
      </div>

      <PlanOverlay open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
