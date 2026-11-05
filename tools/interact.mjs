// Testa as seções interativas: exploração (voo entre ambientes), detalhes e personalização.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const out = process.argv[2] || 'shots-int'
fs.mkdirSync(out, { recursive: true })
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
const logs = []
p.on('console', (m) => logs.push(m.type() + ': ' + m.text()))
p.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
await p.goto('http://localhost:5290/?q=high')
await p.waitForFunction(() => document.documentElement.classList.contains('ready'), null, { timeout: 120000 })
const shot = async (n, wait = 600) => {
  await p.waitForTimeout(wait)
  await p.screenshot({ path: `${out}/${n}.jpg`, type: 'jpeg', quality: 85 })
}
await p.evaluate(() => window.__nx.scrollTo('#explorar', 0))
await p.waitForTimeout(800)
for (const r of ['estar', 'suite_2', 'cozinha']) {
  await p.evaluate((r) => window.__nx.flyToRoom(r), r)
  await shot('explore_' + r, 7500)
}
// caminhar 1,5 s para frente com colisão
await p.keyboard.down('w')
await p.waitForTimeout(1500)
await p.keyboard.up('w')
await shot('explore_walk', 500)
await p.evaluate(() => window.__nx.scrollTo('#detalhes', 0))
await shot('details_overview', 4500)
await p.evaluate(() => window.__nx.openDetail('ilha'))
await shot('details_ilha', 6500)
await p.evaluate(() => window.__nx.scrollTo('#personalizar', 0))
await shot('custom_fachada', 6000)
await p.evaluate(() => { window.__nx.setOption('fachada', 'cinza'); window.__nx.setOption('madeira', 'nogueira') })
await shot('custom_changed', 3000)
console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 10).join('\n'))
await b.close()
