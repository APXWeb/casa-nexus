// Renderizador: perfis de qualidade, pós-processamento leve, renderização sob demanda e métricas reais.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

// gradação final (em sRGB): saturação, curva suave e vinheta discreta
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.1 }, contrast: { value: 1.06 }, vignette: { value: 0.18 }, warmth: { value: 0.0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, contrast, vignette, warmth; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 x = c.rgb;
      float l = dot(x, vec3(0.2126, 0.7152, 0.0722));
      x = mix(vec3(l), x, sat);
      x = clamp((x - 0.5) * contrast + 0.5, 0.0, 1.0);
      x = mix(x, x * x * (3.0 - 2.0 * x), 0.18);
      x += vec3(0.02, 0.0, -0.02) * warmth;
      vec2 d = vUv - 0.5; x *= 1.0 - vignette * dot(d, d) * 2.2;
      // dithering triangular de ±1/255: elimina o banding do céu e dos interiores escuros em 8 bits
      vec2 q = gl_FragCoord.xy;
      float n1 = fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
      float n2 = fract(sin(dot(q + 17.0, vec2(39.3468, 11.1351))) * 24634.6345);
      x += (n1 + n2 - 1.0) / 255.0;
      gl_FragColor = vec4(x, c.a); }`,
}

export const PROFILES = {
  // Ultra: superamostragem 1,5× (limitada a ~8,3 MP, para monitores 4K), MSAA 8×, sombra 8192 e lightmaps 4096
  ultra: { label: 'Ultra', dpr: 3, ss: 1.5, maxPixels: 8.3e6, scale: 1, msaa: 8, smaa: false, shadow: 8192, tex: 2048, lm: 4096, bloom: true, bg: 8192, veg: 1.5, shadowRadius: 2.5, treeMesh: true, hedgeMesh: true, grass: { density: 160, radius: 24 } },
  high: { label: 'Alta qualidade', dpr: 2, scale: 1, msaa: 4, smaa: false, shadow: 4096, tex: 2048, lm: 2048, bloom: true, bg: 8192, veg: 1, shadowRadius: 2.5, treeMesh: true, grass: { density: 100, radius: 20 } },
  balanced: { label: 'Equilibrado', dpr: 1.5, scale: 1, msaa: 4, smaa: false, shadow: 2048, tex: 1024, lm: 2048, bloom: false, bg: 4096, veg: 0.7, shadowRadius: 2 },
  performance: { label: 'Desempenho', dpr: 1, scale: 0.8, msaa: 0, smaa: true, shadow: 1024, tex: 512, lm: 1024, bloom: false, bg: 2048, veg: 0.35, shadowRadius: 1.5 },
}

/** Sugere um perfil a partir do aparelho (refinado depois pela medição de quadros). */
export function detectProfile() {
  const q = new URLSearchParams(location.search).get('q')
  if (q && PROFILES[q]) return q
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent)
  if (mobile) return 'performance'
  let gpu = ''
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''
  } catch {}
  if (/RTX (30[6-9]0|40[6-9]0|50[6-9]0)|RX [79][0-9]{3}|Apple M[1-9] (Max|Ultra)/i.test(gpu)) return 'ultra'
  if (/RTX|Radeon RX [67]|RX 7|Apple M[1-9] (Pro|Max|Ultra)|Arc A7/i.test(gpu)) return 'high'
  if (/Intel|UHD|Iris|Mali|Adreno|PowerVR/i.test(gpu)) return 'performance'
  return 'balanced'
}

export class Renderer {
  constructor(canvas, profileName) {
    this.canvas = canvas
    this.profileName = profileName
    this.p = PROFILES[profileName]
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }))
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.AgXToneMapping
    r.toneMappingExposure = 1
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    r.shadowMap.autoUpdate = false
    r.info.autoReset = false // as estatísticas somam todas as passadas do quadro
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 6000)
    this.dirty = 2
    this.shadowDirty = true
    this.frames = []
    this.listeners = new Set()
    this.lastT = performance.now()
    this.build()
    addEventListener('resize', () => this.resize())
    this.resize()
  }

  build() {
    const p = this.p
    this.composer?.dispose()
    const size = new THREE.Vector2()
    this.renderer.getSize(size)
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(p.msaa, this.renderer.capabilities.maxSamples || 4) })
    this.composer = new EffectComposer(this.renderer, rt)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    if (p.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.35, 2.2)
      this.composer.addPass(this.bloom)
    } else this.bloom = null
    this.composer.addPass(new OutputPass())
    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.grade)
    if (p.smaa) this.composer.addPass(new SMAAPass())
    this.resize()
  }

  setProfile(name) {
    this.profileName = name
    this.p = PROFILES[name]
    // sombra do sol acompanha o perfil (antes só o composer mudava)
    this.scene.traverse((o) => {
      if (o.isDirectionalLight && o.castShadow && o.shadow.mapSize.x !== this.p.shadow) {
        o.shadow.mapSize.set(this.p.shadow, this.p.shadow)
        o.shadow.radius = this.p.shadowRadius
        o.shadow.map?.dispose()
        o.shadow.map = null
      }
    })
    this.shadowDirty = true
    this.build()
    this.listeners.forEach((f) => f('profile', name))
    this.invalidate(3)
  }

  resize() {
    const w = innerWidth,
      h = innerHeight
    let dpr = Math.min((devicePixelRatio || 1) * (this.p.ss || 1), this.p.dpr) * this.p.scale
    if (this.p.maxPixels) dpr = Math.min(dpr, Math.sqrt(this.p.maxPixels / (w * h)))
    dpr = Math.max(dpr, 0.5)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.composer?.setPixelRatio(dpr)
    this.composer?.setSize(w, h)
    this.camera.aspect = w / h
    // retrato (celular): campo de visão mais aberto para a casa caber no enquadramento
    this.camera.fov = w / h < 0.8 ? 64 : w / h < 1.2 ? 52 : 42
    this.camera.updateProjectionMatrix()
    this.invalidate(2)
  }

  invalidate(n = 1) {
    this.dirty = Math.max(this.dirty, n)
  }

  /** Executa um quadro se algo mudou. Retorna true quando renderizou. */
  frame(now, active) {
    const dt = now - this.lastT
    this.lastT = now
    if (!active && this.dirty <= 0) {
      this.wasIdle = true
      return false
    }
    if (!this.wasIdle) this.frames.push(dt)
    this.wasIdle = false
    if (this.frames.length > 600) this.frames.shift()
    if (this.shadowDirty) {
      this.renderer.shadowMap.needsUpdate = true
      this.shadowDirty = false
    }
    this.renderer.info.reset()
    const q = this.gpuBegin()
    this.composer.render()
    this.gpuEnd(q)
    this.lastInfo = { calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles }
    this.dirty--
    return true
  }

  /** Tempo de GPU por quadro (EXT_disjoint_timer_query_webgl2): mede o custo real mesmo com o vsync limitando o rAF. */
  gpuBegin() {
    const gl = this.renderer.getContext()
    if (this.tq === undefined) {
      this.tq = gl.getExtension('EXT_disjoint_timer_query_webgl2')
      this.tqPending = []
      this.gpuMs = []
    }
    if (!this.tq || this.tqPending.length > 6) return null
    const q = gl.createQuery()
    gl.beginQuery(this.tq.TIME_ELAPSED_EXT, q)
    return q
  }

  gpuEnd(q) {
    const gl = this.renderer.getContext()
    if (q) {
      gl.endQuery(this.tq.TIME_ELAPSED_EXT)
      this.tqPending.push(q)
    }
    if (!this.tq) return
    const disjoint = gl.getParameter(this.tq.GPU_DISJOINT_EXT)
    while (this.tqPending.length && gl.getQueryParameter(this.tqPending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const r = this.tqPending.shift()
      if (!disjoint) this.gpuMs.push(gl.getQueryParameter(r, gl.QUERY_RESULT) / 1e6)
      gl.deleteQuery(r)
    }
    if (this.gpuMs.length > 2000) this.gpuMs.splice(0, 1000)
  }

  gpuStats(n = 2000) {
    const f = (this.gpuMs || []).slice(-n)
    if (!f.length) return null
    const s = [...f].sort((a, b) => a - b)
    return { n: f.length, avg: f.reduce((a, b) => a + b, 0) / f.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], worst: s[s.length - 1] }
  }

  /** Estatísticas dos últimos N quadros renderizados em sequência. */
  stats(n = 120) {
    const f = this.frames.slice(-n).filter((x) => x < 250)
    if (!f.length) return null
    const s = [...f].sort((a, b) => a - b)
    const avg = f.reduce((a, b) => a + b, 0) / f.length
    const info = this.renderer.info
    return {
      fps: 1000 / avg,
      avg,
      p95: s[Math.floor(s.length * 0.95)],
      worst: s[s.length - 1],
      calls: this.lastInfo?.calls ?? info.render.calls,
      tris: this.lastInfo?.tris ?? info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    }
  }
}
