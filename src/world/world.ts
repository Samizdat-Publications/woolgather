import * as THREE from 'three';
import type { Level } from '../game/level';
import { pointInPolygon, Rng } from '../game/math';
import { createMoodValues, sampleMood, type MoodValues } from '../render/daycycle';
import type { Assets } from './assets';
import type { Terrain } from './terrain';

// Static valley built from the Blender assets: ground, stream, sky, trees, props, buildings.

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

/** How much light falls on flat ground: sky fill plus the key light at its elevation. */
function groundLight(m: MoodValues) {
  const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  // The key light never drops below 26 degrees (see Stage.updateCamera).
  return lum(m.hemiSky) * m.hemiIntensity + lum(m.keyColor) * m.keyIntensity * Math.max(0.44, m.keyDir.y);
}
const GOLDEN_GROUND = groundLight(sampleMood(0, createMoodValues()));
/** Terrain colour tint, shared by the ground and path shaders (set from the mood each frame). */
const GROUND_TINT = { value: new THREE.Color(1, 1, 1) };

interface Placement {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  sy?: number;
}

/**
 * Turn a (possibly multi-material) prop into one InstancedMesh per material, all sharing the
 * same instance transforms. Hundreds of trees cost a handful of draw calls.
 */
function instance(proto: THREE.Object3D, spots: Placement[], opts: { shadow?: boolean; fade?: boolean } = {}) {
  proto.updateMatrixWorld(true);
  const inv = proto.matrixWorld.clone().invert();
  const group = new THREE.Group();
  group.name = `${proto.name}_instances`;
  const meshes: THREE.InstancedMesh[] = [];
  proto.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone();
    geo.applyMatrix4(inv.clone().multiply(m.matrixWorld));
    let mat = m.material as THREE.Material;
    if (opts.fade) mat = fadeMaterial(mat);
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((s, i) => {
      tmpQ.setFromAxisAngle(UP, s.rot);
      tmpS.set(s.scale, s.scale * (s.sy ?? 1), s.scale);
      tmpP.set(s.x, s.y, s.z);
      im.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    });
    im.castShadow = opts.shadow ?? true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    if (opts.fade) {
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(spots.length).fill(1), 1);
      fade.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('instanceFade', fade);
    }
    meshes.push(im);
    group.add(im);
  });
  return { group, meshes };
}

// Fade for trees between the camera and the action. Alpha-to-coverage on the multisampled scene
// target gives a soft see-through without sorting (a screen-door dither read as a checkerboard),
// and the tree keeps its shadow.
const fadeCache = new Map<THREE.Material, THREE.Material>();
function fadeMaterial(src: THREE.Material) {
  const hit = fadeCache.get(src);
  if (hit) return hit;
  const m = src.clone();
  m.alphaToCoverage = true;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = instanceFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = vFade;');
  };
  m.customProgramCacheKey = () => 'wg-fade-a2c';
  fadeCache.set(src, m);
  return m;
}

/** Stream surface. `ford` (x, z, radius) is drawn as a wide band of pale shallow water. */
function waterMaterial(ford: { x: number; z: number; r: number }) {
  return new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color('#2b5f86') },
        uShallow: { value: new THREE.Color('#4f8fb4') },
        uSky: { value: new THREE.Color('#e8d6b0') },
        uFoam: { value: new THREE.Color('#eef6f8') },
        uLight: { value: 1 },
        uTint: { value: new THREE.Color('#ffc88c') },
        uTintAmt: { value: 0.2 },
        uFord: { value: new THREE.Vector3(ford.x, ford.z, ford.r) },
        uGlint: { value: 0.2 },
      },
    ]),
    vertexShader: `
      varying vec2 vUv;
      varying vec2 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uSky, uFoam, uTint;
      uniform float uLight, uTintAmt, uGlint;
      uniform vec3 uFord;
      varying vec2 vUv;
      varying vec2 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float across = abs(vUv.y - 0.5) * 2.0;
        vec3 col = mix(uDeep, uShallow, smoothstep(0.15, 1.0, across));
        // The stream mirrors the sky: gold, then rose, then violet (at its own brightness).
        const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
        // The ford: pale turquoise shallows over a gravel bed, with ripples running across, so it
        // reads as a place a flock can wade (the rest of the stream stays deep).
        float fd = length(vWorld - uFord.xy) / uFord.z;
        float shallow = 1.0 - smoothstep(0.8, 1.3, fd);
        float gravel = vnoise(vWorld * 3.1) * 0.6 + vnoise(vWorld * 7.3 + 3.0) * 0.4;
        vec3 bed = mix(vec3(0.16, 0.38, 0.36), vec3(0.34, 0.5, 0.42), gravel);
        float ripple = smoothstep(0.6, 0.95, sin(vWorld.y * 2.6 + vWorld.x * 0.8 - uTime * 2.2) * 0.5 + 0.5);
        col = mix(col, bed + ripple * 0.12, shallow * 0.8);
        col = mix(col, uTint * (dot(col, LW) / max(dot(uTint, LW), 0.001)), uTintAmt);
        // Broken glints drifting downstream: noise stretched along the flow, not regular waves.
        vec2 p = vec2(vUv.x * 7.0 - uTime * 0.55, vUv.y * 3.0);
        float n = vnoise(p * vec2(1.0, 2.2)) * 0.6 + vnoise(p * vec2(2.3, 4.1) + 7.0) * 0.4;
        float glint = smoothstep(0.66, 0.8, n) * (1.0 - smoothstep(0.75, 1.0, across));
        col = mix(col, uFoam, smoothstep(0.84, 0.98, across) * 0.35);
        // Unlit water has to follow the light on the valley floor or it glows at dusk; the sky's
        // sparkle on the ripples stays bright in every light (moonlit glints at night).
        col *= uLight;
        col += uSky * glint * uGlint;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#7ea6d0') },
      uHorizon: { value: new THREE.Color('#f8d49a') },
      uGlow: { value: new THREE.Color('#fff0c8') },
      uSunDir: { value: new THREE.Vector3(0.5, 0.3, 0.5).normalize() },
      uNight: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 uTop, uHorizon, uGlow, uSunDir;
      uniform float uNight, uTime;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.05, 0.75, h), 0.8));
        float sun = max(dot(d, normalize(uSunDir)), 0.0);
        col += uGlow * (pow(sun, 8.0) * 0.55 + pow(sun, 200.0) * 1.6) * (1.0 - uNight * 0.8);
        // Stars fade in at night.
        vec3 g = floor(d * 180.0);
        float star = step(0.9965, hash(g)) * smoothstep(0.05, 0.4, h);
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 1.0) * 40.0);
        col += vec3(0.95, 0.93, 1.0) * star * tw * uNight;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export interface WorldHandles {
  root: THREE.Group;
  sky: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  gateN: THREE.Object3D | null;
  gateS: THREE.Object3D | null;
  glowMaterials: THREE.MeshLambertMaterial[];
  /** Rock and wall stone: a faint warm self-light at night keeps grey stone from going indigo. */
  stoneMaterials: THREE.MeshLambertMaterial[];
  fadeables: { meshes: THREE.InstancedMesh[]; spots: Placement[]; canopy: number; height: number }[];
  lanternLight: THREE.PointLight;
}

export function buildWorld(level: Level, terrain: Terrain, a: Assets): WorldHandles {
  const root = new THREE.Group();
  root.name = 'world';
  const L = level.data;
  const rng = new Rng(9001);
  const g = (x: number, z: number) => terrain.ground(x, z);

  // Ground. Smooth shading (flat facets turned into a checkerboard under a low sun), and a tint
  // multiplied into its colours that warms the grass at sunset and cools it at night.
  const ground = a.terrain;
  ground.receiveShadow = true;
  const tinted: THREE.MeshLambertMaterial[] = [];
  const tint = (o: THREE.Object3D, smooth: boolean) => {
    const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (!m || !m.isMeshLambertMaterial || tinted.includes(m)) return;
    tinted.push(m);
    if (smooth) m.flatShading = false;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uGround = GROUND_TINT;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uGround;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= uGround;');
    };
    m.customProgramCacheKey = () => (smooth ? 'wg-ground-smooth' : 'wg-ground');
    m.needsUpdate = true;
  };
  ground.traverse((o) => tint(o, true));
  root.add(ground);
  a.path.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = true;
    tint(o, false);
  });
  root.add(a.path);

  // Stream.
  const water = a.water as unknown as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  water.material = waterMaterial(level.ford);
  water.receiveShadow = false;
  water.castShadow = false;
  root.add(water);

  // Sky dome follows the camera (positioned each frame by the stage).
  const skyProto = a.fx.get('sky_dome')!;
  const skyMesh = (skyProto as THREE.Mesh).isMesh ? (skyProto as THREE.Mesh) : (skyProto.children[0] as THREE.Mesh);
  const sky = new THREE.Mesh(skyMesh.geometry, skyMaterial());
  sky.scale.setScalar(420);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.castShadow = false;
  sky.receiveShadow = false;
  root.add(sky);

  const fadeables: WorldHandles['fadeables'] = [];

  // Trees from the level, grouped per kind.
  const kinds: Record<string, { proto: string; canopy: number; height: number }> = {
    pine: { proto: 'pine_a', canopy: 1.9, height: 5.6 },
    oak: { proto: 'oak', canopy: 2.6, height: 5.5 },
    birch: { proto: 'birch', canopy: 1.3, height: 5.8 },
  };
  for (const [kind, info] of Object.entries(kinds)) {
    const spots = level.trees
      .filter((t) => t.kind === kind)
      .map((t) => ({ x: t.x, y: g(t.x, t.z) - 0.1, z: t.z, rot: rng.range(0, Math.PI * 2), scale: t.s }));
    if (!spots.length) continue;
    const inst = instance(a.nature.get(info.proto)!, spots, { fade: true });
    root.add(inst.group);
    fadeables.push({ meshes: inst.meshes, spots, canopy: info.canopy, height: info.height });
  }

  // Forest ring outside the valley edge.
  const forestA: Placement[] = [];
  const forestB: Placement[] = [];
  const forestBirch: Placement[] = [];
  for (let i = 0; i < 9000 && forestA.length + forestB.length + forestBirch.length < 460; i++) {
    const x = rng.range(L.world.minX + 3, L.world.maxX - 3);
    const z = rng.range(L.world.minZ + 3, L.world.maxZ - 3);
    if (pointInPolygon(x, z, level.boundary)) continue;
    const d = level.boundaryDistance(x, z);
    if (d < 2.2 || d > 36) continue;
    if (level.streamQuery(x, z).d < level.streamHalf + 2.5) continue;
    const s: Placement = { x, y: g(x, z) - 0.15, z, rot: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.45), sy: rng.range(0.9, 1.15) };
    const r = rng.next();
    if (d < 9 && r < 0.14) forestBirch.push(s);
    else if (r < 0.55) forestA.push(s);
    else forestB.push(s);
  }
  for (const [proto, spots, canopy, height] of [
    ['pine_a', forestA, 1.9, 5.6],
    ['pine_b', forestB, 1.8, 6.6],
    ['birch', forestBirch, 1.3, 5.8],
  ] as const) {
    const inst = instance(a.nature.get(proto)!, spots, { fade: true });
    root.add(inst.group);
    fadeables.push({ meshes: inst.meshes, spots: spots as Placement[], canopy, height });
  }

  // Bushes and rocks from the level (they have colliders).
  const bushSpots = L.bushes.map(([x, z, s]) => ({ x, y: g(x, z) - 0.05, z, rot: rng.range(0, 6.28), scale: s * 1.05 }));
  root.add(instance(a.nature.get('bush_a')!, bushSpots.filter((_, i) => i % 2 === 0)).group);
  root.add(instance(a.nature.get('bush_b')!, bushSpots.filter((_, i) => i % 2 === 1)).group);
  const rockKinds = ['rock_a', 'rock_b', 'rock_c'];
  for (let k = 0; k < 3; k++) {
    const spots = L.rocks
      .filter((_, i) => i % 3 === k)
      .map(([x, z, r]) => ({ x, y: g(x, z) - 0.15 * r, z, rot: rng.range(0, 6.28), scale: r * 0.95 }));
    if (spots.length) root.add(instance(a.nature.get(rockKinds[k])!, spots).group);
  }

  // Ground detail: grass, flowers, heather, reeds. No colliders, no shadows (cheap).
  const clear = (x: number, z: number, pad: number) => {
    if (!pointInPolygon(x, z, level.boundary)) return false;
    if (level.boundaryDistance(x, z) < 1) return false;
    if (level.streamQuery(x, z).d < level.streamHalf + 0.6) return false;
    if (level.inFold(x, z, -1.5)) return false;
    for (const r of level.rects) if (x > r.minX - 2 && x < r.maxX + 2 && z > r.minZ - 2 && z < r.maxZ + 2) return false;
    for (const c of level.circles) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + pad) ** 2) return false;
    return true;
  };
  const onPath = (x: number, z: number) => {
    const P = L.path;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i];
      const [bx, bz] = P[i + 1];
      const abx = bx - ax;
      const abz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz)));
      if ((x - ax - abx * t) ** 2 + (z - az - abz * t) ** 2 < 1.8 * 1.8) return true;
    }
    return false;
  };
  const scatter = (count: number, test: (x: number, z: number) => boolean, scale: [number, number]) => {
    const out: Placement[] = [];
    for (let i = 0; i < count * 6 && out.length < count; i++) {
      const x = rng.range(-95, 95);
      const z = rng.range(-75, 75);
      if (!test(x, z)) continue;
      out.push({ x, y: g(x, z) - 0.02, z, rot: rng.range(0, 6.28), scale: rng.range(scale[0], scale[1]) });
    }
    return out;
  };
  const grassTest = (x: number, z: number) => clear(x, z, 0.4) && !onPath(x, z);
  root.add(instance(a.nature.get('grass_a')!, scatter(1300, grassTest, [0.8, 1.5]), { shadow: false }).group);
  root.add(instance(a.nature.get('grass_b')!, scatter(1300, grassTest, [0.8, 1.5]), { shadow: false }).group);
  const meadow = (x: number, z: number) => x > -40 && grassTest(x, z) && Math.sin(x * 0.11) * Math.cos(z * 0.13) > 0.1;
  root.add(instance(a.nature.get('flower_white')!, scatter(260, meadow, [0.9, 1.3]), { shadow: false }).group);
  root.add(instance(a.nature.get('flower_yellow')!, scatter(260, meadow, [0.9, 1.3]), { shadow: false }).group);
  // Highland ground cover: heather, bracken and gorse in patches on the far bank and along every
  // slope near the rim, where the grass gives way to the hill.
  const patch = (x: number, z: number, k: number) => Math.sin(x * 0.083 + k) * Math.cos(z * 0.097 - k * 0.7) + Math.sin((x + z) * 0.041 + k * 2.1) * 0.5;
  const upland = (x: number, z: number) => x < -48 || level.boundaryDistance(x, z) < 18;
  const hill = (x: number, z: number) => upland(x, z) && grassTest(x, z) && patch(x, z, 0.3) > 0.1;
  root.add(instance(a.nature.get('heather')!, scatter(460, hill, [0.9, 1.6]), { shadow: false }).group);
  const fern = (x: number, z: number) => upland(x, z) && grassTest(x, z) && patch(x, z, 2.2) > 0.35;
  root.add(instance(a.nature.get('bracken_a')!, scatter(170, fern, [0.9, 1.4]), { shadow: false }).group);
  root.add(instance(a.nature.get('bracken_b')!, scatter(150, fern, [0.9, 1.4]), { shadow: false }).group);
  const gorseSpot = (x: number, z: number) => level.boundaryDistance(x, z) < 14 && grassTest(x, z) && patch(x, z, 4.1) > 0.45;
  root.add(instance(a.nature.get('gorse')!, scatter(70, gorseSpot, [0.8, 1.3])).group);
  const bank = (x: number, z: number) => {
    const d = level.streamQuery(x, z).d;
    return d > level.streamHalf - 0.2 && d < level.streamHalf + 1.6 && pointInPolygon(x, z, level.boundary) && !level.crossingAt(x, z) && level.streamQuery(x, z).d > 0;
  };
  root.add(instance(a.nature.get('reeds')!, scatter(170, bank, [0.8, 1.3]), { shadow: false }).group);

  // Old field walls: 4 m sections laid end to end along each line, some half fallen.
  const wallSpots: Placement[] = [];
  const brokenSpots: Placement[] = [];
  for (const line of L.fieldWalls) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 4));
      const rot = -Math.atan2(bz - az, bx - ax);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const spot = { x, y: g(x, z) - 0.06, z, rot: rot + rng.range(-0.03, 0.03), scale: 1 };
        (rng.next() < 0.3 ? brokenSpots : wallSpots).push(spot);
      }
    }
  }
  if (wallSpots.length) root.add(instance(a.structures.get('field_wall')!, wallSpots).group);
  if (brokenSpots.length) root.add(instance(a.structures.get('field_wall_broken')!, brokenSpots).group);

  // Logs and stumps on the forest floor just outside the valley.
  const floorSpots = (n: number) => scatter(n, (x, z) => !pointInPolygon(x, z, level.boundary) && level.boundaryDistance(x, z) > 2 && level.boundaryDistance(x, z) < 8, [0.9, 1.2]);
  root.add(instance(a.nature.get('log')!, floorSpots(8)).group);
  root.add(instance(a.nature.get('stump')!, floorSpots(8)).group);

  // Buildings and props.
  const place = (name: string, x: number, y: number, z: number, rotY = 0) => {
    const o = a.structures.get(name)!.clone(true);
    o.position.set(x, y, z);
    o.rotation.y = rotY;
    root.add(o);
    return o;
  };
  const f = level.fold;
  const fold = place('fold', f.cx, a.meta.foldY, f.cz);
  const gateN = fold.getObjectByName('gate_n') ?? null;
  const gateS = fold.getObjectByName('gate_s') ?? null;
  const fh = L.farmhouse.center;
  place('farmhouse', fh[0], a.meta.farmY, fh[1]);
  const b = level.bridge;
  place('bridge', b.x, terrain.bridgeDeck - 0.55, b.z, -Math.atan2(b.uz, b.ux));
  const lantern = place('lantern', L.lantern[0], g(L.lantern[0], L.lantern[1]), L.lantern[1], Math.PI * 0.75);
  for (const [x, z, deg] of L.hay) place('hay', x, g(x, z) - 0.05, z, (deg * Math.PI) / 180);
  place('signpost', L.signpost[0], g(L.signpost[0], L.signpost[1]), L.signpost[1], 0.6);
  const ford = level.ford;
  const stones = a.structures.get('stepping_stones')!.clone(true);
  const across = level.crossings[1];
  stones.position.set(ford.x, terrain.water(ford.x, ford.z) - 0.02, ford.z);
  stones.rotation.y = -Math.atan2(across.uz, across.ux);
  root.add(stones);

  // Warm light from the lantern at the fold gate once dusk falls.
  const lanternLight = new THREE.PointLight(0xffc766, 0, 16, 1.6);
  const lampPos = new THREE.Vector3();
  (lantern.getObjectByName('lantern_light') ?? lantern).getWorldPosition(lampPos);
  lanternLight.position.copy(lampPos);
  root.add(lanternLight);

  // Materials that glow at night (windows, lantern glass), and stone that must stay grey by moonlight.
  const glowMaterials: THREE.MeshLambertMaterial[] = [];
  const stoneMaterials: THREE.MeshLambertMaterial[] = [];
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[] | undefined;
    for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
      if (!mm.emissive) continue;
      if (mm.emissive.getHex() !== 0) {
        if (!glowMaterials.includes(mm)) glowMaterials.push(mm);
      } else if (/^(stone_|drystone_|pillar|chimney_stone|house_plinth)/.test(mm.name) && !stoneMaterials.includes(mm)) {
        mm.emissive.set(0x5a4a38);
        mm.emissiveIntensity = 0;
        stoneMaterials.push(mm);
      }
    }
  });

  return { root, sky, water, gateN, gateS, glowMaterials, stoneMaterials, fadeables, lanternLight };
}

/** Per-frame world updates: water flow, sky colours, night glow, and fading trees that block the view. */
export function updateWorld(w: WorldHandles, mood: MoodValues, time: number, camera: THREE.Camera, focus: { x: number; z: number }[], dt: number) {
  const wu = w.water.material.uniforms;
  wu.uTime.value = time;
  // Glints are sky colour washed towards white, so sunset hues read as sparkle, not blotches.
  wu.uSky.value.copy(mood.skyHorizon).lerp(WHITE, 0.55);
  // Water brightness follows the light falling on flat ground, relative to golden hour; its tint
  // is the sky it reflects: the horizon's gold and rose, then the moonlit sky.
  wu.uLight.value = Math.min(1.05, Math.max(0.3, groundLight(mood) / GOLDEN_GROUND));
  wu.uGlint.value = 0.2 + 0.12 * mood.night;
  GROUND_TINT.value.copy(mood.ground);
  wu.uTint.value.copy(mood.skyHorizon).lerp(mood.hemiSky, mood.night);
  // Blue by day; the sky's colour takes over from the sunset on.
  wu.uTintAmt.value = 0.1 + 0.45 * Math.min(1, Math.max(0, (mood.t - 0.3) / 0.15)) + 0.1 * mood.night;
  const su = w.sky.material.uniforms;
  su.uTop.value.copy(mood.skyTop);
  su.uHorizon.value.copy(mood.skyHorizon);
  su.uGlow.value.copy(mood.sunGlow);
  su.uSunDir.value.copy(mood.sunDir);
  su.uNight.value = mood.night;
  su.uTime.value = time;
  w.sky.position.copy(camera.position);
  for (const m of w.glowMaterials) m.emissiveIntensity = 0.15 + 1.6 * mood.night;
  for (const m of w.stoneMaterials) m.emissiveIntensity = 0.75 * mood.night;
  // The fold lantern is the one warm light at night: strong enough to pool on the grass.
  w.lanternLight.intensity = 32 * Math.max(0, mood.night - 0.15);

  // Trees standing between the camera and anything that matters fade to a dither.
  const k = 1 - Math.exp(-6 * dt);
  for (const f of w.fadeables) {
    const attr = f.meshes[0].geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute | undefined;
    if (!attr) continue;
    let dirty = false;
    for (let i = 0; i < f.spots.length; i++) {
      const s = f.spots[i];
      // From the ~48 degree camera the canopy covers ground up to about its height north of the trunk.
      const reach = f.height * s.scale * 0.95;
      let hide = false;
      for (const p of focus) {
        const dz = s.z - p.z;
        if (dz < -0.5 || dz > reach + 1.5) continue;
        if (Math.abs(s.x - p.x) < f.canopy * s.scale + 1.2) {
          hide = true;
          break;
        }
      }
      const cur = attr.getX(i);
      // A faint ghost of the tree stays, so the player knows it is there.
      const want = hide ? 0.25 : 1;
      if (Math.abs(cur - want) > 0.005) {
        const next = cur + (want - cur) * k;
        for (const m of f.meshes) (m.geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute).setX(i, next);
        dirty = true;
      }
    }
    if (dirty) for (const m of f.meshes) (m.geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
