"""
Проверка кандидатов на пропущенную стену по растру плана.

  ~/depth-env/bin/python wall_gap_check.py candidates.json

candidates.json — список отрезков в метрах плана:
  [{"name":"угол у кухни","x1":5.9,"y1":6.0,"x2":9.3,"y2":6.0}, ...]

ЧТО ЭТО ЗА ПРОВЕРКА. На плане стена не отличается от пола цветом: и то,
и другое чистый белый. Отличает её ТЕНЬ — мягкая серая полоса (яркость
150..251), которую стена отбрасывает вниз-вправо под 45°. Замер по
17 известным перегородкам: тень лежит в 0,17..0,42 м от осевой.

КАЛИБРОВКА (замерена, не выдумана):
  известные перегородки  медиана 0,94   минимум 0,70
  пустые контрольные     медиана 0,44   максимум 0,66
  порог 0,85

ГРАНИЦА ПРИМЕНИМОСТИ — ЧИТАТЬ ОБЯЗАТЕЛЬНО. Это ПОДТВЕРЖДЕНИЕ кандидата,
а не поиск. Прогон по 300 случайным линиям в заведомо пустом опенспейсе
даёт 5,3% ложных срабатываний: мебель тоже отбрасывает тени. На десятке
кандидатов из разметки это 0,5 ошибки, на переборе всех линий плана —
сотня мусорных «стен». Кандидатов даёт разметка, а не этот скрипт.

ПРИВЯЗКА подобрана по прямым кромкам плиты: 162,29 px/м, сдвиг (-46,0; -31,5),
1 px = 6,16 мм. Проверено по 13 перегородкам: смещение центра 0,00 м.
"""
import sys, json, math
import numpy as np
from PIL import Image
from shapely.geometry import Polygon, Point

PLAN = '/Users/bogdan/Projects/icity/public/plan_113n_3652px.png'
GEO  = '/Users/bogdan/Downloads/geometry.json'
S, OX, OY = 162.29, -46.00, -31.50
LO, HI    = 0.17, 0.42
THRESH    = 0.85

LUM = np.asarray(Image.open(PLAN).convert('L')).astype(np.float32)
H, W = LUM.shape
SH = (LUM >= 150) & (LUM <= 251)
slab = Polygon(json.load(open(GEO, encoding='utf-8'))['slab'])
R2 = math.sqrt(0.5)


def score(x1, y1, x2, y2, n=64):
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    if L < 1e-6:
        return 0.0, 0
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    if nx * R2 + ny * R2 < 0:          # тень всегда вниз-вправо
        nx, ny = -nx, -ny
    hit = tot = 0
    for i in range(n):
        t = (i + 0.5) / n
        x, y = x1 + dx * t, y1 + dy * t
        if not slab.buffer(-0.05).contains(Point(x, y)):
            continue
        tot += 1
        d = LO
        while d <= HI:
            px = int(round((x + nx * d) * S + OX))
            py = int(round((y + ny * d) * S + OY))
            if 0 <= px < W and 0 <= py < H and SH[py, px]:
                hit += 1
                break
            d += 1.0 / S
    return (hit / tot if tot else 0.0), tot


if __name__ == '__main__':
    cands = json.load(open(sys.argv[1], encoding='utf-8'))
    print(f'{"кандидат":<28} {"длина":>6} {"счёт":>6} {"проб":>5}  вердикт')
    for c in cands:
        s, n = score(c['x1'], c['y1'], c['x2'], c['y2'])
        L = math.hypot(c['x2'] - c['x1'], c['y2'] - c['y1'])
        v = 'СТЕНА' if s >= THRESH else ('спорно' if s >= 0.70 else 'пусто')
        print(f'{c.get("name","")[:28]:<28} {L:5.2f}м {s:6.2f} {n:5d}  {v}')
