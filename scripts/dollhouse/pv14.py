"""geometry v14: внутреннее стекло той же высоты, что и стены.
partition_glass_h 2,7 -> 3,8 (= ceiling_h). build_dollhouse.py тянет
высоту внутренних панелей из этого поля, геометрия в плане не меняется."""
import json
G = json.load(open('geometry.json')); assert G['version'] == 13
G['partition_glass_h'] = G['ceiling_h']
G['version'] = 14
G['notes'] = 'v14: partition_glass_h = ceiling_h (3,8 м) — верх внутренних стёкол на уровне верха стен. План без изменений от v13.'
json.dump(G, open('geometry.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('partition_glass_h =', G['partition_glass_h'])
