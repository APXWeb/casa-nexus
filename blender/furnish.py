"""Mobiliário e decoração da CASA NEXUS.
Peças contemporâneas modeladas aqui (estofados, marcenaria, cozinha, banheiros) + modelos CC0 do Poly Haven."""
import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix, Euler
import lib
from lib import box, cyl, rounded, coll, tag, join

F = {}
M = None
_ph_cache = {}


def mats(Ma):
    global M
    M = Ma
    mt = lib.material
    F['linen'] = mt('M_fab_linen', 'leather_white', tile=0.6, tint=(0.86, 0.82, 0.75), rough=0.95, normal=0.6)
    F['taupe'] = mt('M_fab_taupe', 'leather_white', tile=0.6, tint=(0.5, 0.45, 0.4), rough=0.95, normal=0.6)
    F['graphite_fab'] = mt('M_fab_graphite', 'leather_white', tile=0.6, tint=(0.24, 0.24, 0.25), rough=0.95, normal=0.6)
    F['bed'] = mt('M_fab_bed', 'leather_white', tile=0.8, tint=(0.95, 0.94, 0.92), rough=0.95, normal=0.4)
    F['throw'] = mt('M_fab_throw', 'leather_white', tile=0.5, tint=(0.42, 0.33, 0.26), rough=0.95, normal=0.8)
    F['rug'] = mt('M_rug', 'leather_white', tile=0.35, tint=(0.62, 0.58, 0.53), rough=1.0, normal=1.0)
    F['rug_dark'] = mt('M_rug_dark', 'leather_white', tile=0.35, tint=(0.3, 0.29, 0.28), rough=1.0, normal=1.0)
    F['cognac'] = mt('M_leather_cognac', 'leather_white', tile=0.7, tint=(0.5, 0.28, 0.14), rough=0.55, normal=0.5)
    F['graphite'] = mt('M_cab_graphite', color=(0.06, 0.06, 0.065), rough=0.55)
    F['lacquer'] = mt('M_lacquer_white', color=(0.84, 0.83, 0.81), rough=0.32)
    F['walnut'] = mt('M_walnut', 'american_walnut_veneer', tile=1.5, tint=(0.75, 0.62, 0.5))
    F['oak'] = mt('M_oak', 'white_oak_veneer', tile=1.5)
    F['black_marble'] = mt('M_black_marble', 'slab_tiles', tile=1.4)
    F['white_marble'] = mt('M_white_marble', 'marble_01', tile=1.2)
    F['travertine'] = mt('M_travertine', 'marble_01', tile=0.9, tint=(0.95, 0.88, 0.78), rough=0.5)
    F['brass'] = mt('M_brass', color=(0.78, 0.58, 0.34), rough=0.28, metal=1.0)
    F['ceramic'] = mt('M_ceramic', color=(0.92, 0.92, 0.9), rough=0.08)
    F['mirror'] = mt('M_mirror', color=(0.92, 0.93, 0.93), rough=0.02, metal=1.0, kind='mirror')
    F['black_glass'] = mt('M_black_glass', color=(0.01, 0.01, 0.012), rough=0.06)
    F['screen'] = mt('M_screen', color=(0.005, 0.005, 0.006), rough=0.12)
    F['curtain'] = mt('M_curtain', 'leather_white', tile=0.8, tint=(0.93, 0.91, 0.87), rough=0.95, alpha=0.6,
                      normal=0.2, kind='curtain')
    F['ink'] = mt('M_ink', color=(0.03, 0.03, 0.03), rough=0.6)
    F['concrete_bench'] = mt('M_concrete_furn', 'concrete_wall_008', tile=1.5, tint=(0.8, 0.8, 0.8))
    F['water_plane'] = mt('M_water', color=(0.1, 0.35, 0.38), rough=0.02, transmission=1.0, kind='water')
    F['pool_tile'] = mt('M_pool_tile', 'grey_tiles', tile=0.6, tint=(0.45, 0.75, 0.72), rough=0.25)
    F['books'] = [mt(f'M_book_{i}', color=c, rough=0.7) for i, c in enumerate(
        [(0.62, 0.55, 0.45), (0.15, 0.17, 0.2), (0.75, 0.73, 0.68), (0.45, 0.2, 0.12), (0.3, 0.35, 0.3),
         (0.85, 0.8, 0.7)])]
    F['art'] = [art_material(i) for i in range(4)]


def art_material(i):
    """Quadro abstrato gerado (aquarela em tons de terra) — arte original da proposta."""
    import random
    random.seed(11 + i * 7)
    W, H = 512, 384
    name = f'art_{i}'
    img = bpy.data.images.new(name, W, H)
    pal = [[(0.86, 0.82, 0.74), (0.55, 0.42, 0.3), (0.23, 0.22, 0.2), (0.7, 0.58, 0.42)],
           [(0.9, 0.88, 0.84), (0.32, 0.38, 0.36), (0.62, 0.55, 0.45), (0.15, 0.15, 0.15)],
           [(0.82, 0.78, 0.7), (0.66, 0.36, 0.22), (0.3, 0.27, 0.24), (0.88, 0.84, 0.76)],
           [(0.92, 0.9, 0.86), (0.45, 0.47, 0.42), (0.7, 0.62, 0.5), (0.2, 0.2, 0.22)]][i]
    import numpy as np
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    px = np.zeros((H, W, 3), np.float32)
    px[:] = pal[0]
    for k in range(5):
        cx, cy = random.uniform(0.15, 0.85) * W, random.uniform(0.2, 0.8) * H
        rx, ry = random.uniform(0.12, 0.4) * W, random.uniform(0.08, 0.3) * H
        n = np.sin(xx * random.uniform(0.01, 0.04) + yy * 0.02) * 0.15
        d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 + n
        a = np.clip(1.2 - d, 0, 1) ** 1.5 * random.uniform(0.5, 0.9)
        col = np.array(pal[1 + k % 3], np.float32)
        px = px * (1 - a[..., None]) + col * a[..., None]
    grain = (np.random.default_rng(i).random((H, W, 1)).astype(np.float32) - 0.5) * 0.03
    px = np.clip(px + grain, 0, 1)
    rgba = np.concatenate([px[::-1], np.ones((H, W, 1), np.float32)], axis=2)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(lib.ROOT, 'assets-src', 'art', f'{name}.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    m = bpy.data.materials.new(f'M_art_{i}')
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    n = m.node_tree.nodes.new('ShaderNodeTexImage')
    n.image = img
    m.node_tree.links.new(n.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.85
    m['tex'] = ''
    m['art'] = f'art_{i}.png'
    m['kind'] = 'art'
    return m


# ------------------------------------------------------------------ utilidades de posicionamento
def place(objs, x, y, z=0.0, rot=0.0, name=None, c=None, **props):
    """Junta peças (modeladas na origem, frente para -Y) e posiciona/gira em torno de Z."""
    o = join(objs, name)
    R = Matrix.Rotation(math.radians(rot), 4, 'Z')
    T = Matrix.Translation((x, y, z))
    o.data.transform(T @ R)
    if c:
        lib.move_to(o, c)
    tag(o, lm=1, **props)
    return o


def uv_box_object(o):
    lib.world_uv(o)


def ph(asset, x, y, z=0.0, rot=0.0, scale=1.0, c=None, name=None, bake=True, **props):
    """Importa um modelo do Poly Haven (cópia própria para receber UV de lightmap)."""
    d = os.path.join(lib.MODELS, asset)
    if asset not in _ph_cache:
        g = [f for f in os.listdir(d) if f.endswith('.gltf')][0]
        objs = lib.import_gltf(os.path.join(d, g))
        meshes = [o for o in objs if o.type == 'MESH']
        for o in meshes:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
            lib.apply_transform(o)
        for o in objs:
            if o.type != 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)
        base = join(meshes, f'__ph_{asset}')
        base.hide_render = True
        base.hide_set(True)
        _ph_cache[asset] = base
        for m in base.data.materials:
            if m:
                m['ph'] = asset
    base = _ph_cache[asset]
    o = base.copy()
    o.data = base.data.copy() if bake else base.data
    o.hide_render = False
    o.name = name or asset
    (c or coll('furniture')).objects.link(o)
    o.hide_set(False)
    M_ = Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.radians(rot), 4, 'Z') @ Matrix.Scale(scale, 4)
    o.data.transform(M_) if bake else None
    if not bake:
        o.matrix_world = M_
    tag(o, imported=1, ph=asset, lm=1 if bake else 0, **props)
    return o


def cleanup_ph():
    for b in _ph_cache.values():
        bpy.data.objects.remove(b, do_unlink=True)


# ------------------------------------------------------------------ peças modeladas (origem no chão, frente -Y)
def sofa_bench(w, d=1.0, mat=None, arms=True, back=True, h_seat=0.42):
    mat = mat or F['linen']
    p = []
    p.append(rounded('sb', -w / 2, -d / 2, 0.06, w / 2, d / 2, 0.24, 0.03, F['graphite'], seg=2))
    p.append(box('sp', -w / 2 + 0.08, -d / 2 + 0.08, 0.0, w / 2 - 0.08, d / 2 - 0.08, 0.06, F['ink']))
    n = max(1, round(w / 0.95))
    cw = w / n
    for i in range(n):
        x0 = -w / 2 + i * cw
        p.append(rounded('ss', x0 + 0.005, -d / 2 + 0.01, 0.23, x0 + cw - 0.005, d / 2 - (0.24 if back else 0.01),
                         h_seat, 0.07, mat, seg=4))
        if back:
            p.append(rounded('sbk', x0 + 0.01, d / 2 - 0.28, h_seat - 0.03, x0 + cw - 0.01, d / 2 - 0.02, h_seat + 0.36,
                             0.09, mat, seg=4))
    return p


def l_sofa(mat):
    p = sofa_bench(4.4, 1.05, mat)
    for o in p:
        o.data.transform(Matrix.Translation((0.3, 0, 0)))
    ch = sofa_bench(1.05, 1.9, mat, back=False)
    for o in ch:
        o.data.transform(Matrix.Translation((-2.45, -0.43, 0)))
    bk = rounded('sbk', -2.97, 0.25, 0.39, -1.93, 0.52, 0.78, 0.09, mat, seg=4)
    # almofadas soltas
    pil = []
    for (x, c_) in [(-1.3, F['taupe']), (-0.85, F['linen']), (1.6, F['throw']), (2.1, F['taupe'])]:
        q = rounded('pil', x - 0.24, 0.16, 0.42, x + 0.24, 0.3, 0.88, 0.07, c_, seg=4)
        q.data.transform(Matrix.Translation((0, 0, 0)) @ Matrix.Rotation(math.radians(-12), 4, 'X'))
        q.data.transform(Matrix.Translation((0, 0.06, 0.08)))
        pil.append(q)
    return p + ch + [bk] + pil


def coffee_table_block(w, d, h, mat):
    return [rounded('ct', -w / 2, -d / 2, 0, w / 2, d / 2, h, 0.012, mat, seg=2)]


def rug(w, d, mat):
    return [rounded('rug', -w / 2, -d / 2, 0.0, w / 2, d / 2, 0.012, 0.004, mat, seg=1)]


def dining_chair(mat_seat, mat_frame):
    p = []
    for (x, y) in [(-0.21, -0.2), (0.21, -0.2), (-0.21, 0.2), (0.21, 0.2)]:
        p.append(box('leg', x - 0.014, y - 0.014, 0, x + 0.014, y + 0.014, 0.44, mat_frame))
    p.append(rounded('seat', -0.25, -0.25, 0.43, 0.25, 0.23, 0.5, 0.03, mat_seat, seg=3))
    b = rounded('back', -0.24, 0.17, 0.5, 0.24, 0.24, 0.88, 0.03, mat_seat, seg=3)
    b.data.transform(Matrix.Translation((0, 0.2, 0.5)) @ Matrix.Rotation(math.radians(-8), 4, 'X') @
                     Matrix.Translation((0, -0.2, -0.5)))
    p.append(b)
    return p


def bar_stool(mat_seat):
    p = []
    p.append(cyl('st', 0, 0, 0, 0.012, 0.2, F['ink'], seg=24))
    p.append(cyl('st', 0, 0, 0.012, 0.62, 0.022, F['brass'], seg=16))
    p.append(cyl('st', 0, 0, 0.3, 0.315, 0.17, F['brass'], seg=24, r2=0.17))
    p.append(rounded('ss', -0.21, -0.2, 0.62, 0.21, 0.2, 0.7, 0.035, mat_seat, seg=3))
    b = rounded('sb', -0.2, 0.13, 0.7, 0.2, 0.2, 0.95, 0.03, mat_seat, seg=3)
    p.append(b)
    return p


def bed(w, l=2.1, mat_head=None):
    mat_head = mat_head or F['taupe']
    p = []
    p.append(box('base', -w / 2 + 0.05, -l + 0.1, 0.0, w / 2 - 0.05, -0.05, 0.12, F['ink']))
    p.append(rounded('plat', -w / 2, -l, 0.12, w / 2, 0, 0.32, 0.015, F['walnut'], seg=2))
    p.append(rounded('matt', -w / 2 + 0.04, -l + 0.04, 0.32, w / 2 - 0.04, -0.06, 0.56, 0.05, F['bed'], seg=3))
    duv = rounded('duv', -w / 2 + 0.01, -l + 0.0, 0.48, w / 2 - 0.01, -0.62, 0.63, 0.06, F['bed'], seg=4)
    p.append(duv)
    p.append(rounded('throw', -w / 2 - 0.01, -l + 0.12, 0.6, w / 2 + 0.01, -l + 0.62, 0.655, 0.03, F['throw'], seg=3))
    for x in (-w / 4, w / 4):
        q = rounded('pil', x - w / 4 + 0.06, -0.48, 0.56, x + w / 4 - 0.06, -0.08, 0.72, 0.07, F['bed'], seg=4)
        p.append(q)
        q2 = rounded('pil', x - w / 4 + 0.14, -0.62, 0.56, x + w / 4 - 0.14, -0.42, 0.85, 0.07, F['linen'], seg=4)
        q2.data.transform(Matrix.Translation((0, -0.52, 0.56)) @ Matrix.Rotation(math.radians(-14), 4, 'X') @
                          Matrix.Translation((0, 0.52, -0.56)))
        p.append(q2)
    return p


def headboard_wall(w, h, mat):
    """Painel de cabeceira estofado em gomos verticais."""
    p = []
    n = max(2, round(w / 0.42))
    cw = w / n
    for i in range(n):
        x0 = -w / 2 + i * cw
        p.append(rounded('hb', x0 + 0.004, 0.0, 0.0, x0 + cw - 0.004, 0.09, h, 0.035, mat, seg=3))
    return p


def nightstand(mat):
    return [rounded('ns', -0.27, -0.22, 0.18, 0.27, 0.2, 0.52, 0.01, mat, seg=2),
            box('nsl', -0.22, -0.18, 0.0, 0.22, 0.16, 0.18, F['ink'])]


def pendant(drop, r=0.11, mat=None):
    """Pendente: cabo + cúpula de vidro com luz (emissiva)."""
    mat = mat or F['brass']
    p = [cyl('cab', 0, 0, -drop, 0, 0.002, F['ink'], seg=6),
         cyl('can', 0, 0, -0.012, 0, 0.05, mat, seg=24),
         cyl('cup', 0, 0, -drop - 0.12, -drop + 0.02, r, M['light'], seg=32, r2=r * 0.25)]
    return p


def linear_pendant(length, drop):
    p = [cyl('cab', -length / 2 + 0.1, 0, -drop, 0, 0.0015, F['ink'], seg=6),
         cyl('cab', length / 2 - 0.1, 0, -drop, 0, 0.0015, F['ink'], seg=6),
         rounded('bar', -length / 2, -0.025, -drop - 0.05, length / 2, 0.025, -drop, 0.008, F['ink'], seg=2),
         box('led', -length / 2 + 0.03, -0.015, -drop - 0.052, length / 2 - 0.03, 0.015, -drop - 0.049, M['light'])]
    return p


def floor_lamp():
    return [cyl('fb', 0, 0, 0, 0.025, 0.16, F['ink'], seg=24),
            cyl('fs', 0, 0, 0.025, 1.45, 0.009, F['brass'], seg=8),
            cyl('fh', 0, 0, 1.38, 1.62, 0.2, F['linen'], seg=32, r2=0.17)]


def wardrobe(w, h=2.6, d=0.6, mat=None, glass=False):
    mat = mat or F['walnut']
    p = [box('wb', -w / 2, -d, 0.0, w / 2, 0, 0.08, F['ink'])]
    n = max(1, round(w / 0.55))
    dw = w / n
    for i in range(n):
        x0 = -w / 2 + i * dw
        p.append(box('wd', x0 + 0.003, -d, 0.08, x0 + dw - 0.003, -0.02, h, mat))
        p.append(box('wh', x0 + dw - 0.03, -d - 0.025, 0.95, x0 + dw - 0.015, -d, 1.65, F['brass']))
    return p


def kitchen(Mx):
    """Cozinha completa: bancada da janela (oeste), paredão de torres (sul) e ilha em mármore negro."""
    c = coll('furniture')
    out = []
    # bancada ao longo da parede oeste (x=-12) — de y=-9.85 a y=-4.3
    x0, x1 = -11.875, -11.235
    p = [box('kb', x0, -9.6, 0.0, x1 - 0.04, -4.35, 0.1, F['ink'])]
    y = -9.6
    while y < -4.4:
        p.append(box('kd', x0, y + 0.003, 0.1, x1, min(y + 0.6, -4.35) - 0.003, 0.88, F['graphite']))
        y += 0.6
    p.append(box('ktop', x0, -9.85, 0.88, x1 + 0.02, -4.3, 0.92, F['white_marble']))
    p.append(box('kback', x0, -9.85, 0.92, x0 + 0.02, -4.3, 1.05, F['white_marble']))
    # cuba e torneira sob a janela
    p.append(box('sink', -11.75, -7.6, 0.885, -11.36, -6.9, 0.921, M['steel']))
    p.append(cyl('tap', -11.82, -7.25, 0.92, 1.22, 0.014, M['steel'], seg=12))
    tap = box('tapb', -11.84, -7.27, 1.2, -11.55, -7.23, 1.225, M['steel'], bevel=0.008)
    p.append(tap)
    # cooktop
    p.append(box('cook', -11.8, -5.6, 0.92, -11.3, -4.85, 0.928, F['black_glass']))
    for (yy, r) in [(-5.4, 0.09), (-5.05, 0.11)]:
        for xx in (-11.65, -11.45):
            p.append(cyl('ring', xx, yy, 0.928, 0.929, r * 0.8, F['ink'], seg=24))
    out.append(place(p, 0, 0, 0, 0, 'kitchen_counter', c, stage='furniture', room='cozinha'))
    # paredão sul (y=-10): torres com forno, refrigerador e nicho iluminado em madeira
    q = []
    ys0, ys1 = -9.925, -9.3
    xs = [-11.875, -11.2, -10.5, -9.8, -9.1, -8.4, -7.45]
    for i in range(len(xs) - 1):
        a, b = xs[i], xs[i + 1]
        q.append(box('tw', a + 0.003, ys0, 0.0, b - 0.003, ys1, 2.6, F['graphite']))
    # forno e micro-ondas embutidos (torre 3)
    q.append(box('ov', -10.47, ys1, 0.85, -9.83, ys1 + 0.012, 1.45, F['black_glass']))
    q.append(box('ov', -10.47, ys1, 1.5, -9.83, ys1 + 0.012, 1.9, F['black_glass']))
    q.append(box('ovh', -10.42, ys1 + 0.012, 1.4, -9.88, ys1 + 0.03, 1.415, M['steel']))
    # refrigerador inox (torres 1-2)
    q.append(box('fr', -11.86, ys1, 0.02, -10.52, ys1 + 0.015, 2.58, M['steel']))
    q.append(box('frh', -11.2, ys1 + 0.015, 0.9, -11.18, ys1 + 0.04, 1.9, F['ink']))
    # nicho com prateleiras de madeira e LED (torres 4-5)
    q.append(box('nb', -9.79, ys1 - 0.01, 0.95, -8.41, ys1 + 0.002, 2.25, F['walnut']))
    for zz in (1.35, 1.8):
        q.append(box('ns', -9.79, ys1 - 0.01, zz, -8.41, ys1 + 0.3, zz + 0.025, F['walnut']))
        q.append(box('nl', -9.75, ys1 + 0.02, zz - 0.006, -8.45, ys1 + 0.05, zz, M['light']))
    out.append(place(q, 0, 0, 0, 0, 'kitchen_wall', c, stage='furniture', room='cozinha'))
    # ilha em cascata de mármore negro
    ix0, ix1, iy0, iy1 = -10.2, -6.4, -7.95, -6.75
    r_ = [box('ib', ix0 + 0.03, iy0, 0.0, ix1 - 0.03, iy1 - 0.25, 0.9, F['graphite']),
          box('itop', ix0, iy0 - 0.02, 0.9, ix1, iy1, 0.94, F['black_marble']),
          box('iside', ix0, iy0 - 0.02, 0.0, ix0 + 0.04, iy1, 0.9, F['black_marble']),
          box('iside', ix1 - 0.04, iy0 - 0.02, 0.0, ix1, iy1, 0.9, F['black_marble']),
          box('iled', ix0 + 0.05, iy1 - 0.27, 0.86, ix1 - 0.05, iy1 - 0.25, 0.875, M['light']),
          box('isink', -8.9, -7.75, 0.905, -8.3, -7.3, 0.941, M['steel'])]
    r_.append(cyl('itap', -8.6, -7.85, 0.94, 1.28, 0.013, M['steel'], seg=12))
    r_.append(box('itapb', -8.62, -7.86, 1.26, -8.58, -7.55, 1.283, M['steel'], bevel=0.008))
    out.append(place(r_, 0, 0, 0, 0, 'kitchen_island', c, stage='furniture', room='cozinha'))
    for i, x in enumerate([-9.55, -8.8, -8.05, -7.3]):
        out.append(place(bar_stool(F['cognac']), x, -6.25, 0.02, 180, f'stool_{i}', c, stage='furniture', room='cozinha'))
    # pendentes da ilha
    for i, x in enumerate([-9.3, -8.3, -7.3]):
        out.append(place(pendant(1.15, 0.1), x, -7.35, 3.18, 0, f'pend_ilha_{i}', c, stage='lights', room='cozinha'))
    return out


def vanity(w, d=0.5, top=None, sinks=1, wood=None):
    top = top or F['white_marble']
    wood = wood or F['walnut']
    p = [box('vb', -w / 2, -d, 0.45, w / 2, 0, 0.85, wood),
         box('vt', -w / 2 - 0.01, -d - 0.01, 0.85, w / 2 + 0.01, 0.0, 0.88, top),
         box('mir', -w / 2 + 0.05, -0.012, 1.1, w / 2 - 0.05, 0.0, 2.05, F['mirror']),
         box('mled', -w / 2 + 0.05, -0.02, 1.08, w / 2 - 0.05, -0.012, 1.095, M['light'])]
    for i in range(sinks):
        x = -w / 2 + (i + 0.5) * w / sinks
        s = cyl('bowl', x, -d / 2, 0.88, 1.02, 0.2, F['ceramic'], seg=40, r2=0.16)
        p.append(s)
        p.append(cyl('tp', x, -0.06, 0.88, 1.15, 0.012, F['ink'], seg=12))
        p.append(box('tpb', x - 0.012, -0.22, 1.13, x + 0.012, -0.05, 1.15, F['ink']))
    return p


def wc():
    p = [rounded('wcb', -0.18, -0.55, 0.3, 0.18, 0.0, 0.42, 0.08, F['ceramic'], seg=5),
         rounded('wcs', -0.185, -0.56, 0.42, 0.185, 0.0, 0.44, 0.02, F['ceramic'], seg=3),
         box('wcp', -0.12, -0.03, 0.9, 0.12, 0.0, 1.06, M['steel'])]
    return p


def bathtub(l=1.7, w=0.8):
    o = rounded('tub', -l / 2, -w / 2, 0.0, l / 2, w / 2, 0.58, 0.2, F['ceramic'], seg=6)
    inner = rounded('tubi', -l / 2 + 0.07, -w / 2 + 0.07, 0.12, l / 2 - 0.07, w / 2 - 0.07, 0.8, 0.17, None, seg=6)
    lib.boolean(o, [inner], op='DIFFERENCE', solver='EXACT')
    tap = [cyl('tt', l / 2 + 0.18, 0, 0, 0.95, 0.02, F['ink'], seg=12),
           box('ttb', l / 2 - 0.05, -0.012, 0.93, l / 2 + 0.2, 0.012, 0.96, F['ink'])]
    return [o] + tap


def shower(x0, y0, x1, y1, z0, glass_side, c):
    """Box de vidro + chuveiro de teto."""
    p = []
    if glass_side == 'x0':
        p.append(box('sg', x0 - 0.005, y0, z0, x0 + 0.005, y1 - 0.6, z0 + 2.1, M['rail_glass']))
    elif glass_side == 'y1':
        p.append(box('sg', x0, y1 - 0.005, z0, x1 - 0.6, y1 + 0.005, z0 + 2.1, M['rail_glass']))
    shc = (x0 + x1) / 2, (y0 + y1) / 2
    hd = [cyl('sh', shc[0], shc[1], z0 + 2.62, z0 + 2.79, 0.012, F['ink'], seg=8),
          cyl('sh', shc[0], shc[1], z0 + 2.6, z0 + 2.62, 0.16, F['ink'], seg=32),
          box('dr', shc[0] - 0.4, shc[1] - 0.04, z0 + 0.021, shc[0] + 0.4, shc[1] + 0.04, z0 + 0.024, M['steel'])]
    g = join(p, 'shower_glass')
    lib.move_to(g, c)
    tag(g, glass=1, lm=0, stage='furniture')
    h = join(hd, 'shower_fix')
    lib.move_to(h, c)
    tag(h, lm=1, stage='furniture')
    return [g, h]


def curtain(x0, x1, y, z0, z1, c, axis='x', name='curtain'):
    """Cortina de voil franzida (superfície ondulada)."""
    bm = bmesh.new()
    n = max(8, int(abs(x1 - x0) / 0.04))
    rows = []
    for zz in (z0, z1):
        row = []
        for i in range(n + 1):
            u = x0 + (x1 - x0) * i / n
            off = math.sin(i / n * (x1 - x0) / 0.22 * math.pi * 2) * 0.045
            if axis == 'x':
                row.append(bm.verts.new((u, y + off, zz)))
            else:
                row.append(bm.verts.new((y + off, u, zz)))
        rows.append(row)
    for i in range(n):
        bm.faces.new([rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]])
    o = lib.mesh_obj(name, bm, F['curtain'], c)
    for p in o.data.polygons:
        p.use_smooth = True
    tag(o, lm=0, curtain=1, stage='furniture')
    return o


def books_row(w, h=0.24, seed=0):
    import random
    random.seed(seed)
    p = []
    x = -w / 2
    while x < w / 2 - 0.03:
        t = random.uniform(0.02, 0.045)
        hh = h * random.uniform(0.75, 1.0)
        p.append(box('bk', x, -0.1, 0, x + t, 0.1, hh, random.choice(F['books'])))
        x += t + 0.002
    return p


def art(w, h, i, depth=0.03):
    return [box('af', -w / 2 - 0.02, 0, 0, w / 2 + 0.02, depth, h + 0.04, F['ink']),
            box('ac', -w / 2, -0.002, 0.02, w / 2, 0.0, h + 0.02, F['art'][i % 4])]


def rot_art(objs, axis_from_wall):
    return objs


# ------------------------------------------------------------------ ambientes
def build_all(Ma):
    mats(Ma)
    c = coll('furniture')
    out = []
    S = dict(stage='furniture')
    # ---------- sala de estar
    out.append(place(rug(5.2, 3.6, F['rug']), 6.4, -8.0, 0.02, 0, 'rug_estar', c, room='estar', **S))
    out.append(place(l_sofa(F['linen']), 6.6, -6.4, 0.02, 0, 'sofa_estar', c, room='estar', **S))
    out.append(place(coffee_table_block(1.3, 0.8, 0.32, F['travertine']), 6.0, -8.35, 0.032, 0, 'mesa_centro_a', c, room='estar', **S))
    out.append(place(coffee_table_block(0.7, 0.7, 0.24, F['walnut']), 7.15, -8.75, 0.032, 12, 'mesa_centro_b', c, room='estar', **S))
    out.append(ph('modern_arm_chair_01', 9.5, -7.6, 0.02, 100, c=c, room='estar', **S))
    out.append(ph('modern_arm_chair_01', 9.45, -8.85, 0.02, 80, c=c, room='estar', **S))
    out.append(ph('mid_century_lounge_chair', 10.6, -9.6, 0.02, -60, c=c, room='estar', **S))
    out.append(ph('Ottoman_01', 11.2, -8.6, 0.02, 0, scale=0.9, c=c, room='estar', **S))
    out.append(place(floor_lamp(), 11.4, -10.3, 0.02, 0, 'lamp_estar', c, room='estar', **S))
    out.append(ph('modern_wooden_cabinet', 6.5, -10.62, 0.02, 0, c=c, room='estar', **S))
    out.append(place([box('tv', -1.1, 0, 0, 1.1, 0.04, 1.24, F['screen']), box('tvb', -1.1, 0.04, 0.05, 1.1, 0.06, 1.2, F['ink'])],
                     6.5, -10.815, 1.2, 180, 'tv_estar', c, room='estar', **S))
    out.append(ph('ceramic_vase_01', 5.35, -10.62, 0.6, 0, c=c, room='estar', **S))
    out.append(ph('potted_plant_02', 3.9, -10.4, 0.02, 30, scale=1.2, c=c, bake=False, room='estar', **S))
    out.append(ph('pachira_aquatica_01', 11.35, -4.75, 0.02, 0, scale=1.0, c=c, bake=False, room='estar', **S))
    out.append(ph('wooden_bowl_01', 6.0, -8.3, 0.352, 0, c=c, room='estar', **S))
    out.append(place(books_row(0.4, 0.05, 3), 5.7, -8.5, 0.352, 90, 'livros_mesa', c, room='estar', **S))
    out.append(curtain(1.5, 2.4, -4.25, 0.02, 3.12, c, name='cortina_estar_a'))
    out.append(curtain(-10.6, -9.4, 11.75, 0.02, 3.12, c, axis='y', name='cortina_estar_b'))
    rp = []
    xx = 3.3
    while xx < 10.05:
        rp.append(box('rp', xx, -10.925, 0.02, xx + 0.035, -10.875, 3.18, Ma['wood_slat']))
        xx += 0.07
    out.append(place(rp, 0, 0, 0, 0, 'ripado_estar', c, room='estar', **S))
    # ---------- jantar
    tbl = [rounded('tt', -1.45, -0.52, 0.72, 1.45, 0.52, 0.76, 0.01, F['walnut'], seg=2),
           box('tl', -1.0, -0.06, 0.0, -0.9, 0.06, 0.72, F['ink']), box('tl', 0.9, -0.06, 0.0, 1.0, 0.06, 0.72, F['ink']),
           box('tlb', -1.0, -0.36, 0.0, -0.9, 0.36, 0.04, F['ink']), box('tlb', 0.9, -0.36, 0.0, 1.0, 0.36, 0.04, F['ink'])]
    out.append(place(tbl, -1.9, -7.0, 0.02, 0, 'mesa_jantar', c, room='jantar', **S))
    k = 0
    for x in (-2.85, -1.9, -0.95):
        out.append(place(dining_chair(F['taupe'], F['ink']), x, -7.72, 0.02, 0, f'cad_{k}', c, room='jantar', **S)); k += 1
        out.append(place(dining_chair(F['taupe'], F['ink']), x, -6.28, 0.02, 180, f'cad_{k}', c, room='jantar', **S)); k += 1
    out.append(place(dining_chair(F['taupe'], F['ink']), -3.72, -7.0, 0.02, -90, f'cad_{k}', c, room='jantar', **S))
    out.append(place(dining_chair(F['taupe'], F['ink']), -0.08, -7.0, 0.02, 90, f'cad_{k+1}', c, room='jantar', **S))
    out.append(place(linear_pendant(2.2, 0.85), -1.9, -7.0, 3.18, 0, 'pend_jantar', c, stage='lights', room='jantar'))
    out.append(ph('ceramic_vase_03', -2.1, -7.0, 0.78, 0, scale=0.6, c=c, room='jantar', **S))
    # aparador divisor hall/jantar
    ap = [box('ap', -1.5, -0.22, 0.12, 1.5, 0.22, 0.8, F['walnut']), box('apb', -1.4, -0.18, 0.0, 1.4, 0.18, 0.12, F['ink'])]
    out.append(place(ap, -2.75, -9.72, 0.02, 0, 'aparador', c, room='jantar', **S))
    out.append(place(books_row(0.5, 0.26, 5), -3.6, -9.72, 0.82, 0, 'livros_ap', c, room='jantar', **S))
    out.append(ph('ceramic_vase_01', -1.9, -9.72, 0.82, 0, scale=0.9, c=c, room='jantar', **S))
    out.append(place(art(1.4, 1.0, 0), -4.0, -13.395, 1.2, 180, 'quadro_hall', c, room='hall', **S))
    # ---------- cozinha
    out += kitchen(Ma)
    # ---------- hall e lavabo
    out.append(ph('potted_plant_04', -4.5, -10.6, 0.02, 0, scale=1.5, c=c, bake=False, room='hall', **S))
    bench = [rounded('bn', -0.8, -0.2, 0.36, 0.8, 0.2, 0.44, 0.01, F['oak'], seg=2),
             box('bnl', -0.7, -0.15, 0, -0.66, 0.15, 0.36, F['ink']), box('bnl', 0.66, -0.15, 0, 0.7, 0.15, 0.36, F['ink'])]
    out.append(place(bench, -2.5, -13.17, 0.02, 0, 'banco_hall', c, room='hall', **S))
    lv = [box('lvt', -0.55, -0.24, 0.8, 0.55, 0.24, 0.88, F['black_marble']),
          cyl('lvb', 0.0, 0.0, 0.88, 1.0, 0.19, F['ceramic'], seg=40, r2=0.15),
          cyl('lvm', 0.0, 0.2, 1.15, 1.9, 0.0, F['mirror'], seg=4)]
    lv = lv[:2]
    lv.append(box('lvmir', -0.4, 0.235, 1.1, 0.4, 0.24, 2.0, F['mirror']))
    lv.append(cyl('tp', 0, 0.2, 0.88, 1.12, 0.011, F['brass'], seg=12))
    lv.append(box('tpb', -0.011, 0.07, 1.1, 0.011, 0.2, 1.12, F['brass']))
    out.append(place(lv, -4.0, -15.6, 0.02, 0, 'lavabo_bancada', c, room='lavabo', **S))
    out.append(place(wc(), -3.35, -14.5, 0.02, 90, 'wc_lavabo', c, room='lavabo', **S))
    # ---------- sala íntima (TV)
    out.append(place(rug(3.6, 2.6, F['rug_dark']), 6.5, -13.4, 0.02, 0, 'rug_tv', c, room='tv', **S))
    out.append(place(sofa_bench(3.2, 1.0, F['graphite_fab']), 6.5, -15.15, 0.02, 180, 'sofa_tv', c, room='tv', **S))
    out.append(place(coffee_table_block(1.0, 0.6, 0.34, F['walnut']), 6.5, -13.5, 0.032, 0, 'mesa_tv', c, room='tv', **S))
    out.append(place([box('tv', -1.0, 0, 0, 1.0, 0.04, 1.12, F['screen'])], 6.5, -11.12, 1.15, 180, 'tv_tv', c, room='tv', **S))
    out.append(ph('mid_century_lounge_chair', 3.3, -13.6, 0.02, -70, c=c, room='tv', **S))
    out.append(ph('calathea_orbifolia_01', 11.3, -15.3, 0.02, 0, scale=1.0, c=c, bake=False, room='tv', **S))
    # ---------- área gourmet
    gr = [box('gb', -0.6, -1.9, 0.0, 0.0, 1.9, 0.9, F['concrete_bench']),
          box('gt', -0.65, -1.95, 0.9, 0.04, 1.95, 0.95, F['black_marble']),
          box('gw', -0.6, 0.3, 0.95, -0.05, 1.5, 1.05, F['ink']),
          box('gh', -0.62, 0.15, 2.2, 0.08, 1.65, 3.2, M['stone']),
          box('ghb', -0.62, 0.15, 1.9, 0.08, 1.65, 2.2, F['ink']),
          box('gc', -0.58, 0.3, 0.95, -0.05, 1.5, 1.0, M['steel'])]
    out.append(place(gr, -11.25, -1.6, 0.02, 0, 'churrasqueira', c, room='gourmet', **S))
    gt = [rounded('ot', -1.3, -0.5, 0.72, 1.3, 0.5, 0.77, 0.01, F['oak'], seg=2),
          box('otl', -1.1, -0.4, 0, -1.04, 0.4, 0.72, F['ink']), box('otl', 1.04, -0.4, 0, 1.1, 0.4, 0.72, F['ink'])]
    out.append(place(gt, -6.6, -1.3, 0.02, 0, 'mesa_gourmet', c, room='gourmet', **S))
    for i, (x, y, r) in enumerate([(-7.5, -2.0, 0), (-6.6, -2.0, 0), (-5.7, -2.0, 0), (-7.5, -0.6, 180),
                                   (-6.6, -0.6, 180), (-5.7, -0.6, 180)]):
        out.append(place(dining_chair(F['linen'], F['ink']), x, y, 0.02, r, f'cad_g_{i}', c, room='gourmet', **S))
    out.append(place(linear_pendant(2.0, 0.9), -6.6, -1.3, 3.2, 0, 'pend_gourmet', c, stage='lights', room='gourmet'))
    # ---------- suíte master
    out.append(place(rug(3.6, 3.0, F['rug']), -7.8, -9.5, 3.52, 0, 'rug_master', c, room='suite_master', **S))
    out.append(place(headboard_wall(4.2, 1.25, F['taupe']), -7.8, -11.43, 3.52, 0, 'cabeceira_master', c, room='suite_master', **S))
    out.append(place([box('pw', -2.6, 0, 0, 2.6, 0.03, 2.75, F['walnut'])], -7.8, -11.45, 3.52, 0, 'painel_master', c, room='suite_master', **S))
    out.append(place(bed(1.95), -7.8, -11.33, 3.52, 180, 'cama_master', c, room='suite_master', **S))
    for x in (-9.25, -6.35):
        out.append(place(nightstand(F['walnut']), x, -11.1, 3.52, 0, 'criado', c, room='suite_master', **S))
        out.append(place(pendant(1.95, 0.09), x, -11.05, 6.28, 0, 'pend_master', c, stage='lights', room='suite_master'))
    benchm = [rounded('bm', -0.75, -0.22, 0.32, 0.75, 0.22, 0.46, 0.04, F['cognac'], seg=3),
              box('bml', -0.7, -0.18, 0, -0.67, 0.18, 0.32, F['brass']), box('bml', 0.67, -0.18, 0, 0.7, 0.18, 0.32, F['brass'])]
    out.append(place(benchm, -7.8, -8.85, 3.52, 0, 'banco_master', c, room='suite_master', **S))
    out.append(ph('mid_century_lounge_chair', -11.3, -7.1, 3.52, 140, c=c, room='suite_master', **S))
    out.append(ph('potted_plant_02', -11.9, -10.9, 3.52, 0, scale=1.1, c=c, bake=False, room='suite_master', **S))
    out.append(curtain(-12.1, -11.0, -6.25, 3.52, 6.22, c, name='cortina_master_a'))
    out.append(curtain(-3.6, -2.5, -6.25, 3.52, 6.22, c, name='cortina_master_b'))
    # closet master
    out.append(place(wardrobe(5.0), -2.075, -14.35, 3.52, -90, 'armario_closet_l', c, room='closet', **S))
    out.append(place(wardrobe(2.8), -5.9, -11.575, 3.52, 0, 'armario_closet_n', c, room='closet', **S))
    out.append(place(wardrobe(2.3), -7.425, -16.0, 3.52, 90, 'armario_closet_o', c, room='closet', **S))
    isl = [box('ci', -0.9, -0.4, 0.08, 0.9, 0.4, 0.9, F['walnut']), box('cit', -0.92, -0.42, 0.9, 0.92, 0.42, 0.93, F['black_glass']),
           box('cib', -0.85, -0.35, 0, 0.85, 0.35, 0.08, F['ink'])]
    out.append(place(isl, -4.9, -14.4, 3.52, 90, 'ilha_closet', c, room='closet', **S))
    # banho master
    out.append(place(bathtub(), -10.0, -16.55, 3.52, 0, 'banheira', c, room='banho_master', **S))
    out.append(place(vanity(2.4, sinks=2), -11.0, -11.66, 3.52, 180, 'bancada_master', c, room='banho_master', **S))
    out += shower(-9.3, -13.4, -7.6, -11.65, 3.52, 'x0', c)
    out.append(place(wc(), -7.62, -16.4, 3.52, 90, 'wc_master', c, room='banho_master', **S))
    out.append(ph('potted_plant_04', -12.1, -16.7, 3.52, 0, c=c, bake=False, room='banho_master', **S))
    # ---------- suíte 2
    out.append(place(rug(2.8, 2.4, F['rug']), 5.4, -9.2, 3.52, 0, 'rug_s2', c, room='suite_2', **S))
    out.append(place(headboard_wall(3.0, 1.1, F['linen']), 5.4, -10.93, 3.52, 0, 'cabeceira_s2', c, room='suite_2', **S))
    out.append(place(bed(1.6), 5.4, -10.83, 3.52, 180, 'cama_s2', c, room='suite_2', **S))
    for x in (4.2, 6.6):
        out.append(place(nightstand(F['oak']), x, -10.6, 3.52, 0, 'criado2', c, room='suite_2', **S))
    out.append(ph('modern_arm_chair_01', 7.7, -7.0, 3.52, 220, c=c, room='suite_2', **S))
    out.append(curtain(7.2, 8.1, -6.25, 3.52, 6.22, c, name='cortina_s2'))
    out.append(place(wardrobe(3.1), 2.85, -13.45, 3.52, 0, 'armario_s2', c, room='closet_2', **S))
    out.append(place(vanity(1.6), 6.0, -11.15, 3.52, 180, 'bancada_s2', c, room='banho_2', **S))
    out += shower(7.3, -13.5, 8.42, -11.1, 3.52, 'x0', c)
    out.append(place(wc(), 5.2, -13.48, 3.52, 0, 'wc_s2', c, room='banho_2', **S))
    # ---------- escritório
    desk = [rounded('dt', -0.9, -0.38, 0.73, 0.9, 0.38, 0.76, 0.006, F['oak'], seg=2),
            box('dl', -0.85, -0.33, 0, -0.82, 0.33, 0.73, F['ink']), box('dl', 0.82, -0.33, 0, 0.85, 0.33, 0.73, F['ink'])]
    out.append(place(desk, 4.6, -16.2, 3.52, 0, 'mesa_escritorio', c, room='escritorio', **S))
    out.append(place(dining_chair(F['cognac'], F['ink']), 4.6, -15.6, 3.52, 180, 'cadeira_escritorio', c, room='escritorio', **S))
    out.append(ph('desk_lamp_arm_01', 5.3, -16.35, 4.28, 200, c=c, room='escritorio', **S))
    shelf = [box('sh', -2.4, -0.34, 0, 2.4, 0, 0.06, F['walnut'])]
    for zz in (0.7, 1.15, 1.6, 2.05, 2.5):
        shelf.append(box('shs', -2.4, -0.32, zz, 2.4, 0, zz + 0.03, F['walnut']))
    for xx in (-2.4, -0.8, 0.8, 2.37):
        shelf.append(box('shv', xx, -0.34, 0, xx + 0.03, 0, 2.55, F['walnut']))
    shelf.append(box('shb', -2.4, -0.34, 0.06, 2.4, -0.02, 0.7, F['graphite']))
    out.append(place(shelf, 4.85, -13.7, 3.52, 180, 'estante', c, room='escritorio', **S))
    for i, (xx, zz) in enumerate([(3.6, 0.73), (5.3, 0.73), (6.2, 1.18), (4.0, 1.63), (5.6, 1.63), (3.5, 2.08), (6.1, 2.08)]):
        out.append(place(books_row(1.0 if i % 2 else 0.7, 0.26, i), xx, -13.85, 3.52 + zz, 180, f'livros_{i}', c, room='escritorio', **S))
    out.append(ph('modern_arm_chair_01', 7.6, -14.5, 3.52, 230, c=c, room='escritorio', **S))
    out.append(ph('anthurium_botany_01', 2.0, -16.7, 3.52, 0, scale=1.4, c=c, bake=False, room='escritorio', **S))
    # ---------- galeria
    out.append(place(art(1.2, 0.85, 1), -1.895, -13.0, 4.8, 90, 'quadro_galeria', c, room='galeria', **S))
    out.append(ph('potted_plant_02', -1.6, -6.6, 3.52, 0, scale=1.1, c=c, bake=False, room='galeria', **S))
    # ---------- varanda
    for i, x in enumerate([-10.0, -8.4]):
        out.append(ph('modern_arm_chair_01', x, -3.4, 3.52, 180 + (i * 2 - 1) * 15, c=c, room='varanda', **S))
    out.append(place(coffee_table_block(0.6, 0.6, 0.4, F['travertine']), -9.2, -3.0, 3.52, 0, 'mesa_varanda', c, room='varanda', **S))
    cleanup_ph()
    return out
