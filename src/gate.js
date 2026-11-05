// Prova de qualidade 3D (gate): cena completa, câmera orbital, climas, perfis e medição de desempenho.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Renderer, detectProfile, PROFILES } from './engine/renderer.js'
import { World, MOODS } from './engine/world.js'
import { House, makeGLTFLoader } from './engine/house.js'
import { buildTerrain } from './engine/terrain.js'
import { Vegetation, plantMeshes } from './engine/vegetation.js'
import { shared, setTextureTier, waterMaterial, texturesPending } from './engine/materials.js'

const B = (x, y, z) => new THREE.Vector3(x, z, -y) // Blender → cena
const VIEWS = {
  aerea: [B(34, -48, 30), B(0, -6, 2)],
  topo: [B(0.5, -8, 70), B(0, -6, 0)],
  frente: [B(10, -40, 2.2), B(-1, -12, 3.2)],
  fundos: [B(1, 23, 2.6), B(1, -6, 3.0)],
  piscina: [B(13.5, 12.5, 1.7), B(-2, -6, 2.4)],
  hall: [B(-2.6, -15.2, 1.6), B(0.6, -10.0, 1.9)],
  estar: [B(11.2, -10.4, 1.55), B(-2, -5.5, 1.4)],
  cozinha: [B(-1.0, -5.0, 1.6), B(-10, -9, 1.0)],
  master: [B(-2.8, -6.6, 5.1), B(-10.5, -11.0, 4.4)],
  galeria: [B(-1.2, -16.6, 5.1), B(0.6, -8, 3.0)],
}

const t0 = performance.now()
const profile = detectProfile()
const R = new Renderer(document.querySelector('canvas'), profile)
const { scene, camera } = R
setTextureTier(R.p.tex, R.renderer.capabilities.getMaxAnisotropy())
const world = new World(R.renderer, scene)
const QS = new URLSearchParams(location.search)
const TM = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }
if (QS.get('tm')) R.renderer.toneMapping = TM[QS.get('tm')]
shared.uDebug.value = Number(QS.get('lmdebug') || 0)
if (shared.uDebug.value) R.renderer.toneMapping = THREE.NoToneMapping
window.__tune = { exp: Number(QS.get('exp') || 1), sun: Number(QS.get('sun') || 1), env: Number(QS.get('env') || 1) }
world.sun.shadow.mapSize.set(R.p.shadow, R.p.shadow)
world.sun.shadow.radius = R.p.shadowRadius

const hud = document.querySelector('#hud')
const status = (t) => (document.querySelector('#status').textContent = t)

const controls = new OrbitControls(camera, R.canvas)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.maxPolarAngle = Math.PI * 0.495
controls.addEventListener('change', () => R.invalidate(2))
camera.position.copy(VIEWS.aerea[0])
controls.target.copy(VIEWS.aerea[1])

const timings = {}
async function boot() {
  status('carregando céu…')
  await world.loadMood('day', R.p.bg)
  world.apply('day')
  timings.sky = performance.now() - t0
  buildTerrain(scene, new THREE.TextureLoader(), import.meta.env.BASE_URL + 'assets/')
  status('carregando residência…')
  const loader = makeGLTFLoader()
  const house = new House(scene, { onProgress: (n, e) => status(`carregando ${n} ${e.total ? Math.round((e.loaded / e.total) * 100) + '%' : ''}`) })
  await house.load(loader, R.p.lm)
  if (house.water) house.water.material = waterMaterial()
  timings.house = performance.now() - t0
  status('plantando vegetação…')
  const lot = await (await fetch(import.meta.env.BASE_URL + 'assets/veg/lot.json')).json()
  const veg = new Vegetation(scene)
  await veg.load(['jacaranda', 'island', 'searsia'], R.p.lm >= 2048 ? 2048 : 1024)
  veg.plant(lot, R.p.veg)
  veg.build()
  await plantMeshes(scene, loader, lot, Math.max(0.6, R.p.veg))
  timings.vegetation = performance.now() - t0
  window.__house = house
  R.shadowDirty = true
  R.invalidate(5)
  status('')
  // demais climas em segundo plano
  world.loadMood('sunset', R.p.bg).then(() => world.loadMood('night', R.p.bg))
  const waitTex = () =>
    new Promise((res) => {
      const iv = setInterval(() => {
        if (texturesPending() === 0) {
          clearInterval(iv)
          res()
        }
      }, 100)
    })
  await waitTex()
  timings.textures = performance.now() - t0
  document.documentElement.classList.add('ready')
  R.invalidate(5)
  return house
}

let house
const housePromise = boot().then((h) => (house = h))

// ---------------------------------------------------------------- transições de clima
let trans = null
function setMood(name) {
  if (!world.envs[name]) return
  trans = { from: world.mood, to: name, t: 0 }
}

// ---------------------------------------------------------------- dentro/fora → exposição
const inside = (p) =>
  (p.y < 3.25 && p.x > -12 && p.x < 12 && p.z > 4 && p.z < 16) || (p.y > 3.5 && p.y < 6.3 && p.x > -12.5 && p.x < 8.5 && p.z > 6 && p.z < 17.2)
let insideF = 0

// ---------------------------------------------------------------- loop
let auto = null
const clock = new THREE.Clock()
function loop(now) {
  requestAnimationFrame(loop)
  const dt = Math.min(clock.getDelta(), 0.1)
  let active = false
  if (auto) {
    active = true
    auto(dt)
  }
  if (controls.update()) active = true
  if (trans) {
    trans.t = Math.min(1, trans.t + dt / 2.2)
    const k = trans.t * trans.t * (3 - 2 * trans.t)
    world.transition(trans.to, k, trans.from)
    R.shadowDirty = true
    house?.syncLamps()
    if (trans.t >= 1) trans = null
    active = true
  }
  const target = inside(camera.position) ? 1 : 0
  if (Math.abs(target - insideF) > 0.002) {
    insideF += (target - insideF) * Math.min(1, dt * 2.5)
    active = true
  }
  shared.uInside.value = insideF
  R.renderer.toneMappingExposure = shared.uDebug.value ? 1 : world.exposureFor(insideF) * window.__tune.exp
  if (R.grade) R.grade.enabled = !shared.uDebug.value
  world.sun.intensity = world.state.sunIntensity * window.__tune.sun
  scene.environmentIntensity = world.state.envIntensity * window.__tune.env
  shared.uTime.value = now / 1000
  if (R.frame(now, active)) house?.syncLamps()
  if (now % 500 < 17) drawHud()
}
requestAnimationFrame(loop)

function drawHud() {
  const s = R.stats(120)
  const h = house?.stats()
  hud.textContent = s
    ? `${R.p.label} · ${s.fps.toFixed(0)} fps · média ${s.avg.toFixed(1)} ms · p95 ${s.p95.toFixed(1)} ms · pior ${s.worst.toFixed(0)} ms\n` +
      `draw calls ${s.calls} · triângulos ${(s.tris / 1000).toFixed(0)}k · texturas ${s.textures}` +
      (h ? ` · malhas ${h.meshes}` : '')
    : 'parado (sem renderizar)'
}

// ---------------------------------------------------------------- UI de teste
const ui = document.querySelector('#ui')
const btn = (label, fn) => {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = fn
  ui.appendChild(b)
  return b
}
for (const k of Object.keys(MOODS)) btn(MOODS[k].label, () => setMood(k))
for (const k of Object.keys(PROFILES))
  btn(PROFILES[k].label, () => {
    location.search = '?q=' + k
  })
for (const k of Object.keys(VIEWS)) btn(k, () => goView(k))

function goView(k) {
  camera.position.copy(VIEWS[k][0])
  controls.target.copy(VIEWS[k][1])
  controls.update()
  R.invalidate(3)
}

// ---------------------------------------------------------------- automação (Playwright)
window.__nx = {
  ready: () => housePromise.then(() => true),
  timings,
  goView,
  setMood: async (k) => {
    await world.loadMood(k, R.p.bg)
    world.apply(k)
    R.shadowDirty = true
    house?.syncLamps()
    R.invalidate(3)
  },
  stats: () => R.stats(600),
  debug: () => ({ sunPos: world.sun.position.toArray().map((v) => +v.toFixed(1)), sunInt: world.sun.intensity, map: !!world.sun.shadow.map, casters: house?.meshes.filter((m) => m.castShadow).length, receivers: house?.meshes.filter((m) => m.receiveShadow).length, shadowType: R.renderer.shadowMap.type, enabled: R.renderer.shadowMap.enabled, progs: R.renderer.info.programs?.length }),
  info: () => ({ profile: R.profileName, ...house?.stats(), timings }),
  /** Mede quadros com a câmera orbitando por `sec` segundos. */
  measure(sec = 6, radius = 40, height = 14) {
    R.frames.length = 0
    return new Promise((res) => {
      let t = 0
      const c = controls.target.clone()
      auto = (dt) => {
        t += dt
        const a = t * 0.35
        camera.position.set(c.x + Math.cos(a) * radius, height, c.z + Math.sin(a) * radius)
        camera.lookAt(c)
        if (t > sec) {
          auto = null
          res(R.stats(10000))
        }
      }
    })
  },
  /** Mede quadros andando entre dois pontos (tour interno). */
  walk(from, to, sec = 5) {
    R.frames.length = 0
    return new Promise((res) => {
      let t = 0
      const a = new THREE.Vector3(...from),
        b = new THREE.Vector3(...to)
      auto = (dt) => {
        t += dt
        const k = Math.min(1, t / sec)
        camera.position.lerpVectors(a, b, k)
        camera.lookAt(b.clone().add(new THREE.Vector3(0, 0, 0)).lerp(a, -0.5))
        if (k >= 1) {
          auto = null
          res(R.stats(10000))
        }
      }
    })
  },
  moodCycle(sec = 6) {
    R.frames.length = 0
    return new Promise((res) => {
      const seq = ['sunset', 'night', 'day']
      let i = 0
      const step = () => {
        if (i >= seq.length) return res(R.stats(10000))
        setMood(seq[i++])
        setTimeout(step, 2400)
      }
      step()
    })
  },
}
