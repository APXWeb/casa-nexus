"""Arquitetura da CASA NEXUS: estrutura, paredes, lajes, esquadrias, escada, brises e luminárias."""
import bpy
import bmesh
import math
from mathutils import Vector
import lib
from lib import box, cyl, poly_prism, coll, tag, boolean, join, add_mat
import plan as P

M = {}


def materials():
    mt = lib.material
    M['concrete'] = mt('M_concrete', 'concrete_wall_008', tile=3.0, tint=(0.92, 0.91, 0.89))
    M['white'] = mt('M_white', 'plastered_wall', tile=2.5, tint=(1.0, 0.99, 0.97), rough=0.8)
    M['plaster'] = mt('M_plaster', 'plastered_wall', tile=2.5, tint=(0.96, 0.95, 0.93), rough=0.85)
    M['stone'] = mt('M_stone', 'castle_wall_slates', tile=1.6)
    M['wood_slat'] = mt('M_wood_slat', 'smoked_walnut_veneer', tile=2.0, tint=(0.82, 0.68, 0.52))
    M['wood_soffit'] = mt('M_wood_soffit', 'smoked_walnut_veneer', tile=2.0, tint=(0.82, 0.68, 0.52))
    M['stone_floor'] = mt('M_stone_floor', 'marble_01', tile=2.4, tint=(0.93, 0.92, 0.9))
    M['wood_floor'] = mt('M_wood_floor', 'wood_floor', tile=2.0, tint=(0.95, 0.88, 0.8))
    M['bath_floor'] = mt('M_bath_floor', 'terrazzo_tiles', tile=1.6, tint=(0.9, 0.9, 0.9))
    M['marble_wall'] = mt('M_marble_wall', 'marble_01', tile=2.4)
    M['concrete_floor'] = mt('M_concrete_floor', 'brushed_concrete', tile=3.0)
    M['paving'] = mt('M_paving', 'granite_tile_03', tile=2.4, tint=(0.95, 0.95, 0.95))
    M['deck'] = mt('M_deck', 'wood_floor_deck', tile=2.4, tint=(0.84, 0.8, 0.76))
    M['frame'] = mt('M_frame', color=(0.025, 0.025, 0.027), rough=0.38, metal=0.7)
    M['glass'] = mt('M_glass', color=(0.9, 0.95, 0.96), rough=0.02, transmission=1.0, kind='glass')
    M['door_wood'] = mt('M_door_wood', 'oak_veneer_01', tile=2.0, tint=(0.62, 0.48, 0.36))
    M['door_white'] = mt('M_door_white', color=(0.86, 0.85, 0.83), rough=0.45)
    M['steel'] = mt('M_steel', color=(0.75, 0.75, 0.74), rough=0.22, metal=1.0)
    M['struct'] = mt('M_struct', 'concrete_slab_wall', tile=2.4, tint=(0.85, 0.85, 0.85), kind='struct')
    M['gravel'] = mt('M_gravel', 'clean_pebbles', tile=1.5, tint=(0.85, 0.85, 0.85))
    M['grass_roof'] = mt('M_grass_roof', 'leafy_grass', tile=2.0, tint=(0.75, 0.85, 0.6))
    M['light'] = mt('M_light', color=(1, 0.86, 0.7), emission=(1.0, 0.78, 0.55), emit_strength=8.0,
                    rough=0.4, kind='emissive')
    M['light_cool'] = mt('M_light_pool', color=(0.7, 0.9, 1.0), emission=(0.55, 0.85, 1.0), emit_strength=6.0,
                         kind='emissive')
    M['rail_glass'] = mt('M_rail_glass', color=(0.85, 0.92, 0.92), rough=0.02, transmission=1.0, kind='glass')
    return M


# ------------------------------------------------------------------ helpers de parede
def wall_axis(w):
    (ax, ay), (bx, by) = w['a'], w['b']
    return 'x' if abs(ay - by) < 1e-6 else 'y'


def wall_box(w, z0, z1, extra=0.0, t=None):
    (ax, ay), (bx, by) = w['a'], w['b']
    t = (t or w['t']) / 2
    if wall_axis(w) == 'x':
        return (min(ax, bx) - t - extra, ay - t, z0, max(ax, bx) + t + extra, ay + t, z1)
    return (ax - t, min(ay, by) - t - extra, z0, ax + t, max(ay, by) + t + extra, z1)


def opening_box(w, o, zbase):
    a0, a1, z0, z1, kind = o[:5]
    (ax, ay) = w['a']
    t = w['t'] / 2 + 0.05
    if wall_axis(w) == 'x':
        return (a0, ay - t, zbase + z0, a1, ay + t, zbase + z1)
    return (ax - t, a0, zbase + z0, ax + t, a1, zbase + z1)


def level(f):
    return P.L0 if f == 0 else P.L1


def build_walls(f):
    L = level(f)
    c = coll(f'walls_{f}', 'arch')
    ws = [w for w in P.WALLS if w['f'] == f]
    parts = []
    for w in ws:
        b = wall_box(w, L['floor'], L['ceil'])
        parts.append(box('tmp_' + w['id'], *b, M['plaster'], c))
    base = parts[0]
    boolean(base, parts[1:], op='UNION')
    cutters = []
    for w in ws:
        for o in w.get('open', []):
            cutters.append(box('cut', *opening_box(w, o, L['floor']), None, c))
    boolean(base, cutters, op='DIFFERENCE')
    base.name = f'walls_{f}'
    classify_wall_faces(base, f, ws)
    tag(base, stage='walls', floor=f, lm=1)
    return base


def _in_box(p, b, pad=0.012):
    return b[0] - pad <= p.x <= b[3] + pad and b[1] - pad <= p.y <= b[4] + pad and b[2] - pad <= p.z <= b[5] + pad


def classify_wall_faces(o, f, ws):
    """Material por face: ambiente do lado para onde a face aponta; fachada quando aponta para fora."""
    me = o.data
    me.materials.clear()
    order = ['plaster', 'stone', 'wood_slat', 'marble_wall', 'white', 'concrete']
    idx = {k: add_mat(o, M[k]) for k in order}
    L = level(f)
    boxes = [(w, wall_box(w, L['floor'], L['ceil'])) for w in ws]
    for poly in me.polygons:
        c = poly.center
        n = poly.normal
        own = None
        for w, b in boxes:
            if _in_box(c, b):
                if own is None or w.get('finish'):
                    own = w
        p = c + n * 0.08
        room = P.room_at(p.x, p.y, f)
        fin = own.get('finish') if own else None
        if fin == 'stone':
            k = 'stone'
        elif fin == 'stone_gal' and n.x < -0.5:
            k = 'stone'
        elif fin == 'wood':
            k = 'wood_slat'
        elif room is not None:
            k = room[8] if room[8] in idx else 'plaster'
            # banheiros: revestimento até o teto; demais ambientes: pintura
        else:
            # face externa
            if f == 0:
                k = 'white' if n.y > 0.5 else 'stone'
            else:
                k = 'concrete'
        poly.material_index = idx[k]


# ------------------------------------------------------------------ estrutura (etapas da obra)
def build_structure():
    c = coll('structure', 'arch')
    objs = []
    # radier + baldrames
    rad = box('radier', -12.4, -16.4, -0.32, 12.4, -3.6, -0.02, M['struct'], c)
    g = box('radier_gourmet', -12.4, -3.6, -0.32, -2.6, 1.4, -0.02, M['struct'], c)
    rad = join([rad, g], 'foundation_slab')
    tag(rad, stage='foundation', temp=1)
    beams = []
    for w in P.WALLS:
        if w['f'] != 0:
            continue
        b = wall_box(w, -0.75, -0.32, t=0.3)
        beams.append(box('bald', *b, M['struct'], c))
    bald = join(beams, 'foundation_beams')
    tag(bald, stage='foundation', temp=1)
    # pilares do térreo (embutidos) e do superior
    cols = []
    for (x, y) in P.COLUMNS:
        s = 0.1 if (x, y) in [(-5, -10), (1.2, -11), (12, -11)] else 0.09
        if (x, y) in [(-5, -10)]:
            s = 0.06
        cols.append(box('pil', x - s, y - s, 0, x + s, y + s, 3.2, M['struct'], c))
    for (x, y) in [(-12.5, -17.2), (-2, -17.2), (1.2, -17.2), (8.5, -17.2), (-12.5, -6), (-2, -6), (1.2, -6), (8.5, -6)]:
        cols.append(box('pil', x - 0.09, y - 0.09, 3.5, x + 0.09, y + 0.09, 6.3, M['struct'], c))
    colo = join(cols, 'columns')
    tag(colo, stage='columns', temp=1)
    # vigas na espessura das lajes
    vb = []
    for y in (-16, -10, -4):
        vb.append(box('vg', -12, y - 0.1, 3.2, 12, y + 0.1, 3.5, M['struct'], c))
    for x in (-12, -5, 1.2, 12):
        vb.append(box('vg', x - 0.1, -16, 3.2, x + 0.1, -2, 3.5, M['struct'], c))
    for y in (-17.2, -11.5, -6):
        vb.append(box('vg', -12.5, y - 0.1, 6.3, 8.5, y + 0.1, 6.7, M['struct'], c))
    for x in (-12.5, -2, 1.2, 8.5):
        vb.append(box('vg', x - 0.1, -17.2, 6.3, x + 0.1, -6, 6.7, M['struct'], c))
    vig = join(vb, 'beams')
    tag(vig, stage='beams', temp=1)
    # pilares de aço aparentes da marquise gourmet
    steel = []
    for (x, y) in P.STEEL_COLUMNS:
        steel.append(cyl('aco', x, y, 0, 3.2, 0.075, M['frame'], c, seg=24))
    st = join(steel, 'steel_columns')
    tag(st, stage='columns', lm=1)
    return [rad, bald, colo, vig, st]


def build_slabs():
    c = coll('slabs', 'arch')
    S = P.SLAB1
    parts = [box('s1', r[0], r[1], S['z0'], r[2], r[3], S['z1'], M['white'], c) for r in S['rects']]
    s1 = parts[0]
    boolean(s1, parts[1:], op='UNION')
    boolean(s1, [box('h', h[0], h[1], S['z0'] - 0.1, h[2], h[3], S['z1'] + 0.1, None, c) for h in S['holes']])
    s1.name = 'slab_1'
    _slab_faces(s1, top='concrete', bottom='white', edge='white')
    tag(s1, stage='slabs', floor=1, lm=1)
    R = P.ROOF
    r = P.ROOF_RECTS[0]
    roof = box('roof', r[0], r[1], R['z0'], r[2], r[3], R['z1'], M['white'], c)
    _slab_faces(roof, top='concrete', bottom='wood_soffit', edge='white')
    tag(roof, stage='roof', lm=1)
    grav = box('roof_gravel', r[0] + 0.25, r[1] + 0.25, R['z1'], r[2] - 0.25, r[3] - 0.25, R['z1'] + 0.05,
               M['gravel'], c)
    tag(grav, stage='roof', lm=0)
    # telhado verde sobre a sala (térreo leste)
    gr = box('green_roof', 8.62, -15.95, 3.5, 11.95, -6.12, 3.66, M['grass_roof'], c)
    edge = []
    for b in [(8.62, -16, 3.5, 12, -15.9, 3.72), (8.62, -6.2, 3.5, 12, -6.1, 3.72), (11.9, -16, 3.5, 12, -6.1, 3.72)]:
        edge.append(box('gre', *b, M['concrete'], c))
    ge = join(edge, 'green_roof_edge')
    tag(gr, stage='landscape', lm=0)
    tag(ge, stage='roof', lm=1)
    return [s1, roof, grav, gr, ge]


def _slab_faces(o, top, bottom, edge):
    me = o.data
    me.materials.clear()
    it, ib, ie = add_mat(o, M[top]), add_mat(o, M[bottom]), add_mat(o, M[edge])
    for p in me.polygons:
        p.material_index = it if p.normal.z > 0.9 else ib if p.normal.z < -0.9 else ie


# ------------------------------------------------------------------ pisos e forros
def _inset(r, f):
    """Retângulo do ambiente reduzido pela meia espessura das paredes vizinhas."""
    x0, y0, x1, y1 = r
    return (x0 + 0.075, y0 + 0.075, x1 - 0.075, y1 - 0.075)


def build_floors_ceilings():
    cf = coll('floors', 'arch')
    cc = coll('ceilings', 'arch')
    floors, ceils = [], []
    for r in P.ROOMS:
        rid, name, f, x0, y0, x1, y1, fl, wl, ce = r
        L = level(f)
        a = _inset((x0, y0, x1, y1), f)
        z = L['floor']
        if rid == 'galeria':
            # piso da galeria contorna o vazio da escada
            o = box('fl_' + rid, a[0], a[1], z, a[2], a[3], z + 0.02, M[fl], cf)
            boolean(o, [box('v', P.VOID[0], P.VOID[1], z - 1, P.VOID[2] + 0.2, P.VOID[3], z + 1, None, cf)])
        else:
            o = box('fl_' + rid, a[0], a[1], z, a[2], a[3], z + 0.02, M[fl], cf)
        tag(o, stage='floors', floor=f, room=rid, lm=1)
        floors.append(o)
        if ce == 'wood_ceiling':
            mat = M['plaster']
        else:
            mat = M[ce]
        zc = L['ceil']
        if rid == 'hall':
            cobj = box('ce_' + rid, a[0], a[1], zc - 0.02, a[2], a[3], zc, mat, cc)
            boolean(cobj, [box('v', P.VOID[0], P.VOID[1], zc - 1, P.VOID[2] + 0.2, P.VOID[3], zc + 1, None, cc)])
        else:
            cobj = box('ce_' + rid, a[0], a[1], zc - 0.02, a[2], a[3], zc, mat, cc)
        tag(cobj, stage='floors', floor=f, room=rid, lm=1)
        ceils.append(cobj)
    # soleiras em vãos de portas
    th = []
    for w in P.WALLS:
        L = level(w['f'])
        for o in w.get('open', []):
            if o[4] in ('door', 'pass', 'slide') or (o[4] == 'glass' and not w.get('ext')):
                b = opening_box(w, o, L['floor'])
                th.append(box('sol', b[0] + (0.05 if wall_axis(w) == 'y' else 0), b[1] + (0.05 if wall_axis(w) == 'x' else 0),
                              L['floor'], b[3] - (0.05 if wall_axis(w) == 'y' else 0), b[4] - (0.05 if wall_axis(w) == 'x' else 0),
                              L['floor'] + 0.02, M['stone_floor'], cf))
    tho = join(th, 'thresholds')
    tag(tho, stage='floors', lm=1)
    # piso externo do térreo (terraço, gourmet) e varanda
    out = []
    out.append(box('fl_terraco', -3.0, -3.875, -0.0, 12.5, 2.6, 0.02, M['paving'], cf))
    out.append(box('fl_gourmet', -12.2, -3.875, -0.0, -3.0, 1.4, 0.02, M['paving'], cf))
    tag(out[0], stage='floors', room='deck', lm=1)
    tag(out[1], stage='floors', room='gourmet', lm=1)
    v = box('fl_varanda', -12.0, -5.875, 3.5, 12.0, -2.0, 3.52, M['deck'], cf)
    tag(v, stage='floors', floor=1, room='varanda', lm=1)
    # forro de madeira ripado + perfis de LED na sala de estar
    slats = []
    x = 1.38
    while x < 11.85:
        slats.append(box('rip', x, -10.92, 3.08, x + 0.045, -4.13, 3.18, M['wood_slat'], cc))
        x += 0.09
    rip = join(slats, 'ceiling_slats_estar')
    tag(rip, stage='floors', room='estar', lm=1)
    leds = [box('led', 1.4, y - 0.02, 3.075, 11.8, y + 0.02, 3.08, M['light'], cc) for y in (-9.4, -5.6)]
    led = join(leds, 'led_estar')
    tag(led, stage='lights', room='estar', emissive=1)
    return floors + ceils + [tho, v, rip, led] + out


# ------------------------------------------------------------------ esquadrias
def _frame_rect(name, w, a0, a1, z0, z1, c, mullions=0, sliding=True, open_panel=None):
    """Caixilho preto + vidro para uma abertura. Retorna (caixilhos, vidros)."""
    (ax, ay) = w['a']
    t = w['t']
    pf = 0.05  # perfil
    d = 0.07  # profundidade do perfil
    fr, gl = [], []

    def B(u0, u1, z0_, z1_, dd, off=0.0, mat=M['frame'], lst=fr):
        if wall_axis(w) == 'x':
            lst.append(box(name, u0, ay - dd / 2 + off, z0_, u1, ay + dd / 2 + off, z1_, mat, c))
        else:
            lst.append(box(name, ax - dd / 2 + off, u0, z0_, ax + dd / 2 + off, u1, z1_, mat, c))

    B(a0, a1, z0, z0 + pf, d)
    B(a0, a1, z1 - pf, z1, d)
    B(a0, a0 + pf, z0, z1, d)
    B(a1 - pf, a1, z0, z1, d)
    n = mullions if mullions else max(1, round((a1 - a0) / 2.4))
    step = (a1 - a0) / n
    k = open_panel % n if open_panel is not None else None
    for i in range(1, n):
        u = a0 + i * step
        if k is not None and i == k:
            continue  # o montante acompanha a folha aberta
        B(u - pf / 2 - 0.01, u + pf / 2 + 0.01, z0, z1, d + 0.02)
    for i in range(n):
        u0 = a0 + i * step + (pf / 2 if i else pf)
        u1 = a0 + (i + 1) * step - (pf / 2 if i < n - 1 else pf)
        off = (0.012 if (i % 2 and sliding) else -0.012)
        if k is not None and i == k:
            # folha de correr aberta: desliza sobre a vizinha (trilho externo)
            du = -step if k > 0 else step
            B(u0 + du, u1 + du, z0 + pf, z1 - pf, 0.012, off=0.045, mat=M['glass'], lst=gl)
            for uu in (u0 + du - pf, u1 + du):
                B(uu, uu + pf, z0, z1, 0.03, off=0.045)
            continue
        B(u0, u1, z0 + pf, z1 - pf, 0.012, off=off, mat=M['glass'], lst=gl)
    return fr, gl


def build_openings():
    cfr = coll('frames', 'arch')
    cgl = coll('glass', 'arch')
    cdo = coll('doors', 'arch')
    frames = {0: [], 1: []}
    glass = {0: [], 1: []}
    doors = []
    for w in P.WALLS:
        f = w['f']
        L = level(f)
        zb = L['floor']
        for i, o in enumerate(w.get('open', [])):
            a0, a1, z0, z1, kind = o[:5]
            if kind in ('glass', 'window', 'slide'):
                fr, gl = _frame_rect('fr', w, a0, a1, zb + z0, zb + z1, cfr, sliding=(kind != 'window'),
                                     open_panel=(o[5] if kind == 'slide' else None))
                frames[f] += fr
                glass[f] += gl
                if kind == 'window' and w.get('ext'):
                    # peitoril de pedra
                    (ax, ay) = w['a']
                    if wall_axis(w) == 'x':
                        sgn = -1 if ay <= -15 else 1
                        frames[f].append(box('peit', a0 - 0.03, ay + sgn * 0.16 - 0.03, zb + z0 - 0.03, a1 + 0.03,
                                             ay + sgn * 0.0 + 0.03 * sgn, zb + z0, M['stone_floor'], cfr))
            elif kind == 'entry':
                doors.append(_entry_door(w, a0, a1, zb + z0, zb + z1, cdo))
            elif kind == 'door':
                doors.append(_int_door(w, a0, a1, zb + z0, zb + z1, cdo, i))
            elif kind == 'garage':
                doors.append(_garage_door(w, a0, a1, zb + z0, zb + z1, cdo))
    out = []
    for f in (0, 1):
        fo = join(frames[f], f'frames_{f}')
        tag(fo, stage='frames', floor=f, lm=1)
        go = join(glass[f], f'glass_{f}')
        tag(go, stage='glass', floor=f, lm=0, glass=1)
        out += [fo, go]
    return out + doors


def _entry_door(w, a0, a1, z0, z1, c):
    (ax, ay) = w['a']
    leaf = box('door_entry', a0 + 0.02, ay - 0.035, z0 + 0.01, a1 - 0.02, ay + 0.035, z1 - 0.01, M['door_wood'], c,
               bevel=0.004)
    # puxador vertical de aço
    hx = a1 - 0.22
    h1 = box('pux', hx - 0.015, ay - 0.11, z0 + 0.6, hx + 0.015, ay - 0.08, z0 + 2.2, M['steel'], c, bevel=0.006)
    s1 = box('pux', hx - 0.01, ay - 0.08, z0 + 0.7, hx + 0.01, ay - 0.035, z0 + 0.74, M['steel'], c)
    s2 = box('pux', hx - 0.01, ay - 0.08, z0 + 2.06, hx + 0.01, ay - 0.035, z0 + 2.1, M['steel'], c)
    h2 = box('pux', hx - 0.015, ay + 0.08, z0 + 0.6, hx + 0.015, ay + 0.11, z0 + 2.2, M['steel'], c, bevel=0.006)
    s3 = box('pux', hx - 0.01, ay + 0.035, z0 + 0.7, hx + 0.01, ay + 0.08, z0 + 0.74, M['steel'], c)
    s4 = box('pux', hx - 0.01, ay + 0.035, z0 + 2.06, hx + 0.01, ay + 0.08, z0 + 2.1, M['steel'], c)
    d = join([leaf, h1, s1, s2, h2, s3, s4], 'door_entry')
    # eixo pivotante a 0,35 m do batente esquerdo
    tag(d, stage='doors', lm=1, pivot=[a0 + 0.35, ay, z0], swing=-1)
    return d


def _int_door(w, a0, a1, z0, z1, c, i):
    """Porta interna de giro, deixada aberta (luz e circulação). Folha + batentes."""
    (ax, ay) = w['a']
    t = w['t']
    wid = a1 - a0 - 0.04
    parts = []
    # batentes
    if wall_axis(w) == 'x':
        parts.append(box('bat', a0, ay - t / 2 - 0.01, z0, a0 + 0.02, ay + t / 2 + 0.01, z1, M['door_white'], c))
        parts.append(box('bat', a1 - 0.02, ay - t / 2 - 0.01, z0, a1, ay + t / 2 + 0.01, z1, M['door_white'], c))
        parts.append(box('bat', a0, ay - t / 2 - 0.01, z1 - 0.02, a1, ay + t / 2 + 0.01, z1, M['door_white'], c))
        # folha aberta 90°, encostada ao lado de a0, girando para +y
        leaf = box('folha', a0 + 0.02, ay + t / 2, z0 + 0.005, a0 + 0.06, ay + t / 2 + wid, z1 - 0.025, M['door_white'], c)
    else:
        parts.append(box('bat', ax - t / 2 - 0.01, a0, z0, ax + t / 2 + 0.01, a0 + 0.02, z1, M['door_white'], c))
        parts.append(box('bat', ax - t / 2 - 0.01, a1 - 0.02, z0, ax + t / 2 + 0.01, a1, z1, M['door_white'], c))
        parts.append(box('bat', ax - t / 2 - 0.01, a0, z1 - 0.02, ax + t / 2 + 0.01, a1, z1, M['door_white'], c))
        side = 1 if ax < 0 else -1
        if w['id'] in ('s_gal_leste',):
            side = 1
        if w['id'] in ('s_master_gal',):
            side = -1
        if side > 0:
            leaf = box('folha', ax + t / 2, a0 + 0.02, z0 + 0.005, ax + t / 2 + wid, a0 + 0.06, z1 - 0.025, M['door_white'], c)
        else:
            leaf = box('folha', ax - t / 2 - wid, a0 + 0.02, z0 + 0.005, ax - t / 2, a0 + 0.06, z1 - 0.025, M['door_white'], c)
    d = join(parts + [leaf], f'door_{w["id"]}_{i}')
    tag(d, stage='doors', lm=1)
    return d


def _garage_door(w, a0, a1, z0, z1, c):
    (ax, ay) = w['a']
    sl = []
    z = z0 + 0.01
    while z < z1 - 0.02:
        sl.append(box('gr', a0 + 0.01, ay - 0.02, z, a1 - 0.01, ay + 0.02, min(z + 0.11, z1 - 0.01), M['wood_slat'], c,
                      bevel=0.004))
        z += 0.12
    back = box('grb', a0 + 0.01, ay + 0.02, z0, a1 - 0.01, ay + 0.04, z1, M['frame'], c)
    d = join(sl + [back], 'door_garage')
    tag(d, stage='doors', lm=1)
    return d


# ------------------------------------------------------------------ escada e guarda-corpos
def build_stair():
    c = coll('stair', 'arch')
    S = P.STAIR
    n = S['risers']
    rise = (S['z1'] - S['z0']) / n
    run = (S['y_bottom'] - S['y_top']) / (n - 1)
    treads = []
    for i in range(1, n):
        z = S['z0'] + i * rise
        y1 = S['y_bottom'] - (i - 1) * run
        y0 = y1 - run - 0.03
        treads.append(box('deg', S['x0'], y0, z - 0.06, S['x1'], y1, z, M['wood_floor'], c, bevel=0.004))
    tr = join(treads, 'stair_treads')
    tag(tr, stage='stairs', lm=1)
    # guarda-corpo de vidro inclinado no lado livre + corrimão de madeira
    x = S['x0'] - 0.03
    pts_y = [S['y_bottom'] + 0.05, S['y_top']]
    z_b = [S['z0'] + rise - 0.06, S['z1'] - 0.06]
    bm = bmesh.new()
    gt = 0.006
    vs = []
    for dx in (-gt, gt):
        vs.append([
            bm.verts.new((x + dx, pts_y[0], z_b[0] - 0.02)),
            bm.verts.new((x + dx, pts_y[1], z_b[1] - 0.02)),
            bm.verts.new((x + dx, pts_y[1], z_b[1] + 1.0)),
            bm.verts.new((x + dx, pts_y[0], z_b[0] + 1.0)),
        ])
    a, b = vs
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for k in range(4):
        bm.faces.new([a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    g = lib.mesh_obj('stair_glass', bm, M['rail_glass'], c)
    tag(g, stage='stairs', lm=0, glass=1)
    # corrimão
    bm = bmesh.new()
    hz = 1.0
    w_ = 0.025
    p0 = Vector((x, pts_y[0], z_b[0] + hz))
    p1 = Vector((x, pts_y[1], z_b[1] + hz))
    cs = []
    for (dx, dz) in ((-w_, 0), (w_, 0), (w_, 0.045), (-w_, 0.045)):
        cs.append((bm.verts.new(p0 + Vector((dx, 0, dz))), bm.verts.new(p1 + Vector((dx, 0, dz)))))
    for k in range(4):
        a0, a1 = cs[k]
        b0, b1 = cs[(k + 1) % 4]
        bm.faces.new([a0, b0, b1, a1])
    bm.faces.new([cs[k][0] for k in range(4)][::-1])
    bm.faces.new([cs[k][1] for k in range(4)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    h = lib.mesh_obj('stair_handrail', bm, M['wood_slat'], c)
    tag(h, stage='stairs', lm=1)
    return [tr, g, h]


def _glass_rail(pts, z0, h, c, name):
    """Guarda-corpo de vidro ao longo de uma polilinha (segmentos retos)."""
    parts = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if abs(y0 - y1) < 1e-6:
            parts.append(box(name, min(x0, x1), y0 - 0.006, z0, max(x0, x1), y0 + 0.006, z0 + h, M['rail_glass'], c))
        else:
            parts.append(box(name, x0 - 0.006, min(y0, y1), z0, x0 + 0.006, max(y0, y1), z0 + h, M['rail_glass'], c))
    return parts


def build_rails():
    c = coll('rails', 'arch')
    g = []
    g += _glass_rail([(-0.2, -15.6), (-0.2, -10.6), (1.04, -10.6)], 3.52, 1.05, c, 'rv')
    g += _glass_rail([(-12.0, -6.1), (-12.0, 1.0), (-3.0, 1.0), (-3.0, -2.0), (12.0, -2.0), (12.0, -16.0), (8.6, -16.0)],
                     3.5, 1.1, c, 'rg')
    rail = join(g, 'rails_glass')
    tag(rail, stage='glass', lm=0, glass=1)
    # perfil inferior (baguete) dos guarda-corpos externos
    bs = []
    for (x0, y0, x1, y1) in [(-12.03, -6.1, -11.97, 1.0), (-12.03, 0.97, -3.0, 1.03), (-3.03, -2.0, -2.97, 1.0),
                             (-3.0, -2.03, 12.0, -1.97), (11.97, -16.0, 12.03, -2.0), (8.6, -16.03, 12.0, -15.97)]:
        bs.append(box('bag', x0 - 0.02, y0 - 0.02, 3.5, x1 + 0.02, y1 + 0.02, 3.58, M['frame'], c))
    bo = join(bs, 'rails_base')
    tag(bo, stage='frames', lm=1)
    return [rail, bo]


# ------------------------------------------------------------------ brises de madeira (fachada sul superior)
def build_brise():
    c = coll('brise', 'arch')
    sl = []
    for (x0, x1) in [(-12.35, -7.65), (-7.15, -2.65), (1.55, 8.35)]:
        x = x0
        while x < x1:
            sl.append(box('br', x, -17.62, 3.62, x + 0.045, -17.5, 6.22, M['wood_slat'], c))
            x += 0.105
        # trilhos superior e inferior
        sl.append(box('brt', x0 - 0.03, -17.64, 6.22, x1 + 0.03, -17.38, 6.28, M['frame'], c))
        sl.append(box('brt', x0 - 0.03, -17.64, 3.56, x1 + 0.03, -17.38, 3.62, M['frame'], c))
        # mãos-francesas discretas fixando no concreto
        for xx in (x0 + 0.2, x1 - 0.2):
            for zz in (3.58, 6.24):
                sl.append(box('brm', xx - 0.02, -17.38, zz - 0.02, xx + 0.02, -17.32, zz + 0.02, M['frame'], c))
    b = join(sl, 'brise_sul')
    tag(b, stage='frames', lm=1)
    return [b]


# ------------------------------------------------------------------ luminárias embutidas
LIGHTS = []  # (x, y, z, tipo, potência W, cor) — usados no bake noturno


def build_fixtures():
    c = coll('fixtures', 'arch')
    discs = []

    def spot(x, y, z, power=14, kind='down'):
        discs.append(cyl('spot', x, y, z - 0.004, z, 0.045, M['light'], c, seg=16))
        LIGHTS.append((x, y, z - 0.01, kind, power))

    for r in P.ROOMS:
        rid, _, f, x0, y0, x1, y1 = r[:7]
        if rid == 'estar':
            continue
        L = level(f)
        zc = L['ceil'] - 0.02
        a = _inset((x0, y0, x1, y1), f)
        w, d = a[2] - a[0], a[3] - a[1]
        nx = max(1, round(w / 2.0))
        ny = max(1, round(d / 2.0))
        for i in range(nx):
            for j in range(ny):
                x = a[0] + (i + 0.5) * w / nx
                y = a[1] + (j + 0.5) * d / ny
                if rid == 'hall' and P.VOID[0] - 0.2 < x < P.VOID[2] + 0.2 and P.VOID[1] < y < P.VOID[3]:
                    continue
                if rid == 'galeria' and P.VOID[0] - 0.2 < x < P.VOID[2] + 0.2 and P.VOID[1] < y < P.VOID[3]:
                    continue
                spot(x, y, zc, 10 if f == 1 else 14)
    # marquises: linha de spots sob o balanço (assinatura noturna da fachada)
    for x in [-11.0 + i * 1.6 for i in range(15)]:
        if x < 11.6:
            spot(x, -3.0, 3.2, 12, 'soffit')
    for x in [-11.0 + i * 2.0 for i in range(5)]:
        spot(x, -0.2, 3.2, 12, 'soffit')
    for x in [-11.8 + i * 1.7 for i in range(13)]:
        if x < 8.3:
            spot(x, -16.6, 3.2, 12, 'soffit')
    for x in [-12.0 + i * 1.8 for i in range(12)]:
        if x < 8.4:
            spot(x, -5.55, 6.3, 10, 'soffit')
    d = join(discs, 'fixtures_spots')
    tag(d, stage='lights', emissive=1, lm=0)
    return [d]


def build_all():
    materials()
    objs = []
    objs += build_structure()
    objs.append(build_walls(0))
    objs.append(build_walls(1))
    objs += build_slabs()
    objs += build_floors_ceilings()
    objs += build_openings()
    objs += build_stair()
    objs += build_rails()
    objs += build_brise()
    objs += build_fixtures()
    return objs
