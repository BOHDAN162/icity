'use client';

/* iCITY 113Н — офис. Остановка сразу после подъёма вдоль башни.
   Путь в проекте: components/OfficeHub.tsx

   ЧТО ЭТО. Камера вошла в фасад — и страница останавливается на офисе.
   Пять зон, между ними ходят как по этажу: связи двусторонние, из любой
   комнаты можно вернуться в любую соседнюю.

   ГДЕ ОН ЖИВЁТ. Слой A липкой сцены в OfficeStop, а не оверлей поверх
   страницы: body больше не фиксируется, вниз из офиса уходят обычной
   прокруткой. Компонент не размонтируется никогда, поэтому зона
   переживает уход вниз и возврат — за это отвечает OfficeStop.
   Зону не сбрасывает НИЧТО: закрытие плана возвращает ровно туда,
   откуда его открыли.

   ESC — ТУМБЛЕР ПЛАНИРОВКИ. Открывает её отсюда (window, bubble),
   закрывает собственный Esc внутри PlanDollhouse (window, capture).
   Открытие по Esc из зоны идёт обратным нырком: камера стартует
   ракурсом этой зоны и отъезжает в изометрию — зеркало погружения.

   ЧТО ПРИЕЗЖАЕТ СНАРУЖИ. Две CSS-переменные со сцены: --office-ui
   (прозрачность интерфейса и вуалей) и --office-scale (масштаб стопки
   кадров). Обе читаются с запасным значением 1, поэтому офис остаётся
   рабочим и без сцены.

   ОТКУДА БЕРУТСЯ УГЛЫ СТРЕЛОК. Не из порядка списка, а из плана.
   Ниже лежат центроиды зон, снятые с чертежа (сам чертёж живёт теперь
   вектором в `public/interior/geometry.json`, см. docs/plan-sheet.md),
   азимут считается на месте функцией `bearing`. Так угол
   физически не может разойтись с планом: поменяется чертёж — поменяются
   координаты, а не пятнадцать захардкоженных чисел.

   ГДЕ НАПРАВЛЕНИЕ ЧЕСТНО НЕ РАБОТАЕТ. Опенспейс тянется вдоль всей южной
   кромки, поэтому из него всё остальное лежит «на севере»: ресепшн и кухня
   расходятся всего на 1°, коридор и переговорная — на 10°. Из переговорной
   коридор и опенспейс расходятся на 9°. Стрелки там показывают правду,
   но правда эта неразличима — различает подпись, которая появляется
   по наведению и по фокусу, и aria-label, который стоит всегда.

   КОНТРАСТ. Рендеры светлые, поэтому под текстом лежит не плашка,
   а градиентная вуаль от кромки кадра в прозрачность. Она не украшение:
   её единственная задача — держать контраст. См. design-system.md,
   раздел «Вуаль». */

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import dynamic from 'next/dynamic';
import {
  RENDER_NATIVE, prefetchPlan, renderSmallest, renderSrcSet, type RenderKey,
} from '@/lib/interior';
import {
  onZoneRequest, scrollToId, scrollToOffice, takeOfficeReturn,
} from '@/lib/officeZone';
import styles from './OfficeHub.module.css';

/* Кукольный дом тянет за собой three.js. Импорт динамический и без SSR:
   до плана добираются кликом внутри офиса, и на первый экран сайта его
   вес не влияет вообще. */
const PlanDollhouse = dynamic(() => import('./PlanDollhouse'), { ssr: false });

/* Параллакс кадра зоны. Тоже отдельным чанком и тоже без SSR: холст
   с картой глубины нужен только внутри открытого офиса. Компонент сам
   решает, браться ли за дело — просьба убрать движение, медленная сеть
   и отсутствие WebGL2 отменяют его молча, и под ним остаётся обычный кадр. */
const ZoneParallax = dynamic(() => import('./ZoneParallax'), { ssr: false });

/* Ключ зоны один на весь проект: здесь, в public/interior/zones_cameras.json
   и в именах файлов рендеров. Поэтому переговорная — `meeting_lg`, как
   в выгрузке из модели, а не `meeting`: переименовать сорок файлов дороже,
   чем принять чужое имя. */
type ZoneId = RenderKey;

/* Узкий неразрывный пробел — разряды и число/единица, как в Location.tsx.
   PlanDollhouse.tsx использует обычный U+00A0 — это её локальная
   неточность, не эталон, здесь не повторяем. */
const NBSP = ' ';

type Zone = {
  id: ZoneId;
  label: string;
  alt: string;
  /** сторона, с которой встаёт текстовый блок */
  side: 'left' | 'right';
  lines: string[];
  zero?: { caption: string; unit: string };
};

/* Центроиды зон в координатах чертежа, север — вверх, ось Y растёт на юг.
   Ресепшн в северо-западном углу, кухня с длинным столом в центре-севере,
   переговорная восточнее кухни, опенспейс занимает всю южную кромку,
   коридор — полоса между севером и югом. */
const CENTROID: Record<ZoneId, readonly [number, number]> = {
  reception: [495, 195],
  kitchen: [670, 630],
  meeting_lg: [1280, 630],
  corridor: [1000, 850],
  openspace: [840, 1100],
};

/** Связи двусторонние: куда можно уйти, оттуда можно и вернуться. */
const EXITS: Record<ZoneId, readonly ZoneId[]> = {
  reception: ['corridor', 'openspace'],
  corridor: ['reception', 'kitchen', 'openspace', 'meeting_lg'],
  kitchen: ['openspace', 'corridor'],
  openspace: ['reception', 'corridor', 'kitchen', 'meeting_lg'],
  meeting_lg: ['corridor', 'openspace'],
};

/* Ручная поправка угла — дизайнерское решение поверх геометрии, не расчёт.
   На ресепшне и в коридоре несколько выходов физически расходятся на
   считаные градусы (см. комментарий выше про 1°/9°/10°) и на экране
   стрелки визуально сливаются в одну. Здесь — явно заданное направление
   для конкретной пары «откуда→куда», остальные пары считаются как раньше. */
const ANGLE_OVERRIDE: Partial<Record<string, number>> = {
  'reception>corridor': 315,
  'reception>openspace': 315,
  'corridor>reception': 180,
  'corridor>openspace': 0,
  'corridor>meeting_lg': 315,
  'openspace>reception': 45,
  'openspace>corridor': 45,
  'openspace>kitchen': 67.5,
  'openspace>meeting_lg': 90,
  'meeting_lg>openspace': 180,
};

/** Азимут от зоны к зоне: 0° — север, дальше по часовой. */
const bearing = (from: ZoneId, to: ZoneId) => {
  const override = ANGLE_OVERRIDE[`${from}>${to}`];
  if (override !== undefined) return override;
  const [ax, ay] = CENTROID[from];
  const [bx, by] = CENTROID[to];
  return (Math.atan2(bx - ax, ay - by) * 180) / Math.PI;
};

const ZONES: Record<ZoneId, Zone> = {
  reception: {
    id: 'reception',
    label: 'Ресепшн',
    alt: 'Ресепшн с рифлёной плиткой и отделкой из светлого дуба',
    side: 'left',
    lines: ['Свет, материалы, форма —\nвсё готово принимать гостей'],
  },
  corridor: {
    id: 'corridor',
    label: 'Коридор',
    alt: 'Коридор со стеклянными перегородками и дубовым полом',
    side: 'right',
    lines: ['Просторное помещение'],
  },
  openspace: {
    id: 'openspace',
    label: 'Опенспейс',
    alt: 'Опенспейс на 26 рабочих мест с панорамным остеклением',
    side: 'left',
    lines: ['26 рабочих мест'],
  },
  meeting_lg: {
    id: 'meeting_lg',
    label: 'Переговорная',
    alt: 'Переговорная на шесть человек с круглым дубовым столом',
    side: 'right',
    lines: ['На 6–8 человек'],
  },
  kitchen: {
    id: 'kitchen',
    label: 'Кухня-лаунж',
    alt: 'Кухня-столовая с барной стойкой на пять мест',
    side: 'left',
    lines: ['Барная группа на пять мест, техника установлена'],
  },
};

const ORDER: ZoneId[] = ['reception', 'corridor', 'openspace', 'meeting_lg', 'kitchen'];

/* Короткая версия по решению заказчика (2026-09-01) — только сам факт
   визуализации, без призыва сверяться на месте. */
const DISCLAIMER = 'Визуализация по дизайн-проекту';

type Props = {
  /** офис — живой экран: слушает клавиши и держит холст параллакса */
  active: boolean;
};

export default function OfficeHub({ active }: Props) {
  const [zoneId, setZoneId] = useState<ZoneId>('reception');
  const [cameFrom, setCameFrom] = useState<ZoneId | null>(null);
  /* ОТКУДА ОТКРЫЛИ ПЛАН, а не просто «открыт ли он». Открытие по Esc
     из зоны запускает обратный нырок: камера стартует ракурсом этой
     зоны и отъезжает в изометрию. Кнопка «Открыть планировку» открывает
     план сразу изометрией, как и раньше, — так просил заказчик.
     null — план закрыт. */
  const [planOpen, setPlanOpen] = useState<null | { backFrom: ZoneId | null }>(null);
  /* Какие кадры уже стоят в стопке. Зона попадает сюда в момент перехода
     и больше не уходит: второй визит не должен ничего грузить. */
  const [seen, setSeen] = useState<ReadonlySet<ZoneId>>(() => new Set<ZoneId>(['reception']));
  const rootRef = useRef<HTMLElement>(null);
  /* Куда вернуть фокус после закрытия плана. Планировку теперь
     открывают Esc-ом помногу раз за просмотр, и без возврата фокус
     каждый раз падал бы на body: Tab начинал бы обход с начала
     страницы, а стрелки между зонами переставали бы работать вовсе —
     они слушают корень офиса и только при фокусе внутри него. */
  const planBtnRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const go = useCallback((to: ZoneId) => {
    setSeen((prev) => (prev.has(to) ? prev : new Set(prev).add(to)));
    setZoneId((current) => { setCameFrom(current); return to; });
  }, []);

  /* ЗАКРЫТИЕ ПЛАНА ЗОНУ НЕ ТРОГАЕТ ВООБЩЕ. Зритель возвращается ровно
     в ту зону, из которой открыл план, — по просьбе заказчика
     (2026-09-01, отмена его же утреннего решения сбрасывать на ресепшн).
     Сбросов на ресепшн на сайте не осталось ни одного; заведёшь новый —
     он выстрелит и здесь, потому что Esc теперь открывает и закрывает
     план десятками раз за просмотр. */
  const closePlan = useCallback((reason: 'dismiss' | 'entered') => {
    setPlanOpen(null);

    /* ВОЗВРАТ К ФОРМЕ. Зритель, попавший в офис из подвала кнопкой
       «3D-модель», уезжает обратно к форме записи — один раз, крошкой
       из lib/officeZone.ts. Только на `dismiss`: после `entered` он
       никуда не уходил, а выбрал зону и остался, и увозить его вниз
       было бы прямо против его действия.

       Три вещи, каждая закрывает свою беду:
       1. ЗАМОК СНИМАЕМ ДО ПРОКРУТКИ — при overflow: hidden на body
          window.scrollTo не делает ровно ничего. Тот же инвариант, что
          в Contact.enterZone. Замок за нами доснимет эффект ниже,
          когда planOpen станет null, и вернёт он '' — план невозможно
          открыть при уже запертой странице (охранник Esc это и держит).
       2. preventScroll у фокуса — иначе браузер подтянет страницу
          к кнопке и отменит только что сделанный переезд.
       3. return — иначе следом отработает офисная ветка фокуса ниже,
          и Tab продолжился бы с секции, которую зритель только что
          покинул.

       Переезда не видно: он приходится в тот же кадр, в котором
       снимается оверлей, а тот в position: fixed и прокрутку под собой
       не показывает. Та же щель, которой пользуется путь в офис. */
    const home = reason === 'dismiss' ? takeOfficeReturn() : null;
    if (home) {
      document.body.style.overflow = '';
      scrollToId(home.id);
      returnFocusRef.current = null;
      home.focus?.focus({ preventScroll: true });
      return;
    }

    /* Возвращаем фокус туда, откуда пришли: кнопка «3D-модель»
       в подвале, «Открыть планировку» в офисе. Если запомненная цель
       не пережила закрытие (её убрали из DOM) — падаем на кнопку
       офиса, но только когда офис на экране: утаскивать фокус
       к офису из подвала нельзя.
       preventScroll обязателен в обоих случаях, иначе браузер
       подтянет страницу к цели и увезёт зрителя. */
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
    else if (active) planBtnRef.current?.focus({ preventScroll: true });
  }, [active]);

  /* Разрыв крошки при уходе прокруткой живёт не здесь, а в самой
     lib/officeZone.ts: слушатель прокрутки заводится вместе с крошкой
     и снимается вместе с ней. Пробовал завязать на проп `active` —
     не годится: он считается фазовой машиной OfficeStop, а та под
     prefers-reduced-motion не запускается вовсе и навсегда остаётся
     на 'office'. Связь не рвалась бы у той части зрителей, что просит
     убрать движение. */

  /* ЕДИНСТВЕННЫЙ ГЛОБАЛЬНЫЙ КЛАВИАТУРНЫЙ ОБРАБОТЧИК НА САЙТЕ: Esc
     открывает планировку из любого места страницы.

     Почему на window, а не на корне офиса, как стрелки. После свапа
     hero фокус уходит на обёртку HeroGate, а она ПРЕДОК секции офиса:
     событие всплывает window → document → body → main → обёртка и до
     нашей секции не доходит никогда. Обработчик на корне ловил бы Esc
     только после явного клика или Tab внутрь офиса — то есть почти
     никогда.

     Почему BUBBLE, а не capture, и почему закрытие писать не нужно.
     У PlanDollhouse и PlanOverlay свой Esc на window в CAPTURE, и оба
     зовут stopPropagation(). Событие, остановленное в capture, до bubble
     на том же window не доходит — проверено. Отсюда даром достаются два
     свойства: пока открыт любой оверлей, этот обработчик молчит (значит
     Esc не откроет план поверх плана и не перебьёт чертёж), а закрытие
     плана делает сам план. Esc получается тумблером без единой строки
     общего состояния между модулями. Перевесишь в capture — оверлеи
     начнут открываться и закрываться одним нажатием. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || planOpen) return;
      /* ЗАЖАТЫЙ Esc. Автоповтор идёт десятками в секунду, и без этой
         строки получается стробоскоп: план открылся — закрылся —
         открылся. Обработчик только ОТКРЫВАЕТ (setPlanOpen(true),
         не тумблер), поэтому два события в одном кадре безвредны,
         но повтор через кадр уже успевает поймать снятый замок. */
      if (e.repeat) return;
      /* Кто-то выше уже разобрал это нажатие. */
      if (e.defaultPrevented || e.isComposing) return;
      /* Замок страницы — признак того, что экраном распоряжается кто-то
         другой: жив hero, открыт оверлей подвала. Читаем инлайновый
         стиль, как это делает SmoothScroll: все три замка на сайте
         ставятся именно так, и четвёртый обязан ставиться так же.
         Этот охранник несущий, а не запасной: между setPlanOpen(true)
         и монтированием PlanDollhouse едет чанк three.js, и всё это
         время capture-слушателя плана ещё не существует. */
      if (document.body.style.overflow === 'hidden') return;
      /* Esc в поле формы записи не должен открывать 3D поверх заявки.
         closest, а не сравнение тега: contenteditable бывает вложенным. */
      const el = document.activeElement as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      /* Куда вернуть фокус при закрытии — запоминаем здесь, пока цель
         ещё жива: план вот-вот заберёт фокус себе. */
      returnFocusRef.current = el;
      /* ОБРАТНЫЙ НЫРОК — только отсюда и только когда офис на экране.
         Камера начнёт с ракурса зоны, которую зритель сейчас видит,
         и отъедет в изометрию. Если Esc нажали из экономики или FAQ,
         под оверлеем никакой зоны нет, отъезжать не от чего —
         открываем сразу изометрией. */
      setPlanOpen({ backFrom: active ? zoneId : null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [planOpen, active, zoneId]);

  /* Пока план открыт, страница под ним не листается: он лежит
     в position: fixed поверх всего, но сам скролл не блокирует, и без
     замка зритель уезжал бы к следующим секциям сайта, не закрывая
     план явно. Тот же приём, что у оверлеев из подвала (Contact.tsx). */
  useEffect(() => {
    if (!planOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [planOpen]);

  /* Тот же переход, но по зову со стороны. Кукольный дом открывают
     ещё и кнопкой «3D-модель» в подвале, у формы записи, — там между
     ним и офисом полстраницы и шесть чужих секций. Канал объявлен
     в lib/officeZone.ts, страницу к офису двигает вызывающий. */
  useEffect(() => onZoneRequest(go), [go]);

  /* Выбор зоны внутри плана. Раньше это был просто go(): план открывался
     только кнопкой из самого офиса, и офис заведомо был на экране.
     Теперь Esc открывает его откуда угодно — из экономики, из FAQ, —
     и зону надо не только переключить, но и привезти к ней зрителя,
     иначе после растворения оверлея он останется там, где нажал Esc,
     а переключённая зона будет далеко вверху.

     Приём готовый, из Contact.tsx: сначала СНЯТЬ ЗАМОК, потом
     scrollToOffice(). При overflow: hidden прокрутка программно
     не двигается, и порядок здесь не вкусовщина. Замок за нами
     доснимет эффект выше, когда planOpen станет null.

     Переезд не виден: он приходится в глухую часть перехода план→зона,
     до начала растворения оверлея (REVEAL_AT, 1390 мс) экран закрыт
     непрозрачным планом. Той же щелью пользуется подвал. */
  const enterZoneFromPlan = useCallback((to: ZoneId) => {
    if (!active) {
      document.body.style.overflow = '';
      scrollToOffice();
    }
    go(to);
  }, [active, go]);

  /* Кроме закрытия плана (closePlan) зону на ресепшн больше ничего
     не сбрасывает: башня ушла вместе со скролл-секвенцией, hero-видео
     назад не пускает (только перезагрузка). Обход начинается от двери
     один раз — при первом входе. */
  const zone = ZONES[zoneId];

  const moves = useMemo(
    () => EXITS[zoneId].map((to) => ({
      to,
      angle: bearing(zoneId, to),
      label: ZONES[to].label,
      isReturn: to === cameFrom,
    })),
    [zoneId, cameFrom],
  );

  /* Стрелки: ближайший по азимуту выход. Слушатель висит НА КОРНЕ офиса,
     а не на window, и работает, только когда фокус внутри него. Так было
     не всегда: пока офис был оверлеем с зафиксированным body, глобальный
     слушатель с preventDefault ничего не ломал. Теперь страница листается,
     и перехват ArrowDown на весь документ отнял бы у клавиатуры прокрутку —
     ровно то, что AGENTS.md запрещает в разделе «Доступность». */
  const onRootKey = useCallback((e: ReactKeyboardEvent) => {
    if (planOpen) return;
    const want =
      e.key === 'ArrowUp' ? 0 : e.key === 'ArrowRight' ? 90
      : e.key === 'ArrowDown' ? 180 : e.key === 'ArrowLeft' ? 270 : null;
    if (want === null) return;
    let best = null as null | { to: ZoneId; d: number };
    for (const m of moves) {
      const d = Math.abs(((m.angle - want + 540) % 360) - 180);
      if (d <= 67.5 && (!best || d < best.d)) best = { to: m.to, d };
    }
    if (best) { e.preventDefault(); go(best.to); }
  }, [planOpen, moves, go]);

  /* Esc живёт выше, в эффекте с window-слушателем: он открывает план,
     а закрывает его собственный Esc внутри PlanDollhouse. Зону ни тот,
     ни другой не трогают. */

  /* ЗДЕСЬ БЫЛ БЛОК, ЗАКРЫВАВШИЙ ПЛАН, КОГДА СЕКЦИЯ УХОДИЛА ИЗ КАДРА
     (`active` false → setPlanOpen(false)). Он снят вместе с фичей
     «Esc открывает план откуда угодно», и вернуть его нельзя.

     Причина. Раньше «план открыт при неактивной секции» было аварией:
     план жил внутри секции, и висеть ему было не над чем. Теперь это
     ШТАТНОЕ состояние — план в портале, открыт по Esc из экономики,
     из FAQ, из подвала, и от фазы секции не зависит вовсе.

     А `active` меняется не только от прокрутки. Слушатель OfficeStop
     висит и на `resize`, и пересчитывает прогресс от нового
     `innerHeight`: поворот телефона, уборка адресной строки iOS,
     потянутый угол окна — и порог 0,12 пересекается сам собой.
     С этим блоком план захлопывался бы прямо под руками. */

  return (
    /* Не dialog и не оверлей: это обычная секция страницы. Отсюда нет
       ни role, ни aria-hidden, ни inert — видимостью и inert распоряжается
       OfficeStop, у него для этого есть прогресс скролла. */
    <section
      ref={rootRef}
      className={styles.root}
      onKeyDown={onRootKey}
      aria-label="Помещение 113Н, обход по зонам"
    >
      {/* Кадры лежат стопкой и переключаются прозрачностью — без сдвигов.
          В стопке только те зоны, где зритель уже побывал: все пять
          занимают весь экран, то есть формально видимы, и loading="lazy"
          их не удержал бы — браузер потянул бы 2 МБ сразу. Побывал —
          кадр остался в DOM, возврат мгновенный.

          next/image здесь не нужен: рендеры уже нарезаны на четыре ширины
          в WebP и AVIF (см. public/interior/renders/manifest.json), и
          прогонять готовые файлы через оптимизатор второй раз — это
          лишний проход и потеря AVIF. */}
      <div className={styles.stage}>
        {ORDER.filter((id) => seen.has(id)).map((id) => {
          const z = ZONES[id];
          const on = id === zoneId;
          return (
            <picture key={id} className={`${styles.shot} ${on ? styles.shotOn : ''}`}>
              <source type="image/avif" srcSet={renderSrcSet(id, 'avif')} sizes="100vw" />
              <source type="image/webp" srcSet={renderSrcSet(id, 'webp')} sizes="100vw" />
              <img
                /* Метка для параллакса: холст берёт текстуру прямо
                   из этого элемента, а не качает кадр второй раз. */
                data-zone={id}
                src={renderSmallest(id)}
                alt={on ? z.alt : ''}
                width={RENDER_NATIVE[id][0]}
                height={RENDER_NATIVE[id][1]}
                draggable={false}
                decoding="async"
                fetchPriority={id === 'reception' ? 'high' : 'auto'}
              />
            </picture>
          );
        })}

        {/* Поверх стопки. Монтируется только когда офис открыт: за
            офис не на экране, холст не нужен, а WebGL-контекст стоит слота.
            Пока карта глубины не доехала, холст прозрачен и виден кадр
            под ним, поэтому смены зоны выглядят ровно как раньше. */}
        {active && <ZoneParallax zone={zoneId} />}
      </div>

      {/* Вуали. Не декор: держат контраст текста поверх светлого рендера. */}
      <div className={styles.scrimTop} aria-hidden="true" />
      <div
        className={`${styles.scrimInfo} ${zone.side === 'right' ? styles.scrimInfoRight : styles.scrimInfoLeft}`}
        aria-hidden="true"
      />
      <div className={styles.scrimBottom} aria-hidden="true" />

      <div className={styles.ui}>
        <div className={styles.bottom}>
          <div className={`${styles.info} ${zone.side === 'right' ? styles.infoRight : ''}`} key={zoneId}>
            {/* Надзаголовок с метражом — только на ресепшне: он там
                представляет помещение целиком. В остальных зонах речь
                уже о самой зоне, и общая площадь повторяется впустую. */}
            {zoneId === 'reception' && (
              <p className={`label ${styles.eyebrow}`}>
                Помещение 113Н{NBSP}·{NBSP}244,1{NBSP}м²
              </p>
            )}
            {/* У зоны без описания (коридор) заголовок сам держит отбивку
                до «Открыть планировку» — иначе кнопка липнет к имени. */}
            <h2 className={`${styles.zoneName} ${zone.lines.length === 0 ? styles.zoneNameBare : ''}`}>
              {zone.label}
            </h2>

            {zone.zero && (
              <p className={styles.zeroRow}>
                <span className={`label ${styles.zeroCaption}`}>{zone.zero.caption}</span>
                <span className={styles.zero}>
                  0<span className={styles.zeroUnit}>{zone.zero.unit}</span>
                </span>
                {/* полоса растра под ключевым числом — design-system.md §1 */}
                <span className={styles.zeroStrip} aria-hidden="true" />
              </p>
            )}

            {zone.lines.map((line) => <p key={line} className={styles.line}>{line}</p>)}

            {/* Модель и JSON тянем уже по наведению: к клику они в кэше,
                и план открывается без паузы на загрузку. */}
            <div className={styles.planWrap}>
              <button
                ref={planBtnRef}
                type="button"
                className={styles.planLink}
                onClick={(e) => {
                  returnFocusRef.current = e.currentTarget;
                  /* Кнопка открывает план сразу изометрией: обратный
                     нырок заказан только под Esc. */
                  setPlanOpen({ backFrom: null });
                }}
                onPointerEnter={prefetchPlan}
                onFocus={prefetchPlan}
              >
                {/* Волосяная линия — на обёртке текста, не на кнопке: под
                    бейджем «3D» своя рамка, второй линии под ним не нужно.
                    Красная линия рисуется поверх серой отдельным слоем. */}
                <span className={styles.planText}>Открыть планировку</span>
                <span className={styles.planBadge} aria-hidden="true">3D</span>
              </button>
              {/* Декоративная подпись, появляется вместе с красным ховером
                  ссылки, по очереди — второй кусок с задержкой --stagger;
                  доступное имя кнопки остаётся чистым. */}
              <span className={styles.planSub} aria-hidden="true">
                <span className={styles.planSubStep}>Пять зон</span>
                <span className={styles.planSubStep}>{NBSP}·{NBSP}Объёмный план</span>
              </span>
            </div>
          </div>

          <nav className={styles.nav} aria-label="Переходы по помещению">
            {moves.map((m) => (
              <button
                key={m.to}
                type="button"
                className={`${styles.move} ${m.isReturn ? styles.moveReturn : ''}`}
                onClick={() => go(m.to)}
                aria-label={m.label}
              >
                {/* подпись видна по наведению и по фокусу; для скринридера
                    имя кнопки несёт aria-label, поэтому здесь aria-hidden */}
                <span className={styles.moveLabel} aria-hidden="true">{m.label}</span>
                {/* Маска — круг ровно по границе заливки, отдельно от кольца
                    на ::after (оно на самой кнопке и шире круга на 10px,
                    обрезать его вместе со стрелкой нельзя). Стрелка внутри
                    неё сдвигается на ховере вперёд и не выходит за заливку. */}
                <span className={styles.moveMask} aria-hidden="true">
                  {/* Поворот — на обёртке, сдвиг по наведению — на самой svg.
                      Раздельно специально: translateY в системе координат,
                      уже повёрнутой родителем, идёт вдоль направления стрелки
                      само по себе, без вычисления sin/cos под конкретный угол. */}
                  <span className={styles.arrowWrap}
                    style={{ transform: `rotate(${m.angle.toFixed(1)}deg)` }}>
                    <svg viewBox="0 0 24 24" width="19" height="19" className={styles.arrowIcon}>
                      <path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor"
                        strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </span>
              </button>
            ))}
          </nav>

          {/* Строка всегда в разметке, даже там, где не нужна: она — часть
              той же сетки, что и круги переходов, и её высота — часть общей
              высоты блока. Убрать её из потока значило бы сдвинуть круги
              вниз на всех экранах, кроме ресепшна, — а они обязаны стоять
              на одном уровне везде. Прячем классом, не убираем узел. */}
          <p className={`${styles.fine} ${zoneId === 'reception' ? '' : styles.fineHidden}`}>
            {DISCLAIMER}
          </p>
        </div>
      </div>

      {/* Кукольный дом сам решит, показать объёмный план или плоский,
          и сам переключит офис на выбранную зону — пока оверлей ещё
          закрывает экран, поэтому шва не видно. */}
      {/* Монтируем по клику, а не прячем пропом: у dynamic() чанк едет
          в момент отрисовки, и постоянно висящий в дереве план утащил бы
          свой код на первый экран. Пустой кадр — пустой запрос. */}
      {planOpen && (
        <PlanDollhouse
          onClose={closePlan}
          onEnterZone={enterZoneFromPlan}
          backFrom={planOpen.backFrom}
        />
      )}
    </section>
  );
}
