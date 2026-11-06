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
  // GI diurna pré-calculada (bake.py, passadas day/sunset): peso de cada clima e ganho de calibração
  uDayW: { value: 1 },
  uSunsetW: { value: 0 },
  uDayGain: { value: 1 },
  uNightTint: { value: new THREE.Color(1, 1, 1) }, // temperatura da luz artificial (personalização)
  uInside: { value: 0 }, // 1 = câmera dentro da casa (vidros refletem pouco o céu)
  uDebug: { value: 0 }, // 1 = mostra a oclusão do lightmap; 2 = luz noturna // rebatimento difuso do sol (aprox. de GI), modulado pela oclusão
}

// ajustes de tom posteriores ao bake (o lightmap não depende do albedo); vazio desde a reexportação
const TINT = {}

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

// ---------------------------------------------------------------- sondas de reflexo internas
// Preenchidas por probes.js: caixas (AABB do ambiente, mundo), posição de captura e um atlas octaédrico único com as mips
// do PMREM de cada sonda (1 sampler só, qualquer número de sondas até PB_MAX). uPbAtlasInfo = (lado da mip 0, mip máx., 1/largura, 1/altura).
export const PB_MAX = 12
const pbArr = () => ({ value: Array.from({ length: PB_MAX }, () => new THREE.Vector3()) })
export const PB = {
  uPbOn: { value: 0 },
  uPbCount: { value: 0 },
  uPbMin: pbArr(),
  uPbMax: pbArr(),
  uPbPos: pbArr(),
  uPbAtlas: { value: null },
  uPbAtlasInfo: { value: new THREE.Vector4(256, 5, 1, 1) },
  uPbGain: { value: 1 },
}

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
uniform sampler2D lmDayA;
uniform sampler2D lmDayB;
uniform float lmDayOn;
uniform float lmDayMax;
uniform float uDayW;
uniform float uSunsetW;
uniform float uDayGain;
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
uniform float uPbOn;
uniform int uPbCount;
uniform vec3 uPbMin[ ${PB_MAX} ];
uniform vec3 uPbMax[ ${PB_MAX} ];
uniform vec3 uPbPos[ ${PB_MAX} ];
uniform sampler2D uPbAtlas;
uniform vec4 uPbAtlasInfo;
uniform float uPbGain;
uniform float uPbInside;
uniform float lmPbGlass;
// direção (mundo, Y para cima) → quadrado octaédrico [0,1]²; o centro é o zênite
vec2 pbOct( vec3 d ) {
  d /= abs( d.x ) + abs( d.y ) + abs( d.z );
  vec2 p = d.xz;
  if ( d.y < 0.0 ) p = ( 1.0 - abs( p.yx ) ) * vec2( p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0 );
  return p * 0.5 + 0.5;
}
// uma mip de uma sonda: coluna = índice da sonda, mips empilhadas (lado T0, T0/2, ...)
vec3 pbTap( float col, vec2 o, float l ) {
  float T = uPbAtlasInfo.x * exp2( - l );
  vec2 px = vec2( col * uPbAtlasInfo.x, 2.0 * uPbAtlasInfo.x * ( 1.0 - exp2( - l ) ) ) + clamp( o * T, vec2( 0.5 ), vec2( T - 0.5 ) );
  return textureLod( uPbAtlas, px * uPbAtlasInfo.zw, 0.0 ).rgb;
}
// reflexo das sondas com box projection (raio refletido contra o AABB do ambiente); rgb já ponderado, a = peso (0 = só céu)
vec4 pbRadiance( vec3 viewDir, vec3 normal, float roughness, vec3 wPos ) {
  vec4 acc = vec4( 0.0 );
  if ( uPbOn < 0.5 ) return acc;
  vec3 r = reflect( - viewDir, normal );
  r = normalize( mix( r, normal, pow4( roughness ) ) );
  r = normalize( ( vec4( r, 0.0 ) * viewMatrix ).xyz );
  float lod = uPbAtlasInfo.y * roughness * ( 2.0 - roughness );
  float l0 = floor( lod );
  float l1 = min( l0 + 1.0, uPbAtlasInfo.y );
  // vidro: de fora reflete o jardim/céu; só com a câmera dentro de casa reflete o ambiente
  float gw = mix( 1.0, uPbInside, lmPbGlass );
  // 1º passo, só aritmética: as 2 caixas de maior peso (portas/divisas misturam no máximo 2 ambientes).
  // As amostras ficam fora do laço: o compilador HLSL (ANGLE/D3D) desenrola laços com textura e a compilação explode.
  int i0 = 0; int i1 = 0; float w0 = 0.0; float w1 = 0.0;
  for ( int i = 0; i < ${PB_MAX}; i ++ ) {
    if ( i >= uPbCount ) break;
    vec3 lo = wPos - uPbMin[ i ];
    vec3 hi = uPbMax[ i ] - wPos;
    // peso: 1 dentro da caixa (faces internas das paredes), 0 nas faces externas; piso e forro com folga de 15 cm
    float d = min( min( min( lo.x, hi.x ), min( lo.z, hi.z ) ), min( lo.y, hi.y ) + 0.15 );
    float w = smoothstep( -0.08, 0.06, d ) * gw;
    if ( w > w0 ) { w1 = w0; i1 = i0; w0 = w; i0 = i; }
    else if ( w > w1 ) { w1 = w; i1 = i; }
  }
  if ( w0 <= 0.0 ) return acc;
  vec3 ra = max( abs( r ), vec3( 1e-4 ) );
  vec3 st = step( 0.0, r );
  for ( int k = 0; k < 2; k ++ ) {
    int i = k == 0 ? i0 : i1;
    float w = k == 0 ? w0 : w1;
    if ( w <= 0.0 ) break;
    vec3 bMin = uPbMin[ i ];
    vec3 bMax = uPbMax[ i ];
    vec3 pc = clamp( wPos, bMin + 0.01, bMax - 0.01 );
    vec3 tf = mix( pc - bMin, bMax - pc, st ) / ra;
    float t = min( min( tf.x, tf.y ), tf.z );
    vec2 o = pbOct( normalize( pc + r * t - uPbPos[ i ] ) );
    vec3 c = mix( pbTap( float( i ), o, l0 ), pbTap( float( i ), o, l1 ), lod - l0 );
    acc += vec4( c * w, w );
  }
  if ( acc.a > 1.0 ) acc /= acc.a;
  return vec4( acc.rgb * uPbGain, acc.a );
}
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
  // rebatimento do sol e do céu: GI diurna real (RGBM) quando existe; senão, a aproximação constante
  float dayW = ( uDayW + uSunsetW ) * lmDayOn;
  if ( lmOn > 0.5 && lmDayOn > 0.5 ) {
    vec4 dA = texture2D( lmDayA, vLmUv );
    vec4 dB = texture2D( lmDayB, vLmUv );
    vec3 giA = dA.rgb * dA.rgb * dA.a * lmDayMax;
    vec3 giB = dB.rgb * dB.rgb * dB.a * lmDayMax;
    irradiance += ( giA * uDayW + giB * uSunsetW ) * PI * uDayGain;
  }
  irradiance += uBounce * lmOcc * ( 1.0 - clamp( dayW, 0.0, 1.0 ) );
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
  // sondas internas: dentro dos ambientes o reflexo vem da sonda (que já contém a oclusão do cômodo), com oclusão branda;
  // o céu externo, atenuado por lmOcc², só entra na fração fora das caixas
  vec3 pbW = cameraPosition + ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz;
  vec4 pbR = pbRadiance( geometryViewDir, geometryNormal, material.roughness, pbW );
  float specOccP = mix( 0.7, 1.0, clamp( lmOcc * 2.5, 0.0, 1.0 ) );
  radiance += iblRadiance * specOcc * uSkyGain * ( 1.0 - pbR.a ) + pbR.rgb * specOccP;
  #ifdef USE_CLEARCOAT
    vec4 pbC = pbRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness, pbW );
    clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * specOcc * ( 1.0 - pbC.a ) + pbC.rgb * specOccP;
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
    lmDayA: { value: opts.dayA || null },
    lmDayB: { value: opts.dayB || opts.dayA || null },
    lmDayOn: { value: opts.tex && opts.dayA ? 1 : 0 },
    lmDayMax: { value: opts.dayMax ?? 8 },
    uClipY: { value: 1e5 },
    uClipGlow: { value: 0 },
    uFade: { value: 1 },
    uHi: { value: 0 },
    lmPbGlass: { value: mat.userData.extraKey === 'glass' ? 1 : 0 }, // vidro: sonda só com a câmera dentro de casa
  }
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r)
    Object.assign(sh.uniforms, mat.userData.lm, PB, { uPbInside: shared.uInside }, { uNight: shared.uNight, uLamp: shared.uLamp, uSkyGain: shared.uSkyGain, uBounce: shared.uBounce, uDebug: shared.uDebug, uNightTint: shared.uNightTint, uDayW: shared.uDayW, uSunsetW: shared.uSunsetW, uDayGain: shared.uDayGain })
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + LM_VERT_DECL)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLmUv = uv1;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 lmWp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          lmWp = instanceMatrix * lmWp;
        #endif
        vLmWy = ( modelMatrix * lmWp ).y;`,
      )
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
      `vec3 glSpec = totalSpecular * mix(1.0, 0.22, uInside);
      // compressão suave dos picos (sol rasante do poente no vidro): o reflexo normal fica intacto,
      // só os extremos que estouravam o bloom em painéis inteiros brancos são contidos
      glSpec /= 1.0 + max(max(glSpec.r, glSpec.g), glSpec.b) / 2.5;
      gl_FragColor = vec4( totalDiffuse * diffuseColor.a + glSpec + totalEmissiveRadiance, diffuseColor.a );`,
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
    // variação macro do gramado (manchas viçosas/secas em várias escalas), em coordenadas do mundo.
    // Fica também em userData para as lâminas de grama (grass.js) usarem exatamente a mesma cor na raiz.
    const LAWN_FN = `
float lh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float ln(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(lh(i),lh(i+vec2(1,0)),u.x),mix(lh(i+vec2(0,1)),lh(i+vec2(1,1)),u.x),u.y);}
vec3 lawnMacro(vec2 p){
  float mv = ln(p * 0.18) * 0.6 + ln(p * 0.9) * 0.4;
  vec3 c = mix(vec3(0.8, 0.95, 0.64), vec3(1.0, 1.07, 0.78), mv);
  float big = ln(p * 0.045 + 7.3) * 0.65 + ln(p * 0.11 + 3.1) * 0.35;
  c *= mix(vec3(0.86, 0.93, 0.84), vec3(1.08, 1.05, 0.92), big);
  float dry = smoothstep(0.62, 0.9, ln(p * 0.07 + 19.7));
  return mix(c, c * vec3(1.08, 1.0, 0.8), dry * 0.3);
}`
    m.userData.lawnGLSL = LAWN_FN
    // raio do gramado de lâminas (grass.js liga quando ativo): sob as lâminas o "chão" visível é a base da touceira,
    // mais escura e mais verde (folhas secas da textura ficam encobertas)
    m.userData.grassR = { value: 0 }
    // anti-repetição por ladrilhamento hexagonal (Mikkelsen, "Practical Real-Time Hex-Tiling"): cada célula
    // amostra a textura com deslocamento e rotação aleatórios; os mesmos pesos servem a cor, ARM e normal
    const HEX = `
vec2 hxUv[3]; vec2 hxCs[3]; vec3 hxW; vec2 hxDx; vec2 hxDy;
vec2 hxH2(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
void hexSetup(vec2 uv){
  hxDx = dFdx(uv); hxDy = dFdy(uv);
  vec2 st = uv * 1.25 * 3.4641016;
  vec2 sk = vec2(st.x, -0.57735027 * st.x + 1.15470054 * st.y);
  vec2 b = floor(sk); vec3 t = vec3(fract(sk), 0.0); t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z); float s2 = 2.0 * s - 1.0;
  vec3 w = vec3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  vec2 v[3]; v[0] = b + vec2(s, s); v[1] = b + vec2(s, 1.0 - s); v[2] = b + vec2(1.0 - s, s);
  for (int i = 0; i < 3; i++) {
    vec2 h = hxH2(v[i]); float a = h.x * 6.2831853;
    hxCs[i] = vec2(cos(a), sin(a));
    hxUv[i] = mat2(hxCs[i].x, hxCs[i].y, -hxCs[i].y, hxCs[i].x) * uv + hxH2(v[i] + 17.3);
  }
  w = pow(w, vec3(5.0)); hxW = w / (w.x + w.y + w.z);
}
vec4 hexS(sampler2D tx){
  vec4 c = vec4(0.0);
  for (int i = 0; i < 3; i++) { mat2 r = mat2(hxCs[i].x, hxCs[i].y, -hxCs[i].y, hxCs[i].x); c += textureGrad(tx, hxUv[i], r * hxDx, r * hxDy) * hxW[i]; }
  return c;
}
vec3 hexN(sampler2D tx){
  vec3 n = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    mat2 r = mat2(hxCs[i].x, hxCs[i].y, -hxCs[i].y, hxCs[i].x);
    vec3 s = textureGrad(tx, hxUv[i], r * hxDx, r * hxDy).xyz * 2.0 - 1.0;
    s.xy = transpose(r) * s.xy;
    n += s * hxW[i];
  }
  return n * 0.5 + 0.5;
}`
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGrassR = m.userData.grassR
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vWpL;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWpL = (modelMatrix * vec4(transformed,1.0)).xyz;`)
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <common>',
        `#include <common>
varying vec3 vWpL;
uniform float uGrassR;
${LAWN_FN}
${HEX}`,
      )
      // ARM e normal usam o mesmo UV do mapa de cor (canal 0, sem transformação)
      const armFetch = (chunk, call) => THREE.ShaderChunk[chunk].replace(call, 'hxArm')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_fragment>', `
          hexSetup(vMapUv);
          vec4 g1 = hexS(map);
          vec4 g2 = texture2D(map, vMapUv * 0.23 + vec2(0.31, 0.17));
          vec3 gc = mix(g1.rgb, g2.rgb, 0.3) * lawnMacro(vWpL.xz);
          diffuseColor.rgb *= gc;
          if (uGrassR > 0.0) {
            float gk = 1.0 - smoothstep(uGrassR * 0.5, uGrassR * 0.92, distance(cameraPosition, vWpL));
            float gl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            diffuseColor.rgb = mix(diffuseColor.rgb, gl * vec3(0.4, 0.68, 0.24), gk * 0.65);
          }
          #ifdef USE_AOMAP
            vec4 hxArm = hexS(aoMap);
          #else
            vec4 hxArm = vec4(1.0);
          #endif`)
        .replace('#include <roughnessmap_fragment>', armFetch('roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )'))
        .replace('#include <metalnessmap_fragment>', armFetch('metalnessmap_fragment', 'texture2D( metalnessMap, vMetalnessMapUv )'))
        .replace('#include <aomap_fragment>', armFetch('aomap_fragment', 'texture2D( aoMap, vAoMapUv )'))
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv ).xyz', 'hexN( normalMap )'))
    }
  }
  if (kind === 'struct') {
    m.userData.struct = true
  }
  return m
}

/** Materiais dos modelos do Poly Haven (já trazem texturas). */
export function adaptPropMaterial(m) {
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = maxAniso
  // têxteis são dielétricos (algumas texturas de origem trazem metalicidade ~0,2 no ARM)
  if (/^M_(fab_|curtain|rug|towel|leather)/.test(m.name)) m.metalness = 0
  if (m.alphaTest === 0 && m.transparent && m.name.toLowerCase().includes('leaves')) {
    m.alphaTest = 0.5
    m.alphaToCoverage = true // com MSAA, borda das folhas suavizada em vez de serrilhada/cintilante
    m.transparent = false
  }
  return m
}

/** Água da piscina (archviz contida): sem difuso de superfície; reflexo PMREM com Fresnel único (F0 0,02 pela ior 1,33);
 * transmissão/absorção pelo caminho real até o casco (raio refratado contra a caixa conhecida da piscina: fundo de 1,45 m,
 * banco raso de 0,45 m × 1,6 m na ponta oeste, ver blender/plan.py POOL e site_build.py); 2 camadas de normal procedural;
 * cáusticas discretas desenhadas no ponto do casco atingido pelo raio (sem mexer no material da pastilha).
 * Alfa pré-multiplicado: saída = reflexo + luz espalhada; o casco já desenhado atrás passa com (1 − F)·T. */
export function waterMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.015, 0.08, 0.1), // albedo do volume (espalhamento azul-esverdeado), não da superfície
    roughness: 0.035,
    metalness: 0,
    ior: 1.33,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    envMapIntensity: 1.0,
  })
  m.userData.extraKey = 'water'
  patchLightmap(m, { constOcc: 1 })
  // caixa da piscina em coordenadas de mundo: extensão e nível da água saem da própria malha (só a face de cima);
  // profundidades vêm do projeto (fundo 1,45 m e banco a 0,45 m da borda; a água fica 8 cm abaixo da borda)
  const pool = { uPoolMin: { value: new THREE.Vector3(-0.5, -1.45, -7.0) }, uPoolMax: { value: new THREE.Vector3(12.0, -0.08, -2.6) }, uBench: { value: new THREE.Vector2(1.1, -0.43) } }
  // medido a cada quadro (8 cantos, custo desprezível): a construção e a vista explodida deslocam a piscina inteira
  const b = new THREE.Box3()
  m.onBeforeRender = (r, s, c, geo, obj) => {
    if (!geo.boundingBox) geo.computeBoundingBox()
    b.copy(geo.boundingBox).applyMatrix4(obj.matrixWorld)
    const top = b.max.y
    pool.uPoolMin.value.set(b.min.x, top - 1.37, b.min.z)
    pool.uPoolMax.value.set(b.max.x, top, b.max.z)
    pool.uBench.value.set(b.min.x + 1.6, top - 0.35)
  }
  const prev = m.onBeforeCompile
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r)
    Object.assign(sh.uniforms, pool, { uTime: shared.uTime })
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWpos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWpos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform vec3 uPoolMin; uniform vec3 uPoolMax; uniform vec2 uBench; varying vec3 vWpos;
        vec3 wNw; float wF; float wT; vec3 wTc; vec3 wHit; vec3 wHitN;
        float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // ruído de valor com derivadas analíticas (x = valor, yz = gradiente)
        vec3 wNoised(vec2 x){
          vec2 i = floor(x), f = fract(x); vec2 u = f * f * (3.0 - 2.0 * f); vec2 du = 6.0 * f * (1.0 - f);
          float a = wHash(i), b = wHash(i + vec2(1.0, 0.0)), c = wHash(i + vec2(0.0, 1.0)), d = wHash(i + vec2(1.0, 1.0));
          return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
        }
        // cáustica procedural (padrão iterativo clássico de ondas; 4 iterações)
        float wCaustic(vec2 uv, float time){
          vec2 p = uv * 6.2831 + 37.0; vec2 i = p; float c = 1.0;
          for (int n = 0; n < 4; n++) {
            float t = time * (1.0 - 3.5 / float(n + 1));
            i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + t) / 0.005), p.y / (cos(i.y + t) / 0.005)));
          }
          c = 1.17 - pow(c * 0.25, 1.4);
          return clamp(pow(abs(c), 8.0), 0.0, 1.6);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // ondulação fina: 2 camadas giradas e deslizando em sentidos diferentes; a fina some com a distância (sem cintilar)
          vec2 p = vWpos.xz; float t = uTime;
          vec2 p1 = mat2(0.878, 0.479, -0.479, 0.878) * p * 0.85 + t * vec2(0.16, 0.06);
          vec2 p2 = mat2(0.62, -0.785, 0.785, 0.62) * p * 2.9 - t * vec2(0.09, 0.27);
          float fine = 1.0 - smoothstep(0.25, 0.9, length(fwidth(p2)));
          vec2 g = wNoised(p1).yz * 0.85 * 0.045 + wNoised(p2).yz * 2.9 * 0.0065 * fine;
          wNw = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize((viewMatrix * vec4(wNw, 0.0)).xyz);
          // Fresnel de Schlick (F0 0,02, o mesmo da ior 1,33 usada no BRDF) — só pondera reflexo × transmissão
          vec3 V = normalize(cameraPosition - vWpos);
          float cv = clamp(dot(wNw, V), 0.0, 1.0);
          wF = 0.02 + 0.98 * pow(1.0 - cv, 5.0);
          // raio refratado contra a caixa da piscina: fundo, banco raso e as 4 paredes
          vec3 rd = refract(-V, wNw, 1.0 / 1.33); rd.y = min(rd.y, -0.05); rd = normalize(rd);
          vec3 ro = vec3(vWpos.x, uPoolMax.y, vWpos.z);
          float tF = (uPoolMin.y - ro.y) / rd.y; wHitN = vec3(0.0, 1.0, 0.0);
          float tB = (uBench.y - ro.y) / rd.y;
          if (ro.x + rd.x * tB < uBench.x) tF = tB;
          else { float tS = (uBench.y - 0.47 - ro.y) / rd.y; if (ro.x + rd.x * tS < uBench.x - 0.8) tF = tS; } // 2º degrau (0,9 m) na metade oeste do banco
          float tX = (rd.x > 0.0 ? uPoolMax.x - ro.x : uPoolMin.x - ro.x) / (abs(rd.x) > 1e-4 ? rd.x : 1e-4);
          float tZ = (rd.z > 0.0 ? uPoolMax.z - ro.z : uPoolMin.z - ro.z) / (abs(rd.z) > 1e-4 ? rd.z : 1e-4);
          float tH = tF;
          if (tX > 0.0 && tX < tH) { tH = tX; wHitN = vec3(1.0, 0.0, 0.0); }
          if (tZ > 0.0 && tZ < tH) { tH = tZ; wHitN = vec3(0.0, 0.0, 1.0); }
          tH = max(tH, 0.0);
          wHit = ro + rd * tH;
          // absorção espectral: caminho visto (tH) + descida da luz até o ponto; o vermelho some primeiro (σ por metro)
          wTc = exp(-vec3(0.4, 0.15, 0.115) * (tH + (ro.y - wHit.y)));
          wT = wTc.r; // a mistura com o casco é escalar: usa o canal mais absorvido e devolve o resto do verde/azul abaixo
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float kT = (1.0 - wF) * wT;
          // irradiância na superfície (o difuso dividido pelo albedo do volume); estima a pastilha vista pela água (tinta do furnish.py)
          vec3 wIrr = totalDiffuse / max(material.diffuseColor, vec3(1e-3));
          // verde/azul que a mistura escalar (vermelho) cortou a mais: pastilha × (T_rgb − T_r)
          vec3 scat = wIrr * vec3(0.13, 0.25, 0.24) * (wTc - wT) * (1.0 - wF);
          // luz espalhada no volume: a iluminação "difusa" (sol + céu) com o albedo azul-esverdeado, só na parcela não transmitida
          scat += totalDiffuse * (1.0 - wF) * (1.0 - wTc.g);
          // noite: brilho das luminárias subaquáticas (parede sul), mais forte perto delas
          float near = exp(-max(uPoolMax.z - wHit.z, 0.0) * 0.45);
          scat += vec3(0.03, 0.2, 0.24) * uNight * (1.0 - wF) * (1.0 - wT) * (0.55 + 0.9 * near);
          // halo de cada luminária (4 na parede sul, a 0,44 m sob a lâmina, a cada 2,5 m a partir de 2 m da ponta oeste): no casco atingido e no volume acima
          float halo = 0.0;
          for (int i = 0; i < 4; i++) {
            vec3 lp = vec3(uPoolMin.x + 2.0 + 2.5 * float(i), uPoolMax.y - 0.44, uPoolMax.z);
            halo += exp(-distance(wHit, lp) * 1.3) + 0.45 * exp(-distance(vec3(vWpos.x, lp.y, vWpos.z), lp) * 1.8);
          }
          scat += vec3(0.06, 0.32, 0.34) * halo * uNight * (1.0 - wF);
          // cáusticas: luz do sol focalizada no casco, vista através da água (some com a profundidade e de noite)
          vec3 caus = vec3(0.0);
          #if NUM_DIR_LIGHTS > 0
            vec3 sd = transformDirectionByInverseViewMatrix(directionalLights[0].direction, viewMatrix);
            vec3 sunE = directionalLights[0].color * max(sd.y, 0.0);
            vec2 cuv = wHitN.y > 0.5 ? wHit.xz : (wHitN.x > 0.5 ? vec2(wHit.z, wHit.y * 1.6) : vec2(wHit.x, wHit.y * 1.6));
            float cd = clamp(uPoolMax.y - wHit.y, 0.0, 2.0);
            float cs = wCaustic(cuv * 0.55 + wNw.xz * 0.6, uTime * 0.45) * mix(1.0, 0.45, cd * 0.6) * (wHitN.y > 0.5 ? 1.0 : 0.55);
            caus = sunE * vec3(0.28, 0.46, 0.44) * RECIPROCAL_PI * 0.42 * cs * (1.0 - wF) * wTc * (1.0 - uNight);
          #endif
          gl_FragColor = vec4( totalSpecular * (1.0 - 0.35 * uNight) + scat + caus + totalEmissiveRadiance, 1.0 - kT );
        }`,
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
