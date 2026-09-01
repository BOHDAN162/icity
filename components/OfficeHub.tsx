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
   Сброс на ресепшн делает только «К башне», см. exit().

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
  useCallback, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import dynamic from 'next/dynamic';
import {
  RENDER_NATIVE, prefetchPlan, renderSmallest, renderSrcSet, type RenderKey,
} from '@/lib/interior';
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
  kitchen: ['corridor', 'openspace'],
  openspace: ['reception', 'corridor', 'kitchen', 'meeting_lg'],
  meeting_lg: ['corridor', 'openspace'],
};

/** Азимут от зоны к зоне: 0° — север, дальше по часовой. */
const bearing = (from: ZoneId, to: ZoneId) => {
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
    lines: ['Отделка PRIDEX выполнена.', 'Мебель — по готовому дизайн-проекту.'],
  },
  corridor: {
    id: 'corridor',
    label: 'Коридор',
    alt: 'Коридор со стеклянными перегородками и дубовым полом',
    side: 'right',
    lines: ['Стеклянные перегородки, дубовый пол.', 'Проект и согласования сделаны.'],
  },
  openspace: {
    id: 'openspace',
    label: 'Опенспейс',
    alt: 'Опенспейс на 26 рабочих мест с панорамным остеклением',
    side: 'left',
    lines: ['26 рабочих мест.', 'Мебель входит в аренду, докупать нечего.'],
  },
  meeting_lg: {
    id: 'meeting_lg',
    label: 'Переговорная',
    alt: 'Переговорная на шесть человек с круглым дубовым столом',
    side: 'right',
    lines: ['На 6–8 человек.', 'Срок до въезда: день обращения, а не месяцы.'],
  },
  kitchen: {
    id: 'kitchen',
    label: 'Кухня-лаунж',
    alt: 'Кухня-столовая с барной стойкой на пять мест',
    side: 'left',
    lines: ['Барная группа на пять мест, техника установлена.'],
  },
};

const ORDER: ZoneId[] = ['reception', 'corridor', 'openspace', 'meeting_lg', 'kitchen'];

/* Строка обязательная. Она стоит ноль и снимает риск целиком: ЛПР приедет
   смотреть в тот же день, и если картинка окажется красивее реальности,
   сделка умрёт на пороге. Не удалять. */
const DISCLAIMER =
  'Визуализация по дизайн-проекту. Помещение готово — приезжайте и сверьте с оригиналом.';

type Props = {
  /** офис — живой экран: слушает клавиши и держит холст параллакса */
  active: boolean;
};

export default function OfficeHub({ active }: Props) {
  const [zoneId, setZoneId] = useState<ZoneId>('reception');
  const [cameFrom, setCameFrom] = useState<ZoneId | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  /* Какие кадры уже стоят в стопке. Зона попадает сюда в момент перехода
     и больше не уходит: второй визит не должен ничего грузить. */
  const [seen, setSeen] = useState<ReadonlySet<ZoneId>>(() => new Set<ZoneId>(['reception']));
  const rootRef = useRef<HTMLElement>(null);

  const go = useCallback((to: ZoneId) => {
    setSeen((prev) => (prev.has(to) ? prev : new Set(prev).add(to)));
    setZoneId((current) => { setCameFrom(current); return to; });
  }, []);

  /* Сброса зоны на ресепшн больше нет нигде: башня ушла вместе со
     скролл-секвенцией, hero-видео назад не пускает (только перезагрузка).
     Обход начинается от двери один раз — при первом входе. */
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

  /* Глобального Esc здесь больше нет: на ресепшне и в зонах Esc не делает
     ничего — уходить некуда, hero-видео позади не существует. Единственный
     Esc на сайте живёт внутри PlanDollhouse и закрывает только планировку,
     возвращая к рендеру текущей зоны. */

  /* Ушли вниз по скроллу с открытым планом — план закрываем. Он лежит
     в position: fixed поверх всего и сам скролл не блокирует, поэтому
     иначе висел бы над кадром вида. Зону при этом не трогаем.

     Правка состояния прямо в рендере, а не в эффекте: это ровно тот
     случай, под который она и описана в документации React — состояние
     подстраивается под смену пропа. Через useEffect тут был бы лишний
     проход и ошибка react-hooks/set-state-in-effect. */
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setPlanOpen(false);
  }

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
            <p className={`label ${styles.eyebrow}`}>
              Помещение 113Н{NBSP}·{NBSP}244,1{NBSP}м²
            </p>
            <h2 className={styles.zoneName}>{zone.label}</h2>

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
                type="button"
                className={styles.planLink}
                onClick={() => setPlanOpen(true)}
                onPointerEnter={prefetchPlan}
                onFocus={prefetchPlan}
              >
                Открыть планировку
                <span className={styles.planBadge} aria-hidden="true">3D</span>
              </button>
              {/* Декоративная подпись, появляется вместе с красным ховером
                  ссылки; доступное имя кнопки остаётся чистым. */}
              <span className={styles.planSub} aria-hidden="true">
                Пять зон{NBSP}·{NBSP}объёмный план
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
                <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
                  style={{ transform: `rotate(${m.angle.toFixed(1)}deg)` }}>
                  <path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor"
                    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </nav>

          <p className={styles.fine}>{DISCLAIMER}</p>
        </div>
      </div>

      {/* Кукольный дом сам решит, показать объёмный план или плоский,
          и сам переключит офис на выбранную зону — пока оверлей ещё
          закрывает экран, поэтому шва не видно. */}
      {/* Монтируем по клику, а не прячем пропом: у dynamic() чанк едет
          в момент отрисовки, и постоянно висящий в дереве план утащил бы
          свой код на первый экран. Пустой кадр — пустой запрос. */}
      {planOpen && <PlanDollhouse onClose={() => setPlanOpen(false)} onEnterZone={go} />}
    </section>
  );
}
