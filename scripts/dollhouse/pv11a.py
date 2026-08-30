"""
geometry v11: пять вертикальных перегородок становятся стеклом, а не
непрозрачной стеной. Прямая инструкция, без сверки с планом и без
детектора — только перенос данных и перестройка wall_polygons.

Переносятся из walls_ortho в glazing_interior (тот же список, что уже
несёт четыре существующих внутренних стекла), высота — partition_glass_h,
а не полная H, толщина — как у остальных внутренних стёкол (0,03 м,
задаётся в build_dollhouse.py, не здесь):

  pos=2.819,  y 5.279-8.96   — запад блока гардероб/Skype
  pos=4.04,   y 5.348-6.197  — перегородка внутри Skype-комнат
  pos=12.034, y 5.447-8.997  — переговорная, запад
  pos=16.824, y 5.459-9.047  — переговорная, восток
  pos=18.701, y 5.372-9.078  — кабинет восток, у входа

Особый случай — pos=4.04, y 5.348-6.197. В glazing_interior уже есть
запись (4.037; 5.366)-(4.037; 6.216) — тот же кусок стены, обмеренный
раньше независимо, разошедшийся на 2 см по x и на 1,8-1,9 см по y с обоих
концов. Две почти совпадающие, но не идентичные стеклянные полосы рядом —
и есть подозреваемая причина «диагонального нароста» из задачи 2 (два
торца, что не совпадают ровно на пару сантиметров, при взгляде под углом
читаются как одна кромка, наискось выступающая из другой). Дубликат
убирается, остаётся одна точная запись из walls_ortho.
"""
import json

G = json.load(open('geometry.json'))
assert G.get('version') == 10, 'need v10'

MOVE = [
    (2.819, 5.279, 8.96),
    (4.04, 5.348, 6.197),
    (12.034, 5.447, 8.997),
    (16.824, 5.459, 9.047),
    (18.701, 5.372, 9.078),
]

kept = []
moved = []
for w in G['walls_ortho']:
    hit = None
    if w['o'] == 'v':
        for pos, p1, p2 in MOVE:
            if abs(w['pos'] - pos) < 0.01 and abs(w['p1'] - p1) < 0.01 and abs(w['p2'] - p2) < 0.01:
                hit = (pos, p1, p2)
                break
    if hit:
        moved.append(w)
    else:
        kept.append(w)

assert len(moved) == 5, f'ожидалось снять 5 записей, снято {len(moved)}: {moved}'
G['walls_ortho'] = kept
print('walls_ortho: было', len(kept) + len(moved), '-> стало', len(kept), '(снято 5)')

# дубликат у skype-перегородки (4.037; 5.366-6.216) — тот же кусок,
# что и переносимый (4.04; 5.348-6.197). Убираем его перед добавлением
# точной версии.
before = len(G['glazing_interior'])
G['glazing_interior'] = [
    g for g in G['glazing_interior']
    if not (abs(g['x1'] - 4.037) < 0.01 and abs(g['y1'] - 5.366) < 0.05 and abs(g['y2'] - 6.216) < 0.05)
]
removed_dupe = before - len(G['glazing_interior'])
print('дубликат в glazing_interior снят:', removed_dupe, '(должно быть 1)')
assert removed_dupe == 1

for pos, p1, p2 in MOVE:
    G['glazing_interior'].append(dict(
        x1=pos, y1=p1, x2=pos, y2=p2, len=round(abs(p2 - p1), 2),
    ))
print('glazing_interior: стало', len(G['glazing_interior']), 'записей')
for g in G['glazing_interior']:
    print('  ', g)

json.dump(G, open('geom_v11_data.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('geom_v11_data.json записан (без пересборки wall_polygons — это делает pv11b.py)')
