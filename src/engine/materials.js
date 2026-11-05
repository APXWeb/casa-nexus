// Biblioteca de materiais da CASA NEXUS.
// Os GLB chegam sem imagens: cada material traz em `extras` a pasta da textura (Poly Haven), tom e rugosidade.
// O lightmap (RGB = luz artificial, A = visibilidade do céu) entra por um patch de shader.
import * as THREE from 'three'

export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 }, // 0 dia → 1 noite (luz artificial pré-calculada)
  uLamp: { value: 0 }, // nível das luminárias (noite, ou dia com a câmera dentro da casa)
  uSkyGain: { value: 1 }, // ganho da luz do céu filtrada pela oclusão
  uEmissive: { value: 0 }, // brilho das luminárias
  uBuild: { value: 1 }, // usado pela construção (revelação por altura)
  uBounce: { value: new THREE.Color(0, 0, 0) },
  uNightTint: { value: new THREE.Color(1, 1, 1) }, // temperatura da luz artificial (personalização)
  uInside: { value: 0 }, // 1 = câmera dentro da casa (vidros refletem pouco o céu)
  uDebug: { value: 0 }, // 1 = mostra a oclusão do lightmap; 2 = luz noturna // rebatimento difuso do sol (aprox. de GI), modulado pela oclusão
}

// ajustes de tom posteriores ao bake (o lightmap não depende do albedo)
const TINT = { M_deck: [0.84, 0.8, 0.76] }

const texCache = new Map()
let texTier = 1024
let maxAniso = 8
const loader = new THREE.TextureLoader()

export function setTextureTier(px, aniso) {
  texTier = px
  maxAniso = aniso
}

export function getTex(id, map, srgb) {
  return tex(id, map, srgb)
}
function tex(id, map, srgb) {
  const key = `${id}/${map}_${texTier}`
  if (texCache.has(key)) return texCache.get(key)
  const t = loader.load(`${import.meta.env.BASE_URL}assets/tex/${id}/${map}_${texTier}.webp`, () => onTexLoaded())
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = maxAniso
  t.channel = 0
  texCache.set(key, t)
  pending++
  return t
}
let pending = 0
let loadedCb = null
function onTexLoaded() {
  pending--
  loadedCb?.(pending)
}
export function onTextures(cb) {
  loadedCb = cb
}
export const texturesPending = () => pending

// ---------------------------------------------------------------- patch do lightmap
const LM_VERT_DECL = /* glsl */ `
attribute vec2 uv1;
varying vec2 vLmUv;
varying float vLmWy;
`
const LM_FRAG_DECL = /* glsl */ `
uniform sampler2D lmTex;
uniform float lmOn;
uniform float uNight;
uniform float uLamp;
uniform float uSkyGain;
uniform vec3 uBounce;
uniform float uDebug;
uniform vec3 uNightTint;
uniform float uHi;
uniform float lmSkyMax;
uniform float lmNightMax;
uniform float lmConstOcc;
uniform vec3 lmConstNight;
varying vec2 vLmUv;
varying float vLmWy;
uniform float uClipY;
uniform float uClipGlow;
uniform float uFade;
float lmOcc;
vec4 lmRaw;
`
// substitui <lights_fragment_maps>
const LM_FRAG_MAPS = /* glsl */ `
#if defined( RE_IndirectDiffuse )
  vec3 lmNightIrr = lmConstNight;
  lmOcc = lmConstOcc;
  if ( lmOn > 0.5 ) {
    vec4 lmS = texture2D( lmTex, vLmUv );
    lmRaw = lmS;
    float skyV = lmS.a * lmS.a * lmSkyMax;
    vec3 nW = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );
    float ref = 0.56 + 0.44 * clamp( nW.y, -1.0, 1.0 );
    lmOcc = clamp( skyV / ref, 0.0, 1.0 );
    lmOcc = pow( lmOcc, 0.7 );
    lmNightIrr = lmS.rgb * lmS.rgb * lmNightMax;
  }
  irradiance += lmNightIrr * uNightTint * PI * uLamp;
  irradiance += uBounce * lmOcc;
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
    #if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
      // dentro de casa a luz chega rebatida por pisos/paredes claros: menos azul do céu, mais neutra-quente
      vec3 iblI = getIBLIrradiance( geometryNormal );
      float iblL = dot( iblI, vec3( 0.2126, 0.7152, 0.0722 ) );
      vec3 bounced = iblL * vec3( 1.1, 1.0, 0.86 );
      iblIrradiance += mix( bounced, iblI, smoothstep( 0.25, 0.85, lmOcc ) ) * lmOcc * uSkyGain;
    #endif
  #endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
  float specOcc = clamp( lmOcc * lmOcc * 1.15, 0.0, 1.0 );
  radiance += iblRadiance * specOcc * uSkyGain;
  #ifdef USE_CLEARCOAT
    clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * specOcc;
  #endif
#endif
`

/** Aplica o patch de lightmap a um material padrão. */
export function patchLightmap(mat, opts = {}) {
  mat.userData.lm = {
    lmTex: { value: opts.tex || null },
    lmOn: { value: opts.tex ? 1 : 0 },
    lmSkyMax: { value: opts.skyMax ?? 1.25 },
    lmNightMax: { value: opts.nightMax ?? 6 },
    lmConstOcc: { value: opts.constOcc ?? 1 },
    lmConstNight: { value: new THREE.Color(opts.constNight ?? 0x000000) },
    uClipY: { value: 1e5 },
    uClipGlow: { value: 0 },
    uFade: { value: 1 },
    uHi: { value: 0 },
  }
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r)
    Object.assign(sh.uniforms, mat.userData.lm, { uNight: shared.uNight, uLamp: shared.uLamp, uSkyGain: shared.uSkyGain, uBounce: shared.uBounce, uDebug: shared.uDebug, uNightTint: shared.uNightTint })
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + LM_VERT_DECL)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLmUv = uv1;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LM_FRAG_DECL)
      .replace('#include <lights_fragment_maps>', LM_FRAG_MAPS)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (vLmWy > uClipY) discard;
        if (uFade < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > uFade) discard;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * 6.0 * uClipGlow * (1.0 - smoothstep(0.0, 0.05, uClipY - vLmWy));
        // destaque discreto (detalhes): brilho de borda quente e respirante
        totalEmissiveRadiance += vec3(1.0, 0.86, 0.66) * uHi * 0.22 * (0.08 + pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0));`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (uDebug > 0.5) gl_FragColor = vec4(uDebug < 1.5 ? vec3(lmOcc) : uDebug < 2.5 ? lmNightIrr * 0.3 : uDebug < 3.5 ? vec3(fract(vLmUv), 0.0) : lmRaw.aaa, 1.0);`,
      )
    mat.userData.shader = sh
  }
  mat.customProgramCacheKey = () => 'lm' + (mat.userData.extraKey || '')
  return mat
}

/** Vidro: reflexo integral + transmissão escurecida (alfa pré-multiplicado). */
export function glassMaterial(tint = 0x0d1414, opacity = 0.1) {
  const m = new THREE.MeshStandardMaterial({
    color: tint,
    roughness: 0.03,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.25,
    premultipliedAlpha: true,
  })
  m.userData.extraKey = 'glass'
  patchLightmap(m, { constOcc: 1 })
  const prev = m.onBeforeCompile
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r)
    sh.uniforms.uInside = shared.uInside
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uInside;`).replace(
      '#include <opaque_fragment>',
      `gl_FragColor = vec4( totalDiffuse * diffuseColor.a + totalSpecular * mix(1.0, 0.22, uInside) + totalEmissiveRadiance, diffuseColor.a );`,
    ).replace('#include <premultiplied_alpha_fragment>', '')
  }
  return m
}

/** Material a partir dos extras exportados pelo Blender. */
export function buildMaterial(src, extras = {}) {
  const kind = extras.kind || 'opaque'
  const color = new THREE.Color().fromArray(extras.color || [0.8, 0.8, 0.8])
  if (kind === 'glass') return glassMaterial()
  const m = new THREE.MeshStandardMaterial({
    name: src.name,
    color,
    roughness: extras.rough ?? 0.6,
    metalness: extras.metal ?? 0,
  })
  if (extras.tex) {
    m.map = tex(extras.tex, 'diff', true)
    const arm = tex(extras.tex, 'arm', false)
    m.roughnessMap = arm
    m.metalnessMap = arm
    m.aoMap = arm
    m.aoMapIntensity = 0.6
    m.normalMap = tex(extras.tex, 'nor', false)
    m.normalScale.set(1, 1)
    m.roughness = 1
    m.metalness = 1
    m.color.setRGB(1, 1, 1)
    if (extras.tint) m.color.fromArray(TINT[src.name] || extras.tint)
  }
  if (kind === 'emissive') {
    m.emissive = new THREE.Color().fromArray(extras.emission || [1, 0.8, 0.6])
    m.emissiveIntensity = 0
    m.userData.emitBase = extras.emit || 8
    m.userData.isLamp = true
    m.color.set(0xf2eee8)
    m.roughness = 0.4
    m.metalness = 0
  }
  if (kind === 'curtain') {
    m.transparent = true
    m.opacity = extras.alpha ?? 0.6
    m.side = THREE.DoubleSide
    m.depthWrite = false
    m.normalMap = null
  }
  if (kind === 'mirror') {
    m.roughness = 0.02
    m.metalness = 1
    m.color.setRGB(0.92, 0.92, 0.92)
  }
  if (kind === 'lawn') {
    m.userData.extraKey = 'lawn'
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vWpL;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWpL = (modelMatrix * vec4(transformed,1.0)).xyz;`)
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <common>',
        `#include <common>
varying vec3 vWpL;
float lh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float ln(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(lh(i),lh(i+vec2(1,0)),u.x),mix(lh(i+vec2(0,1)),lh(i+vec2(1,1)),u.x),u.y);}`,
      )
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_fragment>', `
          vec4 g1 = texture2D(map, vMapUv);
          vec4 g2 = texture2D(map, vMapUv * 0.37 + vec2(0.31, 0.17));
          float mv = ln(vWpL.xz * 0.18) * 0.6 + ln(vWpL.xz * 0.9) * 0.4;
          vec3 gc = mix(g1.rgb, g2.rgb, 0.45);
          gc *= mix(vec3(0.78, 0.95, 0.62), vec3(1.0, 1.08, 0.78), mv);
          diffuseColor.rgb *= gc;`)
    }
  }
  if (kind === 'struct') {
    m.userData.struct = true
  }
  return m
}

/** Materiais dos modelos do Poly Haven (já trazem texturas). */
export function adaptPropMaterial(m) {
  if (m.map) m.map.anisotropy = maxAniso
  if (m.alphaTest === 0 && m.transparent && m.name.toLowerCase().includes('leaves')) {
    m.alphaTest = 0.5
    m.transparent = false
  }
  return m
}

/** Água da piscina: ondulação procedural animada, reflexo do céu e transparência sobre a pastilha. */
export function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: 0x0e5a5c,
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    premultipliedAlpha: true,
    envMapIntensity: 1.1,
  })
  m.userData.extraKey = 'water'
  patchLightmap(m, { constOcc: 1 })
  const prev = m.onBeforeCompile
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r)
    sh.uniforms.uTime = shared.uTime
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWpos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWpos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; varying vec3 vWpos;
        vec2 wave(vec2 p, vec2 d, float f, float s, float t){ float ph = dot(p, d) * f + t * s; return d * cos(ph) * f; }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 p = vWpos.xz; float t = uTime;
          vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 2.1, 1.3, t) * 0.020
                 + wave(p, normalize(vec2(-0.4, 1.0)), 3.7, 1.9, t) * 0.012
                 + wave(p, normalize(vec2(0.8, -0.7)), 6.3, 2.6, t) * 0.007
                 + wave(p, normalize(vec2(-1.0, -0.2)), 11.0, 3.4, t) * 0.004;
          vec3 nw = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
         vec3 poolGlow = vec3(0.03, 0.2, 0.24) * uNight * (1.0 - fres);
         gl_FragColor = vec4( totalDiffuse * diffuseColor.a + totalSpecular * (0.6 + fres) * (1.0 - 0.45 * uNight) + totalEmissiveRadiance + poolGlow, diffuseColor.a );`,
      )
      .replace('#include <premultiplied_alpha_fragment>', '')
  }
  return m
}

/** Troca a textura PBR de um material (personalização), mantendo luz pré-calculada e reflexos. */
export function retexture(m, id, tint) {
  m.map = tex(id, 'diff', true)
  const arm = tex(id, 'arm', false)
  m.roughnessMap = arm
  m.metalnessMap = arm
  m.aoMap = arm
  m.normalMap = tex(id, 'nor', false)
  if (tint) m.color.fromArray(tint)
  else m.color.setRGB(1, 1, 1)
  m.needsUpdate = false
}
