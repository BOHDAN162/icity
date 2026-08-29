"""
geometry v9, вторая половина: сняты остатки джогов у ОБОИХ проёмов
целиком (pv9a — три вершины на севере, две на западе, без повторной
проверки детектором — прямая инструкция), закрыт третий разрыв стены
у Skype-комнат.

Источник — geom_stage3.json из pv9a.py (контур 24 -> 20 вершин).

Разрыв у Skype-комнат (x≈4,06, y 5,4..8,9) — не заново размеченный
кандидат, а измеренный детектором тени по всей длине с шагом 0,08 м:

  y 5.40-6.59  счёт 0.78-1.00  — стена/остекление skype_1, уже в данных
  y 6.59-7.00  счёт 0.00       — дверь skype_1 (дуга подтверждена раньше)
  y 7.10-7.48  счёт 0.94-1.00  — СТЕНА, В ИСХОДНЫХ ДАННЫХ ЕЁ НЕТ ВООБЩЕ
  y 7.63-8.00  счёт 0.00       — дверь skype_2 (дуга подтверждена раньше)
  y 8.00-8.90  счёт 0.86       — стена/остекление skype_2, уже в данных

Это не ошибка объединения (`unary_union` не может нарисовать материал,
которого нет ни в одном источнике) — в walls_ortho для x≈4,03..4,04 есть
только два сегмента (y 5.348-6.197 и y 8.025-9.022), а между ними, ровно
на стыке перегородки skype_1/skype_2 (стена по y=7,107 до x=4,034),
целых 0,45 м стены отсутствуют как данные. Добавлен третий сегмент —
возврат перегородки к фасаду, как и положено в месте T-образного стыка.
Два дверных промежутка (6.59-7.00 и 7.63-8.00) трогать нельзя: там счёт 0,00,
и дуги распахивания уже подтверждены прямым просмотром плана.
"""
import json, math
import numpy as np
from shapely.geometry import Polygon, LineString, Point, MultiPolygon, box
from shapely.ops import unary_union, substring

SRC, DST = 'geom_stage3.json', 'geometry.json'
PANE     = 2.00
GAP      = 0.08
SLOT     = 0.14
SIMP     = 0.004

# подтверждённые разрывы: (cx, cy, w, h, паддинг на сшивку с соседями)
CONFIRMED_GAPS = [
    (6.95, 2.15, 0.22, 0.34, 0.06),
    (22.30, 9.11, 0.26, 0.18, 0.06),
]  # третий разрыв (skype) закрыт не заливкой, а сегментом в walls_ortho выше

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
# Возврат перегородки skype_1/skype_2 (y=7,107) к фасаду (x=4,04) —
# измерено детектором тени, отсутствует в исходном walls_ortho целиком
# (см. заголовок файла). Не резак и не заливка постфактум: обычный
# отсутствующий сегмент перегородки, добавленный туда же, где все остальные.
G['walls_ortho'].append({'o': 'v', 'pos': 4.04, 'p1': 7.05, 'p2': 7.50, 'len': 0.45})

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

# Крошечные дырки (сотые доли м²) — численный артефакт булевой операции
# на стыке с заливкой подтверждённых разрывов, не геометрия. Планка 0,02 м² —
# это меньше площади одного мозаичного текселя атласа, реальная дыра
# такого размера в стене невозможна.
HOLE_MIN = 0.02
out = []
for p in polys:
    holes = [r for r in p.interiors if Polygon(r).area >= HOLE_MIN]
    dropped = len(list(p.interiors)) - len(holes)
    if dropped:
        print(f'  выброшено численных дырок: {dropped} (меньше {HOLE_MIN} м²)')
    out.append(dict(outer=[[round(x, 3), round(y, 3)] for x, y in p.exterior.coords[:-1]],
                    holes=[[[round(x, 3), round(y, 3)] for x, y in r.coords[:-1]]
                           for r in holes]))
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

G['version'] = 9
G['area_check_m2'] = round(slab.area, 2)
G['facade_total_m'] = round(sum(r['len'] for r in G['glazing_runs']), 2)
G['notes'] = ('v9: сняты обе группы вершин у джогов проёмов целиком (север '
              '12-13-14, запад 23-24 в нумерации v7) прямой инструкцией, без '
              'повторной проверки. Проём west entrance пересчитан на новой '
              'прямой стене с сохранением документированной ширины 1,41 м. '
              'Добавлен отсутствовавший в исходных данных сегмент стены '
              'x=4,04, y=7,05-7,50 — возврат перегородки skype_1/skype_2 '
              'к фасаду, измерен детектором тени (счёт 0,94-1,00). Закрыты '
              'три разрыва: (6,95;2,15), (22,30;9,11) заливкой, skype-стык '
              'добавлением сегмента.')
json.dump(G, open(DST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'записан {DST} v{G["version"]}')
