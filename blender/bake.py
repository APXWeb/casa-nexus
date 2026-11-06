"""Lightmaps da CASA NEXUS (Cycles/OptiX) e exportação GLB.

Cada atlas recebe dois bakes de irradiância difusa (sem a cor do material):
  - CÉU: mundo branco uniforme, sem lâmpadas → visibilidade do céu com rebatimentos (0..~1)
  - NOITE: mundo preto, luminárias acesas → iluminação artificial (RGB, HDR)
Codificação final (PNG RGBA 8 bits): RGB = sqrt(noite / NIGHT_MAX), A = sqrt(céu / SKY_MAX).

GI diurna (LM_PASSES inclui day/sunset): um atlas RGB por clima com a luz INDIRETA do sol e do céu reais
(mesmo HDRI, mesma direção e intensidade do sol do site). É o rebatimento que faltava: luz do sol entrando
pelos vãos e voltando do piso, sangramento de cor da madeira e do gramado. O sol direto continua dinâmico
(sombra em tempo real), e o céu direto continua no canal A. Codificação RGBM 8 bits: RGB·M·DAY_MAX.
"""
import bpy
import bmesh
import os
import json
import math
import time
import numpy as np
import lib
import plan as P

NIGHT_MAX = 6.0
SKY_MAX = 1.25
DAY_MAX = 8.0
# climas do site (src/engine/world.js MOODS + tools/skies.json): direção do sol (azimute a partir do norte,
# elevação), cor, intensidade do sol e do ambiente
MOODS = {
    'day': dict(hdri='kloofendal_48d_partly_cloudy_puresky_2k.hdr', az=306, el=40, color=(1.0, 0.96, 0.9), sun=5.2, env=1.0),
    'sunset': dict(hdri='belfast_sunset_puresky_2k.hdr', az=290, el=9, color=(1.0, 0.6, 0.32), sun=4.2, env=1.15),
}
OUT = os.path.join(lib.ROOT, 'assets-src', 'bake')
PUB = os.path.join(lib.ROOT, 'public', 'assets')


def area(o):
    return sum(p.area for p in o.data.polygons)


def cleanup_hidden_faces(objs):
    """Remove faces nunca vistas (fundo de pisos, topo de forros, topo/base de paredes, fundo do gramado)."""
    for o in objs:
        nm = o.name
        if not (nm.startswith('fl_') or nm.startswith('ce_') or nm in ('thresholds', 'lawn') or nm.startswith('walls_')):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        kill = []
        for f in bm.faces:
            z = f.calc_center_median().z
            if nm.startswith('ce_') and f.normal.z > 0.9:
                kill.append(f)
            elif (nm.startswith('fl_') or nm == 'thresholds') and f.normal.z < -0.9:
                kill.append(f)
            elif nm == 'lawn' and f.normal.z < 0.9:
                kill.append(f)
            elif nm.startswith('walls_') and abs(f.normal.z) > 0.9 and any(abs(z - v) < 0.01 for v in (0.0, 3.2, 3.5, 6.3)):
                kill.append(f)
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(o.data)
        bm.free()


def _uv_area(me, layer):
    uv = me.uv_layers[layer].data
    tot = 0.0
    for p in me.polygons:
        pts = [uv[i].uv for i in p.loop_indices]
        a = 0.0
        for k in range(len(pts)):
            x0, y0 = pts[k]
            x1, y1 = pts[(k + 1) % len(pts)]
            a += x0 * y1 - x1 * y0
        tot += abs(a) / 2
    return tot


def lightmap_uvs(objs, atlas_px, density):
    """UV 'LM' por objeto (projeção inteligente) e empacotamento conjunto num atlas.
    density = texels por metro desejado (só para relatório; o pack usa a escala relativa por área)."""
    for o in objs:
        me = o.data
        if 'LM' not in me.uv_layers:
            me.uv_layers.new(name='LM')
        me.uv_layers['LM'].active = True
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # mesma densidade de texels para todos: escala o UV de cada objeto pela razão área 3D / área UV
    for o in objs:
        me = o.data
        a3 = area(o)
        au = _uv_area(me, 'LM')
        if au > 1e-9 and a3 > 1e-9:
            k = math.sqrt(a3 / au)
            for d in me.uv_layers['LM'].data:
                d.uv = (d.uv[0] * k, d.uv[1] * k)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    margin = 5.0 / 2048  # mesma fração em qualquer resolução: o atlas reduzido (2k/1k) não sangra
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='CARDINAL', scale=True,
                            merge_overlap=False, margin_method='FRACTION', margin=margin, pin=False,
                            shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    # UVMap (textura) continua sendo a ativa para renderização; LM é a segunda camada
    for o in objs:
        o.data.uv_layers[0].active = True
        o.data.uv_layers[0].active_render = True


def bake_materials(objs, img, kind):
    """Cópias de materiais por atlas, com o nó de imagem ativo e sem mapa normal."""
    made = {}
    for o in objs:
        for i, slot in enumerate(o.material_slots):
            m = slot.material
            if m is None:
                continue
            key = (m.name, img.name)
            if key not in made:
                bm_ = m.copy()
                bm_.name = f'{m.name}__{img.name}'
                nt = bm_.node_tree
                for n in list(nt.nodes):
                    if n.type == 'NORMAL_MAP':
                        nt.nodes.remove(n)
                tex = nt.nodes.new('ShaderNodeTexImage')
                tex.image = img
                uvn = nt.nodes.new('ShaderNodeUVMap')
                uvn.uv_map = 'LM'
                nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
                tex.select = True
                nt.nodes.active = tex
                bm_['orig'] = m.name
                made[key] = bm_
            slot.material = made[key]
    return made


def restore_materials(objs):
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if m and m.get('orig'):
                slot.material = bpy.data.materials[m['orig']]


def set_emission(on):
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        p = m.node_tree.nodes.get('Principled BSDF')
        if p is None or 'emit' not in m.keys() and not m.get('orig'):
            continue
        base = bpy.data.materials.get(m.get('orig')) if m.get('orig') else m
        e = float(base.get('emit', 0)) if base else 0
        if e:
            p.inputs['Emission Strength'].default_value = e if on else 0.0


def bake_glass_transparent(on):
    """No bake, vidros e cortinas deixam a luz passar (BSDF transparente)."""
    for m in bpy.data.materials:
        if m.get('kind') in ('glass', 'curtain', 'water') and m.use_nodes:
            nt = m.node_tree
            out = nt.nodes.get('Material Output')
            if on:
                t = nt.nodes.get('BAKE_T') or nt.nodes.new('ShaderNodeBsdfTransparent')
                t.name = 'BAKE_T'
                t.inputs['Color'].default_value = (0.92, 0.92, 0.92, 1) if m.get('kind') != 'curtain' else (0.75, 0.73, 0.7, 1)
                nt.links.new(t.outputs['BSDF'], out.inputs['Surface'])
            else:
                p = nt.nodes.get('Principled BSDF')
                nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])


def world(strength, color=(1, 1, 1)):
    w = bpy.data.worlds.get('BAKE') or bpy.data.worlds.new('BAKE')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w


def sun_dir_blender(az, el):
    """Direção PARA o sol em coordenadas do Blender. No site: norte = -Z(three) = +Y(Blender)."""
    a, e = math.radians(az), math.radians(el)
    tx, ty, tz = math.sin(a) * math.cos(e), math.sin(e), -math.cos(a) * math.cos(e)  # three (Y para cima)
    return (tx, -tz, ty)


def day_world(mood):
    """Mundo com o HDRI do clima, girado como no site (o ponto mais brilhante do HDR vai para o azimute do sol),
    e um sol com a mesma direção, cor e intensidade do DirectionalLight do site."""
    m = MOODS[mood]
    w = bpy.data.worlds.get('BAKE_' + mood) or bpy.data.worlds.new('BAKE_' + mood)
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    img = bpy.data.images.load(os.path.join(lib.ROOT, 'assets-src', 'hdri', m['hdri']), check_existing=True)
    env.image = img
    # ponto mais brilhante do HDR (coluna u) → mesma rotação que world.js aplica com shiftEquirect
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    lum = px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722
    yy, xx = np.unravel_index(np.argmax(lum), lum.shape)
    u_hdr = (xx + 0.5) / W
    # Cycles (direction_to_equirectangular): u = 0.5 - atan2(dir.y, dir.x)/(2π)
    d = sun_dir_blender(m['az'], m['el'])
    u_want = 0.5 - math.atan2(d[1], d[0]) / (2 * math.pi)
    mp = nt.nodes.new('ShaderNodeMapping')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    mp.inputs['Rotation'].default_value[2] = (u_want - u_hdr) * 2 * math.pi
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = m['env']
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    bpy.context.scene.world = w
    sun = bpy.data.objects.get('BAKE_SUN')
    if sun is None:
        ld = bpy.data.lights.new('BAKE_SUN', 'SUN')
        sun = bpy.data.objects.new('BAKE_SUN', ld)
        bpy.context.scene.collection.objects.link(sun)
    sun.data.energy = m['sun']
    sun.data.color = m['color']
    sun.data.angle = math.radians(0.6)
    from mathutils import Vector
    sun.rotation_euler = Vector(d).to_track_quat('Z', 'Y').to_euler()  # o sol ilumina ao longo de -Z local
    sun.hide_render = False
    return sun


def make_lights(arch):
    c = lib.coll('bake_lights')
    made = []
    for (x, y, z, kind, power) in arch.LIGHTS:
        if kind in ('down', 'soffit'):
            ld = bpy.data.lights.new('L', 'SPOT')
            ld.spot_size = math.radians(95 if kind == 'down' else 110)
            ld.spot_blend = 0.6
            ld.shadow_soft_size = 0.04
            ld.energy = power * 2.4
            ld.color = (1.0, 0.83, 0.64)
            rot = (0, 0, 0)
        elif kind == 'pool':
            ld = bpy.data.lights.new('L', 'POINT')
            ld.energy = power * 3
            ld.color = (0.6, 0.88, 1.0)
            ld.shadow_soft_size = 0.2
            rot = (0, 0, 0)
        elif kind == 'fire':
            ld = bpy.data.lights.new('L', 'POINT')
            ld.energy = power * 4
            ld.color = (1.0, 0.55, 0.25)
            ld.shadow_soft_size = 0.3
            rot = (0, 0, 0)
        else:  # bollard / uplight
            ld = bpy.data.lights.new('L', 'POINT')
            ld.energy = power * 3
            ld.color = (1.0, 0.8, 0.6)
            ld.shadow_soft_size = 0.05
            rot = (0, 0, 0)
        o = bpy.data.objects.new('L', ld)
        o.location = (x, y, z)
        o.rotation_euler = rot
        c.objects.link(o)
        made.append(o)
    # luz dos pendentes e fitas: as malhas emissivas já iluminam; reforço com pontuais nos pendentes
    for ob in bpy.data.objects:
        if ob.name.startswith('pend_') and ob.type == 'MESH':
            bb = [ob.matrix_world @ v.co for v in ob.data.vertices]
            zmin = min(v.z for v in bb)
            cx = sum(v.x for v in bb) / len(bb)
            cy = sum(v.y for v in bb) / len(bb)
            ld = bpy.data.lights.new('LP', 'POINT')
            ld.energy = 25
            ld.color = (1.0, 0.8, 0.6)
            ld.shadow_soft_size = 0.08
            o = bpy.data.objects.new('LP', ld)
            o.location = (cx, cy, zmin - 0.03)
            c.objects.link(o)
            made.append(o)
    return made


def do_bake(objs, img, samples, margin_px=12, passes=('DIRECT', 'INDIRECT')):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.margin = margin_px
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_pass_direct = 'DIRECT' in passes
    sc.render.bake.use_pass_indirect = 'INDIRECT' in passes
    sc.render.bake.use_pass_color = False
    sc.cycles.bake_type = 'DIFFUSE'
    # o Cycles grava no mapa UV ativo: durante o bake, o ativo precisa ser o LM
    for o in objs:
        o.data.uv_layers['LM'].active = True
        o.data.uv_layers['LM'].active_render = True
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    t = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=set(passes), margin=margin_px,
                        use_clear=True)
    print(f'  bake {img.name}: {time.time() - t:.1f}s', flush=True)
    for o in objs:
        o.data.uv_layers[0].active = True
        o.data.uv_layers[0].active_render = True


def denoise_exr(src, dst, size):
    """Denoise OIDN (nó Denoise do compositor) numa cena vazia, gravando EXR linear."""
    sc = bpy.data.scenes.get('DN') or bpy.data.scenes.new('DN')
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    ng = bpy.data.node_groups.get('DNG') or bpy.data.node_groups.new('DNG', 'CompositorNodeTree')
    ng.nodes.clear()
    if not ng.interface.items_tree:
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    im = bpy.data.images.load(src, check_existing=False)
    im.colorspace_settings.name = 'Non-Color'
    ni = ng.nodes.new('CompositorNodeImage')
    ni.image = im
    dn = ng.nodes.new('CompositorNodeDenoise')
    try:
        dn.inputs['HDR'].default_value = True
    except Exception:
        pass
    go = ng.nodes.new('NodeGroupOutput')
    ng.links.new(ni.outputs['Image'], dn.inputs['Image'])
    ng.links.new(dn.outputs['Image'], go.inputs[0])
    sc.compositing_node_group = ng
    sc.render.use_compositing = True
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    sc.render.filepath = dst
    bpy.ops.render.render(write_still=True, scene='DN')
    bpy.data.images.remove(im)
    out = bpy.data.images.load(dst, check_existing=False)
    out.colorspace_settings.name = 'Non-Color'
    a = np.array(out.pixels[:], dtype=np.float32).reshape(size, size, 4)
    bpy.data.images.remove(out)
    return a


def denoise_img(img):
    """Denoise do Cycles no bake não é aplicado a lightmaps; suavização leve com numpy (box blur 3x3 ponderado)."""
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    return a


def run(arch, atlas_spec='auto'):
    import preview
    sc = bpy.context.scene
    preview.gpu(sc)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PUB, exist_ok=True)
    for o in bpy.data.objects:
        if o.get('temp'):
            o.hide_render = True
    objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.get('lm') and not o.hide_render
            and o.visible_get()]
    cleanup_hidden_faces(objs)
    house = [o for o in objs if int(o.get('lm')) == 1]
    site = [o for o in objs if int(o.get('lm')) == 2]
    A_house = sum(area(o) for o in house)
    A_site = sum(area(o) for o in site)
    print(f'área casa {A_house:.0f} m², terreno {A_site:.0f} m²')
    # casa: atlas de 4096 divididos por área (densidade alvo ~22 texels/m de lado em 4096 com 3 atlas)
    n_house = int(os.environ.get('LM_HOUSE', '3'))
    px = int(os.environ.get('LM_PX', '2048'))
    samples = int(os.environ.get('LM_SAMPLES', '512'))
    sc.render.use_persistent_data = True
    groups = [[] for _ in range(n_house)]
    acc = [0.0] * n_house
    # agrupa por pavimento/ambiente para coerência espacial: ordena por (andar, nome)
    for o in sorted(house, key=lambda o: (-area(o))):
        k = acc.index(min(acc))
        groups[k].append(o)
        acc[k] += area(o)
    atlases = [(f'lm{i}', g, px) for i, g in enumerate(groups)] + [('lm_site', site, px)]
    passes = os.environ.get('LM_PASSES', 'sky,night,day,sunset').split(',')
    day_passes = [p_ for p_ in passes if p_ in MOODS]
    manifest = dict(night_max=NIGHT_MAX, sky_max=SKY_MAX, day_max=DAY_MAX, day=day_passes, atlases=[])
    for name, g, size in atlases:
        if not g:
            continue
        a = sum(area(o) for o in g)
        print(f'{name}: {len(g)} objetos, {a:.0f} m², ~{size / math.sqrt(a * 1.6):.1f} texels/m')
        lightmap_uvs(g, size, 0)
        for o in g:
            o['lm_atlas'] = name
        manifest['atlases'].append(dict(name=name, objects=len(g), area=round(a, 1), size=size))
    # ---------------- bakes
    sc.render.engine = 'CYCLES'
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    sc.cycles.sample_clamp_indirect = 4.0
    sc.cycles.sample_clamp_direct = 0.0
    sc.cycles.transparent_max_bounces = 8
    bake_glass_transparent(True)
    lights = make_lights(arch)
    for name, g, size in atlases:
        if not g:
            continue
        res = {}
        for passname in ('sky', 'night') + tuple(day_passes):
            img = bpy.data.images.new(f'{name}_{passname}', size, size, float_buffer=True, alpha=False)
            img.colorspace_settings.name = 'Non-Color'
            bake_materials(g, img, passname)
            sun = bpy.data.objects.get('BAKE_SUN')
            if sun:
                sun.hide_render = True
            if passname == 'sky':
                world(1.0)
                set_emission(False)
                for l in lights:
                    l.hide_render = True
            elif passname == 'night':
                world(0.0)
                set_emission(True)
                for l in lights:
                    l.hide_render = False
            else:
                day_world(passname)
                set_emission(False)
                for l in lights:
                    l.hide_render = True
            do_bake(g, img, samples, margin_px=max(12, size * 12 // 2048),
                    passes=('INDIRECT',) if passname in MOODS else ('DIRECT', 'INDIRECT'))
            restore_materials(g)
            raw = os.path.join(OUT, f'{name}_{passname}_raw.exr')
            img.filepath_raw = raw
            img.file_format = 'OPEN_EXR'
            img.save()
            res[passname] = denoise_exr(raw, os.path.join(OUT, f'{name}_{passname}.exr'), size)
        sky = np.clip(res['sky'][..., 0:3].mean(axis=2) / SKY_MAX, 0, 1)
        night = np.clip(res['night'][..., 0:3] / NIGHT_MAX, 0, 1)
        enc = np.concatenate([np.sqrt(night), np.sqrt(sky)[..., None]], axis=2)
        out = bpy.data.images.new(f'{name}_enc', size, size, alpha=True, float_buffer=False)
        out.colorspace_settings.name = 'Non-Color'
        out.pixels.foreach_set(enc.astype(np.float32).ravel())
        out.filepath_raw = os.path.join(OUT, f'{name}.png')
        out.file_format = 'PNG'
        out.save()
        print('  salvo', out.filepath_raw)
        for dp in day_passes:
            # RGBM: M = max(rgb)/DAY_MAX quantizado para cima; RGB = rgb/(M·DAY_MAX)
            rgb = np.clip(res[dp][..., 0:3] / DAY_MAX, 0, 1)
            mm = np.clip(np.ceil(rgb.max(axis=2) * 255.0) / 255.0, 1 / 255.0, 1.0)
            enc = np.concatenate([np.sqrt(rgb / mm[..., None]), mm[..., None]], axis=2)
            o2 = bpy.data.images.new(f'{name}_{dp}_enc', size, size, alpha=True, float_buffer=False)
            o2.colorspace_settings.name = 'Non-Color'
            o2.alpha_mode = 'STRAIGHT'
            o2.pixels.foreach_set(enc.astype(np.float32).ravel())
            o2.filepath_raw = os.path.join(OUT, f'{name}_{dp}.png')
            o2.file_format = 'PNG'
            o2.save()
            print('  salvo', o2.filepath_raw)
    bake_glass_transparent(False)
    for l in lights:
        bpy.data.objects.remove(l, do_unlink=True)
    with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(lib.ROOT, 'assets-src', 'casa_nexus_baked.blend'))
    export(arch)


def export(arch):
    """arch.glb: tudo o que foi modelado (sem imagens; materiais montados no navegador).
    props.glb: modelos importados do Poly Haven (com texturas)."""
    os.makedirs(PUB, exist_ok=True)
    for o in bpy.data.objects:
        o.select_set(False)
    groups = {
        'arch': [o for o in bpy.data.objects if o.type == 'MESH' and not o.get('imported') and not o.hide_render],
        'props': [o for o in bpy.data.objects if o.type == 'MESH' and o.get('imported') and not o.hide_render],
    }
    temp = [o for o in bpy.data.objects if o.type == 'MESH' and o.get('temp')]
    groups['arch'] += temp
    for o in temp:
        o.hide_render = False
    for name, objs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.hide_set(False)
            o.select_set(True)
        path = os.path.join(lib.ROOT, 'assets-src', 'export', f'{name}.glb')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_apply=True,
            export_texcoords=True, export_normals=True, export_extras=True, export_yup=True,
            export_materials='EXPORT', export_image_format=('NONE' if name == 'arch' else 'AUTO'),
            export_image_quality=82, export_cameras=False, export_lights=False, export_animations=False,
            export_attributes=False, export_tangents=False)
        print('exportado', path, len(objs))
