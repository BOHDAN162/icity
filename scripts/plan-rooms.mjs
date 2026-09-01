/* iCITY 113Н — обмер зон чертежа.
   Путь в проекте: scripts/plan-rooms.mjs
   Запуск: node scripts/plan-rooms.mjs [--write]

   ЗАЧЕМ. Площади зон на чертеже должны быть обмерены, а не набраны
   руками: без этого они разъедутся с суммой при первой же правке
   полигона. Скрипт растеризует план с шагом 1 см и раздаёт каждую
   свободную клетку ровно одной зоне. Сумма сходится по построению.

   ЧТО ТАКОЕ «СВОБОДНАЯ КЛЕТКА». Внутри плиты, вне всех wall_polygons,
   вне диагональной стены и вне колонн. То есть чистый пол — то, по чему
   можно ходить. Отсюда и расхождение с документами: по контуру плиты
   244,1 м², чистого пола 220,4, разницу занимают перегородки и колонны.

   С --write результат уезжает в public/interior/geometry.json:
   поля rooms, furniture, doors, dimensions и area_net_m2. */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROOMS, FURNITURE, DOORS, DIMENSIONS, WALLS, COLUMNS_SQ, SHELL_TH } from './plan-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOM = join(ROOT, 'public/interior/geometry.json');
const CELL = 0.01;

const inPoly = (px, py, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

const inRings = (px, py, rings) => rings.some((r) => inPoly(px, py, r));

/** Прямоугольник вокруг отрезка: так диагональная стена получает толщину. */
const thickSegment = ({ x1, y1, x2, y2 }, th) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * (th / 2);
  const ny = (dx / len) * (th / 2);
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
};

/** Квадрат расстояния от точки до отрезка — нужен наружному кольцу. */
const distSq = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = x1 + t * dx - px;
  const qy = y1 + t * dy - py;
  return qx * qx + qy * qy;
};

/** Прямоугольник стены как кольцо. */
const wallRing = (w) => (w.o === 'h'
  ? [[w.p1, w.a], [w.p2, w.a], [w.p2, w.b], [w.p1, w.b]]
  : [[w.a, w.p1], [w.b, w.p1], [w.b, w.p2], [w.a, w.p2]]);

const main = async () => {
  const geom = JSON.parse(await readFile(GEOM, 'utf8'));
  const slab = geom.slab;
  const walls = WALLS.map(wallRing);
  const diag = geom.walls_diag.map((d) => thickSegment(d, SHELL_TH));
  /* Наружная стена — полоса внутрь от контура плиты. Считаем её не
     полигоном, а расстоянием до кромки: смещать многоугольник со скошенным
     углом честно дороже, чем померить расстояние, а на растре 1 см разницы
     между этими двумя способами нет. */
  const edges = slab.map((p, i) => [...p, ...slab[(i + 1) % slab.length]]);
  const shellSq = SHELL_TH * SHELL_TH;
  const inShell = (px, py) => edges.some((e) => distSq(px, py, e[0], e[1], e[2], e[3]) < shellSq);

  const xs = slab.map((p) => p[0]);
  const ys = slab.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const nx = Math.round((maxX - minX) / CELL);
  const ny = Math.round((maxY - minY) / CELL);
  const owner = new Int8Array(nx * ny).fill(-1);
  const idx = new Map(ROOMS.map((r, i) => [r.key, i]));

  const counts = new Map(ROOMS.map((r) => [r.key, 0]));
  const gross = new Map(ROOMS.map((r) => [r.key, 0]));
  let free = 0;
  let slabCells = 0;
  let orphan = 0;
  let doubled = 0;
  const orphanSample = [];

  for (let gy = 0; gy < ny; gy += 1) {
    const py = minY + (gy + 0.5) * CELL;
    for (let gx = 0; gx < nx; gx += 1) {
      const px = minX + (gx + 0.5) * CELL;
      if (!inPoly(px, py, slab)) continue;
      slabCells += 1;
      const solid = walls.some((w) => inPoly(px, py, w))
        || diag.some((w) => inPoly(px, py, w))
        || geom.columns.some((c) => Math.hypot(px - c.cx, py - c.cy) <= c.d / 2)
        || COLUMNS_SQ.some((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h)
        || inShell(px, py);

      let own = null;
      let hits = 0;
      for (const room of ROOMS) {
        if (!inRings(px, py, room.poly)) continue;
        hits += 1;
        if (own === null) own = room.key;
      }
      if (hits > 1) doubled += 1;
      if (own !== null) gross.set(own, gross.get(own) + 1);

      if (solid) continue;
      free += 1;
      if (own === null) {
        orphan += 1;
        if (orphanSample.length < 12 && orphan % 97 === 1) {
          orphanSample.push([+px.toFixed(2), +py.toFixed(2)]);
        }
        continue;
      }
      counts.set(own, counts.get(own) + 1);
      owner[gy * nx + gx] = idx.get(own);
    }
  }

  /* Якорь подписи. Центроид сюда не годится: у Г-образного ресепшна и
     у коридора он попадает в стену или в узкое место, и подпись лезет
     на перегородку. Ищем клетку, вокруг которой больше всего свободного
     хода, причём горизонтальный ход важнее вертикального — подпись
     широкая и низкая. Заодно возвращаем, сколько места есть на самом
     деле: лист по этому числу решает, влезет полное имя или короткое.

     Четыре линейных прохода по сетке дают для каждой клетки, насколько
     далеко тянется её зона влево, вправо, вверх и вниз. */
  const L = new Int16Array(nx * ny);
  const R = new Int16Array(nx * ny);
  const U = new Int16Array(nx * ny);
  const D = new Int16Array(nx * ny);
  for (let gy = 0; gy < ny; gy += 1) {
    for (let gx = 0; gx < nx; gx += 1) {
      const k = gy * nx + gx;
      L[k] = owner[k] < 0 ? 0 : (gx > 0 && owner[k - 1] === owner[k] ? L[k - 1] + 1 : 1);
      U[k] = owner[k] < 0 ? 0 : (gy > 0 && owner[k - nx] === owner[k] ? U[k - nx] + 1 : 1);
    }
  }
  for (let gy = ny - 1; gy >= 0; gy -= 1) {
    for (let gx = nx - 1; gx >= 0; gx -= 1) {
      const k = gy * nx + gx;
      R[k] = owner[k] < 0 ? 0 : (gx < nx - 1 && owner[k + 1] === owner[k] ? R[k + 1] + 1 : 1);
      D[k] = owner[k] < 0 ? 0 : (gy < ny - 1 && owner[k + nx] === owner[k] ? D[k + nx] + 1 : 1);
    }
  }

  /* Крест из четырёх лучей ещё не значит, что подпись влезет: у ресепшна
     нашлась строка, свободная на шесть метров вправо и влево, но на
     двадцать сантиметров ниже неё уже стена, и подпись легла на неё.
     Поэтому ширину меряем не по самой строке, а по полосе высотой
     2·BAND: клетка считается годной, только если зона тянется на BAND
     вверх и вниз от неё. Это ровно та полоса, которую занимает подпись
     из двух строк на десктопном масштабе: 28 px при 38 px на метр. */
  const BAND = Math.round(0.35 / CELL);
  const wide = new Int8Array(nx * ny);
  for (let k = 0; k < owner.length; k += 1) {
    wide[k] = owner[k] >= 0 && U[k] > BAND && D[k] > BAND ? 1 : 0;
  }
  const LB = new Int16Array(nx * ny);
  const RB = new Int16Array(nx * ny);
  for (let gy = 0; gy < ny; gy += 1) for (let gx = 0; gx < nx; gx += 1) {
    const k = gy * nx + gx;
    LB[k] = wide[k] ? (gx > 0 && wide[k - 1] && owner[k - 1] === owner[k] ? LB[k - 1] + 1 : 1) : 0;
  }
  for (let gy = ny - 1; gy >= 0; gy -= 1) for (let gx = nx - 1; gx >= 0; gx -= 1) {
    const k = gy * nx + gx;
    RB[k] = wide[k] ? (gx < nx - 1 && wide[k + 1] && owner[k + 1] === owner[k] ? RB[k + 1] + 1 : 1) : 0;
  }

  const anchors = new Map();
  {
    const best = ROOMS.map(() => ({ score: -1, k: -1 }));
    for (let k = 0; k < owner.length; k += 1) {
      const id = owner[k];
      if (id < 0) continue;
      const hw = wide[k] ? Math.min(LB[k], RB[k]) : Math.min(L[k], R[k]) * 0.001;
      const hh = Math.min(U[k], D[k]);
      // 2,5 — во столько раз подпись шире, чем высока; ниже этого
      // отношения выигрывает вертикальный запас, и якорь уезжает в проход.
      // Вторым разрядом идёт hh: при равной ширине побеждает клетка,
      // вокруг которой больше воздуха сверху и снизу, иначе якорь
      // прилипает к первой попавшейся строке зоны.
      const score = Math.min(hw, hh * 2.5) * 4096 + hh;
      if (score > best[id].score) { best[id] = { score, k }; }
    }
    ROOMS.forEach((r, i) => {
      const { k } = best[i];
      if (k < 0) { anchors.set(r.key, { anchor: [0, 0], fit_w: 0, fit_h: 0 }); return; }
      const gx = k % nx; const gy = (k - gx) / nx;
      anchors.set(r.key, {
        anchor: [
          +(minX + (gx + 0.5) * CELL).toFixed(2),
          +(minY + (gy + 0.5) * CELL).toFixed(2),
        ],
        fit_w: +(2 * (wide[k] ? Math.min(LB[k], RB[k]) : Math.min(L[k], R[k])) * CELL).toFixed(2),
        fit_h: +(2 * Math.min(U[k], D[k]) * CELL).toFixed(2),
      });
    });
  }

  const A = CELL * CELL;
  const rows = ROOMS.map((r) => ({
    key: r.key,
    label: r.label,
    short: r.short,
    enclosed: r.enclosed,
    poly: r.poly,
    area_m2: +(counts.get(r.key) * A).toFixed(1),
    gross_m2: +(gross.get(r.key) * A).toFixed(1),
    ...anchors.get(r.key),
  }));

  const netSum = rows.reduce((s, r) => s + r.area_m2, 0);
  const pad = (s, n) => String(s).padEnd(n);
  console.log('  зона                     в чистоте   по контуру');
  for (const r of rows) {
    console.log(`  ${pad(r.label, 24)} ${String(r.area_m2.toFixed(1)).padStart(7)}  ${String(r.gross_m2.toFixed(1)).padStart(10)}`);
  }
  console.log(`  ${pad('— сумма', 24)} ${netSum.toFixed(1).padStart(7)}`);
  console.log('');
  console.log(`  плита по контуру      ${(slabCells * A).toFixed(2)} м²  (в файле ${geom.area_check_m2})`);
  console.log(`  чистого пола          ${(free * A).toFixed(2)} м²`);
  console.log(`  перегородки и колонны ${((slabCells - free) * A).toFixed(2)} м²`);
  console.log('  по документам         244.10 м²  (ТЗ)');
  console.log(`  клеток без зоны       ${orphan}${orphan ? `  например ${JSON.stringify(orphanSample)}` : ''}`);
  console.log(`  клеток в двух зонах   ${doubled}`);

  if (!process.argv.includes('--write')) {
    console.log('\n  (без --write файл не тронут)');
    return;
  }

  geom.version = 20;
  geom.walls = WALLS;
  geom.columns_sq = COLUMNS_SQ;
  geom.shell_th = SHELL_TH;
  delete geom.wall_polygons;   // v17-наследие: толщина 250 у всего подряд
  geom.area_net_m2 = +(free * A).toFixed(1);
  geom.structure_m2 = +((slabCells - free) * A).toFixed(1);
  geom.rooms = rows;
  geom.furniture = FURNITURE;
  geom.doors = DOORS;
  geom.dimensions = DIMENSIONS;
  geom.notes = `${geom.notes} v20: стены пересняты с растра (перегородки 132 мм, капитальные 296, шахта 425), наружная стена — кольцо ${SHELL_TH} внутрь от контура; wall_polygons удалены; добавлены две квадратные несущие колонны и подсобная в северо-восточном углу. Площади считает scripts/plan-rooms.mjs, руками не править.`;
  await writeFile(GEOM, `${JSON.stringify(geom)}\n`);
  console.log('\n  записано в public/interior/geometry.json');
};

main();
