'use client';

/* ЗАГЛУШКИ — ЗАМЕНИТЬ ------------------------------------------------------
   Кадр вида из окна собран из `~/Downloads/icity_view.png` — это скриншот
   стороннего панорамного просмотрщика VirtualLand, а не съёмка из
   помещения 113Н. Съёмка уже прошла, финальные кадры приедут позже.

   Что менять, когда они приедут:

   1. Положить исходники в источник конвейера и запустить
      `node scripts/view-images.mjs <файл|папка>`. Ширины, форматы и
      manifest.json скрипт соберёт сам — руками ничего не режем.
   2. Обнулить `crop` в рецепте `view` внутри scripts/view-images.mjs:
      сейчас он снимает интерфейс просмотрщика и, главное, буквы румбов
      «СЗ» и «С». У честной съёмки резать нечего.
   3. Сверить VIEW_WIDTHS и VIEW_NATIVE ниже с public/view/manifest.json —
      то же правило, что у RENDER_WIDTHS в lib/interior.ts.
   4. Перечитать VIEW_ALT: alt описывает кадр, а не предложение. Строка
      взята из copy.md, раздел «Alt-тексты», и написана под настоящую
      съёмку — под заглушку она честна только наполовину.
   5. Перемерить контраст подписи по реальным пикселям нового кадра.
      Вуаль подогнана под эту панораму, и на другой она может не держать
      4,5:1 — порядок замера в docs/office-flow.md.
   6. Снять `"placeholder": true` из манифеста (его ставит рецепт).

   Чего в кадре не будет никогда: стороны света. В docs/facts.md они
   помечены как гипотеза, поэтому ни строкой, ни пикселем.
   -------------------------------------------------------------------------

   iCITY 113Н — экран 2 и 3: офис-остановка и вид из окна.
   Путь в проекте: components/OfficeStop.tsx

   ЧТО ЭТО. Одна высокая секция, внутри — липкая сцена на 100svh с двумя
   слоями. Слой A — офис (OfficeHub), слой B — кадр вида.

   ДВА ЗАНАВЕСА, ОДНА МЕХАНИКА. Приходящий экран выезжает снизу и
   накрывает уходящий. Уходящий НЕ ДВИГАЕТСЯ: ни масштаба, ни прозрачности,
   ни параллакса, ни размытия. Стык — жёсткая горизонтальная линия, без
   градиента и без перекрёстного растворения.

     занавес 1  башня → офис   вся сцена едет вверх, --c: 0 → 1
     занавес 2  офис → вид     едет слой кадра,      --p: 0,06 → 0,34

   Занавес 1 живёт на хвосте секции башни: та стала выше на CURTAIN_SVH,
   кадры по хвосту уже не идут, а эта секция подтянута вверх отрицательным
   отступом ровно настолько, чтобы её сцена была пришпилена к верху экрана
   к началу занавеса. Арифметика отступа — в lib/sequence.ts.

   ДОВОДКА. Ни одно состояние покоя не показывает два экрана сразу: обе
   границы либо доводятся до конца, либо откатываются. Механика и её
   ловушки — в lib/snap.ts.

   ОДНО ЧИСЛО НА КАЖДОЕ ДВИЖЕНИЕ. Слушатель скролла пишет две CSS-переменные
   на узле сцены — `--c` и `--p` — и больше ничего. React на кадрах
   не участвует. Всё остальное считается из них в CSS через calc,
   см. OfficeStop.module.css и docs/office-flow.md.

   ГРУБОЕ СОСТОЯНИЕ `phase` существует ровно для одного — для `inert`
   на слое офиса, чтобы под движущейся кромкой ничего нельзя было нажать
   и поймать фокусом. Меняется только на пересечении порогов, с
   гистерезисом, а не на каждом кадре.

   ЧТО ДВИЖЕТСЯ. Только transform, opacity и высота полосы шва. Ни filter,
   ни blur, ни backdrop-filter, ни маски на самом кадре: маска поверх
   полноэкранной картинки перерисовывает весь кадр на каждом тике и
   роняет частоту на средних телефонах. Маски есть только у полосы шва —
   она низкая и стоит на месте. */

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import { CURTAIN_SVH } from '@/lib/sequence';
import { createSnap, type SnapRange } from '@/lib/snap';
import OfficeHub from './OfficeHub';
import styles from './OfficeStop.module.css';

/* Ширины и родное разрешение кадра. Источник — public/view/manifest.json;
   продублировано здесь по тому же правилу, что RENDER_WIDTHS в
   lib/interior.ts: srcset нужен в разметке, а не после запроса за JSON.
   Пересобираешь кадр — сверь с манифестом. */
const VIEW_WIDTHS = [640, 1280, 1920, 2560] as const;
const VIEW_NATIVE = [3460, 1910] as const;
const VIEW_DIR = '/view';

/** copy.md, «Alt-тексты». Описывает кадр, а не предложение. */
const VIEW_ALT = 'Вид из окна 23 этажа на Москва-Сити';

const viewSrcSet = (ext: 'avif' | 'webp') =>
  VIEW_WIDTHS.map((w) => `${VIEW_DIR}/view-${w}.${ext} ${w}w`).join(', ');

/* Фазовая карта. Пороги дублируются в OfficeStop.module.css — там из них
   считаются огибающие. Здесь нужны только те, на которых переключается
   `inert` и стоят границы доводки. Полная карта — в docs/office-flow.md. */
const RISE_FROM = 0.06;   // с этой доли кадр вида пошёл вверх
const RISE_TO = 0.34;     // здесь он полностью накрыл офис
const PHASE_PHOTO = 0.09; // с этой доли офис под кромкой: inert
const PHASE_SEAM = 0.52;

/** мёртвая зона вокруг порога: без неё дрожание скролла дёргает setState */
const PHASE_HYST = 0.005;

/** занавес считается доведённым: офис снова живой экран */
const CURTAIN_DONE = 0.999;
const CURTAIN_HYST = 0.009;

type Phase = 'curtain' | 'office' | 'photo' | 'seam';

const phaseFor = (c: number, p: number, cur: Phase): Phase => {
  const done = cur === 'curtain' ? CURTAIN_DONE : CURTAIN_DONE - CURTAIN_HYST;
  if (c < done) return 'curtain';
  const lo = cur === 'office' ? PHASE_PHOTO + PHASE_HYST : PHASE_PHOTO - PHASE_HYST;
  const hi = cur === 'seam' ? PHASE_SEAM - PHASE_HYST : PHASE_SEAM + PHASE_HYST;
  if (p < lo) return 'office';
  if (p < hi) return 'photo';
  return 'seam';
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getMotionSnapshot = () => window.matchMedia(MOTION_QUERY).matches;
const getMotionServerSnapshot = () => false;

export default function OfficeStop() {
  const wrapRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const reduced = useSyncExternalStore(
    subscribeMotion,
    getMotionSnapshot,
    getMotionServerSnapshot,
  );

  const [phase, setPhase] = useState<Phase>('curtain');
  /* Кадр вида монтируем, когда секция ближе полутора экранов. В бюджет
     первого экрана он попасть не должен: там уже стоит секвенция башни. */
  const [photoNear, setPhotoNear] = useState(false);

  /* «К башне» больше ничего не закрывает — она прокручивает страницу
     к секвенции, и та отыгрывает подъём назад сама, кадр за кадром.
     Esc в OfficeHub делает ровно это же. */
  const toTower = useCallback(() => {
    document.getElementById('tower')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /* --- геометрия. Один источник на привод и на доводку ----------------
     Занавес и фазы делят пришпиленный ход секции: сначала CURTAIN_SVH
     на наезд, потом всё остальное на фазовую карту. Считаем от высоты
     самой сцены — это ровно 100svh в пикселях, и на мобильных она честнее
     window.innerHeight, который гуляет вместе с адресной строкой. */
  const metrics = useCallback(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return null;
    const svh = stage.offsetHeight;
    if (svh <= 0) return null;
    const curtain = (svh * CURTAIN_SVH) / 100;
    const phaseTravel = wrap.offsetHeight - svh - curtain;
    return { rect: wrap.getBoundingClientRect(), curtain, phaseTravel };
  }, []);

  /* --- монтирование кадра: за полтора экрана до секции ---------------- */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setPhotoNear(true); },
      { rootMargin: '150% 0px' },
    );
    io.observe(wrap);
    return () => io.disconnect();
  }, []);

  /* --- привод: один слушатель скролла, дросселированный через rAF ----
     IntersectionObserver включает и выключает его: пока секции нет
     на экране, ни слушателя, ни кадров rAF. */
  useEffect(() => {
    if (reduced) return undefined;
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return undefined;

    let raf = 0;
    let listening = false;
    let curPhase: Phase = 'curtain';
    let lastC = -1;
    let lastP = -1;

    const measure = () => {
      const m = metrics();
      if (!m) return;
      const y = -m.rect.top;                       // 0 в начале занавеса
      const c = clamp01(y / m.curtain);
      const p = m.phaseTravel > 0 ? clamp01((y - m.curtain) / m.phaseTravel) : 0;

      /* Пишем, только если сдвинулось: лишний setProperty инвалидирует
         стиль всего поддерева на каждом кадре простоя. */
      if (Math.abs(c - lastC) > 1e-4) { lastC = c; stage.style.setProperty('--c', c.toFixed(4)); }
      if (Math.abs(p - lastP) > 1e-4) { lastP = p; stage.style.setProperty('--p', p.toFixed(4)); }

      const next = phaseFor(c, p, curPhase);
      if (next !== curPhase) {
        curPhase = next;
        setPhase(next);
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };

    const start = () => {
      if (listening) return;
      listening = true;
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      measure();
    };

    const stop = () => {
      if (!listening) return;
      listening = false;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };

    /* Наблюдаем с запасом в экран: занавес начинается ровно на верхней
       кромке обёртки, и без запаса первый его кадр считался бы уже
       после того, как он начался. */
    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { rootMargin: '100% 0px' },
    );
    io.observe(wrap);

    return () => {
      io.disconnect();
      stop();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, metrics]);

  /* --- доводка на двух границах ---------------------------------------
     Диапазоны в документных координатах, пересчитываются по требованию:
     высоты в svh, и после поворота телефона они другие. */
  useEffect(() => {
    if (reduced) return undefined;
    const ranges = (): SnapRange[] => {
      const m = metrics();
      if (!m) return [];
      const top = m.rect.top + window.scrollY;    // документный верх обёртки
      const phaseAt = (v: number) => top + m.curtain + v * m.phaseTravel;
      return [
        { id: 'b1', from: top, to: top + m.curtain },
        { id: 'b2', from: phaseAt(RISE_FROM), to: phaseAt(RISE_TO) },
      ];
    };
    const snap = createSnap(ranges);
    return () => snap.destroy();
  }, [reduced, metrics]);

  const officeLive = phase === 'office';

  return (
    <section ref={wrapRef} className={styles.wrap} id="office">
      <div ref={stageRef} className={styles.stage}>
        {/* слой A — офис. Никакого transform на этом узле: масштаба у офиса
            больше нет вообще, его накрывают, а не анимируют. */}
        <div
          className={`${styles.office} ${officeLive ? '' : styles.officeOff}`}
          inert={!officeLive}
        >
          <OfficeHub active={officeLive} onExit={toTower} />
        </div>

        {/* слой B — кадр вида */}
        <div className={styles.photo}>
          {photoNear && (
            <picture className={styles.shot}>
              <source type="image/avif" srcSet={viewSrcSet('avif')} sizes="100vw" />
              <source type="image/webp" srcSet={viewSrcSet('webp')} sizes="100vw" />
              <img
                src={`${VIEW_DIR}/view-${VIEW_WIDTHS[0]}.webp`}
                alt={VIEW_ALT}
                width={VIEW_NATIVE[0]}
                height={VIEW_NATIVE[1]}
                draggable={false}
                decoding="async"
                fetchPriority="low"
              />
            </picture>
          )}

          {/* Вуаль живёт псевдоэлементом самой подписи и обнимает её
              с запасом: размер у неё содержательный, а не заданный
              в процентах экрана. См. .caption::before в модуле. */}
          <div className={styles.caption}>
            <p className={`label ${styles.eyebrow}`}>23 ЭТАЖ</p>
            <h2 className={styles.title}>Окна открываются</h2>
            <p className={styles.para}>
              В высотных офисах окна обычно не открываются — башню
              проектируют герметичной. Здесь створка открывается,
              и в кабинет заходит воздух с высоты 23 этажа.
            </p>
            <p className={styles.fine}>Вид из окон помещения</p>
          </div>
        </div>

        {/* Шов. Полоса прижата к нижней кромке сцены, поверх кадра.
            Ровно два слоя: густой растр с маской до 30 % высоты и
            разрежённый с маской во всю высоту. Точки густо у кромки,
            кверху редеют. Когда липкость отпустит, снизу приедет Landing
            со стандартной полосой 48 px — она и заменяет собой шов. */}
        <div className={styles.band} aria-hidden="true" />
      </div>
    </section>
  );
}
