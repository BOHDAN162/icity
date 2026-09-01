/* iCITY 113Н — загрузка двух видео первого экрана с честным счётчиком байт.
   Путь в проекте: lib/heroPreload.ts

   ЗАЧЕМ. Лифт прелоадера (1→23) обязан отражать реальную загрузку, а не
   таймер. Байтового прогресса у <video> нет вообще: наружу торчит только
   `buffered` — диапазоны ВРЕМЕНИ. У ролика полёта битрейт гуляет в разы
   (ровные облака против города в кадре), и «половина секунд» там и близко
   не «половина байт». Поэтому файлы качает fetch со стримом, считает
   прочитанные байты, и уже собранный Blob отдаётся в <video src>.

   ПОЧЕМУ ЭТО НЕ НАРУШАЕТ ПРАВИЛО «КОДЕК ВЫБИРАЕТ БРАУЗЕР». Смысл того
   правила — не скачать ни байта неподдерживаемого кодека; выбор по
   <source type> был лишь способом. Здесь тот же тест делается явно:
   canPlayType() с теми же codecs-строками — это ровно та функция, которой
   браузер отсеивает <source>. Строки остались единственным источником
   правды и лежат тут же, в SOURCES.

   ОТКАЗ ВЕДЁТ НА СТАРУЮ ДОРОГУ. Любая беда с fetch (сеть, CSP, нет
   ReadableStream, битый ответ) поднимает `failed`, и HeroVideo рисует
   сегодняшнюю разметку с двумя <source> — то есть поведение ровно до этой
   правки, — а прелоадер возвращается на таймер. Ни один отказ не оставляет
   первый экран без видео.

   ПАМЯТЬ. Оба файла целиком живут в Blob: 3,1 МБ на десктопе с HEVC,
   10,4 МБ у браузера без HEVC (Firefox). Взамен — гарантия, по которой
   и затевалось всё остальное: к клику файл в памяти целиком, полёт не
   может встать на буферизации посреди кадра.

   ВАРИАНТ НЕ ОДИН. Кэш по ключу 'desktop' | 'mobile': поворот телефона до
   клика просит второй вариант, и он поедет отдельно. Первый при этом
   остаётся в памяти — возврат в прежнюю ориентацию бесплатен.

   ДВА КАНАЛА НАРУЖУ, И ЭТО НАРОЧНО. Байты капают десятками чанков
   в секунду; будить ими React — это ре-рендер на чанк. Поэтому байты
   читаются императивно (progressOf, зовётся из rAF прелоадера), а
   подписка дёргается только на переходах состояния: появился URL, случился
   отказ. Тот же приём и та же дисциплина, что в lib/curtain.ts. */

export type HeroVariant = 'desktop' | 'mobile';

type Codec = { readonly src: string; readonly type: string };

/* codecs-строки — с реальных файлов (ffprobe): HEVC Main@L5.0 у десктопа,
   Main@L4.0 у мобильного, H.264 High@L5.0 у обоих. Idle-луп собран тем же
   конвейером и попадает в те же профили — проверено ffprobe: 480 кадров,
   20,000 с, 24 fps, yuv420p, bt709, moov в начале файла.
   Порядок внутри пары значим: HEVC первым, H.264 фолбэком. */
const VIDEO_DIR = '/video';

export const SOURCES: Record<HeroVariant, {
  readonly flight: readonly Codec[];
  readonly idle: readonly Codec[];
}> = {
  desktop: {
    flight: [
      { src: `${VIDEO_DIR}/icity_desktop_2560x1440_hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L150.B0"' },
      { src: `${VIDEO_DIR}/icity_desktop_2560x1440_h264.mp4`, type: 'video/mp4; codecs="avc1.640032"' },
    ],
    idle: [
      { src: `${VIDEO_DIR}/icity_idle_desktop_hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L150.B0"' },
      { src: `${VIDEO_DIR}/icity_idle_desktop_h264.mp4`, type: 'video/mp4; codecs="avc1.640032"' },
    ],
  },
  mobile: {
    flight: [
      { src: `${VIDEO_DIR}/icity_mobile_1080x1920_hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L120.B0"' },
      { src: `${VIDEO_DIR}/icity_mobile_1080x1920_h264.mp4`, type: 'video/mp4; codecs="avc1.640032"' },
    ],
    idle: [
      { src: `${VIDEO_DIR}/icity_idle_mobile_hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L120.B0"' },
      { src: `${VIDEO_DIR}/icity_idle_mobile_h264.mp4`, type: 'video/mp4; codecs="avc1.640032"' },
    ],
  },
};

/* Тот же тест, которым браузер отбирает <source type>. 'probably' — кодек
   разобран и поддержан, 'maybe' — MIME знаком, а codecs-строку движок
   не разбирал. Берём первый уверенный; если уверенных нет — первый
   «может быть»; если и таких нет — последний в списке, то есть H.264,
   вслепую: пусть решает декодер, это всё равно лучше, чем не показать
   ничего. Пустая строка — честное «не умею», такой файл не качаем. */
function pickCodec(list: readonly Codec[]): Codec {
  const probe = document.createElement('video');
  const probably = list.find((c) => probe.canPlayType(c.type) === 'probably');
  if (probably) return probably;
  const maybe = list.find((c) => probe.canPlayType(c.type) === 'maybe');
  if (maybe) return maybe;
  return list[list.length - 1];
}

type FileState = {
  loaded: number;
  /** байт всего; 0 — Content-Length не пришёл, прогресс не считается */
  total: number;
  url: string | null;
};

type Entry = {
  idle: FileState;
  flight: FileState;
  /** fetch-дорога непригодна: HeroVideo возвращается к <source> */
  failed: boolean;
  started: boolean;
};

const cache = new Map<HeroVariant, Entry>();
const listeners = new Set<() => void>();

/* Снимок для useSyncExternalStore обязан быть стабилен по ссылке, пока
   ничего не менялось, иначе React уйдёт в бесконечный ре-рендер. Держим
   по одному замороженному объекту на вариант и пересоздаём его ровно
   на переходах состояния — байты сюда не попадают вовсе. */
export type HeroPreloadSnapshot = {
  readonly idleUrl: string | null;
  readonly flightUrl: string | null;
  readonly failed: boolean;
};

const EMPTY: HeroPreloadSnapshot = { idleUrl: null, flightUrl: null, failed: false };
const snapshots = new Map<HeroVariant, HeroPreloadSnapshot>();

function publish(variant: HeroVariant): void {
  const e = cache.get(variant);
  snapshots.set(variant, e
    ? { idleUrl: e.idle.url, flightUrl: e.flight.url, failed: e.failed }
    : EMPTY);
  for (const notify of listeners) notify();
}

/* Скачивание с посчитанными байтами. Пустой res.body (древний движок,
   расширение-прокси) — не повод падать: дочитываем через blob(), просто
   без прогресса, и это ловит metered ниже. */
async function download(codec: Codec, file: FileState): Promise<void> {
  const res = await fetch(codec.src, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${codec.src}: HTTP ${res.status}`);

  const len = Number(res.headers.get('content-length') ?? 0);
  file.total = Number.isFinite(len) && len > 0 ? len : 0;

  let blob: Blob;
  if (!res.body) {
    blob = await res.blob();
    file.loaded = file.total || blob.size;
  } else {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      file.loaded += value.byteLength;
    }
    /* Тип обязателен: без него Safari получает blob неизвестного типа
       и отказывается его проигрывать. */
    blob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
  }

  /* Известный total мог соврать (прокси, сжатие) — выравниваем по факту,
     иначе сумма прогресса не дойдёт до единицы и лифт застрянет на 22. */
  file.total = blob.size;
  file.loaded = blob.size;
  file.url = URL.createObjectURL(blob);
}

/* Идемпотентный старт. Зовут двое: прелоадер (как можно раньше, он
   монтируется первым) и HeroVideo (на случай, если прелоадера нет вовсе —
   вторая загрузка во вкладке, sessionStorage). Второй вызов ничего
   не делает. Под prefers-reduced-motion не зовётся ни тем, ни другим:
   там не монтируется ни одно видео, ноль байт трафика. */
export function startHeroPreload(variant: HeroVariant): void {
  const existing = cache.get(variant);
  if (existing?.started) return;

  const entry: Entry = {
    idle: { loaded: 0, total: 0, url: null },
    flight: { loaded: 0, total: 0, url: null },
    failed: false,
    started: true,
  };
  cache.set(variant, entry);

  const fail = (err: unknown) => {
    if (entry.failed) return;
    entry.failed = true;
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[heroPreload] откат на <source>:', err);
    }
    publish(variant);
  };

  let codecs: { idle: Codec; flight: Codec };
  try {
    codecs = {
      idle: pickCodec(SOURCES[variant].idle),
      flight: pickCodec(SOURCES[variant].flight),
    };
  } catch (err) { fail(err); return; }

  /* Оба файла едут параллельно, и это не про скорость, а про предохранитель
     на 8 с: заголовки с Content-Length обоих приходят за один RTT, и
     знаменатель прогресса известен сразу. Луп при этом всё равно
     финиширует первым — он в шесть-десять раз легче ролика, — а
     предохранителю нужен именно готовый луп. */
  download(codecs.idle, entry.idle).then(() => publish(variant), fail);
  download(codecs.flight, entry.flight).then(() => publish(variant), fail);

  publish(variant);
}

/* Суммарный прогресс 0..1 по БАЙТАМ обоих файлов.
   metered=false означает «честного знаменателя нет» — Content-Length
   не пришёл, или fetch отвалился; прелоадер в этом случае возвращается
   к таймеру, а не рисует выдуманное число. */
export function heroPreloadProgress(variant: HeroVariant): {
  metered: boolean;
  ratio: number;
} {
  const e = cache.get(variant);
  if (!e || e.failed) return { metered: false, ratio: 0 };

  const done = (e.idle.url ? 1 : 0) + (e.flight.url ? 1 : 0);
  if (done === 2) return { metered: true, ratio: 1 };

  const total = e.idle.total + e.flight.total;
  if (total <= 0) return { metered: false, ratio: 0 };

  const loaded = e.idle.loaded + e.flight.loaded;
  return { metered: true, ratio: Math.min(1, loaded / total) };
}

export function subscribeHeroPreload(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

export function heroPreloadSnapshot(variant: HeroVariant): HeroPreloadSnapshot {
  return snapshots.get(variant) ?? EMPTY;
}

/* На сервере ничего не загружено — разметка уезжает без видео, и гидрация
   не расходится: элементы появятся первым же клиентским снимком. */
export const heroPreloadServerSnapshot = (): HeroPreloadSnapshot => EMPTY;
