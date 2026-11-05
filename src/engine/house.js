// Carrega a residência (arch.glb + props.glb), monta materiais e aplica os lightmaps por atlas.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { buildMaterial, patchLightmap, adaptPropMaterial, glassMaterial, shared } from './materials.js'

const BASE = import.meta.env.BASE_URL + 'assets/'

export function makeGLTFLoader(manager) {
  const l = new GLTFLoader(manager)
  l.setMeshoptDecoder(MeshoptDecoder)
  return l
}

export class House {
  constructor(scene, { onProgress } = {}) {
    this.scene = scene
    this.root = new THREE.Group()
    this.root.name = 'casa'
    scene.add(this.root)
    this.byStage = {}
    this.byRoom = {}
    this.meshes = []
    this.lamps = []
    this.glass = []
    this.water = null
    this.lm = {}
    this.onProgress = onProgress
  }

  async loadLightmaps(px) {
    const man = await (await fetch(BASE + 'lm/manifest.json')).json()
    this.lmManifest = man
    const tl = new THREE.TextureLoader()
    await Promise.all(
      man.atlases.map(async (a) => {
        const t = await tl.loadAsync(BASE + `lm/${a.name}${px >= 4096 && a.has4k ? '_4k' : px <= 1024 ? '_1k' : ''}.webp`)
        t.flipY = false
        t.colorSpace = THREE.NoColorSpace
        t.generateMipmaps = true
        t.minFilter = THREE.LinearMipmapLinearFilter
        t.magFilter = THREE.LinearFilter
        t.anisotropy = 4
        this.lm[a.name] = t
      }),
    )
  }

  async load(loader, lmPx = 2048) {
    const [lmDone, arch, props] = await Promise.all([
      this.loadLightmaps(lmPx),
      loader.loadAsync(BASE + 'models/arch.glb', (e) => this.onProgress?.('arch', e)),
      loader.loadAsync(BASE + 'models/props.glb', (e) => this.onProgress?.('props', e)),
    ])
    this.setup(arch.scene, false)
    this.setup(props.scene, true)
    this.root.add(arch.scene, props.scene)
    this.root.updateMatrixWorld(true)
    return this
  }

  setup(root, isProps) {
    const matCache = new Map()
    const man = this.lmManifest
    root.traverse((o) => {
      if (!o.isMesh) return
      // nós com vários materiais viram um grupo: os extras ficam no pai
      const ex = Object.keys(o.userData).length ? o.userData : { ...(o.parent?.userData || {}) }
      o.userData = ex
      o.castShadow = !ex.glass && !ex.water && !ex.curtain && !ex.emissive
      o.receiveShadow = !ex.glass && !ex.emissive
      const atlas = ex.lm_atlas
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const out = mats.map((m) => {
        const key = m.name + '|' + (atlas || '-') + '|' + (ex.room ? 'in' : 'out')
        if (matCache.has(key)) return matCache.get(key)
        let nm
        if (isProps) {
          nm = adaptPropMaterial(m.clone())
        } else {
          nm = buildMaterial(m, m.userData || {})
        }
        if (!nm.userData.lm && !(nm.transparent && nm.premultipliedAlpha)) {
          const indoor = !!ex.room && !['deck', 'gourmet', 'varanda', 'jardim', 'acesso'].includes(ex.room)
          patchLightmap(nm, {
            tex: atlas ? this.lm[atlas] : null,
            skyMax: man.sky_max,
            nightMax: man.night_max,
            constOcc: indoor ? 0.28 : 1,
            constNight: indoor ? 0x3a2a1c : 0x000000,
          })
        }
        if (nm.userData.isLamp) this.lamps.push(nm)
        matCache.set(key, nm)
        return nm
      })
      o.material = Array.isArray(o.material) ? out : out[0]
      if (ex.glass) this.glass.push(o)
      if (ex.water) this.water = o
      if (ex.temp) o.visible = false
      if (ex.stage) (this.byStage[ex.stage] ||= []).push(o)
      if (ex.room) (this.byRoom[ex.room] ||= []).push(o)
      if (ex.glass || ex.curtain) o.renderOrder = 2
      this.meshes.push(o)
    })
  }

  /** Atualiza brilho das luminárias conforme o clima. */
  syncLamps() {
    const k = shared.uEmissive.value
    for (const m of this.lamps) m.emissiveIntensity = m.userData.emitBase * k * 0.9 + 0.0
  }

  stats() {
    let tris = 0
    let meshes = 0
    this.root.traverse((o) => {
      if (o.isMesh && o.visible) {
        meshes++
        const g = o.geometry
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3
      }
    })
    return { meshes, tris: Math.round(tris) }
  }
}
