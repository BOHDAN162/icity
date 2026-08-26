'use client';

/* iCITY 113Н — параллакс кадра зоны.
   Путь в проекте: components/ZoneParallax.tsx

   ЧТО ЭТО. Холст поверх кадра зоны в офисе. Кадр смещается по карте
   глубины вслед за указателем, ближнее уезжает вперёд, дальнее отстаёт.
   Эффект должен читаться как объём, а не как эффект: амплитуда 14 px
   на весь размах, на кухне 10.

   ПОЧЕМУ НЕ three.js, А СЫРОЙ WebGL. Офис — первый интерактивный экран
   после секвенции, и он импортируется со страницы напрямую. Правило
   из AGENTS.md: three.js не должен появиться ни в одном таком модуле.
   Здесь одна программа, один треугольник и две текстуры — это полторы
   сотни строк против четверти мегабайта библиотеки.

   КАК СМЕЩАЕМ. Сдвигается не сетка, а координата выборки во фрагментном
   шейдере. При наших амплитудах это не рвёт силуэты и стоит одно лишнее
   чтение текстуры. Смещённой сеткой пришлось бы латать дыры на разрывах
   глубины.

   d50 — МЕДИАНА КАДРА, И ЭТО НЕ ПРОИЗВОЛ. Сдвиг считается как
   A × (d − d50): середина кадра стоит на месте, вокруг неё расходятся
   ближний и дальний планы. Возьми вместо медианы ноль — весь кадр
   поедет в одну сторону, и это будет выглядеть как съехавшая картинка,
   а не как глубина.

   ЗА КРАЙ ТЕКСТУРЫ НЕ ВЫХОДИМ. Кадр стоит в object-fit: cover, то есть
   по одной оси всегда есть запас обрезанного изображения — туда и уходит
   сдвиг. По второй оси запаса нет, и там выборка поджимается на величину
   амплитуды. Без этого на кромке появляется размазанная полоса. */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RENDER_NATIVE, depthUrl, hasWebGL2, isSlowNetwork,
  loadDepthManifest, renderSmallest, renderSrcSet, type RenderKey,
} from '@/lib/interior';
import {
  PARALLAX_AMPLITUDE, PARALLAX_EASE, TILT_EASE, TILT_RANGE,
} from '@/lib/motion';
import styles from './ZoneParallax.module.css';

const VERT = `#version 300 es
/* Один треугольник на весь экран: дешевле квада и без шва по диагонали. */
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uCover;   /* подгонка под object-fit: cover, плюс поджим под амплитуду */
uniform vec2 uShift;   /* амплитуда × указатель, в координатах текстуры */
uniform float uD50;    /* плоскость нулевого параллакса */
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 base = (vUv - 0.5) * uCover + 0.5;
  /* Глубина читается по несмещённой координате. Читать её по смещённой
     значило бы гонять обратную задачу: сдвиг зависит от глубины,
     а глубина — от сдвига. */
  float d = texture(uDepth, base).r;
  vec2 uv = base + uShift * (d - uD50);
  fragColor = vec4(texture(uColor, uv).rgb, 1.0);
}`;

const SETTLED = 0.0004;        // ближе этого к цели — перестаём считать кадры

/* Разрешение на датчики спрашиваем один раз за сессию и только с жеста.
   Отказ помним: повторно клянчить доступ на странице аренды нельзя.
   Ни localStorage, ни sessionStorage — состояние живёт в модуле
   и умирает вместе со вкладкой. */
type TiltGrant = 'unknown' | 'granted' | 'denied';
let tiltGrant: TiltGrant = 'unknown';

const NEEDS_PERMISSION = () =>
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';

/** Вызывать только из обработчика жеста: iOS иначе молча откажет. */
const askTilt = async (): Promise<boolean> => {
  if (tiltGrant !== 'unknown') return tiltGrant === 'granted';
  if (!NEEDS_PERMISSION()) { tiltGrant = 'granted'; return true; }
  try {
    const ask = (DeviceOrientationEvent as unknown as {
      requestPermission: () => Promise<PermissionState>;
    }).requestPermission;
    const res = await ask();
    tiltGrant = res === 'granted' ? 'granted' : 'denied';
  } catch {
    tiltGrant = 'denied';
  }
  return tiltGrant === 'granted';
};

const clamp = (n: number, a: number, b: number) => (n < a ? a : n > b ? b : n);

type GL = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  color: WebGLTexture;
  depth: WebGLTexture;
  u: {
    cover: WebGLUniformLocation | null;
    shift: WebGLUniformLocation | null;
    d50: WebGLUniformLocation | null;
  };
};

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('ZoneParallax: шейдер не собрался', gl.getShaderInfoLog(sh));
    }
    gl.deleteShader(sh);
    return null;
  }
  return sh;
};

const loadImage = (src: string, srcSet?: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (srcSet) {
      img.srcset = srcSet;
      img.sizes = '100vw';
    }
    img.onload = () => img.decode().then(() => resolve(img), () => resolve(img));
    img.onerror = reject;
    img.src = src;
  });

/* Кадр зоны уже висит в офисе — забираем текстуру оттуда. Свой <img>
   с тем же srcset выбрал бы WebP там, где <picture> взял AVIF, и кадр
   приехал бы во второй раз: сто с лишним килобайт на пустом месте.
   Метку ставит OfficeHub, атрибутом data-zone.

   ЖДАТЬ ОБЯЗАТЕЛЬНО. У только что вставленного <img> currentSrc пуст:
   браузер ещё не выбрал вариант из srcset. Проверка «есть currentSrc —
   берём, нет — качаем сами» на первом заходе в зону всегда попадала
   в «нет» и скачивала кадр повторно. Ждём события, а сдаёмся только
   если картинка действительно не загрузилась. */
const adoptImage = async (
  canvas: HTMLCanvasElement,
  zone: RenderKey,
): Promise<HTMLImageElement> => {
  const found = canvas.parentElement?.querySelector<HTMLImageElement>(
    `img[data-zone="${zone}"]`,
  );

  if (found) {
    if (!found.complete) {
      await new Promise<void>((resolve) => {
        const done = () => {
          found.removeEventListener('load', done);
          found.removeEventListener('error', done);
          resolve();
        };
        found.addEventListener('load', done);
        found.addEventListener('error', done);
      });
    }
    // decode() на уже раскодированной картинке разрешается сразу
    try { await found.decode(); } catch { /* не вышло — уйдём в запасной путь */ }
    if (found.naturalWidth > 0) return found;
  }

  return loadImage(renderSmallest(zone), renderSrcSet(zone, 'webp'));
};

const upload = (
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  img: HTMLImageElement,
  single: boolean,
) => {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  if (single) {
    // Карта глубины — один канал: вчетверо меньше видеопамяти, чем RGBA
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, img);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

/* Разрешение на параллакс решается один раз, при монтировании, и снаружи
   от холста — чтобы при отказе не выполнялось вообще ничего: ни проб
   контекста, ни подписок, ни загрузки карты глубины.

   Три причины отказать те же, что и у кукольного дома, плюс WebGL2:
   просьба убрать движение, медленная сеть, отсутствие контекста. */
export default function ZoneParallax({ zone }: { zone: RenderKey }) {
  const [allowed] = useState(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (isSlowNetwork()) return false;
    return hasWebGL2();
  });

  if (!allowed) return null;
  return <ParallaxCanvas zone={zone} />;
}

function ParallaxCanvas({ zone }: { zone: RenderKey }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GL | null>(null);

  /* Не «готов ли холст», а «какая зона в него залита». Тогда при смене
     зоны live гаснет сам, вычислением при отрисовке, и не нужен setState
     в начале эффекта — а он там означал бы лишний каскад рендеров. */
  const [loaded, setLoaded] = useState<RenderKey | null>(null);
  const live = loaded === zone;

  /* Всё, что меняется каждый кадр, живёт в ref: класть указатель
     в состояние значит перерисовывать React шестьдесят раз в секунду. */
  const target = useRef({ x: 0, y: 0 });
  const cur = useRef({ x: 0, y: 0 });
  /* Ноль наклона — то, как телефон держали при открытии зоны. */
  const neutral = useRef<{ gamma: number; beta: number } | null>(null);
  /* Своя плотность сглаживания у пальца и у наклона: рука шумит сильнее. */
  const damping = useRef(PARALLAX_EASE);
  const sceneRef = useRef({ d50: 0.5, amp: 14, aspect: 16 / 9 });

  const draw = useCallback(() => {
    const g = glRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;

    const { gl } = g;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }

    const { d50, amp, aspect } = sceneRef.current;
    const canvasAspect = canvas.clientWidth / canvas.clientHeight;

    // object-fit: cover — по одной оси показываем всё, по другой обрезаем
    let coverX = 1;
    let coverY = 1;
    if (canvasAspect > aspect) coverY = aspect / canvasAspect;
    else coverX = canvasAspect / aspect;

    /* Поджим на амплитуду нужен только там, где cover не оставил запаса:
       где coverX уже меньше единицы, обрезанная часть кадра и есть запас. */
    const insetX = amp / canvas.clientWidth;
    const insetY = amp / canvas.clientHeight;
    const cx = Math.min(coverX, 1 - 2 * insetX);
    const cy = Math.min(coverY, 1 - 2 * insetY);

    gl.uniform2f(g.u.cover, cx, cy);
    gl.uniform1f(g.u.d50, d50);
    // Сдвиг задан в экранных пикселях, переводим в координаты текстуры
    gl.uniform2f(
      g.u.shift,
      (cur.current.x * amp * cx) / canvas.clientWidth,
      (cur.current.y * amp * cy) / canvas.clientHeight,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }, []);

  /* --- инициализация контекста: один раз на всё время жизни --------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = vs && fs ? gl.createProgram() : null;
    if (!vs || !fs || !program) return;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    gl.useProgram(program);
    const color = gl.createTexture();
    const depth = gl.createTexture();
    if (!color || !depth) return;

    gl.uniform1i(gl.getUniformLocation(program, 'uColor'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uDepth'), 1);

    glRef.current = {
      gl,
      program,
      color,
      depth,
      u: {
        cover: gl.getUniformLocation(program, 'uCover'),
        shift: gl.getUniformLocation(program, 'uShift'),
        d50: gl.getUniformLocation(program, 'uD50'),
      },
    };

    /* Потеря контекста — не редкость на мобильных: фон, нехватка памяти,
       переключение GPU. Тогда просто уходим, под нами остаётся обычный кадр. */
    const onLost = (e: Event) => {
      e.preventDefault();
      setLoaded(null);
      glRef.current = null;
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      const g = glRef.current;
      glRef.current = null;
      if (!g) return;
      g.gl.deleteTexture(g.color);
      g.gl.deleteTexture(g.depth);
      g.gl.deleteProgram(g.program);
      // Safari не отпускает буфер холста без явного обнуления размеров
      canvas.width = 0;
      canvas.height = 0;
      /* loseContext() здесь звать нельзя. У холста контекст один на всю
         жизнь: getContext вернёт тот же самый объект, а не новый. В dev
         StrictMode эффект проходит цикл монтирование—очистка—монтирование,
         и убитый в очистке контекст возвращается на втором заходе уже
         мёртвым — шейдеры на нём не собираются, а лог ошибки пустой.
         Контекст уходит вместе с самим элементом холста. */
    };
  }, []);

  /* --- загрузка зоны ------------------------------------------------ */
  useEffect(() => {
    let alive = true;
    // Новая зона — новый ноль наклона: держат телефон уже иначе
    neutral.current = null;

    const run = async () => {
      const g = glRef.current;
      if (!g) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [manifest, colorImg, depthImg] = await Promise.all([
        loadDepthManifest(),
        adoptImage(canvas, zone),
        loadImage(depthUrl(zone)),
      ]);
      if (!alive || !glRef.current) return;

      const entry = manifest[zone];
      const [nw, nh] = RENDER_NATIVE[zone];
      sceneRef.current = {
        d50: entry?.d50 ?? 0.5,
        amp: PARALLAX_AMPLITUDE[zone],
        aspect: nw / nh,
      };

      const { gl } = g;
      gl.activeTexture(gl.TEXTURE0);
      upload(gl, g.color, colorImg, false);
      gl.activeTexture(gl.TEXTURE1);
      upload(gl, g.depth, depthImg, true);

      draw();
      setLoaded(zone);
    };

    void run().catch((e) => {
      // не сложилось — под холстом остаётся обычная картинка
      if (process.env.NODE_ENV !== 'production') console.warn('ZoneParallax:', e);
      if (alive) setLoaded(null);
    });

    return () => { alive = false; };
  }, [zone, draw]);

  /* --- ввод ---------------------------------------------------------- */
  useEffect(() => {
    if (!live) return;

    /* Кадры считаем, только пока картинка догоняет указатель. Догнала —
       цикл останавливается сам, и телефон перестаёт греться на неподвижном
       кадре. Тот же принцип, что у кукольного дома: единственный источник
       кадров — тот, кому есть что менять.

       Цикл живёт внутри эффекта, а не в useCallback: функция, которая
       ставит в очередь саму себя, ссылается на себя же до объявления. */
    let raf = 0;
    const tick = () => {
      raf = 0;
      const dx = target.current.x - cur.current.x;
      const dy = target.current.y - cur.current.y;
      cur.current.x += dx * damping.current;
      cur.current.y += dy * damping.current;
      draw();
      if (Math.abs(dx) > SETTLED || Math.abs(dy) > SETTLED) raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const onPointer = (e: PointerEvent) => {
      /* Палец ведёт кадр только пока касается экрана. Наклон при этом
         не отключаем: они складываются в одно движение, потому что
         сглаживание у них общее. */
      target.current.x = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
      target.current.y = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
      damping.current = PARALLAX_EASE;
      wake();
    };

    /* Наклон считается ОТ ТОГО ПОЛОЖЕНИЯ, в котором телефон держали
       в момент открытия зоны, а не от абсолютного нуля. Иначе эффект
       зависит от позы зрителя: лёжа на диване кадр уехал бы в упор
       ещё до того, как человек шевельнулся. */
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      if (!neutral.current) {
        neutral.current = { gamma: e.gamma, beta: e.beta };
        return;
      }
      target.current.x = clamp((e.gamma - neutral.current.gamma) / TILT_RANGE, -1, 1);
      target.current.y = clamp((e.beta - neutral.current.beta) / TILT_RANGE, -1, 1);
      // Рука дрожит сильнее мыши, поэтому наклон сглаживаем вдвое плотнее
      damping.current = TILT_EASE;
      wake();
    };

    /* Разрешение просим по первому касанию внутри офиса — на iOS оно
       обязано прийти из жеста. Отказали — молча живём на пальце,
       второй раз не спрашиваем. */
    const onFirstTouch = () => {
      window.removeEventListener('pointerdown', onFirstTouch);
      void askTilt().then((ok) => {
        if (ok) window.addEventListener('deviceorientation', onTilt);
      });
    };

    const onLeave = () => {
      target.current.x = 0;
      target.current.y = 0;
      damping.current = PARALLAX_EASE;
      wake();
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerleave', onLeave, { passive: true });
    window.addEventListener('resize', wake, { passive: true });

    /* Где разрешение не нужно (Android и всё, что не iOS) — подписываемся
       сразу. Где нужно — ждём касания. Где уже отказали — не делаем ничего. */
    if (tiltGrant === 'granted' || !NEEDS_PERMISSION()) {
      tiltGrant = 'granted';
      window.addEventListener('deviceorientation', onTilt);
    } else if (tiltGrant === 'unknown') {
      window.addEventListener('pointerdown', onFirstTouch, { once: true });
    }

    wake();
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', wake);
      window.removeEventListener('pointerdown', onFirstTouch);
      window.removeEventListener('deviceorientation', onTilt);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [live, draw]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas} ${live ? styles.live : ''}`}
      aria-hidden="true"
    />
  );
}
