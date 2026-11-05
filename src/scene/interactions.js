// Detalhes arquitetônicos (marcadores) e personalização em tempo real.
// Os textos descrevem escolhas conceituais da proposta — não especificações técnicas de produtos reais.
import { B } from './stage.js'
import { retexture, shared } from '../engine/materials.js'

export const DETAILS = [
  {
    id: 'pedra', title: 'Pedra natural em filetes', obj: ['walls_0'],
    text: 'Um único plano de pedra atravessa a fachada, o hall e a escada, costurando exterior e interior.',
    at: [1.2, -16.4, 1.7], cam: [4.2, -20.2, 1.75], look: [0.6, -16.2, 1.9],
  },
  {
    id: 'brise', title: 'Brises verticais de madeira', obj: ['brise_sul'],
    text: 'Réguas de madeira filtram o sol da tarde nos dormitórios e dão textura ao volume superior.',
    at: [-5, -17.6, 5.0], cam: [-2.6, -23.5, 3.6], look: [-5, -17.6, 5.0],
  },
  {
    id: 'esquadrias', title: 'Esquadrias de piso a teto', obj: ['frames_0', 'glass_0'],
    text: 'Caixilhos em alumínio preto com folhas de correr: a sala se abre por inteiro para o terraço.',
    at: [5.3, -4, 1.7], cam: [6.6, 1.2, 1.7], look: [5.3, -4.2, 1.6],
  },
  {
    id: 'ilha', title: 'Ilha em mármore negro', obj: ['kitchen_island'],
    text: 'Bloco em cascata com cuba integrada e fita de luz sob o tampo; banquetas em couro conhaque.',
    at: [-8.3, -7.35, 1.0], cam: [-6.6, -5.4, 1.8], look: [-8.4, -7.4, 0.8],
  },
  {
    id: 'forro', title: 'Forro ripado com LED', obj: ['ceiling_slats_estar', 'led_estar'],
    text: 'Réguas de madeira no forro da sala com perfis de luz embutidos, que desenham a direção do jardim.',
    at: [6.5, -7.2, 3.1], cam: [6.5, -9.9, 1.4], look: [6.4, -7, 3.0],
  },
  {
    id: 'banho', title: 'Banheira de imersão', obj: ['banheira'],
    text: 'Banheira sob a janela da fachada sul, com revestimento de mármore do piso ao teto.',
    at: [-10, -16.55, 4.2], cam: [-8.2, -13.1, 5.15], look: [-10.4, -16.5, 4.0],
  },
  {
    id: 'piscina', title: 'Raia e deck', obj: ['pool_coping', 'deck'],
    text: 'Raia de 12,5 m paralela à casa, deck de madeira e luz subaquática para a noite.',
    at: [6, 4.8, 0.2], cam: [12.8, 9.8, 1.7], look: [5, 4.6, 0],
  },
  {
    id: 'paisagismo', title: 'Paisagismo', obj: [],
    text: 'Jacarandás, arbustos e forrações em camadas de altura, com balizadores ao longo dos caminhos.',
    at: [6.0, -22.5, 1.2], cam: [0.5, -27.5, 2.0], look: [8.5, -21, 2.8],
  },
].map((d) => ({ ...d, AT: B(...d.at), CAM: B(...d.cam), LOOK: B(...d.look) }))

export const CUSTOM = {
  fachada: {
    label: 'Revestimento da fachada', mats: ['M_stone'],
    options: [
      { id: 'filete', label: 'Filete natural', tex: 'castle_wall_slates' },
      { id: 'cinza', label: 'Pedra cinza', tex: 'japanese_stone_wall' },
      { id: 'escura', label: 'Pedra escura', tex: 'rock_wall_08', tint: [0.85, 0.82, 0.8] },
    ],
  },
  madeira: {
    label: 'Madeira', mats: ['M_wood_slat', 'M_wood_soffit'],
    options: [
      { id: 'freijo', label: 'Freijó', tex: 'smoked_walnut_veneer', tint: [0.82, 0.68, 0.52] },
      { id: 'carvalho', label: 'Carvalho claro', tex: 'white_oak_veneer', tint: [0.95, 0.88, 0.78] },
      { id: 'nogueira', label: 'Nogueira escura', tex: 'american_walnut_veneer', tint: [0.6, 0.48, 0.4] },
    ],
  },
  piso: {
    label: 'Piso social', mats: ['M_stone_floor'],
    options: [
      { id: 'pedra', label: 'Pedra clara', tex: 'marble_01', tint: [0.93, 0.92, 0.9] },
      { id: 'terrazzo', label: 'Terrazzo', tex: 'terrazzo_tiles', tint: [0.95, 0.95, 0.95] },
      { id: 'granito', label: 'Granito', tex: 'granite_tile_03', tint: [0.9, 0.9, 0.9] },
    ],
  },
  luz: {
    label: 'Temperatura da luz',
    options: [
      { id: 'quente', label: 'Quente', tint: [1, 1, 1] },
      { id: 'neutra', label: 'Neutra', tint: [0.88, 0.95, 1.12] },
      { id: 'ambar', label: 'Âmbar', tint: [1.12, 0.92, 0.72] },
    ],
  },
}

export class Interactions {
  constructor(stage) {
    this.stage = stage
    this.byName = {}
    stage.house.root.traverse((o) => {
      if (o.name) (this.byName[o.name] ||= []).push(o)
    })
    this.mats = {}
    stage.house.root.traverse((o) => {
      if (!o.isMesh) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m?.name) continue
        ;(this.mats[m.name] ||= new Set()).add(m)
      }
    })
    this.state = { fachada: 'filete', madeira: 'freijo', piso: 'pedra', luz: 'quente' }
    this.hiTargets = []
  }

  meshesOf(names) {
    const out = []
    for (const n of names)
      for (const o of this.byName[n] || [])
        o.traverse((c) => {
          if (c.isMesh) out.push(c)
        })
    return out
  }

  highlight(detail, k) {
    for (const m of this.hiTargets) m.userData.hi = 0
    this.hiTargets = detail ? this.meshesOf(detail.obj) : []
    for (const m of this.hiTargets) m.userData.hi = k
    this.stage.R.invalidate(2)
  }

  setOption(group, id) {
    const g = CUSTOM[group]
    const opt = g.options.find((o) => o.id === id)
    if (!opt) return
    this.state[group] = id
    if (group === 'luz') {
      shared.uNightTint.value.fromArray(opt.tint)
      for (const m of this.stage.house.lamps) {
        m.emissive.setRGB(1.0 * opt.tint[0], 0.78 * opt.tint[1], 0.55 * opt.tint[2])
      }
    } else {
      for (const name of g.mats) for (const m of this.mats[name] || []) retexture(m, opt.tex, opt.tint)
    }
    this.stage.R.invalidate(6)
  }
}
