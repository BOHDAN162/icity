'use client';

/* iCITY 113Н — кукольный дом: объёмный план этажа.
   Путь в проекте: components/PlanScene.tsx

   ЧТО ЭТО. Оболочка помещения из dollhouse.glb — плита, стены, пять
   круглых колонн, фасадное остекление с импостами и внутренние
   перегородки. Потолок в модели есть, но скрыт: сверху нужно видеть этаж.
   Мебели в модели нет и не будет — мебель показывают рендеры, а модель
   отвечает за форму и связи зон.

   ФАСАД. Остекления 29,73 м по номиналу и 28,53 м стекла в модели —
   пакеты утоплены на 40 мм с каждой стороны. Прогонов четыре: юг 15,29,
   скос 8,45, восток 3,95, запад 2,04. Запад почти весь глухой: 9,29 м
   сплошной стены из 11,33 м кромки, стекло только у южного угла.

   В периметре три проёма без дверей: вход с запада и два прохода
   из общего коридора с севера. Это дыры, а не двери — ни геометрии
   дверей, ни точек попадания курсора им не нужно. Обмер ширин
   и оговорки к нему — в docs/interior.md.

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
import {
  PLAN_DRAG_SLOP, PLAN_HOME_EL, PLAN_IDLE_AMP, PLAN_IDLE_PERIOD,
  orbitStep, planOrbit,
} from '@/lib/motion';
import styles from './PlanDollhouse.module.css';

const DEG = Math.PI / 180;
const CEIL = 3.8;

/* Дом смотрим с юго-востока и сверху: так читаются и панорамный фасад,
   и скошенный угол, и глубина опенспейса. Ниже 45° мы смотрим на стекло
   снаружи, и пол-кадра занимает наружная сторона фасада вместо этажа;
   выше 58° объём уходит и остаётся чертёж. */
const HOME_AZ = 61;
const HOME_FOV = 30;
const FIT_PAD = 1.02;

/* Амплитуды слежения, доворота и праздношатания — в lib/motion.ts.
   Там же состояние PlanOrbit: его ведёт оболочка, которая слушает
   указатель по всей секции, а сцена только читает. */

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
        /* Материал из GLB как есть. Ниже — не правка, а страховка:
           металл без карты окружения three рисует чёрным, и запечённая
           текстура на таком меше не видна вовсе. В текущей сборке
           металличность у всех четырёх нулевая и ветка не срабатывает,
           но в предыдущей у импостов стояло 0,85, и модель приезжала
           с чёрными стойками. Карту окружения ради одного меша сюда
           не тащим: она стоит и веса, и генерации PMREM на открытии. */
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

  /* frameloop="demand": смена hover сама по себе не рисует кадр. React
     перерисует дерево и передаст новый `active`, но useFrame выше увидит
     это только на СЛЕДУЮЩЕМ кадре — а следующего кадра не будет, если
     его никто не попросит. Без invalidate() здесь подсветка виснет на
     прошлой зоне до первого кадра, который попросит что-то другое
     (праздношатание, доворот) — то есть иногда секундами. */
  const enter = useCallback((e: { stopPropagation(): void }) => {
    e.stopPropagation();
    onHover(zone.key);
    invalidate();
    if (interactive) document.body.style.cursor = 'pointer';
  }, [interactive, onHover, zone.key]);

  const leave = useCallback(() => {
    onHover(null);
    invalidate();
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

/* --- наклон плиты ------------------------------------------------------ */

/* План — плита на центральной оси. Указатель притягивает ближнюю к себе
   кромку: она опускается, противоположная поднимается. Камера при этом
   стоит: облёт читался бы наоборот — уводя камеру влево, мы показываем
   больше правой стороны, и левая кромка кажется поднявшейся.

   ОСИ БЕРУТСЯ ОТ КАМЕРЫ. Экранное «влево» при азимуте 61° не совпадает
   ни с осью X, ни с осью Z: наклон вокруг мировых осей поехал бы вкось.
   Берём горизонтальную проекцию правого вектора камеры (R) и направление
   «в глубину экрана» по земле (F) — и наклоняем вокруг них.

   ЗНАКИ ВЫВОДЯТСЯ, А НЕ ПОДБИРАЮТСЯ. Поворот вокруг оси A на малый угол
   a даёт точке p скорость a·(A × p). Нужно, чтобы при курсоре справа
   правая кромка (p = R) поехала вниз, то есть скорость была −Y. Отсюда
   знак и берётся — через знак (F × R)·Y. Подобранный на глаз минус
   развалился бы при первом же изменении HOME_AZ.

   Порядок сомножителей в векторном произведении здесь имеет значение:
   перепутанный даёт наклон ОТ курсора, а не к нему, и на четырёх
   градусах это не разглядеть на глаз — только сравнив проекции углов
   плана до и после. */
const tiltAxes = (() => {
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const spin = new THREE.Quaternion();

  return (camera: THREE.Camera, az: number, el: number, out: THREE.Quaternion) => {
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0;
    right.normalize();

    // Третий столбец матрицы камеры смотрит НАЗАД, отсюда negate
    fwd.setFromMatrixColumn(camera.matrixWorld, 2);
    fwd.y = 0;
    fwd.normalize().negate();

    // (F × R)·Y — именно в этом порядке: обратный даёт наклон от курсора
    const k = Math.sign(fwd.z * right.x - fwd.x * right.z) || 1;

    // Влево-вправо: вокруг F. Курсор правее — правая кромка вниз.
    out.setFromAxisAngle(fwd, -k * az * DEG);
    // Ближе-дальше: вокруг R. Курсор ниже центра — ближняя кромка вниз.
    spin.setFromAxisAngle(right, -k * el * DEG);
    out.multiply(spin);
    return out;
  };
})();

/* --- камера ----------------------------------------------------------- */

type Flight = { key: RenderKey; cam: PlanCamera };

type RigProps = {
  plan: Plan;
  /** группа, которую наклоняем; камера при этом неподвижна */
  tilt: React.RefObject<THREE.Group | null>;
  flight: Flight | null;
  onPhase: (phase: 'crossfade' | 'done') => void;
  /** праздношатание: выключено на телефоне и при просьбе убрать движение */
  wobble: boolean;
};

/* Камерой правит только этот кадровый обработчик — ни один эффект её
   не трогает. Причина не в чистоте: эффект и кадр пишут в один объект
   в разном порядке, и на первом кадре перелёта камера успевает прыгнуть
   домой. Одна рука на штурвале — одна траектория. */
function Rig({ plan, tilt, flight, onPhase, wobble }: RigProps) {
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

    /* Два движения, и они разной природы. Праздношатание — это по-прежнему
       медленный облёт камерой: он ничего не обещает про направление
       и читается как «сцена живая». Ответ на указатель — наклон самой
       плиты: он обещает направление, и облётом его изображать нельзя.

       Вес покоя гаснет, пока указатель в секции, и возвращается, когда
       он ушёл, — поэтому уход курсора не замораживает план, а возвращает
       его к покою. Палец и курсор пишут в одну цель, потому и ощущаются
       одним поведением. */
    const o = planOrbit;
    const settling = orbitStep(o);

    const swing = wobble && o.idle > 0.002
      ? Math.sin((performance.now() / PLAN_IDLE_PERIOD) * Math.PI * 2) * PLAN_IDLE_AMP * o.idle
      : 0;

    const pose = fitPose(plan, aspect, HOME_AZ + swing, PLAN_HOME_EL);
    camera.position.copy(pose.pos);
    camera.fov = pose.fov;
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();

    /* Наклон считаем после камеры: оси берутся из её матрицы, а она
       только что переставлена. Иначе на первом кадре наклон уехал бы
       по вчерашним осям. */
    const group = tilt.current;
    if (group) {
      camera.updateMatrixWorld();
      tiltAxes(camera, o.ptrAz, o.ptrEl, group.quaternion);
    }

    /* Пока качание живо, оно само просит следующий кадр. Пока слежение
       догоняет — тоже. Догнало и качания нет — сцена замолкает и телефон
       перестаёт греться на неподвижной картинке. */
    if (settling || swing !== 0 || o.dragging) invalidate();
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
  /** праздношатание: выключено на телефоне и при просьбе убрать движение */
  wobble: boolean;
  /** мелкость экрана: понижаем плотность пикселей холста */
  compact: boolean;
};

/* Состояние доворота ведёт оболочка: слушать указатель нужно по всей
   секции, включая пустой фон вокруг плана, а холст занимает не всю её.
   Сцена читает общий planOrbit и отдаёт туда же ручку «нарисуй кадр». */
export default function PlanScene({
  plan, hovered, onHover, onPick, flyTo, onPhase, wobble, compact,
}: PlanSceneProps) {

  const tiltRef = useRef<THREE.Group>(null);

  /* Центр плана в мировых координатах: вокруг него и наклоняем. */
  const pivot = useMemo<[number, number]>(() => {
    const [minX, minY, maxX, maxY] = plan.bounds;
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }, [plan]);

  const frit = useMemo(() => fritTexture(), []);
  useEffect(() => () => frit.dispose(), [frit]);

  // Наведение меняет цель прозрачности — значит, есть что дорисовать
  useEffect(() => { invalidate(); }, [hovered]);

  /* Оболочка слушает указатель по всей секции и должна уметь попросить
     кадр. Импортировать invalidate ей нельзя — она обслуживает и плоский
     план, которому three не нужен вовсе. Оставляем ей ручку. */
  useEffect(() => {
    planOrbit.wake = invalidate;
    return () => { planOrbit.wake = undefined; };
  }, []);

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
    // Палец проехал по экрану — это был доворот плана, а не выбор зоны.
    if (planOrbit.moved > PLAN_DRAG_SLOP) return;
    if (zone.target) onPick(zone.target);
  }, [onPick]);

  return (
    <div className={styles.canvasWrap}>
      <Canvas
        flat
        frameloop="demand"
        dpr={[1, compact ? 1.5 : 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: HOME_FOV, near: 0.4, far: 220 }}
        onCreated={() => invalidate()}
      >
        {/* СВЕТ КОМПЕНСИРУЕТ НЕДОБОР ЭКСПОЗИЦИИ АТЛАСА — И ДЕЛАЕТ ЭТО
            ЧЕРЕЗ AMBIENT, А НЕ ЧЕРЕЗ НАПРАВЛЕННУЮ ЛАМПУ. Разница между
            этими двумя способами и есть вся суть блока.

            Атлас не обрезан: клипнуто 0,2 % текселей, светотень
            и мягкие тени от перегородок на месте. И он больше не тёмный —
            в v7 автоэкспозиция считается в линейном пространстве и кладёт
            медиану ровно в 199 sRGB, как в эталонном рендере.

            Поэтому множителя здесь больше нет. π — честная единица для
            диффузной карты: текстура выходит на экран один в один.
            Компенсация ×1,35 добирала недобор атласа v6 (медиана 174,
            в линейной шкале 26 %); с исправленным атласом она бы
            пересветила сцену ровно на эти же 26 %.

            Ambient умножает текстуру и сохраняет все её перепады.
            Направленная лампа добавляет собственную растушёвку поверх —
            она не знает про запечённые тени и разбавляет их, поэтому
            оставлена слабой и только ради стекла: у него текстуры нет
            и форму держать больше нечем. */}
        <ambientLight intensity={Math.PI} />
        <directionalLight position={[16, 26, 8]} intensity={0.2} />

        {/* Две вложенные группы — это поворот вокруг центра плана,
            а не вокруг начала координат. Внешняя стоит в центре и
            вращается, внутренняя сдвинута обратно. Без этого плита
            крутилась бы вокруг угла и уезжала бы из кадра.

            Зоны лежат ВНУТРИ той же группы. Иначе подсветка и области
            попадания курсора остались бы на месте, а оболочка уехала
            бы из-под них. */}
        <group ref={tiltRef} position={[pivot[0], 0, pivot[1]]}>
          <group position={[-pivot[0], 0, -pivot[1]]}>
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
          </group>
        </group>

        <Rig plan={plan} tilt={tiltRef} flight={flight} onPhase={onPhase} wobble={wobble} />
      </Canvas>
    </div>
  );
}
