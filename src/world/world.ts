import * as THREE from 'three';
import type { Level } from '../game/level';
import { pointInPolygon, Rng } from '../game/math';
import type { MoodValues } from '../render/daycycle';
import type { Assets } from './assets';
import type { Terrain } from './terrain';

// Static valley built from the Blender assets: ground, stream, sky, trees, props, buildings.

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

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

// Screen-door fade for trees between the camera and the action (keeps shadows, no sorting).
const fadeCache = new Map<THREE.Material, THREE.Material>();
function fadeMaterial(src: THREE.Material) {
  const hit = fadeCache.get(src);
  if (hit) return hit;
  const m = src.clone();
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = instanceFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vFade;
        const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (vFade < 0.999) {
          ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
          if (vFade * 16.0 <= BAYER[q.x + q.y * 4] + 0.5) discard;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'wg-fade';
  fadeCache.set(src, m);
  return m;
}

function waterMaterial() {
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
        uTint: { value: new THREE.Color('#7e86bc') },
        uNight: { value: 0 },
      },
    ]),
    vertexShader: `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uSky, uFoam, uTint;
      uniform float uLight, uNight;
      varying vec2 vUv;
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
        // Broken glints drifting downstream: noise stretched along the flow, not regular waves.
        vec2 p = vec2(vUv.x * 7.0 - uTime * 0.55, vUv.y * 3.0);
        float n = vnoise(p * vec2(1.0, 2.2)) * 0.6 + vnoise(p * vec2(2.3, 4.1) + 7.0) * 0.4;
        float glint = smoothstep(0.66, 0.8, n) * (1.0 - smoothstep(0.75, 1.0, across));
        col += uSky * glint * 0.2;
        col = mix(col, uFoam, smoothstep(0.84, 0.98, across) * 0.35);
        col *= uLight;
        // By night the stream goes slate grey with a hint of the moonlit sky instead of staying
        // daytime blue (the colour grade adds the blue back).
        float lum = dot(col, vec3(0.3, 0.55, 0.15));
        col = mix(col, mix(vec3(lum), uTint * lum * 1.6, 0.25), uNight * 0.9);
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

  // Ground.
  const ground = a.terrain;
  ground.receiveShadow = true;
  root.add(ground);
  a.path.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = true;
  });
  root.add(a.path);

  // Stream.
  const water = a.water as unknown as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  water.material = waterMaterial();
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
  const hill = (x: number, z: number) => x < -48 && grassTest(x, z);
  root.add(instance(a.nature.get('heather')!, scatter(170, hill, [0.9, 1.5]), { shadow: false }).group);
  const bank = (x: number, z: number) => {
    const d = level.streamQuery(x, z).d;
    return d > level.streamHalf - 0.2 && d < level.streamHalf + 1.6 && pointInPolygon(x, z, level.boundary) && !level.crossingAt(x, z) && level.streamQuery(x, z).d > 0;
  };
  root.add(instance(a.nature.get('reeds')!, scatter(170, bank, [0.8, 1.3]), { shadow: false }).group);

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
  wu.uLight.value = 0.38 + 0.62 * (1 - mood.night);
  wu.uTint.value.copy(mood.hemiSky);
  wu.uNight.value = mood.night;
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
  w.lanternLight.intensity = 14 * Math.max(0, mood.night - 0.15);

  // Trees standing between the camera and anything that matters fade to a dither.
  const k = 1 - Math.exp(-6 * dt);
  for (const f of w.fadeables) {
    const attr = f.meshes[0].geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute | undefined;
    if (!attr) continue;
    let dirty = false;
    for (let i = 0; i < f.spots.length; i++) {
      const s = f.spots[i];
      // The canopy covers ground up to ~0.75 * height north of the trunk from this camera angle.
      const reach = f.height * s.scale * 0.8;
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
      // Mostly gone: a denser dither read as a dark checkered ghost of the tree.
      const want = hide ? 0.16 : 1;
      if (Math.abs(cur - want) > 0.005) {
        const next = cur + (want - cur) * k;
        for (const m of f.meshes) (m.geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute).setX(i, next);
        dirty = true;
      }
    }
    if (dirty) for (const m of f.meshes) (m.geometry.getAttribute('instanceFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
