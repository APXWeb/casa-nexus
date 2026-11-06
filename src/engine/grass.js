// Gramado com lâminas reais perto da câmera (perfis high e ultra).
// Touceiras de 5 lâminas (7 vértices cada) em InstancedBufferGeometry, divididas em chunks de 4 × 4 m sobre a malha
// 'lawn'. Uma máscara 2D (rasterização em planta das malhas da casa que ficam acima do gramado) impede lâminas sob
// pisos, deck, caminhos, canteiros e piscina. A raiz amostra a textura do gramado + a mesma variação macro do shader
// do lawn, e a iluminação usa o mesmo lightmap (UV2) do gramado: a lâmina nasce com a cor do chão onde está.
// Densidade cai com a distância (instâncias embaralhadas: cortar a contagem = rarear por igual) e some até o raio.
import * as THREE from 'three'
import { patchLightmap, shared } from './materials.js'
import { PROFILES, detectProfile } from './renderer.js'

const CHUNK = 4
const CELL = 0.05 // resolução da máscara (m)
const BLADES = 5
const T = [0, 0.38, 0.72, 1]

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/** Geometria-base de uma touceira: posição = (lado, t, 0); aBlade = (ox, oz, ângulo, altura); aBlade2 = (inclinação, cor). */
function tuftGeometry() {
  const rand = rng(11)
  const pos = [],
    b1 = [],
    b2 = [],
    idx = []
  for (let b = 0; b < BLADES; b++) {
    const r = Math.sqrt(rand()) * 0.06,
      a = rand() * Math.PI * 2
    const blade = [Math.cos(a) * r, Math.sin(a) * r, rand() * Math.PI * 2, 0.62 + rand() * 0.5]
    const lean = (0.12 + rand() * 0.45) * (rand() < 0.5 ? -1 : 1)
    const col = rand()
    const v0 = pos.length / 3
    for (let k = 0; k < T.length; k++) {
      const sides = k === T.length - 1 ? [0] : [-1, 1]
      for (const s of sides) {
        pos.push(s, T[k], 0)
        b1.push(...blade)
        b2.push(lean, col)
      }
    }
    // L0 R0 L1 R1 L2 R2 ponta
    idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4, v0 + 3, v0 + 5, v0 + 4, v0 + 4, v0 + 5, v0 + 6)
  }
  return {
    index: new THREE.BufferAttribute(new Uint16Array(idx), 1),
    position: new THREE.Float32BufferAttribute(pos, 3),
    // normal fictícia: sem o atributo o three força FLAT_SHADED (a normal real é calculada no vertex shader)
    normal: new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3),
    aBlade: new THREE.Float32BufferAttribute(b1, 4),
    aBlade2: new THREE.Float32BufferAttribute(b2, 2),
  }
}

// mapa afim (x, z) → uv a partir de 3 vértices não colineares de uma malha plana
function affineUv(pts, uvs) {
  const [p0, p1, p2] = pts
  const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])
  const solve = (c) => {
    const a = ((c[1] - c[0]) * (p2[1] - p0[1]) - (c[2] - c[0]) * (p1[1] - p0[1])) / det
    const b = ((p1[0] - p0[0]) * (c[2] - c[0]) - (p2[0] - p0[0]) * (c[1] - c[0])) / det
    return new THREE.Vector3(a, b, c[0] - a * p0[0] - b * p0[1])
  }
  return [solve(uvs.map((u) => u[0])), solve(uvs.map((u) => u[1]))]
}

/** Triângulos de uma malha em coordenadas de mundo (callback com 3 Vector3). */
function eachTri(mesh, cb) {
  const g = mesh.geometry,
    P = g.attributes.position,
    I = g.index
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3()
  const n = I ? I.count : P.count
  const mw = mesh.matrixWorld
  for (let i = 0; i < n; i += 3) {
    const i0 = I ? I.getX(i) : i,
      i1 = I ? I.getX(i + 1) : i + 1,
      i2 = I ? I.getX(i + 2) : i + 2
    a.fromBufferAttribute(P, i0).applyMatrix4(mw)
    b.fromBufferAttribute(P, i1).applyMatrix4(mw)
    c.fromBufferAttribute(P, i2).applyMatrix4(mw)
    cb(a, b, c, i0, i1, i2)
  }
}

/** Máscara do gramado livre: 1 = lawn visível de cima; 0 = fora do lawn ou coberto por outra malha. */
function buildMask(root, lawn, box) {
  const W = Math.ceil((box.max.x - box.min.x) / CELL),
    H = Math.ceil((box.max.z - box.min.z) / CELL)
  const lawnM = new Uint8Array(W * H),
    cov = new Uint8Array(W * H)
  const x0 = box.min.x,
    z0 = box.min.z
  // marca as células cujo centro cai no triângulo (projeção em planta)
  const raster = (buf, a, b, c) => {
    const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)
    if (Math.abs(area) < 1e-9) return
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / CELL)),
      i1 = Math.min(W - 1, Math.ceil((Math.max(a.x, b.x, c.x) - x0) / CELL))
    const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - z0) / CELL)),
      j1 = Math.min(H - 1, Math.ceil((Math.max(a.z, b.z, c.z) - z0) / CELL))
    const s = Math.sign(area)
    for (let j = j0; j <= j1; j++) {
      const pz = z0 + (j + 0.5) * CELL
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * CELL
        const w0 = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) * s
        const w1 = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) * s
        const w2 = ((a.x - px) * (b.z - pz) - (b.x - px) * (a.z - pz)) * s
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) buf[j * W + i] = 1
      }
    }
  }
  eachTri(lawn, (a, b, c) => raster(lawnM, a, b, c))
  const lawnY = box.max.y
  // candidatas: malhas visíveis que tocam o chão sobre o lote (pisos, deck, caminhos, canteiros, paredes, piscina)
  const cand = []
  const bb = new THREE.Box3()
  root.traverse((o) => {
    if (!o.isMesh || o === lawn || !o.visible || o.userData.temp) return
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)
    if (bb.max.x < box.min.x || bb.min.x > box.max.x || bb.max.z < box.min.z || bb.min.z > box.max.z) return
    if (bb.min.y > lawnY + 0.5 || bb.max.y < lawnY + 0.004) return
    const g = o.geometry
    cand.push({ o, box: bb.clone(), n: g.index ? g.index.count : g.attributes.position.count })
  })
  cand.sort((p, q) => p.n - q.n)
  let used = 0
  for (const { o, box: b } of cand) {
    // já inteiramente coberta (móveis dentro da casa etc.): pula sem rasterizar
    const i0 = Math.max(0, Math.floor((b.min.x - x0) / CELL)),
      i1 = Math.min(W - 1, Math.floor((b.max.x - x0) / CELL))
    const j0 = Math.max(0, Math.floor((b.min.z - z0) / CELL)),
      j1 = Math.min(H - 1, Math.floor((b.max.z - z0) / CELL))
    let open = false
    for (let j = j0; j <= j1 && !open; j++) for (let i = i0; i <= i1; i++) if (!cov[j * W + i] && lawnM[j * W + i]) { open = true; break }
    if (!open) continue
    used++
    eachTri(o, (a, b2, c) => {
      if (Math.max(a.y, b2.y, c.y) < lawnY + 0.004) return
      raster(cov, a, b2, c)
    })
  }
  // fechamento morfológico (raio 3 células = 15 cm): preenche frestas entre pisos (soleiras, trilhos de portas de
  // correr) por onde a grama brotava dentro da casa, sem recuar as bordas livres
  const morph = (src, r, dil) => {
    const tmp = new Uint8Array(W * H),
      dst = new Uint8Array(W * H)
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        let v = dil ? 0 : 1
        for (let d = -r; d <= r; d++) {
          const ii = Math.min(W - 1, Math.max(0, i + d))
          if (dil ? src[j * W + ii] : !src[j * W + ii]) { v = dil ? 1 : 0; break }
        }
        tmp[j * W + i] = v
      }
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        let v = dil ? 0 : 1
        for (let d = -r; d <= r; d++) {
          const jj = Math.min(H - 1, Math.max(0, j + d))
          if (dil ? tmp[jj * W + i] : !tmp[jj * W + i]) { v = dil ? 1 : 0; break }
        }
        dst[j * W + i] = v
      }
    return dst
  }
  // só dentro da projeção dos pisos da casa (fl_*): entre as pedras do caminho a grama continua
  const closed = morph(morph(cov, 3, true), 3, false)
  const inHouse = new Uint8Array(W * H)
  root.traverse((o) => {
    if (!o.isMesh || !/^fl_/.test(o.name)) return
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)
    const a0 = Math.max(0, Math.floor((bb.min.x - 0.2 - x0) / CELL)),
      a1 = Math.min(W - 1, Math.ceil((bb.max.x + 0.2 - x0) / CELL))
    const b0 = Math.max(0, Math.floor((bb.min.z - 0.2 - z0) / CELL)),
      b1 = Math.min(H - 1, Math.ceil((bb.max.z + 0.2 - z0) / CELL))
    for (let j = b0; j <= b1; j++) inHouse.fill(1, j * W + a0, j * W + a1 + 1)
  })
  for (let k = 0; k < W * H; k++) if (inHouse[k]) cov[k] = closed[k]
  // grama livre, com 1 célula (5 cm) de folga das bordas cobertas e do contorno do lawn
  const out = new Uint8Array(W * H)
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      let ok = 1
      for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) { const k = (j + dj) * W + i + di; if (cov[k] || !lawnM[k]) { ok = 0; break } }
      out[j * W + i] = ok
    }
  return { W, H, x0, z0, data: out, candidates: cand.length, rasterized: used }
}

// ---------------------------------------------------------------- shader
const VERT_DECL = /* glsl */ `
attribute vec4 aInst;
attribute vec4 aBlade;
attribute vec2 aBlade2;
uniform float uTime; uniform float uGrow; uniform float uGY; uniform float uGH; uniform float uGW;
uniform vec4 uLod; // raio, início do rareamento, fim do rareamento, densidade final
uniform vec3 uU0; uniform vec3 uV0; uniform vec3 uU1; uniform vec3 uV1; uniform vec3 uTint;
uniform sampler2D uLawnMap;
varying float vT; varying vec3 vCol;
vec3 gPos;
float gh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
`
const VERT_BODY = /* glsl */ `
  vec2 rootP = aInst.xy;
  float hI = gh(rootP);
  float dCam = distance(cameraPosition, vec3(rootP.x, uGY, rootP.y));
  float far = smoothstep(uLod.y, uLod.z, dCam);
  float dens = mix(1.0, uLod.w, far);
  // rareamento contínuo (posto da instância vs. densidade) e desaparecimento suave até o raio
  float keep = 1.0 - smoothstep(dens * 0.8, dens, aInst.w);
  float k = keep * (1.0 - smoothstep(uLod.x * 0.62, uLod.x, dCam)) * uGrow;
  float ca = cos(aInst.z), sa = sin(aInst.z);
  vec2 base = rootP + mat2(ca, sa, -sa, ca) * aBlade.xy;
  float ang = aInst.z + aBlade.z;
  vec2 fdir = vec2(cos(ang), sin(ang));
  vec2 bdir = vec2(-fdir.y, fdir.x);
  vec3 mac = lawnMacro(base);
  float H = uGH * aBlade.w * (0.72 + 0.56 * hI) * (0.8 + 0.25 * mac.g) * k;
  float t = position.y;
  // vento: rajadas que atravessam o gramado + tremor fino por lâmina
  vec2 wd = normalize(vec2(0.82, 0.57));
  float gust = sin(dot(base, wd) * 0.9 - uTime * 1.6) * 0.5 + 0.5;
  gust = gust * gust * (0.6 + 0.4 * sin(dot(base, vec2(-0.31, 0.47)) * 0.7 + uTime * 0.53));
  float flick = sin(uTime * 4.3 + hI * 6.2831 + aBlade2.y * 9.0) * 0.06;
  vec2 bend = bdir * aBlade2.x + wd * (gust * 0.32 + flick);
  float bl = dot(bend, bend);
  vec3 p = vec3(base.x, uGY, base.y);
  p.xz += bend * H * t * t;
  p.y += H * t * (1.0 - 0.35 * bl);
  // largura: afina até a ponta; alarga longe para compensar o rareamento e não sumir no subpixel
  float wdt = uGW * (0.8 + 0.4 * hI) * pow(1.0 - t, 0.75) * (1.0 + 1.3 * far) * step(0.001, k);
  p.xz += fdir * position.x * wdt * 0.5;
  gPos = p;
  // normal: face da lâmina voltada para a câmera, puxada para cima (casa com o sombreamento do chão)
  vec3 fn = vec3(bdir.x, 0.0, bdir.y);
  if (dot(fn, cameraPosition - p) < 0.0) fn = -fn;
  vec3 objectNormal = normalize(mix(fn, vec3(0.0, 1.0, 0.0), 0.72 + 0.2 * t));
  // cor da raiz = cor média local da textura do gramado × tom × variação macro (mesma função do shader do lawn)
  vec3 g = vec3(base, 1.0);
  vec2 luv = vec2(dot(uU0, g), dot(uV0, g));
  vec3 c1 = textureLod(uLawnMap, luv, 4.0).rgb;
  vec3 c2 = textureLod(uLawnMap, luv * 0.23 + vec2(0.31, 0.17), 3.0).rgb;
  vec3 groundC = mix(c1, c2, 0.3) * uTint * mac;
  // a textura do gramado traz folhas secas e terra (média oliva): a lâmina viva puxa para o verde com a mesma luminância
  float gl = dot(groundC, vec3(0.2126, 0.7152, 0.0722));
  vCol = mix(groundC, gl * vec3(0.66, 1.13, 0.42), 0.5 + 0.3 * t);
  // ponta um pouco mais clara e viçosa (sem amarelar: amarelo lê como palha)
  vCol *= mix(vec3(0.9), vec3(0.98, 1.08, 0.86) * (0.86 + 0.24 * aBlade2.y), t);
  vT = t;
  vLmUv = vec2(dot(uU1, g), dot(uV1, g));
`
const FRAG_DECL = /* glsl */ `
varying float vT; varying vec3 vCol;
`

/**
 * Cria o gramado de lâminas. Retorna null se o perfil não usa grama ou se a malha 'lawn' não existe.
 * @param scene cena já com a casa carregada
 * @param grow uniforme de crescimento (paisagismo da construção)
 */
export function createGrass(scene, grow = { value: 1 }) {
  const prof = PROFILES[detectProfile()]
  const cfg = prof?.grass
  if (!cfg) return null
  const t0 = performance.now()
  let lawn = null
  scene.traverse((o) => {
    if (o.isMesh && o.userData.lawn && !lawn) lawn = o
  })
  const root = scene.getObjectByName('casa')
  if (!lawn || !root || !lawn.material?.userData?.lm) return null
  root.updateMatrixWorld(true)
  lawn.geometry.computeBoundingBox()
  const box = lawn.geometry.boundingBox.clone().applyMatrix4(lawn.matrixWorld)
  const mask = buildMask(root, lawn, box)
  const lawnY = box.max.y

  // UV0 (textura) e UV1 (lightmap) do lawn como funções afins de (x, z)
  const g = lawn.geometry
  const pts = [],
    uv0 = [],
    uv1 = []
  const v = new THREE.Vector3()
  for (let i = 0; i < g.attributes.position.count && pts.length < 3; i++) {
    v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(lawn.matrixWorld)
    const q = [v.x, v.z]
    if (pts.length === 2) {
      const [a, b] = pts
      if (Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (q[0] - a[0]) * (b[1] - a[1])) < 1e-3) continue
    } else if (pts.length === 1 && Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]) < 1e-3) continue
    pts.push(q)
    uv0.push([g.attributes.uv.getX(i), g.attributes.uv.getY(i)])
    uv1.push(g.attributes.uv1 ? [g.attributes.uv1.getX(i), g.attributes.uv1.getY(i)] : [0, 0])
  }
  const [U0, V0] = affineUv(pts, uv0)
  const [U1, V1] = affineUv(pts, uv1)

  // material: PBR padrão + o mesmo lightmap do gramado (uniformes compartilhados com o lawn)
  const lawnMat = lawn.material
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.75 })
  m.name = 'grama_laminas'
  m.userData.extraKey = 'grass'
  patchLightmap(m, { constOcc: 1 })
  for (const k of ['lmTex', 'lmOn', 'lmSkyMax', 'lmNightMax', 'lmDayA', 'lmDayB', 'lmDayOn', 'lmDayMax']) m.userData.lm[k] = lawnMat.userData.lm[k]
  const uniforms = {
    uTime: shared.uTime,
    uGrow: grow,
    uGY: { value: lawnY - 0.004 },
    uGH: { value: cfg.height ?? 0.09 },
    uGW: { value: cfg.width ?? 0.009 },
    uLod: { value: new THREE.Vector4(cfg.radius, 7, cfg.radius * 0.8, 0.2) },
    uU0: { value: U0 },
    uV0: { value: V0 },
    uU1: { value: U1 },
    uV1: { value: V1 },
    uTint: { value: lawnMat.color.clone() },
    uLawnMap: { value: lawnMat.map },
  }
  const lmCompile = m.onBeforeCompile
  m.onBeforeCompile = (sh, r) => {
    lmCompile(sh, r)
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL + (lawnMat.userData.lawnGLSL || 'vec3 lawnMacro(vec2 p){return vec3(1.0);}'))
      .replace('#include <beginnormal_vertex>', VERT_BODY)
      .replace('#include <begin_vertex>', 'vec3 transformed = gPos;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      // oclusão na base da touceira (a luz entra pouco entre as lâminas)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vCol * mix(0.66, 1.0, smoothstep(0.0, 0.6, vT));')
      // a normal já vem voltada para a câmera: sem inversão na face de trás (senão a lâmina escurece)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
      .replace(
        '#include <lights_fragment_end>',
        // contraluz: o sol atravessa as lâminas (directLight = último direcional, já com a sombra)
        `#include <lights_fragment_end>
         #if NUM_DIR_LIGHTS > 0
           float gbl = pow(clamp(dot(normalize(vViewPosition), -directLight.direction), 0.0, 1.0), 4.0);
           reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * gbl * 0.25 * vT;
         #endif`,
      )
  }

  // instâncias: amostragem estratificada com jitter só onde a máscara libera, por chunk, embaralhadas
  const base = tuftGeometry()
  const rand = rng(1234)
  const dens = cfg.density
  const s = 1 / Math.sqrt(dens)
  const group = new THREE.Group()
  group.name = 'grama'
  const chunks = []
  let total = 0
  for (let cz = box.min.z; cz < box.max.z - 0.01; cz += CHUNK)
    for (let cx = box.min.x; cx < box.max.x - 0.01; cx += CHUNK) {
      const list = []
      const ex = Math.min(cx + CHUNK, box.max.x),
        ez = Math.min(cz + CHUNK, box.max.z)
      for (let z = cz; z < ez; z += s)
        for (let x = cx; x < ex; x += s) {
          const px = x + rand() * s,
            pz = z + rand() * s
          if (px >= ex || pz >= ez) continue
          const i = Math.floor((px - mask.x0) / CELL),
            j = Math.floor((pz - mask.z0) / CELL)
          if (i < 0 || j < 0 || i >= mask.W || j >= mask.H || !mask.data[j * mask.W + i]) continue
          list.push([px, pz, rand() * Math.PI * 2])
        }
      if (!list.length) continue
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[list[i], list[j]] = [list[j], list[i]]
      }
      const arr = new Float32Array(list.length * 4)
      list.forEach((it, i) => arr.set([it[0], it[1], it[2], (i + 0.5) / list.length], i * 4))
      const geo = new THREE.InstancedBufferGeometry()
      geo.setIndex(base.index)
      geo.setAttribute('position', base.position)
      geo.setAttribute('normal', base.normal)
      geo.setAttribute('aBlade', base.aBlade)
      geo.setAttribute('aBlade2', base.aBlade2)
      geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(arr, 4))
      geo.instanceCount = list.length
      const c = new THREE.Vector3((cx + ex) / 2, lawnY + 0.08, (cz + ez) / 2)
      geo.boundingSphere = new THREE.Sphere(c, Math.hypot(ex - cx, ez - cz) / 2 + 0.25)
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(cx - 0.2, lawnY - 0.01, cz - 0.2), new THREE.Vector3(ex + 0.2, lawnY + 0.3, ez + 0.2))
      const mesh = new THREE.Mesh(geo, m)
      mesh.name = 'grama_chunk'
      mesh.matrixAutoUpdate = false
      mesh.castShadow = false
      mesh.receiveShadow = true
      const ch = { mesh, n: list.length, x0: cx, x1: ex, z0: cz, z1: ez }
      // contagem exata para a câmera desta renderização (vale também para câmeras auxiliares)
      mesh.onBeforeRender = (r, sc, cam) => {
        geo.instanceCount = countFor(ch, cam)
      }
      chunks.push(ch)
      group.add(mesh)
      total += list.length
    }
  const L = uniforms.uLod.value
  const sm = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const cp = new THREE.Vector3()
  const distTo = (ch, p) => {
    const dx = Math.max(ch.x0 - p.x, 0, p.x - ch.x1),
      dz = Math.max(ch.z0 - p.z, 0, p.z - ch.z1),
      dy = p.y - lawnY
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  function countFor(ch, cam) {
    cp.setFromMatrixPosition(cam.matrixWorld)
    const d = distTo(ch, cp)
    if (d > L.x) return 0
    const dn = 1 + (L.w - 1) * sm(L.y, L.z, Math.max(0, d - 0.5))
    return Math.min(ch.n, Math.ceil(ch.n * dn) + 8)
  }

  // controle por quadro (um objeto que nunca desenha): liga só os chunks dentro do raio e acompanha o perfil
  // atual (o perfil adaptativo troca o tamanho da sombra do sol: é por ele que se sabe o perfil vigente)
  let sun = null
  scene.traverse((o) => {
    if (o.isDirectionalLight && o.castShadow && !sun) sun = o
  })
  const ctlGeo = new THREE.BufferGeometry()
  ctlGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
  ctlGeo.setDrawRange(0, 0)
  const ctl = new THREE.Mesh(ctlGeo, new THREE.MeshBasicMaterial())
  ctl.name = 'grama_controle'
  ctl.frustumCulled = false
  let forced = null
  ctl.onBeforeRender = (r, sc, cam) => {
    if (cam.parent?.type === 'CubeCamera') return
    let on = true
    if (sun) {
      const p = Object.values(PROFILES).find((q) => q.shadow === sun.shadow.mapSize.x)
      if (p) on = !!p.grass
    }
    if (forced !== null) on = forced
    group.visible = on && grow.value > 0.001
    if (lawnMat.userData.grassR) lawnMat.userData.grassR.value = group.visible ? L.x : 0
    if (!group.visible) return
    cp.setFromMatrixPosition(cam.matrixWorld)
    for (const ch of chunks) ch.mesh.visible = distTo(ch, cp) < L.x + 2
  }
  scene.add(group, ctl)
  const info = { tufts: total, blades: total * BLADES, chunks: chunks.length, maskCandidates: mask.candidates, maskRasterized: mask.rasterized, ms: Math.round(performance.now() - t0) }
  // automação de testes: liga/desliga para medir o custo (window.__nxGrass.on(false))
  window.__nxGrass = {
    info: () => ({ ...info, visible: group.visible, drawn: chunks.filter((c) => c.mesh.visible).length, instances: chunks.reduce((a, c) => a + (c.mesh.visible ? c.mesh.geometry.instanceCount : 0), 0) }),
    on: (v) => (forced = v === undefined ? null : !!v),
    mask,
  }
  return { group, info, material: m }
}
