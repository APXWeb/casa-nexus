// Palco 3D do site: cria renderizador, céu, entorno, casa e vegetação em etapas, com progresso real.
import * as THREE from 'three'
import { Renderer, detectProfile } from '../engine/renderer.js'
import { World } from '../engine/world.js'
import { House, makeGLTFLoader } from '../engine/house.js'
import { buildTerrain } from '../engine/terrain.js'
import { Vegetation, plantMeshes } from '../engine/vegetation.js'
import { shared, setTextureTier, waterMaterial, texturesPending } from '../engine/materials.js'

const BASE = import.meta.env.BASE_URL + 'assets/'
export const B = (x, y, z) => new THREE.Vector3(x, z, -y) // coordenadas do Blender → cena

/** Instala o gancho que aplica recorte/dissolução por objeto (construção e desmontagem). */
export function attachClip(mesh) {
  mesh.onBeforeRender = (r, s, c, g, material) => {
    const u = material?.userData?.lm
    if (!u) return
    const d = mesh.userData
    u.uClipY.value = d.clipY ?? 1e5
    u.uFade.value = d.fade ?? 1
    u.uClipGlow.value = d.glow ?? 0
    u.uHi.value = d.hi ?? 0
    material.uniformsNeedUpdate = true
  }
}

export async function createStage(canvas, { onProgress, onStep } = {}) {
  const profile = detectProfile()
  const R = new Renderer(canvas, profile)
  setTextureTier(R.p.tex, R.renderer.capabilities.getMaxAnisotropy())
  const world = new World(R.renderer, R.scene)
  world.sun.shadow.mapSize.set(R.p.shadow, R.p.shadow)
  world.sun.shadow.radius = R.p.shadowRadius
  const stage = { R, world, scene: R.scene, camera: R.camera, profile, timings: {} }
  const t0 = performance.now()

  // progresso real: bytes dos GLB + texturas carregadas
  const bytes = { arch: [0, 1], props: [0, 1], veg: [0, 1] }
  if (R.p.treeMesh) bytes.trees = [0, 1]
  let texTotal = 0
  const report = (label) => {
    const b = Object.values(bytes).reduce((a, [l, t]) => a + l / t, 0) / Object.keys(bytes).length
    const tp = texTotal ? 1 - texturesPending() / texTotal : 0
    onProgress?.(Math.min(1, b * 0.6 + tp * 0.4), label)
  }

  onStep?.('céu e iluminação')
  await world.loadMood('day', R.p.bg)
  world.apply('day')
  buildTerrain(R.scene, new THREE.TextureLoader(), BASE)
  stage.timings.sky = performance.now() - t0

  onStep?.('residência')
  const loader = makeGLTFLoader()
  const house = new House(R.scene, {
    onProgress: (n, e) => {
      if (e.total) bytes[n] = [e.loaded, e.total]
      report('residência')
    },
  })
  await house.load(loader, R.p.lm)
  texTotal = texturesPending()
  if (house.water) house.water.material = waterMaterial()
  house.meshes.forEach(attachClip)
  stage.house = house
  stage.timings.house = performance.now() - t0

  onStep?.('paisagismo')
  const plan = await (await fetch(BASE + 'plan.json')).json()
  stage.plan = plan
  const lot = await (await fetch(BASE + 'veg/lot.json')).json()
  const veg = new Vegetation(R.scene)
  await veg.load(['jacaranda', 'island', 'searsia'], R.p.lm >= 2048 ? 2048 : 1024)
  veg.plant(lot, R.p.veg)
  veg.build()
  stage.veg = veg
  stage.shrubs = await plantMeshes(R.scene, {
    loadAsync: (url) =>
      loader.loadAsync(url, (e) => {
        if (e.total) bytes.veg = [e.loaded, e.total]
        report('paisagismo')
      }),
  }, lot, Math.max(0.6, R.p.veg))
  if (R.p.treeMesh) {
    const prog = {}
    await veg.loadRealTrees({
      loadAsync: (url) =>
        loader.loadAsync(url, (e) => {
          if (!e.total) return
          prog[url] = [e.loaded, e.total]
          const v = Object.values(prog)
          bytes.trees = [v.reduce((a, x) => a + x[0], 0), v.reduce((a, x) => a + x[1], 0)]
          report('paisagismo')
        }),
    })
    bytes.trees = [1, 1]
  }
  bytes.veg = [1, 1]
  stage.timings.vegetation = performance.now() - t0

  onStep?.('materiais')
  await new Promise((res) => {
    const iv = setInterval(() => {
      report('materiais')
      if (texturesPending() === 0) {
        clearInterval(iv)
        res()
      }
    }, 120)
  })
  stage.timings.ready = performance.now() - t0
  R.shadowDirty = true
  R.invalidate(4)
  // demais climas em segundo plano
  stage.moodsReady = world.loadMood('sunset', R.p.bg).then(() => world.loadMood('night', R.p.bg))
  house.syncLamps()
  return stage
}

export { shared }
