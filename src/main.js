// CASA NEXUS — orquestração da experiência: rolagem → cenas 3D, modos interativos e interface.
import './styles/main.css'
import * as THREE from 'three'
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { createStage, B } from './scene/stage.js'
import { Construction, CONSTRUCTION_SHOTS, STEPS } from './scene/construction.js'
import { Explode } from './scene/explode.js'
import { Tour, ROOM_LABELS } from './scene/tour.js'
import { ROOMS, routeTo, Collider, eyeHeight, nearestNode } from './scene/explore.js'
import { Interactions, DETAILS, CUSTOM } from './scene/interactions.js'
import { MOODS } from './engine/world.js'
import { shared, onTextures } from './engine/materials.js'
import { PROFILES } from './engine/renderer.js'

gsap.registerPlugin(ScrollTrigger)
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const QS = new URLSearchParams(location.search)

// ---------------------------------------------------------------- sem WebGL → apresentação em imagens
function hasWebGL() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}
function fallback() {
  document.body.classList.add('no-gl')
  $('#loader').classList.add('is-done')
  const s = $('#sem-3d')
  s.hidden = false
  const shots = [
    ['frente', 'Fachada da rua'], ['fundos', 'Jardim, piscina e fachada norte'], ['piscina', 'Terraço e raia'],
    ['estar', 'Sala de estar'], ['cozinha', 'Cozinha integrada'], ['master', 'Suíte master'], ['aerea', 'Implantação'],
  ]
  $('.nogl-grid').innerHTML = shots
    .map(([f, t]) => `<figure><img src="${import.meta.env.BASE_URL}img/${f}.jpg" alt="${t} — captura da cena 3D" loading="lazy"><figcaption>${t}</figcaption></figure>`)
    .join('')
}
if (!hasWebGL()) {
  fallback()
} else {
  boot().catch((e) => {
    console.error(e)
    $('.loader-error').hidden = false
    $('.bar').hidden = true
  })
}
$('[data-retry]')?.addEventListener('click', () => location.reload())

// ---------------------------------------------------------------- utilidades de câmera
const sm = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.min(1, Math.max(0, t))
function shotAt(keys, p) {
  if (p <= keys[0].p) return { pos: keys[0].pos.clone(), tgt: keys[0].tgt.clone() }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1]
    if (p <= b.p) {
      const t = sm((p - a.p) / (b.p - a.p))
      return { pos: a.pos.clone().lerp(b.pos, t), tgt: a.tgt.clone().lerp(b.tgt, t) }
    }
  }
  const k = keys[keys.length - 1]
  return { pos: k.pos.clone(), tgt: k.tgt.clone() }
}
const inside = (p) =>
  (p.y < 3.25 && p.x > -12 && p.x < 12 && p.z > 4 && p.z < 16) || (p.y > 3.5 && p.y < 6.3 && p.x > -12.5 && p.x < 8.5 && p.z > 6 && p.z < 17.2)
const K = (p, pos, tgt) => ({ p, pos: B(...pos), tgt: B(...tgt) })

const SHOTS = {
  intro: [K(0, [30, -50, 15], [0, -9.5, 3]), K(0.55, [21, -40, 7.5], [-1, -11.5, 3.6]), K(1, [11, -32, 3.2], [-1.5, -14, 3.4])],
  facade: [K(0, [11, -32, 3.2], [-1.5, -14, 3.4]), K(0.35, [2.5, -24, 2.2], [-3, -16, 3.6]), K(0.62, [-12, -24, 2.6], [-2, -15, 3.8]), K(1, [1.5, -16.5, 50], [0, -8.5, 0])],
  overview: [K(0, [-26, 6, 4.5], [0, -6, 2.8]), K(1, [-6, 26, 6.5], [1, -6, 2.6])],
  explode: [K(0, [-6, 26, 6.5], [1, -6, 2.6]), K(0.3, [18, 22, 24], [0, -8, 5]), K(0.6, [30, -16, 26], [0, -9, 5]), K(0.9, [6, -34, 12], [0, -10, 4]), K(1, [-1.6, -27, 2.2], [-1.65, -16, 2.2])],
  finale: [K(0, [7, 14, 2.0], [-1, -7, 3.2]), K(1, [-3, 24, 8.5], [0, -7, 3])],
  sheet: [K(0, [0.5, -8, 70], [0, -7.9, 0])],
}
const CUSTOM_VIEWS = {
  fachada: { pos: B(9, -31, 2.4), look: B(-1.5, -15, 3.4) },
  jardim: { pos: B(9, 13.5, 2.2), look: B(0, -6, 2.6) },
  sala: { pos: B(2.4, -9.7, 1.62), look: B(7.2, -6.6, 1.2) },
}

async function boot() {
  const canvas = $('#gl')
  const bar = $('.bar span')
  const stage = await createStage(canvas, {
    onProgress: (k) => {
      bar.style.transform = `scaleX(${k})`
      $('.pct').textContent = Math.round(k * 100) + '%'
    },
    onStep: (s) => ($('.step').textContent = s),
  })
  const { R, world, camera, house } = stage
  window.__stage = stage
  onTextures(() => R.invalidate(3))
  const build = new Construction(stage)
  const explode = new Explode(stage)
  const tour = new Tour(stage)
  const inter = new Interactions(stage)
  const collider = new Collider(stage.plan, house)
  fillFacts(stage.plan)
  buildPlans(stage.plan)

  // estado da câmera: alvo desejado e câmera real com amortecimento
  const desired = { pos: camera.position.clone(), look: new THREE.Vector3() }
  const look = new THREE.Vector3()
  let damp = 6
  let current = 'intro'
  let mode = 'scroll' // scroll | fly | free
  const sec = {}

  // ---------------------------------------------------------------- climas
  let trans = null
  let userMood = false
  function setMood(name, byUser = true) {
    quiet()
    if (!world.envs[name] || world.mood === name || trans) return
    userMood ||= byUser
    if (reduced) {
      world.apply(name)
      house.syncLamps()
      R.shadowDirty = true
      R.invalidate(3)
    } else trans = { from: world.mood, to: name, t: 0 }
    $$('[data-mood]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mood === name)))
  }
  $$('[data-mood]').forEach((b) =>
    b.addEventListener('click', async () => {
      await stage.moodsReady
      setMood(b.dataset.mood)
    }),
  )

  // ---------------------------------------------------------------- qualidade
  const qBtn = $('.q-btn'),
    qMenu = $('#q-menu')
  const markQ = () => $$('[data-q]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === R.profileName)))
  markQ()
  qBtn.addEventListener('click', () => {
    qMenu.hidden = !qMenu.hidden
    qBtn.setAttribute('aria-expanded', String(!qMenu.hidden))
  })
  $$('[data-q]').forEach((b) =>
    b.addEventListener('click', () => {
      sessionStorage.setItem('nx-scroll', String(scrollY))
      const u = new URL(location.href)
      u.searchParams.set('q', b.dataset.q)
      location.href = u.toString()
    }),
  )

  // ---------------------------------------------------------------- rolagem suave + gatilhos por cena
  const lenis = reduced ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4 })
  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update)
    gsap.ticker.add((t) => lenis.raf(t * 1000))
    gsap.ticker.lagSmoothing(0)
  }
  $$('.scene, .sheet').forEach((el) => {
    const name = el.dataset.scene
    sec[name] = { el, p: 0, on: false }
    ScrollTrigger.create({
      trigger: el,
      start: el.classList.contains('scene-interactive') ? 'top 55%' : 'top top',
      end: el.classList.contains('scene-interactive') ? 'bottom 45%' : 'bottom bottom',
      onUpdate: (st) => (sec[name].p = st.progress),
      onToggle: (st) => {
        sec[name].on = st.isActive
        if (st.isActive) enter(name)
      },
    })
  })
  // seção da ficha conta desde que entra na tela
  ScrollTrigger.create({ trigger: '#planta', start: 'top 70%', end: 'bottom top', onToggle: (st) => st.isActive && enter('sheet') })
  // âncoras e botões de pular
  $$('a[href^="#"], [data-skip]').forEach((a) =>
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href') || a.dataset.skip
      const t = $(id)
      if (!t || id === '#sem-3d') return
      e.preventDefault()
      if (lenis) lenis.scrollTo(t, { duration: id === '#residencia' ? 2.4 : 1.6 })
      else t.scrollIntoView()
    }),
  )
  // painéis editoriais que aparecem em pontos da cena
  const panels = $$('.panel').map((p) => ({ el: p, at: Number(p.dataset.at || 0), sec: p.closest('.scene').dataset.scene }))

  function enter(name) {
    current = name
    quiet()
    document.body.classList.toggle('is-interactive', ['explore', 'details', 'custom'].includes(name))
    $$('.nav a').forEach((a) => a.classList.toggle('is-on', a.getAttribute('href') === '#' + sec[name]?.el.id))
    build.setActive(name === 'build')
    if (name !== 'explode') explode.set(0)
    if (name !== 'details') {
      inter.highlight(null, 0)
      $('.detail-card').hidden = true
    }
    if (name === 'explore') {
      if (!roomNow) flyToRoom('estar')
      else mode = 'free'
    } else if (name === 'details') {
      const overview = B(30, -9, 21)
      const L = B(0, -9, 2)
      const { pts } = routeTo(camera.position.clone(), inside(camera.position) ? 'deck' : 'acesso')
      if (!inside(camera.position)) pts.length = 1
      pts.push(overview)
      flyTo(overview, L, () => {
        mode = 'free'
        setYawPitchFrom(L)
      }, pts)
    } else if (name === 'custom') {
      setCustomView(customView)
    } else if (name === 'finale') {
      mode = 'scroll'
      if (!userMood) stage.moodsReady.then(() => setMood('sunset', false))
    } else {
      mode = 'scroll'
    }
    R.invalidate(3)
  }

  // ---------------------------------------------------------------- construção: lista de etapas
  const stepsEl = $('.steps')
  stepsEl.innerHTML = STEPS.map((s) => `<li>${s.label}</li>`).join('')
  const stepLis = $$('li', stepsEl)

  // ---------------------------------------------------------------- voo entre poses pelo grafo de navegação
  let fly = null
  function flyTo(pos, lookAt, done, routePts) {
    const raw = routePts || [camera.position.clone(), pos.clone()]
    // remove pontos coincidentes (Catmull-Rom centrípeta gera NaN com segmentos nulos)
    const pts = raw.filter((q, i) => i === 0 || q.distanceTo(raw[i - 1]) > 0.08)
    if (pts.length < 2) pts.push(pos.clone().add(new THREE.Vector3(0, 0.001, 0.001)))
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5)
    const len = curve.getLength()
    const dur = reduced ? 0.01 : Math.min(7, Math.max(1.3, len / 5.5))
    fly = { curve, look0: look.clone(), look1: lookAt.clone(), t: 0, dur, done }
    mode = 'fly'
  }
  let roomNow = null
  const roomOrder = Object.keys(ROOMS)
  function flyToRoom(id) {
    const { pts, look: L } = routeTo(camera.position.clone(), id)
    const end = pts[pts.length - 1]
    flyTo(end, L, () => {
      mode = 'free'
      setYawPitchFrom(L)
    }, pts)
    roomNow = id
    $('.here strong').textContent = ROOMS[id].name
    $$('.room-r').forEach((r) => r.classList.toggle('is-on', r.dataset.room === id))
    const fl = end.y > 3 ? 1 : 0
    showFloor(fl)
  }
  function routeToPose(pos, lookAt, done) {
    const a = nearestNode(camera.position),
      b = nearestNode(pos)
    // reutiliza o grafo: caminho entre os nós mais próximos + pose final
    const fake = Object.entries(ROOMS).find(([, r]) => r.node === b)
    if (fake && a !== b) {
      const { pts } = routeTo(camera.position.clone(), fake[0])
      pts.push(pos.clone())
      flyTo(pos, lookAt, done, pts)
    } else flyTo(pos, lookAt, done)
  }

  // ---------------------------------------------------------------- olhar livre + caminhada
  let yaw = 0,
    pitch = 0
  function setYawPitchFrom(target) {
    const d = target.clone().sub(camera.position).normalize()
    yaw = Math.atan2(-d.x, -d.z)
    pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))
  }
  let drag = null
  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'free') return
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId }
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const k = e.pointerType === 'touch' ? 0.0045 : 0.0032
    yaw += (e.clientX - drag.x) * k
    pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * k, -1.1, 1.1)
    drag.x = e.clientX
    drag.y = e.clientY
    R.invalidate(2)
  })
  addEventListener('pointerup', () => (drag = null))
  const keys = new Set()
  addEventListener('keydown', (e) => {
    if (current !== 'explore' || mode !== 'free') return
    const k = e.key.toLowerCase()
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k)
      e.preventDefault()
    }
  })
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
  $$('[data-move]').forEach((b) => {
    const k = b.dataset.move === 'f' ? 'w' : 's'
    b.addEventListener('pointerdown', () => keys.add(k))
    b.addEventListener('pointerup', () => keys.delete(k))
    b.addEventListener('pointerleave', () => keys.delete(k))
  })

  // ---------------------------------------------------------------- exploração: planta interativa
  $$('.explore-ui .room-r').forEach((r) =>
    r.addEventListener('click', () => flyToRoom(r.dataset.room)),
  )
  $$('.explore-ui .room-r').forEach((r) =>
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        flyToRoom(r.dataset.room)
      }
    }),
  )
  function showFloor(f) {
    $$('.floor-tabs button').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.floor) === f)))
    $$('.explore-ui .plan g[data-floor]').forEach((g) => (g.style.display = Number(g.dataset.floor) === f ? '' : 'none'))
  }
  $$('.floor-tabs button').forEach((b) => b.addEventListener('click', () => showFloor(Number(b.dataset.floor))))
  showFloor(0)
  $('[data-ex="next"]').addEventListener('click', () => flyToRoom(roomOrder[(roomOrder.indexOf(roomNow) + 1) % roomOrder.length]))
  $('[data-ex="prev"]').addEventListener('click', () => flyToRoom(roomOrder[(roomOrder.indexOf(roomNow) - 1 + roomOrder.length) % roomOrder.length]))
  $('[data-ex="overview"]').addEventListener('click', () => {
    const { pts } = routeTo(camera.position.clone(), 'deck')
    pts.push(B(22, 20, 16))
    flyTo(B(22, 20, 16), B(0, -7, 2), () => {
      mode = 'free'
      setYawPitchFrom(B(0, -7, 2))
    }, pts)
    roomNow = 'deck'
    $('.here strong').textContent = 'Visão geral'
  })

  // ---------------------------------------------------------------- detalhes
  const list = $('.detail-list')
  list.innerHTML = DETAILS.map((d, i) => `<li><button type="button" data-d="${d.id}"><span>${String(i + 1).padStart(2, '0')}</span>${d.title}</button></li>`).join('')
  const markers = $('.markers')
  markers.innerHTML = DETAILS.map((d, i) => `<button type="button" class="marker" data-d="${d.id}" aria-label="${d.title}">${i + 1}</button>`).join('')
  let detailBack = null
  let detailOn = null
  function openDetail(id) {
    const d = DETAILS.find((x) => x.id === id)
    if (!d) return
    if (!detailOn) detailBack = { pos: camera.position.clone(), look: look.clone() }
    detailOn = d
    $$('[data-d]').forEach((b) => b.classList.toggle('is-on', b.dataset.d === id))
    $('.dc-t').textContent = d.title
    $('.dc-d').textContent = d.text
    $('.detail-card').hidden = false
    routeToPose(d.CAM, d.LOOK, () => {
      mode = 'free'
      setYawPitchFrom(d.LOOK)
    })
  }
  $$('[data-d]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.d)))
  $('[data-detail-back]').addEventListener('click', () => {
    inter.highlight(null, 0)
    detailOn = null
    $$('[data-d]').forEach((b) => b.classList.remove('is-on'))
    $('.detail-card').hidden = true
    if (detailBack) routeToPose(detailBack.pos, detailBack.look, () => {
      mode = 'free'
      setYawPitchFrom(detailBack.look)
    })
  })

  // ---------------------------------------------------------------- personalização
  const cg = $('.custom-groups')
  cg.innerHTML = Object.entries(CUSTOM)
    .map(
      ([k, g]) => `<div class="custom-group"><p class="cg-label">${g.label}</p><div class="swatches">${g.options
        .map(
          (o) => `<button type="button" class="swatch" data-cg="${k}" data-co="${o.id}" aria-pressed="${inter.state[k] === o.id}">${
            o.tex ? `<img src="${import.meta.env.BASE_URL}assets/tex/${o.tex}/diff_512.webp" alt="" loading="lazy" style="${o.tint ? `filter: brightness(${(o.tint[0] + o.tint[1] + o.tint[2]) / 3})` : ''}">` : `<span style="display:block;height:34px;border-radius:6px;margin-bottom:6px;background:rgb(${o.tint.map((v) => Math.min(255, Math.round(v * 200))).join(',')})"></span>`
          }${o.label}</button>`,
        )
        .join('')}</div></div>`,
    )
    .join('')
  $$('.swatch').forEach((b) =>
    b.addEventListener('click', () => {
      inter.setOption(b.dataset.cg, b.dataset.co)
      $$(`.swatch[data-cg="${b.dataset.cg}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      if (b.dataset.cg === 'luz' && world.mood === 'day') stage.moodsReady.then(() => setMood('night'))
    }),
  )
  let customView = 'fachada'
  function setCustomView(v) {
    customView = v
    $$('[data-cview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cview === v)))
    const cv = CUSTOM_VIEWS[v]
    routeToPose(cv.pos, cv.look, () => {
      mode = 'free'
      setYawPitchFrom(cv.look)
    })
  }
  $$('[data-cview]').forEach((b) => b.addEventListener('click', () => setCustomView(b.dataset.cview)))

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Timer()
  const v3 = new THREE.Vector3()
  let insideF = 0
  const LAMP_DAY = 0.5 // nível das luminárias de dia com a câmera dentro de casa
  const fpsBadge = $('.fps-badge')
  const veil = document.createElement('div')
  veil.className = 'veil'
  document.body.appendChild(veil)
  let veilT = 0
  if (QS.has('fps')) fpsBadge.hidden = false
  // Qualidade adaptativa. Mede o tempo de GPU por quadro (timer query), não o intervalo do rAF, que o vsync
  // trava em 16,7/33 ms. Ignora 2,5 s depois de trocas de cena, clima ou perfil (compilação de shaders e
  // decodificação de texturas não são incapacidade do hardware). Perfil escolhido pelo usuário (?q) só cai
  // em instabilidade crítica (< 20 fps de GPU sustentado), com aviso na tela. No automático, também volta a subir.
  const ORDER = ['performance', 'balanced', 'high', 'ultra']
  const userQ = QS.has('q')
  const autoTop = R.profileName
  let slowT = 0,
    fastT = 0,
    quietUntil = performance.now() + 4000,
    lastChange = 0
  const quiet = (ms = 2500) => (quietUntil = Math.max(quietUntil, performance.now() + ms))
  window.addEventListener('nx-quiet', () => quiet())
  const toast = document.createElement('div')
  toast.className = 'q-toast'
  toast.setAttribute('role', 'status')
  document.body.appendChild(toast)
  function changeProfile(name, why) {
    R.setProfile(name)
    R.frames.length = 0
    if (R.gpuMs) R.gpuMs.length = 0
    slowT = fastT = 0
    lastChange = performance.now()
    quiet(3000)
    markQ()
    if (why) {
      toast.textContent = why
      toast.classList.add('is-on')
      setTimeout(() => toast.classList.remove('is-on'), 6000)
    }
  }

  function frame(now) {
    requestAnimationFrame(frame)
    clock.update(now)
    const dt = Math.min(clock.getDelta(), 0.1)
    let active = false
    // ---- câmera desejada por cena
    if (mode === 'scroll') {
      const s = sec[current]
      const p = s?.p ?? 0
      let shot
      if (current === 'intro') shot = shotAt(SHOTS.intro, p)
      else if (current === 'facade') shot = shotAt(SHOTS.facade, p)
      else if (current === 'build') {
        const step = build.set(p)
        shot = shotAt(CONSTRUCTION_SHOTS, p)
        $('.cap-t').textContent = step.label
        $('.cap-d').textContent = step.text
        const idx = STEPS.indexOf(step)
        stepLis.forEach((li, i) => {
          li.classList.toggle('is-on', i === idx)
          li.classList.toggle('is-done', i < idx)
        })
      } else if (current === 'overview') shot = shotAt(SHOTS.overview, p)
      else if (current === 'explode') {
        const e = p < 0.12 ? 0 : p < 0.5 ? (p - 0.12) / 0.38 : p < 0.72 ? 1 : p < 0.94 ? 1 - (p - 0.72) / 0.22 : 0
        explode.set(e)
        shot = shotAt(SHOTS.explode, p)
        $('.explode-cap').textContent =
          e < 0.05 ? 'A casa completa, pronta para se abrir.' : p < 0.3 ? 'A cobertura se eleva.' : p < 0.5 ? 'O pavimento superior se separa do térreo.' : p < 0.72 ? 'Ambientes visíveis ao mesmo tempo, como numa maquete.' : 'Tudo volta ao lugar. A câmera segue para a entrada.'
      } else if (current === 'tour') {
        const t = tour.at(p)
        shot = { pos: t.pos, tgt: t.look }
        $('.room').textContent = t.room ? ROOM_LABELS[t.room] : ''
        $('.tour-bar span').style.width = (p * 100).toFixed(1) + '%'
        damp = 9
      } else if (current === 'finale') shot = shotAt(SHOTS.finale, p)
      else if (current === 'sheet') shot = shotAt(SHOTS.sheet, 0)
      if (current !== 'tour') damp = reduced ? 1000 : 5.5
      if (shot) {
        desired.pos.copy(shot.pos)
        desired.look.copy(shot.tgt)
      }
    } else if (mode === 'fly' && fly) {
      fly.t = Math.min(1, fly.t + dt / fly.dur)
      const k = sm(fly.t)
      fly.curve.getPoint(k, desired.pos)
      // olha na direção do deslocamento e termina no alvo
      const ahead = fly.curve.getPoint(Math.min(1, k + 0.06))
      const dir = ahead.sub(desired.pos)
      dir.y *= 0.3
      const travelLook = desired.pos.clone().add(dir.lengthSq() > 1e-6 ? dir.normalize().multiplyScalar(4) : v3.set(0, 0, -4))
      const w = sm(clamp01((fly.t - 0.55) / 0.45))
      const w0 = 1 - sm(clamp01(fly.t / 0.2))
      desired.look.copy(travelLook).lerp(fly.look1, w).lerp(fly.look0, w0 * (1 - w))
      damp = 14
      active = true
      if (fly.t >= 1) {
        const done = fly.done
        fly = null
        done?.()
      }
    } else if (mode === 'free') {
      // caminhada
      if (keys.size) {
        const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
        const mv = new THREE.Vector3()
        if (keys.has('w') || keys.has('arrowup')) mv.add(fwd)
        if (keys.has('s') || keys.has('arrowdown')) mv.sub(fwd)
        if (keys.has('d')) mv.add(right)
        if (keys.has('a')) mv.sub(right)
        if (keys.has('arrowleft')) yaw += dt * 1.6
        if (keys.has('arrowright')) yaw -= dt * 1.6
        if (mv.lengthSq()) {
          mv.normalize().multiplyScalar(dt * 2.2)
          const fl = desired.pos.y > 3.3 ? 1 : 0
          const next = collider.move(desired.pos, desired.pos.clone().add(mv), fl)
          next.y = eyeHeight(next, fl)
          desired.pos.copy(next)
        }
        active = true
      }
      desired.look.set(
        desired.pos.x - Math.sin(yaw) * Math.cos(pitch),
        desired.pos.y + Math.sin(pitch),
        desired.pos.z - Math.cos(yaw) * Math.cos(pitch),
      )
      damp = 12
    }
    // ---- amortecimento (saltos longos viram corte com véu, para nunca atravessar paredes)
    const a = 1 - Math.exp(-dt * damp)
    const dp = camera.position.distanceTo(desired.pos)
    if (mode === 'scroll' && dp > 9) {
      veil.classList.add('is-on')
      clearTimeout(veilT)
      veilT = setTimeout(() => veil.classList.remove('is-on'), 260)
      camera.position.copy(desired.pos)
      look.copy(desired.look)
    }
    const dl = look.distanceTo(desired.look)
    if (dp > 0.0005 || dl > 0.0005) {
      camera.position.lerp(desired.pos, a)
      look.lerp(desired.look, a)
      camera.lookAt(look)
      active = true
    }
    // ---- transição de clima
    if (trans) {
      trans.t = Math.min(1, trans.t + dt / 2.4)
      world.transition(trans.to, sm(trans.t), trans.from)
      house.syncLamps()
      R.shadowDirty = true
      if (trans.t >= 1) trans = null
      active = true
    }
    // ---- exposição que se adapta dentro da casa
    const tIn = inside(camera.position) ? 1 : 0
    if (Math.abs(tIn - insideF) > 0.002) {
      insideF += (tIn - insideF) * Math.min(1, dt * 2.2)
      active = true
    }
    shared.uInside.value = insideF
    // ---- luminárias: acesas à noite; de dia, acendem quando a câmera entra na casa
    const flash = current === 'build' ? build.flash || 0 : 0
    const lampDay = LAMP_DAY * insideF
    const lamp = Math.max(shared.uNight.value, lampDay, flash * 0.6)
    const emit = Math.max(world.state.emissive, lampDay, flash)
    if (Math.abs(lamp - shared.uLamp.value) > 0.001 || Math.abs(emit - shared.uEmissive.value) > 0.001) {
      shared.uLamp.value = lamp
      shared.uEmissive.value = emit
      house.syncLamps()
      active = true
    }
  R.renderer.toneMappingExposure = world.exposureFor(insideF)
    // ---- destaque pulsante nos detalhes
    if (current === 'details' && detailOn && mode === 'free') {
      inter.highlight(detailOn, 0.35 + 0.25 * Math.sin(now / 420))
      active = true
    }
    // ---- água e marcadores
    shared.uTime.value = now / 1000
    if (current === 'details') updateMarkers()
    if (current === 'explore') updateMe()
    // panéis editoriais
    for (const pn of panels) pn.el.classList.toggle('is-on', current === pn.sec && sec[pn.sec].p >= pn.at && sec[pn.sec].p < Math.min(1, pn.at + 0.42))
    const rendered = R.frame(now, active)
    // ---- qualidade adaptativa (ver comentário acima)
    if (rendered && now > quietUntil) {
      const st = R.stats(90)
      const g = R.gpuStats(90)
      // custo do quadro: GPU medida quando disponível; sem timer query, o intervalo de CPU (menos confiável)
      const cost = g && g.n >= 60 ? g.p50 : st && st.avg
      const i = ORDER.indexOf(R.profileName)
      if (cost) {
        const crit = cost > 50 // < 20 fps sustentados
        const slow = userQ ? crit : cost > 22 // < ~45 fps de capacidade
        if (slow && i > 0) {
          slowT += dt
          if (slowT > (crit ? 4 : 5)) {
            const to = ORDER[i - 1]
            changeProfile(to, `Qualidade reduzida para ${PROFILES[to].label}: a placa de vídeo não sustentou ${PROFILES[R.profileName].label} (${(1000 / cost).toFixed(0)} fps).`)
          }
        } else slowT = Math.max(0, slowT - dt * 0.5)
        // volta a subir (só no automático), com folga de 2× e sem oscilar
        if (!userQ && i < ORDER.indexOf(autoTop) && cost < 8 && now - lastChange > 20000) {
          fastT += dt
          if (fastT > 6) changeProfile(ORDER[i + 1], `Qualidade restaurada para ${PROFILES[ORDER[i + 1]].label}.`)
        } else fastT = 0
      }
      if (!fpsBadge.hidden && now % 400 < 17 && st) fpsBadge.textContent = `${PROFILES[R.profileName].label}\n${st.fps.toFixed(0)} fps · ${st.avg.toFixed(1)} ms\np95 ${st.p95.toFixed(1)} ms · ${st.calls} draws`
    }
    if (!qMenu.hidden && now % 500 < 17) {
      const st = R.stats(120)
      $('.q-fps').textContent = st ? `${st.fps.toFixed(0)} fps · ${st.avg.toFixed(1)} ms por quadro` : 'cena parada (sem renderizar)'
    }
  }

  const mEls = $$('.marker')
  function updateMarkers() {
    const w = innerWidth,
      h = innerHeight
    DETAILS.forEach((d, i) => {
      v3.copy(d.AT).project(camera)
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1 && camera.position.distanceTo(d.AT) < 60
      mEls[i].hidden = !vis
      if (vis) mEls[i].style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px)`
    })
  }
  const meDot = $('.explore-ui .plan .me')
  function updateMe() {
    if (!meDot) return
    const p = camera.position
    meDot.setAttribute('cx', ((p.x + 13) * 10).toFixed(1))
    meDot.setAttribute('cy', ((p.z - 1) * 10).toFixed(1))
  }

  // pronto: tira o carregamento e restaura a rolagem (troca de qualidade)
  camera.position.copy(SHOTS.intro[0].pos)
  look.copy(SHOTS.intro[0].tgt)
  camera.lookAt(look)
  desired.pos.copy(camera.position)
  desired.look.copy(look)
  requestAnimationFrame(frame)
  const y = Number(sessionStorage.getItem('nx-scroll') || 0)
  sessionStorage.removeItem('nx-scroll')
  if (y) scrollTo(0, y)
  ScrollTrigger.refresh()
  $('#loader').classList.add('is-done')
  document.documentElement.classList.add('ready')
  // automação de testes
  window.__nx = {
    stats: (n) => R.stats(n),
    info: () => ({ profile: R.profileName, ...house.stats(), timings: stage.timings }),
    scrollTo: (sel, frac = 0) => {
      const el = $(sel)
      const top = el.getBoundingClientRect().top + scrollY
      const y2 = top + (el.offsetHeight - innerHeight) * frac
      lenis ? lenis.scrollTo(y2, { immediate: true }) : scrollTo(0, y2)
      ScrollTrigger.update()
    },
    flyToRoom,
    openDetail,
    setOption: (g, o) => inter.setOption(g, o),
    setMood: (m) => stage.moodsReady.then(() => setMood(m)),
    frames: () => {
      R.frames.length = 0
      if (R.gpuMs) R.gpuMs.length = 0
    },
    gpu: () => R.gpuStats(),
    house,
    canvas: () => ({ css: [innerWidth, innerHeight], buffer: [R.renderer.domElement.width, R.renderer.domElement.height], dpr: R.renderer.getPixelRatio(), msaa: R.composer.renderTarget1.samples, shadow: R.p.shadow, lm: R.p.lm, tex: R.p.tex, profile: R.profileName }),
  }
}

// ---------------------------------------------------------------- ficha calculada do modelo
function fillFacts(plan) {
  const L = plan.lot
  const lot = (L.x1 - L.x0) * (L.y1 - L.y0)
  const area = (r) => (r[2] - r[0]) * (r[3] - r[1])
  // área construída fechada: térreo (24 × 12) + volume superior (21 × 11,2), pelas faces externas
  const ground = (12 + 12 + 0.25) * (16 - 4 + 0.25)
  const upper = (8.5 + 12.5 + 0.25) * (17.2 - 6 + 0.25)
  const varanda = plan.outdoor.find((o) => o.id === 'varanda')
  const gourmet = plan.outdoor.find((o) => o.id === 'gourmet')
  const pool = plan.pool
  const rooms = plan.rooms.length
  const fmt = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  const fmt1 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const intro = [
    ['Pavimentos', '2'],
    ['Ambientes internos', String(rooms)],
    ['Área construída', `${fmt(ground + upper)}<small>m²</small>`],
    ['Terreno', `${fmt(lot)}<small>m²</small>`],
  ]
  $('#facts-intro').innerHTML = intro.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')
  const sheet = [
    ['Terreno', `${L.x1 - L.x0} × ${L.y1 - L.y0}<small>m · ${fmt(lot)} m²</small>`],
    ['Área construída', `${fmt(ground + upper)}<small>m² fechados</small>`],
    ['Térreo', `${fmt(ground)}<small>m²</small>`],
    ['Superior', `${fmt(upper)}<small>m²</small>`],
    ['Varanda', `${fmt(area(varanda.rect))}<small>m²</small>`],
    ['Área gourmet', `${fmt(area(gourmet.rect))}<small>m² cobertos</small>`],
    ['Piscina', `${fmt1(pool.x1 - pool.x0)} × ${fmt1(pool.y1 - pool.y0)}<small>m</small>`],
    ['Pé-direito', `3,20 / 2,80<small>m</small>`],
  ]
  $('#facts-sheet').innerHTML = sheet.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')
}

// ---------------------------------------------------------------- plantas em SVG (a partir de plan.json)
function buildPlans(plan) {
  // recorte da casa: x ∈ [-13, 13], y ∈ [-18, 1] (Blender) → SVG x = x + 13, y = -y - 1 (norte para cima)
  // escala 10× (texto SVG com corpo muito pequeno perde acentos ao rasterizar)
  const S = 10
  const X = (x) => +((x + 13) * S).toFixed(2)
  const Y = (y) => +((-y - 1) * S).toFixed(2)
  const D = (d) => +(d * S).toFixed(2)
  const W = 26 * S,
    H = 18 * S
  const short = { 'Galeria e escada': 'Galeria', 'Armários da suíte': 'Armários', 'Banho da suíte': 'Banho', 'Banho master': 'Banho', 'Hall de entrada': 'Hall', 'Sala de jantar': 'Jantar', 'Sala de estar': 'Estar', 'Sala íntima': 'Sala íntima', 'Suíte master': 'Suíte master' }
  const label = (name, x0, y0, x1, y1) => {
    const w = x1 - x0
    const n = short[name] || name
    if (w < 1.9) return ''
    return `<text class="lbl" x="${X((x0 + x1) / 2)}" y="${Y((y0 + y1) / 2) + 2.2}">${n}</text>`
  }
  function floorSVG(f, interactive) {
    let s = ''
    if (f === 0) {
      const P = plan.pool
      s += `<rect class="pool" x="${X(P.x0)}" y="${Y(P.y1)}" width="${D(P.x1 - P.x0)}" height="${D(P.y1 - P.y0)}"/>`
    }
    for (const r of plan.rooms.filter((r) => r.floor === f)) {
      const [x0, y0, x1, y1] = r.rect
      s += `<rect class="room-r" data-room="${r.id}" x="${X(x0)}" y="${Y(y1)}" width="${D(x1 - x0)}" height="${D(y1 - y0)}" ${interactive ? `tabindex="0" role="button" aria-label="${r.name}"` : ''}><title>${r.name}</title></rect>`
      s += label(r.name, x0, y0, x1, y1)
    }
    for (const o of plan.outdoor.filter((o) => o.floor === f && ['gourmet', 'varanda'].includes(o.id))) {
      const [x0, y0, x1, y1] = o.rect
      s += `<rect class="out ${interactive ? 'room-r' : ''}" data-room="${o.id}" x="${X(x0)}" y="${Y(y1)}" width="${D(x1 - x0)}" height="${D(y1 - y0)}" ${interactive ? `tabindex="0" role="button" aria-label="${o.name}"` : ''}/>`
      s += label(o.name, x0, y0, x1, y1)
    }
    for (const w of plan.walls.filter((w) => w.floor === f)) {
      const [ax, ay] = w.a,
        [bx, by] = w.b,
        t = w.t
      const horiz = Math.abs(ay - by) < 1e-6
      const a0 = horiz ? Math.min(ax, bx) - t / 2 : Math.min(ay, by) - t / 2
      const a1 = horiz ? Math.max(ax, bx) + t / 2 : Math.max(ay, by) + t / 2
      const cuts = w.open.map((o) => [o[0], o[1]]).sort((p, q) => p[0] - q[0])
      let cur = a0
      const spans = []
      for (const [c0, c1] of cuts) {
        if (c0 > cur) spans.push([cur, c0])
        cur = Math.max(cur, c1)
      }
      if (cur < a1) spans.push([cur, a1])
      for (const [s0, s1] of spans) {
        if (horiz) s += `<rect class="wall" x="${X(s0)}" y="${Y(ay + t / 2)}" width="${D(s1 - s0)}" height="${D(t)}"/>`
        else s += `<rect class="wall" x="${X(ax - t / 2)}" y="${Y(s1)}" width="${D(t)}" height="${D(s1 - s0)}"/>`
      }
      // vidros: linha fina
      for (const o of w.open.filter((o) => ['glass', 'slide', 'window'].includes(o[4]))) {
        if (horiz) s += `<rect class="wall" style="opacity:.45" x="${X(o[0])}" y="${Y(ay) - 0.3}" width="${D(o[1] - o[0])}" height="0.6"/>`
        else s += `<rect class="wall" style="opacity:.45" x="${X(ax) - 0.3}" y="${Y(o[1])}" width="0.6" height="${D(o[1] - o[0])}"/>`
      }
    }
    return s
  }
  const ex = $('.explore-ui .plan')
  ex.setAttribute('viewBox', `0 0 ${W} ${H}`)
  ex.innerHTML = `<g data-floor="0">${floorSVG(0, true)}</g><g data-floor="1">${floorSVG(1, true)}</g><circle class="me" r="4.5" cx="-50" cy="-50"/>`
  for (const f of [0, 1]) {
    const s = $(`.plan-${f}`)
    s.setAttribute('viewBox', `0 0 ${W} ${H}`)
    s.innerHTML = floorSVG(f, false)
  }
}
