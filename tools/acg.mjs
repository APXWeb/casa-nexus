// Converte materiais do ambientCG (CC0) para o formato do projeto: diff.jpg, nor.jpg (OpenGL), arm.jpg (AO, rugosidade, metal)
// uso: node tools/acg.mjs Carpet016 Fabric045 ...   (zips extraídos em assets-src/acg/<id>/)
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
for (const id of process.argv.slice(2)) {
  const src = path.join(root, 'assets-src', 'acg', id)
  const f = (k) => fs.readdirSync(src).find((n) => n.endsWith(`_${k}.jpg`))
  const out = path.join(root, 'assets-src', 'tex', 'acg_' + id.toLowerCase())
  fs.mkdirSync(out, { recursive: true })
  fs.copyFileSync(path.join(src, f('Color')), path.join(out, 'diff.jpg'))
  fs.copyFileSync(path.join(src, f('NormalGL')), path.join(out, 'nor.jpg'))
  const rough = sharp(path.join(src, f('Roughness'))).greyscale()
  const { width, height } = await rough.metadata()
  const R = await rough.raw().toBuffer()
  const ao = f('AmbientOcclusion') ? await sharp(path.join(src, f('AmbientOcclusion'))).greyscale().resize(width, height).raw().toBuffer() : Buffer.alloc(width * height, 255)
  const arm = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    arm[i * 3] = ao[i]
    arm[i * 3 + 1] = R[i]
    arm[i * 3 + 2] = 0
  }
  await sharp(arm, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toFile(path.join(out, 'arm.jpg'))
  console.log('ok', id, width, height)
}
