// Céu, iluminação e climas (dia, pôr do sol, noite) com transição suave na mesma cena.
import * as THREE from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { shared } from './materials.js'

const BASE = import.meta.env.BASE_URL + 'assets/sky/'

// ---------------------------------------------------------------------------------------------------------------
// Céu na mesma curva da cena. Os panoramas WebP já vêm revelados (tonemapeados) do HDR; como o OutputPass aplica
// AgX + exposição em todos os pixels, o céu passava duas vezes pela curva e estourava com a exposição interna.
// Aqui o texel é levado de volta à luz linear da cena pelo inverso exato do AgX do three (r187) dividido pela
// exposição de referência do clima: com a câmera fora, o OutputPass devolve o panorama original (nítido, 8k; só os
// brancos acima de ~0,87 sRGB passam por um joelho suave, para não acender o bloom); dentro, o céu acompanha só 25%
// da adaptação do olho (uniform "comp", SKY_COMP). O HDR linear (2k) serviria, mas o fundo ficaria até 4× mais borrado.
// Matrizes no layout do GLSL (colunas), iguais às de tonemapping_pars_fragment; as inversas foram calculadas com Matrix3.invert.
const AGX_INV_GLSL = /* glsl */ `
  float nxSig(float x){ float x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
  vec3 nxSig(vec3 x){ vec3 x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
  vec3 nxSigD(vec3 x){ vec3 x2 = x * x, x4 = x2 * x2; return 93.0 * x4 * x - 200.7 * x4 + 127.84 * x2 * x - 20.604 * x2 + 0.8596 * x + 0.1191; }
  // display linear (0..1) -> luz linear da cena que o AgX com exposição 1 transformaria nesse valor
  vec3 nxAgxInverse(vec3 y){
    const mat3 S2R = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    const mat3 R2S = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
    const mat3 OUTi = mat3(vec3(0.899797, 0.111421, 0.111421), vec3(0.0872, 0.875576, 0.0872), vec3(0.013003, 0.013003, 0.801379));
    const mat3 INi = mat3(vec3(1.197441, -0.196475, -0.146557), vec3(-0.144262, 1.354095, -0.108284), vec3(-0.05318, -0.157621, 1.254841));
    vec3 c = S2R * clamp(y, 0.0, 0.985);
    c = OUTi * pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
    c = clamp(c, vec3(-0.00232), vec3(0.99858));
    // inverso do sigmoide polinomial por Newton (monotônico em [0,1]; 5 passos: erro < 1e-6)
    vec3 s = clamp(0.12 + 0.8 * c, 0.0, 1.0);
    for (int i = 0; i < 5; i++) s = clamp(s - (nxSig(s) - c) / nxSigD(s), 0.0, 1.0);
    c = exp2(s * (4.026069 + 12.47393) - 12.47393);
    return max(R2S * (INi * c), vec3(0.0));
  }`

// mesma conta em JS (para a tabela da névoa, montada uma vez por clima)
const AGX_M = {
  S2R: [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956],
  R2S: [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187],
  OUTi: [0.899797, 0.111421, 0.111421, 0.0872, 0.875576, 0.0872, 0.013003, 0.013003, 0.801379],
  INi: [1.197441, -0.196475, -0.146557, -0.144262, 1.354095, -0.108284, -0.05318, -0.157621, 1.254841],
}
const mulCol = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]]
const agxSig = (x) => {
  const x2 = x * x,
    x4 = x2 * x2
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232
}
const agxSigD = (x) => 93 * x ** 5 - 200.7 * x ** 4 + 127.84 * x ** 3 - 20.604 * x ** 2 + 0.8596 * x + 0.1191
function agxInverse(y) {
  let c = mulCol(AGX_M.S2R, y.map((v) => Math.min(Math.max(v, 0), 0.985)))
  c = mulCol(AGX_M.OUTi, c.map((v) => Math.pow(Math.max(v, 0), 1 / 2.2)))
  c = c.map((v) => {
    const t = Math.min(Math.max(v, -0.00232), 0.99858)
    let s = Math.min(1, Math.max(0, 0.12 + 0.8 * t))
    for (let i = 0; i < 5; i++) s = Math.min(1, Math.max(0, s - (agxSig(s) - t) / agxSigD(s)))
    return Math.pow(2, s * (4.026069 + 12.47393) - 12.47393)
  })
  return mulCol(AGX_M.R2S, mulCol(AGX_M.INi, c)).map((v) => Math.max(v, 0))
}

// ---------------------------------------------------------------------------------------------------------------
// Perspectiva aérea: a névoa deixa de ser uma cor única. A cor vem do próprio céu na direção da vista (tabela
// equirretangular borrada do hemisfério superior, em luz linear da cena, dois climas lado a lado para a transição),
// mais o lóbulo de espalhamento do sol tingido por sunColor; a densidade cresce com a distância e é mais alta no vale
// (integral analítica da densidade exponencial com a altura ao longo do raio câmera → ponto).
// Vale para todos os materiais embutidos do three (standard, physical, lambert, phong, basic, toon): os uniforms
// entram no ShaderLib (os vetores são Float32Array, copiados por referência pelo cloneUniforms; a textura devolve a
// si mesma no clone). ShaderMaterial, pontos e sprites seguem com a névoa padrão, na cor média do horizonte.
const FOG_W = 128,
  FOG_H = 32 // por clima: 128 colunas de azimute × 32 linhas de elevação (0° a 90°)
// cloneUniforms clona texturas por material; os clones nunca viam a troca de dados (needsUpdate só no original).
// Devolvendo a própria instância no clone, todos os materiais usam o mesmo objeto e a mesma textura de GPU.
class SharedDataTexture extends THREE.DataTexture {
  clone() {
    return this
  }
}
export const skyFog = {
  tex: new SharedDataTexture(new Uint16Array(FOG_W * FOG_H * 2 * 4), FOG_W, FOG_H * 2, THREE.RGBAFormat, THREE.HalfFloatType),
  // x: escala da densidade (× fogDensity da cena), y: 1/altura de escala (1/m), z: altura do fundo do vale (m), w: distância livre (m)
  P: new Float32Array([0.55, 1 / 140, -5, 120]),
  // x: piso de densidade em altitude, y: ganho do céu (bgIntensity × compensação), z: mistura A→B, w: expoente do lóbulo
  Q: new Float32Array([0.3, 1, 0, 7]),
  sun: new Float32Array([0, 1, 0]),
  sunCol: new Float32Array([0, 0, 0]),
}
skyFog.tex.magFilter = skyFog.tex.minFilter = THREE.LinearFilter
skyFog.tex.wrapS = THREE.RepeatWrapping
skyFog.tex.wrapT = THREE.ClampToEdgeWrapping
skyFog.tex.generateMipmaps = false
skyFog.tex.needsUpdate = true

const FOG_SAMPLE_GLSL = /* glsl */ `
  // cor do céu borrado (tabela linear) na direção v; abaixo do horizonte usa a faixa do horizonte
  vec3 nxSkyTable(vec3 v){
    vec3 d = normalize(vec3(v.x, max(v.y, 0.0), v.z));
    float u = atan(d.z, d.x) * 0.15915494 + 0.5;
    float e = clamp(asin(d.y) * 0.63661977, 0.0, 1.0) * ${(FOG_H - 1).toFixed(1)} + 0.5;
    vec3 a = texture2D(nxFogTex, vec2(u, e / ${(FOG_H * 2).toFixed(1)})).rgb;
    vec3 b = texture2D(nxFogTex, vec2(u, (e + ${FOG_H.toFixed(1)}) / ${(FOG_H * 2).toFixed(1)})).rgb;
    return mix(a, b, nxFogQ.z);
  }
  vec3 nxFogCol(vec3 v){
    float mu = max(dot(v, nxSun), 0.0);
    // leve viés azul do espalhamento Rayleigh (o céu borrado mistura nuvens brancas); o horizonte do céu usa a mesma cor
    return (nxSkyTable(v) * vec3(0.95, 0.985, 1.05) + nxSunCol * pow(mu, nxFogQ.w)) * nxFogQ.y;
  }`

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	#ifdef NX_SKYFOG
		varying vec3 vNxFogRel;
	#endif
#endif
`
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	#ifdef NX_SKYFOG
		// vetor câmera → vértice em coordenadas de mundo (a rotação da câmera é a transposta da parte 3×3 da viewMatrix)
		vNxFogRel = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
	#endif
#endif
`
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	#ifdef NX_SKYFOG
		varying vec3 vNxFogRel;
		uniform sampler2D nxFogTex;
		uniform vec4 nxFogP;
		uniform vec4 nxFogQ;
		uniform vec3 nxSun;
		uniform vec3 nxSunCol;
		${FOG_SAMPLE_GLSL}
	#endif
#endif
`
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#if defined( NX_SKYFOG ) && defined( FOG_EXP2 )
		float nxL = length( vNxFogRel );
		vec3 nxV = vNxFogRel / max( nxL, 1e-4 );
		// densidade relativa média ao longo do raio: exp(-(y - y0)/H) integrada da câmera até o ponto
		float nxK = vNxFogRel.y * nxFogP.y;
		float nxAvg = abs( nxK ) > 1e-3 ? ( 1.0 - exp( - nxK ) ) / nxK : 1.0 - 0.5 * nxK;
		float nxRho = exp( - ( cameraPosition.y - nxFogP.z ) * nxFogP.y ) * nxAvg;
		float nxTau = fogDensity * nxFogP.x * max( nxL - nxFogP.w, 0.0 ) * ( nxFogQ.x + nxRho );
		float fogFactor = 1.0 - exp( - nxTau );
		// casa e jardim ficam dentro da distância livre: pula a amostra do céu (atan, asin e duas leituras)
		if ( fogFactor > 0.0 ) gl_FragColor.rgb = mix( gl_FragColor.rgb, nxFogCol( nxV ), fogFactor );
	#else
		#ifdef FOG_EXP2
			float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		#else
			float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		#endif
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#endif
#endif
`
for (const k of ['standard', 'physical', 'lambert', 'phong', 'basic', 'toon']) {
  const L = THREE.ShaderLib[k]
  if (!L) continue
  if (!L.vertexShader.startsWith('#define NX_SKYFOG')) {
    L.vertexShader = '#define NX_SKYFOG\n' + L.vertexShader
    L.fragmentShader = '#define NX_SKYFOG\n' + L.fragmentShader
  }
  Object.assign(L.uniforms, { nxFogTex: { value: skyFog.tex }, nxFogP: { value: skyFog.P }, nxFogQ: { value: skyFog.Q }, nxSun: { value: skyFog.sun }, nxSunCol: { value: skyFog.sunCol } })
}

/** Tabela da névoa de um clima: céu reduzido, girado como o céu (rot), borrado e levado à luz linear da cena. */
async function buildFogTable(img, rot, exposure) {
  const SW = 256,
    SH = 128
  let src = img
  try {
    src = await createImageBitmap(img, { resizeWidth: SW, resizeHeight: SH, resizeQuality: 'high' })
  } catch {}
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(SW, SH) : Object.assign(document.createElement('canvas'), { width: SW, height: SH })
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0, SW, SH)
  const px = ctx.getImageData(0, 0, SW, SH).data
  const lin = (v) => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  // amostra bilinear do panorama reduzido (u com repetição; v=1 no zênite, linha 0 da imagem)
  const sample = (u, v, out) => {
    const x = (((u % 1) + 1) % 1) * SW - 0.5,
      y = (1 - v) * SH - 0.5
    const x0 = Math.floor(x),
      y0 = Math.min(SH - 1, Math.max(0, Math.floor(y))),
      y1 = Math.min(SH - 1, y0 + 1)
    const fx = x - x0,
      fy = Math.min(1, Math.max(0, y - y0))
    for (let c = 0; c < 3; c++) {
      const p = (xx, yy) => lin(px[(yy * SW + (((xx % SW) + SW) % SW)) * 4 + c])
      out[c] = (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) + (p(x0, y1) * (1 - fx) + p(x0 + 1, y1) * fx) * fy
    }
  }
  // grade em espaço de display (como o céu é visto), borrada antes da inversão
  let grid = new Float32Array(FOG_W * FOG_H * 3)
  const tmp = [0, 0, 0]
  for (let j = 0; j < FOG_H; j++) {
    const el = (j / (FOG_H - 1)) * (Math.PI / 2)
    for (let i = 0; i < FOG_W; i++) {
      // mesma convenção do shader do céu: u = atan(z, x)/2π + 0.5 + rot
      sample((i + 0.5) / FOG_W + rot, 0.5 + el / Math.PI, tmp)
      grid.set(tmp, (j * FOG_W + i) * 3)
    }
  }
  // borrão separável (duas passadas de caixa ≈ gaussiano de ~±7°), azimute circular
  const blur = (g, rx, ry) => {
    const o = new Float32Array(g.length)
    for (let j = 0; j < FOG_H; j++)
      for (let i = 0; i < FOG_W; i++)
        for (let c = 0; c < 3; c++) {
          let s = 0
          for (let k = -rx; k <= rx; k++) s += g[(j * FOG_W + (((i + k) % FOG_W) + FOG_W) % FOG_W) * 3 + c]
          o[(j * FOG_W + i) * 3 + c] = s / (2 * rx + 1)
        }
    const o2 = new Float32Array(g.length)
    for (let j = 0; j < FOG_H; j++)
      for (let i = 0; i < FOG_W; i++)
        for (let c = 0; c < 3; c++) {
          let s = 0
          for (let k = -ry; k <= ry; k++) s += o[(Math.min(FOG_H - 1, Math.max(0, j + k)) * FOG_W + i) * 3 + c]
          o2[(j * FOG_W + i) * 3 + c] = s / (2 * ry + 1)
        }
    return o2
  }
  grid = blur(blur(grid, 2, 1), 2, 1)
  const out = new Float32Array(FOG_W * FOG_H * 4)
  for (let p = 0; p < FOG_W * FOG_H; p++) {
    const l = agxInverse([grid[p * 3], grid[p * 3 + 1], grid[p * 3 + 2]])
    out[p * 4] = l[0] / exposure
    out[p * 4 + 1] = l[1] / exposure
    out[p * 4 + 2] = l[2] / exposure
    out[p * 4 + 3] = 1
  }
  return out
}

// Direções em coordenadas da cena (Y para cima, norte = -Z, sul/rua = +Z, oeste = -X).
// Hemisfério sul: à tarde o sol vem do noroeste e entra pela fachada norte envidraçada (sala, jantar e suítes),
// como o texto do site descreve; no poente, de oés-noroeste, rasante sobre o jardim e a piscina.
function dirFromAzEl(azDeg, elDeg) {
  // azimute a partir do norte (-Z) girando para leste (+X)
  const az = THREE.MathUtils.degToRad(azDeg)
  const el = THREE.MathUtils.degToRad(elDeg)
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
}

export const MOODS = {
  day: {
    label: 'Dia',
    sun: dirFromAzEl(306, 40),
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
    haze: 0.55, // escala da densidade da perspectiva aérea
    hazeH: 140, // altura de escala da névoa no vale (m)
    lobe: 0.05, // lóbulo do sol na névoa (× sunIntensity)
    bgIntensity: 1.0,
    giDay: 1,
    giSunset: 0,
  },
  sunset: {
    label: 'Pôr do sol',
    sun: dirFromAzEl(290, 9),
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
    haze: 0.7,
    hazeH: 110,
    lobe: 0.07,
    bgIntensity: 0.95,
    giDay: 0,
    giSunset: 1,
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
    haze: 0.6,
    hazeH: 120,
    lobe: 0.05,
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

// quanto da adaptação do "olho" o céu acompanha: 0 = céu segue a exposição inteira (estoura nas janelas), 1 = céu fixo
const SKY_COMP = 0.75

export class World {
  constructor(renderer, scene) {
    this.renderer = renderer
    this.scene = scene
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.envs = {}
    this.bgs = {}
    this.fogTables = {}
    this.fogSlots = [null, null] // clima gravado em cada metade da tabela da névoa (A, B)
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

    // céu: esfera com o panorama nítido (8k) levado à luz linear da cena, cruzando entre dois climas
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: null },
        tB: { value: null },
        mixAB: { value: 0 },
        rotA: { value: 0 },
        rotB: { value: 0 },
        invExpA: { value: 1 },
        invExpB: { value: 1 },
        gain: { value: 1 },
        comp: { value: 1 },
        horizon: { value: 0.5 },
        nxFogTex: { value: skyFog.tex },
        nxFogQ: { value: skyFog.Q },
        nxSun: { value: skyFog.sun },
        nxSunCol: { value: skyFog.sunCol },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tA, tB; uniform float mixAB, rotA, rotB, invExpA, invExpB, gain, comp, horizon;
        uniform sampler2D nxFogTex; uniform vec4 nxFogQ; uniform vec3 nxSun, nxSunCol;
        varying vec3 vDir;
        ${AGX_INV_GLSL}
        ${FOG_SAMPLE_GLSL}
        vec2 eq(vec3 d, float rot){ float u = atan(d.z, d.x) / 6.2831853 + 0.5 + rot; float v = asin(clamp(d.y,-1.0,1.0)) / 3.14159265 + 0.5; return vec2(fract(u), v); }
        void main(){
          vec3 d = normalize(vDir);
          // texel sRGB já decodificado = valor exibido; inverso do AgX / exposição do clima = luz da cena
          vec3 c = nxAgxInverse(texture2D(tA, eq(d, rotA)).rgb) * invExpA;
          if (mixAB > 0.0) c = mix(c, nxAgxInverse(texture2D(tB, eq(d, rotB)).rgb) * invExpB, mixAB);
          c *= gain * comp;
          // joelho suave nos brancos (nuvens ao sol): assíntota 2,15, abaixo do limiar do bloom (2,2); sem isso o céu
          // inteiro em volta do sol virava um halo que lavava as fachadas
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          if (l > 1.6) c *= (1.6 + 0.55 * (1.0 - exp(-(l - 1.6) / 0.55))) / l;
          // faixa do horizonte: funde com a mesma cor da névoa (céu borrado + lóbulo do sol), sem degrau no recorte das serras
          c = mix(c, nxFogCol(d), horizon * (1.0 - smoothstep(-0.02, 0.1, d.y)));
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
    // a exposição muda a cada quadro (olho que se adapta): o céu e a névoa compensam parte dela
    this.sky.onBeforeRender = (r) => this.updateComp(r.toneMappingExposure)
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
    // tabela da névoa (mesma rotação e mesma exposição de referência do céu); pronta antes do clima ficar disponível
    const data = await buildFogTable(bg.image, this.envRot[name], MOODS[name].exposure)
    // cor média do horizonte (0° a ~9°): névoa padrão dos materiais que não usam a tabela
    const avg = [0, 0, 0]
    for (let j = 0; j < 4; j++) for (let i = 0; i < FOG_W; i++) for (let c = 0; c < 3; c++) avg[c] += data[(j * FOG_W + i) * 4 + c] / (4 * FOG_W)
    this.fogTables[name] = { data, avg }
    this.bgs[name] = bg
  }

  /** Grava o clima na metade A (0) ou B (1) da tabela da névoa, se ainda não estiver lá. */
  fogSlot(slot, name) {
    const t = this.fogTables[name]
    if (!t || this.fogSlots[slot] === name) return
    const arr = skyFog.tex.image.data
    const o = slot * FOG_W * FOG_H * 4
    for (let i = 0; i < FOG_W * FOG_H * 4; i++) arr[o + i] = THREE.DataUtils.toHalfFloat(t.data[i])
    skyFog.tex.needsUpdate = true
    this.fogSlots[slot] = name
  }

  /** Aplica um clima imediatamente (sem transição). */
  apply(name) {
    this.mood = name
    const m = MOODS[name]
    Object.assign(this.state, { ...m, sun: m.sun.clone(), sunColor: m.sunColor.clone(), fog: m.fog.clone() })
    this.scene.environment = this.envs[name]
    const u = this.skyMat.uniforms
    u.tA.value = this.bgs[name]
    u.rotA.value = this.envRot[name]
    u.invExpA.value = 1 / m.exposure
    u.mixAB.value = 0
    this.fogSlot(0, name)
    this.fogFrom = name
    this.fogTo = null
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
    for (const key of ['sunIntensity', 'envIntensity', 'skyGain', 'exposure', 'insideExposure', 'night', 'emissive', 'fogDensity', 'bgIntensity', 'giDay', 'giSunset', 'haze', 'hazeH', 'lobe'])
      st[key] = (A[key] ?? 0) + ((B[key] ?? 0) - (A[key] ?? 0)) * k
    const u = this.skyMat.uniforms
    u.tA.value = this.bgs[from]
    u.rotA.value = this.envRot[from]
    u.invExpA.value = 1 / A.exposure
    u.tB.value = this.bgs[name]
    u.rotB.value = this.envRot[name]
    u.invExpB.value = 1 / B.exposure
    u.mixAB.value = k
    this.fogSlot(0, from)
    this.fogSlot(1, name)
    this.fogFrom = from
    this.fogTo = name
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
    // pesos da GI diurna pré-calculada: dia → pôr do sol → noite (sem sol) acompanham a transição
    shared.uDayW.value = st.giDay ?? 0
    shared.uSunsetW.value = st.giSunset ?? 0
    this.scene.fog.density = st.fogDensity
    this.skyMat.uniforms.gain.value = st.bgIntensity
    // perspectiva aérea: densidade, altura de escala do vale, mistura entre climas e lóbulo do sol
    skyFog.P[0] = st.haze ?? 1
    skyFog.P[1] = 1 / (st.hazeH || 140)
    skyFog.Q[2] = this.fogTo ? this.skyMat.uniforms.mixAB.value : 0
    skyFog.sun[0] = st.sun.x
    skyFog.sun[1] = st.sun.y
    skyFog.sun[2] = st.sun.z
    // lóbulo de espalhamento para frente: cor do sol, já na escala da luz linear da cena (÷ exposição do clima)
    const lobe = ((st.lobe ?? 0) * st.sunIntensity) / st.exposure
    skyFog.sunCol[0] = st.sunColor.r * lobe
    skyFog.sunCol[1] = st.sunColor.g * lobe
    skyFog.sunCol[2] = st.sunColor.b * lobe
    this.updateComp(this.renderer.toneMappingExposure)
  }

  /** Compensação de exposição do céu e da névoa (chamada antes de desenhar o céu, a cada quadro). */
  updateComp(E) {
    const st = this.state
    const comp = Math.pow(st.exposure / Math.max(E, 1e-3), SKY_COMP)
    this.skyMat.uniforms.comp.value = comp
    skyFog.Q[1] = st.bgIntensity * comp
    // névoa padrão (materiais sem a tabela): média do horizonte dos dois climas
    const a = this.fogTables[this.fogFrom]?.avg
    if (!a) return void this.scene.fog.color.copy(st.fog)
    const b = this.fogTables[this.fogTo]?.avg || a
    const k = skyFog.Q[2],
      g = skyFog.Q[1]
    this.scene.fog.color.setRGB((a[0] + (b[0] - a[0]) * k) * g, (a[1] + (b[1] - a[1]) * k) * g, (a[2] + (b[2] - a[2]) * k) * g)
  }

  /** Exposição: um "olho" que se adapta ao entrar na casa. */
  exposureFor(insideFactor) {
    const st = this.state
    return st.exposure + (st.insideExposure - st.exposure) * insideFactor
  }
}
