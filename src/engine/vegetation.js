// Vegetação: árvores e arbustos como impostores hemi-octaédricos (renderizados do Cycles a partir de
// modelos de fotogrametria CC0) — iluminação PBR real (IBL + sol + sombras) com normais por pixel.
import * as THREE from 'three'
import { terrainHeight } from './terrain.js'

const BASE = import.meta.env.BASE_URL + 'assets/'

const VERT_DECL = /* glsl */ `
uniform float uFrames; uniform float uRadius; uniform float uCenterY; uniform float uGrow;
varying vec2 vQuv; varying vec2 vF0; varying vec2 vFr; varying mat3 vRot;
`
// calcula o quad voltado para a câmera e os quadros do atlas a mesclar
const VERT_BODY = /* glsl */ `
  vec3 instPos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float isc0 = length(instanceMatrix[0].xyz);
  mat3 rotM = mat3(instanceMatrix) / isc0;
  float isc = isc0 * max(uGrow, 0.0001);
  vRot = rotM;
  vec3 ctr = instPos + vec3(0.0, uCenterY * isc, 0.0);
  vec3 toCam = cameraPosition - ctr;
  vec3 dL = transpose(rotM) * toCam;
  dL.y = max(dL.y, 0.02);
  dL = normalize(dL);
  vec3 a = dL / (abs(dL.x) + abs(dL.y) + abs(dL.z));
  vec2 pe = vec2(a.x + a.z, a.x - a.z) * 0.5 + 0.5;
  vec2 g = clamp(pe, 0.0, 1.0) * (uFrames - 1.0);
  vF0 = min(floor(g), vec2(uFrames - 2.0));
  vFr = g - vF0;
  vec3 rL = abs(dL.y) > 0.995 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), dL));
  vec3 uL = cross(dL, rL);
  vec3 wp = ctr + rotM * (rL * position.x + uL * position.y) * (2.0 * uRadius * isc);
  vQuv = position.xy + 0.5;
`
const FRAG_DECL = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tNormal; uniform float uFrames;
varying vec2 vQuv; varying vec2 vF0; varying vec2 vFr; varying mat3 vRot;
vec2 frUv(vec2 f) { return (f + clamp(vQuv, 0.004, 0.996)) / uFrames; }
vec4 impo(sampler2D t) {
  vec4 a = texture2D(t, frUv(vF0));
  vec4 b = texture2D(t, frUv(vF0 + vec2(1.0, 0.0)));
  vec4 c = texture2D(t, frUv(vF0 + vec2(0.0, 1.0)));
  vec4 d = texture2D(t, frUv(vF0 + vec2(1.0, 1.0)));
  return mix(mix(a, b, vFr.x), mix(c, d, vFr.x), vFr.y);
}
`

function patchVertex(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_DECL)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY)
    .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(wp, 1.0);\ngl_Position = projectionMatrix * mvPosition;')
    .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(wp, 1.0);')
}

export function impostorMaterial(meta, tColor, tNormal, grow = { value: 1 }) {
  const uniforms = {
    uGrow: grow,
    tColor: { value: tColor },
    tNormal: { value: tNormal },
    uFrames: { value: meta.frames },
    uRadius: { value: meta.radius },
    uCenterY: { value: meta.center[1] },
  }
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.9 })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    patchVertex(sh)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace(
        '#include <map_fragment>',
        `vec4 ic = impo(tColor);
         if (ic.a < 0.45) discard;
         diffuseColor.rgb *= ic.rgb / max(ic.a, 0.001) * 0.92;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 inrm = impo(tNormal).rgb * 2.0 - 1.0;
         normal = normalize((viewMatrix * vec4(normalize(vRot * inrm), 0.0)).xyz);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        // transmissão de luz nas folhas (contraluz)
        `#include <lights_fragment_end>
         #if NUM_DIR_LIGHTS > 0
           float bl = pow(clamp(dot(normalize(vViewPosition), -directionalLights[0].direction), 0.0, 1.0), 3.0);
           reflectedLight.directDiffuse += directionalLights[0].color * diffuseColor.rgb * bl * 0.35;
         #endif`,
      )
  }
  m.customProgramCacheKey = () => 'impostor'
  m.userData.uniforms = uniforms
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    patchVertex(sh)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <alphatest_fragment>', 'if (impo(tColor).a < 0.5) discard;')
  }
  depth.customProgramCacheKey = () => 'impostor_depth'
  return { m, depth }
}

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export class Vegetation {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.name = 'vegetacao'
    scene.add(this.group)
    this.species = {}
    this.lotGrow = { value: 1 }
  }

  /** Crescimento das árvores do lote (0–1), usado na construção. */
  setGrow(v) {
    this.lotGrow.value = v
    for (const sp of Object.values(this.species)) if (sp.lotMesh) sp.lotMesh.visible = v > 0.001 && !sp.real
    if (this.real) {
      this.real.visible = v > 0.001
      // a árvore cresce a partir do chão: escala de cada instância × crescimento
      const g = Math.max(0.001, v)
      for (const t of this.realItems) {
        this._m4.compose(t.pos, t.q, this._sv.setScalar(t.s * g))
        for (const im of t.meshes) im.setMatrixAt(t.i, this._m5.multiplyMatrices(this._m4, im.userData.base))
      }
      for (const im of this.real.children) im.instanceMatrix.needsUpdate = true
    }
  }

  /**
   * Árvores do lote em malha real (vista próxima), no lugar dos impostores.
   * A malha é normalizada para a mesma altura do impostor, então posição, escala e rotação coincidem.
   */
  async loadRealTrees(loader, files = { jacaranda: 'tree_jacaranda', island: 'tree_island' }) {
    this.real = new THREE.Group()
    this.real.name = 'arvores_lote'
    this.realItems = []
    this._m4 = new THREE.Matrix4()
    this._m5 = new THREE.Matrix4()
    this._sv = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    await Promise.all(
      Object.entries(files).map(async ([k, file]) => {
        const sp = this.species[k]
        const items = sp?.items.filter((it) => it.lot)
        if (!items?.length) return
        const gltf = await loader.loadAsync(BASE + `models/${file}.glb`)
        gltf.scene.updateMatrixWorld(true)
        // normaliza: centro no chão, altura igual à do impostor. A geometria vem quantizada (meshopt),
        // então não é alterada: a normalização entra na matriz de cada instância.
        const box = new THREE.Box3().setFromObject(gltf.scene)
        const c = box.getCenter(new THREE.Vector3())
        const k2 = sp.meta.height / (box.max.y - box.min.y)
        const norm = new THREE.Matrix4().makeScale(k2, k2, k2).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z))
        const meshes = []
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return
          const m = o.material
          if (m.map) {
            m.alphaTest = 0.5
            m.transparent = false
            m.side = THREE.DoubleSide
            m.map.anisotropy = 8
          }
          m.envMapIntensity = 0.8
          const im = new THREE.InstancedMesh(o.geometry, m, items.length)
          im.userData.base = norm.clone().multiply(o.matrixWorld)
          im.castShadow = true
          im.receiveShadow = true
          im.frustumCulled = false
          im.name = 'arvore_' + k
          this.real.add(im)
          meshes.push(im)
        })
        items.forEach((it, i) => {
          const t = { pos: new THREE.Vector3(it.x, it.y, it.z), q: new THREE.Quaternion().setFromAxisAngle(up, it.r), s: it.s, i, meshes }
          this.realItems.push(t)
        })
        sp.real = true
        if (sp.lotMesh) sp.lotMesh.visible = false
      }),
    )
    this.group.add(this.real)
    this.setGrow(this.lotGrow.value)
  }

  async load(names, px = 2048) {
    const tl = new THREE.TextureLoader()
    await Promise.all(
      names.map(async (n) => {
        const meta = await (await fetch(BASE + `veg/${n}.json`)).json()
        const sfx = px < 2048 ? '_1k' : ''
        const [c, nm] = await Promise.all([tl.loadAsync(BASE + `veg/${n}_color${sfx}.webp`), tl.loadAsync(BASE + `veg/${n}_normal${sfx}.webp`)])
        c.colorSpace = THREE.SRGBColorSpace
        nm.colorSpace = THREE.NoColorSpace
        for (const t of [c, nm]) {
          t.anisotropy = 4
          t.generateMipmaps = true
        }
        this.species[n] = { meta, tex: [c, nm], ...impostorMaterial(meta, c, nm), lotMat: impostorMaterial(meta, c, nm, this.lotGrow), items: [] }
      }),
    )
  }

  add(kind, x, y, z, rotY, scale, lot = false) {
    const sp = this.species[kind]
    if (!sp) return
    sp.items.push({ x, y, z, r: rotY, s: scale, lot })
  }

  /** Plantio do lote (vegetation.json, coordenadas do Blender) + mata ao redor. */
  plant(lotList, density = 1) {
    const map = { jacaranda_tree: 'jacaranda', island_tree_02: 'island', searsia_lucida: 'searsia' }
    for (const v of lotList) {
      const k = map[v.kind]
      if (!k) continue
      const s = v.s * (k === 'searsia' ? 0.9 : 1)
      this.add(k, v.x, 0, -v.y, THREE.MathUtils.degToRad(v.r), s, true)
    }
    // mata ao redor: anéis com densidade decrescente, fora do lote e da rua
    const rand = rng(42)
    const n = Math.round(2600 * density)
    for (let i = 0; i < n; i++) {
      const r = 34 + Math.pow(rand(), 1.6) * 520
      const a = rand() * Math.PI * 2
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r
      if (Math.abs(x) < 19 && z > -30 && z < 30) continue
      if (z > 27 && z < 41) continue // rua e calçada
      // campo aberto em frente à casa (vizinhança de jardins): mata rala para a câmera de abertura enxergar o lote
      if (z > 24 && z < 140 && x > -40 && x < 110 && rand() > 0.12) continue
      const t = rand()
      const kind = t < 0.42 ? 'jacaranda' : t < 0.8 ? 'island' : 'searsia'
      const s = kind === 'jacaranda' ? 0.7 + rand() * 0.6 : kind === 'island' ? 1.3 + rand() * 1.4 : 1.2 + rand() * 1.2
      this.add(kind, x, terrainHeight(x, z), z, rand() * Math.PI * 2, s)
    }
  }

  build() {
    const geo = new THREE.PlaneGeometry(1, 1)
    const m4 = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      sv = new THREE.Vector3(),
      pv = new THREE.Vector3(),
      col = new THREE.Color()
    const up = new THREE.Vector3(0, 1, 0)
    const rand = rng(7)
    for (const [k, sp] of Object.entries(this.species)) {
      for (const lot of [false, true]) {
        const items = sp.items.filter((it) => it.lot === lot)
        if (!items.length) continue
        const mat = lot ? sp.lotMat : { m: sp.m, depth: sp.depth }
        const im = new THREE.InstancedMesh(geo, mat.m, items.length)
        im.customDepthMaterial = mat.depth
        im.castShadow = true
        im.receiveShadow = true
        im.frustumCulled = false
        items.forEach((it, i) => {
          q.setFromAxisAngle(up, it.r)
          m4.compose(pv.set(it.x, it.y, it.z), q, sv.setScalar(it.s))
          im.setMatrixAt(i, m4)
          const v = 0.86 + rand() * 0.22
          col.setRGB(v * (0.95 + rand() * 0.1), v, v * (0.9 + rand() * 0.12))
          im.setColorAt(i, col)
        })
        im.name = 'impostor_' + k + (lot ? '_lote' : '')
        this.group.add(im)
        if (lot) sp.lotMesh = im
        else sp.mesh = im
      }
    }
  }
}

/** Arbustos, samambaias e rochas como malhas reais instanciadas (veg.glb). */
export async function plantMeshes(scene, loader, lotList, density = 1) {
  const gltf = await loader.loadAsync(BASE + 'models/veg.glb')
  const protos = {}
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    const fam = o.name.replace(/_[a-z]$/, '').replace(/_\d+$/, (m) => m) // shrub_02_a → shrub_02
    const key = o.name.match(/^(shrub_0\d|fern_02|boulder_01)/)?.[1] || fam
    ;(protos[key] ||= []).push(o)
    const m = o.material
    if (m.map) {
      m.alphaTest = 0.5
      m.transparent = false
      m.side = THREE.DoubleSide
      m.map.anisotropy = 4
    }
  })
  const alias = { shrub_01: 'shrub_02' }
  const buckets = new Map()
  const rand = rng(99)
  for (const v of lotList) {
    const fam = alias[v.kind] || v.kind
    const list = protos[fam]
    if (!list) continue
    if (rand() > density && fam !== 'boulder_01') continue
    const proto = list[Math.floor(rand() * list.length)]
    if (!buckets.has(proto)) buckets.set(proto, [])
    buckets.get(proto).push(v)
  }
  const group = new THREE.Group()
  group.name = 'vegetacao_baixa'
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0)
  for (const [proto, items] of buckets) {
    const im = new THREE.InstancedMesh(proto.geometry, proto.material, items.length)
    items.forEach((v, i) => {
      q.setFromAxisAngle(up, THREE.MathUtils.degToRad(v.r))
      m4.compose(new THREE.Vector3(v.x, -0.03, -v.y), q, new THREE.Vector3().setScalar(v.s))
      im.setMatrixAt(i, m4)
    })
    im.castShadow = true
    im.receiveShadow = true
    im.computeBoundingSphere()
    group.add(im)
  }
  scene.add(group)
  return group
}
