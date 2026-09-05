'use client';

/* iCITY 113Н — планировка: кукольный дом поверх офиса.
   Путь в проекте: components/PlanDollhouse.tsx

   ЧТО ЭТО. Оболочка. Она решает, каким способом показать этаж, держит
   информационный слой и ведёт передачу управления обратно офису.
   Сам этаж рисует либо PlanScene (three.js), либо PlanFlat (SVG).

   ДВА СОСТОЯНИЯ И ОДИН ПЕРЕХОД. Состояние A — план. Состояние B — рендер
   зоны, и это уже не наша забота: рендеры показывает OfficeHub, он это
   и так умеет. Наша забота — чтобы между A и B было ровно одно событие:

     0 мс     клик. Камера пошла нырять к точке съёмки И ОДНОВРЕМЕННО
              офису сказано переключиться на эту зону. Он отыгрывает свой
              переход (620 мс, --t-scene), грузит кадр и поднимает вуали
              с подписями — всё это под ещё непрозрачным оверлеем
     1390 мс  погружение дочитано (97,6 % пути при easeInOutCubic), и
              ровно здесь оверлей начинает растворяться ЦЕЛИКОМ
              (REVEAL_AT). Последние 2,4 % камера проходит уже под
              растворением — кадра, где всё замерло, не существует
     1870 мс  растворение кончилось (REVEAL_MS), оверлей снят. Зритель
              увидел: камера нырнула в нужный ракурс — и сразу открылся
              нужный экран. Между этими двумя ничего нет.

   Темп нырка правится ОДНИМ числом — FLIGHT_MS в lib/interior.ts, —
   но REVEAL_AT обязан переехать следом: он равен 0,818 × FLIGHT_MS.

   ТРИ ОТДЕЛЬНЫХ СОБЫТИЯ, КОТОРЫЕ БЫЛИ ЗДЕСЬ ДО ЭТОГО, И КАЖДОЕ ЧИТАЛОСЬ
   КАК РЫВОК. Не повторять:
     1. Камера прилетала и ЗАМИРАЛА на белой нетекстурированной модели.
        Виновата кривая: easeOutQuart проходила 97 % пути за 58 % времени,
        и последние 42 % перелёта камера ехала только формально.
     2. Кадр зоны проявлялся поверх холста отдельным слоем — «через
        секунду появляется другой кадр».
     3. Оверлей снимался, и разом появлялись вуали OfficeHub (.scrimInfo,
        белая заливка на 56 % ширины — «белый туман»), подписи и стрелки.
   Лечится это тремя вещами разом, и убрать любую значит вернуть рывок:
   кривая перелёта распределяет ход до самого конца (easeInOutCubic),
   офису дают команду в момент клика, а уходит оверлей целиком.

   Числа лежат в lib/interior.ts, чтобы сцена и оболочка считали
   по одним и тем же.

   ТРИ ПРИЧИНЫ НЕ ГРУЗИТЬ 3D: медленная сеть, отсутствие WebGL, просьба
   убрать движение. Во всех трёх — плоский план, и информационный слой
   там ровно тот же. Это требование, а не запасной вариант поскромнее.

   ЧЕГО ЗДЕСЬ НЕТ. Метража отдельных зон. Полигоны из zones_cameras.json —
   это области попадания курсора: их сумма 200,9 м² против 244,1 м²
   по документам. Подписать зону площадью значит выдумать число, а этого
   docs/facts.md прямо не разрешает. Подписано имя, метраж — общий.

   РИСУЕМСЯ ЧЕРЕЗ ПОРТАЛ В BODY, и это не украшение архитектуры.
   Из офиса план монтируется внутрь слоя A липкой сцены, а тот накрыт
   `inert={!officeLive}` (OfficeStop.tsx) — то есть всё, кроме самой
   макушки секции офиса, для клавиатуры и указателя мертво. Esc теперь
   открывает план из любого места страницы, и без портала он приезжал
   бы туда неинтерактивным: ни зону выбрать, ни «Закрыть» нажать.
   Портал заодно снимает вторую, давнюю опасность — трансформированного
   предка: у него `position: fixed` считает координаты от себя, и план
   разъезжался бы (этому посвящены отдельные абзацы в AGENTS.md про
   `.lifted` в HeroGate и про запрет transform на корне OfficeHub).
   Портал стоит ЗДЕСЬ, а не у вызывающих: экземпляра два — из офиса
   и из подвала, — и оба должны получить его без своих правок. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { focusQuietly } from '@/lib/focus';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import {
  REVEAL_AT, REVEAL_CAP_MS, REVEAL_MS, RENDER_NATIVE,
  hasWebGL, isSlowNetwork, loadPlan,
  prefetchRender, renderSrcSet, renderSmallest,
  type Plan, type RenderKey, type ZoneKey,
} from '@/lib/interior';
import { TOUR_URL } from '@/lib/tour';
import {
  PLAN_DRAG_SLOP, orbitFollow, orbitRelease, planOrbit, resetPlanOrbit,
} from '@/lib/motion';
import PlanOverlay from './PlanOverlay';
import { ArrowDown } from './NextCue';
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

const FACADE_NOTE = '\u041F\u0430\u043D\u043E\u0440\u0430\u043C\u043D\u044B\u0439 \u0444\u0430\u0441\u0430\u0434 \u043F\u043E \u0442\u0440\u0451\u043C \u0441\u0442\u043E\u0440\u043E\u043D\u0430\u043C.';

/* ОДИН ФЛАГ НА ДВА СЛЕДСТВИЯ: «зритель хоть раз ушёл из плана в зону».
   Пока он ложен, зритель ещё не знает, что по зонам можно ходить, —
   и в углу висит подсказка. Как только истинен, объяснять больше
   нечего, зато появляется смысл вести дальше: в правом нижнем углу
   встаёт «Дальше». Одно состояние, потому что событие одно и то же.

   Ставится в pick() — единственном пути в зону, — и живёт в МОДУЛЕ,
   а не в состоянии: план открывают и закрывают десятками раз (Esc —
   тумблер), и он размонтируется вместе со своим состоянием.
   sessionStorage тут не нужен: памяти на одну загрузку страницы
   достаточно, а перезагрузка обычно означает нового зрителя.

   ПОДСКАЗКА ГАСНЕТ ТОЛЬКО ОТ ПЕРЕХОДА, а не от наведения. Наведение
   стояло здесь до 5 сентября 2026 и оказалось неверным признаком:
   зритель, просто ведущий мышь через план, гасил подсказку, ни разу
   ею не воспользовавшись, — а объяснение исчезало навсегда. */
const HINT_FINE = 'Наведите на зону 3D-плана и кликните, чтобы переместиться.';
const HINT_TOUCH = 'Коснитесь зоны 3D-плана, чтобы переместиться.';
/* Пара к --t-reveal в tokens.css: там красится уход подсказки, здесь
   по этому же числу узел снимается из разметки. Снимается он затем,
   чтобы скринридер не читал невидимое: держать погасший элемент
   на opacity: 0 значит оставить его в дереве доступности. */
const HINT_OUT_MS = 380;
/* КОГДА ПОДСКАЗКА УЖЕ НА ЭКРАНЕ ЦЕЛИКОМ: задержка появления плюс само
   появление (700 + 380 в .hint, PlanDollhouse.module.css). До этого
   момента уход не анимируется, а узел снимается молча, и вот почему:
   класс ухода заменяет собой анимацию появления, а его первый кадр —
   непрозрачность 1. Замер до правки: подсказку гасили на 250-й мс,
   когда она ещё не начала проявляться (opacity 0), — и следующий же
   кадр давал 1, то есть вместо ухода зритель получал вспышку.
   Правишь одно из трёх чисел — сверяйся с остальными. */
const HINT_LIVE_MS = 1080;
let zoneEntered = false;

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


type Props = {
  /* ПОЧЕМУ ЗАКРЫЛИСЬ — вызывающему это нужно знать, и вот зачем.
     Зону закрытие не трогает ни в одном случае, тут разницы нет.
     Но зритель, попавший в офис из подвала кнопкой «3D-модель», имеет
     право уехать обратно к форме записи (крошка в lib/officeZone.ts),
     и тратится это право только на `dismiss`. После `entered` зритель
     никуда не уходил — он только что выбрал зону и остался в офисе,
     увозить его к форме было бы прямо против его действия.

       dismiss — Esc или кнопка «Закрыть»
       entered — finish(), закрытие само собой после выбора зоны */
  onClose: (reason: 'dismiss' | 'entered') => void;
  /** офис переключается на эту зону, пока оверлей ещё закрывает экран */
  onEnterZone: (key: RenderKey) => void;
  /* ОБРАТНЫЙ НЫРОК НА ВХОДЕ. Зона, из которой открыли план: камера
     начнёт с её ракурса съёмки — то есть ровно с того, что зритель
     видит на фотографии, — и отъедет в изометрию. Зеркало погружения.
     null — обычное открытие, план сразу в изометрии; так приходит
     открытие из подвала, где под оверлеем не зона, а форма записи,
     и отъезжать было бы не от чего. */
  backFrom?: RenderKey | null;
  /* НЫРОК НА ВЫХОДЕ. Зона, в которую возвращает «Закрыть» и Esc:
     камера ныряет в её ракурс, и оверлей растворяется в готовый экран —
     тем же приёмом, что и выбор зоны. null — закрывать мгновенно,
     как было. Значение считает вызывающий, потому что «под оверлеем
     стоит эта зона» знает только он: из подвала там форма записи,
     а не офис, и нырять некуда. */
  returnTo?: RenderKey | null;
  /* «ДАЛЬШЕ» ВМЕСТО «ЗАКРЫТЬ» В КАПСУЛЕ. План перестаёт быть тупиком:
     нажали — и панорама поднимается ПОВЕРХ него, жест вверх опускает
     её обратно к плану. Устройство — в OfficeStop, здесь только кнопка.

     undefined — плана из подвала и из чужих секций: шагать оттуда
     некуда, и в капсуле остаётся обычное «Закрыть». */
  onNext?: () => void;
  /* ДОБРАЛ ЛИ ЗРИТЕЛЬ ПОРОГ — три просмотренные зоны считая ресепшн
     (READY_ZONES в OfficeHub). Кнопка «Дальше» приходит только с ним:
     звать дальше того, кто видел один ресепшн, значит торопить его
     мимо самого помещения. */
  nextReady?: boolean;
};

/* Плоский план или объёмный — решается одним выражением, и читателей
   у него два: сам компонент при монтировании и прогрев ниже. Держать
   два списка условий нельзя: разойдутся, и прогрев будет качать не тот
   чанк, который потом отрисуется. */
function decideMode() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  return {
    // Медленная сеть, нет WebGL или просьба убрать движение — плоский план.
    mode: !reduced && !isSlowNetwork() && hasWebGL() ? ('solid' as const) : ('flat' as const),
    calm: coarse || reduced,
    /* Мышь есть — подсказка «как смотреть» говорит про наведение и клик,
       иначе про касание. Спрашиваем живьём и отдельно, а не выводим
       из `calm`: тот поднимается и на десктопе с prefers-reduced-motion,
       и предложение «коснитесь» приехало бы к человеку с мышью. */
    fine: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
  };
}

/* ПРОГРЕВ ЧАНКА СЦЕНЫ. Зовут снаружи — из офиса, когда зритель до него
   доехал (OfficeHub, warmPlan). Смысл в том, чтобы к моменту нажатия
   «Открыть планировку» уже лежал в кэше не только этот модуль, но и то,
   что он потом затребует сам: без прогрева за PlanScene едет three.js,
   и первый показ плана ждёт его.

   Ошибку глотаем молча: это предзагрузка, а не показ. Не приехало —
   dynamic() затребует то же самое ещё раз, уже по клику. */
export function preloadPlanScene(): void {
  const { mode } = decideMode();
  if (mode !== 'solid') {
    void import('./PlanFlat').catch(() => {});
    return;
  }
  /* Чанк — половина дела: за ним модель, которую ещё нужно разобрать.
     Просим сцену прогреть её сразу же, тем же кэшем useLoader, из
     которого она потом и возьмёт готовое. */
  void import('./PlanScene').then((m) => m.preloadGlb()).catch(() => {});
}

/* Пропа `open` нет: смонтирован — значит открыт. Так чанк с three.js
   уезжает из первого экрана сам собой, а закрытие гарантированно
   отпускает WebGL-контекст, а не оставляет его висеть невидимым. */
export default function PlanDollhouse({
  onClose,
  onEnterZone,
  backFrom = null,
  returnTo = null,
  onNext,
  nextReady = false,
}: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<ZoneKey | null>(null);
  const [flyTo, setFlyTo] = useState<RenderKey | null>(null);
  /* `arriving` вешает <picture> кадра зоны в DOM в момент клика. Видимым
     он больше не бывает НИКОГДА — это зонд загрузки, и только. Тот же
     кадр в ту же секунду начинает грузить и сам OfficeHub (onEnterZone
     зовётся из pick), запрос у них общий, поэтому onLoad здесь —
     честный ответ на вопрос «фотография под оверлеем уже готова?».
     Без него растворение могло бы открыть белый прямоугольник. */
  const [arriving, setArriving] = useState<RenderKey | null>(null);
  /* Оверлей растворяется в готовый экран зоны. Одно состояние на весь
     переход: отдельного проявления кадра поверх холста больше нет. */
  const [leaving, setLeaving] = useState(false);
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

  /* Куда встаёт фокус при открытии. Раньше это была кнопка «Закрыть»,
     но с мышью её больше нет — фокус принимает сам корень окна.
     Так Tab начинает обход с начала диалога, а голосовой доступ
     читает его aria-label; tabIndex={-1} нужен ровно затем, чтобы
     div вообще мог принять фокус, в обход клавиатуры не попадая. */
  const rootRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /* Куда летим — держим ещё и в ref: фазы приходят из кадра сцены,
     а вызывать побочный эффект из апдейтера состояния нельзя. */
  const flyRef = useRef<RenderKey | null>(null);

  /* Способ показа решается один раз, при монтировании. Ленивый
     инициализатор, а не эффект: пересчитывать его на каждый рендер значит
     поймать смену WebGL-контекста в середине перелёта. SSR тут не мешает —
     компонент приезжает через dynamic({ ssr: false }). */
  const [{ mode, calm, fine }] = useState(decideMode);

  /* Подсказка «по зонам можно ходить» — см. шапку у HINT_FINE.
     Состояний два: `off` красит уход, `gone` снимает узел совсем. */
  const [hintOff, setHintOff] = useState(zoneEntered);
  const [hintGone, setHintGone] = useState(zoneEntered);

  /* «Дальше» показываем тому, кто добрал порог и вернулся в план.
     СНИМОК ПРИ МОНТИРОВАНИИ, а не живое чтение пропа: третья зона
     попадает в `seen` в момент клика, а план после этого живёт ещё
     полторы секунды — нырок камеры, — и живое чтение проявило бы
     кнопку прямо посреди ухода. Отсюда и «вернулся»: кнопка приходит
     со следующего открытия плана. */
  const [wentInside] = useState(() => nextReady);

  /* Дошла ли подсказка до полной непрозрачности. Ref, а не состояние:
     от него ничего не перерисовывается, он только выбирает способ ухода. */
  const hintLiveRef = useRef(false);

  const hideHint = useCallback(() => {
    if (zoneEntered) return;
    zoneEntered = true;
    // Ещё не показалась — это не уход, а отмена показа. Молча.
    if (!hintLiveRef.current) { setHintGone(true); return; }
    setHintOff(true);
    timersRef.current.push(setTimeout(() => setHintGone(true), HINT_OUT_MS));
  }, []);

  useEffect(() => {
    let alive = true;
    loadPlan().then(
      (p) => { if (alive) setPlan(p); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, []);

  /* Узел подсказки появляется вместе с планом — от этого мгновения
     и считается её выход на полную непрозрачность. */
  useEffect(() => {
    if (!plan || zoneEntered) return;
    const t = setTimeout(() => { hintLiveRef.current = true; }, HINT_LIVE_MS);
    return () => clearTimeout(t);
  }, [plan]);

  // таймеры шва живут не дольше оверлея
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; }, []);

  useEffect(() => { focusQuietly(rootRef.current); }, []);

  /* КУДА ВЕДЁТ НЫРОК — в выбранную зону или обратно в ту, откуда пришли.
     Ref, а не состояние: читается он в конце перелёта, из таймера, и
     ре-рендер ради него был бы холостым. */
  const returningRef = useRef(false);

  /* finish() зовётся только в конце растворения. При выборе зоны офис
     уже на неё переключён (onEnterZone отработал ещё в pick), при
     возврате переключать было нечего — он и так стоит на этой зоне.
     К этому моменту оверлей стоит на нулевой непрозрачности, поэтому
     снятие flyTo (сцена возвращает камеру домой одним кадром) уже
     не видно — раньше этот кадр успевал мелькнуть.

     ПРИЧИНА ЗАКРЫТИЯ БЕРЁТСЯ ИЗ returningRef, и это несущая строка:
     возврат обязан прийти вызывающему как `dismiss`, иначе крошка
     возврата в подвал никогда не потратится — она тратится только
     на dismiss. */
  const finish = useCallback(() => {
    flyRef.current = null;
    setFlyTo(null);
    setArriving(null);
    setLeaving(false);
    setHovered(null);
    onClose(returningRef.current ? 'dismiss' : 'entered');
  }, [onClose]);

  /* Растворение стартует по совпадению ДВУХ условий, и ни одно нельзя
     выкинуть: `dueRef` — камера дошла до REVEAL_AT и ещё едет, `readyRef` —
     фотография зоны догрузилась. Порядок между ними не определён:
     из кэша кадр готов раньше камеры, на холодной сети — позже. */
  const dueRef = useRef(false);
  const readyRef = useRef(false);
  const goneRef = useRef(false);

  const tryReveal = useCallback(() => {
    if (goneRef.current || !dueRef.current || !readyRef.current) return;
    goneRef.current = true;
    setLeaving(true);
    timersRef.current.push(setTimeout(finish, REVEAL_MS));
  }, [finish]);

  const onPhase = useCallback((phase: 'reveal' | 'done') => {
    if (phase !== 'reveal') return;
    dueRef.current = true;
    tryReveal();
  }, [tryReveal]);

  /* Плоский план не летит — там точку старта растворения задаёт таймер,
     а не камера. Всё остальное у обоих режимов общее. */
  const pick = useCallback((key: RenderKey) => {
    if (flyRef.current) return;
    hideHint();
    flyRef.current = key;
    setFlyTo(key);
    setArriving(key);

    /* Офису говорим переключиться СРАЗУ, а не в середине перелёта.
       Он весь свой переход (620 мс, --t-scene) отыгрывает под ещё
       непрозрачным оверлеем, и к растворению под нами стоит готовый,
       устоявшийся экран зоны — с фотографией, вуалями и подписями.
       Раньше офису давали команду на 800-й мс, и его вуали с подписями
       появлялись уже ПОСЛЕ снятия оверлея, отдельным событием. */
    onEnterZone(key);

    if (mode !== 'solid') {
      timersRef.current.push(setTimeout(() => {
        dueRef.current = true;
        tryReveal();
      }, REVEAL_AT));
    }

    /* Потолок ожидания загрузки: кадр не приехал — уходим всё равно. */
    timersRef.current.push(setTimeout(() => {
      dueRef.current = true;
      readyRef.current = true;
      tryReveal();
    }, REVEAL_CAP_MS));
  }, [hideHint, mode, onEnterZone, tryReveal]);

  /* ЗАКРЫТИЕ ПО ПРОСЬБЕ ЗРИТЕЛЯ — «Закрыть» и Esc, один путь на оба.
     Это зеркало pick(): камера ныряет в ракурс зоны, оверлей
     растворяется в готовый экран, и зритель видит одно движение,
     а не мгновенно снятый экран.

     Отличий от pick ровно три, и каждое обязательно:

     1. onEnterZone НЕ зовём. Офис уже стоит на этой зоне — команда
        переключения заставила бы его отыграть свои 620 мс (--t-scene)
        под оверлеем впустую.
     2. Зонда загрузки не заводим, readyRef поднимаем сразу. Зонд нужен,
        чтобы не растворить оверлей в НЕзагруженную фотографию; здесь под
        оверлеем стоит ровно тот кадр, который зритель видел перед тем,
        как открыть план, — он загружен по определению.
     3. Кончается это `dismiss`, а не `entered` (см. finish выше).

     Охранник flyRef — тот же, что у pick: он гасит и второй клик по
     «Закрыть», и Esc посреди нырка, и попытку выбрать зону на выходе.
     Кнопка физически перестаёт нажиматься только с приходом .leaving
     (pointer-events: none), то есть на 1390-й мс; до тех пор её держит
     этот охранник. */
  const requestClose = useCallback(() => {
    if (flyRef.current) return;
    /* Нырять нечем или некуда: плоский план (там камеры нет вовсе,
       и более долгий выход читался бы просто как задержка), план
       из подвала, Esc из экономики или FAQ, ждущая крошка возврата —
       все эти случаи вызывающий уже свёл в returnTo === null. */
    if (!returnTo || mode !== 'solid') {
      onClose('dismiss');
      return;
    }
    returningRef.current = true;
    flyRef.current = returnTo;
    setFlyTo(returnTo);
    readyRef.current = true;
    /* Потолок на случай, если сцена не доложит о фазе вовсе — потеря
       WebGL-контекста в середине перелёта. Тот же, что у pick. */
    timersRef.current.push(setTimeout(() => {
      dueRef.current = true;
      tryReveal();
    }, REVEAL_CAP_MS));
  }, [returnTo, mode, onClose, tryReveal]);

  /* Esc внутри плана делает ровно то же, что кнопка «Закрыть», — так
     просил заказчик: способ закрытия не должен менять поведение.

     ЭФФЕКТ СТОИТ ЗДЕСЬ, А НЕ ВЫШЕ, и это не вкус: он зависит от
     requestClose, а тот — от finish и tryReveal. Массив зависимостей
     вычисляется в рендере, и ссылка на объявленный ниже const дала бы
     ReferenceError по временной мёртвой зоне. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sheetOpen) return;
      e.preventDefault();
      /* stopPropagation здесь несёт вторую службу, кроме «не пускать Esc
         в офис»: на window в bubble-фазе висит тумблер, открывающий этот
         же план (OfficeHub). Событие, остановленное в capture, до bubble
         на том же window не доходит — значит Esc закроет план и не
         откроет его тут же обратно. Уберёшь — получишь мигающий оверлей. */
      e.stopPropagation();
      requestClose();
    };
    // capture: пока план открыт, Esc принадлежит ему и до офиса не доходит
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [requestClose, sheetOpen]);

  const onShotReady = useCallback(() => {
    readyRef.current = true;
    tryReveal();
  }, [tryReveal]);

  /* Кадр мог приехать ДО того, как React повесил onLoad: по наведению
     на зону работает prefetchRender, и к клику картинка обычно уже
     в кэше — событие load для неё не повторится. Тогда единственный
     честный признак — img.complete в момент появления узла. Без этой
     проверки самый частый путь (навёлся, кликнул) упирался бы
     в REVEAL_CAP_MS, и оверлей стоял бы столбом 2,6 с. */
  const probeRef = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete) onShotReady();
  }, [onShotReady]);

  /* Слежение за указателем и перетаскивание. Оба живут на поле плана
     целиком; на плоском SVG не нужны — там доворачивать нечего. */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || mode !== 'solid') return;
    // Каждое открытие плана начинается с домашней позы, а не с той,
    // в которой его закрыли в прошлый раз.
    resetPlanOrbit();

    /* Объект читаем при каждом событии, а не захватываем в замыкание.
       Разница видна только в разработке: Fast Refresh пересоздаёт модуль,
       и захваченная ссылка осталась бы на старом объекте — оболочка
       писала бы в один, сцена читала другой, и план бы замер.

       Жест заводим только для пальца и пера. У мыши доворотом и так
       управляет положение курсора: заведи ей ещё и перетаскивание —
       и на отпускании кнопки цель прыгнет со «смещения» на «позицию». */
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      gesture.current = { x: e.clientX, y: e.clientY };
      planOrbit.dragging = true;
      planOrbit.moved = 0;
    };

    const move = (e: PointerEvent) => {
      const o = planOrbit;
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
      const o = planOrbit;
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

    const leave = () => { orbitRelease(planOrbit); planOrbit.wake?.(); };

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

  /* Портал в body — см. шапку файла. document здесь заведомо есть:
     компонент приезжает через dynamic({ ssr: false }) и на сервере
     не рендерится вовсе. */
  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      className={[
        styles.root,
        /* Класс ставится только у объёмного плана: у плоского камеры нет
           и отъезжать нечем, а более долгий вход там читался бы просто
           как задержка. */
        backFrom && mode === 'solid' ? styles.backIn : '',
        leaving ? styles.leaving : '',
      ].filter(Boolean).join(' ')}
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
          {/* data-label — призрак ширины под жирное начертание ховера,
              см. .sheetLink в модуле: без него капсула на наведении
              становилась шире и толкала соседнюю. */}
          <button
            type="button"
            className={styles.sheetLink}
            data-label="Чертёж"
            onClick={() => setSheetOpen(true)}
          >
            <span className={styles.sheetLabel}>Чертёж</span>
          </button>
          {/* Панорамный тур лежит на стороне Kuula — уводить туда текущую
              вкладку нельзя, зритель не вернётся к плану. rel обязателен:
              без noopener чужая страница получает доступ к window.opener. */}
          <a
            className={styles.sheetLink}
            data-label="3D-тур"
            href={TOUR_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className={styles.sheetLabel}>3D-тур</span>
          </a>
          {/* «ЗАКРЫТЬ» ОСТАЛОСЬ ТОЛЬКО ТАМ, ГДЕ НЕТ ESC. С мышью план
              закрывают Esc-ом — тумблером, которым его и открыли, —
              и кнопка в углу лишь повторяла его, отнимая место
              у самого этажа (просьба заказчика, 5 сентября 2026).
              На тач-экране Esc нажать нечем: сними её и там —
              и план станет ловушкой, из которой один выход, в зону. */}
          {!fine && (
            <button
              type="button"
              className={styles.close}
              onClick={requestClose}
            >
              Закрыть
            </button>
          )}
        </div>
      </div>

      {/* Курсора «схватить» здесь больше нет: мышью план не таскают,
          он и так идёт за ней. Палец тащит откуда угодно, но ему курсор
          не нужен. */}
      {/* data-next — признак «в углу стоит Дальше», и читает его CSS:
          на телефоне кнопка занимает свою строку между лентой зон
          и числами, и без признака числа прыгали бы у тех, у кого
          кнопки ещё нет. Атрибутом, а не классом, — тот же приём,
          что у data-side в офисе. */}
      <div
        ref={viewRef}
        className={styles.view}
        data-next={onNext && wentInside ? '1' : undefined}
      >
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
            backFrom={backFrom}
            onPhase={onPhase}
            wobble={!calm}
            compact={calm}
          />
        )}

        {plan && mode === 'flat' && (
          <PlanFlat plan={plan} hovered={hovered} onHover={setHovered} onPick={pick} />
        )}

        {/* Подсказка. Одна строка без заголовка и без знака курсора:
            прежняя карточка с лейблом «Как смотреть» и миниатюрой
            курсора весила как самостоятельный блок и спорила с планом,
            ради которого экран и открыт (5 сентября 2026).
            pointer-events: none — плашка стоит над полем плана, а поле
            слушает доворот; ловить указатель ей нечем и незачем. */}
        {plan && !hintGone && (
          <p className={`${styles.hint} ${hintOff ? styles.hintOut : ''}`}>
            {fine ? HINT_FINE : HINT_TOUCH}
          </p>
        )}

        {/* ЗОНД ЗАГРУЗКИ, А НЕ КАРТИНКА. Виден он не бывает никогда:
            зритель смотрит фотографию в самом OfficeHub, сквозь
            растворяющийся оверлей. Здесь тот же кадр нужен ровно затем,
            чтобы поймать onLoad — по нему решается, можно ли начинать
            растворение. Запрос общий с OfficeHub (те же srcSet и sizes,
            тот же выбранный источник), второй загрузки не происходит. */}
        {arriving && (
          <picture className={styles.probe}>
            <source type="image/avif" srcSet={renderSrcSet(arriving, 'avif')} sizes="100vw" />
            <source type="image/webp" srcSet={renderSrcSet(arriving, 'webp')} sizes="100vw" />
            <img
              ref={probeRef}
              src={renderSmallest(arriving)}
              alt=""
              aria-hidden="true"
              width={RENDER_NATIVE[arriving][0]}
              height={RENDER_NATIVE[arriving][1]}
              decoding="async"
              onLoad={onShotReady}
              /* Кадр не приехал — это не повод держать зрителя
                 в оверлее: уходим, под нами всё равно офис. */
              onError={onShotReady}
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

        {/* «ДАЛЬШЕ» СТОИТ У НИЖНЕЙ КРОМКИ, НА ЛИНИИ С ЧИСЛАМИ, и
            приходит не сразу: только к тому, кто уже сходил из плана
            в зону и вернулся (см. `wentInside`). Порядок такой же,
            как у всего сайта — сначала показать, потом звать дальше.

            В шапке ей не место: там три входа в соседние окна, а это
            ход вперёд по самой странице, и стоять он должен там же,
            где стоит вся сводка об этаже. */}
        {onNext && wentInside && (
          <button type="button" className={`${styles.close} ${styles.next}`} onClick={onNext}>
            Дальше
            {/* Та же стрелка, что у индикатора «дальше» в офисе
                и у кругов перехода: одно движение — один рисунок. */}
            <ArrowDown size={15} />
          </button>
        )}

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
    </div>,
    document.body,
  );
}
