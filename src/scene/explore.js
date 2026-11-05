// Exploração livre: deslocamento entre ambientes por um grafo de navegação (sempre pelos vãos de porta)
// e caminhada em primeira pessoa com colisão contra paredes e móveis.
import * as THREE from 'three'
import { B } from './stage.js'

const E0 = 1.62
const E1 = 5.14
// nós do grafo (Blender) e ligações; cada ambiente aponta para um nó com um alvo de olhar
const N = {
  rua: [-1.6, -25.4, 1.7],
  porta: [-1.62, -17.7, E0],
  hall: [-1.6, -14.4, E0],
  hallN: [-1.8, -11.0, E0],
  lavaboP: [-2.4, -14.25, E0],
  lavabo: [-3.75, -14.6, E0],
  garagemP: [-4.3, -12.15, E0],
  garagem: [-6.8, -12.8, E0],
  estarW: [-0.6, -10.1, E0],
  estar: [2.4, -9.7, E0],
  estarE: [9.0, -9.95, 1.6],
  tvP: [2.35, -10.45, E0],
  tv: [2.6, -12.4, E0],
  jantar: [0.6, -5.2, E0],
  cozinhaW: [-3.4, -5.0, E0],
  cozinha: [-5.6, -5.4, 1.65],
  gourmetP: [-6.25, -4.6, E0],
  gourmet: [-6.3, -3.0, E0],
  terracoP: [5.3, -4.9, E0],
  terraco: [5.3, -2.0, E0],
  deck: [7.5, 1.6, 1.7],
  piscina: [7.5, 11.2, 1.7],
  jardim: [-4.5, 10.5, 1.7],
  escadaB: [0.6, -8.9, E0],
  esc1: [0.45, -10.0, 1.7],
  esc2: [0.45, -12.0, 2.6],
  esc3: [0.45, -14.0, 3.9],
  esc4: [0.45, -15.4, 4.95],
  patamar: [0.3, -16.45, E1],
  escritorio: [2.6, -16.45, E1],
  galeriaS: [-1.1, -15.0, E1],
  galeria: [-1.1, -9.75, E1],
  galeriaN: [-0.4, -7.0, E1],
  varandaG: [-0.4, -4.6, E1],
  master: [-3.3, -9.75, E1],
  masterC: [-3.75, -10.9, E1],
  closet: [-3.75, -12.7, E1],
  banhoP: [-6.5, -14.2, E1],
  banho: [-8.3, -14.2, E1],
  masterV: [-3.6, -6.7, E1],
  varanda: [-3.6, -3.6, E1],
  suite2P: [0.6, -9.75, E1],
  suite2: [2.4, -9.75, E1],
  closet2P: [2.5, -10.4, E1],
  closet2: [2.5, -12.2, E1],
  banho2P: [3.8, -12.4, E1],
  banho2: [5.6, -12.4, E1],
}
const EDGES = [
  ['rua', 'porta'], ['porta', 'hall'], ['hall', 'hallN'], ['hall', 'lavaboP'], ['lavaboP', 'lavabo'],
  ['hallN', 'garagemP'], ['garagemP', 'garagem'], ['hallN', 'estarW'], ['estarW', 'estar'], ['estar', 'estarE'],
  ['estar', 'tvP'], ['tvP', 'tv'], ['estarW', 'escadaB'], ['estar', 'jantar'], ['jantar', 'escadaB'],
  ['jantar', 'cozinhaW'], ['cozinhaW', 'cozinha'], ['cozinha', 'gourmetP'], ['gourmetP', 'gourmet'],
  ['estar', 'terracoP'], ['terracoP', 'terraco'], ['terraco', 'deck'], ['gourmet', 'deck'], ['deck', 'piscina'],
  ['deck', 'jardim'], ['escadaB', 'esc1'], ['esc1', 'esc2'], ['esc2', 'esc3'], ['esc3', 'esc4'], ['esc4', 'patamar'],
  ['patamar', 'escritorio'], ['patamar', 'galeriaS'], ['galeriaS', 'galeria'], ['galeria', 'galeriaN'],
  ['galeriaN', 'varandaG'], ['varandaG', 'varanda'], ['galeria', 'master'], ['master', 'masterC'],
  ['masterC', 'closet'], ['closet', 'banhoP'], ['banhoP', 'banho'], ['master', 'masterV'], ['masterV', 'varanda'],
  ['galeria', 'suite2P'], ['suite2P', 'suite2'], ['suite2', 'closet2P'], ['closet2P', 'closet2'],
  ['closet2', 'banho2P'], ['banho2P', 'banho2'],
]
// ambiente → nó e alvo do olhar
export const ROOMS = {
  acesso: { node: 'rua', look: [-1.65, -16, 2.4], name: 'Acesso' },
  hall: { node: 'hall', look: [0.4, -12.6, 2.6], name: 'Hall de entrada' },
  lavabo: { node: 'lavabo', look: [-4.0, -15.8, 1.2], name: 'Lavabo' },
  garagem: { node: 'garagem', look: [-9.5, -14.5, 1.0], name: 'Garagem' },
  estar: { node: 'estar', look: [7.2, -6.6, 0.9], name: 'Sala de estar' },
  tv: { node: 'tv', look: [6.5, -14.5, 0.9], name: 'Sala íntima' },
  jantar: { node: 'jantar', look: [-2.6, -7.2, 0.8], name: 'Sala de jantar' },
  cozinha: { node: 'cozinha', look: [-9.2, -8.2, 1.0], name: 'Cozinha' },
  gourmet: { node: 'gourmet', look: [-11.2, -1.4, 1.5], name: 'Área gourmet' },
  deck: { node: 'deck', look: [4, 5, 0.2], name: 'Terraço e piscina' },
  piscina: { node: 'piscina', look: [-1, -5, 2.6], name: 'Piscina' },
  jardim: { node: 'jardim', look: [-8, 14.5, 0.6], name: 'Jardim' },
  galeria: { node: 'galeria', look: [-1.0, -16, 4.6], name: 'Galeria e escada' },
  escritorio: { node: 'escritorio', look: [5.2, -14.6, 4.5], name: 'Escritório' },
  suite_master: { node: 'master', look: [-8.2, -10.9, 4.3], name: 'Suíte master' },
  closet: { node: 'closet', look: [-6.5, -15.5, 4.8], name: 'Closet' },
  banho_master: { node: 'banho', look: [-10.2, -16.4, 4.1], name: 'Banho master' },
  varanda: { node: 'varanda', look: [4, 6, 1.0], name: 'Varanda' },
  suite_2: { node: 'suite2', look: [5.4, -10.6, 4.2], name: 'Suíte' },
  closet_2: { node: 'closet2', look: [2.9, -13.6, 4.6], name: 'Armários da suíte' },
  banho_2: { node: 'banho2', look: [7.8, -12.4, 4.3], name: 'Banho da suíte' },
}

const adj = {}
for (const [a, b] of EDGES) {
  ;(adj[a] ||= []).push(b)
  ;(adj[b] ||= []).push(a)
}
const NP = Object.fromEntries(Object.entries(N).map(([k, v]) => [k, B(...v)]))

function bfs(from, to) {
  const prev = { [from]: null }
  const q = [from]
  while (q.length) {
    const c = q.shift()
    if (c === to) break
    for (const n of adj[c] || []) if (!(n in prev)) {
      prev[n] = c
      q.push(n)
    }
  }
  const path = []
  for (let c = to; c; c = prev[c]) path.unshift(c)
  return path
}

export function nearestNode(pos) {
  let best = null,
    bd = 1e9
  for (const [k, p] of Object.entries(NP)) {
    const d = p.distanceToSquared(pos) + Math.abs(p.y - pos.y) * 40
    if (d < bd) {
      bd = d
      best = k
    }
  }
  return best
}

/** Caminho (Vector3[]) do ponto atual até o ambiente pelo grafo. */
export function routeTo(fromPos, roomId) {
  const r = ROOMS[roomId]
  const path = bfs(nearestNode(fromPos), r.node)
  const pts = [fromPos.clone(), ...path.map((k) => NP[k].clone())]
  return { pts, look: B(...r.look) }
}

// ---------------------------------------------------------------- colisão
export class Collider {
  constructor(plan, house) {
    this.segs = { 0: [], 1: [] }
    for (const w of plan.walls) {
      const [ax, ay] = w.a,
        [bx, by] = w.b,
        t = w.t / 2 + 0.02
      const horiz = Math.abs(ay - by) < 1e-6
      const a0 = horiz ? Math.min(ax, bx) : Math.min(ay, by)
      const a1 = horiz ? Math.max(ax, bx) : Math.max(ay, by)
      const cuts = w.open.filter((o) => o[2] < 0.3 && o[4] !== 'window' && o[4] !== 'glass' && o[4] !== 'garage').map((o) => [o[0], o[1]])
      // vidros fixos e janelas continuam bloqueando; portas, passagens e folhas abertas liberam
      const slide = w.open.filter((o) => o[4] === 'slide')
      const free = cuts.map((c) => c)
      for (const o of slide) {
        // só a folha aberta libera a passagem
        const n = Math.max(1, Math.round((o[1] - o[0]) / 2.4))
        const step = (o[1] - o[0]) / n
        const k = ((o[5] % n) + n) % n
        free.push([o[0] + k * step, o[0] + (k + 1) * step])
      }
      free.sort((p, q) => p[0] - q[0])
      let cur = a0
      const spans = []
      for (const [c0, c1] of free) {
        if (c0 > cur) spans.push([cur, c0])
        cur = Math.max(cur, c1)
      }
      if (cur < a1) spans.push([cur, a1])
      for (const [s0, s1] of spans) {
        // retângulo da parede em XZ da cena
        if (horiz) this.segs[w.floor].push([s0 - t, -(ay + t), s1 + t, -(ay - t)])
        else this.segs[w.floor].push([ax - t, -(s1 + t), ax + t, -(s0 - t)])
      }
    }
    // móveis mais altos que 0,35 m viram obstáculos
    const box = new THREE.Box3()
    for (const m of house.meshes) {
      if (m.userData.stage !== 'furniture') continue
      box.setFromObject(m)
      const h = box.max.y - box.min.y
      if (h < 0.35 || box.max.x - box.min.x > 6) continue
      const f = box.min.y > 3 ? 1 : 0
      this.segs[f].push([box.min.x - 0.12, box.min.z - 0.12, box.max.x + 0.12, box.max.z + 0.12])
    }
  }

  /** Move de p para q no plano XZ deslizando nas paredes. */
  move(p, q, floor, r = 0.28) {
    const out = q.clone()
    for (let it = 0; it < 3; it++) {
      for (const [x0, z0, x1, z1] of this.segs[floor]) {
        const cx = Math.max(x0, Math.min(out.x, x1))
        const cz = Math.max(z0, Math.min(out.z, z1))
        const dx = out.x - cx,
          dz = out.z - cz
        const d2 = dx * dx + dz * dz
        if (d2 < r * r) {
          if (d2 < 1e-8) {
            out.x = p.x
            out.z = p.z
          } else {
            const d = Math.sqrt(d2)
            out.x = cx + (dx / d) * r
            out.z = cz + (dz / d) * r
          }
        }
      }
    }
    return out
  }
}

/** Altura dos olhos conforme a posição (inclui a escada). */
export function eyeHeight(pos, floor) {
  // escada: x ∈ [-0.18, 1.04] (cena), z ∈ [10.6, 15.6]
  if (pos.x > -0.2 && pos.x < 1.06 && pos.z > 10.6 && pos.z < 15.6) return ((pos.z - 10.6) / 5) * 3.5 + E0
  return floor === 1 ? E1 : E0
}
