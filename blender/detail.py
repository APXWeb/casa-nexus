"""Detalhamento arquitetônico da CASA NEXUS (camada aplicada sobre arch.py, mesma planta).

O modelo base é feito de volumes retos; aqui entram os detalhes que um archviz profissional tem
e que a luz precisa para "ler" a arquitetura: chanfros reais com normais endurecidas, rodapés,
tabica (junta de sombra) no forro, baguetes nas esquadrias, rufo metálico e pingadeira nas lajes.
Cada peça nova recebe as mesmas tags (stage/floor/room/lm) usadas pela construção, desmontagem e bake.
"""
import bpy
import bmesh
import math
from mathutils import Vector
import lib
from lib import box, coll, tag, join
import plan as P

M = None
D = {}


def mats(Ma):
    global M
    M = Ma
    mt = lib.material
    D['base'] = mt('M_baseboard', color=(0.86, 0.85, 0.83), rough=0.35)
    D['gap'] = mt('M_shadow_gap', color=(0.035, 0.035, 0.037), rough=0.7)
    D['alu'] = mt('M_alu_anod', color=(0.03, 0.03, 0.032), rough=0.32, metal=0.85)
    D['coping'] = mt('M_coping', color=(0.42, 0.42, 0.43), rough=0.4, metal=0.9)


def bevel(o, width, seg=2, angle=40, harden=True):
    """Chanfro real nas arestas vivas (limite por ângulo) + normais endurecidas: as quinas pegam luz."""
    if o is None or o.type != 'MESH':
        return
    # o sombreamento suave precisa vir ANTES: mudar a suavização depois invalida as normais personalizadas
    # (o piso do terraço ficava com normais inclinadas ~70° e escurecia)
    if harden:
        for p in o.data.polygons:
            p.use_smooth = True
    m = o.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = True
    m.harden_normals = harden
    m.miter_outer = 'MITER_ARC'
    lib.apply_mods(o)


def bevel_architecture():
    """Larguras por tipo de elemento (concreto e reboco ~1 cm, esquadria 2 mm, marcenaria 3 mm)."""
    W = {
        'walls_0': 0.008, 'walls_1': 0.008, 'slab_1': 0.012, 'roof': 0.012, 'green_roof_edge': 0.006,
        'columns': 0.008, 'beams': 0.008, 'foundation_slab': 0.01, 'foundation_beams': 0.01,
        'frames_0': 0.0025, 'frames_1': 0.0025, 'rails_base': 0.003, 'brise_sul': 0.004,
        'stair_handrail': 0.006, 'thresholds': 0.003,
    }
    for name, w in W.items():
        o = bpy.data.objects.get(name)
        if o:
            bevel(o, w)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and (o.name.startswith('door_') or o.name.startswith('fl_')):
            bevel(o, 0.003 if o.name.startswith('door_') else 0.002, seg=1 if o.name.startswith('fl_') else 2)


# ------------------------------------------------------------------ rodapés e tabicas
def _walls_on_line(axis, coord, f, tol=0.2):
    """Trechos (a0, a1) cobertos por paredes na linha do ambiente (limites abertos não recebem rodapé)."""
    out = []
    for w in P.WALLS:
        if w['f'] != f:
            continue
        (ax, ay), (bx, by) = w['a'], w['b']
        if axis == 'x' and abs(ay - by) < 1e-6 and abs(ay - coord) < w['t'] / 2 + tol:
            out.append((min(ax, bx), max(ax, bx)))
        if axis == 'y' and abs(ax - bx) < 1e-6 and abs(ax - coord) < w['t'] / 2 + tol:
            out.append((min(ay, by), max(ay, by)))
    return out


def _openings_on_line(axis, coord, f, tol=0.2):
    """Vãos (a0, a1) com peitoril no piso nas paredes que coincidem com a linha do ambiente."""
    out = []
    for w in P.WALLS:
        if w['f'] != f:
            continue
        (ax, ay), (bx, by) = w['a'], w['b']
        if axis == 'x' and abs(ay - by) < 1e-6 and abs(ay - coord) < w['t'] / 2 + tol:
            out += [(o[0], o[1]) for o in w.get('open', []) if o[2] < 0.05]
        if axis == 'y' and abs(ax - bx) < 1e-6 and abs(ax - coord) < w['t'] / 2 + tol:
            out += [(o[0], o[1]) for o in w.get('open', []) if o[2] < 0.05]
    return out


def _segments(a0, a1, holes):
    segs = [(a0, a1)]
    for h0, h1 in sorted(holes):
        nxt = []
        for s0, s1 in segs:
            if h1 <= s0 or h0 >= s1:
                nxt.append((s0, s1))
                continue
            if h0 > s0:
                nxt.append((s0, h0))
            if h1 < s1:
                nxt.append((h1, s1))
        segs = nxt
    return [s for s in segs if s[1] - s[0] > 0.12]


def _room_lines(r):
    """Quatro lados internos do ambiente (eixo, coordenada fixa, início, fim, sentido para dentro)."""
    rid, _, f, x0, y0, x1, y1 = r[:7]
    i = 0.075
    return [('x', y0 + i, x0 + i, x1 - i, +1), ('x', y1 - i, x0 + i, x1 - i, -1),
            ('y', x0 + i, y0 + i, y1 - i, +1), ('y', x1 - i, y0 + i, y1 - i, -1)]


def baseboards_and_gaps():
    c = coll('trim', 'arch')
    out = []
    wet = {'lavabo', 'banho_master', 'banho_2'}
    for r in P.ROOMS:
        rid, f = r[0], r[2]
        L = P.L0 if f == 0 else P.L1
        z = L['floor'] + 0.02
        zc = L['ceil'] - 0.02
        parts, gaps = [], []
        for axis, k, a0, a1, s in _room_lines(r):
            holes = _openings_on_line(axis, k - s * 0.075, f)
            # vazio da escada: sem rodapé na borda do vão
            walls = _walls_on_line(axis, k - s * 0.075, f)
            segs = []
            for w0, w1 in walls:
                lo, hi = max(a0, w0), min(a1, w1)
                if hi > lo:
                    segs += _segments(lo, hi, holes)
            for seg0, seg1 in segs:
                if axis == 'x':
                    if rid not in wet:
                        parts.append(box('rod', seg0, min(k, k + s * 0.012), z, seg1, max(k, k + s * 0.012), z + 0.08, D['base'], c, bevel=0.002, seg=1))
                    gaps.append(box('tab', seg0, min(k, k + s * 0.018), zc - 0.018, seg1, max(k, k + s * 0.018), zc, D['gap'], c))
                else:
                    if rid not in wet:
                        parts.append(box('rod', min(k, k + s * 0.012), seg0, z, max(k, k + s * 0.012), seg1, z + 0.08, D['base'], c, bevel=0.002, seg=1))
                    gaps.append(box('tab', min(k, k + s * 0.018), seg0, zc - 0.018, max(k, k + s * 0.018), seg1, zc, D['gap'], c))
        if parts:
            out.append(tag(join(parts, f'baseboard_{rid}'), stage='floors', floor=f, room=rid, lm=1))
        if gaps and rid not in ('estar',):
            out.append(tag(join(gaps, f'shadowgap_{rid}'), stage='floors', floor=f, room=rid, lm=1))
    return out


# ------------------------------------------------------------------ esquadrias: baguetes e trilhos
def glazing_beads():
    """Para cada placa de vidro (ilha solta de glass_0/1), um quadro de baguete fino nas duas faces."""
    c = coll('frames', 'arch')
    out = []
    for gname in ('glass_0', 'glass_1'):
        g = bpy.data.objects.get(gname)
        if not g:
            continue
        f = 0 if gname.endswith('0') else 1
        bm = bmesh.new()
        bm.from_mesh(g.data)
        bm.verts.ensure_lookup_table()
        seen = set()
        beads = []
        for v in bm.verts:
            if v.index in seen:
                continue
            stack, isl = [v], []
            seen.add(v.index)
            while stack:
                a = stack.pop()
                isl.append(a.co.copy())
                for e in a.link_edges:
                    b = e.other_vert(a)
                    if b.index not in seen:
                        seen.add(b.index)
                        stack.append(b)
            mn = Vector((min(p.x for p in isl), min(p.y for p in isl), min(p.z for p in isl)))
            mx = Vector((max(p.x for p in isl), max(p.y for p in isl), max(p.z for p in isl)))
            dx, dy = mx.x - mn.x, mx.y - mn.y
            if mx.z - mn.z < 0.3:
                continue
            bw, bd = 0.016, 0.018  # largura e saliência da baguete
            if dx < dy:  # placa no plano YZ (parede em Y)
                for sgn in (-1, 1):
                    x0 = mn.x if sgn < 0 else mx.x
                    xa, xb = (x0 - bd, x0) if sgn < 0 else (x0, x0 + bd)
                    beads += [box('bg', xa, mn.y, mn.z, xb, mx.y, mn.z + bw, D['alu'], c),
                              box('bg', xa, mn.y, mx.z - bw, xb, mx.y, mx.z, D['alu'], c),
                              box('bg', xa, mn.y, mn.z, xb, mn.y + bw, mx.z, D['alu'], c),
                              box('bg', xa, mx.y - bw, mn.z, xb, mx.y, mx.z, D['alu'], c)]
            else:
                for sgn in (-1, 1):
                    y0 = mn.y if sgn < 0 else mx.y
                    ya, yb = (y0 - bd, y0) if sgn < 0 else (y0, y0 + bd)
                    beads += [box('bg', mn.x, ya, mn.z, mx.x, yb, mn.z + bw, D['alu'], c),
                              box('bg', mn.x, ya, mx.z - bw, mx.x, yb, mx.z, D['alu'], c),
                              box('bg', mn.x, ya, mn.z, mn.x + bw, yb, mx.z, D['alu'], c),
                              box('bg', mx.x - bw, ya, mn.z, mx.x, yb, mx.z, D['alu'], c)]
        bm.free()
        if beads:
            o = join(beads, f'beads_{f}')
            bevel(o, 0.0015, seg=1, harden=False)
            out.append(tag(o, stage='frames', floor=f, lm=1))
    return out


def floor_tracks():
    """Trilho embutido no piso das portas de correr (perfil de alumínio rente ao piso)."""
    c = coll('frames', 'arch')
    tr = []
    for w in P.WALLS:
        if not w.get('ext'):
            continue
        L = P.L0 if w['f'] == 0 else P.L1
        (ax, ay) = w['a']
        for o in w.get('open', []):
            if o[4] in ('slide', 'glass') and o[2] < 0.05:
                if abs(w['a'][1] - w['b'][1]) < 1e-6:
                    tr.append(box('trk', o[0], ay - 0.06, L['floor'] - 0.004, o[1], ay + 0.06, L['floor'] + 0.024, D['alu'], c, bevel=0.002, seg=1))
                else:
                    tr.append(box('trk', ax - 0.06, o[0], L['floor'] - 0.004, ax + 0.06, o[1], L['floor'] + 0.024, D['alu'], c, bevel=0.002, seg=1))
    return [tag(join(tr, 'floor_tracks'), stage='frames', lm=1)] if tr else []


# ------------------------------------------------------------------ cobertura e lajes
def roof_coping_and_drip():
    c = coll('slabs', 'arch')
    out = []
    R = P.ROOF
    x0, y0, x1, y1 = P.ROOF_RECTS[0]
    z = R['z1']
    t, h, lip = 0.004, 0.05, 0.035
    parts = [
        box('ruf', x0 - lip, y0 - lip, z, x1 + lip, y0 + 0.22, z + t, D['coping'], c),
        box('ruf', x0 - lip, y1 - 0.22, z, x1 + lip, y1 + lip, z + t, D['coping'], c),
        box('ruf', x0 - lip, y0, z, x0 + 0.22, y1, z + t, D['coping'], c),
        box('ruf', x1 - 0.22, y0, z, x1 + lip, y1, z + t, D['coping'], c),
        box('ruf', x0 - lip, y0 - lip, z - h, x0 - lip + t, y1 + lip, z + t, D['coping'], c),
        box('ruf', x1 + lip - t, y0 - lip, z - h, x1 + lip, y1 + lip, z + t, D['coping'], c),
        box('ruf', x0 - lip, y0 - lip, z - h, x1 + lip, y0 - lip + t, z + t, D['coping'], c),
        box('ruf', x0 - lip, y1 + lip - t, z - h, x1 + lip, y1 + lip, z + t, D['coping'], c),
    ]
    out.append(tag(join(parts, 'roof_coping'), stage='roof', lm=1))
    # pingadeira: sulco escuro sob o balanço das lajes, 4 cm para dentro da borda
    S = P.SLAB1
    zb = S['z0']
    drip = []
    g = 0.012
    for (a, b, cc_, dd) in [(-12.5, -17.2, 8.5, -6)]:
        e = 0.04
        drip += [box('pg', a + e, b + e, zb - 0.002, cc_ - e, b + e + g, zb + 0.001, D['gap'], c),
                 box('pg', a + e, b + e, zb - 0.002, a + e + g, dd - e, zb + 0.001, D['gap'], c)]
    for (a, b, cc_, dd) in [(-12, -4.0, 12, -2)]:
        e = 0.04
        drip += [box('pg', a + e, dd - e - g, zb - 0.002, cc_ - e, dd - e, zb + 0.001, D['gap'], c)]
    zr = R['z0']
    drip += [box('pg', x0 + 0.04, y0 + 0.04, zr - 0.002, x1 - 0.04, y0 + 0.04 + g, zr + 0.001, D['gap'], c),
             box('pg', x0 + 0.04, y1 - 0.04 - g, zr - 0.002, x1 - 0.04, y1 - 0.04, zr + 0.001, D['gap'], c)]
    out.append(tag(join(drip, 'drip_edges'), stage='slabs', lm=1))
    return out


def build_all(Ma):
    mats(Ma)
    objs = []
    bevel_architecture()
    objs += baseboards_and_gaps()
    objs += glazing_beads()
    objs += floor_tracks()
    objs += roof_coping_and_drip()
    return objs
