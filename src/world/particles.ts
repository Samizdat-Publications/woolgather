import * as THREE from 'three';
import type { Assets } from './assets';
import type { Terrain } from './terrain';

// Pooled particle bursts built from the Blender fx meshes: paw dust, splashes, wool tufts, hearts
// over sheep that reach the fold, expanding bark rings, and fireflies at dusk. Particles fade by
// shrinking (the flat Lambert look has no per-instance alpha), which reads fine at this scale.

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  rot: number;
  gravity: number;
  drag: number;
  /** Size curve: 'puff' grows then shrinks, 'pop' pops in and shrinks, 'fall' stays then shrinks. */
  curve: 'puff' | 'pop' | 'fall';
  /** Lands on the ground instead of falling through it. */
  settle: boolean;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private items: P[] = [];

  constructor(
    proto: THREE.Object3D,
    private max: number,
    private billboard = false,
  ) {
    let src: THREE.Mesh | null = null;
    proto.traverse((o) => {
      if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
    });
    const m = src as unknown as THREE.Mesh;
    this.mesh = new THREE.InstancedMesh(m.geometry, m.material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  add(p: P) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(p);
  }

  update(dt: number, terrain: Terrain, camera: THREE.Camera) {
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.items.splice(i, 1);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.settle) {
        const g = terrain.surface(p.x, p.z) + 0.05;
        if (p.y < g) {
          p.y = g;
          p.vy = 0;
          p.vx *= 0.5;
          p.vz *= 0.5;
        }
      }
      p.rot += p.spin * dt;
    }
    for (const p of this.items) {
      const u = p.age / p.life;
      const s =
        p.curve === 'puff'
          ? p.size * Math.sin(Math.min(1, u * 1.15) * Math.PI) * (0.6 + u * 0.8)
          : p.curve === 'pop'
            ? p.size * Math.min(1, u * 8) * (1 - Math.pow(u, 3))
            : p.size * (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3);
      if (this.billboard) tmpQ.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(tmpE.set(0, 0, Math.sin(p.rot) * 0.25)));
      else tmpQ.setFromEuler(tmpE.set(p.rot, p.rot * 0.7, 0));
      tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.setScalar(Math.max(0.0001, s)));
      this.mesh.setMatrixAt(n++, tmpM);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** An expanding ring decal on the ground (the bark shockwave). */
class Ripple {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private base: Float32Array;
  age = 99;
  life = 0.5;
  x = 0;
  z = 0;
  y = 0;
  from = 1;
  to = 10;
  onWater = false;

  constructor(
    proto: THREE.Object3D,
    color: number,
    private terrain: Terrain,
  ) {
    let src: THREE.Mesh | null = null;
    proto.traverse((o) => {
      if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
    });
    const geo = (src as unknown as THREE.Mesh).geometry.clone();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.base = (pos.array as Float32Array).slice();
    pos.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  start(x: number, z: number, from: number, to: number, life: number, y: number | null = null) {
    this.x = x;
    this.z = z;
    this.from = from;
    this.to = to;
    this.life = life;
    this.age = 0;
    this.onWater = y !== null;
    this.y = y ?? 0;
    this.mesh.visible = true;
  }

  update(dt: number, peak: number) {
    if (this.age >= this.life) {
      this.mesh.visible = false;
      return;
    }
    this.age += dt;
    const u = Math.min(1, this.age / this.life);
    const e = 1 - Math.pow(1 - u, 3);
    const r = this.from + (this.to - this.from) * e;
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const wx = this.x + this.base[i] * r;
      const wz = this.z + this.base[i + 2] * r;
      arr[i] = wx;
      arr[i + 1] = this.onWater ? this.y : this.terrain.surface(wx, wz) + 0.1;
      arr[i + 2] = wz;
    }
    pos.needsUpdate = true;
    this.mesh.material.opacity = peak * (1 - u);
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.3, 'rgba(230,255,140,0.7)');
  grad.addColorStop(1, 'rgba(180,255,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Particles {
  readonly root = new THREE.Group();
  private dustPool: Pool;
  private dropPool: Pool;
  private tuftPool: Pool;
  private heartPool: Pool;
  private rings: Ripple[] = [];
  private flies: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(
    a: Assets,
    private terrain: Terrain,
    fireflySpots: { x: number; z: number }[],
  ) {
    this.dustPool = new Pool(a.fx.get('dust_puff')!, 90);
    this.dropPool = new Pool(a.fx.get('splash_drop')!, 120);
    this.tuftPool = new Pool(a.fx.get('wool_tuft')!, 60);
    this.heartPool = new Pool(a.fx.get('heart')!, 16, true);
    for (const p of [this.dustPool, this.dropPool, this.tuftPool, this.heartPool]) this.root.add(p.mesh);
    for (let i = 0; i < 6; i++) {
      const r = new Ripple(a.fx.get('bark_ring')!, i < 3 ? 0xffe2a0 : 0xe8f4ff, terrain);
      this.rings.push(r);
      this.root.add(r.mesh);
    }

    // Fireflies: points scattered near cover, drifting and blinking in the vertex shader.
    const n = fireflySpots.length;
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    fireflySpots.forEach((s, i) => {
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = terrain.ground(s.x, s.z) + 0.8 + Math.random() * 1.6;
      pos[i * 3 + 2] = s.z;
      phase[i] = Math.random() * 100;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.flies = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uMap: { value: glowTexture() }, uScale: { value: 300 } },
        vertexShader: `
          attribute float phase;
          uniform float uTime, uNight, uScale;
          varying float vA;
          void main() {
            vec3 p = position;
            p.x += sin(uTime * 0.37 + phase) * 1.4;
            p.z += cos(uTime * 0.29 + phase * 1.3) * 1.4;
            p.y += sin(uTime * 0.8 + phase * 0.7) * 0.35;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float blink = pow(max(0.0, sin(uTime * (0.9 + fract(phase) * 0.8) + phase)), 3.0);
            vA = uNight * blink;
            gl_PointSize = uScale * 0.35 / -mv.z * (0.6 + blink * 0.6);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D uMap;
          varying float vA;
          void main() {
            vec4 c = texture2D(uMap, gl_PointCoord);
            gl_FragColor = vec4(c.rgb, c.a * vA);
          }`,
      }),
    );
    this.flies.frustumCulled = false;
    this.root.add(this.flies);
  }

  /** Paw or hoof dust kicked up at (x, z). */
  dust(x: number, z: number, dirX = 0, dirZ = 0, size = 1) {
    const y = this.terrain.surface(x, z) + 0.15;
    this.dustPool.add({
      x: x + (Math.random() - 0.5) * 0.4,
      y,
      z: z + (Math.random() - 0.5) * 0.4,
      vx: -dirX * 0.8 + (Math.random() - 0.5) * 0.8,
      vy: 0.5 + Math.random() * 0.5,
      vz: -dirZ * 0.8 + (Math.random() - 0.5) * 0.8,
      age: 0,
      life: 0.55 + Math.random() * 0.3,
      size: (0.9 + Math.random() * 0.5) * size,
      spin: (Math.random() - 0.5) * 2,
      rot: Math.random() * 6,
      gravity: 0,
      drag: 2.5,
      curve: 'puff',
      settle: false,
    });
  }

  /** Droplets flung up and a ripple on the water surface. */
  splash(x: number, z: number, big: boolean) {
    const y = this.terrain.surface(x, z) + 0.05;
    const n = big ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * (big ? 2.2 : 1.4);
      this.dropPool.add({
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: 2.5 + Math.random() * (big ? 3 : 1.8),
        vz: Math.sin(a) * sp,
        age: 0,
        life: 0.7,
        size: 1 + Math.random() * 0.8,
        spin: 0,
        rot: 0,
        gravity: 14,
        drag: 0.5,
        curve: 'fall',
        settle: false,
      });
    }
    this.ripple(x, z, 0.4, big ? 2.6 : 1.6, 0.7, y, false);
  }

  /** Wool torn loose in a scuffle: tufts drift down slowly. */
  tufts(x: number, z: number, n = 8) {
    const y = this.terrain.surface(x, z) + 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.6;
      this.tuftPool.add({
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: 1.5 + Math.random() * 2,
        vz: Math.sin(a) * sp,
        age: 0,
        life: 1.6 + Math.random() * 0.8,
        size: 1.2 + Math.random() * 0.9,
        spin: (Math.random() - 0.5) * 6,
        rot: Math.random() * 6,
        gravity: 2.2,
        drag: 1.5,
        curve: 'fall',
        settle: true,
      });
    }
  }

  /** A heart rising over a sheep that made it home. */
  heart(x: number, z: number) {
    this.heartPool.add({
      x,
      y: this.terrain.surface(x, z) + 1.6,
      z,
      vx: 0,
      vy: 1.1,
      vz: 0,
      age: 0,
      life: 1.3,
      size: 0.95,
      spin: 5,
      rot: 0,
      gravity: 0,
      drag: 0.8,
      curve: 'pop',
      settle: false,
    });
  }

  /** Expanding ground ring (bark shockwave or water ripple). */
  ripple(x: number, z: number, from: number, to: number, life: number, y: number | null = null, warm = true) {
    const set = warm ? this.rings.slice(0, 3) : this.rings.slice(3);
    const r = set.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    r.start(x, z, from, to, life, y);
  }

  update(dt: number, camera: THREE.Camera, time: number, night: number) {
    this.dustPool.update(dt, this.terrain, camera);
    this.dropPool.update(dt, this.terrain, camera);
    this.tuftPool.update(dt, this.terrain, camera);
    this.heartPool.update(dt, this.terrain, camera);
    this.rings.forEach((r, i) => r.update(dt, i < 3 ? 0.75 : 0.5));
    const u = this.flies.material.uniforms;
    u.uTime.value = time;
    u.uNight.value = Math.max(0, Math.min(1, (night - 0.25) / 0.45));
    u.uScale.value = window.innerHeight;
    this.flies.visible = night > 0.25;
  }
}
