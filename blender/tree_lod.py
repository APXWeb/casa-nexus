"""Versão em malha real (para vista próxima) de uma árvore do Poly Haven.

Folhas: mantém uma fração das ilhas (cartões de folha) e amplia cada uma em torno do próprio centro,
para preservar a cobertura da copa. Tronco e galhos: decimação por colapso.

uso: blender -b --factory-startup --python blender/tree_lod.py -- <gltf> <saida.glb> <tris_folhas> <tris_madeira>
"""
import bpy, bmesh, sys, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out, leaf_target, wood_target = argv[0], argv[1], int(argv[2]), int(argv[3])
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.separate(type='MATERIAL')
bpy.ops.object.mode_set(mode='OBJECT')

parts = [o for o in bpy.data.objects if o.type == 'MESH']
for o in parts:
    me = o.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    mname = me.materials[0].name if me.materials else ''
    if 'leaves' in mname:
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        # ilhas por faces conectadas
        islands, seen = [], set()
        for f in bm.faces:
            if f.index in seen:
                continue
            stack, isl = [f], []
            seen.add(f.index)
            while stack:
                a = stack.pop()
                isl.append(a)
                for e in a.edges:
                    for b in e.link_faces:
                        if b.index not in seen:
                            seen.add(b.index)
                            stack.append(b)
            islands.append(isl)
        keep = min(1.0, leaf_target / max(1, tris))
        grow = min(2.3, (1.0 / keep) ** 0.5)
        kill = []
        for isl in islands:
            if random.random() < keep:
                vs = {v for f in isl for v in f.verts}
                c = sum((v.co for v in vs), Vector()) / len(vs)
                for v in vs:
                    v.co = c + (v.co - c) * grow
            else:
                kill.extend(isl)
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(me)
        bm.free()
        print('FOLHAS', o.name, 'ilhas', len(islands), 'mantidas', round(keep, 3), 'ampliação', round(grow, 2))
    else:
        ratio = min(1.0, wood_target / max(1, tris))
        if ratio < 1:
            m = o.modifiers.new('dec', 'DECIMATE')
            m.ratio = ratio
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier='dec')
    print('PARTE', o.name, mname, tris, '->', sum(len(p.vertices) - 2 for p in o.data.polygons))

for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='AUTO', export_apply=True,
                          export_cameras=False, export_lights=False, export_animations=False)
print('OK', out)
