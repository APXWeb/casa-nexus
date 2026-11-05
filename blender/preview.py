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
    setup_world()
    for o in bpy.data.objects:
        if o.get('temp'):
            o.hide_render = True
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
        sc.view_settings.exposure = 0.0 if n in ('aerea', 'frente', 'fundos', 'piscina') else 1.3
        sc.render.filepath = os.path.join(out_dir, f'{n}.jpg')
        sc.render.image_settings.file_format = 'JPEG'
        bpy.ops.render.render(write_still=True)
        print('render', n)
