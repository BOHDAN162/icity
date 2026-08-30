"""geometry v17 (данные):
СИНИЙ  стена санузла была двойной (x 6,97 и x 7,37, вместе 0,65 м) — вторая снята,
       поперечные стены y 2,479 и y 3,898 доведены до x 6,971; толщина 0,25 как у стены x 5,71.
РОЗОВЫЙ стена y 5,279: начало 2,194 -> 2,056 (грань стены x 2,181); стена x 2,181: конец 5,273 -> 5,404.
ЗЕЛЁНЫЙ — в pv17b.py (вставка у западного входа строится заподлицо с кольцом)."""
import json
G=json.load(open('geometry.json')); assert G['version']==16
def find(o,pos,p1,p2):
    m=[w for w in G['walls_ortho'] if w['o']==o and abs(w['pos']-pos)<2e-3 and abs(w['p1']-p1)<2e-3 and abs(w['p2']-p2)<2e-3]; assert len(m)==1,(o,pos,p1,p2,m); return m[0]
G['walls_ortho'].remove(find('v',7.374,2.441,5.385))
find('h',2.479,7.374,9.536)['p1']=6.971
find('h',3.898,7.374,9.437)['p1']=6.971
find('h',5.279,2.194,4.028)['p1']=2.056
find('v',2.181,4.115,5.273)['p2']=5.404
for w in G['walls_ortho']: w['len']=round(w['p2']-w['p1'],2)
json.dump(G,open('geom_v17_data.json','w',encoding='utf-8'),ensure_ascii=False,indent=1); print('v17 data ok')
