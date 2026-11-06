"""Renderizações de conferência (Cycles GPU) a partir de câmeras fixas."""
import bpy
import math
import os
from mathutils import Vector
import lib

VIEWS = {
    'aerea': ((34, -48, 30), (0, -6, 2), 32),
    'frente': ((10, -40, 2.2), (-1, -12, 3.2), 30),
    'fundos': ((-6, 24, 3.0), (2, -6, 3.0), 28),
    'piscina': ((13.5, 12.5, 1.7), (-2, -6, 2.4), 22),
    'hall': ((-2.6, -15.2, 1.6), (0.6, -10.0, 1.9), 16),
    'estar': ((11.2, -10.4, 1.55), (-2, -5.5, 1.4), 15),
    'cozinha': ((-1.0, -5.0, 1.6), (-10, -9, 1.0), 16),
    'master': ((-2.8, -6.6, 5.1), (-10.5, -11.0, 4.4), 15),
    'galeria': ((-1.2, -16.6, 5.1), (0.6, -8, 3.0), 15),
}


def setup_world(hdri='kloofendal_48d_partly_cloudy_puresky_2k.hdr', strength=1.0, sun=True):
    sc = bpy.context.scene
    w = bpy.data.worlds.get('W') or bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(lib.ROOT, 'assets-src', 'hdri', hdri), check_existing=True)
    mp = nt.nodes.new('ShaderNodeMapping')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    mp.inputs['Rotation'].default_value[2] = math.radians(150)
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    if sun and not bpy.data.objects.get('SUN'):
        ld = bpy.data.lights.new('SUN', 'SUN')
        ld.energy = 4.0
        ld.angle = math.radians(0.8)
        o = bpy.data.objects.new('SUN', ld)
        bpy.context.scene.collection.objects.link(o)
        # sol ao norte, ~45° de altura, vindo do noroeste
        o.rotation_euler = (math.radians(42), 0, math.radians(200))


def gpu(sc):
    sc.render.engine = 'CYCLES'
    pr = bpy.context.preferences.addons['cycles'].preferences
    pr.compute_device_type = 'OPTIX'
    pr.get_devices()
    for d in pr.devices:
        d.use = d.type == 'OPTIX'
    sc.cycles.device = 'GPU'


def render_views(out_dir, which='all', samples=48):
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    gpu(sc)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 720
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    mood = os.environ.get('PV_MOOD', 'day')
    if mood in ('day', 'sunset'):
        import bake  # mesma luz do site: HDRI girado + sol do clima (bake.day_world)
        bake.day_world(mood)
    else:
        setup_world()
    for o in bpy.data.objects:
        if o.get('temp'):
            o.hide_render = True
    glass_light_paths()
    cam_d = bpy.data.cameras.new('C')
    cam = bpy.data.objects.new('C', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    names = VIEWS.keys() if which == 'all' else which.split(',')
    for n in names:
        pos, tgt, lens = VIEWS[n]
        cam.location = pos
        d = Vector(tgt) - Vector(pos)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        cam_d.lens = lens
        sc.view_settings.exposure = float(os.environ.get('PV_EXT', '-0.3')) if n in ('aerea', 'frente', 'fundos', 'piscina', 'jardim', 'perspectiva') else float(os.environ.get('PV_INT', '0.9'))
        sc.render.filepath = os.path.join(out_dir, f'{n}.jpg')
        sc.render.image_settings.file_format = 'JPEG'
        bpy.ops.render.render(write_still=True)
        print('render', n)


# ------------------------------------------------------------------ vegetação e gramado nas renderizações de conferência
def add_vegetation(grass=False):
    """Instancia no Blender a mesma vegetação do site (vegetation.json, modelos Poly Haven) para que as
    renderizações de conferência mostrem o lote como o visitante o vê. grass=True semeia lâminas de grama
    reais só onde um raio vertical acerta o gramado (nunca sob pisos, deck ou dentro da casa)."""
    import json
    import random
    from mathutils import Matrix
    sc = bpy.context.scene
    if grass:
        _grass()
    with open(os.path.join(lib.ROOT, 'blender', 'vegetation.json'), encoding='utf8') as fh:
        items = json.load(fh)
    src = bpy.data.collections.new('veg_src')
    sc.collection.children.link(src)
    lay = bpy.context.view_layer.layer_collection.children[src.name]
    lay.exclude = True
    protos = {}
    for it in items:
        k = it['kind']
        if k not in protos:
            d = os.path.join(lib.MODELS, k)
            if not os.path.isdir(d):
                print('veg sem modelo', k)
                protos[k] = None
                continue
            g = [f for f in os.listdir(d) if f.endswith('.gltf')][0]
            objs = lib.import_gltf(os.path.join(d, g))
            c = bpy.data.collections.new('veg_' + k)
            src.children.link(c)
            for o in objs:
                for uc in list(o.users_collection):
                    uc.objects.unlink(o)
                c.objects.link(o)
            protos[k] = c
        c = protos[k]
        if c is None:
            continue
        e = bpy.data.objects.new('veg', None)
        e.instance_type = 'COLLECTION'
        e.instance_collection = c
        e.matrix_world = Matrix.Translation((it['x'], it['y'], -0.03)) @ Matrix.Rotation(math.radians(it.get('r', 0)), 4, 'Z') @ Matrix.Scale(it.get('s', 1), 4)
        e['pv'] = 1
        sc.collection.objects.link(e)
    print('vegetação instanciada:', len(items))


def _grass():
    import bmesh
    import random
    from mathutils import Vector
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    L = __import__('plan').LOT
    step = 0.25
    bm = bmesh.new()
    nx, ny = int((L['x1'] - L['x0']) / step), int((L['y1'] - L['y0']) / step)
    kept = 0
    for i in range(nx):
        for j in range(ny):
            x, y = L['x0'] + (i + 0.5) * step, L['y0'] + (j + 0.5) * step
            hit, loc, nrm, idx, ob, mw = sc.ray_cast(dg, Vector((x, y, 20)), Vector((0, 0, -1)))
            if hit and ob.name.startswith('lawn') and loc.z < 0.0:
                z = loc.z
                h = step / 2
                vs = [bm.verts.new((x - h, y - h, z)), bm.verts.new((x + h, y - h, z)), bm.verts.new((x + h, y + h, z)), bm.verts.new((x - h, y + h, z))]
                bm.faces.new(vs)
                kept += 1
    em = lib.mesh_obj('grass_emitter', bm, None)
    em['pv'] = 1
    # touceira de lâminas curvas (6–11 cm, gramado aparado)
    rnd = random.Random(3)
    bb = bmesh.new()
    for k in range(9):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0, 0.02)
        bx, by = r * math.cos(a), r * math.sin(a)
        hgt = rnd.uniform(0.06, 0.11)
        lean = rnd.uniform(0.15, 0.5)
        dirx, diry = math.cos(a + 1.3), math.sin(a + 1.3)
        w = rnd.uniform(0.0025, 0.004)
        prev = None
        for s in range(4):
            t = s / 3
            cx = bx + dirx * lean * hgt * t * t
            cy = by + diry * lean * hgt * t * t
            cz = hgt * t
            ww = w * (1 - t * 0.9)
            pa = bb.verts.new((cx - diry * ww, cy + dirx * ww, cz))
            pb = bb.verts.new((cx + diry * ww, cy - dirx * ww, cz))
            if prev:
                bb.faces.new([prev[0], prev[1], pb, pa])
            prev = (pa, pb)
    gm = bpy.data.materials.new('M_grass_blade')
    gm.use_nodes = True
    nt = gm.node_tree
    pr = nt.nodes['Principled BSDF']
    oi = nt.nodes.new('ShaderNodeObjectInfo')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.06, 0.13, 0.025, 1)
    ramp.color_ramp.elements[1].color = (0.17, 0.26, 0.05, 1)
    nt.links.new(oi.outputs['Random'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], pr.inputs['Base Color'])
    pr.inputs['Roughness'].default_value = 0.55
    pr.inputs['Subsurface Weight'].default_value = 0.0
    pr.inputs['Transmission Weight'].default_value = 0.0
    blade = lib.mesh_obj('grass_blade', bb, gm)
    for p in blade.data.polygons:
        p.use_smooth = True
    blade.hide_render = True
    blade['pv'] = 1
    ps_mod = em.modifiers.new('grass', 'PARTICLE_SYSTEM')
    ps = ps_mod.particle_system.settings
    ps.type = 'HAIR'
    ps.use_advanced_hair = True
    ps.count = int(kept * step * step * 900)
    ps.hair_length = 1.0
    ps.render_type = 'OBJECT'
    ps.instance_object = blade
    ps.particle_size = 1.0
    ps.size_random = 0.45
    ps.use_rotations = True
    ps.rotation_mode = 'NOR'
    ps.phase_factor_random = 2.0
    ps.use_emit_random = True
    ps.distribution = 'RAND'
    em.show_instancer_for_render = False
    print('gramado:', kept, 'células,', ps.count, 'touceiras')

VIEWS.update({
    'suite': ((-4.2, -7.2, 5.0), (-8.6, -11.0, 4.1), 18),
    'jardim': ((14.5, 16.5, 2.4), (-1.0, -4.0, 2.6), 20),
    'perspectiva': ((21, -2, 7.5), (-2, -9.5, 2.6), 22),
})


def glass_light_paths():
    """Vidros, cortinas e água deixam passar raios de sombra e difusos (o sol entra nos ambientes, como no bake);
    para a câmera e reflexos continuam com o Principled (reflexo e transmissão visíveis)."""
    for m in bpy.data.materials:
        if m.get('kind') not in ('glass', 'curtain') or not m.use_nodes or m.node_tree.nodes.get('LP_MIX'):
            continue
        nt = m.node_tree
        out = nt.nodes.get('Material Output')
        pr = nt.nodes.get('Principled BSDF')
        lp = nt.nodes.new('ShaderNodeLightPath')
        mx = nt.nodes.new('ShaderNodeMath')
        mx.operation = 'MAXIMUM'
        nt.links.new(lp.outputs['Is Shadow Ray'], mx.inputs[0])
        nt.links.new(lp.outputs['Is Diffuse Ray'], mx.inputs[1])
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        tr.inputs['Color'].default_value = (0.9, 0.9, 0.9, 1) if m.get('kind') == 'glass' else (0.7, 0.68, 0.65, 1)
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.name = 'LP_MIX'
        nt.links.new(mx.outputs[0], mix.inputs['Fac'])
        nt.links.new(pr.outputs['BSDF'], mix.inputs[1])
        nt.links.new(tr.outputs['BSDF'], mix.inputs[2])
        nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
