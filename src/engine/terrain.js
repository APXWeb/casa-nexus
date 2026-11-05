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

/** Altura do terreno fora do lote (o lote fica plano em y=0). */
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z - 0)
  // vale suave: platô até ~70 m, colinas a partir de ~180 m, serras após ~600 m
  const near = THREE.MathUtils.smoothstep(r, 60, 240) * (fbm(x * 0.008, z * 0.008, 4) * 26 - 6)
  const far = THREE.MathUtils.smoothstep(r, 380, 1300) * (fbm(x * 0.0024 + 7, z * 0.0024 - 3, 5) * 380 - 40)
  return Math.max(-0.2, near + far) - 0.16
}

export function buildTerrain(scene, texLoader, base) {
  const group = new THREE.Group()
  group.name = 'entorno'
  // malha radial: densa perto, rala longe
  const rings = 96,
    segs = 160
  const pos = [],
    uv = [],
    col = [],
    idx = []
  const radii = []
  for (let i = 0; i <= rings; i++) radii.push(1 + Math.pow(i / rings, 2.2) * 3400)
  const cFar = new THREE.Color(0x33452f),
    cNear = new THREE.Color(0x6d8a4c),
    cDry = new THREE.Color(0x8f8a5a)
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2
      const r = radii[i]
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r + 0
      const y = terrainHeight(x, z)
      pos.push(x, y, z)
      uv.push(x / 6, z / 6)
      const forest = THREE.MathUtils.smoothstep(r, 120, 420)
      const v = fbm(x * 0.03, z * 0.03, 3)
      const c = cNear.clone().lerp(cDry, v * 0.35).lerp(cFar, forest)
      col.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j,
        b = a + segs + 1
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
    // textura só perto; longe, cor da mata com variação de copa
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;',
    )
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nfloat h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat n2(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),u.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),u.x),u.y);}').replace(
      '#include <map_fragment>',
      `
      float dist = length(vWp.xz);
      vec4 g1 = texture2D(map, vMapUv);
      vec4 g2 = texture2D(map, vMapUv * 0.23 + 0.37);
      vec3 grassC = mix(g1.rgb, g2.rgb, 0.5) * vec3(0.9, 1.05, 0.75);
      float canopy = n2(vWp.xz * 0.09) * 0.6 + n2(vWp.xz * 0.35) * 0.4;
      vec3 forestC = mix(vec3(0.05, 0.085, 0.045), vec3(0.11, 0.16, 0.075), canopy);
      float f = smoothstep(90.0, 300.0, dist);
      diffuseColor.rgb *= mix(grassC * 1.25, forestC * 3.2, f);
      `,
    )
  }
  const mesh = new THREE.Mesh(g, m)
  mesh.receiveShadow = true
  mesh.name = 'terreno'
  group.add(mesh)
  scene.add(group)
  return group
}
