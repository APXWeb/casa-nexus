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
  let ids = (await fs.readdir(path.join(src, 'tex'))).filter((d) => !d.startsWith('.'))
  // publica só as texturas usadas: materiais do arch.glb (extras.tex) ou citadas no código (personalização).
  // As fontes das variantes derivadas (tools/derive-tex.mjs) ficam de fora do site.
  try {
    const glb = await fs.readFile(path.join(src, 'export', 'arch.glb'))
    const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')
    const code = (await Promise.all((await fs.readdir(path.join(root, 'src'), { recursive: true })).filter((f) => f.endsWith('.js')).map((f) => fs.readFile(path.join(root, 'src', f), 'utf8')))).join('\n')
    const used = ids.filter((id) => json.includes(`"tex":"${id}"`) || code.includes(`'${id}'`))
    console.log('texturas publicadas', used.length, 'de', ids.length, '— fora:', ids.filter((i) => !used.includes(i)).join(', '))
    ids = used
    for (const d of await fs.readdir(path.join(pub, 'tex')).catch(() => [])) if (!ids.includes(d)) await fs.rm(path.join(pub, 'tex', d), { recursive: true })
  } catch (e) {
    console.log('sem arch.glb para filtrar texturas:', e.message)
  }
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
  // WebP "near-lossless": sem subamostragem de croma (o WebP com perda é sempre 4:2:0, o que sangrava cor entre
  // ilhas do atlas e criava blocos nos gradientes escuros). Mapas de luz são suaves e comprimem bem assim.
  // exact: preserva o RGB onde A = 0 (sem isso o WebP apaga a luz noturna onde a visibilidade do céu é zero).
  // Redimensiona RGB e A separadamente: o sharp pré-multiplica o alfa, o que corrompe dados independentes.
  const enc = { nearLossless: true, quality: 70, effort: 6, exact: true }
  // Atenção: o sharp aplica o resize ANTES de removeAlpha/extractChannel no mesmo pipeline (com pré-multiplicação),
  // por isso os canais são extraídos em buffers crus primeiro e só então redimensionados.
  const scaled = async (f, px) => {
    const { data: src4, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const n = info.width * info.height
    const rgbIn = Buffer.alloc(n * 3)
    const aIn = Buffer.alloc(n)
    for (let i = 0; i < n; i++) {
      rgbIn[i * 3] = src4[i * 4]
      rgbIn[i * 3 + 1] = src4[i * 4 + 1]
      rgbIn[i * 3 + 2] = src4[i * 4 + 2]
      aIn[i] = src4[i * 4 + 3]
    }
    const raw = (b, c) => sharp(b, { raw: { width: info.width, height: info.height, channels: c } })
    const rgb = await raw(rgbIn, 3).resize(px, px, { kernel: 'lanczos3' }).raw().toBuffer()
    // um canal volta como 3 (b-w → srgb): lê com o passo real
    const { data: al, info: ai } = await raw(aIn, 1).resize(px, px, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true })
    const out = Buffer.alloc(px * px * 4)
    for (let i = 0; i < px * px; i++) {
      out[i * 4] = rgb[i * 3]
      out[i * 4 + 1] = rgb[i * 3 + 1]
      out[i * 4 + 2] = rgb[i * 3 + 2]
      out[i * 4 + 3] = al[i * ai.channels]
    }
    return sharp(out, { raw: { width: px, height: px, channels: 4 } })
  }
  for (const a of man.atlases) {
    for (const v of ['', ...(man.day || []).map((d) => '_' + d)]) {
      const f = path.join(dir, `${a.name}${v}.png`)
      if (!(await exists(f))) continue
      const { width } = await sharp(f).metadata()
      // bake em 4096: versão _4k (perfil Ultra) + 2048 (Alta/Equilibrado) + 1024 (Desempenho)
      if (!v) a.has4k = width >= 4096
      // GI diurna/poente: o site usa no máximo 2k (luz suave), então não gera _4k
      if (width >= 4096 && !v) {
        await sharp(f).webp(enc).toFile(path.join(out, `${a.name}${v}_4k.webp`))
        tot += await size(path.join(out, `${a.name}${v}_4k.webp`))
      }
      const o = path.join(out, `${a.name}${v}.webp`)
      await (width > 2048 ? await scaled(f, 2048) : sharp(f)).webp(enc).toFile(o)
      await (await scaled(f, 1024)).webp(enc).toFile(path.join(out, `${a.name}${v}_1k.webp`))
      tot += await size(o)
    }
  }
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(man))
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
  for (const name of ['arch', 'props', 'veg', 'tree_island', 'tree_jacaranda', 'tree_searsia']) {
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
