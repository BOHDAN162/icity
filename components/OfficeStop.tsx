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
   5. Снять `"placeholder": true` из манифеста (его ставит рецепт).

   Чего в кадре не будет никогда: стороны света. В docs/facts.md они
   помечены как гипотеза, поэтому ни строкой, ни пикселем.
   -------------------------------------------------------------------------

   iCITY 113Н — экран 2 и 3: офис-остановка и вид из окна.
   Путь в проекте: components/OfficeStop.tsx

   ЧТО ЭТО. Одна высокая секция, внутри — липкая сцена на 100svh с двумя
   слоями. Слой A — офис (OfficeHub), слой B — кадр вида. Листаешь вниз
   из любой зоны офиса: кадр поднимается снизу, накрывает офис, держится,
   потом уходит в растровый шов и передаёт страницу Landing. Листаешь
   вверх — возвращаешься ровно в ту зону, из которой ушёл: OfficeHub
   не размонтируется, состояние зоны живёт в нём.

   ПОЧЕМУ НЕ position: fixed НА BODY. Прежний ActOne фиксировал body,
   пока офис открыт, и офис был тупиком: выйти можно было только кнопкой.
   Здесь офис — остановка внутри обычной прокрутки. Тот же приём, что
   в TowerSequence: высокая секция плюс нативный sticky, без пиннинга
   и без ScrollTrigger.

   ОДНО ЧИСЛО НА ВСЮ АНИМАЦИЮ. Слушатель скролла считает прогресс `p`
   от 0 до 1 и пишет его в одну CSS-переменную `--p` на узле сцены.
   React на кадрах не участвует вообще — ровно та же дисциплина, что
   в TowerSequence. Всё остальное (подъём кадра, масштаб офиса, подпись,
   высота шва) считается из `--p` в CSS через calc, см. OfficeStop.module.css.

   ГРУБОЕ СОСТОЯНИЕ `phase` существует ровно для одного — для `inert`
   на слое офиса, чтобы фокус клавиатуры не садился на невидимые стрелки.
   Оно меняется только на пересечении порогов, с гистерезисом, а не
   на каждом кадре.

   ЧТО ДВИЖЕТСЯ. Только transform, opacity и высота полосы шва. Ни filter,
   ни blur, ни backdrop-filter, ни маски на самом кадре: маска поверх
   полноэкранной картинки перерисовывает весь кадр на каждом тике и
   роняет частоту на средних телефонах. Маски есть только у полосы шва —
   она низкая и стоит на месте. */

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
} from 'react';
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
   считаются огибающие. Здесь нужны только два: на них переключается
   `inert`. Полная карта — в docs/office-flow.md. */
const PHASE_PHOTO = 0.12;
const PHASE_SEAM = 0.62;
/** мёртвая зона вокруг порога: без неё дрожание скролла дёргает setState */
const PHASE_HYST = 0.005;

type Phase = 'office' | 'photo' | 'seam';

const phaseFor = (p: number, cur: Phase): Phase => {
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

  const [phase, setPhase] = useState<Phase>('office');
  /* Кадр вида монтируем, когда секция ближе полутора экранов. В бюджет
     первого экрана он попасть не должен: там уже стоит секвенция башни. */
  const [photoNear, setPhotoNear] = useState(false);

  /* «К башне» больше ничего не закрывает — она прокручивает страницу
     к секвенции, и та отыгрывает подъём назад сама, кадр за кадром.
     Esc в OfficeHub делает ровно это же. */
  const toTower = useCallback(() => {
    document.getElementById('tower')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    let curPhase: Phase = 'office';

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? clamp01(-rect.top / travel) : 0;

      // единственная запись в DOM на кадр — и ни одного ре-рендера React
      stage.style.setProperty('--p', p.toFixed(4));

      const next = phaseFor(p, curPhase);
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

    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    io.observe(wrap);

    return () => {
      io.disconnect();
      stop();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const officeLive = phase === 'office';

  return (
    <section ref={wrapRef} className={styles.wrap} id="office">
      <div ref={stageRef} className={styles.stage}>
        {/* слой A — офис. Никакого transform на этом узле: внутри него
            лежит план в position: fixed, и трансформированный предок
            стал бы для него содержащим блоком. Масштаб офиса едет
            переменной --office-scale внутрь OfficeHub, на его .stage. */}
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

          {/* Вуаль под подписью — тот же приём и те же числа, что у
              .scrimInfoLeft в OfficeHub: градиент --paper от кромки кадра
              в прозрачность, маска режет его по горизонтали.
              design-system.md, раздел «Вуаль». */}
          <div className={styles.veil} aria-hidden="true" />

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
