import sharp from 'sharp'
const ids = process.argv.slice(3), out = process.argv[2]
const S = 300
const tiles = await Promise.all(ids.map(async (id) => ({ input: await sharp(`assets-src/tex/${id}/diff.jpg`).resize(S, S).toBuffer() })))
const cols = 5, rows = Math.ceil(ids.length / cols)
const svg = (t) => Buffer.from(`<svg width="${S}" height="24"><rect width="${S}" height="24" fill="black"/><text x="4" y="17" font-size="15" fill="white" font-family="Arial">${t}</text></svg>`)
const comp = []
ids.forEach((id, i) => { const x = (i % cols) * S, y = Math.floor(i / cols) * (S + 24); comp.push({ ...tiles[i], left: x, top: y + 24 }, { input: svg(id), left: x, top: y }) })
await sharp({ create: { width: cols * S, height: rows * (S + 24), channels: 3, background: '#000' } }).composite(comp).jpeg().toFile(out)
