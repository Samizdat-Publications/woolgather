import * as THREE from 'three';
import type { Level } from '../game/level';
import { Rng } from '../game/math';
import type { Sim } from '../game/sim';
import type { MoodValues } from '../render/daycycle';
import type { Terrain } from './terrain';
import type { Season } from './terraingen';

// The valley's own life, none of it gameplay: a starling murmuration wheeling over the sunset (a
// flock above the flock), smoke from the farmhouse chimney, and rabbits that bolt when Pip comes
// near.

function softTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BIRDS = 420;
const PUFFS = 36;
const RABBITS = 7;

interface Rabbit {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  hopT: number;
  /** Seconds left bolting (0 = nibbling). */
  run: number;
  /** Gone down a burrow until this many seconds pass. */
  hidden: number;
  phase: number;
}

export class Life {
  readonly root = new THREE.Group();
  private birds: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private birdHome: Float32Array;
  private smoke: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private puffs: { x: number; y: number; z: number; age: number; life: number }[] = [];
  private rabbitMesh: THREE.InstancedMesh;
  private rabbits: Rabbit[] = [];
  private rng = new Rng(77);
  private flight = { cx: 0, cz: 0, dx: 1, dz: 0, t: -1, next: 8 };
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(
    private level: Level,
    private terrain: Terrain,
    private season: Season,
    private chimney: THREE.Vector3 | null,
  ) {
    this.root.name = 'life';
    const xs = level.boundary.map((p) => p[0]);
    const zs = level.boundary.map((p) => p[1]);
    this.bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };

    // Murmuration: each bird has a home point in a unit cloud; the cloud's shape breathes, folds
    // and turns, and the whole flock sweeps across the valley.
    this.birdHome = new Float32Array(BIRDS * 3);
    for (let i = 0; i < BIRDS; i++) {
      const u = this.rng.next() * 2 - 1;
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.cbrt(this.rng.next());
      const s = Math.sqrt(1 - u * u);
      this.birdHome.set([Math.cos(a) * s * r, u * r * 0.35, Math.sin(a) * s * r], i * 3);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BIRDS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.birds = new THREE.Points(
      bg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uScale: { value: 1000 }, uAlpha: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `
          uniform float uScale, uTime;
          varying float vFlap;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            vFlap = 0.6 + 0.4 * sin(uTime * 22.0 + position.x * 3.1 + position.z * 1.7);
            gl_PointSize = clamp(uScale * 0.22 / -mv.z, 1.5, 9.0);
          }`,
        fragmentShader: `
          uniform float uAlpha;
          varying float vFlap;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            // A tiny bird: a flattened dark chevron that flickers as the wings beat.
            float body = smoothstep(0.5, 0.2, length(p * vec2(1.0, 2.6 / vFlap)));
            if (body < 0.05) discard;
            gl_FragColor = vec4(0.08, 0.07, 0.1, body * uAlpha);
          }`,
      }),
    );
    this.birds.frustumCulled = false;
    this.birds.renderOrder = 6;
    this.root.add(this.birds);

    if (chimney) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PUFFS * 3), 3).setUsage(THREE.DynamicDrawUsage));
      sg.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(PUFFS), 1).setUsage(THREE.DynamicDrawUsage));
      this.smoke = new THREE.Points(
        sg,
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { uMap: { value: softTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)') }, uScale: { value: 1000 }, uColor: { value: new THREE.Color('#c8c2ba') } },
          vertexShader: `
            attribute float aLife;
            uniform float uScale;
            varying float vLife;
            void main() {
              vLife = aLife;
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_Position = projectionMatrix * mv;
              gl_PointSize = min(70.0, uScale * (0.7 + aLife * 2.6) / -mv.z);
            }`,
          fragmentShader: `
            uniform sampler2D uMap;
            uniform vec3 uColor;
            varying float vLife;
            void main() {
              vec4 t = texture2D(uMap, gl_PointCoord);
              float a = t.a * (1.0 - vLife) * smoothstep(0.0, 0.08, vLife) * 0.55;
              if (a < 0.01) discard;
              gl_FragColor = vec4(uColor, a);
              #include <colorspace_fragment>
            }`,
        }),
      );
      this.smoke.frustumCulled = false;
      this.smoke.renderOrder = 4;
      this.root.add(this.smoke);
      for (let i = 0; i < PUFFS; i++) this.puffs.push({ x: chimney.x, y: chimney.y, z: chimney.z, age: (i / PUFFS) * 7, life: 7 });
    }

    // Rabbits: a little low-poly body, head and ears, brown-grey (never sheep-white).
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.IcosahedronGeometry(0.32, 0);
    body.scale(1, 0.85, 1.3);
    body.translate(0, 0.3, 0);
    const head = new THREE.IcosahedronGeometry(0.2, 0);
    head.translate(0, 0.52, 0.34);
    const earL = new THREE.BoxGeometry(0.07, 0.34, 0.1);
    earL.translate(-0.07, 0.8, 0.3);
    const earR = earL.clone();
    earR.translate(0.14, 0, 0);
    const tail = new THREE.IcosahedronGeometry(0.1, 0);
    tail.translate(0, 0.36, -0.42);
    parts.push(body, head, earL, earR);
    const merged = mergeSimple(parts);
    const mat = new THREE.MeshLambertMaterial({ color: season === 'winter' ? '#a89c8c' : '#8a6e52', flatShading: true });
    this.rabbitMesh = new THREE.InstancedMesh(merged, mat, RABBITS + 1);
    this.rabbitMesh.castShadow = true;
    this.rabbitMesh.frustumCulled = false;
    const tailMesh = new THREE.InstancedMesh(tail, new THREE.MeshLambertMaterial({ color: '#b8ab98', flatShading: true }), RABBITS + 1);
    tailMesh.frustumCulled = false;
    this.tailMesh = tailMesh;
    this.root.add(this.rabbitMesh, tailMesh);
    for (let i = 0; i < RABBITS; i++) {
      const p = this.randomGrass();
      this.rabbits.push({ x: p.x, z: p.z, vx: 0, vz: 0, facing: this.rng.range(0, 6.28), hopT: 0, run: 0, hidden: 0, phase: this.rng.next() * 10 });
    }
  }
  private tailMesh: THREE.InstancedMesh;

  private randomGrass() {
    const L = this.level;
    for (let k = 0; k < 60; k++) {
      const x = this.rng.range(this.bounds.minX, this.bounds.maxX);
      const z = this.rng.range(this.bounds.minZ, this.bounds.maxZ);
      if (!L.insideValley(x, z) || L.boundaryDistance(x, z) < 6 || L.inWater(x, z) || L.penAt(x, z, -4)) continue;
      if (L.circles.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 1) ** 2)) continue;
      return { x, z };
    }
    return { x: L.def.dogStart[0], z: L.def.dogStart[1] };
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    this.root.removeFromParent();
  }

  /** Point sizes follow the lens and the drawing buffer (set by the game each frame). */
  pointScale = 3000;

  update(dt: number, time: number, sim: Sim | null, mood: MoodValues, focus: THREE.Vector3) {
    this.updateBirds(dt, time, mood, focus);
    this.updateSmoke(dt, mood);
    this.updateRabbits(dt, time, sim);
  }

  private updateBirds(dt: number, time: number, mood: MoodValues, focus: THREE.Vector3) {
    // Starlings gather from the golden hour into the dusk; not in snow or at night.
    const window = mood.t > 0.12 && mood.t < 0.72 && this.season !== 'winter';
    const f = this.flight;
    if (f.t < 0) {
      f.next -= dt;
      if (f.next <= 0 && window) {
        // A pass across the view: start off to one side of the camera's focus and sweep across.
        const a = this.rng.range(0, Math.PI * 2);
        f.dx = Math.cos(a);
        f.dz = Math.sin(a) * 0.6;
        const l = Math.hypot(f.dx, f.dz);
        f.dx /= l;
        f.dz /= l;
        f.cx = focus.x - f.dx * 75 + this.rng.range(-10, 10);
        f.cz = focus.z - f.dz * 75 + this.rng.range(-15, 5);
        f.t = 0;
      }
    }
    const u = this.birds.material.uniforms;
    if (f.t < 0) {
      u.uAlpha.value = 0;
      this.birds.visible = false;
      return;
    }
    this.birds.visible = true;
    f.t += dt;
    const dur = 26;
    const k = f.t / dur;
    if (k >= 1) {
      f.t = -1;
      f.next = this.rng.range(25, 50);
      return;
    }
    // Swing the path into a lazy S so the cloud wheels as it crosses.
    const along = k * 150;
    const swing = Math.sin(k * Math.PI * 2) * 18;
    const cx = f.cx + f.dx * along - f.dz * swing;
    const cz = f.cz + f.dz * along + f.dx * swing;
    const cy = this.terrain.ground(cx, cz) + 26 + Math.sin(time * 0.4) * 3;
    const pos = (this.birds.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const t = time;
    // The cloud's shape: stretched and turned, breathing, folding over itself now and then.
    const sx = 13 + 6 * Math.sin(t * 0.5);
    const sz = 7 + 4 * Math.sin(t * 0.37 + 1.3);
    const rot = t * 0.35 + Math.sin(t * 0.21) * 1.2;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const fold = Math.sin(t * 0.6) * 0.9;
    for (let i = 0; i < BIRDS; i++) {
      let x = this.birdHome[i * 3] * sx;
      let y = this.birdHome[i * 3 + 1] * 6;
      let z = this.birdHome[i * 3 + 2] * sz;
      // A wave runs through the flock.
      y += Math.sin(x * 0.25 + t * 2.2) * 2.2;
      z += Math.sin(x * 0.18 - t * 1.4) * fold * 4;
      const rx = x * cr - z * sr;
      const rz = x * sr + z * cr;
      x = rx;
      z = rz;
      pos[i * 3] = cx + x;
      pos[i * 3 + 1] = cy + y;
      pos[i * 3 + 2] = cz + z;
    }
    this.birds.geometry.getAttribute('position').needsUpdate = true;
    u.uAlpha.value = Math.min(1, Math.min(k, 1 - k) * 8) * 0.85;
    u.uTime.value = time;
    u.uScale.value = this.pointScale;
  }

  private updateSmoke(dt: number, mood: MoodValues) {
    if (!this.smoke || !this.chimney) return;
    const pos = (this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const life = (this.smoke.geometry.getAttribute('aLife') as THREE.BufferAttribute).array as Float32Array;
    const c = this.chimney;
    this.puffs.forEach((p, i) => {
      p.age += dt;
      if (p.age > p.life) {
        p.age = 0;
        p.x = c.x;
        p.y = c.y;
        p.z = c.z;
      }
      // Rises, slows, and leans with the evening breeze (towards the east).
      p.y += dt * (1.6 - p.age * 0.12);
      p.x += dt * (0.5 + p.age * 0.35);
      p.z += dt * Math.sin(p.age * 0.8 + i) * 0.2;
      pos.set([p.x, p.y, p.z], i * 3);
      life[i] = p.age / p.life;
    });
    this.smoke.geometry.getAttribute('position').needsUpdate = true;
    this.smoke.geometry.getAttribute('aLife').needsUpdate = true;
    this.smoke.material.uniforms.uScale.value = this.pointScale;
    this.smoke.material.uniforms.uColor.value.set('#cfc8c0').multiplyScalar(1 - 0.6 * mood.night);
  }

  private updateRabbits(dt: number, time: number, sim: Sim | null) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const L = this.level;
    let n = 0;
    for (const r of this.rabbits) {
      if (r.hidden > 0) {
        r.hidden -= dt;
        if (r.hidden <= 0) {
          const g = this.randomGrass();
          r.x = g.x;
          r.z = g.z;
        }
        continue;
      }
      // Threats: Pip, and any wolf.
      let tx = 0;
      let tz = 0;
      let scared = false;
      if (sim) {
        const threats = [sim.dog, ...sim.wolves.filter((w) => w.state !== 'gone')];
        for (const t of threats) {
          const dx = r.x - t.x;
          const dz = r.z - t.z;
          const d = Math.hypot(dx, dz);
          if (d < 10) {
            tx += dx / (d || 1);
            tz += dz / (d || 1);
            scared = true;
          }
        }
      }
      if (scared && r.run <= 0) r.run = 2.5;
      if (r.run > 0) {
        r.run -= dt;
        const l = Math.hypot(tx, tz);
        if (l > 0) {
          r.vx = (tx / l) * 9;
          r.vz = (tz / l) * 9;
        }
        // A long bolt ends down a burrow.
        if (r.run <= 0 && this.rng.next() < 0.5) r.hidden = this.rng.range(20, 40);
      } else {
        r.vx *= 1 - Math.min(1, dt * 4);
        r.vz *= 1 - Math.min(1, dt * 4);
        // Now and then a short hop to the next nibble.
        if (this.rng.next() < dt * 0.25) {
          const a = this.rng.range(0, Math.PI * 2);
          r.vx = Math.cos(a) * 2.5;
          r.vz = Math.sin(a) * 2.5;
        }
      }
      r.x += r.vx * dt;
      r.z += r.vz * dt;
      if (!L.insideValley(r.x, r.z) || L.inWater(r.x, r.z)) {
        r.x -= r.vx * dt * 2;
        r.z -= r.vz * dt * 2;
        r.vx = -r.vx;
        r.vz = -r.vz;
      }
      const sp = Math.hypot(r.vx, r.vz);
      if (sp > 0.3) r.facing = Math.atan2(r.vx, r.vz);
      // Hopping: the body bobs in arcs while it moves.
      r.phase += dt * (sp > 0.3 ? 2 + sp * 0.9 : 0);
      const hop = sp > 0.3 ? Math.abs(Math.sin(r.phase * Math.PI)) * Math.min(0.6, 0.15 + sp * 0.05) : 0;
      q.setFromAxisAngle(up, r.facing);
      const scale = 1.5;
      s.set(scale, scale, scale);
      p.set(r.x, this.terrain.height(r.x, r.z) + hop, r.z);
      m.compose(p, q, s);
      this.rabbitMesh.setMatrixAt(n, m);
      this.tailMesh.setMatrixAt(n, m);
      n++;
      void time;
    }
    this.rabbitMesh.count = n;
    this.tailMesh.count = n;
    this.rabbitMesh.instanceMatrix.needsUpdate = true;
    this.tailMesh.instanceMatrix.needsUpdate = true;
  }
}

/** Merge position-only geometries (no attribute matching needed beyond position and normal). */
function mergeSimple(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    const a = ng.getAttribute('position');
    for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
