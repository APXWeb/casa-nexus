"""Monta a cena da CASA NEXUS.
uso: blender -b --factory-startup --python blender/main.py -- [--preview out_dir] [--save] [--only arch]
"""
import sys
import os
import importlib

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa
import lib  # noqa
import plan  # noqa
import arch  # noqa

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    if name in args:
        i = args.index(name)
        return args[i + 1] if i + 1 < len(args) and not args[i + 1].startswith('--') else True
    return default


lib.reset()
lib.coll('arch')
arch.build_all()

if not opt('--only') or opt('--only') != 'arch':
    try:
        import furnish  # noqa
        furnish.build_all(arch.M)
    except ImportError:
        print('furnish ausente')
    try:
        import site_build  # noqa
        site_build.build_all(arch.M)
    except ImportError:
        print('site ausente')

# UV em escala real para tudo que foi modelado aqui (modelos importados mantêm seus UVs)
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.get('imported') and not o.get('uvok'):
        lib.world_uv(o)

# detalhamento arquitetônico (chanfros, rodapés, baguetes, rufos): depois dos UVs, que o chanfro interpola
if not opt('--no-detail'):
    import detail  # noqa
    for o in detail.build_all(arch.M):
        lib.world_uv(o)

with open(os.path.join(lib.ROOT, 'blender', 'plan.json'), 'w', encoding='utf8') as fh:
    fh.write(plan.as_json())

if opt('--save'):
    name = opt('--save') if isinstance(opt('--save'), str) else 'casa_nexus.blend'
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(lib.ROOT, 'assets-src', name))

if opt('--preview'):
    import preview  # noqa
    if opt('--veg'):
        preview.add_vegetation(grass=bool(opt('--grass')))
    preview.render_views(opt('--preview'), opt('--views', 'all'), int(opt('--samples', 48)))

if opt('--bake'):
    import bake  # noqa
    bake.run(arch, opt('--bake'))

print('MAIN OK', len(bpy.data.objects), 'objetos')
