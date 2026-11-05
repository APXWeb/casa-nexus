// Folha de contato de miniaturas do Poly Haven para escolher recursos pelo olho.
// uso: node tools/contact.mjs saida.png id1 id2 id3 ...
import { chromium } from '@playwright/test'

const [out, ...ids] = process.argv.slice(2)
const cells = ids
  .map(
    (id) => `<figure><img src="https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256"><figcaption>${id}</figcaption></figure>`,
  )
  .join('')
const html = `<html><body style="margin:0;background:#222;font:11px sans-serif;color:#eee;display:grid;grid-template-columns:repeat(6,200px);gap:4px;padding:4px">
<style>figure{margin:0}img{width:200px;height:200px;object-fit:cover;display:block}figcaption{padding:2px 0}</style>${cells}</body></html>`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 6 * 204 + 8, height: 400 } })
await p.setContent(html, { waitUntil: 'networkidle' })
await p.screenshot({ path: out, fullPage: true })
await b.close()
console.log('ok', out)
