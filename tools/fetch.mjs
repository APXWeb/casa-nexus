// Baixa os recursos CC0 do Poly Haven listados em tools/assets.json para assets-src/.
// Cada recurso fica em sua própria pasta. Gera assets-src/CREDITS.json com autor e licença.
// uso: node tools/fetch.mjs
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'tools/assets.json'), 'utf8'))
const out = path.join(root, 'assets-src')
const UA = { 'User-Agent': 'casa-nexus-asset-fetch/1.0' }

async function get(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: UA })
    if (r.ok) return r
    await new Promise((s) => setTimeout(s, 800))
  }
  throw new Error('falhou ' + url)
}
async function save(url, file) {
  try {
    await fs.access(file)
    return
  } catch {}
  await fs.mkdir(path.dirname(file), { recursive: true })
  const buf = Buffer.from(await (await get(url)).arrayBuffer())
  await fs.writeFile(file, buf)
}

const credits = []
async function info(id) {
  const j = await (await get(`https://api.polyhaven.com/info/${id}`)).json()
  credits.push({ id, name: j.name, authors: Object.keys(j.authors || {}), license: 'CC0 1.0', url: `https://polyhaven.com/a/${id}` })
}

async function texture(id, res) {
  const f = await (await get(`https://api.polyhaven.com/files/${id}`)).json()
  const maps = { diff: f.Diffuse, nor: f.nor_gl, arm: f.arm }
  for (const [k, m] of Object.entries(maps)) {
    const e = m?.[res]?.jpg || m?.[res]?.png
    if (!e) throw new Error(`${id}: mapa ${k} ${res} ausente`)
    await save(e.url, path.join(out, 'tex', id, `${k}.${e.url.split('.').pop()}`))
  }
  await info(id)
}
async function model(id, res) {
  const f = await (await get(`https://api.polyhaven.com/files/${id}`)).json()
  const g = f.gltf?.[res]?.gltf || f.gltf?.['1k']?.gltf
  if (!g) throw new Error(`${id}: gltf ausente`)
  const dir = path.join(out, 'models', id)
  await save(g.url, path.join(dir, path.basename(new URL(g.url).pathname)))
  for (const [rel, inc] of Object.entries(g.include || {})) await save(inc.url, path.join(dir, rel))
  await info(id)
}
async function hdri(id, res) {
  const f = await (await get(`https://api.polyhaven.com/files/${id}`)).json()
  await save(f.hdri[res].hdr.url, path.join(out, 'hdri', `${id}_${res}.hdr`))
  if (f.tonemapped?.url) await save(f.tonemapped.url, path.join(out, 'hdri', `${id}_preview.jpg`))
  await info(id)
}

const jobs = [
  ...manifest.textures.map((id) => () => texture(id, manifest.texRes)),
  ...manifest.models.map((id) => () => model(id, manifest.modelRes)),
  ...manifest.hdris.map((id) => () => hdri(id, manifest.hdriRes)),
]
let n = 0
async function worker() {
  while (jobs.length) {
    const j = jobs.shift()
    try {
      await j()
    } catch (e) {
      console.error('ERRO', e.message)
    }
    if (++n % 10 === 0) console.log(n, 'feitos')
  }
}
await Promise.all([1, 2, 3, 4, 5, 6].map(worker))
credits.sort((a, b) => a.id.localeCompare(b.id))
await fs.writeFile(path.join(out, 'CREDITS.json'), JSON.stringify(credits, null, 2))
console.log('pronto', credits.length, 'recursos')
