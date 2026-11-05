// Validação do gate: capturas por ângulo/clima e medição de quadros no navegador real (GPU).
// uso: node tools/gate.mjs [url] [saida] [--views a,b] [--moods day,night] [--perf] [--q high] [--headed] [--size 1600x900]
import { chromium } from '@playwright/test'
import fs from 'node:fs'

const args = process.argv.slice(2)
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5290/gate.html'
const out = args[1] && !args[1].startsWith('--') ? args[1] : 'shots'
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const views = opt('--views', 'aerea,frente,fundos,piscina,hall,estar,cozinha,master,galeria').split(',')
const moods = opt('--moods', 'day').split(',')
const q = opt('--q', 'high')
const [W, H] = opt('--size', '1600x900').split('x').map(Number)
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch({
  headless: !args.includes('--headed'),
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const logs = []
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
const t0 = Date.now()
await page.goto(`${url}?q=${q}${opt('--extra', '')}`, { waitUntil: 'load' })
try {
  await page.waitForFunction(() => window.__nx, null, { timeout: 60000 })
  await page.evaluate(() => window.__nx.ready())
  await page.waitForFunction(() => document.documentElement.classList.contains('ready'), null, { timeout: 90000 })
} catch (e) {
  console.log('FALHOU', e.message.split(String.fromCharCode(10))[0])
  console.log(logs.slice(0, 30).join(String.fromCharCode(10)))
  await browser.close()
  process.exit(1)
}
const loadMs = Date.now() - t0
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2')
  const e = gl.getExtension('WEBGL_debug_renderer_info')
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/d'
})
console.log('GPU:', gpu, '| carregamento até pronto:', loadMs, 'ms', '| timings', JSON.stringify(await page.evaluate(() => window.__nx.timings)))
console.log('debug', JSON.stringify(await page.evaluate(() => window.__nx.debug())))
await page.evaluate(() => document.body.classList.add('shot'))
for (const m of moods) {
  await page.evaluate((m) => window.__nx.setMood(m), m)
  await page.waitForTimeout(800)
  for (const v of views) {
    await page.evaluate((v) => window.__nx.goView(v), v)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${out}/${m}_${v}.jpg`, type: 'jpeg', quality: 88 })
  }
}
if (args.includes('--perf')) {
  await page.evaluate(() => document.body.classList.remove('shot'))
  await page.evaluate(() => window.__nx.setMood('day'))
  await page.evaluate(() => window.__nx.goView('aerea'))
  const res = {}
  res.orbita_externa = await page.evaluate(() => window.__nx.measure(8, 42, 12))
  res.orbita_baixa = await page.evaluate(() => window.__nx.measure(6, 26, 2.0))
  res.tour_interno = await page.evaluate(() => window.__nx.walk([10, 1.6, 10], [-3, 1.6, 6], 5))
  res.troca_clima = await page.evaluate(() => window.__nx.moodCycle())
  await page.evaluate(() => window.__nx.setMood('night'))
  res.orbita_noite = await page.evaluate(() => window.__nx.measure(6, 40, 10))
  for (const [k, s] of Object.entries(res))
    console.log(k.padEnd(16), s ? `${s.fps.toFixed(1)} fps | média ${s.avg.toFixed(2)} ms | p95 ${s.p95.toFixed(2)} | pior ${s.worst.toFixed(1)} | calls ${s.calls} | tris ${s.tris}` : 'sem dados')
  console.log('info', JSON.stringify(await page.evaluate(() => window.__nx.info())))
}
const errs = logs.filter((l) => /error|warn/i.test(l))
if (errs.length) console.log('console:\n' + errs.slice(0, 15).join('\n'))
await browser.close()
