// Céu, iluminação e climas (dia, pôr do sol, noite) com transição suave na mesma cena.
import * as THREE from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { shared } from './materials.js'

const BASE = import.meta.env.BASE_URL + 'assets/sky/'

// Direções em coordenadas da cena (Y para cima, norte = -Z, sul/rua = +Z, oeste = -X).
// Verão no sudeste brasileiro: à tarde o sol vem de oés-sudoeste, iluminando a fachada da rua.
function dirFromAzEl(azDeg, elDeg) {
  // azimute a partir do norte (-Z) girando para leste (+X)
  const az = THREE.MathUtils.degToRad(azDeg)
  const el = THREE.MathUtils.degToRad(elDeg)
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
}

export const MOODS = {
  day: {
    label: 'Dia',
    sun: dirFromAzEl(228, 37),
    sunColor: new THREE.Color(1.0, 0.96, 0.9),
    sunIntensity: 5.2,
    envIntensity: 1.0,
    skyGain: 1.0,
    exposure: 1.15,
    insideExposure: 2.1,
    night: 0,
    emissive: 0,
    fog: new THREE.Color(0xc5d3e0),
    fogDensity: 0.00105,
    bgIntensity: 1.0,
  },
  sunset: {
    label: 'Pôr do sol',
    sun: dirFromAzEl(236, 9),
    sunColor: new THREE.Color(1.0, 0.6, 0.32),
    sunIntensity: 4.2,
    envIntensity: 1.15,
    skyGain: 1.0,
    exposure: 1.05,
    insideExposure: 1.9,
    night: 0.45,
    emissive: 0.45,
    fog: new THREE.Color(0xc9a58f),
    fogDensity: 0.0006,
    bgIntensity: 0.95,
  },
  night: {
    label: 'Noite',
    sun: dirFromAzEl(250, 3),
    sunColor: new THREE.Color(0.45, 0.5, 0.85),
    sunIntensity: 0.1,
    envIntensity: 0.16,
    skyGain: 1.0,
    exposure: 1.6,
    insideExposure: 1.5,
    night: 1.3,
    emissive: 1,
    fog: new THREE.Color(0x3a3c55),
    fogDensity: 0.0006,
    bgIntensity: 0.3,
  },
}

/** Desloca as colunas de um HDR equirretangular (rotação em torno de Y), em fração de volta. */
function shiftEquirect(tex, frac) {
  const { data, width, height } = tex.image
  const stride = data.length / (width * height)
  const k = ((Math.round(frac * width) % width) + width) % width
  if (!k) return
  const row = new data.constructor(width * stride)
  for (let y = 0; y < height; y++) {
    const o = y * width * stride
    for (let x = 0; x < width; x++) {
      const nx = (x + k) % width
      for (let c = 0; c < stride; c++) row[nx * stride + c] = data[o + x * stride + c]
    }
    data.set(row, o)
  }
  tex.needsUpdate = true
}

/** Encontra a direção do pixel mais brilhante (o sol) num HDR equirretangular. */
function brightestDir(tex) {
  const { data, width, height } = tex.image
  let best = -1
  let bi = 0
  const stride = data.length / (width * height)
  const toF = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (v) => v
  for (let i = 0; i < width * height; i += 3) {
    const y = Math.floor(i / width)
    if (y > height * 0.55) continue
    const r = toF(data[i * stride]),
      g = toF(data[i * stride + 1]),
      b = toF(data[i * stride + 2])
    const l = r * 0.2126 + g * 0.7152 + b * 0.0722
    if (l > best) {
      best = l
      bi = i
    }
  }
  const u = (bi % width) / width
  const v = Math.floor(bi / width) / height
  const phi = u * Math.PI * 2
  const theta = v * Math.PI
  // convenção equirretangular do three: u=0.5 aponta para -Z... medido empiricamente abaixo
  return { u, v, phi, theta, lum: best }
}

export class World {
  constructor(renderer, scene) {
    this.renderer = renderer
    this.scene = scene
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.envs = {}
    this.bgs = {}
    this.mood = 'day'
    this.state = { ...MOODS.day, sun: MOODS.day.sun.clone(), sunColor: MOODS.day.sunColor.clone(), fog: MOODS.day.fog.clone() }
    this.envRot = {}
    this.inside = 0

    this.sun = new THREE.DirectionalLight(0xffffff, 3)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(4096, 4096)
    const s = 32
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 160 })
    this.sun.shadow.bias = -0.00025
    this.sun.shadow.normalBias = 0.025
    this.sun.shadow.radius = 2.5
    this.sun.target.position.set(0, 0, 6)
    scene.add(this.sun, this.sun.target)

    // céu: esfera com panorama tonemapeado (nítido), cruzando entre dois panoramas
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: null },
        tB: { value: null },
        mixAB: { value: 0 },
        rotA: { value: 0 },
        rotB: { value: 0 },
        gain: { value: 1 },
        fogColor: { value: new THREE.Color() },
        horizonFog: { value: 0.35 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tA, tB; uniform float mixAB, rotA, rotB, gain, horizonFog; uniform vec3 fogColor;
        varying vec3 vDir;
        vec2 eq(vec3 d, float rot){ d = normalize(d); float u = atan(d.z, d.x) / 6.2831853 + 0.5 + rot; float v = asin(clamp(d.y,-1.0,1.0)) / 3.14159265 + 0.5; return vec2(fract(u), v); }
        void main(){
          vec3 a = texture2D(tA, eq(vDir, rotA)).rgb;
          vec3 b = texture2D(tB, eq(vDir, rotB)).rgb;
          vec3 c = mix(a, b, mixAB) * gain;
          float h = normalize(vDir).y;
          c = mix(c, fogColor, horizonFog * (1.0 - smoothstep(0.0, 0.16, h)));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), this.skyMat)
    this.sky.renderOrder = -1
    this.sky.frustumCulled = false
    scene.add(this.sky)
    scene.fog = new THREE.FogExp2(this.state.fog.clone(), this.state.fogDensity)
  }

  async loadMood(name, bgPx = 4096) {
    if (this.envs[name]) return
    const hdr = await new HDRLoader().loadAsync(BASE + name + '.hdr')
    hdr.mapping = THREE.EquirectangularReflectionMapping
    // gira o HDR (deslocando colunas) para o sol do HDR coincidir com a direção desejada do sol
    const b = brightestDir(hdr)
    const want = MOODS[name].sun
    const wantU = Math.atan2(want.z, want.x) / (Math.PI * 2) + 0.5
    const delta = wantU - b.u
    shiftEquirect(hdr, delta)
    this.envRot[name] = -delta // o céu amostra u - delta
    this.envs[name] = this.pmrem.fromEquirectangular(hdr).texture
    hdr.dispose()
    const bg = await new THREE.TextureLoader().loadAsync(BASE + `${name}_${bgPx}.webp`)
    bg.colorSpace = THREE.SRGBColorSpace
    bg.anisotropy = 4
    bg.generateMipmaps = true
    this.bgs[name] = bg
  }

  /** Aplica um clima imediatamente (sem transição). */
  apply(name) {
    this.mood = name
    const m = MOODS[name]
    Object.assign(this.state, { ...m, sun: m.sun.clone(), sunColor: m.sunColor.clone(), fog: m.fog.clone() })
    this.scene.environment = this.envs[name]
    this.skyMat.uniforms.tA.value = this.bgs[name]
    this.skyMat.uniforms.rotA.value = this.envRot[name]
    this.skyMat.uniforms.mixAB.value = 0
    this.envFrom = name
    this.sync()
  }

  /** Transição: interpola parâmetros e cruza o céu; o ambiente PMREM troca no meio. */
  transition(name, t, from) {
    const A = MOODS[from],
      B = MOODS[name]
    const k = t
    const st = this.state
    st.sun.copy(A.sun).lerp(B.sun, k).normalize()
    st.sunColor.copy(A.sunColor).lerp(B.sunColor, k)
    st.fog.copy(A.fog).lerp(B.fog, k)
    for (const key of ['sunIntensity', 'envIntensity', 'skyGain', 'exposure', 'insideExposure', 'night', 'emissive', 'fogDensity', 'bgIntensity'])
      st[key] = A[key] + (B[key] - A[key]) * k
    const u = this.skyMat.uniforms
    u.tA.value = this.bgs[from]
    u.rotA.value = this.envRot[from]
    u.tB.value = this.bgs[name]
    u.rotB.value = this.envRot[name]
    u.mixAB.value = k
    const envName = k < 0.5 ? from : name
    this.scene.environment = this.envs[envName]
    // compensa o salto de ambiente com a intensidade
    if (k >= 1) this.apply(name)
    else this.sync()
  }

  sync() {
    const st = this.state
    this.sun.position.copy(this.sun.target.position).addScaledVector(st.sun, 80)
    this.sun.color.copy(st.sunColor)
    this.sun.intensity = st.sunIntensity
    this.scene.environmentIntensity = st.envIntensity
    shared.uNight.value = st.night
    shared.uLamp.value = st.night
    shared.uSkyGain.value = st.skyGain
    shared.uEmissive.value = st.emissive
    // rebatimento: fração da luz solar devolvida pelo entorno (pisos claros, gramado, paredes)
    shared.uBounce.value.copy(st.sunColor).multiplyScalar(st.sunIntensity * 0.11 * Math.max(0, st.sun.y + 0.15))
    this.scene.fog.color.copy(st.fog)
    this.scene.fog.density = st.fogDensity
    this.skyMat.uniforms.gain.value = st.bgIntensity
    this.skyMat.uniforms.fogColor.value.copy(st.fog)
  }

  /** Exposição: um "olho" que se adapta ao entrar na casa. */
  exposureFor(insideFactor) {
    const st = this.state
    return st.exposure + (st.insideExposure - st.exposure) * insideFactor
  }
}
