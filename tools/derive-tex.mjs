// Variantes neutras de texturas (CC0): dessatura e normaliza o brilho médio do diff para que a tinta do
// material defina a cor (ex.: um tecido xadrez ou verde vira trama neutra). arm e nor são copiados.
// uso: node tools/derive-tex.mjs
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const T = path.join(root, 'assets-src', 'tex')
const JOBS = [
  // destino, origem, brilho médio alvo (0..1), contraste do detalhe
  ['fab_weave', 'acg_fabric045', 0.78, 1.0],
  ['fab_boucle', 'curly_teddy_natural', 0.8, 1.15],
  ['fab_jersey', 'cotton_jersey', 0.86, 1.6],
  ['fab_sheer', 'crepe_georgette', 0.9, 2.0],
  ['fab_linen', 'terlenka', 0.8, 2.2],
  ['fab_herring', 'poly_wool_herringbone', 0.62, 1.0],
  ['plaster_fine', 'acg_plaster001', 0.86, 0.8],
]
for (const [dst, srcId, target, contrast] of JOBS) {
  const s = path.join(T, srcId), d = path.join(T, dst)
  fs.mkdirSync(d, { recursive: true })
  const { data, info } = await sharp(path.join(s, 'diff.jpg')).greyscale().raw().toBuffer({ resolveWithObject: true })
  let mean = 0
  for (const v of data) mean += v
  mean /= data.length * 255
  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 255
    out[i] = Math.max(0, Math.min(255, Math.round((target + (v - mean) * contrast) * 255)))
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).toColourspace('srgb').jpeg({ quality: 92 }).toFile(path.join(d, 'diff.jpg'))
  if (fs.existsSync(path.join(s, 'nor.jpg'))) fs.copyFileSync(path.join(s, 'nor.jpg'), path.join(d, 'nor.jpg'))
  // tecidos e reboco são dielétricos: zera o canal de metalicidade (B) do ARM (algumas fontes trazem ~0,2)
  if (fs.existsSync(path.join(s, 'arm.jpg'))) {
    const a = await sharp(path.join(s, 'arm.jpg')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let i = 2; i < a.data.length; i += a.info.channels) a.data[i] = 0
    await sharp(a.data, { raw: { width: a.info.width, height: a.info.height, channels: a.info.channels } }).jpeg({ quality: 92 }).toFile(path.join(d, 'arm.jpg'))
  }
  console.log(dst, '←', srcId, 'média', mean.toFixed(3))
}
