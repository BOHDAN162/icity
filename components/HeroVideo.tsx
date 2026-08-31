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
   Внутри каждого варианта два <source>: HEVC (hvc1, вдвое легче) и H.264
   (играет везде). codecs-строки сняты ffprobe с реальных файлов —
   браузер отсекает неподдерживаемый кодек до единого байта загрузки.

   IDLE-ЛУП. Слот под бесшовный луп облаков (страница живёт до клика).
   Файлы public/video/icity_idle_*.mp4 могут отсутствовать — тогда error
   на последнем source просто прячет элемент, остаётся постер. Рендер
   лупа обязан начинаться с кадра f_0001 и кодироваться тем же конвейером,
   что основной ролик, — тогда и появление лупа, и старт полёта бесшовны.

   REDUCED-MOTION. Ни одно видео не монтируется вовсе — ноль байт
   трафика. «Войти» делает мгновенный свап на ресепшн. */

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import styles from './HeroVideo.module.css';

/* Секунда ролика, с которой камера входит в «трамплин» и начинается
   выезд ресепшна. Из драматургии рендера: финал наступает на duration,
   к нему прогресс дотягивается ровно до 1. */
const LIFT_START = 7.7;
/** длительность ролика; живая берётся из метаданных, это фолбэк */
const FALLBACK_DURATION = 10.4167;
/** аварийный выход: клик был, `playing` не наступило */
const PLAY_TIMEOUT_MS = 4000;

const VIDEO_DIR = '/video';
const POSTER_DIR = '/video/poster';
/** ширины постеров — сверять с public/video/poster/manifest.json */
const POSTER_DESKTOP = [1280, 1920, 2560] as const;
const POSTER_MOBILE = [640, 1080] as const;

/* codecs-строки — с реальных файлов (ffprobe): HEVC Main@L5.0 у десктопа,
   Main@L4.0 у мобильного, H.264 High@L5.0 у обоих. Idle-луп обязан
   собираться тем же конвейером и попадать в те же профили. */
const SOURCES = {
  desktop: {
    hevc: { src: `${VIDEO_DIR}/icity_desktop_2560x1440_hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L150.B0"' },
    h264: { src: `${VIDEO_DIR}/icity_desktop_2560x1440_h264.mp4`, type: 'video/mp4; codecs="avc1.640032"' },
    idleHevc: { src: `${VIDEO_DIR}/icity_idle_desktop_hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L150.B0"' },
    idleH264: { src: `${VIDEO_DIR}/icity_idle_desktop_h264.mp4`, type: 'video/mp4; codecs="avc1.640032"' },
  },
  mobile: {
    hevc: { src: `${VIDEO_DIR}/icity_mobile_1080x1920_hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L120.B0"' },
    h264: { src: `${VIDEO_DIR}/icity_mobile_1080x1920_h264.mp4`, type: 'video/mp4; codecs="avc1.640032"' },
    idleHevc: { src: `${VIDEO_DIR}/icity_idle_mobile_hevc.mp4`, type: 'video/mp4; codecs="hvc1.1.6.L120.B0"' },
    idleH264: { src: `${VIDEO_DIR}/icity_idle_mobile_h264.mp4`, type: 'video/mp4; codecs="avc1.640032"' },
  },
} as const;

type VariantKey = keyof typeof SOURCES;

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
  const rafRef = useRef(0);
  const failTimerRef = useRef(0);
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
  /* после клика вариант заморожен, до — следует за ориентацией */
  const [lockedVariant, setLockedVariant] = useState<VariantKey | null>(null);
  const variant: VariantKey = lockedVariant ?? (portrait ? 'mobile' : 'desktop');

  const [started, setStarted] = useState(false);
  const [playingVisible, setPlayingVisible] = useState(false);
  const [idleBroken, setIdleBroken] = useState(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (failTimerRef.current) window.clearTimeout(failTimerRef.current);
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
      if (v.ended) { finish(); return; }
      if (v.paused) v.play().catch(finish);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [onLift, finish]);

  const enter = useCallback(() => {
    if (started || doneRef.current) return;
    setStarted(true);
    setLockedVariant(variant);

    const v = videoRef.current;
    if (reduced || !v || brokenRef.current) { finish(); return; }

    idleRef.current?.pause();
    failTimerRef.current = window.setTimeout(finish, PLAY_TIMEOUT_MS);
    v.play().catch(finish);
  }, [started, reduced, finish, variant]);

  const onPlaying = useCallback(() => {
    if (doneRef.current) return;
    if (failTimerRef.current) window.clearTimeout(failTimerRef.current);
    setPlayingVisible(true);
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
      /* отказ мог случиться до подписки — NETWORK_NO_SOURCE это фиксирует */
      if (el.networkState === el.NETWORK_NO_SOURCE) { onErr(); return () => {}; }
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
  }, [variant, reduced, idleBroken, onIdleError, onVideoError]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (failTimerRef.current) window.clearTimeout(failTimerRef.current);
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

      {/* Idle-луп: облака живут до клика. Файлов может не быть —
          error на последнем source прячет элемент, остаётся постер. */}
      {!reduced && !idleBroken && (
        <video
          key={`idle-${variant}`}
          ref={idleRef}
          className={styles.idle}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          onError={onIdleError}
        >
          <source src={sources.idleHevc.src} type={sources.idleHevc.type} />
          <source src={sources.idleH264.src} type={sources.idleH264.type} onError={onIdleError} />
        </video>
      )}

      {/* Основной ролик. preload="auto" сознательно: к клику файл в кэше,
          полёт начинается без паузы. HEVC-версии лёгкие: 3,0 МБ десктоп,
          1,9 МБ мобильный. */}
      {!reduced && (
        <video
          key={`flight-${variant}`}
          ref={videoRef}
          className={`${styles.video} ${playingVisible ? styles.videoOn : ''}`}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          onPlaying={onPlaying}
          onEnded={finish}
          onError={onVideoError}
        >
          <source src={sources.hevc.src} type={sources.hevc.type} />
          <source src={sources.h264.src} type={sources.h264.type} onError={onVideoError} />
        </video>
      )}

      <div className={`${styles.overlay} ${playingVisible ? styles.overlayOff : ''}`}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>iCITY · Space Tower · 23 этаж</p>
          <h1 className={styles.title}>
            Офис, в который
            <br />
            въезжают завтра
          </h1>
          <div className={styles.divider} aria-hidden="true" />
          <p className={styles.lead}>
            244,1 м² с отделкой PRIDEX.
            <br />
            Ноль капитальных затрат до въезда.
          </p>
        </div>

        <div className={styles.enter}>
          <button type="button" className={`btn ${styles.enterBtn}`} onClick={enter} disabled={started}>
            <span className={styles.enterFill} aria-hidden="true" />
            <span className={styles.enterLabel}>
              <span className={styles.enterLabelDefault}>Войти</span>
              <span className={styles.enterLabelHover} aria-hidden="true">Войти</span>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
