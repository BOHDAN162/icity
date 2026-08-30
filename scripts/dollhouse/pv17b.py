"""
geometry v10, вторая половина: западный угол вернулся из v8, но БЕЗ
вершины-острия (см. pv10a.py) — изгиб есть, лезвия в пустоту нет.
Северный проход остаётся прямым как в v9, без изменений.

Источник — geom_stage4.json из pv10a.py (контур 20 + 1 = 21 вершина).
Стены/стёкла/проёмы — тот же пайплайн, что в v9, без правок ниже этой
строки, кроме комментариев.
"""
import json, math
import numpy as np
from shapely.geometry import Polygon, LineString, Point, MultiPolygon, box
from shapely.ops import unary_union, substring

SRC, DST = 'geom_v17_data.json', 'geometry.json'
PANE     = 2.00
GAP      = 0.08
SLOT     = 0.14
SIMP     = 0.004

# подтверждённые разрывы: (cx, cy, w, h, паддинг на сшивку с соседями)
CONFIRMED_GAPS = []  # v16: коробки-заливки заменены геометрией (сегмент x=6.968 и продлённая диагональ)  # третий разрыв (skype) закрыт не заливкой, а сегментом в walls_ortho выше

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
# ЗЕЛЁНЫЙ: проём западного входа начинался на 7,8 см ниже угла стены —
# оставалась полоска-косяк с изломом резака. Начинаем проём ровно от угла
# (вершина плиты 0,9; 2,799), ширину 1,41 держим, сдвигая второй косяк.
_o = G['openings'][0]; assert _o['name'] == 'west entrance'
_corner = min(G['slab'], key=lambda v: (v[0]-0.9)**2 + (v[1]-2.799)**2)
_s0 = ring_line.project(Point(*_corner)); _sf = ring_line.project(Point(_o['x2'], _o['y2']))
_s1 = _s0 + 1.41 if _sf > _s0 else _s0 - 1.41
_p1 = ring_line.interpolate(_s1).coords[0]
_o.update(x1=round(_corner[0],3), y1=round(_corner[1],3), x2=round(_p1[0],3), y2=round(_p1[1],3), len=1.41)
print('west entrance ->', _o)

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
pass  # v15: сегменты берутся только из данных, ничего не дописываем
# Второй разрыв этого раунда: конец стены#7 (11,637; 4,307) и конец
# стены#29 (11,625; 4,059) — 0,248 м друг от друга, у комнаты сразу
# восточнее прохода. Обход плана по колонкам (робастное окно 25 px,
# порог 0,7) не находит НИ ОДНОГО разрыва в белом на всём x=9,0..12,2 —
# комната с умывальником продолжается непрерывно. Стена нужна, добавлена
# тем же способом, что и возврат перегородки выше.
#
# ВАЖНО: часть этого отрезка лежит восточнее нынешней границы плиты
# (она сейчас проходит у x≈10,87-10,9 — прямая по проходу, оставлена как
# есть по прямому указанию). PART.intersection(slab) обрежет добавленный
# сегмент по этой границе так же, как обрезает стены #4 и #7 сейчас;
# видимый эффект будет неполным, пока граница плиты здесь не пересмотрена
# отдельно — это уже не про недостающий сегмент, а про саму плиту.
pass  # v15: обрубок уже в данных, не дописываем повторно

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

# ---------------------------------------------------------------- 5c. розовые: торцы полной толщины
# В двух местах осевая стены лежит у самой границы плиты и резак проёма
# срезал половину толщины — оставалась полоска ~0,1 м. Доводим до 0,25 м
# внутрь от границы, строго в пределах обводки.
# у западного входа коробка давала ступеньку 2,5 см на внутренней грани
# (грань кольца там наклонная). Берём кусок самой границы плиты и
# сдвигаем внутрь ровно на TH — вставка ложится заподлицо с кольцом.
_seg = LineString([ring_line.interpolate(ring_line.project(Point(0.89, 2.8))).coords[0],
                   ring_line.interpolate(ring_line.project(Point(1.32, 2.79))).coords[0]])
_a = _seg.buffer(TH, single_sided=True); _b = _seg.buffer(-TH, single_sided=True)
_west = _a if slab.contains(_a.centroid) else _b
PINK = [_west,                             # у западного входа, заподлицо с кольцом
        box(10.62, 2.21, 10.92, 2.70)]    # у северного прохода: граница x≈10,88, внутрь -x
walls = unary_union([walls] + PINK).intersection(slab)

# ---------------------------------------------------------------- 6. колонны
cols = unary_union([Point(c['cx'], c['cy']).buffer(c['d'] / 2, quad_segs=24)
                    for c in G['columns']])
walls = walls.difference(cols).simplify(SIMP)
walls = walls.intersection(slab)

# У СВ колонны диагональная стена входит в скошенный фасад под непрямым
# углом и оставляет микро-скос 3,7 см — лишний излом. Локальное упрощение
# только там (0,04 м), остальные стыки не трогаем.
_ne = box(21.6, 8.7, 22.7, 9.8)
# и у западного входа: резак, стартующий ровно в вершине плиты, оставляет
# ус в 1 см — упрощение 0,02 только в этой зоне
_we = box(0.8, 2.7, 1.45, 3.2)
walls = unary_union([(p.simplify(0.02, preserve_topology=True) if p.intersects(_we) else p)
                     for p in (walls.geoms if isinstance(walls, MultiPolygon) else [walls])])
walls = unary_union([(p.simplify(0.04, preserve_topology=True) if p.intersects(_ne) else p)
                     for p in (walls.geoms if isinstance(walls, MultiPolygon) else [walls])])
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

G['version'] = 17
G['area_check_m2'] = round(slab.area, 2)
G['facade_total_m'] = round(sum(r['len'] for r in G['glazing_runs']), 2)
G['notes'] = ('v17: стена санузла одинарная 0,25 (снята x 7,374); угол стен x 2,181 / y 5,279 заподлицо; вставка у западного входа заподлицо с кольцом.')
json.dump(G, open(DST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'записан {DST} v{G["version"]}')
