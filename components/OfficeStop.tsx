'use client';

/* ЗАГЛУШКИ — ЗАМЕНИТЬ ------------------------------------------------------
   Оба кадра вида собраны из скриншотов стороннего панорамного
   просмотрщика VirtualLand (`~/Downloads/icity_view/`), а не сняты
   из помещения 113Н. Съёмка уже прошла, финальные кадры приедут позже.

   Что менять, когда они приедут:

   1. Положить исходники в источник конвейера и запустить
      `node scripts/view-images.mjs <файл|папка>`. Ширины, форматы и
      manifest.json скрипт соберёт сам — руками ничего не режем.
      Манифест собирается за ОДИН прогон: оба кадра лежат в одной папке,
      запуск на одном файле снёс бы ключ второго.
   2. Обнулить `crop` в обоих рецептах внутри scripts/view-images.mjs:
      сейчас они снимают интерфейс просмотрщика и, главное, буквы румбов
      («СЗ»/«С» у первого, «ЮЗ»/«З»/«СЗ» у второго). У честной съёмки
      резать нечего.
   3. Сверить `widths` и `native` в VIEWS ниже с public/view/manifest.json —
      то же правило, что у RENDER_WIDTHS в lib/interior.ts.
   4. Перечитать `alt` у обоих: alt описывает кадр, а не предложение.
      Строки взяты из copy.md, раздел «Alt-тексты», и написаны под
      настоящую съёмку — под заглушку они честны только наполовину.
   5. Снять `"placeholder": true` из манифеста (его ставит рецепт).

   Чего в кадре не будет никогда: стороны света. В docs/facts.md они
   помечены как гипотеза, поэтому ни строкой, ни пикселем.
   -------------------------------------------------------------------------

   iCITY 113Н — экраны 2–4: офис-остановка и два вида из окна.
   Путь в проекте: components/OfficeStop.tsx

   ЧТО ЭТО. Секция на 100svh + 90svh, внутри — липкая сцена с тремя
   слоями. Слой A — офис (OfficeHub), слой B — первый кадр вида с
   подписью, слой C — второй кадр.

   ЭКРАНЫ ПЕРЕКЛЮЧАЮТСЯ ШАГАМИ, А НЕ ПРОКРУТКОЙ. Жест вниз из офиса
   (или кнопка «Дальше») запирает страницу и за STEP_MS поднимает
   первый кадр; ещё жест — второй; после второго замок снимается,
   и дальше всё как раньше: обычная прокрутка растит полосу шва
   и передаёт страницу Landing. Жест вверх — шаг назад, той же
   анимацией. Зона офиса при этом не трогается вовсе: OfficeHub
   не размонтируется, состояние зоны живёт в нём.

   ПОЧЕМУ ЭТО НЕ ТРЕТЬЯ ПОПЫТКА ПРИДЕРЖАТЬ ЗРИТЕЛЯ. Их было две, обе
   откачены (ниже и в docs/office-flow.md), и обе боролись С прокруткой:
   автодоводка отбирала её посреди жеста и складывалась с инерцией
   трекпада, растянутая высота заставляла наматывать пиксели впустую.
   Здесь прокрутки в момент перехода нет вовсе — страница заперта,
   как на первом экране у hero, и драться не с чем. Приём новый,
   и заказчик просил его сам (3 сентября 2026).

   ЗАМОК СТАВИТСЯ, ПОКА СЕКЦИЯ ПРИПАРКОВАНА ВВЕРХУ, а не «пока шаг
   меньше двух». Правило одно вместо двух, и из него же следует
   возврат: приехал верхом к верху вьюпорта — экран снова наш,
   и жесты снова идут в шаги.

   ПОЧЕМУ У ВТОРОГО КАДРА НЕТ ПОДПИСИ. Так просил заказчик 3 сентября
   2026: первый кадр уже назвал и панораму, и этаж, второй просто
   добавляет обзора. Поэтому в слое C нет ни заголовка, ни ряда чисел,
   ни вуали — вуаль здесь не украшение, а подложка под текст, и без
   текста ей нечего держать.

   ПОЧЕМУ НЕ position: fixed НА BODY. Прежний ActOne фиксировал body,
   пока офис открыт, и офис был тупиком: выйти можно было только кнопкой.
   Здесь офис — остановка внутри обычной прокрутки: высокая секция плюс
   нативный sticky, без пиннинга и без ScrollTrigger. На страницу секция
   попадает через HeroGate: пока hero-видео живо, скролл заблокирован
   и офис накрыт inert, после финала ролика ресепшн — верх страницы.

   ТРИ ЧИСЛА НА ВСЮ АНИМАЦИЮ, И У НИХ РАЗНЫЕ ЧАСЫ. `--a` и `--b` —
   выезды кадров, их гонит свой rAF по времени. `--p` — ход хвоста,
   его по-прежнему считает слушатель прокрутки. Все три пишутся прямо
   в узел сцены, ре-рендеров React на кадрах нет вообще — та же
   дисциплина, что у выезда в HeroVideo. Всё остальное (масштаб офиса,
   подпись, высота шва) считается из них в CSS через calc,
   см. OfficeStop.module.css.

   СОСТОЯНИЕ `step` существует для двух вещей: `inert` на слое офиса,
   чтобы фокус клавиатуры не садился на невидимые стрелки, и решение,
   куда вести следующий жест. Гистерезис ему не нужен — в отличие
   от прежних порогов по доле прокрутки, шагу дрожать нечем.

   ЗДЕСЬ ДВАЖДЫ ПРОБОВАЛИ ПРИДЕРЖАТЬ ЗРИТЕЛЯ И ДВАЖДЫ ОТКАТИЛИ.
   Сначала автодоводкой — программный scrollTo к точке выдержки; она
   отбирала прокрутку у зрителя и складывалась с инерцией трекпада
   и iOS вместо того, чтобы её сменить. Потом высотой секции: ход
   растянули с 220svh до 360, чтобы панораму нельзя было проскочить
   одним махом. Оба раза заказчик смотрел живьём и возвращал как было —
   экран читался не как выдержка, а как застрявшая страница. Ни то,
   ни другое не заводить заново, не спросив.

   ЧТО ДВИЖЕТСЯ. Только transform, opacity и высота полосы шва. Ни filter,
   ни blur, ни backdrop-filter, ни маски на самом кадре: маска поверх
   полноэкранной картинки перерисовывает весь кадр на каждом тике и
   роняет частоту на средних телефонах. Маски есть только у полосы шва —
   она низкая и стоит на месте. */

import type { CSSProperties } from 'react';
import {
  useEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import OfficeHub from './OfficeHub';
import { cursorMode } from '@/lib/cursorMode';
import { scatter } from '@/lib/scatter';
import { SCROLL_GESTURE_GAP_MS } from '@/lib/motion';
import { onNextStep, onOfficeStep0 } from '@/lib/officeZone';
import {
  lockScroll, unlockScroll, scrollLockOwner, onScrollLockChange, OFFICE_STEP_LOCK,
} from '@/lib/scrollLock';
import styles from './OfficeStop.module.css';

/* Ширины и родное разрешение кадров. Источник — public/view/manifest.json;
   продублировано здесь по тому же правилу, что RENDER_WIDTHS в
   lib/interior.ts: srcset нужен в разметке, а не после запроса за JSON.
   Пересобираешь кадры — сверь с манифестом.

   ШИРИНЫ И РОДНОЙ РАЗМЕР У ОБОИХ КАДРОВ ОДИНАКОВЫ, и так и должно быть:
   один просмотрщик, один размер окна, один crop. Разошлись — значит
   исходник пришёл уменьшенным. Первый заход второго кадра был собран
   из скрина 2000×1299 вместо 3600×2338, ступень 2560 отвалилась,
   и на ретине он читался заметно мягче первого.

   `alt` — copy.md, «Alt-тексты». Описывает кадр, а не предложение,
   и не называет сторону света: в docs/facts.md они помечены
   как гипотеза. */
const VIEW_DIR = '/view';

const VIEW_WIDTHS = [640, 1280, 1920, 2560] as const;
const VIEW_NATIVE = [3460, 1910] as const;

const VIEWS = {
  view: {
    widths: VIEW_WIDTHS,
    native: VIEW_NATIVE,
    alt: 'Вид из окна 23 этажа на Москва-Сити',
  },
  view2: {
    widths: VIEW_WIDTHS,
    native: VIEW_NATIVE,
    alt: 'Вид из окна 23 этажа: городская застройка, '
      + 'транспортная развязка и Москва-река',
  },
} as const;

type ViewKey = keyof typeof VIEWS;

const viewSrcSet = (key: ViewKey, ext: 'avif' | 'webp') =>
  VIEWS[key].widths.map((w) => `${VIEW_DIR}/${key}-${w}.${ext} ${w}w`).join(', ');

/* docs/facts.md, строка 18. Тот же паттерн ряда чисел, что в
   Landing.tsx: dl > dt(подпись)/dd(значение), column-reverse.

   ЧИСЛО ЗДЕСЬ ОДНО. «3,8 / ПОТОЛКИ, М» снято 1 сентября 2026: высота
   потолка — довод для сметы, а не для панорамы, и на кадре она спорила
   с этажом, ради которого этот вид и показывают. Метрика никуда
   не делась — стоит в ряду чисел на Landing и в подписях кукольного
   дома. Вернёшь вторую ячейку — разделитель и отбивки .figure
   поднимутся сами, менять CSS не нужно. */
const VIEW_FIGURES = [
  { value: '23', caption: 'ЭТАЖ' },
] as const;

/* Имя следующего экрана: им подписан и сам кадр вида, и индикатор
   «дальше» в офисе. Один источник на оба места — иначе они разъедутся
   при первой же правке заголовка. */
const NEXT_STOP = { title: 'Панорама' } as const;

/* ШАГИ. Экранов внутри секции три, и зритель ходит по ним шагами,
   а не прокруткой: 0 — офис, 1 — первый кадр вида, 2 — второй.
   Полная карта — docs/office-flow.md. */
type Step = 0 | 1 | 2;

/* СКОЛЬКО ЕДЕТ КАДР. Пара к токену --t-view-step в app/tokens.css:
   там длительность переходов, здесь — на сколько запирается страница
   и не принимаются жесты. Разъедутся — шаги начнут либо накладываться,
   либо ждать впустую.

   1400 мс — скорость створок прелоадера: заказчик посмотрел живьём
   1000 и 1500 и попросил взять у них именно её. КРИВАЯ при этом СВОЯ,
   --ease-view, а не створочная --ease-standard: у створок разъезд,
   у нас открытие панорамы, и резкая середина читалась как рывок. */
const STEP_MS = 1400;

/* Сколько накопить дельты, чтобы жест засчитался за просьбу о шаге.
   Порог, а не первое же событие: трекпад шлёт жест десятками мелких
   дельт по 2–8 px, и без накопителя шаг срабатывал бы от касания
   пальцами. У мыши один щелчок это сразу 100–120 px, ей порог
   не мешает. Накопитель обнуляется по паузе SCROLL_GESTURE_GAP_MS —
   она осталась в lib/motion.ts ровно ради этого места. */
const STEP_ARM_PX = 40;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/* Россыпь букв для подписи кадра. Тот же приём, что у заголовка
   первого экрана: каждая буква проявляется со своей задержкой из
   детерминированного хеша, вразнобой — порядок получается непохожим
   ни на слева-направо, ни на построчный.

   РАЗБИВКА ЧИСТО ВИЗУАЛЬНАЯ. Рядом лежит обычная фраза для
   скринридера, а россыпь скрыта aria-hidden: иначе VoiceOver прочёл бы
   подпись по буквам.

   `from` — номер, с которого начинается счёт: у подписи три россыпи
   («Панорама», число, «ЭТАЖ»), и разброс у них обязан быть сквозным.
   Начни каждую с нуля — все три получат одинаковую последовательность
   задержек, и вразнобой выродится в три одинаковые волны.

   Единственный проп на букве — безразмерный множитель --d; вся
   арифметика задержки живёт в CSS, как у hero. */
function Scattered({ text, from, char }: { text: string; from: number; char: string }) {
  let n = from;
  return (
    <>
      <span className={styles.sr}>{text}</span>
      <span aria-hidden="true">
        {[...text].map((ch, i) => (ch === ' ' ? (
          <span key={i}>&nbsp;</span>
        ) : (
          <span
            key={i}
            className={char}
            style={{ '--d': scatter(n++) } as CSSProperties}
          >
            {ch}
          </span>
        )))}
      </span>
    </>
  );
}

/* Кадр вида: <picture> с avif и webp, фолбэк на самую узкую webp.
   Общий для обоих слоёв — тем же приёмом, что стопка кадров зон
   в OfficeHub. width/height честные, из манифеста: без них
   на подъёме возвращается layout shift. */
function ViewShot({ view }: { view: ViewKey }) {
  const { widths, native, alt } = VIEWS[view];
  return (
    <picture className={styles.shot}>
      <source type="image/avif" srcSet={viewSrcSet(view, 'avif')} sizes="100vw" />
      <source type="image/webp" srcSet={viewSrcSet(view, 'webp')} sizes="100vw" />
      <img
        src={`${VIEW_DIR}/${view}-${widths[0]}.webp`}
        alt={alt}
        width={native[0]}
        height={native[1]}
        draggable={false}
        decoding="async"
        fetchPriority="low"
      />
    </picture>
  );
}

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
  const bandRef = useRef<HTMLDivElement>(null);
  const photo2Ref = useRef<HTMLDivElement>(null);

  const reduced = useSyncExternalStore(
    subscribeMotion,
    getMotionSnapshot,
    getMotionServerSnapshot,
  );

  const [step, setStep] = useState<Step>(0);
  /* Первый кадр вида монтируем, когда секция ближе полутора экранов. */
  const [photoNear, setPhotoNear] = useState(false);
  /* Первый шаг начался — значит второй кадр скоро понадобится. */
  const [armed2, setArmed2] = useState(false);

  /* ВТОРОЙ КАДР МОНТИРУЕТСЯ ПОЗЖЕ ПЕРВОГО, и это не микрооптимизация.
     Порог первого срабатывает уже при scrollY = 0 (секция офиса стоит
     сразу за hero), и второй кадр уехал бы в бюджет первого экрана
     лишними ~120 КБ.

     Прежде запасом служили 82svh прокрутки между монтированием и
     выездом; шагов прокрутки нет, и запасом стало время, пока зритель
     смотрит первый кадр. Раньше тянуть нечем: до первого шага второй
     кадр не нужен вовсе.

     Условие на `reduced` обязательно. Под prefers-reduced-motion шаги
     не заводятся вовсе, `armed2` навсегда остаётся false — второй кадр
     не смонтировался бы никогда, и та часть зрителей, что просит убрать
     движение, не увидела бы его совсем. */
  const photo2Near = photoNear && (reduced || armed2);

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

  /* --- привод: шаги по времени, хвост по прокрутке -------------------
     Внутри секции живут два разных механизма, и делить их обязательно.

     ШАГИ. Переходы офис → кадр 1 → кадр 2 прокрутка не ведёт: она
     на это время заперта, а кадр едет по времени, за STEP_MS. Жест
     только выбирает направление. Так это устроено ровно потому, что
     дважды пробовали иначе (docs/office-flow.md, «Придержать зрителя
     пробовали дважды»): автодоводка отбирала прокрутку посреди жеста
     и складывалась с инерцией трекпада, растянутая высота заставляла
     наматывать пиксели впустую. Драться с прокруткой больше не за что —
     её в этот момент нет.

     ХВОСТ. После второго кадра замок снимается, и дальше всё как было:
     слушатель считает `--p` и им растёт полоса шва.

     ЗАМОК СТАВИТСЯ, ПОКА СЕКЦИЯ ПРИПАРКОВАНА ВВЕРХУ, а не «пока шаг
     меньше двух». Одно правило вместо двух: приехал верхом к верху
     вьюпорта — страница заперта и жесты идут в шаги; жест вниз на
     последнем шаге отпирает и отдаёт прокрутку дальше. Возврат снизу
     запирает обратно тем же условием, и шаги ходят назад. */
  useEffect(() => {
    if (reduced) return undefined;
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    const band = bandRef.current;
    const photo2 = photo2Ref.current;
    if (!wrap || !stage || !band || !photo2) return undefined;

    let raf = 0;
    let stepTimer = 0;
    let listening = false;
    let busy = false;
    let cur: Step = 0;
    let parked = false;
    /* Управление отдано зрителю: он прошёл оба кадра и попросил вниз.
       Без этого флага замок возвращался бы в тот же миг — unlockScroll
       уведомляет подписчиков, а подписка ниже как раз и запирает
       припаркованную секцию. Сбрасывается, когда страница реально
       уехала: вернулся к верху — снова наш экран. */
    let handedOff = false;
    let acc = 0;
    let lastGestureAt = -Infinity;

    /* ШАГ — ЭТО СМЕНА ОДНОГО АТРИБУТА, а не покадровая анимация.
       Всё движение едет переходами в CSS, то есть на композиторе:
       главный поток в кадрах не участвует. Прежде здесь стоял rAF,
       переписывавший переменную на сцене, и каждый его кадр обходился
       в полный пересчёт стиля всего поддерева — 1,3 мс, замер в шапке
       OfficeStop.module.css. На 120 Гц это читалось как дёрганье.

       Занятость держим таймером на ту же длительность, что у переходов:
       пока кадр едет, жесты не принимаются. STEP_MS обязан совпадать
       с --t-view-step, иначе шаги начнут накладываться или, наоборот,
       ждать впустую. */
    const applyStep = (to: Step) => {
      stage.dataset.step = String(to);
    };

    const runStep = (to: Step) => {
      if (busy || to === cur) return;
      const from = cur;

      busy = true;
      cur = to;
      setStep(to);
      applyStep(to);
      /* Слои готовятся на время шага и распускаются после него —
         разбор в OfficeStop.module.css, у правил .stepping. */
      stage.dataset.stepping = '1';

      /* ВТОРОЙ КАДР МОНТИРУЕТСЯ НЕ В НУЛЕВОЙ КАДР АНИМАЦИИ. Раньше
         setArmed2 стоял здесь же, в один коммит с началом шага, и
         полноэкранная <picture> вместе с новым композиторным слоем
         .photo2 приходилась ровно на тот кадр, где стартуют все
         переходы: декодирование и растеризация съедали один-три кадра,
         и на 120 Гц это читалось как рывок. Пары кадров задержки
         достаточно, чтобы уйти со старта; до выезда второго кадра
         всё равно остаётся вся длительность шага. */
      if (to === 1 && from === 0) {
        requestAnimationFrame(() => requestAnimationFrame(() => setArmed2(true)));
      }

      window.clearTimeout(stepTimer);
      stepTimer = window.setTimeout(() => {
        busy = false;
        delete stage.dataset.stepping;
        /* Разметка под неподвижным курсором сменилась целиком: кнопка
           «Дальше» уехала вместе с интерфейсом офиса. Ни pointermove,
           ни scroll при этом не было, а цель кольца пересматривается
           только по ним — иначе оно осталось бы схлопнутым над пустым
           местом. Та же щель, что у чертежа. */
        cursorMode.wake?.();
      }, STEP_MS);
    };

    const lockHere = () => {
      if (scrollLockOwner() === null) lockScroll(OFFICE_STEP_LOCK);
    };
    const releaseHere = () => {
      if (scrollLockOwner() === OFFICE_STEP_LOCK) unlockScroll(OFFICE_STEP_LOCK);
    };

    /* ГЕОМЕТРИЯ СЕКЦИИ КЭШИРУЕТСЯ, а не читается каждый кадр.
       getBoundingClientRect в обработчике прокрутки — принудительная
       раскладка: замер показал 13–22 раскладки за полсекунды, пока
       секция пересекает экран, и ровно ноль, как только она ушла.
       Позиция секции от прокрутки не зависит — она меняется только
       на resize и при смене высоты выше по странице, поэтому снимаем
       её там же, где и слушателя заводим. */
    let wrapTop = 0;
    let travel = 0;
    const remeasure = () => {
      const rect = wrap.getBoundingClientRect();
      wrapTop = rect.top + window.scrollY;
      /* Ход считается от ВЫСОТЫ ЛИПКОЙ СЦЕНЫ, а не от высоты окна.
         Прежде они совпадали: и секция, и сцена мерились в svh. Теперь
         сцена занимает всю коробку экрана (--screen-h), а на телефоне
         это на высоту панели браузера больше окна — замер на iPhone 17
         Pro: 874 против 714. Считай мы по окну, огибающая дошла бы до
         единицы позже, чем сцена отлипает, и последняя четверть
         хореографии — выдержка и шов — отыгрывала бы уже на уезжающей
         вверх сцене. По высоте сцены ход и её липкий путь равны
         тождественно, на любом устройстве. */
      travel = rect.height - stage.getBoundingClientRect().height;
    };

    const measure = () => {
      /* Ни одного чтения раскладки: scrollY компоситор отдаёт даром. */
      const p = travel > 0 ? clamp01((window.scrollY - wrapTop) / travel) : 0;

      /* ПИШЕМ НА ПОЛОСУ ШВА, А НЕ НА СЦЕНУ, и это не мелочь.
         Пользовательская переменная НАСЛЕДУЕТСЯ: запись на узел сцены
         инвалидировала стиль всего поддерева — пяти кадров зон, холста
         параллакса, трёх вуалей, сетки интерфейса, подписи со всеми
         её побуквенными span-ами. Замер прямой подменой узла: пересчёт
         стиля 39,3 мс против 8,0, общая работа 67,5 против 21,4 — при
         одинаковом числе пересчётов. Разная площадь каждого.

         Читает эту переменную ровно один потребитель — сама полоса.
         Ей и пишем. */
      const v = p.toFixed(4);
      band.style.setProperty('--p', v);
      /* Второй кадр отъезжает на шве той же долей — пишем и ему,
         на его собственный узел. Внутри .photo2 только <picture>,
         так что инвалидация стоит два узла, а не поддерево. */
      photo2.style.setProperty('--p', v);

      /* Порог в один пиксель, а не ноль: позиция дробная, и точное
         сравнение с нулём мигало бы на границе. */
      const nowParked = window.scrollY <= wrapTop + 1;
      if (nowParked !== parked) {
        parked = nowParked;
        acc = 0;
      }
      if (parked) {
        if (!handedOff) lockHere();
      } else {
        releaseHere();
        handedOff = false;
      }
    };

    /* Один жест — один шаг. Пока кадр едет, жесты не копятся вовсе:
       иначе быстрый прокрут насквозь проскакивал бы оба экрана. */
    const arm = (dy: number, at: number) => {
      if (busy || !parked) return;
      if (scrollLockOwner() !== OFFICE_STEP_LOCK) return;
      if (at - lastGestureAt > SCROLL_GESTURE_GAP_MS) acc = 0;
      lastGestureAt = at;
      acc += dy;
      if (Math.abs(acc) < STEP_ARM_PX) return;
      const down = acc > 0;
      acc = 0;
      if (down) {
        if (cur < 2) runStep((cur + 1) as Step);
        /* Последний кадр пройден — отдаём прокрутку. Замок снимается
           в фазе CAPTURE, то есть до того, как это же событие дойдёт
           до ScrollTrip: он увидит страницу уже отпертой и повезёт
           её сам, без потерянного жеста. */
        else {
          handedOff = true;
          releaseHere();
        }
      } else if (cur > 0) {
        runStep((cur - 1) as Step);
      }
    };

    const onWheel = (e: WheelEvent) => arm(e.deltaY, e.timeStamp);

    /* Тач в проекте не слушают нигде, и правило это не нарушает:
       оно про то, чтобы не подменять системную инерцию своей. Под
       замком инерции нет вовсе — мы только читаем направление пальца. */
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? touchY;
      const dy = touchY - y;
      touchY = y;
      arm(dy, e.timeStamp);
    };

    const onScroll = () => {
      if (raf) return;
      /* ГЕОМЕТРИЯ СНИМАЕТСЯ РАЗ НА ЖЕСТ. Цикл спал — значит прокрутка
         начинается заново, и позиция секции могла измениться, пока мы
         не смотрели: снялся hero, домонтировался кадр, поменялась
         высота выше по странице. Читаем rect здесь, один раз, и дальше
         весь жест считаем из кэша.

         Снимать раз и навсегда нельзя — так и было, и значения
         протухали, если первый замер пришёлся на несложившуюся
         раскладку. Читать каждый кадр тоже нельзя: это принудительная
         раскладка, 13–22 штуки за полсекунды по замеру. */
      remeasure();
      raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };

    /* Ресайз — единственное, что двигает секцию само по себе.
       Здесь читать раскладку можно: это не кадр прокрутки. */
    const onResize = () => {
      remeasure();
      onScroll();
    };

    const start = () => {
      if (listening) return;
      listening = true;
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize, { passive: true });
      /* CAPTURE остался с тех пор, когда колесо слушал ещё и модуль
         плавной прокрутки, и наш разбор жеста обязан был идти первым.
         Модуля больше нет, но фаза безвредна и менять её незачем:
         слушатель пассивный и ничего не отменяет. */
      window.addEventListener('wheel', onWheel, { passive: true, capture: true });
      window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
      window.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
      remeasure();
      measure();
    };

    const stop = () => {
      if (!listening) return;
      listening = false;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      releaseHere();
    };

    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    io.observe(wrap);

    /* Замок ставится, как только его отпустит hero. Своего события
       у этого момента нет: свап страницу не двигает, ни scroll,
       ни resize не придут, а секция офиса к тому времени уже
       на экране — и без подписки она осталась бы незапертой
       до первого жеста. */
    const offLock = onScrollLockChange(() => {
      if (parked && !handedOff) lockHere();
    });

    /* «Верни офис»: зритель выбрал зону в плане или пришёл из подвала.
       Кадры уходят мгновенно — переезд случается в глухую часть
       перехода, пока экран закрыт оверлеем, и анимировать там нечего. */
    const offStep0 = onOfficeStep0(() => {
      window.clearTimeout(stepTimer);
      busy = false;
      delete stage.dataset.stepping;
      cur = 0;
      setStep(0);
      applyStep(0);
    });

    /* Кнопка «Дальше» в офисе просит ровно тот же шаг, что и жест. */
    const offCue = onNextStep(() => {
      if (parked) runStep(Math.min(cur + 1, 2) as Step);
    });

    return () => {
      io.disconnect();
      stop();
      offLock();
      offStep0();
      offCue();
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(stepTimer);
    };
  }, [reduced]);

  const officeLive = step === 0;

  return (
    <section ref={wrapRef} className={styles.wrap} id="office">
      <div ref={stageRef} className={styles.stage} data-step={step}>
        {/* слой A — офис. Никакого transform на этом узле: внутри него
            лежит план в position: fixed, и трансформированный предок
            стал бы для него содержащим блоком. Масштаб офиса едет
            переменной --office-scale внутрь OfficeHub, на его .stage. */}
        <div
          className={`${styles.office} ${officeLive ? '' : styles.officeOff}`}
          inert={!officeLive}
        >
          <OfficeHub active={officeLive} next={NEXT_STOP} />
        </div>

        {/* слой B — кадр вида. id нужен индикатору «дальше»: под
            prefers-reduced-motion сцена не липкая, доли хода нет,
            и целиться можно только в сам слой. */}
        <div className={styles.photo} id="view">
          {photoNear && <ViewShot view="view" />}

          {/* Вуаль под подписью — тот же приём и те же числа, что у
              .scrimInfoLeft в OfficeHub: градиент --paper от кромки кадра
              в прозрачность, маска режет его по горизонтали.
              design-system.md, раздел «Вуаль». */}
          <div className={styles.veil} aria-hidden="true" />

          <div className={styles.caption}>
            <h2 className={styles.title}>
              <Scattered text={NEXT_STOP.title} from={0} char={styles.titleChar} />
            </h2>

            <dl className={styles.figures}>
              {VIEW_FIGURES.map((f) => (
                <div key={f.caption} className={styles.figure}>
                  <dt className={`label ${styles.figCaption}`}>
                    <Scattered
                      text={f.caption}
                      from={NEXT_STOP.title.length + f.value.length}
                      char={styles.figChar}
                    />
                  </dt>
                  <dd className={styles.figValue}>
                    <Scattered
                      text={f.value}
                      from={NEXT_STOP.title.length}
                      char={styles.figChar}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* слой C — второй кадр вида. Ни вуали, ни подписи: заказчик
            просил его чистой фотографией, первый уже назвал и панораму,
            и этаж. Выезжает тем же движением и с тем же размахом, что
            первый, — только своей огибающей --rise2. */}
        <div ref={photo2Ref} className={styles.photo2}>
          {photo2Near && <ViewShot view="view2" />}
        </div>

        {/* Шов. Полоса прижата к нижней кромке сцены, поверх кадра.
            Ровно два слоя: густой растр с маской до 30 % высоты и
            разрежённый с маской во всю высоту. Точки густо у кромки,
            кверху редеют. Когда липкость отпустит, снизу приедет Landing
            со стандартной полосой 48 px — она и заменяет собой шов. */}
        <div ref={bandRef} className={styles.band} aria-hidden="true" />
      </div>
    </section>
  );
}
