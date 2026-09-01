'use client';

/* iCITY 113Н — первый экран: hero-видео полёта к башне.
   Путь в проекте: components/HeroVideo.tsx

   ЧТО ЭТО. Постер облачного моря (кадр f_0001 рендера), сверху копия,
   по центру кнопка «Войти». Клик — видео проигрывается один раз вперёд,
   без скраба и перемотки, аппаратным декодером браузера. С отметки
   LIFT_START (камера начинает уходить вверх) компонент через onLift
   отдаёт прогресс выезда ресепшна, к концу ролика прогресс равен 1.
   По окончании — onDone, и HeroGate размонтирует весь первый экран.
   Вернуться сюда нельзя иначе как перезагрузкой страницы.

   СИНХРОНИЗАЦИЯ ТОЛЬКО ОТ video.currentTime. Никаких таймеров-хронометров:
   вкладка может уйти в фон, декодер — замяться на буферизации, и любой
   параллельный отсчёт разъехался бы с картинкой. Один rAF на компонент,
   каждый тик читает currentTime и пишет прогресс — та же дисциплина
   «один rAF → одна огибающая», на которой стоит OfficeStop.

   ТАЙМЕРЫ ЗДЕСЬ — ТОЛЬКО АВАРИЙНЫЕ. PLAY_TIMEOUT_MS не ведёт анимацию,
   а страхует одно: клик был, а `playing` так и не наступило (медленная
   сеть, iOS не стал качать preload до жеста). Тогда честный мгновенный
   свап на ресепшн — постер вместо чёрного экрана до последнего.

   ДВА ВИДЕО × ДВА КОДЕКА. Десктоп 2560×1440, мобильный портрет 1080×1920;
   выбор — по ориентации один раз при монтировании (смена ориентации во
   время жизни hero видео не пересоздаёт: object-fit: cover прикрывает).
   Внутри каждого варианта два кодека: HEVC (hvc1, вдвое легче) и H.264
   (играет везде). codecs-строки сняты ffprobe с реальных файлов, и
   неподдерживаемый кодек отсекается до единого байта загрузки — тем же
   canPlayType, которым браузер отбирает <source type> (lib/heroPreload.ts).

   IDLE-ЛУП И КРОССФЕЙД. До клика бесконечно крутится луп облаков
   (480 кадров, 20,0 с, бесшовный: последний кадр равен первому). По клику
   ролик стартует, и ЗА CROSS_MS ролик проявляется ПОВЕРХ ещё играющего
   лупа. Затемнения нет и быть не может: нижний слой всё это время
   непрозрачен, композит в любой момент — смесь двух готовых кадров,
   а не смесь кадра с фоном. Гасить луп одновременно с проявлением ролика
   было бы ошибкой ровно в эту сторону — на середине проступил бы --paper.
   Луп ставится на паузу и снимается из потока ПОСЛЕ кроссфейда.

   Кадр лупа и кадр ролика сняты одной камерой, но луп к моменту клика
   стоит на произвольной секунде своих двадцати — облака успели уплыть.
   Поэтому переход именно растворение, а не стык: 250 мс закрывают дрейф.

   ОТКУДА БЕРУТСЯ ФАЙЛЫ. Не сам <video>, а lib/heroPreload.ts: он качает
   оба файла fetch-ем со счётчиком байт (лифт прелоадера едет по ним) и
   отдаёт готовые blob-URL. К клику ролик в памяти целиком — встать на
   буферизации посреди полёта он не может. Если fetch не задался,
   heroPreload поднимает failed, и здесь рисуется прежняя разметка
   с парой <source>: HEVC, потом H.264.

   REDUCED-MOTION. Ни одно видео не монтируется вовсе — ноль байт
   трафика. «Войти» делает мгновенный свап на ресепшн. */

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react';
import {
  getCurtainServerSnapshot, getCurtainSnapshot, openCurtain, subscribeCurtain,
} from '@/lib/curtain';
import { setCursorVideo } from '@/lib/cursorMode';
import {
  currentHeroVariant, heroPreloadServerSnapshot, heroPreloadSnapshot,
  releaseHeroPreload, SOURCES, startHeroPreload, subscribeHeroPreload,
  type HeroVariant,
} from '@/lib/heroPreload';
import styles from './HeroVideo.module.css';

/* U+202F, узкий неразрывный: число с единицей и разряды (AGENTS.md).
   Экранированной последовательностью, а не литералом — литерал
   не переживает перенос файла между редакторами. */
const NBSP = ' ';

/* Страховка на сигнал занавеса: копия первого экрана обязана появиться,
   даже если прелоадер до openCurtain() не дошёл — его сняли из layout,
   sessionStorage бросил исключение, эффект не отработал.
   ЧИСЛО ОБЯЗАНО БЫТЬ БОЛЬШЕ САМОГО ДОЛГОГО ЗАКОННОГО ПУТИ ПРЕЛОАДЕРА,
   иначе страховка выстрелит раньше настоящего сигнала и проявление
   отыграет за ещё закрытыми створками — ровно та беда, ради которой
   заведён lib/curtain.ts. Потолок прелоадера: предохранитель 8 с плюс
   стоянка на 23-м 1 с = 9 с (Preloader.tsx, MAX_MS и HOLD_23_MS).
   Отсюда 11 с. Правишь там — правь здесь.
   Та же дисциплина, что у PLAY_TIMEOUT_MS: у любого отказа есть выход. */
const CURTAIN_FALLBACK_MS = 11000;

/* Гашение амбиента к финалу ролика, в секундах currentTime. */
const AUDIO_FADE_S = 0.9;

/* ЗАГОЛОВОК ПРОЯВЛЯЕТСЯ ПОБУКВЕННО И ВРАЗНОБОЙ.
   Замерено покадрово по референсу в нативном разрешении (метрика —
   контраст глифа против фона внутри его же коробки, она переживает
   дрейф облаков). Середины проявления высококонтрастных букв:
     B 1779 · A 1952 · T 1952 · E 2001 · O 2075 · V 2149 · H 2149
   Порядок не слева направо и не построчно: первой идёт B, последними
   V, E, H. Разброс середин ~370 мс при длительности буквы ~1,8 с —
   поэтому на глаз он читается как «текст проявляется целиком», и
   именно так его легко проглядеть на уменьшенных кадрах.
   Строки разбиты руками, а не по ширине: это композиция, а не вёрстка. */
const TITLE_LINES = ['В самом', 'центре', 'деловой Москвы'] as const;

/* Псевдослучайная задержка буквы, 0..1.
   ДЕТЕРМИНИРОВАННАЯ НАРОЧНО: сервер и клиент обязаны получить одно
   и то же число, иначе гидрация разъедется на каждой букве. Отсюда
   только 32-битная целочисленная арифметика — она специфицирована
   точно и одинакова во всех движках. Math.random() здесь нельзя
   вообще, а Math.sin() нельзя потому, что его последние биты
   у движков расходятся. */
const scatter = (i: number): number => {
  let h = Math.imul(i + 1, 2654435761);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 997) / 997;
};

/* Амбиент первого экрана — ветер на высоте.
   В четырёх mp4 полёта звуковой дорожки нет (ffprobe: только video-поток),
   а пережимать их нельзя: вес и качество утверждены, и каждый заезд mp4
   остаётся в истории git навсегда (AGENTS.md, «Hero-видео»). Поэтому звук
   едет отдельным <audio> и синхронизируется от того же video.currentTime,
   что и всё остальное.

   Источник: freesound.org/s/570890 «wind_synth_high_altitude», CC0
   (public domain, атрибуция не требуется). Синтезированный, а не полевая
   запись, — поэтому чистый, без птиц и трафика.

   ВЗЯТО С САМОГО НАЧАЛА ТРЕКА, 0–10,5 с: заказчик просил, чтобы мелодия
   шла с нуля видео, а не с середины дорожки. Начало и оказалось лучшим
   участком — его собственная форма ровно та, что нужна: тихий старт,
   мягкий подъём к 6-й секунде и спад к 8–10-й, то есть звук сам
   успокаивается ровно там, где камера идёт вверх. Никакого всплеска
   на финале, в отличие от прежнего окна.

   dynaudnorm=f=500:g=31:p=0.85 — умеренный, только чтобы подтянуть
   тихое начало (сырое −35 дБ на первой секунде было почти не слышно,
   стало −27) и не задавить при этом спад к финалу. Вход 0,25 с —
   лишь чтобы не щёлкнуло: длинный фейд отодвинул бы мелодию от нуля,
   а её просили именно с нуля.

   Профиль итога по секундам, уровень / выше 3 кГц:
     0 −27,1/−72,8   3 −24,5/−64,5   6 −23,3/−57,8 (пик)
     7 −24,8/−60,7   8 −25,8/−60,6   9 −26,1/−64,4  ← камера вверх
   Перерендерят амбиент — снимать этот же посекундный профиль, а не
   только интегральную громкость: всплеск она не показывает вовсе.

   Opus первым, AAC вторым: браузер берёт первый поддержанный, и Chrome
   с Firefox получают файл вдвое легче, а Safari честно откатывается
   на m4a. */
const AMBIENCE: readonly { src: string; type: string }[] = [
  { src: '/audio/icity_hero_ambience.ogg', type: 'audio/ogg; codecs="opus"' },
  { src: '/audio/icity_hero_ambience.m4a', type: 'audio/mp4; codecs="mp4a.40.2"' },
];

/* Базовая громкость амбиента. Файл собран на −23 LUFS, это уже фоновый
   уровень; ручка здесь — чтобы правку громкости не приходилось гнать
   через перекодирование.
   0.17 — втрое тише прежних 0.5 по просьбе заказчика, суммарно −15,4 дБ
   от единицы. Множитель линейный по амплитуде, а не по ощущению:
   на слух это примерно вдвое тише, чем было. */
const AMBIENCE_VOLUME = 0.17;

/* Отметки ролика — в КАДРАХ, не в округлённых секундах. Рендер v3:
   24 fps, 235 кадров. На кадре 185 камера входит в «трамплин» и
   начинает поднимать взгляд — с него едет занавес ресепшна. Финал
   наступает на duration, к нему прогресс дотягивается ровно до 1.
   Перерендерят ролик — правятся два целых числа ниже, и вся остальная
   цепочка (rAF → --hero-lift → transform) нового тайминга не знает. */
const FPS = 24;
const LIFT_START_FRAME = 185;
const TOTAL_FRAMES = 235;
/** секунда начала выезда занавеса: 185/24 = 7,708 с */
const LIFT_START = LIFT_START_FRAME / FPS;
/** длительность 235/24 = 9,792 с; живая берётся из метаданных, это фолбэк */
const FALLBACK_DURATION = TOTAL_FRAMES / FPS;
/** аварийный выход: клик был, `playing` не наступило */
const PLAY_TIMEOUT_MS = 4000;

const POSTER_DIR = '/video/poster';
/** ширины постеров — сверять с public/video/poster/manifest.json */
const POSTER_DESKTOP = [1280, 1920, 2560] as const;
const POSTER_MOBILE = [640, 1080] as const;

/* Таблица источников и codecs-строки — в lib/heroPreload.ts: там же
   их читает загрузчик, а два списка одних и тех же файлов разъехались бы
   при первой правке. */
type VariantKey = HeroVariant;

/* Кроссфейд лупа в ролик. Пара к --t-hero-cross в tokens.css: здесь число
   решает, когда снять луп из потока, там — за сколько проявить ролик.
   Правишь одно — правь второе. */
const CROSS_MS = 250;
/* Запас на кадр композитора: снимать луп ровно в миллисекунду конца
   перехода нельзя — округление вниз оставило бы ролик на 0,99
   непрозрачности над голым постером на один кадр. Та же дисциплина,
   что у «1550 = 1400 + запас» в Preloader.tsx. */
const CROSS_GUARD_MS = 80;

const posterSrcSet = (key: 'hero-desktop' | 'hero-mobile', widths: readonly number[], ext: 'avif' | 'webp') =>
  widths.map((w) => `${POSTER_DIR}/${key}-${w}.${ext} ${w}w`).join(', ');

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const easeInOutCubic = (t: number) =>
  (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

/* Ориентация. До клика вариант живой: окно могло открыться в переходном
   размере (сплит-скрин, панель превью), и замерять его один раз навсегда
   нельзя. Поворот до клика пересоздаёт <video> через key и перезапускает
   preload — редкий случай, лишние мегабайты дешевле неправильного кадра.
   В момент «Войти» вариант замораживается: рестартовать играющий ролик
   из-за поворота нельзя, object-fit: cover прикрывает. */
const ORIENTATION_QUERY = '(orientation: portrait)';
const subscribeOrientation = (onChange: () => void) => {
  const mq = window.matchMedia(ORIENTATION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getPortraitSnapshot = () => window.matchMedia(ORIENTATION_QUERY).matches;
const getPortraitServerSnapshot = () => false;

const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const getMotionSnapshot = () => window.matchMedia(MOTION_QUERY).matches;
const getMotionServerSnapshot = () => false;

type Props = {
  /** прогресс выезда ресепшна 0→1; пишется из rAF, без ре-рендеров */
  onLift: (lift: number) => void;
  /** финал (или авария): HeroGate размонтирует hero и отпускает страницу */
  onDone: () => void;
};

export default function HeroVideo({ onLift, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  /** выбор звука, сделанный кнопкой входа; читается из rAF */
  const soundOnRef = useRef(false);
  const rafRef = useRef(0);
  const failTimerRef = useRef(0);
  const crossTimerRef = useRef(0);
  const doneRef = useRef(false);
  /** ошибка загрузки/декодирования основного ролика до клика */
  const brokenRef = useRef(false);

  const reduced = useSyncExternalStore(
    subscribeMotion,
    getMotionSnapshot,
    getMotionServerSnapshot,
  );

  const portrait = useSyncExternalStore(
    subscribeOrientation,
    getPortraitSnapshot,
    getPortraitServerSnapshot,
  );

  /* Занавес прелоадера. Один переход false → true за загрузку страницы,
     один ре-рендер: дальше проявление ведёт CSS, React не участвует. */
  const curtain = useSyncExternalStore(
    subscribeCurtain,
    getCurtainSnapshot,
    getCurtainServerSnapshot,
  );
  /* после клика вариант заморожен, до — следует за ориентацией */
  const [lockedVariant, setLockedVariant] = useState<VariantKey | null>(null);
  const variant: VariantKey = lockedVariant ?? (portrait ? 'mobile' : 'desktop');

  /* Готовые blob-URL обоих файлов (или failed — тогда старая разметка
     с <source>). Переходов за жизнь первого экрана три-четыре, не больше;
     байты сюда не приходят вовсе — их читает прелоадер императивно. */
  const preload = useSyncExternalStore(
    subscribeHeroPreload,
    () => heroPreloadSnapshot(variant),
    heroPreloadServerSnapshot,
  );

  /* fetch не задался — возвращаемся к прежней разметке с <source>.
     Кнопку в этом случае не держим: готовность считает сам браузер,
     а страхует её PLAY_TIMEOUT_MS, как и до этой правки. */
  const legacy = preload.failed;

  /* «Войти» заперт, пока ролик не лёг в память целиком. Клик раньше
     времени привёл бы ровно к тому, ради чего всё затевалось, — к паузе
     на буферизации посреди полёта. */
  const waiting = !reduced && !legacy && preload.flightUrl === null;

  const [started, setStarted] = useState(false);
  const [playingVisible, setPlayingVisible] = useState(false);
  const [idleBroken, setIdleBroken] = useState(false);
  /* Луп снят из потока — ставится через CROSS_MS после старта ролика. */
  const [idleGone, setIdleGone] = useState(false);

  /* Загрузка нужного варианта. Идемпотентно: прелоадер уже позвал это же
     на монтировании layout. Второй вызов случается ровно в двух случаях —
     прелоадера не было (вторая загрузка во вкладке) и поворот экрана
     до клика попросил другой вариант. */
  useEffect(() => {
    if (reduced) return;
    /* Вариант спрашивается у matchMedia, а не берётся из `variant`:
       на гидрационном проходе тот ещё равен серверному 'desktop', и
       телефон начал бы качать десктопную пару. Подробности — там же,
       где живёт currentHeroVariant. */
    startHeroPreload(currentHeroVariant());
  }, [reduced, variant]);

  /* Страховка: hero сняли, не пройдя через finish (быстрый уход
     со страницы, горячая перезагрузка). Белая точка иначе осталась бы
     на обычной странице. */
  useEffect(() => () => setCursorVideo(false), []);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    /* Курсор обратно в обычный вид. Здесь, а не в обработчике ended:
       сюда сходятся все пять отказов, и белая точка не должна пережить
       ни один из них. */
    setCursorVideo(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (failTimerRef.current) window.clearTimeout(failTimerRef.current);
    if (crossTimerRef.current) window.clearTimeout(crossTimerRef.current);
    /* Снятие <audio> из DOM не глушит воспроизведение надёжно — гасим
       явно, и здесь, потому что сюда сходятся все пять отказов. */
    audioRef.current?.pause();
    onDone();
  }, [onDone]);

  /* Один rAF на весь полёт. Каждый тик: прогресс из currentTime,
     сглаживание easeInOutCubic — выезд стартует и финиширует мягко,
     в темпе «трамплина» камеры. Проверка v.ended прямо в тике —
     страховка на случай проглоченного события ended. Проверка v.paused —
     самовосстановление: браузер умеет глушить видео сам (энергосбережение,
     скрытая вкладка, iOS Low Power Mode), и без неё полёт замирал бы
     навсегда на полпути. */
  const startTicking = useCallback(() => {
    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const duration = Number.isFinite(v.duration) && v.duration > 0
        ? v.duration
        : FALLBACK_DURATION;
      const p = clamp01((v.currentTime - LIFT_START) / (duration - LIFT_START));
      onLift(easeInOutCubic(p));
      /* Амбиент гаснет к финалу тем же currentTime, что ведёт выезд.
         Отдельного таймера нет нарочно: вкладка в фоне разъехалась бы
         с картинкой — та же причина, по которой весь полёт считается
         от currentTime. Одна запись свойства на кадр, ре-рендеров нет. */
      const a = audioRef.current;
      if (a && soundOnRef.current) {
        const left = duration - v.currentTime;
        a.volume = AMBIENCE_VOLUME
          * (left < AUDIO_FADE_S ? clamp01(left / AUDIO_FADE_S) : 1);
      }
      if (v.ended) { finish(); return; }
      if (v.paused) v.play().catch(finish);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [onLift, finish]);

  /* ВНИМАНИЕ при правке вызовов: onClick={enter} передал бы сюда
     MouseEvent — истинный объект, и любой клик уехал бы «со звуком».
     Обе кнопки зовут enter через стрелку, с явным аргументом. */
  const enter = useCallback((withSound: boolean) => {
    if (started || doneRef.current) return;
    setStarted(true);
    setLockedVariant(variant);
    soundOnRef.current = withSound;

    /* Звук разблокируется ТОЛЬКО синхронно внутри жеста. Вызов из
       onPlaying уже вне жеста — Safari и iOS его отклонят, и полёт
       уедет молча. Поэтому audio.play() стоит здесь, рядом с
       video.play(), а его reject проглатывается: молчащий первый экран
       лучше сорванного полёта. В цепочку отказов видео звук не входит. */
    const a = audioRef.current;
    if (withSound && a) {
      a.volume = AMBIENCE_VOLUME;
      a.currentTime = 0;
      a.play().catch(() => {});
    }

    const v = videoRef.current;
    if (reduced || !v || brokenRef.current) { finish(); return; }

    /* Луп НЕ глушится здесь: он держит непрозрачную картинку под роликом,
       пока тот проявляется. Гасить его в этот момент — и есть тот самый
       провал в --paper, которого быть не должно. Снимет его onPlaying,
       через CROSS_MS после того, как ролик реально пошёл. */
    failTimerRef.current = window.setTimeout(finish, PLAY_TIMEOUT_MS);
    v.play().catch(finish);
  }, [started, reduced, finish, variant]);

  /* Прогрев амбиента по наведению и фокусу: preload="none" держит его
     вне бюджета первого экрана, а к клику файл уже едет. На тач-экране
     наведения нет, и загрузка стартует с клика — ролик идёт 9,8 с,
     сотня-другая килобайт успевает задолго до того, как понадобится. */
  const warmAmbience = useCallback(() => {
    const a = audioRef.current;
    if (a && a.preload === 'none') { a.preload = 'auto'; a.load(); }
  }, []);

  const onPlaying = useCallback(() => {
    if (doneRef.current) return;
    if (failTimerRef.current) window.clearTimeout(failTimerRef.current);
    /* Точка отсчёта кроссфейда — именно `playing`, а не клик: между ними
       у декодера свои несколько кадров, и начни растворение раньше —
       ролик проявлялся бы, ещё не начав двигаться. */
    setPlayingVisible(true);
    /* Курсор на время полёта — одна белая точка без кольца. Отсчёт
       от `playing`, а не от клика, по той же причине, что и кроссфейд:
       до него ролик ещё не двигается. */
    setCursorVideo(true);
    crossTimerRef.current = window.setTimeout(() => {
      idleRef.current?.pause();
      setIdleGone(true);
    }, CROSS_MS + CROSS_GUARD_MS);
    startTicking();
  }, [startTicking]);

  /* Ошибка ролика. До клика — запоминаем и молчим (постер на месте,
     «Войти» сделает мгновенный свап); после клика — сразу финал. */
  const onVideoError = useCallback(() => {
    brokenRef.current = true;
    if (started) finish();
  }, [started, finish]);

  const onIdleError = useCallback(() => setIdleBroken(true), []);

  /* Отказы загрузки слушаем нативно. Событие error у не подошедшего
     <source> не всплывает, и React-овский onError на нём не срабатывает —
     проверено: без этих слушателей idle-элемент с 404 висел бы в DOM
     вечно. «Ни один источник не подошёл» приходит на ПОСЛЕДНИЙ source. */
  useEffect(() => {
    const wire = (el: HTMLVideoElement | null, onErr: () => void) => {
      if (!el) return () => {};
      /* Отказ мог случиться до подписки — NETWORK_NO_SOURCE это фиксирует.
         Но одного этого значения мало: у ТОЛЬКО ЧТО смонтированного
         элемента оно стоит транзитом, пока алгоритм выбора источника
         не дошёл до <source>. Мобильный ловил транзит железно: серверный
         снимок ориентации всегда 'desktop', гидрация переключает вариант
         на 'mobile', key пересоздаёт <video> — и эффект читал свежий
         элемент ровно в эту щель (замерено: 308 мс — NO_SOURCE, 312 мс —
         уже LOADING, 371 мс — readyState 4). Ролик считался битым, клик
         «Войти» уходил в аварийный свап, и полёта на телефоне не было
         вообще. Транзит от настоящего отказа отличает currentSrc: у
         сломанного элемента там лежит последний испробованный файл,
         у транзитного он пуст — источник ещё не выбирали.
         Ошибиться в эту сторону безопасно: пропущенный отказ поймает
         либо подписка ниже, либо reject у play() в enter(). */
      if (el.networkState === el.NETWORK_NO_SOURCE && el.currentSrc !== '') {
        onErr();
        return () => {};
      }
      const last = el.querySelector('source:last-of-type');
      el.addEventListener('error', onErr);
      last?.addEventListener('error', onErr);
      return () => {
        el.removeEventListener('error', onErr);
        last?.removeEventListener('error', onErr);
      };
    };
    const unIdle = wire(idleRef.current, onIdleError);
    const unMain = wire(videoRef.current, onVideoError);
    return () => { unIdle(); unMain(); };
  }, [
    variant, reduced, idleBroken, legacy,
    preload.idleUrl, preload.flightUrl, onIdleError, onVideoError,
  ]);

  /* Амбиент качается, как только открылся занавес, — не по наведению.
     Мелодия должна звучать С НУЛЯ ролика, а грузиться ей 72 КБ: если
     ждать клика, звук отстаёт от картинки (замер: видео 2,01 с, звук
     1,80 с — старт на пятую секунды позже). Наведения мало, на тач-
     экранах его нет вовсе. Занавес — правильный момент: к нему оба
     видео уже скачаны прелоадером, критический путь свободен, а до
     клика остаётся минимум секунда. */
  useEffect(() => {
    if (curtain) warmAmbience();
  }, [curtain, warmAmbience]);

  /* Страховка занавеса: если сигнал не пришёл, копия обязана появиться
     сама — иначе первый экран остался бы пустым навсегда. */
  useEffect(() => {
    if (curtain) return undefined;
    const t = window.setTimeout(openCurtain, CURTAIN_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [curtain]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (failTimerRef.current) window.clearTimeout(failTimerRef.current);
    if (crossTimerRef.current) window.clearTimeout(crossTimerRef.current);
    audioRef.current?.pause();
    /* Только с настоящего размонтирования, после финала: doneRef отсекает
       двойное монтирование StrictMode, иначе URL отобрались бы у живого
       плеера ещё до первого клика. */
    if (doneRef.current) releaseHeroPreload();
  }, []);

  const sources = SOURCES[variant];

  return (
    <section className={styles.hero} aria-label="Вход: полёт к башне">
      {/* Постер = кадр f_0001 ролика: старт видео с него неотличим.
          Ориентация решается медиа-атрибутом, JS не нужен. */}
      <picture className={styles.poster}>
        <source media="(orientation: portrait)" type="image/avif" srcSet={posterSrcSet('hero-mobile', POSTER_MOBILE, 'avif')} sizes="100vw" />
        <source media="(orientation: portrait)" type="image/webp" srcSet={posterSrcSet('hero-mobile', POSTER_MOBILE, 'webp')} sizes="100vw" />
        <source type="image/avif" srcSet={posterSrcSet('hero-desktop', POSTER_DESKTOP, 'avif')} sizes="100vw" />
        <source type="image/webp" srcSet={posterSrcSet('hero-desktop', POSTER_DESKTOP, 'webp')} sizes="100vw" />
        <img
          src={`${POSTER_DIR}/hero-desktop-${POSTER_DESKTOP[0]}.webp`}
          alt=""
          draggable={false}
          decoding="async"
          fetchPriority="high"
        />
      </picture>

      {/* Idle-луп: облака живут до клика и ещё CROSS_MS после него —
          пока ролик проявляется поверх. Потом idleGone снимает его
          из потока: декодировать 20 с облаков за кадром полёта незачем.
          Обычный путь — готовый blob из heroPreload; legacy — прежняя
          пара <source>, если fetch не задался. */}
      {!reduced && !idleBroken && !idleGone && (preload.idleUrl || legacy) && (
        <video
          key={`idle-${variant}-${preload.idleUrl ? 'blob' : 'src'}`}
          ref={idleRef}
          className={styles.idle}
          src={preload.idleUrl ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          onError={onIdleError}
        >
          {legacy && (
            <>
              <source src={sources.idle[0].src} type={sources.idle[0].type} />
              <source src={sources.idle[1].src} type={sources.idle[1].type} onError={onIdleError} />
            </>
          )}
        </video>
      )}

      {/* Основной ролик. Появляется в разметке уже готовым: blob-URL
          выдаётся, когда файл скачан целиком, — полёт начинается без
          паузы и не может встать посреди. HEVC-версии лёгкие: 2,5 МБ
          десктоп, 1,8 МБ мобильный. */}
      {!reduced && (preload.flightUrl || legacy) && (
        <video
          key={`flight-${variant}-${preload.flightUrl ? 'blob' : 'src'}`}
          ref={videoRef}
          className={`${styles.video} ${playingVisible ? styles.videoOn : ''}`}
          src={preload.flightUrl ?? undefined}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          onPlaying={onPlaying}
          onEnded={finish}
          onError={onVideoError}
        >
          {legacy && (
            <>
              <source src={sources.flight[0].src} type={sources.flight[0].type} />
              <source src={sources.flight[1].src} type={sources.flight[1].type} onError={onVideoError} />
            </>
          )}
        </video>
      )}

      {/* Амбиент отдельным элементом, не дорожкой в mp4: ролики
          пережимать нельзя. preload="none" — вне бюджета первого
          экрана, прогрев по наведению на «Войти». */}
      {!reduced && (
        <audio ref={audioRef} preload="none" aria-hidden="true">
          {AMBIENCE.map((s) => <source key={s.src} src={s.src} type={s.type} />)}
        </audio>
      )}

      <div
        className={[
          styles.overlay,
          curtain ? styles.revealed : '',
          playingVisible ? styles.overlayOff : '',
        ].filter(Boolean).join(' ')}
      >
        <div className={styles.stack}>
          {/* Знак-столбик: те же три факта, что стояли одной строкой,
              разложенные в три — как «111 / W / 57» в референсе.
              text-transform нет нарочно: он превратил бы бренд в «ICITY». */}
          <p className={styles.mark}>
            iCITY
            <br />
            SPACE TOWER
            <br />
            23{NBSP}ЭТАЖ
          </p>

          {/* Заголовок разбит на буквы: каждая проявляется со своей
              задержкой, вразнобой — так в референсе (замеры выше).
              Разбивка ЧИСТО ВИЗУАЛЬНАЯ: для скринридера рядом лежит
              обычная фраза, а россыпь span-ов скрыта aria-hidden —
              иначе VoiceOver прочёл бы заголовок по буквам.
              В разметке текст строчный, заглавные делает CSS по той же
              причине: в DOM должна остаться нормальная фраза. */}
          <h1 className={styles.title}>
            <span className={styles.sr}>В самом центре деловой Москвы</span>
            <span aria-hidden="true">
              {(() => {
                let n = 0;
                return TITLE_LINES.map((line) => (
                  <span className={styles.titleLine} key={line}>
                    {[...line].map((ch, ci) => (ch === ' ' ? (
                      <span className={styles.titleSpace} key={ci}>&nbsp;</span>
                    ) : (
                      <span
                        className={styles.titleChar}
                        key={ci}
                        style={{ '--d': scatter(n++) } as CSSProperties}
                      >
                        {ch}
                      </span>
                    )))}
                  </span>
                ));
              })()}
            </span>
          </h1>

          {/* Абзац выезжает СНИЗУ ВВЕРХ ИЗ-ПОД МАСКИ, строка за строкой —
              так в референсе. Каждая строка живёт в своём overflow: hidden,
              внутренний span стартует ниже маски и поднимается на место:
              на середине видны только верхушки букв, обрезанные снизу
              краем маски. Отсюда двухслойная разметка — маску и сдвиг
              нельзя повесить на один узел, overflow обрезал бы сам себя.
              Строки разбиты руками, а не <br>: каждой нужна своя маска. */}
          <p className={styles.lead}>
            {[
              `244,1${NBSP}м² с отделкой от PRIDEX.`,
              'Место, где решения становятся масштабными',
            ].map((line, i) => (
              <span className={styles.leadLine} key={line}>
                <span
                  className={styles.leadInner}
                  style={{ '--i': i } as CSSProperties}
                >
                  {line}
                </span>
              </span>
            ))}
          </p>

          {/* Кнопка заперта, пока ролик не догрузился: предохранитель
              прелоадера на 8 с уводит створки раньше, чем приезжает
              ролик, и без замка первый же клик встал бы на буферизации.
              Индикатор — мягкая полоса по нижней кромке, не спиннер:
              спиннера в системе нет, а полоса — та же рельса, что
              у лифта. Надпись НЕ гасится: --ink на этом постере
              единственный проходящий по контрасту цвет. */}
          <div className={styles.actions}>
            <button
              type="button"
              className={[
                'btn', styles.enterBtn, waiting ? styles.enterWaiting : '',
              ].filter(Boolean).join(' ')}
              onClick={() => enter(true)}
              onPointerEnter={warmAmbience}
              onFocus={warmAmbience}
              disabled={started || waiting}
              aria-busy={waiting}
            >
              <span className={styles.enterFill} aria-hidden="true" />
              <span className={styles.enterLabel}>
                <span className={styles.enterLabelDefault}>Войти</span>
                <span className={styles.enterLabelHover} aria-hidden="true">Войти</span>
              </span>
              <span className={styles.enterWait} aria-hidden="true" />
            </button>
            <p className={styles.sr} role="status">
              {waiting ? 'Ролик загружается' : 'Вход готов'}
            </p>
          </div>
        </div>

        {/* Выбор звука — второй вход, а не переключатель: клик по нему
            и есть тот жест, внутри которого браузер разрешает звук.
            Одно решение — один жест, лишнего состояния между ними нет. */}
        {!reduced && (
          <div className={styles.sound}>
            <button
              type="button"
              className={styles.mute}
              onClick={() => enter(false)}
              disabled={started || waiting}
              aria-busy={waiting}
            >
              {/* Только текст с подчёркиванием, как в референсе. Иконки
                  и круга нет нарочно: круг читался как вторая кнопка
                  рядом с «Войти», хотя это вход того же веса, только
                  тише. Подчёркивание живёт на внутреннем span, а не на
                  кнопке: у кнопки 44 px цели нажатия, и линия по её
                  нижней кромке висела бы заметно ниже текста. */}
              <span className={styles.muteLabel}>Войти без звука</span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
