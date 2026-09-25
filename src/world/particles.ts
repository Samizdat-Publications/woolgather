import * as THREE from 'three';
import type { Assets } from './assets';
import type { Terrain } from './terrain';

// Particle effects: soft dust and spray puffs (camera-facing points that swell and fade), pooled
// meshes from the Blender fx set for splash drops, wool tufts and the gold hearts over sheep that
// reach the fold (they fade by shrinking), expanding bark rings, and fireflies at dusk.

/** Dust by daylight and after dark (kicked-up dirt is lit by the same light as the ground). */
const DUST_DAY = new THREE.Color('#d8c294');
const DUST_NIGHT = new THREE.Color('#57536a');

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
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.18, 'rgba(250,255,170,0.95)');
  grad.addColorStop(0.45, 'rgba(210,255,120,0.35)');
  grad.addColorStop(1, 'rgba(170,255,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Soft round puffs that face the camera and fade out as they swell (dust kicked up by running
 * animals, spray over a splash): points with a radial falloff drawn in the shader, so they read
 * as clouds rather than hard beads at the herding camera's distance.
 */
class SoftPuffs {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private items: { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; grow: number; alpha: number }[] = [];
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;

  constructor(
    private max: number,
    color: THREE.ColorRepresentation,
  ) {
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 400 } },
        vertexShader: `
          attribute float size;
          attribute float alpha;
          uniform float uScale;
          varying float vA;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vA = alpha;
            gl_PointSize = uScale * size / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 uColor;
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = vA * (1.0 - smoothstep(0.35, 1.0, d));
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  get color() {
    return this.points.material.uniforms.uColor.value as THREE.Color;
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, alpha: number, grow = 1.8) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ x, y, z, vx, vy, vz, age: 0, life, size, grow, alpha });
  }

  update(dt: number, camera: THREE.Camera) {
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.items.splice(i, 1);
        continue;
      }
      const k = Math.exp(-2.2 * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    for (const p of this.items) {
      const u = p.age / p.life;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.size[n] = p.size * (1 + (p.grow - 1) * Math.sqrt(u));
      this.alpha[n] = p.alpha * Math.min(1, u * 6) * (1 - u) * (1 - u);
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
    // Pixels per metre at unit distance, for the camera's lens and the canvas height.
    const cam = camera as THREE.PerspectiveCamera;
    this.points.material.uniforms.uScale.value = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 34) / 2)));
  }
}

export class Particles {
  readonly root = new THREE.Group();
  private dustPool: SoftPuffs;
  private sprayPool: SoftPuffs;
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
    this.dustPool = new SoftPuffs(240, DUST_DAY);
    this.sprayPool = new SoftPuffs(80, '#e8f4ff');
    this.dropPool = new Pool(a.fx.get('splash_drop')!, 120);
    this.tuftPool = new Pool(a.fx.get('wool_tuft')!, 60);
    this.heartPool = new Pool(a.fx.get('heart')!, 16, true);
    // Gold hearts (red belongs to the wolves), marked as a character for the grade so they keep
    // their colour in any light.
    const heartMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    heartMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = 0.0;');
    };
    this.heartPool.mesh.material = heartMat;
    for (const p of [this.dropPool, this.tuftPool, this.heartPool]) this.root.add(p.mesh);
    this.root.add(this.dustPool.points, this.sprayPool.points);
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
            gl_PointSize = uScale * 0.75 / -mv.z * (0.7 + blink * 0.5);
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

  /** A footfall's dust at (x, z): a small puff that hugs the ground and is gone in under half a second. */
  dust(x: number, z: number, dirX = 0, dirZ = 0, size = 1) {
    const y = this.terrain.surface(x, z) + 0.25;
    this.dustPool.add(
      x + (Math.random() - 0.5) * 0.5,
      y,
      z + (Math.random() - 0.5) * 0.5,
      -dirX * 0.7 + (Math.random() - 0.5) * 0.5,
      0.15 + Math.random() * 0.2,
      -dirZ * 0.7 + (Math.random() - 0.5) * 0.5,
      (0.6 + Math.random() * 0.3) * size,
      0.32 + Math.random() * 0.14,
      0.5,
      1.7,
    );
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
        size: 2.4 + Math.random() * 1.6,
        spin: 0,
        rot: 0,
        gravity: 14,
        drag: 0.5,
        curve: 'fall',
        settle: false,
      });
    }
    for (let i = 0; i < (big ? 4 : 2); i++) this.sprayPool.add(x + (Math.random() - 0.5), y + 0.3, z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2, big ? 2.2 : 1.5, 0.7, 0.6);
    this.ripple(x, z, 0.6, big ? 3.6 : 2.4, 0.8, y, false);
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
        size: 3 + Math.random() * 2,
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
      y: this.terrain.surface(x, z) + 2.4,
      z,
      vx: 0,
      vy: 1.4,
      vz: 0,
      age: 0,
      life: 1.3,
      size: 2.2,
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
    this.dustPool.color.copy(DUST_DAY).lerp(DUST_NIGHT, night);
    this.dustPool.update(dt, camera);
    this.sprayPool.update(dt, camera);
    this.dropPool.update(dt, this.terrain, camera);
    this.tuftPool.update(dt, this.terrain, camera);
    this.heartPool.update(dt, this.terrain, camera);
    this.rings.forEach((r, i) => r.update(dt, i < 3 ? 0.75 : 0.5));
    const u = this.flies.material.uniforms;
    u.uTime.value = time;
    u.uNight.value = Math.max(0, Math.min(1, (night - 0.25) / 0.45));
    u.uScale.value = window.innerHeight * 3.2;
    this.flies.visible = night > 0.25;
  }
}
