// Capturas e medição do site completo.
// uso: node tools/site.mjs [url] [saida] [--q high] [--size 1600x900] [--shots "sel:frac,..."] [--perf] [--mobile] [--mood day|sunset|night] [--clean]
import { chromium, devices } from '@playwright/test'
import fs from 'node:fs'

const args = process.argv.slice(2)
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5290/'
const out = args[1] && !args[1].startsWith('--') ? args[1] : 'shots-site'
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const q = opt('--q', 'high')
const [W, H] = opt('--size', '1600x900').split('x').map(Number)
const shots = opt(
  '--shots',
  '#abertura:0,#abertura:0.9,#residencia:0.3,#residencia:0.7,#construcao:0.04,#construcao:0.2,#construcao:0.36,#construcao:0.5,#construcao:0.64,#construcao:0.8,#construcao:0.97,#visao:0.5,#desmontagem:0.55,#tour:0.06,#tour:0.2,#tour:0.33,#tour:0.45,#tour:0.62,#tour:0.78,#tour:0.97,#final:0.6,#planta:0',
).split(',')
fs.mkdirSync(out, { recursive: true })
const mobile = args.includes('--mobile')
const browser = await chromium.launch({ headless: !args.includes('--headed'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = mobile ? await browser.newContext({ ...devices['Pixel 7'] }) : await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
const t0 = Date.now()
await page.goto(`${url}?q=${q}`, { waitUntil: 'load' })
try {
  await page.waitForFunction(() => document.documentElement.classList.contains('ready'), null, { timeout: 120000 })
} catch (e) {
  console.log('FALHOU', logs.slice(0, 20).join(String.fromCharCode(10)))
  await browser.close()
  process.exit(1)
}
console.log('pronto em', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => window.__nx.info())))
// --clean: esconde toda a interface (capturas para as imagens de reserva sem WebGL)
if (args.includes('--clean')) await page.addStyleTag({ content: 'body *:not(canvas){visibility:hidden !important} canvas{visibility:visible !important}' })
const mood = opt('--mood', null)
if (mood) {
  await page.evaluate((m) => window.__nx.setMood(m), mood)
  await page.waitForTimeout(3500)
}
let i = 0
for (const s of shots) {
  const [sel, frac] = s.split(':')
  await page.evaluate(([sel, f]) => window.__nx.scrollTo(sel, Number(f)), [sel, frac])
  await page.waitForTimeout(sel === '#tour' ? 2200 : 1800)
  await page.screenshot({ path: `${out}/${String(i++).padStart(2, '0')}_${sel.slice(1)}_${frac}.jpg`, type: 'jpeg', quality: 85 })
}
if (args.includes('--perf')) {
  const res = {}
  for (const [name, sel, sec] of [['construcao', '#construcao', 10], ['desmontagem', '#desmontagem', 6], ['tour', '#tour', 14]]) {
    await page.evaluate((sel) => window.__nx.scrollTo(sel, 0), sel)
    await page.waitForTimeout(1500)
    await page.evaluate(() => window.__nx.frames())
    const steps = sec * 30
    for (let k = 0; k <= steps; k++) {
      await page.evaluate(([sel, f]) => window.__nx.scrollTo(sel, f), [sel, k / steps])
      await page.waitForTimeout(33)
    }
    res[name] = await page.evaluate(() => window.__nx.stats(100000))
  }
  for (const [k, s] of Object.entries(res))
    console.log(k.padEnd(12), s ? `${s.fps.toFixed(1)} fps | média ${s.avg.toFixed(2)} ms | p95 ${s.p95.toFixed(2)} | pior ${s.worst.toFixed(1)} | calls ${s.calls} | tris ${s.tris}` : 'sem dados')
}
const errs = logs.filter((l) => /error|warn/i.test(l))
if (errs.length) console.log('console:', errs.slice(0, 12).join(String.fromCharCode(10)).slice(0, 3000))
await browser.close()
