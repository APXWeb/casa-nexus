"""Gera impostores hemi-octaédricos de vegetação (atlas de cor+alfa e de normais em espaço do objeto).
uso: blender -b --factory-startup --python blender/impostor.py -- <asset> [objeto] [N] [px] [nome_saida] [escala]
Convenção (cena Y para cima, igual ao three.js): direção d com d.y >= 0
  encode: d /= |d.x|+|d.y|+|d.z|;  p = (d.x + d.z, d.x - d.z)  ∈ [-1,1]²;  uv = p*0.5+0.5
  quadro (i,j) fica na posição uv = (i/(N-1), j/(N-1)).
"""
import bpy
import sys
import os
import math
import json
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa

args = sys.argv[sys.argv.index('--') + 1:]
asset = args[0]
objname = args[1] if len(args) > 1 and args[1] != '-' else None
N = int(args[2]) if len(args) > 2 else 8
PX = int(args[3]) if len(args) > 3 else 256
outname = args[4] if len(args) > 4 else asset
SCALE = float(args[5]) if len(args) > 5 else 1.0

lib.reset()
d = os.path.join(lib.MODELS, asset)
g = [f for f in os.listdir(d) if f.endswith('.gltf')][0]
objs = lib.import_gltf(os.path.join(d, g))
meshes = [o for o in objs if o.type == 'MESH']
if objname:
    for o in meshes:
        if objname not in o.name:
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
    lib.apply_transform(o)
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
# centraliza no chão (XY) e aplica escala
pts = [v.co for o in meshes for v in o.data.vertices]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
for o in meshes:
    o.data.transform(Matrix.Scale(SCALE, 4) @ Matrix.Translation((-cx, -cy, -mn.z)))
pts = [v.co for o in meshes for v in o.data.vertices]
height = max(p.z for p in pts)
center = Vector((0, 0, height / 2))
radius = max((p - center).length for p in pts) * 1.02
print('IMP', asset, 'altura', round(height, 2), 'raio', round(radius, 2))

sc = bpy.context.scene
import preview  # noqa
preview.gpu(sc)
sc.cycles.samples = 24
sc.cycles.use_denoising = False
sc.render.film_transparent = True
sc.render.resolution_x = PX
sc.render.resolution_y = PX
sc.render.filter_size = 1.2
vl = sc.view_layers[0]
vl.use_pass_diffuse_color = True
vl.use_pass_normal = True
w = bpy.data.worlds.new('W')
w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
sc.world = w
sc.view_settings.view_transform = 'Standard'

# compositor: a saída do grupo alterna entre as passadas DiffCol e Normal
sc.render.use_persistent_data = True
ng = bpy.data.node_groups.new('IMP', 'CompositorNodeTree')
sc.compositing_node_group = ng
sc.render.use_compositing = True
rl = ng.nodes.new('CompositorNodeRLayers')
go = ng.nodes.new('NodeGroupOutput')
ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
tmp = os.path.join(lib.ROOT, 'assets-src', 'impostor_tmp')
os.makedirs(tmp, exist_ok=True)

cam_d = bpy.data.cameras.new('C')
cam_d.type = 'ORTHO'
cam_d.ortho_scale = radius * 2
cam = bpy.data.objects.new('C', cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cam_d.clip_start = 0.01
cam_d.clip_end = radius * 4


def decode(u, v):
    """uv ∈ [0,1]² → direção (Y para cima, convenção three)."""
    px, py = u * 2 - 1, v * 2 - 1
    x = (px + py) / 2
    z = (px - py) / 2
    y = 1 - abs(x) - abs(z)
    return Vector((x, y, z)).normalized()


atlas_c = np.zeros((N * PX, N * PX, 4), np.float32)
atlas_n = np.zeros((N * PX, N * PX, 4), np.float32)
for j in range(N):
    for i in range(N):
        dt = decode(i / (N - 1), j / (N - 1))  # three: Y up
        db = Vector((dt.x, -dt.z, dt.y))  # → Blender (x, -z, y)
        pos = center + db * radius * 2
        cam.location = pos
        up = Vector((0, 0, 1))
        fwd = (center - pos).normalized()
        if abs(fwd.dot(up)) > 0.999:
            up = Vector((0, 1, 0))
        rot = fwd.to_track_quat('-Z', 'Y')
        cam.rotation_euler = rot.to_euler()
        for k, sock in (('c', 'Diffuse Color'), ('n', 'Normal'), ('a', 'Alpha')):
            ng.links.new(rl.outputs[sock], go.inputs[0])
            sc.render.filepath = os.path.join(tmp, f'v_{k}.exr')
            sc.render.image_settings.file_format = 'OPEN_EXR'
            sc.render.image_settings.color_depth = '32'
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(sc.render.filepath, check_existing=False)
            a = np.array(img.pixels[:], np.float32).reshape(PX, PX, 4)
            bpy.data.images.remove(img)
            if k == 'c':
                atlas_c[j * PX:(j + 1) * PX, i * PX:(i + 1) * PX, :3] = a[..., :3]
            elif k == 'a':
                atlas_c[j * PX:(j + 1) * PX, i * PX:(i + 1) * PX, 3] = a[..., 0]
            else:
                atlas_n[j * PX:(j + 1) * PX, i * PX:(i + 1) * PX] = a
        print('quadro', i, j)

# alfa a partir da passada combinada é o mesmo do DiffCol (film transparente) — reforça bordas
alpha = atlas_c[..., 3:4]
# passadas DiffCol/Normal não são pré-multiplicadas; nas bordas (alfa parcial) o filtro mistura com zero
col = np.where(alpha > 0.02, atlas_c[..., :3] / np.maximum(alpha, 0.02), 0)
col = np.clip(col, 0, 1)
nrm = atlas_n[..., :3]
# normal do Blender (Z para cima) → convenção three (Y para cima), codificada 0..1
nrm3 = np.stack([nrm[..., 0], nrm[..., 2], -nrm[..., 1]], axis=-1)
nrm3 = nrm3 / np.maximum(np.linalg.norm(nrm3, axis=-1, keepdims=True), 1e-5)
enc_n = np.concatenate([nrm3 * 0.5 + 0.5, alpha], axis=-1)


# dilata cor/normal para fora da silhueta (evita halo escuro com mipmaps)
def dilate(rgb, a, it=6):
    rgb = rgb.copy()
    m = (a[..., 0] > 0.02).astype(np.float32)
    for _ in range(it):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(m.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            acc += np.roll(np.roll(rgb * m[..., None], dy, 0), dx, 1)
            cnt += np.roll(np.roll(m, dy, 0), dx, 1)
        fill = (m == 0) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][..., None]
        m = np.maximum(m, fill.astype(np.float32))
    return rgb


col = dilate(col, alpha)
enc_rgb = dilate(enc_n[..., :3], alpha)
srgb = np.where(col <= 0.0031308, col * 12.92, 1.055 * np.power(np.clip(col, 0, None), 1 / 2.4) - 0.055)
out_c = np.concatenate([np.clip(srgb, 0, 1), alpha], axis=-1)
out_n = np.concatenate([enc_rgb, alpha], axis=-1)
dst = os.path.join(lib.ROOT, 'assets-src', 'impostors')
os.makedirs(dst, exist_ok=True)
for name, arr in (('color', out_c), ('normal', out_n)):
    img = bpy.data.images.new(f'{outname}_{name}', N * PX, N * PX, alpha=True, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = os.path.join(dst, f'{outname}_{name}.png')
    img.file_format = 'PNG'
    img.save()
meta = dict(name=outname, frames=N, px=PX, radius=round(radius, 3), height=round(height, 3),
            center=[0, round(height / 2, 3), 0])
with open(os.path.join(dst, f'{outname}.json'), 'w') as fh:
    json.dump(meta, fh)
print('IMP OK', meta)
