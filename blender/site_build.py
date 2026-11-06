"""Terreno, paisagismo construído (pisos, piscina, deck, muros, acesso) e marcadores de vegetação."""
import bpy
import bmesh
import math
import json
import os
import random
from mathutils import Vector, Matrix
import lib
from lib import box, cyl, rounded, coll, tag, join, boolean
import plan as P
import arch
import furnish as FU

VEG = []  # (tipo, x, y, rotação, escala) — instanciado no navegador


def veg(kind, x, y, s=1.0, r=None):
    VEG.append(dict(kind=kind, x=round(x, 2), y=round(y, 2), r=round(r if r is not None else random.uniform(0, 360), 1),
                    s=round(s, 2)))


def deck_boards(xa, ya, xb, yb, mat, c, w=0.14, gap=0.006, z0=0.0, z1=0.03):
    """Deck de réguas: cada régua com chanfro, emendas desencontradas e UV deslocado (veios não se repetem)."""
    rnd = random.Random(31)
    parts = [box('deck_base', xa + 0.02, ya + 0.02, z0 - 0.04, xb - 0.02, yb - 0.02, z0 + 0.004, FU.F['ink'], c)]
    y = ya
    row = 0
    while y < yb - 0.02:
        y2 = min(y + w, yb)
        x = xa - rnd.uniform(0, 2.2) if row else xa
        while x < xb:
            L = rnd.uniform(2.4, 3.6)
            a, b = max(x, xa), min(x + L, xb)
            if b - a > 0.15:
                dz = rnd.uniform(-0.0015, 0.0015)
                o = box('dk', a + gap / 2, y + gap / 2, z0 + 0.004, b - gap / 2, y2 - gap / 2, z1 + dz, mat, c, bevel=0.003, seg=1)
                lib.world_uv(o, offset=(rnd.uniform(0, 9), rnd.uniform(0, 9)))
                o['uvok'] = 1
                parts.append(o)
            x += L
        y = y2
        row += 1
    lib.world_uv(parts[0])
    parts[0]['uvok'] = 1
    d = join(parts, 'deck')
    d['uvok'] = 1
    return d


def build_all(M):
    random.seed(7)
    F = FU.F
    mt = lib.material
    asphalt = mt('M_asphalt', 'brushed_concrete', tile=4.0, tint=(0.22, 0.22, 0.23), rough=0.9)
    sidewalk = mt('M_sidewalk', 'granite_tile_03', tile=1.6, tint=(0.8, 0.8, 0.8))
    lawn = mt('M_lawn', 'leafy_grass', tile=3.0, tint=(0.62, 0.78, 0.45), rough=1.0, kind='lawn')
    soil = mt('M_soil', 'forest_ground_04', tile=2.0, tint=(0.7, 0.65, 0.6))
    wall_m = mt('M_wall_site', 'wood_textured_concrete', tile=2.4, tint=(0.86, 0.85, 0.83), rough=0.88)
    socle_m = mt('M_wall_socle', 'concrete_wall_008', tile=2.0, tint=(0.42, 0.42, 0.42), rough=0.9)
    c = coll('site')
    out = []
    S = dict(stage='landscape')

    # ---------- gramado do lote (com recorte da piscina)
    lw = box('lawn', P.LOT['x0'], P.LOT['y0'], -0.3, P.LOT['x1'], P.LOT['y1'], -0.03, lawn, c)
    pool = P.POOL
    boolean(lw, [box('pc', pool['x0'] - 0.36, pool['y0'] - 0.36, -2, pool['x1'] + 0.36, pool['y1'] + 0.36, 1, None, c)])
    tag(lw, stage='terrain', lm=2, lawn=1)
    out.append(lw)

    # ---------- piscina
    x0, x1, y0, y1, d = pool['x0'], pool['x1'], pool['y0'], pool['y1'], pool['depth']
    shell = box('pool_shell', x0 - 0.36, y0 - 0.36, -d - 0.25, x1 + 0.36, y1 + 0.36, -0.0, F['pool_tile'], c)
    boolean(shell, [box('pi', x0, y0, -d, x1, y1, 1, None, c)])
    tag(shell, stage='landscape', lm=2, room='deck')
    out.append(shell)
    # degraus/banco submerso na ponta oeste
    stp = [box('ps', x0, y0, -0.45, x0 + 1.6, y1, -0.0 - 0.45 + 0.02, F['pool_tile'], c),
           box('ps', x0, y0, -d, x0 + 0.8, y1, -0.9, F['pool_tile'], c)]
    out.append(tag(join(stp, 'pool_steps'), stage='landscape', lm=2))
    water = box('pool_water', x0, y0, -d + 0.05, x1, y1, -0.08, F['water_plane'], c)
    # só a face de cima importa: remove o resto
    bm = bmesh.new()
    bm.from_mesh(water.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < 0.9], context='FACES')
    bm.to_mesh(water.data)
    bm.free()
    tag(water, stage='landscape', lm=0, water=1)
    out.append(water)
    cop = []
    cw = 0.36
    for (a, b, cc_, dd) in [(x0 - cw, y0 - cw, x1 + cw, y0), (x0 - cw, y1, x1 + cw, y1 + cw), (x0 - cw, y0, x0, y1),
                            (x1, y0, x1 + cw, y1)]:
        cop.append(box('cop', a, b, -0.0, cc_, dd, 0.035, sidewalk, c, bevel=0.008))
    out.append(tag(join(cop, 'pool_coping'), stage='landscape', lm=2, room='deck'))
    # luzes subaquáticas
    pl = []
    for x in [x0 + 2 + i * 2.5 for i in range(4)]:
        pl.append(cyl('pl', x, y0 + 0.003, -0.55, -0.5, 0.0, M['light_cool'], seg=4))
        pl.append(box('pl', x - 0.09, y0, -0.6, x + 0.09, y0 + 0.006, -0.45, M['light_cool'], c))
        arch.LIGHTS.append((x, y0 + 0.3, -0.52, 'pool', 30))
    pl = [p for p in pl if p.data.polygons]
    out.append(tag(join(pl, 'pool_lights'), stage='lights', emissive=1, lm=0))

    # ---------- deck e pisos externos
    out.append(tag(deck_boards(x0 - 0.36, y1 + 0.36, x1 + 0.36, 9.6, M['deck'], c), stage='landscape', lm=2, room='deck'))
    out.append(tag(box('paving_pool_w', -3.0, 2.6 - 0.36, -0.0, x0 - 0.36, 9.6, 0.02, M['paving'], c), stage='landscape', lm=2))
    out.append(tag(box('paving_pool_s', -3.0, 2.6 - 0.36 - 0.0, -0.0, x1 + 0.36, 2.6 - 0.36 + 0.0001, 0.02, M['paving'], c),
                   stage='landscape', lm=2))
    # espreguiçadeiras sobre o deck
    import upholstery as U
    for i, x in enumerate([1.5, 3.0, 8.0, 9.5]):
        out.append(FU.place(U.lounger(F, seed=i), x, 8.45, 0.03, 0, f'espreguicadeira_{i}', c, room='deck', **S))
    out.append(FU.ph('side_table_01', 2.25, 8.9, 0.03, 0, c=c, name='mesinha_deck_a', **S))
    out.append(FU.ph('side_table_01', 8.75, 8.9, 0.03, 0, c=c, name='mesinha_deck_b', **S))

    # ---------- área de convivência com lareira externa (jardim norte)
    cx, cy = -8.0, 14.5
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=3.4)
    bmesh.ops.translate(bm, vec=(cx, cy, 0.0), verts=bm.verts)
    f_ = [f for f in bm.faces][0]
    ext = bmesh.ops.extrude_face_region(bm, geom=[f_])
    bmesh.ops.translate(bm, vec=(0, 0, 0.03), verts=[g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    out.append(tag(lib.mesh_obj('lounge_paving', bm, M['paving'], c), stage='landscape', lm=2))
    # banco curvo de concreto em arco
    seg = []
    for i in range(22):
        a0 = math.radians(110 + i * 7)
        a1 = math.radians(110 + (i + 1) * 7)
        r0, r1 = 2.35, 2.95
        pts = [(cx + r0 * math.cos(a0), cy + r0 * math.sin(a0)), (cx + r1 * math.cos(a0), cy + r1 * math.sin(a0)),
               (cx + r1 * math.cos(a1), cy + r1 * math.sin(a1)), (cx + r0 * math.cos(a1), cy + r0 * math.sin(a1))]
        seg.append(lib.poly_prism('bc', pts[::-1], 0.03, 0.45, F['concrete_bench'], c))
    bench = join(seg, 'lounge_bench')
    out.append(tag(bench, stage='landscape', lm=2))
    cush = []
    for i in range(20):
        a0 = math.radians(111 + i * 7.6)
        a1 = math.radians(111 + (i + 1) * 7.6 - 0.6)
        r0, r1 = 2.4, 2.9
        pts = [(cx + r0 * math.cos(a0), cy + r0 * math.sin(a0)), (cx + r1 * math.cos(a0), cy + r1 * math.sin(a0)),
               (cx + r1 * math.cos(a1), cy + r1 * math.sin(a1)), (cx + r0 * math.cos(a1), cy + r0 * math.sin(a1))]
        cush.append(lib.poly_prism('cu', pts[::-1], 0.45, 0.53, F['linen'], c))
    out.append(tag(join(cush, 'lounge_cushions'), stage='landscape', lm=2))
    fp = cyl('firepit', cx, cy, 0.03, 0.42, 0.62, F['concrete_bench'], c, seg=48)
    inner = cyl('fpi', cx, cy, 0.3, 0.6, 0.48, None, c, seg=48)
    boolean(fp, [inner])
    out.append(tag(fp, stage='landscape', lm=2))
    fire = cyl('fire', cx, cy, 0.3, 0.33, 0.47, F['ink'], c, seg=32)
    out.append(tag(fire, stage='landscape', lm=0, fire=1))
    arch.LIGHTS.append((cx, cy, 0.7, 'fire', 60))

    # ---------- acesso: calçada, rua, entrada de veículos, pisantes
    out.append(tag(box('street', -60, -38, -0.12, 60, -28.6, -0.08, asphalt, c), stage='terrain', lm=0))
    out.append(tag(box('curb', -60, -28.75, -0.12, 60, -28.6, 0.0, sidewalk, c), stage='terrain', lm=0))
    out.append(tag(box('sidewalk', -60, -28.6, -0.12, 60, -26.0, -0.0, sidewalk, c), stage='terrain', lm=0))
    out.append(tag(box('driveway', -12.25, -26.0, -0.1, -4.75, -16.0, 0.0, M['concrete_floor'], c), stage='landscape', lm=2))
    out.append(tag(box('entry_plat', -3.6, -17.6, -0.1, 0.6, -16.125, 0.02, M['paving'], c), stage='landscape', lm=2))
    stones = []
    y = -25.6
    i = 0
    while y < -18.2:
        xo = -1.65 + (0.18 if i % 2 else -0.12)
        stones.append(box('pis', xo - 0.6, y, -0.08, xo + 0.6, y + 0.55, 0.0, F['concrete_bench'], c, bevel=0.01))
        y += 0.85
        i += 1
    out.append(tag(join(stones, 'stepping_stones'), stage='landscape', lm=2))
    # canteiros com seixos ao longo das fachadas
    beds = [(-4.6, -18.0, -3.65, -16.2), (0.65, -18.0, 11.9, -16.2), (12.2, -16.0, 13.6, -3.0), (-15.6, -16.0, -12.25, -2.0)]
    pb = [box('bed', a, b, -0.08, cc_, dd, -0.01, M['gravel'], c) for (a, b, cc_, dd) in beds]
    out.append(tag(join(pb, 'garden_beds'), stage='landscape', lm=2))
    edge_m = mt('M_edge_steel', color=(0.12, 0.08, 0.06), rough=0.6, metal=0.6)
    eg = []
    for (a, b, cc_, dd) in beds:
        for (ea, eb, ec, ed) in [(a, b - 0.006, cc_, b), (a, dd, cc_, dd + 0.006), (a - 0.006, b, a, dd), (cc_, b, cc_ + 0.006, dd)]:
            eg.append(box('eg', ea, eb, -0.1, ec, ed, 0.005, edge_m, c))
    out.append(tag(join(eg, 'garden_edges'), stage='landscape', lm=2))

    # ---------- muros do lote
    walls = [(-16.15, -26.0, -15.85, 26.0, 2.4), (15.85, -26.0, 16.15, 26.0, 2.4), (-16.15, 25.85, 16.15, 26.15, 2.4)]
    wm = [box('muro', a, b, 0.22, cc_, dd, h, wall_m, c, bevel=0.006) for (a, b, cc_, dd, h) in walls]
    for (a, b, cc_, dd, h) in walls:
        ex = 0.02
        wm.append(box('muro_soco', a - ex, b - ex, -0.1, cc_ + ex, dd + ex, 0.22, socle_m, c, bevel=0.006))
        # capeamento com 4 cm de balanço e pingadeira (sulco escuro por baixo)
        wm.append(box('muro_top', a - 0.04, b - 0.04, h, cc_ + 0.04, dd + 0.04, h + 0.05, M['concrete'], c, bevel=0.005))
        # juntas verticais a cada 3 m nas duas faces
        long_y = dd - b > cc_ - a
        n0, n1 = (b, dd) if long_y else (a, cc_)
        k = n0 + 3.0
        while k < n1 - 0.5:
            if long_y:
                wm.append(box('junta', a - 0.004, k - 0.006, 0.22, cc_ + 0.004, k + 0.006, h, FU.F['ink'], c))
            else:
                wm.append(box('junta', k - 0.006, b - 0.004, 0.22, k + 0.006, dd + 0.004, h, FU.F['ink'], c))
            k += 3.0
    out.append(tag(join(wm, 'site_walls'), stage='landscape', lm=2))
    # muro frontal baixo em pedra com o nome da casa
    fw = [box('mf', -15.85, -26.0, -0.1, -12.55, -25.7, 0.75, M['stone'], c),
          box('mf', -4.45, -26.0, -0.1, -2.5, -25.7, 1.6, M['stone'], c),
          box('mf', -0.8, -26.0, -0.1, 15.85, -25.7, 0.75, M['stone'], c)]
    out.append(tag(join(fw, 'front_wall'), stage='landscape', lm=2))
    plate = [box('np', -4.25, -26.03, 0.9, -2.7, -26.0, 1.35, F['brass'], c)]
    out.append(tag(join(plate, 'name_plate'), stage='landscape', lm=2))

    # ---------- balizadores e luzes de jardim
    bl = []

    def bollard(x, y):
        bl.append(cyl('bol', x, y, -0.02, 0.62, 0.05, M['frame'], c, seg=16))
        bl.append(cyl('bolL', x, y, 0.5, 0.56, 0.051, M['light'], c, seg=16))
        arch.LIGHTS.append((x, y, 0.55, 'bollard', 8))

    for yy in (-24.6, -22.4, -20.2, -18.6):
        bollard(-2.75, yy)
    for xx in (-1.5, 2.0, 6.0, 10.0):
        bollard(xx, 10.2)
    for yy in (-14.0, -9.0, -4.0):
        bollard(13.2, yy)
    out.append(tag(join(bl, 'bollards'), stage='lights', lm=1, emissive=1))

    # ---------- vegetação (instanciada no navegador)
    veg('jacaranda_tree', 11.2, -21.8, 0.85, 40)
    veg('jacaranda_tree', -9.5, 21.0, 0.9, 200)
    veg('island_tree_02', 12.6, 20.5, 1.0)
    veg('island_tree_02', 13.4, -22.8, 0.85)
    veg('island_tree_02', -13.6, 6.5, 0.8)
    veg('island_tree_02', 3.0, 22.5, 0.75)
    veg('jacaranda_tree', -14.0, -21.0, 0.7, 120)
    shrubs = ['shrub_02', 'shrub_02', 'shrub_03', 'shrub_04']
    # cinturão dos muros e canteiros da fachada: plantio em camadas (blender/planting.py)
    for i in range(10):
        a = math.radians(100 + i * 18)
        veg(random.choice(shrubs), cx + 3.7 * math.cos(a), cy + 3.7 * math.sin(a), random.uniform(0.8, 1.2))
    for (x, y) in [(-5.6, -24.0), (-6.4, -18.8), (1.0, -24.5), (9.0, -24.0), (12.5, -18.6)]:
        veg('boulder_01', x, y, random.uniform(0.25, 0.4))
    for (x, y) in [(-0.6, -20.5), (2.8, -23.4), (-13.5, -24.6)]:
        veg('fern_02', x, y, 1.4)
    veg('pachira_aquatica_01', -12.6, 1.6, 1.3)
    FU.cleanup_ph()
    import planting
    VEG[:] = planting.generate(VEG)
    with open(os.path.join(lib.ROOT, 'blender', 'vegetation.json'), 'w') as fh:
        json.dump(VEG, fh)
    return out
