// Entorno: campo ao redor do lote e serras ao longe (relevo procedural com mata e névoa).
import * as THREE from 'three'

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function noise(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y)
  const fx = x - ix,
    fy = y - iy
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy),
    b = hash(ix + 1, iy),
    c = hash(ix, iy + 1),
    d = hash(ix + 1, iy + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
export function fbm(x, y, oct = 5) {
  let f = 0,
    a = 0.5,
    s = 1
  for (let i = 0; i < oct; i++) {
    f += a * noise(x * s, y * s)
    s *= 2.03
    a *= 0.5
  }
  return f
}

// Malha radial: densa perto, rala longe. O relevo só pode ter detalhe que a malha consegue representar; oitavas
// com comprimento de onda abaixo de ~4 passos da malha viravam picos triangulares (serrilhado) nas silhuetas das serras.
const R_MAX = 3400,
  RINGS = 192,
  SEGS = 448,
  RPOW = 2.2

/** Passo local da malha (m) no raio r: o maior entre o passo radial e o angular. */
export function meshSpacing(r) {
  const t = Math.max(Math.pow(Math.max(0, r - 1) / R_MAX, 1 / RPOW), 1 / RINGS)
  const dr = (R_MAX * RPOW * Math.pow(t, RPOW - 1)) / RINGS
  return Math.max(dr, (2 * Math.PI * r) / SEGS)
}

/** fbm limitado em banda: cada oitava some suavemente (trocada pela média) quando o comprimento de onda fica abaixo de 4 passos. */
function fbmBand(x, y, oct, f0, sp) {
  let f = 0,
    a = 0.5,
    s = 1
  for (let i = 0; i < oct; i++) {
    const w = THREE.MathUtils.smoothstep(1 / (f0 * s), 2 * sp, 4 * sp)
    f += a * (w > 0 ? w * noise(x * s, y * s) + (1 - w) * 0.5 : 0.5)
    s *= 2.03
    a *= 0.5
  }
  return f
}

/** Altura do terreno fora do lote (o lote fica plano em y=0). Mesma função para a malha e para plantar a mata. */
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z - 0)
  const sp = meshSpacing(r)
  // vale suave: platô até ~70 m, colinas a partir de ~180 m, serras após ~600 m
  const near = THREE.MathUtils.smoothstep(r, 60, 240) * (fbmBand(x * 0.008, z * 0.008, 4, 0.008, sp) * 26 - 6)
  // serras: cristas arredondadas (potência suave alarga os vales e mantém os topos sem agulhas)
  const ff = fbmBand(x * 0.0024 + 7, z * 0.0024 - 3, 5, 0.0024, sp)
  const far = THREE.MathUtils.smoothstep(r, 380, 1300) * (Math.pow(ff, 1.25) * 400 - 30)
  return Math.max(-0.2, near + far) - 0.16
}

export function buildTerrain(scene, texLoader, base) {
  const group = new THREE.Group()
  group.name = 'entorno'
  const pos = [],
    uv = [],
    col = [],
    idx = []
  const radii = []
  for (let i = 0; i <= RINGS; i++) radii.push(1 + Math.pow(i / RINGS, RPOW) * R_MAX)
  const cNear = new THREE.Color(0x6d8a4c),
    cDry = new THREE.Color(0x8f8a5a)
  for (let i = 0; i <= RINGS; i++) {
    for (let j = 0; j <= SEGS; j++) {
      const a = (j / SEGS) * Math.PI * 2
      const r = radii[i]
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r + 0
      const y = terrainHeight(x, z)
      pos.push(x, y, z)
      uv.push(x / 6, z / 6)
      // tinta do gramado perto (variação seca/verde); a mata ao longe é colorida no shader
      const v = fbm(x * 0.03, z * 0.03, 3)
      const c = cNear.clone().lerp(cDry, v * 0.35)
      col.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i < RINGS; i++)
    for (let j = 0; j < SEGS; j++) {
      const a = i * (SEGS + 1) + j,
        b = a + SEGS + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  const grass = texLoader.load(base + 'tex/leafy_grass/diff_1024.webp')
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping
  grass.colorSpace = THREE.SRGBColorSpace
  grass.anisotropy = 8
  const m = new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    // textura só perto; longe, mata com copa, clareiras de pasto e encostas mais secas (albedo linear de mata real)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying float vUpN;').replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;\nvUpN = normalize(mat3(modelMatrix) * objectNormal).y;',
    )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying float vUpN;\nfloat h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat n2(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),u.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),u.x),u.y);}')
      .replace(
        '#include <map_fragment>',
        `
      float dist = length(vWp.xz);
      vec4 g1 = texture2D(map, vMapUv);
      vec4 g2 = texture2D(map, vMapUv * 0.23 + 0.37);
      vec3 grassC = mix(g1.rgb, g2.rgb, 0.5) * vec3(0.9, 1.05, 0.75) * 1.25 * vColor.rgb;
      // copa em duas escalas; some com a distância (abaixo do pixel só cintilaria)
      float near = 1.0 - smoothstep(350.0, 1000.0, dist);
      float canopy = mix(0.5, n2(vWp.xz * 0.09) * 0.6 + n2(vWp.xz * 0.35) * 0.4, near);
      vec3 forestC = mix(vec3(0.018, 0.032, 0.014), vec3(0.048, 0.072, 0.026), canopy);
      // manchas grandes de pasto/capoeira e encostas íngremes com solo e rocha à mostra
      float patchN = n2(vWp.xz * 0.0042 + 3.1) * 0.65 + n2(vWp.xz * 0.013 - 1.7) * 0.35;
      float pasture = smoothstep(0.56, 0.74, patchN);
      float steep = smoothstep(0.82, 0.62, vUpN);
      vec3 farC = mix(forestC, vec3(0.075, 0.088, 0.036), pasture * 0.75);
      farC = mix(farC, vec3(0.085, 0.078, 0.062), steep * 0.55);
      float f = smoothstep(90.0, 300.0, dist);
      diffuseColor.rgb *= mix(grassC, farC, f);
      `,
      )
      // a cor por vértice já entrou na grama acima
      .replace('#include <color_fragment>', '')
  }
  const mesh = new THREE.Mesh(g, m)
  mesh.receiveShadow = true
  mesh.name = 'terreno'
  group.add(mesh)
  scene.add(group)
  return group
}
