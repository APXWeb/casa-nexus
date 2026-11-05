// Junta imagens numa grade (para revisar várias renderizações de uma vez).
// uso: node tools/sheet.mjs saida.jpg colunas largura img1 img2 ...
import sharp from 'sharp'
const [out, cols = 2, width = 800, ...imgs] = process.argv.slice(2)
const C = Number(cols)
const W = Number(width)
const tiles = await Promise.all(imgs.map((f) => sharp(f).resize(W).toBuffer({ resolveWithObject: true })))
const H = Math.max(...tiles.map((t) => t.info.height))
const rows = Math.ceil(tiles.length / C)
await sharp({ create: { width: C * W, height: rows * H, channels: 3, background: '#111' } })
  .composite(tiles.map((t, i) => ({ input: t.data, left: (i % C) * W, top: Math.floor(i / C) * H })))
  .jpeg({ quality: 88 })
  .toFile(out)
console.log('ok', out)
