// Sondas de reflexo internas: um cubemap estático por ambiente (CubeCamera HalfFloat), filtrado pelo PMREM e reempacotado
// num atlas octaédrico único (todas as mips de todas as sondas numa textura: o shader usa só 1 texture unit a mais).
// O shader (materials.js, pbRadiance) faz box projection contra o AABB de cada ambiente e cai para o céu fora das caixas.
import * as THREE from 'three'
import { PB, PB_MAX, shared } from './materials.js'

// ambientes com sonda (ids do plan.json); closets, lavabo e garagem ficam com o céu atenuado de antes
const ROOMS = ['cozinha', 'jantar', 'estar', 'hall', 'tv', 'galeria', 'suite_master', 'banho_master', 'suite_2', 'banho_2', 'escritorio']
const EYE = 1.4 // altura da captura acima do piso
const CUBE = 256 // lado da face capturada (o PMREM não aceita menos de 256)

const OCT_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
// decodificação octaédrica (inversa de pbOct em materials.js): centro = zênite, cantos = nadir
const OCT_FS = /* glsl */ `
uniform samplerCube env; uniform float lod; varying vec2 vUv;
vec3 octDec(vec2 uv){
  vec2 p = uv * 2.0 - 1.0;
  vec3 d = vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y);
  if (d.y < 0.0) d.xz = (1.0 - abs(d.zx)) * vec2(d.x >= 0.0 ? 1.0 : -1.0, d.z >= 0.0 ? 1.0 : -1.0);
  return normalize(d);
}
void main(){ gl_FragColor = vec4(textureLod(env, octDec(vUv), lod).rgb, 1.0); }`

/**
 * Cria as sondas a partir do plan.json. `tile` = lado da mip 0 no atlas (512 ≈ resolução angular de um cubo de 256).
 * Retorna { recapture(), setEnabled(on), info() }.
 */
export function createProbes({ renderer, scene, house, plan, world, R, tile = 512, lampDay = 0.5 }) {
  const levels = plan.levels
  const probes = plan.rooms
    .filter((r) => ROOMS.includes(r.id))
    .slice(0, PB_MAX)
    .map((r) => {
      const [x0, y0, x1, y1] = r.rect
      const lv = levels[r.floor]
      // Blender (x, y, z) → cena (x, z, -y)
      const min = new THREE.Vector3(x0, lv.floor, -y1)
      const max = new THREE.Vector3(x1, lv.ceil, -y0)
      const pos = new THREE.Vector3((x0 + x1) / 2, lv.floor + EYE, -(y0 + y1) / 2)
      return { id: r.id, min, max, pos }
    })
  const n = probes.length
  probes.forEach((p, i) => {
    PB.uPbMin.value[i].copy(p.min)
    PB.uPbMax.value[i].copy(p.max)
    PB.uPbPos.value[i].copy(p.pos)
  })
  PB.uPbCount.value = n

  // captura e filtragem (gerador próprio: não realoca o alvo de origem do gerador do céu, que tem outro tamanho)
  const cubeRT = new THREE.WebGLCubeRenderTarget(CUBE, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
  const cubeCam = new THREE.CubeCamera(0.05, 400, cubeRT)
  const pmrem = new THREE.PMREMGenerator(renderer)
  let pmremRT = null
  const maxLod = Math.log2(CUBE) - 3 // mesmas mips do PMREM (LOD_MIN = 3)

  // atlas: uma coluna de largura `tile` por sonda; mips empilhadas (tile, tile/2, ...) → altura 2·tile
  const atlas = new THREE.WebGLRenderTarget(tile * n, tile * 2, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
  atlas.texture.name = 'probes_atlas'
  PB.uPbAtlas.value = atlas.texture
  PB.uPbAtlasInfo.value.set(tile, maxLod, 1 / atlas.width, 1 / atlas.height)
  const octMat = new THREE.ShaderMaterial({ uniforms: { env: { value: null }, lod: { value: 0 } }, vertexShader: OCT_VS, fragmentShader: OCT_FS, depthTest: false, depthWrite: false, blending: THREE.NoBlending })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), octMat)
  quad.frustumCulled = false
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // estado "casa completa": nenhuma peça recortada, dissolvida ou deslocada (construção/desmontagem em curso)
  const complete = () => {
    for (const m of house.meshes) {
      const d = m.userData
      if (d.clipY !== undefined || (d.fade !== undefined && d.fade < 0.999)) return false
      if (d.basePos && !m.position.equals(d.basePos)) return false
    }
    return true
  }

  let enabled = true
  let ready = false
  let capturing = false
  let stale = false // houve captura com a casa incompleta (sombras do sol podiam estar parciais)
  let wasComplete = true
  const ms = []

  function captureOne(i) {
    const p = probes[i]
    // a captura vê a casa como a câmera do tour: luminárias de dia acesas, vidro "visto de dentro", sem sondas (sem recursão)
    const keep = { on: PB.uPbOn.value, inside: shared.uInside.value, lamp: shared.uLamp.value, emit: shared.uEmissive.value }
    PB.uPbOn.value = 0
    shared.uInside.value = 1
    shared.uLamp.value = Math.max(shared.uNight.value, lampDay)
    shared.uEmissive.value = Math.max(world.state.emissive, lampDay)
    house.syncLamps()
    // construção/desmontagem em curso: monta a casa completa só durante a captura
    const full = complete()
    const saved = []
    if (!full) {
      stale = true
      for (const m of house.meshes) {
        const d = m.userData
        saved.push([m, m.position.clone(), m.visible, d.clipY, d.fade, d.glow, m.castShadow])
        if (d.basePos) m.position.copy(d.basePos)
        m.visible = !d.temp
        d.clipY = d.fade = d.glow = undefined
        if (d.baseCast !== undefined) m.castShadow = d.baseCast
      }
      house.root.updateMatrixWorld(true)
      renderer.shadowMap.needsUpdate = true
    } else if (R.shadowDirty) {
      renderer.shadowMap.needsUpdate = true
      R.shadowDirty = false
    }
    const autoClear = renderer.autoClear
    renderer.autoClear = true
    cubeCam.position.copy(p.pos)
    cubeCam.update(renderer, scene)
    pmremRT = pmrem.fromCubemap(cubeRT.texture, pmremRT)
    // reempacota cada mip do PMREM no seu retângulo do atlas
    const prevRT = renderer.getRenderTarget()
    octMat.uniforms.env.value = pmremRT.texture
    atlas.scissorTest = true
    for (let l = 0; l <= maxLod; l++) {
      const T = tile >> l
      const y = 2 * tile * (1 - Math.pow(2, -l))
      atlas.viewport.set(i * tile, y, T, T)
      atlas.scissor.set(i * tile, y, T, T)
      octMat.uniforms.lod.value = l
      renderer.setRenderTarget(atlas)
      renderer.render(quad, quadCam)
    }
    atlas.scissorTest = false
    atlas.viewport.set(0, 0, atlas.width, atlas.height)
    renderer.setRenderTarget(prevRT)
    renderer.autoClear = autoClear
    // restaura o estado da cena
    for (const [m, pos, vis, clipY, fade, glow, cast] of saved) {
      m.position.copy(pos)
      m.visible = vis
      Object.assign(m.userData, { clipY, fade, glow })
      m.castShadow = cast
    }
    if (saved.length) {
      house.root.updateMatrixWorld(true)
      R.shadowDirty = true // o mapa de sombra foi refeito com a casa completa
    }
    PB.uPbOn.value = keep.on
    shared.uInside.value = keep.inside
    shared.uLamp.value = keep.lamp
    shared.uEmissive.value = keep.emit
    house.syncLamps()
  }

  // uma sonda por quadro (carregamento e troca de clima), sem travar a rolagem; as sondas só entram quando todas existem
  let queue = []
  let raf = 0
  function step() {
    raf = 0
    if (!queue.length) return
    capturing = true
    const t = performance.now()
    captureOne(queue.shift())
    capturing = false
    ms.push(performance.now() - t)
    if (!queue.length) ready = true
    R.invalidate(2)
    if (queue.length) raf = requestAnimationFrame(step)
  }
  /** Recaptura todas as sondas (troca de clima, fim da construção/desmontagem), uma por quadro. */
  function recapture() {
    queue = probes.map((_, i) => i)
    if (!raf) raf = requestAnimationFrame(step)
  }

  // liga/desliga as sondas a cada renderização principal conforme o estado da casa
  const prevBR = scene.onBeforeRender
  scene.onBeforeRender = function (...a) {
    prevBR?.apply(this, a)
    if (capturing) return
    const ok = complete()
    if (ok && !wasComplete && stale) {
      stale = false
      recapture()
    }
    wasComplete = ok
    PB.uPbOn.value = enabled && ready && ok ? 1 : 0
  }

  // 1ª captura logo depois que o site abriu (os primeiros quadros já compilaram os programas e subiram as texturas da vista)
  const init = new Promise((res) => setTimeout(res, 600)).then(() => recapture())
  return {
    init,
    probes,
    atlas,
    recapture,
    setEnabled(on) {
      enabled = on
      R.invalidate(3)
    },
    info: () => ({ n, tile, atlas: [atlas.width, atlas.height], mb: +((atlas.width * atlas.height * 8 + CUBE * CUBE * 6 * 8 * 1.34) / 1048576).toFixed(1), ready, enabled, captureMs: ms.map((x) => +x.toFixed(1)) }),
    dispose() {
      cancelAnimationFrame(raf)
      scene.onBeforeRender = prevBR
      PB.uPbOn.value = 0
      PB.uPbCount.value = 0
      cubeRT.dispose()
      pmremRT?.dispose()
      pmrem.dispose()
      atlas.dispose()
      octMat.dispose()
      quad.geometry.dispose()
    },
  }
}
