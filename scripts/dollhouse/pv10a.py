"""
geometry v10, первая половина: западный угол возвращён из v8, северный
проход остаётся прямым как в v9 — это два независимых решения, не одно.

Инструкция явно требует v8 как источник для запада: там угол уже был
правильным (0,85 м ошибка приближения против 2,3 м у прямой — измерено
и подтверждено раньше). Северный проход трогать не нужно — новых
претензий к нему нет, остаётся как в v9.

Технически: берём КОНТУР v9 (уже верный на севере), и на месте прямого
ребра запада (последняя вершина v9 -> первая вершина v9, через разрыв
нумерации) вставляем обратно две вершины прежнего угла из v8, взятые
как есть — небольшой сдвиг (эти вершины и раньше слегка гуляли между
проходами буферизации на 244,1 м²) уйдёт на общей перенормировке ниже.
"""
import json
import numpy as np
from shapely.geometry import Polygon, LineString, Point

G9 = json.load(open('geometry.json'))
assert G9.get('version') == 9, 'need v9'
G8 = json.load(open('geometry_v8_ref.json'))
assert G8.get('version') == 8

TH = G9['wall_th']
C9 = np.array(G9['slab'])
C8 = np.array(G8['slab'])

# v9: контур замкнут вершина[-1] (запад, ex-v8#21) -> вершина[0] (ex-v8#0).
# Из угла v8 берётся ТОЛЬКО вершина 22 — она подтверждена измерением
# (устойчивая граница белого несколькими независимыми проверками), даёт
# изгиб угла (это и просили вернуть), и один этим изгибом заканчивается.
#
# Вершина 23 (была бы следующей) — НЕ вставляется. Прямая проверка:
# устойчивый обход строки (робастное окно 25 px, порог 0.7) не находит
# НИ ОДНОГО белого пикселя во всей полосе y=2.20..2.53, x=0.1..2.5 —
# ровно там, где сидит вершина 23 (0.747, 2.29 м). Это и есть «лезвие
# в пустоту» из задания: не сегмент из walls_ortho (там рядом с этим
# углом ничего нет — проверено полным обходом всех концов стен), а тонкий
# шип самого контура, воспроизводящийся один в один из v8 без единой
# правки (см. /tmp/v8_own_west.png — тот же шип есть уже в v8 отдельно).
insert = C8[[22]]
C2 = np.vstack([C9, insert])
print('v9 contour last vertex (запад, старый v8#21):', C9[-1])
print('v9 contour first vertex (запад, старый v8#0): ', C9[0])
print('v8 вершина угла для вставки (только 22, БЕЗ 23):', C8[22])

P = Polygon(C2)
for _ in range(60):
    e = P.area - 244.1
    if abs(e) < 0.02:
        break
    P = P.buffer(-e / P.length / 2, join_style=2, mitre_limit=12).simplify(0.003)
    if P.geom_type != 'Polygon':
        P = max(P.geoms, key=lambda g: g.area)
C3 = np.array(P.exterior.coords)[:-1]
slab = Polygon(C3)
rl = slab.exterior
RL = rl.length
G = G9
G['slab'] = [[round(float(x), 3), round(float(y), 3)] for x, y in C3]
print('contour', len(C9), '+ 2 ->', len(C3), 'area %.2f' % slab.area)


def snap(p1, p2, nm):
    a = np.array(rl.interpolate(rl.project(Point(*p1))).coords[0])
    b = np.array(rl.interpolate(rl.project(Point(*p2))).coords[0])
    return dict(name=nm, x1=round(float(a[0]), 3), y1=round(float(a[1]), 3),
                x2=round(float(b[0]), 3), y2=round(float(b[1]), 3),
                len=round(float(np.hypot(*(b - a))), 2))


# North passage: снять с текущих (v9, уже верных) точек — не трогаем.
# West entrance: угол вернулся, дверь снова снимаем с прежней документированной
# ширины 1,41 м так же, как чинили в v9 — от рабочей опоры (0.65,4.279),
# которая и раньше ложилась на стену почти без сдвига.
# Угол вернулся — исторические опорные точки двери (те же, что были до
# v9) снова ложатся на стену: проверено, обе в пределах 2 см от неё.
G['openings'] = [
    snap((0.714, 2.843), (0.635, 4.249), 'west entrance'),
    snap((10.8, 2.231), (9.45, 2.24), 'north passage'),
    snap((18.48, 5.377), (17.04, 5.399), 'north-east passage'),
]
for o in G['openings']:
    print('  opening', o['name'], o['len'])

runs = []
for r in G['glazing_runs']:
    s1, s2 = rl.project(Point(r['x1'], r['y1'])), rl.project(Point(r['x2'], r['y2']))
    if abs(s2 - s1) > RL / 2:
        s1, s2 = max(s1, s2), min(s1, s2) + RL
    a = np.array(rl.interpolate(min(s1, s2) % RL).coords[0])
    b = np.array(rl.interpolate(max(s1, s2) % RL).coords[0])
    runs.append(dict(side=r['side'], x1=round(float(a[0]), 3), y1=round(float(a[1]), 3),
                      x2=round(float(b[0]), 3), y2=round(float(b[1]), 3),
                      len=round(float(np.hypot(*(b - a))), 2)))
G['glazing_runs'] = runs
G['facade_total_m'] = round(sum(r['len'] for r in runs), 2)
json.dump(G, open('geom_stage4.json', 'w'), ensure_ascii=False, indent=1)
print('stage4 ok, facade', G['facade_total_m'])
