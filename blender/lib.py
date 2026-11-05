"""Utilitários de modelagem para a CASA NEXUS (Blender 5.2, unidades em metros, Z para cima)."""
import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TEX = os.path.join(ROOT, 'assets-src', 'tex')
MODELS = os.path.join(ROOT, 'assets-src', 'models')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'


_colls = {}


def coll(name, parent=None):
    """Coleção por nome (cria se preciso)."""
    if name in _colls:
        return _colls[name]
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    p = _colls.get(parent) if parent else bpy.context.scene.collection
    if c.name not in [x.name for x in p.children]:
        p.children.link(c)
    _colls[name] = c
    return c


# ---------------------------------------------------------------- materiais
MATS = {}


def _img(path, colorspace='sRGB'):
    if not os.path.exists(path):
        return None
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def material(name, tex=None, tile=1.0, color=(0.8, 0.8, 0.8), rough=0.6, metal=0.0, tint=None,
             emission=None, emit_strength=0.0, alpha=1.0, transmission=0.0, normal=1.0, kind='opaque'):
    """Material Principled. `tex` = pasta do Poly Haven (diff/arm/nor). `tile` = metros por repetição.
    `tint` multiplica a cor base (para escurecer/tingir uma textura)."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Base Color'].default_value = (*color, 1)
    m['tile'] = tile
    m['tex'] = tex or ''
    m['kind'] = kind
    m['rough'] = rough
    m['metal'] = metal
    m['color'] = list(color)
    if tint:
        m['tint'] = list(tint)
    if tex:
        d = os.path.join(TEX, tex)
        diff = _img(os.path.join(d, 'diff.jpg'))
        arm = _img(os.path.join(d, 'arm.jpg'), 'Non-Color')
        nor = _img(os.path.join(d, 'nor.jpg'), 'Non-Color')
        if diff:
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = diff
            n.name = 'DIFF'
            if tint:
                mix = nt.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs['Factor'].default_value = 1.0
                nt.links.new(n.outputs['Color'], mix.inputs['A'])
                mix.inputs['B'].default_value = (*tint, 1)
                nt.links.new(mix.outputs['Result'], p.inputs['Base Color'])
            else:
                nt.links.new(n.outputs['Color'], p.inputs['Base Color'])
        if arm:
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = arm
            n.name = 'ARM'
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(n.outputs['Color'], sep.inputs['Color'])
            nt.links.new(sep.outputs['Green'], p.inputs['Roughness'])
            nt.links.new(sep.outputs['Blue'], p.inputs['Metallic'])
        if nor and normal > 0:
            n = nt.nodes.new('ShaderNodeTexImage')
            n.image = nor
            n.name = 'NOR'
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = normal
            nt.links.new(n.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = emit_strength
        m['emission'] = list(emission)
        m['emit'] = emit_strength
    if transmission:
        p.inputs['Transmission Weight'].default_value = transmission
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        m['alpha'] = alpha
    MATS[name] = m
    return m


# ---------------------------------------------------------------- malhas
def _link(obj, c):
    (c or bpy.context.scene.collection).objects.link(obj)
    return obj


def mesh_obj(name, bm, mat=None, c=None, props=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    _link(o, c)
    if mat is not None:
        mats = mat if isinstance(mat, (list, tuple)) else [mat]
        for m in mats:
            me.materials.append(m)
    for k, v in (props or {}).items():
        o[k] = v
    return o


def box(name, x0, y0, z0, x1, y1, z1, mat=None, c=None, bevel=0.0, seg=2, props=None):
    """Caixa alinhada aos eixos entre dois cantos. bevel>0 adiciona chanfro (aplicado)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    if bevel > 0:
        b = min(bevel, sx / 2.01, sy / 2.01, sz / 2.01)
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=seg, affect='EDGES', profile=0.5,
                        clamp_overlap=True)
    return mesh_obj(name, bm, mat, c, props)


def cyl(name, x, y, z0, z1, r, mat=None, c=None, seg=32, props=None, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r2 if r2 is not None else r,
                          depth=z1 - z0)
    bmesh.ops.translate(bm, vec=(x, y, (z0 + z1) / 2), verts=bm.verts)
    return mesh_obj(name, bm, mat, c, props)


def poly_prism(name, pts, z0, z1, mat=None, c=None, props=None):
    """Prisma a partir de um polígono 2D (sentido anti-horário)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in pts]
    f = bm.faces.new(vs)
    bmesh.ops.reverse_faces(bm, faces=[f])
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, mat, c, props)


def rounded(name, x0, y0, z0, x1, y1, z1, r, mat=None, c=None, seg=4, props=None):
    """Caixa arredondada (estofados, almofadas): chanfro com vários segmentos."""
    return box(name, x0, y0, z0, x1, y1, z1, mat, c, bevel=r, seg=seg, props=props)


def subdiv(o, levels=2):
    m = o.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    apply_mods(o)
    return o


def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        try:
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:  # noqa
            print('modifier falhou', o.name, m.name, e)
            o.modifiers.remove(m)


def boolean(target, cutters, op='DIFFERENCE', solver='MANIFOLD', delete=True):
    """Aplica booleana com uma lista de objetos (via coleção temporária)."""
    if not cutters:
        return target
    tmp = bpy.data.collections.new('__bool_tmp')
    bpy.context.scene.collection.children.link(tmp)
    for c in cutters:
        for uc in list(c.users_collection):
            uc.objects.unlink(c)
        tmp.objects.link(c)
    m = target.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.operand_type = 'COLLECTION'
    m.collection = tmp
    try:
        m.solver = solver
    except Exception:
        m.solver = 'EXACT'
    apply_mods(target)
    for c in list(tmp.objects):
        if delete:
            bpy.data.objects.remove(c, do_unlink=True)
    bpy.data.collections.remove(tmp)
    return target


def join(objs, name=None):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    if len(objs) == 1:
        if name:
            objs[0].name = name
        return objs[0]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
        bpy.ops.object.join()
    if name:
        objs[0].name = name
        objs[0].data.name = name
    return objs[0]


def move_to(o, c):
    for uc in list(o.users_collection):
        uc.objects.unlink(o)
    c.objects.link(o)


def set_mat(o, mat):
    o.data.materials.clear()
    o.data.materials.append(mat)


def add_mat(o, mat):
    """Garante o material no objeto e devolve o índice do slot."""
    for i, m in enumerate(o.data.materials):
        if m == mat:
            return i
    o.data.materials.append(mat)
    return len(o.data.materials) - 1


def apply_transform(o):
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)


def world_uv(o, name='UVMap', default_tile=1.0, offset=(0.0, 0.0)):
    """UV em escala real por projeção cúbica: cada face usa o eixo dominante da normal.
    Repetição por material (propriedade 'tile', em metros)."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.get(name) or bm.loops.layers.uv.new(name)
    mw = o.matrix_world
    nmat = mw.to_3x3().inverted().transposed()
    tiles = []
    for m in me.materials:
        tiles.append(float(m.get('tile', default_tile)) if m else default_tile)
    for f in bm.faces:
        n = (nmat @ f.normal).normalized()
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        t = tiles[f.material_index] if f.material_index < len(tiles) else default_tile
        t = t or 1.0
        for l in f.loops:
            p = mw @ l.vert.co
            if az >= ax and az >= ay:
                u, v = p.x, p.y * (1 if n.z >= 0 else -1)
            elif ax >= ay:
                u, v = p.y * (1 if n.x >= 0 else -1), p.z
            else:
                u, v = -p.x * (1 if n.y >= 0 else -1), p.z
            l[uv].uv = ((u + offset[0]) / t, (v + offset[1]) / t)
    bm.to_mesh(me)
    bm.free()


def tag(o, **kw):
    for k, v in kw.items():
        o[k] = v
    return o


def shade_auto(o, angle=35):
    """Normais: suaviza superfícies curvas e mantém arestas vivas."""
    try:
        with bpy.context.temp_override(object=o, active_object=o, selected_editable_objects=[o],
                                       selected_objects=[o]):
            bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
        apply_mods(o)
    except Exception as e:  # noqa
        print('auto smooth falhou', o.name, e)


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]
