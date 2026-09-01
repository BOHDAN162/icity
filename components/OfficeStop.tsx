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
   Здесь офис — остановка внутри обычной прокрутки: высокая секция плюс
   нативный sticky, без пиннинга и без ScrollTrigger. На страницу секция
   попадает через HeroGate: пока hero-видео живо, скролл заблокирован
   и офис накрыт inert, после финала ролика ресепшн — верх страницы.

   ОДНО ЧИСЛО НА ВСЮ АНИМАЦИЮ. Слушатель скролла считает прогресс `p`
   от 0 до 1 и пишет его в одну CSS-переменную `--p` на узле сцены.
   React на кадрах не участвует вообще — та же дисциплина «один rAF →
   одна огибающая», что у выезда в HeroVideo. Всё остальное (подъём кадра,
   масштаб офиса, подпись, высота шва) считается из `--p` в CSS через
   calc, см. OfficeStop.module.css.

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
  useEffect, useRef, useState, useSyncExternalStore,
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

/* docs/facts.md, строки 18–19. Тот же паттерн ряда чисел, что в
   Landing.tsx: dl > dt(подпись)/dd(значение), column-reverse. */
const VIEW_FIGURES = [
  { value: '23', caption: 'ЭТАЖ' },
  { value: '3,8', caption: 'ПОТОЛКИ, М' },
] as const;

/* Фазовая карта. Пороги дублируются в OfficeStop.module.css — там из них
   считаются огибающие. Здесь нужны только два: на них переключается
   `inert`. Полная карта — в docs/office-flow.md. */
const PHASE_PHOTO = 0.12;
const PHASE_SEAM = 0.62;
/** мёртвая зона вокруг порога: без неё дрожание скролла дёргает setState */
const PHASE_HYST = 0.005;

/* --- автодоводка от офиса к кадру вида ---------------------------------
   Зритель толкает страницу вниз из офиса — и дальше её доводит сцена,
   до той самой выдержки, ради которой всё и затевалось: кадр стоит
   во весь экран, подпись пришла, шва ещё нет.

   ТОЛЬКО ВНИЗ. Доводка есть ровно в одну сторону, офис → вид. Наверх
   зритель уходит сам: перехватывать возврат значит не пускать обратно.

   НЕ НА СТАРТ ПРОКРУТКИ, А НА ЕЁ КОНЕЦ. Между «пошло движение» и
   доводкой стоит SNAP_IDLE_MS тишины. Иначе доводка дерётся с инерцией
   трекпада и iOS: там программный scrollTo не отменяет уже запущенный
   импульс, а складывается с ним, и кадр дёргается. Ждём, пока инерция
   кончится сама, — и только тогда ведём.

   ЛЮБОЙ ЖЕСТ ОТМЕНЯЕТ. Колесо, палец, клавиша во время доводки
   возвращают управление зрителю немедленно и навсегда: второй попытки
   на этом проходе не будет. Заново доводка взводится, только если
   зритель поднялся обратно в офис (p < SNAP_ARM). */
const SNAP_TARGET = 0.58;
/** «листать начали»: примерно один щелчок колеса */
const SNAP_ARM = 0.015;
/** тишина, после которой считаем, что инерция кончилась */
const SNAP_IDLE_MS = 110;
/** мс на пиксель хода плюс потолок и пол: короткий добор не должен ползти */
const SNAP_MS_PER_PX = 0.85;
const SNAP_MS_MIN = 420;
const SNAP_MS_MAX = 1200;

/* Разгон и торможение симметричны: доводка — это не появление элемента,
   а движение камеры, и обрывать её резким приходом нельзя. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

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
  /* Кадр вида монтируем, когда секция ближе полутора экранов. */
  const [photoNear, setPhotoNear] = useState(false);

  /* --- монтирование кадра: за полтора экрана до секции ----------------
     С уходом скролл-секвенции секция офиса стоит сразу за hero (100svh),
     поэтому порог срабатывает уже при загрузке страницы — кадр вида
     едет фоном с fetchPriority="low", пока зритель смотрит постер. */
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

    /* --- состояние доводки ------------------------------------------- */
    let snapRaf = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let snapping = false;
    let spent = false;          // доводка на этом проходе уже отработала
    let from = 0;
    let to = 0;
    let dur = 0;
    let began = 0;
    let owned = 0;              // куда доводка поставила страницу сама
    let lastP = 0;
    let lastY = window.scrollY;
    let down = false;           // последнее движение было вниз

    const stopSnap = () => {
      if (snapRaf) { cancelAnimationFrame(snapRaf); snapRaf = 0; }
      snapping = false;
    };

    /* Жест зрителя отбирает управление насовсем — до следующего
       возвращения в офис. Ровно то же правило, что у карты локации:
       автоподбор рамки не спорит с рукой. */
    const giveUp = () => {
      if (!snapping) return;
      stopSnap();
      spent = true;
    };

    const snapFrame = (now: number) => {
      const t = Math.min(1, (now - began) / dur);
      owned = Math.round(from + (to - from) * easeInOut(t));
      window.scrollTo(0, owned);
      if (t < 1) {
        snapRaf = requestAnimationFrame(snapFrame);
      } else {
        snapRaf = 0;
        snapping = false;
        spent = true;
      }
    };

    const settle = () => {
      if (spent || snapping) return;
      if (!down) return;                                // доводка в одну сторону
      if (lastP < SNAP_ARM || lastP >= SNAP_TARGET) return;

      const rect = wrap.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return;

      from = window.scrollY;
      to = Math.round(rect.top + from + SNAP_TARGET * travel);
      const span = to - from;
      if (span <= 0) return;

      dur = Math.min(SNAP_MS_MAX, Math.max(SNAP_MS_MIN, span * SNAP_MS_PER_PX));
      began = performance.now();
      owned = from;
      snapping = true;
      snapRaf = requestAnimationFrame(snapFrame);
    };

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? clamp01(-rect.top / travel) : 0;

      // единственная запись в DOM на кадр — и ни одного ре-рендера React
      stage.style.setProperty('--p', p.toFixed(4));

      const y = window.scrollY;
      if (y !== lastY) down = y > lastY;
      /* Страницу подвинули не мы — значит, зритель. Сравниваем с тем,
         куда доводка поставила её сама: событие прокрутки от нашего же
         scrollTo приходит ровно на `owned`. */
      if (snapping && Math.abs(y - owned) > 12) giveUp();
      lastY = y;
      lastP = p;

      // вернулись в офис — доводка снова взведена
      if (p < SNAP_ARM) spent = false;

      const next = phaseFor(p, curPhase);
      if (next !== curPhase) {
        curPhase = next;
        setPhase(next);
      }
    };

    const onScroll = () => {
      if (!snapping) {
        if (idle) clearTimeout(idle);
        idle = setTimeout(settle, SNAP_IDLE_MS);
      }
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };

    const start = () => {
      if (listening) return;
      listening = true;
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      window.addEventListener('wheel', giveUp, { passive: true });
      window.addEventListener('touchstart', giveUp, { passive: true });
      window.addEventListener('keydown', giveUp);
      measure();
    };

    const stop = () => {
      if (!listening) return;
      listening = false;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('wheel', giveUp);
      window.removeEventListener('touchstart', giveUp);
      window.removeEventListener('keydown', giveUp);
      if (idle) clearTimeout(idle);
      stopSnap();
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
          <OfficeHub active={officeLive} />
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
            <h2 className={styles.title}>Панорама</h2>

            <dl className={styles.figures}>
              {VIEW_FIGURES.map((f) => (
                <div key={f.caption} className={styles.figure}>
                  <dt className={`label ${styles.figCaption}`}>{f.caption}</dt>
                  <dd className={styles.figValue}>{f.value}</dd>
                </div>
              ))}
            </dl>
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
