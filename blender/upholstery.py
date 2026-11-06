"""Estofados, têxteis e peças de mobiliário com modelagem real (CASA NEXUS).

Substitui as "caixas arredondadas" por geometria que a luz lê como objeto real:
  - cushion(): caixa em grade arredondada por SDF, com estufamento (puff), afundamento do assento (sag),
    rugas de baixa amplitude e vivo (piping) na costura superior;
  - pillow(): almofada de encosto com cantos repuxados e vinco central;
  - drape(): tecido caído por simulação de pano do Blender (edredom, manta, toalha) sobre colisores;
  - curtain(): cortina franzida com pregas irregulares, barra e cabeçote.
Todas as peças nascem na origem (frente para -Y) e são posicionadas por furnish.place().
"""
import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix, noise
import lib
from lib import box, cyl

# ------------------------------------------------------------------ malha base: cubo em grade
def _grid_cube(bm, nx, ny, nz):
    """Cubo unitário (-1..1) com nx×ny×nz divisões, faces quadradas compartilhando vértices."""
    verts = {}

    def V(i, j, k):
        key = (i, j, k)
        if key not in verts:
            verts[key] = bm.verts.new((-1 + 2 * i / nx, -1 + 2 * j / ny, -1 + 2 * k / nz))
        return verts[key]

    for j in range(ny):
        for k in range(nz):
            bm.faces.new([V(0, j, k), V(0, j, k + 1), V(0, j + 1, k + 1), V(0, j + 1, k)])
            bm.faces.new([V(nx, j, k), V(nx, j + 1, k), V(nx, j + 1, k + 1), V(nx, j, k + 1)])
    for i in range(nx):
        for k in range(nz):
            bm.faces.new([V(i, 0, k), V(i + 1, 0, k), V(i + 1, 0, k + 1), V(i, 0, k + 1)])
            bm.faces.new([V(i, ny, k), V(i, ny, k + 1), V(i + 1, ny, k + 1), V(i + 1, ny, k)])
    for i in range(nx):
        for j in range(ny):
            bm.faces.new([V(i, j, 0), V(i, j + 1, 0), V(i + 1, j + 1, 0), V(i + 1, j, 0)])
            bm.faces.new([V(i, j, nz), V(i + 1, j, nz), V(i + 1, j + 1, nz), V(i, j + 1, nz)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def _res(size, step=0.035, lo=4, hi=48):
    return max(lo, min(hi, int(math.ceil(size / step))))


def _smooth(o, levels=1):
    for p in o.data.polygons:
        p.use_smooth = True
    if levels:
        m = o.modifiers.new('sub', 'SUBSURF')
        m.levels = levels
        m.render_levels = levels
        lib.apply_mods(o)
    return o


def cushion(name, x0, y0, z0, x1, y1, z1, mat, r=0.04, puff=0.015, sag=0.0, wrinkle=0.0025, seed=0,
            piping=None, side_bulge=0.5, sub=1):
    """Almofada de estofado: arredondada, estufada, com rugas leves. piping = material do vivo (ou None)."""
    hx, hy, hz = (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    r = min(r, hx * 0.95, hy * 0.95, hz * 0.95)
    bm = bmesh.new()
    _grid_cube(bm, _res(2 * hx), _res(2 * hy), _res(2 * hz, 0.025, 3, 24))
    rnd = random.Random(seed)
    off = Vector((rnd.uniform(0, 100), rnd.uniform(0, 100), rnd.uniform(0, 100)))
    for v in bm.verts:
        u, w, t = v.co.x, v.co.y, v.co.z
        p = Vector((u * hx, w * hy, t * hz))
        # SDF de caixa arredondada: projeta a casca do cubo na superfície com raio r
        inner = Vector((max(-hx + r, min(hx - r, p.x)), max(-hy + r, min(hy - r, p.y)), max(-hz + r, min(hz - r, p.z))))
        d = p - inner
        if d.length > 1e-9:
            p = inner + d.normalized() * r
        fu, fw, ft = 1 - u * u, 1 - w * w, 1 - t * t
        # estufamento: topo e base sobem/descem no centro; laterais abaulam
        p.z += math.copysign(1, t) * puff * fu * fw * (abs(t) ** 2)
        p.x += math.copysign(1, u) * puff * side_bulge * fw * ft * (abs(u) ** 2)
        p.y += math.copysign(1, w) * puff * side_bulge * fu * ft * (abs(w) ** 2)
        if t > 0 and sag:
            p.z -= sag * (fu ** 1.5) * (fw ** 1.5)
        if wrinkle:
            n = noise.noise(p * 9.0 + off) * 0.7 + noise.noise(p * 23.0 + off) * 0.3
            p += (p - inner).normalized() * (wrinkle * n) if (p - inner).length > 1e-9 else Vector()
        v.co = Vector((cx, cy, cz)) + p
    o = lib.mesh_obj(name, bm, mat)
    _smooth(o, sub)
    if piping is not None:
        return [o, _piping(name + '_piping', x0, y0, x1, y1, z1 - r * 0.32 + puff * 0.15, r * 0.7, piping)]
    return o


def _rounded_rect_path(x0, y0, x1, y1, r, z, seg=6):
    pts = []
    corners = [(x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)]
    for (cx, cy, a0) in corners:
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append(Vector((cx + r * math.cos(a), cy + r * math.sin(a), z)))
    return pts


def _piping(name, x0, y0, x1, y1, z, r, mat, thick=0.0045):
    """Vivo da costura: tubo fino seguindo o contorno arredondado."""
    pts = _rounded_rect_path(x0 + 0.004, y0 + 0.004, x1 - 0.004, y1 - 0.004, max(r, 0.01), z)
    return tube(name, pts, thick, mat, closed=True, sides=8)


def tube(name, pts, radius, mat, closed=False, sides=10):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p.x, p.y, p.z, 1)
    sp.use_cyclic_u = closed
    cu.bevel_depth = radius
    cu.bevel_resolution = max(1, sides // 4)
    cu.use_fill_caps = True
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    with bpy.context.temp_override(selected_editable_objects=[o], active_object=o, object=o, selected_objects=[o]):
        bpy.ops.object.convert(target='MESH')
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def pillow(name, w, h, d, mat, seed=0, chop=0.25):
    """Almofada de encosto (frente -Y): cantos repuxados, miolo estufado e vinco no topo."""
    bm = bmesh.new()
    _grid_cube(bm, _res(w, 0.025), 3, _res(h, 0.025))
    rnd = random.Random(seed)
    for v in bm.verts:
        u, s, t = v.co.x, v.co.y, v.co.z
        f = max(0.0, (1 - u ** 8) * (1 - t ** 8)) ** 0.5 * (0.3 + 0.7 * (1 - u * u) * (1 - t * t))
        y = s * d / 2 * max(0.06, f)
        z = t * h / 2
        x = u * w / 2 * (1 - 0.06 * (1 - t * t) * abs(u))
        # vinco (karate chop) no centro do topo
        if t > 0:
            z -= chop * d * math.exp(-(u * 3.2) ** 2) * t ** 4
        n = noise.noise(Vector((x * 7 + seed, y * 7, z * 7)))
        y += s * 0.004 * n
        v.co = Vector((x, y, z + h / 2))
    o = lib.mesh_obj(name, bm, mat)
    return _smooth(o, 1)


# ------------------------------------------------------------------ simulação de pano
def drape(name, w, l, loc, mat, colliders, frames=45, res=0.025, rot=0.0, thickness=0.006, pin_edge=None,
          stiff=8.0, bend=0.6, mass=0.25, sub=1, z_drop=0.0, ruffle=0.025, seed=0):
    """Tecido de w×l m solto em loc (centro, altura) e assentado por simulação de pano sobre os colisores.
    pin_edge='y1' prende a borda de y máximo (ex.: toalha pendurada)."""
    nx, ny = max(8, int(w / res)), max(8, int(l / res))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= l
        # irregularidade inicial: sem ela o pano assenta "passado a ferro"
        v.co.z += ruffle * noise.noise(Vector((v.co.x * 2.2 + seed, v.co.y * 2.2, 0.3)))
    o = lib.mesh_obj(name, bm, mat)
    o.matrix_world = Matrix.Translation(Vector(loc) + Vector((0, 0, z_drop))) @ Matrix.Rotation(math.radians(rot), 4, 'Z')
    lib.apply_transform(o)
    if pin_edge:
        vg = o.vertex_groups.new(name='pin')
        ys = [v.co.y for v in o.data.vertices]
        ymax, ymin = max(ys), min(ys)
        idx = [v.index for v in o.data.vertices if (abs(v.co.y - ymax) < 1e-4 if pin_edge == 'y1' else abs(v.co.y - ymin) < 1e-4)]
        vg.add(idx, 1.0, 'REPLACE')
    added = []
    for c in colliders:
        if not any(m.type == 'COLLISION' for m in c.modifiers):
            m = c.modifiers.new('col', 'COLLISION')
            added.append((c, m))
        c.collision.thickness_outer = 0.004
        c.collision.cloth_friction = 8.0
    cm = o.modifiers.new('cloth', 'CLOTH')
    s = cm.settings
    s.quality = 8
    s.mass = mass
    s.tension_stiffness = stiff
    s.compression_stiffness = stiff
    s.shear_stiffness = stiff * 0.6
    s.bending_stiffness = bend
    s.air_damping = 1.0
    if pin_edge:
        s.vertex_group_mass = 'pin'
    cs = cm.collision_settings
    cs.distance_min = 0.004
    cs.use_self_collision = True
    cs.self_distance_min = 0.003
    cm.point_cache.frame_start = 1
    cm.point_cache.frame_end = frames
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    for f in range(1, frames + 1):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    o.modifiers.clear()
    old = o.data
    o.data = me
    bpy.data.meshes.remove(old)
    o.data.materials.clear()
    o.data.materials.append(mat)
    for c, m in added:
        c.modifiers.remove(m)
    sc.frame_set(1)
    if thickness:
        so = o.modifiers.new('sol', 'SOLIDIFY')
        so.thickness = thickness
        so.offset = 1.0
        lib.apply_mods(o)
    return _smooth(o, sub)


# ------------------------------------------------------------------ cortina franzida
def curtain(name, x0, x1, y, z0, z1, mat, axis='x', seed=0, fold=0.16, depth=0.05):
    """Cortina de voil com pregas irregulares, leve abertura na barra e cabeçote franzido."""
    rnd = random.Random(seed)
    L = abs(x1 - x0)
    nu = max(16, int(L / 0.012))
    nz = max(12, int((z1 - z0) / 0.06))
    # fase das pregas com período irregular
    phases = []
    ph = 0.0
    for i in range(nu + 1):
        ph += (L / nu) / (fold * rnd.uniform(0.75, 1.3)) * 2 * math.pi if i else 0
        phases.append(ph)
    amp = [depth * rnd.uniform(0.6, 1.2) for _ in range(nu + 1)]
    bm = bmesh.new()
    rows = []
    for k in range(nz + 1):
        t = k / nz  # 0 = barra, 1 = cabeçote
        zz = z0 + (z1 - z0) * t
        row = []
        for i in range(nu + 1):
            u = x0 + (x1 - x0) * i / nu
            a = amp[i] * (1.0 + 0.35 * (1 - t) ** 2)  # pregas abrem um pouco embaixo
            off = math.sin(phases[i]) * a + noise.noise(Vector((u * 3, zz * 2, seed))) * 0.01
            if t > 0.97:
                off *= 0.7
            row.append(bm.verts.new((u, y + off, zz) if axis == 'x' else (y + off, u, zz)))
        rows.append(row)
    for k in range(nz):
        for i in range(nu):
            bm.faces.new([rows[k][i], rows[k][i + 1], rows[k + 1][i + 1], rows[k + 1][i]])
    o = lib.mesh_obj(name, bm, mat)
    so = o.modifiers.new('sol', 'SOLIDIFY')
    so.thickness = 0.002
    lib.apply_mods(o)
    return _smooth(o, 0)


# ------------------------------------------------------------------ peças completas (origem no chão, frente -Y)
def sofa(F, w, d=1.05, h_seat=0.43, back=True, arms=(True, True), fab=None, seed=0, chaise=False):
    """Sofá contemporâneo: rodapé recuado escuro, base estofada, almofadas de assento e encosto soltas."""
    fab = fab or F['linen']
    p = []
    arm_w = 0.16
    ax0 = -w / 2 + (arm_w if arms[0] else 0)
    ax1 = w / 2 - (arm_w if arms[1] else 0)
    # rodapé recuado (sombra embaixo)
    p.append(box('plinth', -w / 2 + 0.06, -d / 2 + 0.06, 0.0, w / 2 - 0.06, d / 2 - 0.06, 0.07, F['ink'], bevel=0.004))
    # base estofada
    p.append(cushion('base', -w / 2, -d / 2, 0.07, w / 2, d / 2, 0.27, fab, r=0.035, puff=0.004, wrinkle=0.0012, seed=seed))
    # braços
    for side, on in ((-1, arms[0]), (1, arms[1])):
        if on:
            x0 = -w / 2 if side < 0 else w / 2 - arm_w
            p.append(cushion('arm', x0, -d / 2, 0.27, x0 + arm_w, d / 2, h_seat + 0.2, fab, r=0.05, puff=0.008,
                             wrinkle=0.0015, seed=seed + 3 * side))
    # encosto fixo (estrutura)
    by0 = d / 2 - 0.2
    if back:
        p.append(cushion('backf', -w / 2, by0, 0.27, w / 2, d / 2, h_seat + 0.33, fab, r=0.05, puff=0.006, wrinkle=0.0015,
                         seed=seed + 7))
    # almofadas do assento (com afundamento e vivo)
    n = max(1, round((ax1 - ax0) / 0.95))
    cw = (ax1 - ax0) / n
    sy1 = by0 + 0.02 if back else d / 2 - 0.02
    for i in range(n):
        x0 = ax0 + i * cw
        p += cushion(f'seat{i}', x0 + 0.006, -d / 2 + 0.01, 0.27, x0 + cw - 0.006, sy1, h_seat, fab, r=0.06, puff=0.022,
                     sag=0.012, wrinkle=0.003, seed=seed + 11 + i, piping=fab)
    # almofadas de encosto inclinadas
    if back:
        for i in range(n):
            x0 = ax0 + i * cw
            bk = cushion(f'back{i}', x0 + 0.01, by0 - 0.2, h_seat - 0.02, x0 + cw - 0.01, by0 + 0.02, h_seat + 0.44, fab,
                         r=0.08, puff=0.03, sag=0.0, wrinkle=0.0035, seed=seed + 21 + i, side_bulge=0.8)
            piv = Vector((0, by0, h_seat))
            bk.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-9), 4, 'X') @ Matrix.Translation(-piv))
            p.append(bk)
    return p


def l_sofa(F, fab=None, seed=0):
    """Sofá em L da sala de estar (mesma pegada do modelo anterior: 4,4 m + chaise 1,9 m)."""
    fab = fab or F['linen']
    main = sofa(F, 4.4, 1.05, fab=fab, seed=seed, arms=(False, True))
    for o in main:
        o.data.transform(Matrix.Translation((0.3, 0, 0)))
    ch = sofa(F, 1.05, 1.9, back=False, arms=(True, False), fab=fab, seed=seed + 50)
    for o in ch:
        o.data.transform(Matrix.Translation((-2.45, -0.43, 0)))
    throw = drape('throw_sofa', 0.75, 1.5, (-2.3, -0.75, 0.62), F['throw'], ch, frames=80, res=0.02, stiff=5,
                  bend=0.06, mass=0.3, thickness=0.007, rot=8, ruffle=0.05, seed=seed)
    pil = []
    for i, (x, m, rz) in enumerate([(-1.35, F['taupe'], 6), (-0.85, F['linen'], -4), (1.7, F['throw'], 5), (2.25, F['taupe'], -7)]):
        q = pillow(f'pil{i}', 0.5, 0.5, 0.17, m, seed=seed + i)
        q.data.transform(Matrix.Translation((x, -0.04, 0.41)) @ Matrix.Rotation(math.radians(rz), 4, 'Z') @
                         Matrix.Rotation(math.radians(-16), 4, 'X'))
        pil.append(q)
    return main + ch + pil + [throw]


def bed(F, w, l=2.1, seed=0):
    """Cama: plataforma de madeira, colchão, edredom e manta por simulação de pano, travesseiros."""
    p = []
    p.append(box('base', -w / 2 + 0.06, -l + 0.12, 0.0, w / 2 - 0.06, -0.06, 0.1, F['ink']))
    p.append(lib.box('plat', -w / 2, -l, 0.1, w / 2, 0, 0.3, F['walnut'], bevel=0.008))
    matt = cushion('matt', -w / 2 + 0.03, -l + 0.03, 0.3, w / 2 - 0.03, -0.04, 0.56, F['bed'], r=0.05, puff=0.008,
                   wrinkle=0.001, seed=seed)
    p.append(matt)
    # travesseiros primeiro (o edredom deita até eles)
    pil = []
    for x in (-w / 4, w / 4):
        q = cushion('tr', x - w / 4 + 0.05, -0.62, 0.56, x + w / 4 - 0.05, -0.1, 0.72, F['bed'], r=0.06, puff=0.04,
                    wrinkle=0.004, seed=seed + int(x * 10))
        pil.append(q)
        q2 = pillow('pl', w / 2 - 0.22, 0.42, 0.16, F['linen'], seed=seed + 5 + int(x * 10))
        q2.data.transform(Matrix.Translation((x, -0.5, 0.6)) @ Matrix.Rotation(math.radians(-16), 4, 'X') @
                          Matrix.Rotation(math.radians(180), 4, 'Z'))
        pil.append(q2)
    duv = drape('duvet', w + 0.6, l - 0.35, (0, -l / 2 - 0.2, 0.62), F['bed'], [matt, p[1]], frames=110,
                res=0.025, stiff=12, bend=0.35, mass=0.5, thickness=0.035)
    throw = drape('throw', w + 0.5, 0.62, (0.05, -l + 0.45, 0.72), F['throw'], [duv, matt, p[1]], frames=90,
                  res=0.02, stiff=6, bend=0.08, mass=0.35, thickness=0.008, rot=3)
    return p + [duv, throw] + pil


def headboard(F, w, h, mat, seed=0):
    """Cabeceira estofada em gomos verticais com costura funda."""
    p = []
    n = max(2, round(w / 0.4))
    cw = w / n
    for i in range(n):
        x0 = -w / 2 + i * cw
        p.append(cushion('hb', x0 + 0.003, 0.0, 0.0, x0 + cw - 0.003, 0.1, h, mat, r=0.045, puff=0.012,
                         wrinkle=0.0015, seed=seed + i, side_bulge=0.9))
    return p


def lounger(F, seed=0):
    """Espreguiçadeira de teca: estrutura com réguas, colchonete com vivo e encosto reclinado."""
    p = []
    wood = F['teak']
    for x in (-0.33, 0.29):
        p.append(lib.box('rail', x, -1.0, 0.18, x + 0.04, 1.0, 0.26, wood, bevel=0.006))
    for (x, y) in [(-0.33, -0.95), (0.29, -0.95), (-0.33, 0.9), (0.29, 0.9)]:
        p.append(lib.box('leg', x, y, 0.0, x + 0.04, y + 0.05, 0.2, wood, bevel=0.005))
    y = -0.98
    while y < 0.95:
        p.append(lib.box('sl', -0.3, y, 0.24, 0.3, y + 0.07, 0.262, wood, bevel=0.004))
        y += 0.085
    p += cushion('cu', -0.31, -0.97, 0.262, 0.31, 0.38, 0.33, F['outdoor'], r=0.03, puff=0.012, sag=0.006,
                 wrinkle=0.002, seed=seed, piping=F['outdoor'])
    bk = cushion('bk', -0.31, 0.38, 0.262, 0.31, 1.02, 0.33, F['outdoor'], r=0.03, puff=0.012, wrinkle=0.002,
                 seed=seed + 1)
    fr = lib.box('bkf', -0.3, 0.38, 0.24, 0.3, 1.0, 0.262, wood, bevel=0.004)
    piv = Vector((0, 0.4, 0.27))
    for o in (bk, fr):
        o.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(math.radians(35), 4, 'X') @ Matrix.Translation(-piv))
    p += [bk, fr]
    return p


def rug(F, w, d, mat, seed=0):
    """Tapete espesso com borda arredondada e leve ondulação."""
    o = cushion('rug', -w / 2, -d / 2, 0.0, w / 2, d / 2, 0.016, mat, r=0.007, puff=0.0, wrinkle=0.0008, seed=seed, sub=0)
    return [o]


def _bend_back(o, radius):
    """Curva a peça em torno de um eixo vertical atrás dela (encosto envolvente)."""
    for v in o.data.vertices:
        a = v.co.x / radius
        r = radius - v.co.y
        v.co.x = math.sin(a) * r
        v.co.y = radius - math.cos(a) * r


def dining_chair(F, seat=None, frame=None, seed=0):
    """Cadeira de jantar contemporânea: estrutura fina de aço preto, assento estofado e encosto envolvente."""
    seat = seat or F['linen']
    frame = frame or F['ink']
    p = []
    r = 0.011
    legs = [(-0.2, -0.2), (0.2, -0.2), (-0.19, 0.19), (0.19, 0.19)]
    for (x, y) in legs:
        top = 0.45
        p.append(tube('leg', [Vector((x * 0.96, y * 0.96, 0.0)), Vector((x, y, top))], r, frame, sides=12))
    p.append(tube('rail', [Vector((-0.2, -0.2, 0.43)), Vector((0.2, -0.2, 0.43)), Vector((0.19, 0.19, 0.43)),
                           Vector((-0.19, 0.19, 0.43))], 0.009, frame, closed=True, sides=10))
    p.append(cushion('seat', -0.235, -0.235, 0.44, 0.235, 0.22, 0.51, seat, r=0.03, puff=0.012, sag=0.004,
                     wrinkle=0.0015, seed=seed, sub=1))
    bk = cushion('back', -0.23, -0.025, 0.0, 0.23, 0.025, 0.34, seat, r=0.022, puff=0.008, wrinkle=0.0012,
                 seed=seed + 1, sub=1)
    _bend_back(bk, 0.38)
    bk.data.transform(Matrix.Translation((0, 0.215, 0.56)) @ Matrix.Rotation(math.radians(-10), 4, 'X'))
    p.append(bk)
    for x in (-0.19, 0.19):
        p.append(tube('post', [Vector((x, 0.19, 0.45)), Vector((x * 0.98, 0.235, 0.78))], 0.009, frame, sides=10))
    return p


def towel(F, w=0.5, l=1.0, mat=None, seed=0):
    """Toalha pendurada numa barra junto à parede (frente -Y, parede em y=0): pano preso na borda superior."""
    mat = mat or F['towel']
    bar = tube('towel_bar', [Vector((-w / 2 - 0.08, -0.06, 1.25)), Vector((w / 2 + 0.08, -0.06, 1.25))], 0.009, F['ink'], sides=12)
    wall = lib.box('tmp_wall', -1, 0.0, 0.0, 1, 0.1, 2.0, None)
    holder = lib.box('tmp_bar', -w / 2 - 0.1, -0.075, 1.235, w / 2 + 0.1, -0.045, 1.265, None)
    # pano horizontal saindo da parede, preso sobre a barra: cai e assenta pendurado
    t = drape('towel', w, l, (0, -0.06 - l / 2, 1.275), mat, [wall, holder], frames=70, res=0.02, stiff=10, bend=0.3,
              mass=0.35, thickness=0.006, pin_edge='y1', ruffle=0.01, seed=seed)
    bpy.data.objects.remove(wall, do_unlink=True)
    bpy.data.objects.remove(holder, do_unlink=True)
    return [bar, t]


def wc_suspended(F):
    """Bacia suspensa com forma orgânica (subdivisão) e placa de acionamento."""
    bowl = cushion('wc', -0.18, -0.55, 0.3, 0.18, 0.0, 0.42, F['ceramic'], r=0.09, puff=0.0, wrinkle=0.0, sub=2)
    for v in bowl.data.vertices:
        # afina para a frente (formato de gota)
        k = max(0.0, min(1.0, -v.co.y / 0.55))
        v.co.x *= 1.0 - 0.28 * k * k
    seat = cushion('wcs', -0.175, -0.54, 0.42, 0.175, -0.02, 0.44, F['ceramic'], r=0.009, puff=0.0, wrinkle=0.0, sub=1)
    for v in seat.data.vertices:
        k = max(0.0, min(1.0, -v.co.y / 0.54))
        v.co.x *= 1.0 - 0.28 * k * k
    plate = lib.box('wcp', -0.12, -0.012, 0.95, 0.12, 0.0, 1.11, F['ink'], bevel=0.003)
    return [bowl, seat, plate]
