'use client';

/* iCITY 113Н — кукольный дом: объёмный план этажа.
   Путь в проекте: components/PlanScene.tsx

   ЧТО ЭТО. Оболочка помещения из dollhouse.glb — плита, стены, пять
   круглых колонн, фасадное остекление с импостами и внутренние
   перегородки. Потолок в модели есть, но скрыт: сверху нужно видеть этаж.
   Мебели в модели нет и не будет — мебель показывают рендеры, а модель
   отвечает за форму и связи зон.

   ФАСАД. Остекления 29,73 м по четырём прогонам: юг 15,29, скос 8,45,
   восток 3,95, запад 2,04. Запад почти весь глухой — стекло там идёт
   только 2,04 м у южного угла. В прежней версии модели была остеклена
   вся западная кромка на 11,33 м, и это было неверно.

   В периметре три проёма без дверей: вход с запада 1,41 м и два прохода
   из общего коридора с севера, 1,11 и 1,51 м. Это дыры, а не двери —
   ни геометрии дверей, ни точек попадания курсора им не нужно.

   ЗАЧЕМ ЭТОТ ФАЙЛ ГРУЗИТСЯ ОТДЕЛЬНО. Здесь three.js. Чанк подтягивается
   динамически и только когда план открыли, поэтому на первый экран сайта
   он не влияет вообще. Бюджеты из AGENTS.md считаются по критическому
   пути — этот код в него не входит.

   ПАМЯТЬ И КОНТЕКСТ. Оверлей при закрытии размонтируется целиком (см.
   его монтируют по клику и снимают по выходу), Canvas отпускает контекст
   сам. То, что создано руками, добиваем в useEffect: геометрию и текстуры
   GLB отдаёт useLoader из общего кэша, а полигоны зон и материалы,
   назначенные нами, наши — за ними никто не приберёт.

   КАДРОВ БЕЗ НУЖДЫ НЕ РИСУЕМ. frameloop="demand": кадр считается, только
   когда что-то попросили. Праздношатание камеры, перелёт и проявление
   подсветки сами дёргают invalidate, пока им есть что менять. Замер стоит
   на месте — сцена не тратит ни кадра. На телефоне праздношатания нет,
   поэтому неподвижный план там честно бесплатен.

   СИСТЕМА КООРДИНАТ. План [x, y] → мир (x, высота, y). Ничего не
   переставляем и не отрицаем: матрица SWAP меняет местами Y и Z ровно
   один раз, на выходе из ShapeGeometry, где фигура плоская в XY. */

import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, invalidate, useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CROSSFADE_AT, FLIGHT_MS, GLB_URL,
  type Plan, type PlanCamera, type PlanZone, type RenderKey, type ZoneKey,
} from '@/lib/interior';
import styles from './PlanDollhouse.module.css';

const DEG = Math.PI / 180;
const CEIL = 3.8;

/* Дом смотрим с юго-востока и сверху: так читаются и панорамный фасад,
   и скошенный угол, и глубина опенспейса. Ниже 45° мы смотрим на стекло
   снаружи, и пол-кадра занимает наружная сторона фасада вместо этажа;
   выше 58° объём уходит и остаётся чертёж. */
const HOME_AZ = 61;
const HOME_EL = 51;
const HOME_FOV = 30;
const FIT_PAD = 1.02;

/* Праздношатание: ±5,5° за 26 секунд. Достаточно, чтобы сцена не казалась
   картинкой, и мало, чтобы никого не укачало. */
const IDLE_AMP = 5.5;
const IDLE_PERIOD = 26000;
const IDLE_RESUME_MS = 4000;   // столько тишины после мыши — и качание вернулось

/* Ручной доворот. Рамки узкие сознательно: план не должен переворачиваться
   вверх ногами, из него надо выйти с тем же представлением, с каким вошли. */
const DRAG_AZ_LIMIT = 28;
const DRAG_EL_MIN = 26;
const DRAG_EL_MAX = 64;
const DRAG_SLOP = 6;           // сдвиг меньше — это клик, а не перетаскивание

const HIT_HEIGHT = 2.2;        // объём под курсор: ниже стен, выше мебели

const clamp = (n: number, a: number, b: number) => (n < a ? a : n > b ? b : n);
/* Уходит быстро, садится мягко. */
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

/* Плоская фигура ShapeGeometry лежит в XY. Матрица меняет Y и Z местами:
   (x, y, z) → (x, z, y). План [x, y] превращается в (x, высота, y). */
const SWAP = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

const shapeOf = (poly: readonly (readonly [number, number])[]) => {
  const s = new THREE.Shape();
  poly.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
};

/* Растр фритты для активной зоны. design-system.md §1 разрешает растру
   ровно четыре места, и «заливка активной зоны на плане» — одно из них.
   Плашки здесь быть не должно: плоская красная заливка нарушила бы и
   правило растра, и правило «все заливки на --frit-deep». */
/* Шаг растра в метрах. На экране план идёт примерно по 30 px на метр,
   поэтому 0,42 м дают те же ~13 px между точками, что и --frit-dense
   в CSS. Считать этот шаг в пикселях нельзя: он живёт в мире, а не на
   холсте, и от масштаба камеры не зависит. Первая версия стояла на
   0,27 м — точка выходила в полпикселя и растворялась в ровную серость. */
const FRIT_STEP_M = 0.42;
const FRIT_DOT_RATIO = 0.175;   // радиус к шагу, как 1,4 px в тайле 8 px

const fritTexture = () => {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ED1C29';
    g.beginPath();
    g.arc(S / 2, S / 2, S * FRIT_DOT_RATIO, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  /* Пол зоны мы видим под очень острым углом, и здесь решает не мипмап,
     а анизотропия: без неё дальняя половина растра либо усредняется
     в ровную розовую заливку (запрещено системой), либо, если мипмапы
     выключить, рассыпается в мерцающую крапину. Восьмёрку можно ставить
     не глядя: three сама обрежет её по возможностям видеокарты. */
  t.anisotropy = 8;
  // UV у ShapeGeometry равны координатам вершины в метрах, поэтому шаг
  // задаётся прямо в метрах — один тайл на FRIT_STEP_M.
  t.repeat.set(1 / FRIT_STEP_M, 1 / FRIT_STEP_M);
  return t;
};

/* --- поза камеры ------------------------------------------------------ */

type Pose = { pos: THREE.Vector3; target: THREE.Vector3; fov: number };

const dirOf = (azDeg: number, elDeg: number) => {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az),
  );
};

/* Дистанцию не подбираем на глаз: считаем такую, при которой все восемь
   углов габарита влезают в кадр при текущем соотношении сторон. Иначе
   на 21:9 план болтается в пустоте, а на телефоне вылезает за края. */
const fitPose = (plan: Plan, aspect: number, azDeg: number, elDeg: number): Pose => {
  const [minX, minY, maxX, maxY] = plan.bounds;
  const target = new THREE.Vector3((minX + maxX) / 2, CEIL * 0.3, (minY + maxY) / 2);
  const dir = dirOf(azDeg, elDeg);

  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const tanV = Math.tan((HOME_FOV * DEG) / 2);
  const tanH = tanV * aspect;

  let r = 0;
  const v = new THREE.Vector3();
  for (const x of [minX, maxX]) {
    for (const y of [0, CEIL]) {
      for (const z of [minY, maxY]) {
        v.set(x, y, z).sub(target);
        const depth = v.dot(forward);
        r = Math.max(r, Math.abs(v.dot(right)) / tanH - depth, Math.abs(v.dot(up)) / tanV - depth);
      }
    }
  }

  return { pos: target.clone().addScaledVector(dir, r * FIT_PAD), target, fov: HOME_FOV };
};

/* --- оболочка помещения ---------------------------------------------- */

/* МОДЕЛЬ ЗАПЕЧЕНА. В GLB лежит атлас 2048×2048 в WebP, один на четыре
   меша: пол, стены, колонны, импосты. В нём весь диффузный свет — цвет,
   прямой и отражённый, посчитанный в Cycles со снятым потолком. Мягкие
   тени на полу и градиенты на стенах живут теперь там, а не в наших
   источниках света.

   Отсюда главное правило этого файла: **у этих четырёх мешей материал
   берётся из GLB как есть**. Назначить им плоский цвет — значит стереть
   запечённое одной строкой, и заметить это можно будет только сравнив
   с эталонным рендером: модель продолжит рисоваться, просто плоско.

   Таблица распоряжается только тем, что текстуры не несёт: потолком
   и двумя стёклами. Незнакомое имя по-прежнему не рисуется и кричит
   в консоль — ни «всё остальное стекло», ни «всё остальное из GLB».

   ОБХОДИМ СЦЕНУ, А НЕ СОБИРАЕМ МЕШИ ЗАНОВО. У узлов `columns` и
   `mullions` есть трансляция; прежняя версия модели была с запечёнными
   трансформами, эта — нет. Вытащить голую геометрию и построить свой
   `<mesh>` значит потерять сдвиг и уронить колонны на несколько метров
   мимо места.

   Стекло не пишет в буфер глубины (`depthWrite: false`) — иначе ближняя
   грань фасада закрывает собой то, что за ней, и этаж превращается
   в матовую коробку. И рисуется только лицевыми гранями: стеклопакеты
   объёмные, при `DoubleSide` зритель смотрит сквозь четыре слоя альфы
   вместо двух, и панорамный фасад сереет до бетонного парапета. */
type ShellPart =
  /** материал приходит из GLB: там запечённый свет, трогать нельзя */
  | { name: string; baked: true }
  /** материал наш: у меша нет текстуры */
  | {
      name: string;
      baked?: false;
      glass?: boolean;
      color: string;
      opacity?: number;
    };

const SHELL: readonly ShellPart[] = [
  { name: 'floor', baked: true },
  { name: 'walls', baked: true },
  { name: 'columns', baked: true },
  { name: 'mullions', baked: true },
  { name: 'glazing_facade', glass: true, color: '#9BA7AE', opacity: 0.16 },
  { name: 'glazing_interior', glass: true, color: '#9BA7AE', opacity: 0.12 },
];

const SHELL_BY_NAME = new Map(SHELL.map((p) => [p.name, p]));

/** Есть в модели, но не рисуется — и это решение, а не недосмотр. */
const SHELL_HIDDEN = new Set(['ceiling']);

function Shell() {
  const gltf = useLoader(GLTFLoader, GLB_URL);

  const scene = useMemo(() => {
    /* Клон, а не оригинал: useLoader держит gltf в общем кэше, и правки
       материалов на оригинале пережили бы размонтирование и достались бы
       следующему открытию плана уже применёнными. */
    const root = gltf.scene.clone(true);
    const ours: THREE.Material[] = [];

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;

      // Курсор ищет только зоны: стена перед зоной не должна съедать наведение
      mesh.raycast = () => null;

      if (SHELL_HIDDEN.has(mesh.name)) {
        mesh.visible = false;
        return;
      }

      const part = SHELL_BY_NAME.get(mesh.name);
      if (!part) {
        mesh.visible = false;
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`PlanScene: меш «${mesh.name}» есть в dollhouse.glb, но не описан в SHELL`);
        }
        return;
      }

      if (part.baked) {
        /* Материал из GLB. Единственная правка — металличность у импостов:
           в файле 0,85, а металл без карты окружения в three рисуется
           чёрным, и запечённая текстура на нём просто не видна. Карту
           окружения ради одного меша сюда не тащим: она стоит и веса,
           и генерации PMREM на открытии плана. */
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && 'metalness' in mat && mat.metalness > 0) {
          const flat = mat.clone();
          flat.metalness = 0;
          mesh.material = flat;
          ours.push(flat);
        }
        return;
      }

      const mat = part.glass
        ? new THREE.MeshBasicMaterial({
            color: part.color,
            transparent: true,
            opacity: part.opacity ?? 0.2,
            depthWrite: false,
            side: THREE.FrontSide,
          })
        : new THREE.MeshLambertMaterial({ color: part.color });
      mesh.material = mat;
      mesh.renderOrder = part.glass ? 2 : 1;
      ours.push(mat);
    });

    return { root, ours };
  }, [gltf]);

  useEffect(() => () => scene.ours.forEach((m) => m.dispose()), [scene]);

  /* Модель приезжает через Suspense, то есть уже после первого кадра.
     Сам по себе на frameloop="demand" второй кадр не случится, и план
     останется пустым холстом. Просим его руками — ровно один раз. */
  useEffect(() => { invalidate(); }, [scene]);

  return <primitive object={scene.root} />;
}

/* --- зона ------------------------------------------------------------- */

type ZoneProps = {
  zone: PlanZone;
  active: boolean;
  frit: THREE.Texture;
  onHover: (k: ZoneKey | null) => void;
  onPick: (z: PlanZone) => void;
  interactive: boolean;
};

function Zone({ zone, active, frit, onHover, onPick, interactive }: ZoneProps) {
  const fillRef = useRef<THREE.MeshBasicMaterial>(null);
  const lineRef = useRef<THREE.LineBasicMaterial>(null);

  const { fill, hit, outline } = useMemo(() => {
    const shape = shapeOf(zone.poly);

    const f = new THREE.ShapeGeometry(shape);
    f.applyMatrix4(SWAP);
    f.translate(0, 0.03, 0);   // над плитой, чтобы не спорить с ней за пиксель

    const h = new THREE.ExtrudeGeometry(shape, { depth: HIT_HEIGHT, bevelEnabled: false });
    h.applyMatrix4(SWAP);

    /* Контур по кромке зоны. Растр на полу читается под острым углом
       через раз, а волосяная линия — всегда. Чистая --frit здесь по
       правилам: design-system.md отдаёт ей точки и линии 1–2 px,
       заливки же идут только на --frit-deep. */
    const o = new THREE.BufferGeometry().setFromPoints(
      zone.poly.map(([x, y]) => new THREE.Vector3(x, 0.05, y)),
    );

    return { fill: f, hit: h, outline: o };
  }, [zone]);

  useEffect(() => () => { fill.dispose(); hit.dispose(); outline.dispose(); }, [fill, hit, outline]);

  /* Проявление подсветки. Пока разница видна — просим следующий кадр;
     дошли до цели — замолкаем, и сцена снова ничего не считает.
     Заливка и контур идут по одной кривой: это одна подсветка. */
  useFrame(() => {
    const m = fillRef.current;
    if (!m) return;
    const want = active ? (interactive ? 1 : 0.5) : 0;
    const next = m.opacity + (want - m.opacity) * 0.22;
    const done = Math.abs(want - next) < 0.004;
    m.opacity = done ? want : next;
    if (lineRef.current) lineRef.current.opacity = m.opacity;
    if (!done || m.opacity !== want) invalidate();
  });

  const enter = useCallback((e: { stopPropagation(): void }) => {
    e.stopPropagation();
    onHover(zone.key);
    if (interactive) document.body.style.cursor = 'pointer';
  }, [interactive, onHover, zone.key]);

  const leave = useCallback(() => {
    onHover(null);
    document.body.style.cursor = '';
  }, [onHover]);

  useEffect(() => () => { document.body.style.cursor = ''; }, []);

  return (
    <group>
      {/* Заливка. У кликабельной — растр фритты, у остальных ровный
          алюминий: растр означает «сюда можно», а не «здесь что-то есть». */}
      <mesh geometry={fill} raycast={() => null} renderOrder={4}>
        {interactive ? (
          <meshBasicMaterial
            ref={fillRef}
            map={frit}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        ) : (
          <meshBasicMaterial
            ref={fillRef}
            color="#B7BFC4"
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>

      <lineLoop geometry={outline} raycast={() => null} renderOrder={5}>
        <lineBasicMaterial
          ref={lineRef}
          color={interactive ? '#ED1C29' : '#8B979E'}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </lineLoop>

      {/* Объём под курсор. Ничего не рисует, но ловит наведение по всей
          комнате, а не по одной плоскости пола под острым углом. */}
      <mesh
        geometry={hit}
        visible={false}
        onPointerOver={enter}
        onPointerOut={leave}
        onClick={(e) => { e.stopPropagation(); if (interactive) onPick(zone); }}
      />
    </group>
  );
}

/* --- камера ----------------------------------------------------------- */

type OrbitState = { az: number; el: number; lastInput: number; dragging: boolean };

type Flight = { key: RenderKey; cam: PlanCamera };

type RigProps = {
  plan: Plan;
  orbit: React.RefObject<OrbitState>;
  flight: Flight | null;
  onPhase: (phase: 'crossfade' | 'done') => void;
  idle: boolean;
};

/* Камерой правит только этот кадровый обработчик — ни один эффект её
   не трогает. Причина не в чистоте: эффект и кадр пишут в один объект
   в разном порядке, и на первом кадре перелёта камера успевает прыгнуть
   домой. Одна рука на штурвале — одна траектория. */
function Rig({ plan, orbit, flight, onPhase, idle }: RigProps) {
  const size = useThree((s) => s.size);
  const aspect = size.width / size.height;

  const keyRef = useRef<RenderKey | null>(null);
  const startRef = useRef(0);
  const fromRef = useRef<Pose | null>(null);
  const firedRef = useRef(false);

  /* Смена цели или размера — повод нарисовать кадр: на frameloop="demand"
     сам по себе он не случится, а без первого кадра перелёт не начнётся.
     Зависим от size, а не от aspect: холст меняет высоту и при неизменных
     пропорциях — например, когда на телефоне под план отводится другая
     полоса экрана, — и тогда aspect бы промолчал. */
  useEffect(() => { invalidate(); }, [flight, size]);

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera;

    if (flight) {
      // Первый кадр перелёта: запоминаем, откуда стартуем. Именно отсюда,
      // а не из эффекта, — камера в этот момент уже там, где её видит зритель.
      if (keyRef.current !== flight.key) {
        keyRef.current = flight.key;
        startRef.current = performance.now();
        firedRef.current = false;
        const look = new THREE.Vector3();
        camera.getWorldDirection(look);
        look.multiplyScalar(6).add(camera.position);
        fromRef.current = { pos: camera.position.clone(), target: look, fov: camera.fov };
      }

      const from = fromRef.current;
      if (!from) return;

      const elapsed = performance.now() - startRef.current;
      const t = clamp(elapsed / FLIGHT_MS, 0, 1);
      const e = easeOutQuart(t);

      camera.position.lerpVectors(from.pos, new THREE.Vector3(...flight.cam.pos3), e);
      const look = new THREE.Vector3().lerpVectors(from.target, new THREE.Vector3(...flight.cam.target3), e);
      camera.fov = from.fov + (flight.cam.fov - from.fov) * e;
      camera.lookAt(look);
      camera.updateProjectionMatrix();

      if (!firedRef.current && elapsed >= CROSSFADE_AT) {
        firedRef.current = true;
        onPhase('crossfade');
      }
      if (t >= 1) { onPhase('done'); return; }
      invalidate();
      return;
    }

    keyRef.current = null;
    fromRef.current = null;

    const o = orbit.current;
    const quiet = performance.now() - o.lastInput > IDLE_RESUME_MS;
    const wobbling = idle && quiet && !o.dragging;
    const wobble = wobbling
      ? Math.sin((performance.now() / IDLE_PERIOD) * Math.PI * 2) * IDLE_AMP
      : 0;

    const pose = fitPose(
      plan,
      aspect,
      HOME_AZ + o.az + wobble,
      clamp(HOME_EL + o.el, DRAG_EL_MIN, DRAG_EL_MAX),
    );
    camera.position.copy(pose.pos);
    camera.fov = pose.fov;
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();

    // Качание живёт само: пока оно включено, каждый кадр просит следующий.
    if (wobbling) invalidate();
  });

  return null;
}

/* --- сцена ------------------------------------------------------------ */

export type PlanSceneProps = {
  plan: Plan;
  hovered: ZoneKey | null;
  onHover: (k: ZoneKey | null) => void;
  onPick: (k: RenderKey) => void;
  flyTo: RenderKey | null;
  onPhase: (phase: 'crossfade' | 'done') => void;
  /** reduce или телефон: без качания и без доворота мышью */
  calm: boolean;
};

export default function PlanScene({ plan, hovered, onHover, onPick, flyTo, onPhase, calm }: PlanSceneProps) {
  const orbit = useRef<OrbitState>({ az: 0, el: 0, lastInput: 0, dragging: false });
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null);

  const frit = useMemo(() => fritTexture(), []);
  useEffect(() => () => frit.dispose(), [frit]);

  // Наведение меняет цель прозрачности — значит, есть что дорисовать
  useEffect(() => { invalidate(); }, [hovered]);

  /* Перелёт — не состояние, а производная от пропа. Клик по зоне уходит
     наверх в оболочку, оболочка возвращает flyTo, и сцена просто читает
     его. Отдельное состояние здесь дало бы вторую копию правды и лишний
     цикл рендера на каждом клике. Момент старта берёт себе Rig: он знает
     его точнее — по первому кадру, а не по коммиту React. */
  const flight = useMemo<Flight | null>(() => {
    if (!flyTo) return null;
    const cam = plan.cameras[flyTo];
    return cam ? { key: flyTo, cam } : null;
  }, [flyTo, plan]);

  const pick = useCallback((zone: PlanZone) => {
    // Курсор проехал по экрану — это был доворот сцены, а не выбор зоны.
    if ((dragRef.current?.moved ?? 0) > DRAG_SLOP) return;
    if (zone.target) onPick(zone.target);
  }, [onPick]);

  const down = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (calm || flight) return;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
    orbit.current.dragging = true;
    orbit.current.lastInput = performance.now();
  }, [calm, flight]);

  const move = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const o = orbit.current;
    o.lastInput = performance.now();
    if (!d || !o.dragging) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    d.x = e.clientX;
    d.y = e.clientY;
    o.az = clamp(o.az + dx * 0.22, -DRAG_AZ_LIMIT, DRAG_AZ_LIMIT);
    o.el = clamp(o.el - dy * 0.16, DRAG_EL_MIN - HOME_EL, DRAG_EL_MAX - HOME_EL);
    invalidate();
  }, []);

  const up = useCallback(() => {
    orbit.current.dragging = false;
    orbit.current.lastInput = performance.now();
    // moved обнуляем следующим кадром: клик прилетает сразу за pointerup
    // и должен успеть увидеть, что это было перетаскивание.
    requestAnimationFrame(() => { dragRef.current = null; });
  }, []);

  return (
    <div
      className={`${styles.canvasWrap} ${calm || flight ? '' : styles.grabbable}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
    >
      <Canvas
        flat
        frameloop="demand"
        dpr={[1, calm ? 1.5 : 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: HOME_FOV, near: 0.4, far: 220 }}
        onCreated={() => invalidate()}
      >
        {/* СВЕТ ЗДЕСЬ СИЛЬНЕЕ, ЧЕМ ПОЛОЖЕНО ПРИ ЗАПЕЧЁННОЙ МОДЕЛИ, и это
            вынужденно. Атлас в текущей сборке GLB пересвечен и обрезан:
            72 % ненулевых текселей стоят ровно на 255, медиана по каждому
            из четырёх мешей 252–255. Для сравнения, эталонный рендер
            dollhouse_iso.png нигде не доходит до белого — медиана 196,
            максимум 246. То есть на большей части поверхностей запечённой
            светотени просто не осталось, вытягивать нечего.

            При честном для запечёнки освещении (ambient = π, то есть
            ровно единица для диффузной карты) модель выходит белой
            и плоской. Направленная лампа даёт форму там, где текстура
            её потеряла. Двойного освещения тут нет: нечего удваивать.

            Когда атлас пересоберут с нормальной экспозицией, вернуть
            надо ambient ≈ π и одну слабую направленную на стекло —
            подробности в docs/interior.md. */}
        <ambientLight intensity={1.6} />
        <directionalLight position={[16, 26, 8]} intensity={1.0} />
        <directionalLight position={[-12, 14, -10]} intensity={0.3} />

        <Suspense fallback={null}>
          <Shell />
        </Suspense>

        {plan.zones.map((z) => (
          <Zone
            key={z.key}
            zone={z}
            frit={frit}
            active={hovered === z.key}
            interactive={z.target !== null}
            onHover={onHover}
            onPick={pick}
          />
        ))}

        <Rig plan={plan} orbit={orbit} flight={flight} onPhase={onPhase} idle={!calm} />
      </Canvas>
    </div>
  );
}
