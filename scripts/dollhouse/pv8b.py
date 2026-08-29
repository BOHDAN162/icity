"""
geometry v8, вторая половина: убран северный джог (pv8a), закрыты два
подтверждённых разрывов в стенах.

Источник — geom_stage2.json из pv8a.py (контур 25 -> 24 вершины, джог
у прохода из общего коридора убран). Логика стёкол/импостов/стен и резаков —
без изменений против pv7b.py.

Два разрыва в объединении стен — не считанные заново, а взятые из
предметной разметки и подтверждённые по плану детектором тени
(scripts/dollhouse/wall_gap_check.py, порог 0,85):

  A (6,95; 2,15) 0,22×0,34 м — счёт 1,00. В walls_ortho это буквально два
    отдельных сегмента одной и той же вертикальной стены (x≈6,965 и 6,971),
    между которыми зазор y 1,977..2,318 — 0,341 м, ровно высота разрыва.
    Не геометрическая ошибка резака, а неполные исходные данные: сегменты
    не сшиты. Добавлен третий сегмент-мост.

  B (22,30; 9,11) 0,26×0,18 м — счёт 1,00. Тонкий зигзагообразный клин
    там, где диагональное остекление сходится с восточным у колонны
    (21,291; 8,935). Причина не прослежена до одного шага пайплайна —
    похоже на неудачное пересечение резака остекления с вычетом колонны
    на самом стыке. Закрыто прямой заливкой подтверждённого прямоугольника,
    а не переработкой резаков: правка резаков ради одного стыка рискует
    задеть остальные 27 м фасада, которые уже проверены.

Остальные семь кандидатов из разметки (0,90 м, «нужно подтверждение»)
по детектору и по прямому просмотру плана — реальные дверные проёмы
(видны дуги распахивания) либо мебель (стол, растение), а не разрывы
стен. Не закрыты. Два из них, на x≈3,97, — двери гардероба и Skype-комнат
из задачи 3, что и предсказывалось в задании.
"""
import json, math
import numpy as np
from shapely.geometry import Polygon, LineString, Point, MultiPolygon, box
from shapely.ops import unary_union, substring

SRC, DST = 'geom_stage2.json', 'geometry.json'
PANE     = 2.00
GAP      = 0.08
SLOT     = 0.14
SIMP     = 0.004

# подтверждённые разрывы: (cx, cy, w, h, паддинг на сшивку с соседями)
CONFIRMED_GAPS = [
    (6.95, 2.15, 0.22, 0.34, 0.03),
    (22.30, 9.11, 0.26, 0.18, 0.03),
]

G = json.load(open(SRC, encoding='utf-8'))
TH = G['wall_th']
slab = Polygon(G['slab'])
ring_line = slab.exterior
RL = ring_line.length
print(f'плита: {len(G["slab"])} вершин, {slab.area:.2f} м², периметр {RL:.2f} м')


def arc(p1, p2):
    s1 = ring_line.project(Point(*p1))
    s2 = ring_line.project(Point(*p2))
    a, b = min(s1, s2), max(s1, s2)
    if (b - a) <= RL / 2:
        return substring(ring_line, a, b)
    return LineString(list(substring(ring_line, b, RL).coords)
                      + list(substring(ring_line, 0.0, a).coords)[1:])


def inward(p1, p2, d):
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
before = walls.area
walls = walls.buffer(SLOT, join_style=2, mitre_limit=12) \
             .buffer(-SLOT, join_style=2, mitre_limit=12)
walls = walls.difference(CUT).intersection(slab)
print(f'замыкание щелей: {before:.2f} -> {walls.area:.2f} м²')

# ---------------------------------------------------------------- 5b. подтверждённые разрывы
fills = []
for cx, cy, w, h, pad in CONFIRMED_GAPS:
    fills.append(box(cx - w/2 - pad, cy - h/2 - pad, cx + w/2 + pad, cy + h/2 + pad))
before2 = walls.area
walls = unary_union([walls] + fills).intersection(slab)
print(f'заливка подтверждённых разрывов: {before2:.3f} -> {walls.area:.3f} м² '
      f'(+{walls.area - before2:.3f})')

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

G['version'] = 8
G['area_check_m2'] = round(slab.area, 2)
G['facade_total_m'] = round(sum(r['len'] for r in G['glazing_runs']), 2)
G['notes'] = ('v8: снят северный джог у прохода (вершина 14 в v7, не '
              'подтверждена планом — реальная стена на 0,23-0,27 м севернее; '
              'западный джог у входа, наоборот, планом подтверждён и оставлен). '
              'Закрыты два подтверждённых разрыва в стенах: (6,95;2,15) и '
              '(22,30;9,11). Семь других кандидатов из разметки — реальные '
              'дверные проёмы или мебель, оставлены как есть.')
json.dump(G, open(DST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'записан {DST} v{G["version"]}')
