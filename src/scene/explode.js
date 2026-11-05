// Desmontagem arquitetônica: a casa se separa em camadas (cobertura, pavimento superior, laje/forros)
// revelando os ambientes como uma maquete; depois tudo volta ao lugar.
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class Explode {
  constructor(stage) {
    this.stage = stage
    const roomFloor = Object.fromEntries(stage.plan.rooms.map((r) => [r.id, r.floor]))
    roomFloor.varanda = 1
    this.layers = { roof: [], upper: [], mid: [], brise: [], hide: [] }
    for (const m of stage.house.meshes) {
      const d = m.userData
      const n = (m.parent?.name || '') + '|' + m.name
      let L = null
      if (d.stage === 'roof') L = d.room === undefined && /green_roof/.test(n) ? 'upper' : 'roof'
      else if (/fixtures_spots/.test(n)) L = 'hide'
      else if (/brise/.test(n)) L = 'brise'
      else if (/slab_1|ceiling_slats|led_estar/.test(n)) L = 'mid'
      else if (/^ce_|\|ce_/.test(n)) L = d.floor === 1 ? 'roof' : 'mid'
      else if (d.stage === 'lights' && d.room && roomFloor[d.room] === 0) L = 'mid'
      else if (d.floor === 1) L = 'upper'
      else if (d.room && roomFloor[d.room] === 1) L = 'upper'
      else if (/rails_|green_roof/.test(n)) L = 'upper'
      if (L) this.layers[L].push(m)
      if (!m.userData.basePos) m.userData.basePos = m.position.clone()
    }
    this.p = 0
  }

  /** p ∈ [0,1]: 0 = montada, 1 = totalmente separada. */
  set(p) {
    this.p = p
    const e = ease(Math.min(1, Math.max(0, p)))
    const lift = { roof: 9.5, upper: 5.2, mid: 2.4 }
    for (const [k, arr] of Object.entries(this.layers)) {
      for (const m of arr) {
        m.position.copy(m.userData.basePos)
        if (k === 'hide') m.visible = e < 0.05
        else if (k === 'brise') {
          m.position.y += lift.upper * e
          m.position.z += 2.2 * e
        } else m.position.y += lift[k] * e
      }
    }
    this.stage.R.shadowDirty = true
    this.stage.R.invalidate(2)
  }
}
