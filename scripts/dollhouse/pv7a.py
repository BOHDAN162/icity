import json, numpy as np
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
G=json.load(open('geometry.json'))
assert G.get('version')==6, 'need v6'
TH=G['wall_th']
C=np.array(G['slab'])
DROP=[0,1,2,8,13,14,15,23,24]
C2=C[[i for i in range(len(C)) if i not in DROP]]
P=Polygon(C2)
for _ in range(60):
    e=P.area-244.1
    if abs(e)<0.02: break
    P=P.buffer(-e/P.length/2,join_style=2,mitre_limit=12).simplify(0.003)
    if P.geom_type!='Polygon': P=max(P.geoms,key=lambda g:g.area)
C3=np.array(P.exterior.coords)[:-1]
slab=Polygon(C3); rl=slab.exterior; RL=rl.length
G['slab']=[[round(float(x),3),round(float(y),3)] for x,y in C3]
print('contour', len(C), '->', len(C3), 'area %.2f' % slab.area)
def snap(p1,p2,nm):
    a=np.array(rl.interpolate(rl.project(Point(*p1))).coords[0])
    b=np.array(rl.interpolate(rl.project(Point(*p2))).coords[0])
    return dict(name=nm,x1=round(float(a[0]),3),y1=round(float(a[1]),3),
                x2=round(float(b[0]),3),y2=round(float(b[1]),3),
                len=round(float(np.hypot(*(b-a))),2))
G['openings']=[snap((0.66,2.84),(0.66,4.25),'west entrance'),
               snap((10.80,2.24),(9.45,2.24),'north passage'),
               snap((18.48,5.39),(17.04,5.39),'north-east passage')]
for o in G['openings']: print('  opening', o['name'], o['len'])
runs=[]
for r in G['glazing_runs']:
    s1,s2=rl.project(Point(r['x1'],r['y1'])),rl.project(Point(r['x2'],r['y2']))
    if abs(s2-s1)>RL/2: s1,s2=max(s1,s2),min(s1,s2)+RL
    a=np.array(rl.interpolate(min(s1,s2)%RL).coords[0])
    b=np.array(rl.interpolate(max(s1,s2)%RL).coords[0])
    runs.append(dict(side=r['side'],x1=round(float(a[0]),3),y1=round(float(a[1]),3),
                     x2=round(float(b[0]),3),y2=round(float(b[1]),3),
                     len=round(float(np.hypot(*(b-a))),2)))
G['glazing_runs']=runs
G['facade_total_m']=round(sum(r['len'] for r in runs),2)
json.dump(G,open('geom_stage1.json','w'),ensure_ascii=False,indent=1)
print('stage1 ok, facade', G['facade_total_m'])
