"""
iCITY 113H — доллхаус в Blender из geometry.json v2

  blender --background --python build_dollhouse.py -- --geo geometry.json --out out/
  blender --background --python build_dollhouse.py -- --geo geometry.json --out out/ --bake

v3 исправляет две ошибки v2:
  1. запечённый AO оставался во внутренних изображениях и терялся при экспорте
  2. 62 отдельных объекта = 62 текстуры; теперь всё сводится в 7 мешей и ОДИН атлас
"""
SCRIPT_VERSION = "dollhouse-build v7.0 (геометрия v7, экспозиция в линейном пространстве)"
print(SCRIPT_VERSION)

import bpy, bmesh, json, math, sys, os
from mathutils import Vector

print(f"Blender {bpy.app.version_string}")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(n, d): return argv[argv.index(n) + 1] if n in argv else d
GEO   = arg("--geo", "geometry.json")
OUT   = arg("--out", "out")
BAKE  = "--bake" in argv
ARES  = int(arg("--atlas", "2048"))
os.makedirs(OUT, exist_ok=True)

G = json.load(open(GEO, encoding="utf-8"))
if G.get("version") != 7:
    raise SystemExit("НУЖЕН geometry.json версии 7.")
print(f"geometry.json v{G['version']}, перегородок {len(G['walls_ortho'])+len(G['walls_diag'])}")

H, TH, ST = G["ceiling_h"], G["wall_th"], G["slab_th"]
GT, MW, GLH = G["glass_th"], G["mullion_w"], G["partition_glass_h"]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.length_unit = "METERS"

def flip(x, y): return (x, -y)

# ---------------------------------------------------------------- материалы
def principled(name, base, rough, metal=0.0, alpha=1.0, transmission=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    have = {s.name for s in b.inputs}
    def put(k, v, *alts):
        for kk in (k, *alts):
            if kk in have: b.inputs[kk].default_value = v; return
    put("Base Color", (*base, 1.0)); put("Roughness", rough)
    put("Metallic", metal); put("Alpha", alpha)
    put("Transmission Weight", transmission, "Transmission"); put("IOR", 1.52)
    if alpha < 1.0:
        try: m.blend_method = "BLEND"; m.show_transparent_back = False
        except Exception: pass
    return m

MAT = {
    "floor":            principled("dh_floor",    (0.855, 0.871, 0.882), 0.62),
    "ceiling":          principled("dh_ceiling",  (0.808, 0.827, 0.839), 0.75),
    "walls":            principled("dh_walls",    (0.925, 0.941, 0.949), 0.55),
    "columns":          principled("dh_columns",  (0.757, 0.784, 0.800), 0.68),
    # металличность 0: в three металл без карты окружения выходит чёрным
    "mullions":         principled("dh_mullions", (0.735, 0.755, 0.770), 0.42, metal=0.0),
    "glazing_facade":   principled("dh_glass_f",  (0.62, 0.76, 0.83), 0.03, 0.0, 0.30, 0.90),
    "glazing_interior": principled("dh_glass_i",  (0.72, 0.85, 0.90), 0.07, 0.0, 0.25, 0.82),
}
OPAQUE = ["floor", "ceiling", "walls", "columns", "mullions"]

# ---------------------------------------------------------------- примитивы
def prism(name, pts, z0, z1, mat, bevel=0.0):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    bm = bmesh.new()
    vs = [bm.verts.new((*flip(x, y), z0)) for x, y in pts]
    bm.faces.new(vs); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    r = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0),
        verts=[e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob.data.materials.append(mat)
    # ФАСКИ НЕТ СОЗНАТЕЛЬНО. Фаска 8 мм резала каждую стену на полоски
    # площадью ~5 см², они получали по одному текселю и запекались чёрными.
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel; b.segments = 2
        b.limit_method = "ANGLE"; b.angle_limit = math.radians(35)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=b.name)
    return ob

def bar(name, x1, y1, x2, y2, t, z0, z1, mat, bevel=0.0):
    dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy)
    if L < 1e-6: return None
    nx, ny = -dy / L * t / 2, dx / L * t / 2
    return prism(name, [(x1+nx, y1+ny), (x2+nx, y2+ny), (x2-nx, y2-ny), (x1-nx, y1-ny)],
                 z0, z1, mat, bevel)

def cylinder(name, cx, cy, r, z0, z1, mat, verts=48, smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=z1 - z0,
                                        location=(*flip(cx, cy), (z0 + z1) / 2))
    ob = bpy.context.active_object; ob.name = name
    ob.data.materials.append(mat)
    if smooth: bpy.ops.object.shade_smooth()
    return ob

def cleanup(ob):
    """после булевой операции остаётся мусор: дубли вершин, вырожденные грани"""
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0002)
    bpy.ops.mesh.delete_loose()
    try: bpy.ops.mesh.dissolve_degenerate(threshold=0.0002)
    except Exception: pass
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bad = ob.data.validate(verbose=False)
    print(f"  чистка {ob.name}: {'исправлена битая геометрия' if bad else 'ошибок нет'}, "
          f"граней {len(ob.data.polygons)}")

def boolean(target, cutters):
    for c in cutters:
        bpy.context.view_layer.objects.active = target
        m = target.modifiers.new("cut", "BOOLEAN")
        m.operation = "DIFFERENCE"; m.object = c
        try: m.solver = "EXACT"
        except Exception: pass
        bpy.ops.object.modifier_apply(modifier=m.name)
    for c in cutters: bpy.data.objects.remove(c, do_unlink=True)

# ---------------------------------------------------------------- построение
groups = {k: [] for k in MAT}

groups["floor"].append(prism("floor", G["slab"], -ST, 0.0, MAT["floor"], bevel=0.0))
groups["ceiling"].append(prism("ceiling", G["slab"], H, H + 0.12, MAT["ceiling"], bevel=0.0))

# Стены приходят готовыми полигонами: проёмы вырезаны ПО КОНТУРУ плиты,
# щели у торцов замкнуты, колонны вычтены. Здесь только выдавливаем.
def prism_poly(name, outer, holes, z0, z1, mat):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    bm = bmesh.new()
    vo = [bm.verts.new((*flip(x, y), z0)) for x, y in outer]
    bm.faces.new(vo)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    r = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0),
        verts=[e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob.data.materials.append(mat)
    return ob

for i, wp in enumerate(G["wall_polygons"]):
    o = prism_poly(f"wp{i:02d}", wp["outer"], wp.get("holes", []), 0.0, H, MAT["walls"])
    if o: groups["walls"].append(o)
print(f"стен-полигонов: {len(G['wall_polygons'])}, остекления {G['facade_total_m']} м, "
      f"сквозных проёмов {len(G['openings'])}")

for k, c in enumerate(G["columns"]):
    groups["columns"].append(cylinder(f"col{k}", c["cx"], c["cy"], c["d"] / 2, 0, H, MAT["columns"]))
for i, m in enumerate(G["mullions"]):
    groups["mullions"].append(cylinder(f"mul{i:02d}", m["cx"], m["cy"], MW / 2, 0, H,
                                       MAT["mullions"], verts=12, smooth=False))
for i, s in enumerate(G["glazing_facade"]):
    o = bar(f"gf{i:02d}", s["x1"], s["y1"], s["x2"], s["y2"], GT, 0.0, H,
            MAT["glazing_facade"], bevel=0.0)
    if o: groups["glazing_facade"].append(o)
for i, s in enumerate(G["glazing_interior"]):
    o = bar(f"gi{i:02d}", s["x1"], s["y1"], s["x2"], s["y2"], 0.03, 0.0, GLH,
            MAT["glazing_interior"], bevel=0.0)
    if o: groups["glazing_interior"].append(o)

# ---------------------------------------------------------------- сведение в 7 мешей
def join(name, objs):
    objs = [o for o in objs if o and o.name in bpy.data.objects]
    if not objs: return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.active_object; ob.name = name; ob.data.name = name
    # трансформы вбиваем в вершины: иначе узел несёт сдвиг, и код,
    # который берёт голую геометрию, поставит колонны мимо места
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob

MESH = {}
for key in MAT:
    ob = join(key, groups[key])
    if ob:
        ob.data.validate(verbose=False)
        MESH[key] = ob
print("мешей после сведения:", ", ".join(f"{k}({len(v.data.polygons)})" for k, v in MESH.items()))

# ---------------------------------------------------------------- свет и мир
# ВАЖНО: свет создаётся ДО запечки. В v3.1 он ставился после, сцена при запекании
# была неосвещённой, и атлас выходил полностью чёрным.
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.90, 0.93, 0.96, 1.0); bg.inputs[1].default_value = 1.20
sd = bpy.data.lights.new("sun", "SUN"); sd.energy = 4.2; sd.angle = math.radians(5)
sun = bpy.data.objects.new("sun", sd); scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(215))

# ---------------------------------------------------------------- запечка
if BAKE:
    _ceil = MESH.get("ceiling")
    if _ceil:
        _ceil.hide_render = True
        _ceil.select_set(False)
    # потолок в запечку НЕ идёт: он скрыт на время запекания, а запекать
    # скрытый объект Blender отказывается. В доллхаусе его и не видно.
    targets = [MESH[k] for k in OPAQUE if k in MESH and k != "ceiling"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in targets:
        o.select_set(True)
        while o.data.uv_layers: o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name="bake")
    bpy.context.view_layer.objects.active = targets[0]

    # общий UV-атлас на все непрозрачные меши сразу (мультиобъектный режим правки)
    # ЗАЗОР МЕЖДУ ОСТРОВАМИ ДОЛЖЕН БЫТЬ ВДВОЕ БОЛЬШЕ ЗАЛИВКИ КРАЁВ.
    # В v6.1 было наоборот: паковка оставляла 0.0015*2048 = 3 текселя, а запечка
    # заливала края на 10 текселей. Замер атласа v6.1: медианный зазор 9 текселей,
    # 43% зазоров <= 6, минимум 1. Заливка с двух сторон смыкалась посреди зазора,
    # и билинейная выборка у края острова читала соседний, ничем не связанный
    # островок — это и есть серые мазки на верхних гранях перегородок.
    # Тёмных текселей в 2 текселях от края было 19,7%, а в глубине острова 2,4%.
    PACK_MARGIN = 0.006          # 12 текселей при атласе 2048
    BAKE_MARGIN = 5              # 5 < 12/2 — заливки с двух сторон не смыкаются
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # island_margin=0: расстояние задаёт ровно одна ручка — паковка
    try:
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
    except TypeError:
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0)
    for kw in (dict(rotate=True, margin=PACK_MARGIN, margin_method="ADD"),
               dict(rotate=True, margin=PACK_MARGIN),
               dict(margin=PACK_MARGIN)):
        try:
            bpy.ops.uv.pack_islands(**kw); break
        except TypeError:
            continue
    bpy.ops.object.mode_set(mode="OBJECT")

    img = bpy.data.images.new("dh_bake", ARES, ARES, alpha=False)
    # Базовый цвет в glTF — sRGB. Без явного указания Blender пишет сырые
    # линейные значения, и браузер раскодирует их вдвое темнее задуманного.
    try:
        img.colorspace_settings.name = "sRGB"
    except Exception:
        print("не удалось задать sRGB атласу — проверь тон вручную")
    for o in targets:
        for slot in o.material_slots:
            if not slot.material: continue
            nt = slot.material.node_tree
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img; tex.name = "bake_target"; tex.location = (-620, 300)
            nt.nodes.active = tex

    scene.render.engine = "CYCLES"
    try: scene.cycles.device = "GPU"
    except Exception: pass

    # ПОТОЛОК СНИМАЕМ. Доллхаус смотрят сверху без потолка — и освещать
    # его надо так же. С потолком помещения запечатаны и запекаются чёрными.
    _bg_was = bg.inputs[1].default_value
    bg.inputs[1].default_value = _bg_was * 1.7      # мягкий верхний свет вместо потолка

    # ---- автоэкспозиция ----------------------------------------------------
    # v5.1 клипнула 79% текселей в 255: света было слишком много, и светотень
    # в текстуре просто не сохранилась. Теперь сила света подбирается замером.
    # Изображение 8-битное: Blender при запечке САМ переводит линейный свет в sRGB
    # и пишет байты, а img.pixels возвращает байт/255. Значит и цель задаём в этих
    # единицах. 0.78 -> байт 199, как медиана эталонного рендера.
    TARGET = 0.78

    # Проба измеряется в единицах 8-битного изображения — это sRGB-байт/255.
    # Поправка же умножает СВЕТ, а он линейный. Множитель 1.326 на линейном
    # свете даёт в sRGB далеко не 1.326 (замер v6.1: ждали 199, получили 174).
    # Поэтому и замер, и цель переводим в линейное пространство и делим уже там.
    def srgb_to_linear(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    def linear_to_srgb(c):
        return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    probe = bpy.data.images.new("dh_probe", 512, 512, alpha=False)
    for o in targets:
        for slot in o.material_slots:
            if not slot.material: continue
            nt = slot.material.node_tree
            t = next((x for x in nt.nodes if x.name == "bake_target"), None)
            if t: t.image = probe
    scene.cycles.samples = 64
    scene.cycles.bake_type = "DIFFUSE"
    try:
        scene.render.bake.use_pass_direct = True
        scene.render.bake.use_pass_indirect = True
        scene.render.bake.use_pass_color = True
    except Exception: pass

    def probe_bake():
        bpy.ops.object.select_all(action="DESELECT")
        for o in targets: o.select_set(True)
        bpy.context.view_layer.objects.active = targets[0]
        bpy.ops.object.bake(type="DIFFUSE", use_clear=True, margin=4)
        px = list(probe.pixels)[0::4]
        lit = sorted(v for v in px if v > 0.004)
        if not lit: return 0.0, 0.0
        return lit[len(lit)//2], sum(1 for v in lit if v >= 0.999) / len(lit)

    # Клипнутую пробу мерить нельзя: медиана упирается в 1.0 и занижает поправку.
    # Сначала гасим свет, пока клип не исчезнет, и только потом считаем точно.
    med, clip = probe_bake()
    print(f"проба 1: медиана {med:.3f}, клипнуто {clip*100:.1f}%")
    step = 0
    while clip > 0.02 and step < 6:
        step += 1
        sd.energy *= 0.45
        bg.inputs[1].default_value *= 0.45
        med, clip = probe_bake()
        print(f"проба {step+1}: медиана {med:.3f}, клипнуто {clip*100:.1f}% "
              f"(свет ослаблен в {0.45**step:.3f})")
    if clip > 0.02:
        print("!!! не удалось убрать клип за 6 проб — что-то не так со сценой")
    k = srgb_to_linear(TARGET) / max(srgb_to_linear(max(med, 1e-4)), 1e-6)
    k = min(max(k, 0.02), 6.0)
    sd.energy *= k
    bg.inputs[1].default_value *= k
    print(f"финальная поправка {k:.3f} (в линейном пространстве; "
          f"наивная в единицах картинки была бы {TARGET / max(med, 1e-4):.3f})")
    print(f"  ожидаемая медиана атласа "
          f"{linear_to_srgb(srgb_to_linear(med) * k) * 255:.0f}/255")
    print(f"  -> солнце {sd.energy:.2f}, мир {bg.inputs[1].default_value:.2f}")

    for o in targets:
        for slot in o.material_slots:
            if not slot.material: continue
            nt = slot.material.node_tree
            t = next((x for x in nt.nodes if x.name == "bake_target"), None)
            if t: t.image = img
    bpy.data.images.remove(probe)
    # ------------------------------------------------------------------------
    scene.cycles.samples = 512
    for _obj, _attr in ((scene.cycles, "use_denoising"),
                        (getattr(scene.render, "bake", None), "use_denoising")):
        if _obj is not None and hasattr(_obj, _attr):
            setattr(_obj, _attr, True)
    scene.cycles.bake_type = "DIFFUSE"
    try:
        scene.render.bake.use_pass_direct = True
        scene.render.bake.use_pass_indirect = True
        scene.render.bake.use_pass_color = True
    except Exception: pass
    bpy.ops.object.select_all(action="DESELECT")
    for o in targets: o.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    # торцы стен — крошечные островки в развёртке. При узкой заливке краёв
    # они берут чёрный фон атласа вместо цвета. ADJACENT_FACES тянет цвет
    # с соседней грани, а не размывает островок наружу.
    try:
        scene.render.bake.margin_type = "ADJACENT_FACES"
        print("заливка краёв: по смежным граням")
    except Exception:
        print("заливка краёв: обычная (версия Blender не поддерживает ADJACENT_FACES)")
    bpy.ops.object.bake(type="DIFFUSE", use_clear=True, margin=BAKE_MARGIN)
    print(f"зазор паковки {PACK_MARGIN*ARES:.0f} текселей, заливка краёв "
          f"{BAKE_MARGIN} текселей (заливка обязана быть меньше половины зазора)")

    # СОХРАНЯЕМ на диск — без этого запечка теряется при экспорте
    import statistics
    dens = []
    for o in targets:
        me = o.data
        uvl = me.uv_layers.active.data
        for poly in me.polygons:
            if poly.loop_total < 3: continue
            pts = [uvl[li].uv for li in poly.loop_indices]
            a2 = abs(sum(pts[i].x * pts[(i+1) % len(pts)].y - pts[(i+1) % len(pts)].x * pts[i].y
                         for i in range(len(pts)))) / 2
            dens.append(a2 * ARES * ARES)
    dens.sort()
    med = dens[len(dens)//2] if dens else 0
    tiny = sum(1 for d in dens if d < 4) / max(len(dens), 1) * 100
    print(f"плотность развёртки: медиана {med:.0f} текселей на грань, "
          f"мельче 4 текселей — {tiny:.1f}% граней")
    if med < 16:
        print("!!! РАЗВЁРТКА СЛИШКОМ МЕЛКАЯ — грани не возьмут цвет, будут чёрные пятна")

    path = os.path.join(OUT, "dh_bake.png")
    img.filepath_raw = path; img.file_format = "PNG"; img.save()
    img.pack()

    px = list(img.pixels)
    mean = sum(px[0::4]) / max(len(px[0::4]), 1)
    print(f"атлас запечён и сохранён: {path}  {os.path.getsize(path)/1024:.0f} КБ, "
          f"средняя яркость {mean:.3f}")
    lit2 = sorted(v for v in px[0::4] if v > 0.004)
    med2 = lit2[len(lit2)//2] if lit2 else 0.0
    clip2 = sum(1 for v in lit2 if v >= 0.999) / max(len(lit2), 1)
    print(f"итог атласа: медиана {med2:.3f} (цель {TARGET}), клипнуто {clip2*100:.1f}%")
    if clip2 > 0.10:
        print("!!! АТЛАС ПЕРЕСВЕЧЕН — светотень потеряна, уменьши TARGET")
    black = sum(1 for v in px[0::4] if v < 0.004) / max(len(px[0::4]), 1)
    # Проверяем именно СОХРАНЁННЫЙ файл: в GLB уедет он, а не буфер в памяти.
    WANT8 = round(TARGET * 255)
    try:
        chk = bpy.data.images.load(path, check_existing=False)
        cp = list(chk.pixels)[0::4]
        cl = sorted(v for v in cp if v > 0.01)
        if cl:
            m8 = cl[len(cl)//2] * 255
            d = m8 - WANT8
            verdict = ("ПОПАЛ" if abs(d) <= 6 else
                       "МИМО: атлас темнее цели" if d < 0 else
                       "МИМО: атлас светлее цели")
            print(f"экспозиция файла: медиана {m8:.0f}/255, цель {WANT8}/255, "
                  f"промах {d:+.0f} ({d/WANT8*100:+.1f}%) — {verdict}")
        else:
            print("экспозиция файла: !!! в файле нет освещённых текселей")
        bpy.data.images.remove(chk)
    except Exception as e:
        print("проверка файла не удалась:", e)
    print(f"доля чёрных пикселей атласа: {black*100:.1f}%")

    # ---- проверка верхних граней ------------------------------------------
    # Серые мазки жаловались именно на ВЕРХНИЕ грани перегородок. Они смотрят
    # в небо и обязаны быть самыми светлыми в атласе: тёмное пятно там —
    # заведомо артефакт, а не контактная тень. Меряем тексели, а не глаза.
    #
    # Считаем ПО ТРЕУГОЛЬНИКАМ, а не по центру грани. Верх плиты и верхи стен —
    # невыпуклые многоугольники, их UV-центр запросто лежит ВНЕ острова и
    # попадает на фон. Первая версия этой проверки так и сделала и объявила
    # чёрными грани, которые на рендере светлые.
    def _sample(u, v):
        x = min(ARES - 1, max(0, int(u * ARES)))
        y = min(ARES - 1, max(0, int(v * ARES)))
        i = (y * ARES + x) * 4
        return (px[i] + px[i + 1] + px[i + 2]) / 3.0

    # Считаем только верхи ПЕРЕГОРОДОК И ИМПОСТОВ. Пол в эту проверку
    # не годится: его верхняя грань идёт и под стенами, и под колоннами,
    # и там честно запечена контактная тень — 25 % проб уходят в чёрное
    # на здоровой модели. Верх колонн — веер из 48 треугольников с общей
    # вершиной, проба у неё тоже читает соседний островок. Обе жаловались
    # бы всегда, и на них перестали бы смотреть.
    for o in targets:
        if o.name not in ("walls", "mullions"):
            continue
        me = o.data
        try:
            me.calc_loop_triangles()
        except Exception:
            pass
        uvl = me.uv_layers.active.data
        vals = []
        skipped = 0
        for tri in me.loop_triangles:
            if me.polygons[tri.polygon_index].normal.z < 0.9:
                continue
            a, b, c = (uvl[li].uv for li in tri.loops)
            # Триангуляция большого невыпуклого n-угольника (верх плиты — это
            # 25-угольник) даёт длинные тонкие осколки. Проба, отодвинутая
            # к вершине такого осколка, уходит за остров и читает фон.
            # Меряем площадь в текселях и осколки пропускаем, а не считаем
            # их чернотой: иначе проверка кричит на здоровую модель.
            area = abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
            side = max((b - a).length, (c - b).length, (a - c).length)
            # Мерить надо ВЫСОТУ треугольника, а не площадь: осколок длиной
            # 60 и шириной 1 тексель проходит любой порог по площади, но
            # проба, отодвинутая к его вершине, всё равно уходит за остров.
            alt = (2 * area / side * ARES) if side > 1e-9 else 0.0
            cu, cv = (a.x + b.x + c.x) / 3.0, (a.y + b.y + c.y) / 3.0
            # центр треугольника внутри острова всегда, его берём безусловно
            vals.append(_sample(cu, cv))
            if alt < 6.0:
                skipped += 1
                continue
            for p_ in (a, b, c):   # и ближе к углам, куда затекает заливка
                vals.append(_sample(cu + (p_.x - cu) * 0.6, cv + (p_.y - cv) * 0.6))
        if not vals:
            continue
        vals.sort()
        murky = sum(1 for v in vals if v < 0.45) / len(vals) * 100
        print(f"  верх {o.name}: проб {len(vals)} (осколков пропущено {skipped}), "
              f"медиана {vals[len(vals)//2]:.2f}, "
              f"худшая {vals[0]:.2f}, темнее 0.45 — {murky:.2f}%"
              + ("  <-- СЕРЫЕ МАЗКИ" if murky > 1.0 else "  чисто"))

    # ПОДКЛЮЧАЕМ в Base Color — иначе текстура есть, а на экране её нет
    for o in ([] if SKIP_LINK else targets):
        for slot in o.material_slots:
            if not slot.material: continue
            nt = slot.material.node_tree
            tex = next((x for x in nt.nodes if x.name == "bake_target"), None)
            bsdf = next((x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"), None)
            if tex and bsdf:
                nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
                if "Specular IOR Level" in {s.name for s in bsdf.inputs}:
                    bsdf.inputs["Specular IOR Level"].default_value = 0.2
    print("запечка подключена в Base Color на", 0 if SKIP_LINK else len(targets), "мешах")
    bg.inputs[1].default_value = _bg_was
    if _ceil:
        _ceil.hide_render = False
else:
    print("запечка пропущена (нет --bake)")

# ---------------------------------------------------------------- свет и камера

cd = bpy.data.cameras.new("cam"); cd.lens = 45
cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
CX, CY = 11.31, -7.85
def look_at(ob, t): ob.rotation_euler = (Vector(t) - ob.location).to_track_quat("-Z", "Y").to_euler()

scene.render.engine = "CYCLES"
scene.cycles.samples = 256
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 2400, 1500
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"

# Рендеры делаем ПЛОСКИМ светом: в текстуре свет уже запечён, и досвечивать
# её ослабленным солнцем значит показывать не то, что увидит сайт.
if BAKE:
    sd.energy = 0.0
    bg.inputs[1].default_value = 1.0
    print("для эталонных рендеров: солнце выключено, мир 1.0 — показываем запечку как есть")

ceil = MESH.get("ceiling")
for name, loc in {"iso": (CX + 17, CY - 20, 20), "chamfer": (CX + 21, CY + 12, 14),
                  "top": (CX, CY - 0.01, 34)}.items():
    cam.location = Vector(loc); look_at(cam, (CX, CY, 1.6))
    if ceil: ceil.hide_render = True
    scene.render.filepath = os.path.join(OUT, f"dollhouse_{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"рендер: {scene.render.filepath}")

# ---------------------------------------------------------------- экспорт
if ceil: ceil.hide_render = False
glb = os.path.join(OUT, "dollhouse.glb")
kw = dict(filepath=glb, export_format="GLB", export_apply=True,
          export_yup=True, export_materials="EXPORT")
for extra in (dict(export_image_format="WEBP", export_image_quality=80),
              dict(export_image_format="JPEG", export_image_quality=85),
              dict()):
    try:
        bpy.ops.export_scene.gltf(**kw, **extra); break
    except TypeError:
        continue
print(f"GLB: {glb}  {os.path.getsize(glb)/1024:.0f} КБ")
print(f"{SCRIPT_VERSION} — готово")
