// Monta comparações lado a lado (antes | depois) com rótulos. uso: node tools/pair.mjs dirA dirB out "Antes" "Depois"
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
const [A, B, OUT, la = 'Antes', lb = 'Depois'] = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })
const label = (t, w) => Buffer.from(`<svg width="${w}" height="34"><rect width="${w}" height="34" fill="#111"/><text x="12" y="23" font-size="18" fill="#eee" font-family="Arial">${t}</text></svg>`)
for (const f of fs.readdirSync(A).filter((f) => f.endsWith('.jpg') && fs.existsSync(path.join(B, f)))) {
  const W = 960, H = 540
  const a = await sharp(path.join(A, f)).resize(W, H).toBuffer()
  const b = await sharp(path.join(B, f)).resize(W, H).toBuffer()
  await sharp({ create: { width: W * 2 + 6, height: H + 34, channels: 3, background: '#000' } })
    .composite([{ input: label(`${la} — ${f.replace('.jpg', '')}`, W), left: 0, top: 0 }, { input: label(`${lb} — ${f.replace('.jpg', '')}`, W), left: W + 6, top: 0 }, { input: a, left: 0, top: 34 }, { input: b, left: W + 6, top: 34 }])
    .jpeg({ quality: 88 })
    .toFile(path.join(OUT, f))
}
console.log('ok', OUT)
