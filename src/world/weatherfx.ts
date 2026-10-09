import * as THREE from 'three';

// Weather you can see falling: rain streaks, snowflakes and autumn leaves, kept in a box round the
// camera's focus (they wrap around it as it moves), so a few thousand particles cover any level.

const BOX = { x: 46, zNear: 34, zFar: 42, h: 28 };

function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.translate(16, 16);
  g.beginPath();
  g.moveTo(0, -13);
  g.quadraticCurveTo(10, -4, 0, 13);
  g.quadraticCurveTo(-10, -4, 0, -13);
  g.fillStyle = '#ffffff';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -11);
  g.lineTo(0, 12);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A field of particles wrapped round the focus. */
class Field {
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly seed: Float32Array;
  constructor(
    readonly n: number,
    fall: [number, number],
  ) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.seed[i] = Math.random();
      this.pos[i * 3] = (Math.random() * 2 - 1) * BOX.x;
      this.pos[i * 3 + 1] = Math.random() * BOX.h;
      this.pos[i * 3 + 2] = -BOX.zFar + Math.random() * (BOX.zFar + BOX.zNear);
      this.vel[i * 3 + 1] = -(fall[0] + Math.random() * (fall[1] - fall[0]));
    }
  }

  /** Move by velocity, wrap round the box (positions are relative to the focus). */
  step(dt: number, wind: number, dfx: number, dfz: number, sway: (i: number) => [number, number]) {
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      const [sx, sz] = sway(i);
      p[i * 3] += (wind + sx) * dt - dfx;
      p[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      p[i * 3 + 2] += sz * dt - dfz;
      if (p[i * 3 + 1] < 0) {
        p[i * 3 + 1] += BOX.h;
        p[i * 3] = (Math.random() * 2 - 1) * BOX.x;
        p[i * 3 + 2] = -BOX.zFar + Math.random() * (BOX.zFar + BOX.zNear);
      }
      if (p[i * 3] > BOX.x) p[i * 3] -= BOX.x * 2;
      else if (p[i * 3] < -BOX.x) p[i * 3] += BOX.x * 2;
      if (p[i * 3 + 2] > BOX.zNear) p[i * 3 + 2] -= BOX.zFar + BOX.zNear;
      else if (p[i * 3 + 2] < -BOX.zFar) p[i * 3 + 2] += BOX.zFar + BOX.zNear;
    }
  }
}

export class WeatherFx {
  readonly root = new THREE.Group();
  private rain = new Field(1800, [26, 32]);
  private snow = new Field(1600, [1.4, 2.4]);
  private leaves = new Field(140, [1.2, 2.2]);
  private rainLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private snowPts: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private leafPts: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private lastFocus = new THREE.Vector3(Infinity, 0, 0);
  private t = 0;

  constructor() {
    this.root.name = 'weather';
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.rain.n * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xc8d4e4, transparent: true, opacity: 0, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 5;

    const pointsMat = (map: THREE.Texture, leaf: boolean) =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uMap: { value: map }, uScale: { value: 1000 }, uAlpha: { value: 0 }, uNight: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `
          attribute float aSize;
          attribute float aSeed;
          attribute vec3 aColor;
          uniform float uScale, uTime;
          varying float vSeed;
          varying vec3 vColor;
          varying float vAngle;
          void main() {
            vSeed = aSeed;
            vColor = aColor;
            vAngle = uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uScale * aSize / -mv.z;
          }`,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uAlpha, uNight;
          varying float vSeed;
          varying vec3 vColor;
          varying float vAngle;
          void main() {
            vec2 uv = gl_PointCoord - 0.5;
            ${leaf ? 'float c = cos(vAngle), s = sin(vAngle); uv = mat2(c, -s, s, c) * uv * vec2(1.0, 0.6 + 0.4 * abs(sin(vAngle * 0.7)));' : ''}
            vec4 tex = texture2D(uMap, uv + 0.5);
            if (tex.a < 0.05) discard;
            vec3 col = vColor * tex.rgb * (1.0 - 0.55 * uNight);
            gl_FragColor = vec4(col, tex.a * uAlpha);
            // Weather is part of the scene for the grade (alpha 1 marks ordinary scenery).
            #include <colorspace_fragment>
          }`,
      });

    const mk = (f: Field, sizes: [number, number], colors: string[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(f.n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const size = new Float32Array(f.n);
      const col = new Float32Array(f.n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < f.n; i++) {
        size[i] = sizes[0] + f.seed[i] * (sizes[1] - sizes[0]);
        c.set(colors[Math.floor(f.seed[i] * 997) % colors.length]);
        col.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aSeed', new THREE.BufferAttribute(f.seed, 1));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      return g;
    };
    this.snowPts = new THREE.Points(mk(this.snow, [0.16, 0.3], ['#ffffff', '#f2f6ff']), pointsMat(flakeTexture(), false));
    this.leafPts = new THREE.Points(mk(this.leaves, [0.4, 0.62], ['#d8842e', '#e8b040', '#c0602a', '#b8862c', '#9c4a24']), pointsMat(leafTexture(), true));
    for (const o of [this.snowPts, this.leafPts]) {
      o.frustumCulled = false;
      o.renderOrder = 5;
    }
    this.root.add(this.rainLines, this.snowPts, this.leafPts);
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, wx: { rain: number; snow: number; leaves: number }, night: number, bufH: number, time: number) {
    this.t += dt;
    // Follow the focus: particles keep their place in the world as the camera moves.
    let dfx = 0;
    let dfz = 0;
    if (Number.isFinite(this.lastFocus.x)) {
      dfx = focus.x - this.lastFocus.x;
      dfz = focus.z - this.lastFocus.z;
      if (Math.hypot(dfx, dfz) > 30) dfx = dfz = 0;
    }
    this.lastFocus.copy(focus);
    this.root.position.set(focus.x, focus.y, focus.z);
    const cam = camera as THREE.PerspectiveCamera;
    const scale = bufH / (2 * Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 34) / 2)));

    this.rainLines.visible = wx.rain > 0.02;
    if (this.rainLines.visible) {
      const wind = 7;
      this.rain.step(dt, wind, dfx, dfz, () => [0, 0]);
      const arr = (this.rainLines.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const p = this.rain.pos;
      const n = Math.floor(this.rain.n * Math.min(1, wx.rain));
      for (let i = 0; i < this.rain.n; i++) {
        const o = i * 6;
        if (i >= n) {
          arr.fill(0, o, o + 6);
          continue;
        }
        const vy = this.rain.vel[i * 3 + 1];
        // A streak about as long as the drop falls in a thirtieth of a second.
        arr[o] = p[i * 3];
        arr[o + 1] = p[i * 3 + 1];
        arr[o + 2] = p[i * 3 + 2];
        arr[o + 3] = p[i * 3] - wind * 0.034;
        arr[o + 4] = p[i * 3 + 1] - vy * 0.034;
        arr[o + 5] = p[i * 3 + 2];
      }
      this.rainLines.geometry.getAttribute('position').needsUpdate = true;
      this.rainLines.material.opacity = 0.38 * Math.min(1, wx.rain) * (1 - 0.4 * night);
    }

    this.snowPts.visible = wx.snow > 0.02;
    if (this.snowPts.visible) {
      const s = this.snow;
      this.snow.step(dt, 0.8, dfx, dfz, (i) => [Math.sin(this.t * 0.9 + s.seed[i] * 30) * 0.7, Math.cos(this.t * 0.7 + s.seed[i] * 17) * 0.4]);
      (this.snowPts.geometry.getAttribute('position') as THREE.BufferAttribute).set(s.pos);
      this.snowPts.geometry.getAttribute('position').needsUpdate = true;
      const u = this.snowPts.material.uniforms;
      u.uScale.value = scale;
      u.uAlpha.value = 0.85 * wx.snow;
      u.uNight.value = night * 0.6;
      u.uTime.value = time;
    }

    this.leafPts.visible = wx.leaves > 0.02;
    if (this.leafPts.visible) {
      const s = this.leaves;
      this.leaves.step(dt, 2.4, dfx, dfz, (i) => [Math.sin(this.t * 1.6 + s.seed[i] * 21) * 1.6, Math.cos(this.t * 1.2 + s.seed[i] * 9) * 1.1]);
      (this.leafPts.geometry.getAttribute('position') as THREE.BufferAttribute).set(s.pos);
      this.leafPts.geometry.getAttribute('position').needsUpdate = true;
      const u = this.leafPts.material.uniforms;
      u.uScale.value = scale;
      u.uAlpha.value = 0.95 * wx.leaves;
      u.uNight.value = night;
      u.uTime.value = time;
    }
  }
}
