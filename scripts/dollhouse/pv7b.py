"""
geometry v7, вторая половина: остекление, импосты и стены по новому контуру.

Контур уже вычищен в pv7a.py (geom_stage1.json): 34 -> 25 вершин, 244,08 м².
Здесь по нему заново строятся стёкла, импосты и wall_polygons.

Главное правило, ради которого всё это переписано: проём вырезается ПО КОНТУРУ
плиты — берётся кусок самой границы между концами проёма и раздувается. Хорда
между теми же концами на повороте контура срезает угол и оставляет клин.
"""
import json, math
import numpy as np
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union, substring

SRC, DST = 'geom_stage1.json', 'geometry.json'
PANE     = 2.00     # целевая ширина стеклопакета, м
GAP      = 0.08     # зазор под импост, м
SLOT     = 0.14     # радиус замыкания щелей у торцов перегородок, м
SIMP     = 0.004

G = json.load(open(SRC, encoding='utf-8'))
TH = G['wall_th']
slab = Polygon(G['slab'])
ring_line = slab.exterior
RL = ring_line.length
print(f'плита: {len(G["slab"])} вершин, {slab.area:.2f} м², периметр {RL:.2f} м')


def arc(p1, p2):
    """кусок границы плиты между двумя точками — короткая из двух дуг"""
    s1 = ring_line.project(Point(*p1))
    s2 = ring_line.project(Point(*p2))
    a, b = min(s1, s2), max(s1, s2)
    if (b - a) <= RL / 2:
        return substring(ring_line, a, b)
    # проём пересекает нулевую точку кольца — склеиваем через неё
    return LineString(list(substring(ring_line, b, RL).coords)
                      + list(substring(ring_line, 0.0, a).coords)[1:])


def inward(p1, p2, d):
    """сдвиг отрезка на d по нормали внутрь плиты"""
    (x1, y1), (x2, y2) = p1, p2
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * d, dx / L * d
    mid = ((x1 + x2) / 2, (y1 + y2) / 2)
    if not slab.contains(Point(mid[0] + nx, mid[1] + ny)):
        nx, ny = -nx, -ny
    return (x1 + nx, y1 + ny), (x2 + nx, y2 + ny)


# ---------------------------------------------------------------- 1. остекление
panes, mullions = [], []
for r in G['glazing_runs']:
    a, b = inward((r['x1'], r['y1']), (r['x2'], r['y2']), TH / 2)
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, round(L / PANE))
    w = (L - (n - 1) * GAP) / n
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    for i in range(n):
        t0 = i * (w + GAP)
        t1 = t0 + w
        panes.append(dict(x1=round(a[0] + ux * t0, 3), y1=round(a[1] + uy * t0, 3),
                          x2=round(a[0] + ux * t1, 3), y2=round(a[1] + uy * t1, 3)))
        if i < n - 1:
            tm = t1 + GAP / 2
            mullions.append(dict(cx=round(a[0] + ux * tm, 3),
                                 cy=round(a[1] + uy * tm, 3)))
    print(f'  {r["side"]:>10}: {L:.2f} м -> {n} стёкол по {w:.3f} м, {n-1} импостов')
G['glazing_facade'] = panes
G['mullions'] = mullions
print(f'стёкол {len(panes)}, импостов {len(mullions)}, '
      f'фасад {sum(r["len"] for r in G["glazing_runs"]):.2f} м')

# ---------------------------------------------------------------- 2. резаки
# cap_style=2 (плоский торец) обязателен: с круглым торцом резак вылезает
# на свой радиус за концы проёма и съедает по 0,275 м стены с каждой стороны —
# на четырёх остеклениях и трёх проёмах это 0,79 м² лишнего.
cutters = []
for r in G['glazing_runs']:
    cutters.append(arc((r['x1'], r['y1']), (r['x2'], r['y2']))
                   .buffer(TH * 1.1, cap_style=2, join_style=2))
for o in G['openings']:
    cutters.append(arc((o['x1'], o['y1']), (o['x2'], o['y2']))
                   .buffer(TH * 1.6, cap_style=2, join_style=2))
CUT = unary_union(cutters)

# ---------------------------------------------------------------- 3. кольцо
inner = slab.buffer(-TH, join_style=2, mitre_limit=12)
ring = slab.difference(inner)
print(f'кольцо периметра: {ring.area:.2f} м²')
ring = ring.difference(CUT)

# ---------------------------------------------------------------- 4. перегородки
parts = []
for w in G['walls_ortho']:
    if w['o'] == 'h':
        seg = LineString([(w['p1'], w['pos']), (w['p2'], w['pos'])])
    else:
        seg = LineString([(w['pos'], w['p1']), (w['pos'], w['p2'])])
    parts.append(seg.buffer(TH / 2, cap_style=2, join_style=2))
for w in G['walls_diag']:
    parts.append(LineString([(w['x1'], w['y1']), (w['x2'], w['y2'])])
                 .buffer(TH / 2, cap_style=2, join_style=2))
PART = unary_union(parts).intersection(slab)
print(f'перегородок {len(parts)}, площадь {PART.area:.2f} м²')

walls = unary_union([ring, PART])

# ---------------------------------------------------------------- 5. щели
# buffer наружу и обратно замыкает и зазоры у торцов перегородок,
# и пустоту 0,15 x 2,80 м между двумя параллельными стенами санузлов
before = walls.area
walls = walls.buffer(SLOT, join_style=2, mitre_limit=12) \
             .buffer(-SLOT, join_style=2, mitre_limit=12)
walls = walls.difference(CUT).intersection(slab)
print(f'замыкание щелей: {before:.2f} -> {walls.area:.2f} м²')

# ---------------------------------------------------------------- 6. колонны
cols = unary_union([Point(c['cx'], c['cy']).buffer(c['d'] / 2, quad_segs=24)
                    for c in G['columns']])
walls = walls.difference(cols).simplify(SIMP)
walls = walls.intersection(slab)

polys = list(walls.geoms) if isinstance(walls, MultiPolygon) else [walls]
polys = [p for p in polys if p.area > 0.01]
polys.sort(key=lambda p: -p.area)

out = []
for p in polys:
    out.append(dict(outer=[[round(x, 3), round(y, 3)] for x, y in p.exterior.coords[:-1]],
                    holes=[[[round(x, 3), round(y, 3)] for x, y in r.coords[:-1]]
                           for r in p.interiors]))
G['wall_polygons'] = out

# ---------------------------------------------------------------- проверка
U = unary_union([Polygon(w['outer'], w['holes']) for w in out])
outside = U.difference(slab).area
nholes = sum(len(w['holes']) for w in out)
print('-' * 60)
print(f'полигонов стен: {len(out)} (дырок {nholes})')
print(f'площадь стен:   {U.area:.2f} м²')
print(f'вне плиты:      {outside:.4f} м²  {"OK" if outside < 0.005 else "!!! ПЛОХО"}')
print(f'стёкол {len(panes)}, импостов {len(mullions)}')

G['version'] = 7
G['area_check_m2'] = round(slab.area, 2)
G['facade_total_m'] = round(sum(r['len'] for r in G['glazing_runs']), 2)
G['notes'] = ('v7: контур плиты очищен от дуг дверных проёмов (34 -> 25 вершин, '
              '244,1 м²). Стёкла, импосты и wall_polygons перестроены по новому '
              'контуру. Проёмы режутся дугой самой границы плиты, а не хордой. '
              'Стен вне плиты нет.')
json.dump(G, open(DST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'записан {DST} v{G["version"]}')
