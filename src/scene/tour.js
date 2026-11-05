// Tour virtual: a câmera percorre a casa real pelos vãos de porta, em altura de olhos (1,62 m),
// com pausas nos pontos de interesse. Caminho planejado sobre a planta (coordenadas do Blender).
import * as THREE from 'three'
import { B } from './stage.js'

const E0 = 1.62
const E1 = 3.52 + 1.62
// p = posição, l = alvo do olhar, h = pausa (peso), r = ambiente (legenda)
const RAW = [
  { p: [-1.6, -25.4, 1.7], l: [-1.65, -16, 2.2], r: 'acesso' },
  { p: [-1.62, -20.2, E0], l: [-1.65, -16, 1.9], h: 0.6 },
  { p: [-1.62, -17.7, E0], l: [-1.6, -13, 1.75], door: 'open' },
  { p: [-1.6, -16.0, E0], l: [-1.2, -12, 1.8] },
  { p: [-1.6, -14.4, E0], l: [0.4, -12.6, 2.6], h: 1.2, r: 'hall' },
  { p: [-1.8, -11.0, E0], l: [3, -8.5, 1.4] },
  { p: [-0.6, -10.1, E0], l: [5, -7.2, 1.1] },
  { p: [2.4, -9.7, E0], l: [7.2, -6.6, 0.9], h: 1.4, r: 'estar' },
  { p: [6.4, -9.95, 1.55], l: [6.6, -6.6, 0.8], h: 0.6 },
  { p: [9.0, -9.95, 1.6], l: [11.6, -5.4, 1.5], h: 1.0 },
  { p: [5.5, -9.8, E0], l: [1, -6.5, 1.2] },
  { p: [2.2, -9.6, E0], l: [-1.9, -7, 0.9] },
  { p: [0.6, -5.2, E0], l: [-2.6, -7.2, 0.8], h: 1.2, r: 'jantar' },
  { p: [-3.4, -5.0, E0], l: [-8, -8.5, 1.0] },
  { p: [-5.6, -5.4, 1.65], l: [-9.2, -8.2, 1.0], h: 1.4, r: 'cozinha' },
  { p: [-6.25, -4.6, E0], l: [-6.4, -1, 1.4] },
  { p: [-6.3, -3.0, E0], l: [-11.2, -1.4, 1.5], h: 1.2, r: 'gourmet' },
  { p: [-6.25, -4.7, E0], l: [-2, -6.5, 1.4] },
  { p: [-2.0, -5.0, E0], l: [0.6, -9, 1.5] },
  { p: [0.6, -8.9, E0], l: [0.45, -13.5, 3.0] },
  { p: [0.45, -10.0, 1.7], l: [0.45, -15, 4.0] },
  { p: [0.45, -12.0, 2.6], l: [0.4, -16, 4.6] },
  { p: [0.45, -14.0, 3.9], l: [0.2, -17, 5.1] },
  { p: [0.45, -15.4, 4.95], l: [-0.6, -16.4, 5.1] },
  { p: [0.3, -16.45, E1], l: [3.5, -15.6, 4.7], r: 'escritorio' },
  { p: [2.6, -16.45, E1], l: [5.2, -14.6, 4.5], h: 1.2 },
  { p: [0.4, -16.45, E1], l: [-1.1, -12, 5.0] },
  { p: [-1.1, -15.0, E1], l: [-1.1, -9, 5.0], r: 'galeria' },
  { p: [-1.1, -9.75, E1], l: [3, -9.6, 4.9], h: 0.4 },
  // segunda suíte (porta da galeria em x 1,2); armários e banho ficam na exploração livre
  { p: [0.6, -9.75, E1], l: [4, -9.2, 4.9] },
  { p: [2.3, -9.5, E1], l: [5.6, -9.0, 4.6], r: 'suite_2' },
  { p: [2.5, -7.0, E1], l: [6.6, -10.3, 4.1], h: 1.4 },
  { p: [2.3, -9.4, E1], l: [-2, -9.8, 4.9] },
  { p: [0.6, -9.75, E1], l: [-6, -9.8, 4.8], r: 'galeria' },
  { p: [-1.1, -9.75, E1], l: [-6, -9.8, 4.8] },
  { p: [-3.3, -9.75, E1], l: [-8.2, -10.9, 4.3], h: 1.2, r: 'suite_master' },
  { p: [-3.75, -10.9, E1], l: [-4.5, -14.5, 4.8] },
  { p: [-3.75, -12.7, E1], l: [-6.5, -15.5, 4.8], h: 0.6, r: 'closet' },
  { p: [-6.5, -14.2, E1], l: [-9.5, -14.8, 4.6] },
  { p: [-8.3, -14.2, E1], l: [-10.2, -16.4, 4.1], h: 1.2, r: 'banho_master' },
  { p: [-6.5, -14.2, E1], l: [-4, -12.5, 5.0] },
  { p: [-3.75, -12.6, E1], l: [-3.75, -9, 5.0] },
  { p: [-3.75, -9.4, E1], l: [-3.6, -4, 4.9] },
  { p: [-3.6, -6.7, E1], l: [-3.4, 0, 4.6] },
  { p: [-3.6, -3.6, E1], l: [4, 6, 1.0], h: 1.4, r: 'varanda' },
  // da varanda ao deck não há caminho sem atravessar o guarda-corpo: corte com véu
  { p: [13.2, 12.6, 1.68], l: [3, -5, 2.9], r: 'deck', cut: true },
  { p: [7.5, 11.2, 1.68], l: [-1, -5, 2.6], h: 1.2 },
]

export const ROOM_LABELS = {
  acesso: 'Acesso e jardim frontal',
  hall: 'Hall de entrada',
  estar: 'Sala de estar',
  jantar: 'Sala de jantar',
  cozinha: 'Cozinha',
  gourmet: 'Área gourmet',
  escritorio: 'Escritório',
  galeria: 'Galeria e escada',
  suite_master: 'Suíte master',
  suite_2: 'Segunda suíte',
  closet: 'Closet',
  banho_master: 'Banho master',
  varanda: 'Varanda',
  deck: 'Piscina e deck',
}

const sm = (t) => t * t * (3 - 2 * t)

export class Tour {
  constructor(stage) {
    this.stage = stage
    this.pts = RAW.map((k) => ({ ...k, P: B(...k.p), L: B(...k.l) }))
    // trechos contínuos (um `cut` inicia um novo trecho): cada um tem sua curva
    this.runs = []
    let run = null
    this.pts.forEach((k, i) => {
      if (!run || k.cut) this.runs.push((run = { start: i, pts: [] }))
      run.pts.push(k.P)
      k.run = run
    })
    for (const r of this.runs)
      r.curve = r.pts.length > 1 ? new THREE.CatmullRomCurve3(r.pts, false, 'centripetal', 0.5) : null
    // linha do tempo: deslocamento (m) + pausas; o corte dura um instante
    const speed = 1.6
    let t = 0
    this.times = [0]
    for (let i = 0; i < this.pts.length - 1; i++) {
      const next = this.pts[i + 1]
      t += (this.pts[i].h || 0) * 1.6 + (next.cut ? 0.8 : this.pts[i].P.distanceTo(next.P) / speed)
      this.times.push(t)
    }
    this.total = t
    // porta pivotante de entrada
    this.door = null
    stage.house.root.traverse((o) => {
      if (o.userData?.pivot && !this.door) this.door = o
    })
    if (this.door) {
      const pv = this.door.userData.pivot // Blender [x, y, z]
      this.pivot = B(pv[0], pv[1], 0)
      this.doorBase = this.door.position.clone()
    }
    this.look = new THREE.Vector3()
  }

  /** Retorna {pos, look, room, door} para p ∈ [0,1]. */
  at(p) {
    const T = Math.min(1, Math.max(0, p)) * this.total
    let i = 0
    while (i < this.times.length - 2 && T > this.times[i + 1]) i++
    const k = this.pts[i]
    const hold = (k.h || 0) * 1.6
    const dur = this.times[i + 1] - this.times[i]
    const local = Math.max(0, T - this.times[i] - hold) / Math.max(0.001, dur - hold)
    const s = sm(Math.min(1, local))
    const nx = this.pts[i + 1]
    let pos, look
    if (nx.cut) {
      // corte seco no meio do trecho; o laço principal cobre o salto com o véu
      const b = s < 0.5 ? k : nx
      pos = b.P.clone()
      look = b.L.clone()
    } else {
      const r = k.run
      pos = r.curve.getPoint((i - r.start + s) / (r.pts.length - 1))
      look = new THREE.Vector3().lerpVectors(k.L, nx.L, s)
    }
    let room = null
    if (nx.r && s > (nx.cut ? 0.5 : 0.35)) room = nx.r
    else for (let j = i; j >= 0; j--)
      if (this.pts[j].r) {
        room = this.pts[j].r
        break
      }
    // porta: abre entre os pontos 1 e 3, fecha depois que a câmera entra
    const tDoorA = this.times[1] + 0.5,
      tDoorB = this.times[2] + 0.4,
      tClose = this.times[4] + 0.3
    let open = 0
    if (T > tDoorA) open = Math.min(1, (T - tDoorA) / (tDoorB - tDoorA))
    if (T > tClose) open = Math.max(0, 1 - (T - tClose) / 1.6)
    this.setDoor(sm(open))
    return { pos, look, room, index: i }
  }

  setDoor(k) {
    if (!this.door) return
    const a = -k * Math.PI * 0.5
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a)
    // gira em torno do eixo pivotante: pos = P + R(a)·(base − P)
    const off = this.doorBase.clone().sub(this.pivot).applyQuaternion(q)
    this.door.position.copy(this.pivot).add(off)
    this.door.quaternion.copy(q)
    this.stage.R.invalidate(1)
  }
}
