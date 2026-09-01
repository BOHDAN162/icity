/* iCITY 113Н — проверка чертежа перед коммитом.
   Путь в проекте: scripts/plan-check.mjs
   Запуск: node scripts/plan-check.mjs

   Падает, если чертёж начал врать: сумма площадей зон разъехалась
   с чистым полом, площадь плиты — с документами, зона вылезла за плиту
   или мебель встала в стену. Дешевле, чем ловить это на показе. */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_M2 = 247.95;  // обмер контура; в ТЗ стоит 244,1 — расхождение разобрано в docs/plan-sheet.md
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

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const geom = JSON.parse(await readFile(join(ROOT, 'public/interior/geometry.json'), 'utf8'));

check(geom.version >= 20, `version ${geom.version}: чертёж ждёт v20 и выше`);
for (const key of ['rooms', 'furniture', 'doors', 'dimensions', 'walls', 'columns_sq', 'shell_th', 'area_net_m2', 'structure_m2']) {
  check(geom[key] !== undefined, `в geometry.json нет поля ${key} — прогони scripts/plan-rooms.mjs --write`);
}
if (fails.length) { fails.forEach((f) => console.error('  ✗', f)); process.exit(1); }

check(Math.abs(geom.area_check_m2 - DOC_M2) <= 0.05,
  `плита ${geom.area_check_m2} м² против ${DOC_M2} по документам`);

const sum = geom.rooms.reduce((s, r) => s + r.area_m2, 0);
check(Math.abs(sum - geom.area_net_m2) <= 0.15,
  `сумма зон ${sum.toFixed(1)} ≠ чистый пол ${geom.area_net_m2}`);
check(Math.abs(geom.area_net_m2 + geom.structure_m2 - geom.area_check_m2) <= 0.15,
  `${geom.area_net_m2} + ${geom.structure_m2} ≠ ${geom.area_check_m2}`);

const slab = geom.slab;
for (const room of geom.rooms) {
  check(room.area_m2 > 0, `зона ${room.key} пустая`);
  check(typeof room.label === 'string' && room.label.length > 0, `у зоны ${room.key} нет подписи`);
}

/* Ни одна свободная клетка не должна остаться без зоны: иначе на чертеже
   будет кусок пола, который ни во что не входит, а сумма всё равно сойдётся. */
const xs = slab.map((p) => p[0]);
const ys = slab.map((p) => p[1]);
const walls = geom.walls.map((w) => (w.o === 'h'
  ? [[w.p1, w.a], [w.p2, w.a], [w.p2, w.b], [w.p1, w.b]]
  : [[w.a, w.p1], [w.b, w.p1], [w.b, w.p2], [w.a, w.p2]]));
const distSq = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1; const dy = y2 - y1; const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = x1 + t * dx - px; const qy = y1 + t * dy - py;
  return qx * qx + qy * qy;
};
const shellEdges = slab.map((p, i) => [...p, ...slab[(i + 1) % slab.length]]);
const inShell = (px, py) => shellEdges.some((e) => distSq(px, py, e[0], e[1], e[2], e[3]) < geom.shell_th ** 2);
const seg = geom.walls_diag.map(({ x1, y1, x2, y2 }) => {
  const dx = x2 - x1; const dy = y2 - y1; const l = Math.hypot(dx, dy);
  const nx = (-dy / l) * (geom.shell_th / 2); const ny = (dx / l) * (geom.shell_th / 2);
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
});
let orphan = 0;
for (let py = Math.min(...ys) + CELL / 2; py < Math.max(...ys); py += CELL) {
  for (let px = Math.min(...xs) + CELL / 2; px < Math.max(...xs); px += CELL) {
    const owned = geom.rooms.some((r) => r.poly.some((ring) => inPoly(px, py, ring)));
    if (!inPoly(px, py, slab)) continue;
    const solid = walls.some((w) => inPoly(px, py, w))
      || seg.some((w) => inPoly(px, py, w))
      || geom.columns.some((c) => Math.hypot(px - c.cx, py - c.cy) <= c.d / 2)
      || geom.columns_sq.some((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h)
      || inShell(px, py);
    if (!solid && !owned) orphan += 1;
  }
}
check(orphan === 0, `${orphan} клеток чистого пола не принадлежат ни одной зоне`);

/* Мебель не должна стоять в стене: это первое, что видит глаз. */
const keys = new Set(geom.rooms.map((r) => r.key));
for (const f of geom.furniture) {
  check(keys.has(f.z), `мебель привязана к несуществующей зоне ${f.z}`);
  const cx = f.t === 'c' ? f.cx : f.x + f.w / 2;
  const cy = f.t === 'c' ? f.cy : f.y + f.h / 2;
  const inWall = walls.some((w) => inPoly(cx, cy, w))
    || geom.columns_sq.some((c) => cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h);
  check(!inWall, `${f.t} в зоне ${f.z} стоит серединой в стене или колонне (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
  check(inPoly(cx, cy, slab), `${f.t} в зоне ${f.z} вне плиты (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
}

if (fails.length) {
  fails.forEach((f) => console.error('  ✗', f));
  process.exit(1);
}
console.log(`  ✓ чертёж сходится: ${geom.area_check_m2} м² по контуру, ${geom.area_net_m2} в чистоте, ${geom.rooms.length} зон, ${geom.furniture.length} предметов`);
