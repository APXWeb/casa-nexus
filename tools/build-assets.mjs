// Prepara os recursos para a web a partir de assets-src/ → public/assets/
//  - texturas PBR (diff/arm/nor) em WebP, 3 resoluções (alta 2k, equilibrada 1k, desempenho 512)
//  - lightmaps (PNG RGBA do bake) → WebP
//  - céus: HDR (iluminação) copiado em 1k; panoramas tonemapeados em WebP 8k/4k/2k
//  - GLB: meshopt + quantização (gltf-transform), texturas dos props em WebP 1k
// uso: node tools/build-assets.mjs [--only tex|lm|sky|glb|veg]
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

sharp.cache(false)
const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'assets-src')
const pub = path.join(root, 'public', 'assets')
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const want = (k) => !only || only.split(',').includes(k)
const report = {}
const GRADE = { wood_floor_deck: { saturation: 0.42, brightness: 1.32 } }

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
async function size(p) {
  return (await fs.stat(p)).size
}

// ---------------------------------------------------------------- texturas PBR
if (want('tex')) {
  const ids = (await fs.readdir(path.join(src, 'tex'))).filter((d) => !d.startsWith('.'))
  let total = { high: 0, balanced: 0, performance: 0 }
  for (const id of ids) {
    const dir = path.join(src, 'tex', id)
    const out = path.join(pub, 'tex', id)
    await fs.mkdir(out, { recursive: true })
    for (const map of ['diff', 'arm', 'nor']) {
      const f = path.join(dir, `${map}.jpg`)
      if (!(await exists(f))) continue
      for (const [tier, px] of [['high', 2048], ['balanced', 1024], ['performance', 512]]) {
        const o = path.join(out, `${map}_${px}.webp`)
        if (!(await exists(o))) {
          let img = sharp(f).resize(px, px)
          // correção de cor de origem (ex.: deck muito saturado para madeira envelhecida ao tempo)
          if (map === 'diff' && GRADE[id]) img = img.modulate(GRADE[id])
          await img.webp({ quality: map === 'nor' ? 90 : 84, effort: 5 }).toFile(o)
        }
        total[tier] += await size(o)
      }
    }
  }
  report.textures = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, (v / 1e6).toFixed(1) + ' MB']))
}

// ---------------------------------------------------------------- lightmaps
if (want('lm')) {
  const dir = path.join(src, 'bake')
  const out = path.join(pub, 'lm')
  await fs.mkdir(out, { recursive: true })
  const man = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'))
  let tot = 0
  for (const a of man.atlases) {
    const f = path.join(dir, `${a.name}.png`)
    const o = path.join(out, `${a.name}.webp`)
    await sharp(f).webp({ quality: 92, alphaQuality: 100, smartSubsample: true, effort: 6 }).toFile(o)
    const o2 = path.join(out, `${a.name}_1k.webp`)
    await sharp(f).resize(1024, 1024, { kernel: 'lanczos3' }).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(o2)
    tot += await size(o)
  }
  await fs.copyFile(path.join(dir, 'manifest.json'), path.join(out, 'manifest.json'))
  report.lightmaps = (tot / 1e6).toFixed(1) + ' MB'
}

// ---------------------------------------------------------------- céus
if (want('sky')) {
  const skies = JSON.parse(await fs.readFile(path.join(root, 'tools', 'skies.json'), 'utf8'))
  const out = path.join(pub, 'sky')
  await fs.mkdir(out, { recursive: true })
  for (const [mood, id] of Object.entries(skies)) {
    const hdr = path.join(src, 'hdri', `${id}_2k.hdr`)
    await fs.copyFile(hdr, path.join(out, `${mood}.hdr`))
    const prev = path.join(src, 'hdri', `${id}_preview.jpg`)
    for (const px of [8192, 4096, 2048]) {
      const o = path.join(out, `${mood}_${px}.webp`)
      if (!(await exists(o))) {
        await sharp(prev, { limitInputPixels: false })
          .resize(px, px / 2, { kernel: 'lanczos3' })
          .webp({ quality: 86, effort: 5 })
          .toFile(o)
      }
    }
  }
  report.skies = Object.keys(skies)
}

// ---------------------------------------------------------------- GLB
if (want('glb')) {
  const cli = path.join(root, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js')
  const run = (...a) => execFileSync(process.execPath, [cli, ...a], { stdio: 'pipe' }).toString()
  await fs.mkdir(path.join(pub, 'models'), { recursive: true })
  for (const name of ['arch', 'props', 'veg', 'tree_island', 'tree_jacaranda']) {
    const inF = path.join(src, 'export', `${name}.glb`)
    const tmp = path.join(src, 'export', `${name}.tmp.glb`)
    const outF = path.join(pub, 'models', `${name}.glb`)
    if (name !== 'arch') {
      run('resize', inF, tmp, '--width', '1024', '--height', '1024')
      run('webp', tmp, tmp, '--quality', '82')
    } else {
      await fs.copyFile(inF, tmp)
    }
    run('meshopt', tmp, outF, '--level', 'medium', '--quantize-texcoord', '16')
    await fs.rm(tmp)
    report[name + '.glb'] = ((await size(outF)) / 1e6).toFixed(2) + ' MB (origem ' + ((await size(inF)) / 1e6).toFixed(2) + ' MB)'
  }
}

// ---------------------------------------------------------------- impostores de vegetação
if (want('veg')) {
  const dir = path.join(src, 'impostors')
  const out = path.join(pub, 'veg')
  await fs.mkdir(out, { recursive: true })
  let tot = 0
  for (const f of (await fs.readdir(dir)).filter((f) => f.endsWith('.json') && !f.startsWith('test'))) {
    const n = f.replace('.json', '')
    await fs.copyFile(path.join(dir, f), path.join(out, f))
    for (const map of ['color', 'normal']) {
      const inF = path.join(dir, `${n}_${map}.png`)
      const o = path.join(out, `${n}_${map}.webp`)
      await sharp(inF).webp({ quality: map === 'color' ? 88 : 92, alphaQuality: 95, effort: 6 }).toFile(o)
      await sharp(inF).resize(1024, 1024).webp({ quality: 88, alphaQuality: 95, effort: 6 }).toFile(path.join(out, `${n}_${map}_1k.webp`))
      tot += await size(o)
    }
  }
  await fs.copyFile(path.join(root, 'blender', 'vegetation.json'), path.join(out, 'lot.json'))
  report.vegetation = (tot / 1e6).toFixed(1) + ' MB'
}

console.log(JSON.stringify(report, null, 1))
