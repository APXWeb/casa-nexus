// Construção arquitetônica controlada pela rolagem: planta → fundação → estrutura → vedações → acabamentos → paisagismo.
import * as THREE from 'three'
import { B } from './stage.js'

const ease = (t) => t * t * (3 - 2 * t)
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const seg = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)))

// janelas de progresso [início, fim] de cada etapa e a legenda exibida
export const STEPS = [
  { key: 'plan', a: 0.0, b: 0.1, label: 'Implantação', text: 'A planta é traçada sobre o terreno de 32 × 52 m.' },
  { key: 'foundation', a: 0.1, b: 0.18, label: 'Fundação', text: 'Radier e vigas baldrame sob todas as paredes.' },
  { key: 'columns', a: 0.18, b: 0.26, label: 'Pilares', text: 'A estrutura de concreto sobe nos dois pavimentos.' },
  { key: 'beams', a: 0.26, b: 0.32, label: 'Vigas', text: 'Vigas embutidas na espessura das lajes.' },
  { key: 'slabs', a: 0.32, b: 0.39, label: 'Lajes', text: 'Laje com balanço de 1,2 m sobre a entrada e marquise de 2 m.' },
  { key: 'stairs', a: 0.39, b: 0.44, label: 'Escada', text: 'Degraus em balanço ancorados na parede de pedra.' },
  { key: 'walls', a: 0.44, b: 0.55, label: 'Paredes', text: 'Vedações externas e internas, pavimento por pavimento.' },
  { key: 'frames', a: 0.55, b: 0.61, label: 'Esquadrias', text: 'Caixilhos em alumínio preto, portas e brises de madeira.' },
  { key: 'glass', a: 0.61, b: 0.66, label: 'Vidros', text: 'Panos de vidro do piso ao teto voltados para o norte.' },
  { key: 'roof', a: 0.66, b: 0.71, label: 'Cobertura', text: 'Laje de cobertura com beiral de madeira.' },
  { key: 'floors', a: 0.71, b: 0.77, label: 'Pisos e revestimentos', text: 'Pedra natural, madeira e terrazzo nos banheiros.' },
  { key: 'furniture', a: 0.77, b: 0.85, label: 'Mobiliário', text: 'Marcenaria, estofados e peças assinadas por ambiente.' },
  { key: 'lights', a: 0.85, b: 0.9, label: 'Iluminação', text: 'Luz embutida, fitas de LED e balizadores.' },
  { key: 'landscape', a: 0.9, b: 1.0, label: 'Paisagismo', text: 'Piscina, deck, jardins e árvores de diferentes portes.' },
]

export class Construction {
  constructor(stage) {
    this.stage = stage
    const h = stage.house
    this.h = h
    this.meshes = h.meshes
    for (const m of this.meshes) {
      m.userData.basePos = m.position.clone()
      m.userData.baseCast = m.castShadow
    }
    this.by = (k) => h.byStage[k] || []
    this.lines = this.buildPlanLines(stage.plan)
    stage.scene.add(this.lines)
    this.active = false
    this.p = 1
  }

  buildPlanLines(plan) {
    const pts = []
    const y = 0.04
    const push = (x0, z0, x1, z1) => pts.push(x0, y, z0, x1, y, z1)
    for (const w of plan.walls) {
      if (w.floor !== 0) continue
      const [ax, ay] = w.a,
        [bx, by] = w.b,
        t = w.t / 2
      const horiz = Math.abs(ay - by) < 1e-6
      // trechos sem aberturas
      const a0 = horiz ? Math.min(ax, bx) - t : Math.min(ay, by) - t
      const a1 = horiz ? Math.max(ax, bx) + t : Math.max(ay, by) + t
      const cuts = w.open.map((o) => [o[0], o[1]]).sort((p, q) => p[0] - q[0])
      let cur = a0
      const spans = []
      for (const [c0, c1] of cuts) {
        if (c0 > cur) spans.push([cur, c0])
        cur = Math.max(cur, c1)
      }
      if (cur < a1) spans.push([cur, a1])
      for (const [s0, s1] of spans) {
        for (const off of [-t, t]) {
          if (horiz) push(s0, -(ay + off), s1, -(ay + off))
          else push(ax + off, -s0, ax + off, -s1)
        }
        if (horiz) {
          push(s0, -(ay - t), s0, -(ay + t))
          push(s1, -(ay - t), s1, -(ay + t))
        } else {
          push(ax - t, -s0, ax + t, -s0)
          push(ax - t, -s1, ax + t, -s1)
        }
      }
    }
    // piscina e limites do lote
    const P = plan.pool,
      L = plan.lot
    const rect = (x0, y0, x1, y1) => {
      push(x0, -y0, x1, -y0)
      push(x1, -y0, x1, -y1)
      push(x1, -y1, x0, -y1)
      push(x0, -y1, x0, -y0)
    }
    rect(P.x0, P.y0, P.x1, P.y1)
    rect(L.x0, L.y0, L.x1, L.y1)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    const m = new THREE.LineBasicMaterial({ color: 0xf4efe4, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false })
    const l = new THREE.LineSegments(g, m)
    l.renderOrder = 5
    l.userData.count = pts.length / 3
    l.visible = false
    return l
  }

  /** Liga/desliga o modo construção (fora dele, casa completa). */
  setActive(on) {
    if (on === this.active) return
    this.active = on
    if (!on) this.reset()
  }

  reset() {
    for (const m of this.meshes) {
      m.position.copy(m.userData.basePos)
      m.userData.clipY = undefined
      m.userData.fade = undefined
      m.userData.glow = undefined
      m.castShadow = m.userData.baseCast
      m.visible = !m.userData.temp
    }
    this.lines.visible = false
    this.stage.veg.setGrow(1)
    this.stage.shrubs.visible = true
  }

  /** Aplica o estado da obra para o progresso p ∈ [0,1]. */
  set(p) {
    this.p = p
    const s = Object.fromEntries(STEPS.map((st) => [st.key, seg(p, st.a, st.b)]))
    // linhas da planta: desenhadas e depois somem quando as paredes sobem
    const lm = this.lines
    lm.visible = p < 0.6
    lm.geometry.setDrawRange(0, Math.floor(lm.userData.count * ease(s.plan) / 2) * 2)
    lm.material.opacity = 0.9 * (1 - seg(p, 0.44, 0.56))
    const show = (arr, on) => arr.forEach((m) => (m.visible = on))
    const clip = (arr, y0, y1, t) =>
      arr.forEach((m) => {
        m.visible = t > 0
        m.userData.clipY = t >= 1 ? undefined : y0 + (y1 - y0) * t
        m.userData.glow = t > 0 && t < 1 ? 1 : 0
        m.castShadow = t >= 1 && m.userData.baseCast
      })
    const drop = (arr, h, t, stagger = 0) =>
      arr.forEach((m, i) => {
        const k = stagger ? seg(t, (i / arr.length) * stagger, (i / arr.length) * stagger + (1 - stagger)) : t
        m.visible = k > 0
        m.position.copy(m.userData.basePos)
        m.position.y += h * (1 - easeOut(k))
        m.userData.fade = k >= 1 ? undefined : Math.max(0.02, k)
        m.castShadow = k >= 1 && m.userData.baseCast
      })
    // fundação (oculta depois que os pisos cobrem)
    const found = this.by('foundation')
    drop(found, -1.2, s.foundation)
    if (s.floors >= 1) show(found, false)
    // pilares (embutidos: somem quando as paredes fecham)
    const cols = this.by('columns')
    clip(cols, -0.05, 6.4, s.columns)
    cols.forEach((m) => {
      if (m.userData.temp && s.walls >= 1) m.visible = false
    })
    const beams = this.by('beams')
    drop(beams, 3.5, s.beams)
    if (s.slabs >= 1) show(beams, false)
    drop(this.by('slabs'), 4.5, s.slabs)
    clip(this.by('stairs'), -0.05, 4.7, s.stairs)
    // paredes: térreo e depois superior
    const walls = this.by('walls')
    walls.forEach((m) => {
      const up = m.userData.floor === 1
      const t = up ? seg(s.walls, 0.45, 1) : seg(s.walls, 0, 0.55)
      clip([m], up ? 3.45 : -0.05, up ? 6.32 : 3.22, t)
    })
    clip([...this.by('frames'), ...this.by('doors')], -0.05, 6.5, s.frames)
    clip(this.by('glass'), -0.05, 6.5, s.glass)
    drop(this.by('roof'), 5, s.roof)
    drop(this.by('floors'), 0.6, s.floors, 0.5)
    drop(this.by('furniture'), 1.6, s.furniture, 0.75)
    this.by('lights').forEach((m) => {
      const k = m.userData.room ? Math.max(s.furniture, 0) : s.lights
      m.visible = k > 0
      m.userData.fade = k >= 1 ? undefined : Math.max(0.02, k)
    })
    this.flash = s.lights > 0 && s.lights < 1 ? Math.sin(s.lights * Math.PI) : 0
    // paisagismo: elementos do lote sobem do chão; árvores crescem
    drop(this.by('landscape'), -0.8, s.landscape, 0.4)
    this.stage.veg.setGrow(ease(seg(s.landscape, 0.15, 1)))
    this.stage.shrubs.visible = s.landscape > 0.25
    this.stage.R.shadowDirty = true
    this.stage.R.invalidate(2)
    return STEPS.findLast((st) => p >= st.a) || STEPS[0]
  }
}

/** Câmera da construção: da vista superior à perspectiva arquitetônica baixa (em coordenadas do Blender). */
export const CONSTRUCTION_SHOTS = [
  { p: 0.0, pos: [1.5, -16.5, 50], tgt: [0, -8.5, 0] },
  { p: 0.12, pos: [6, -32, 46], tgt: [0, -8, 0] },
  { p: 0.3, pos: [26, -34, 30], tgt: [0, -8, 2] },
  { p: 0.5, pos: [32, -14, 20], tgt: [0, -9, 2.5] },
  { p: 0.7, pos: [24, 14, 16], tgt: [0, -8, 2.5] },
  { p: 0.85, pos: [-14, 22, 9], tgt: [0, -7, 2.5] },
  { p: 1.0, pos: [-26, 6, 4.5], tgt: [0, -6, 2.8] },
].map((k) => ({ p: k.p, pos: B(...k.pos), tgt: B(...k.tgt) }))
