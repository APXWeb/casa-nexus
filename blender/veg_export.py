"""Exporta vegetação baixa e rochas como malhas reais (instanciadas no navegador) → assets-src/export/veg.glb"""
import bpy
import sys
import os
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa

lib.reset()
keep = []


def load(asset, pick=None, decimate=None, rename=None):
    d = os.path.join(lib.MODELS, asset)
    g = [f for f in os.listdir(d) if f.endswith('.gltf')][0]
    objs = lib.import_gltf(os.path.join(d, g))
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        lib.apply_transform(o)
    for o in objs:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in objs if o.name in bpy.data.objects and bpy.data.objects[o.name].type == 'MESH']
    out = []
    for o in meshes:
        if pick and not any(p in o.name for p in pick):
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        # origem na base, centrada
        vs = [v.co for v in o.data.vertices]
        mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        o.data.transform(Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)))
        if decimate:
            m = o.modifiers.new('d', 'DECIMATE')
            m.ratio = decimate
            lib.apply_mods(o)
        parts = o.name.split('.')[0].split('_')
        tag_ = parts[-2] if parts[-1].startswith('LOD') and len(parts) > 1 else parts[-1]
        o.name = (rename or asset) + ('_' + tag_ if len(meshes) > 1 else '')
        o['veg'] = 1
        out.append(o)
    return out


keep += load('shrub_02', rename='shrub_02')
keep += load('shrub_03', rename='shrub_03')
keep += load('shrub_04', rename='shrub_04')
keep += load('fern_02', rename='fern_02')
keep += load('boulder_01', decimate=0.07, rename='boulder_01')
# forrações floridas da frente dos canteiros (planting.py): só LOD0, reduzidas
keep += load('flower_gazania', pick=['LOD0'], decimate=0.6, rename='flower_gazania')
keep += load('crystalline_iceplant', pick=['LOD0'], decimate=0.6, rename='crystalline_iceplant')
keep += load('periwinkle_plant', pick=['LOD0'], decimate=0.35, rename='periwinkle_plant')
for o in keep:
    print('VEG', o.name, len(o.data.polygons))
bpy.ops.object.select_all(action='DESELECT')
for o in keep:
    o.select_set(True)
path = os.path.join(lib.ROOT, 'assets-src', 'export', 'veg.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                          export_extras=True, export_image_format='AUTO', export_cameras=False, export_lights=False)
print('VEG OK', path)
