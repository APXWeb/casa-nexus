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
    const get = async (file) => {
      const t = await tl.loadAsync(BASE + 'lm/' + file)
      t.flipY = false
      t.colorSpace = THREE.NoColorSpace
      t.generateMipmaps = true
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.anisotropy = 8
      return t
    }
    const suf = (a) => (px >= 4096 && a.has4k ? '_4k' : px <= 1024 ? '_1k' : '')
    // GI diurna é luz indireta (baixa frequência): uma resolução abaixo da noturna basta (Ultra 2k, demais 1k).
    // O atlas do dia entra na carga inicial; o do pôr do sol vem depois, em segundo plano (até lá usa o do dia).
    const daySuf = px >= 4096 ? '' : '_1k'
    const days = man.day || []
    this.lmDay = {}
    this.lmMats = {}
    await Promise.all(
      man.atlases.flatMap((a) => [
        get(`${a.name}${suf(a)}.webp`).then((t) => (this.lm[a.name] = t)),
        ...days.slice(0, 1).map((d) => get(`${a.name}_${d}${daySuf}.webp`).then((t) => ((this.lmDay[a.name] ||= {})[d] = t))),
      ]),
    )
    this.lmLater = () =>
      Promise.all(
        man.atlases.flatMap((a) =>
          days.slice(1).map((d) =>
            get(`${a.name}_${d}${daySuf}.webp`).then((t) => {
              this.lmDay[a.name][d] = t
              for (const m of this.lmMats[a.name] || []) if (m.userData.lm?.lmDayB) m.userData.lm.lmDayB.value = t
            }),
          ),
        ),
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
    this.lmLater?.().catch((e) => console.warn('GI do pôr do sol indisponível', e))
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
      o.receiveShadow = !ex.glass && !ex.emissive && !ex.water // a sombra cai no fundo da piscina, não na superfície
      // cadeiras de jantar/gourmet: encostos finos e curvos ficaram com poucos texels no atlas (manchas escuras);
      // usam a luz constante de interior até o próximo bake dar a elas mais resolução
      const noLm = /^cad_(\d|g_)/.test(ex.name || o.name)
      const atlas = noLm ? null : ex.lm_atlas
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
          // cortinas não têm atlas nem cômodo: são internas (sem isso recebem céu pleno e brilham à noite)
          const indoor = !!ex.curtain || (!!ex.room && !['deck', 'gourmet', 'varanda', 'jardim', 'acesso'].includes(ex.room))
          const covered = noLm && !indoor // gourmet: sob a cobertura, céu parcial
          patchLightmap(nm, {
            tex: atlas ? this.lm[atlas] : null,
            dayA: atlas ? this.lmDay[atlas]?.day : null,
            dayB: atlas ? this.lmDay[atlas]?.sunset : null,
            dayMax: man.day_max,
            skyMax: man.sky_max,
            nightMax: man.night_max,
            constOcc: indoor ? 0.28 : covered ? 0.5 : 1,
            constNight: indoor ? 0x3a2a1c : 0x000000,
          })
        }
        if (atlas && nm.userData.lm) (this.lmMats[atlas] ||= []).push(nm)
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
