import * as THREE from 'three';
import { CAMERA } from '../game/config';
import { damp } from '../game/math';
import { createMoodValues, sampleMood, SUN_MOON_SWAP, type MoodValues } from './daycycle';
import { GradePass } from './grade';

// Renderer, camera, key/fill lights, fog and the colour grade. Owns nothing gameplay related.

const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const MOON_GLOW = new THREE.Color(0.62, 0.68, 0.95);
const HAZE = new THREE.Vector3();
const GREY = new THREE.Color('#9aa0aa');
const FLASH = new THREE.Color('#e8eeff');
const MIST = new THREE.Color('#c9ced6');
const SNOW_KEY = new THREE.Color('#f4f2ff');
const SNOW_SKY = new THREE.Color('#9fb6e0');
const SNOW_GROUND = new THREE.Color('#e4ecff');

export type Quality = 'high' | 'medium' | 'low';

/**
 * Graphics tiers. The scene renders into the grade pass's target at `scale` of the canvas's
 * resolution (the canvas itself follows the screen's pixel ratio up to `cap`) and the grade pass
 * scales it up; lower tiers also take fewer MSAA samples, a smaller shadow map and no bloom.
 */
export const QUALITY_TIERS: Record<Quality, { cap: number; scale: number; msaa: number; shadow: number; bloom: boolean }> = {
  high: { cap: 2, scale: 1, msaa: 4, shadow: 2048, bloom: true },
  medium: { cap: 1.5, scale: 0.85, msaa: 4, shadow: 2048, bloom: true },
  low: { cap: 1, scale: 0.72, msaa: 2, shadow: 1024, bloom: false },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly hemi: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly mood: MoodValues = createMoodValues();
  readonly fog: THREE.Fog;
  readonly grade = new GradePass();
  /** Point the camera looks at (smoothed). */
  readonly focus = new THREE.Vector3();
  private readonly focusGoal = new THREE.Vector3();
  private zoom = 1;
  private zoomGoal = 1;
  private shake = 0;
  private shakeT = 0;
  private pixelRatioCap = 2;
  private renderScale = 1;
  quality: Quality = 'high';
  /** Title shot: a low camera across the valley towards the setting sun, instead of the herding view. */
  private titleShot = false;
  private titleAngle = 0;
  /** Metres the herding camera stands further back than the one the fog was set for. */
  private fogShift = 0;
  /** Weather on the light: overcast (0..1), mist (0..1) and a lightning flash (0..1). */
  readonly weather = { cloud: 0, mist: 0, flash: 0, snow: 0 };
  /** The mist's colour this frame (display space), for the grade. */
  readonly mistColor = new THREE.Color();

  constructor(host: HTMLElement) {
    // The scene renders into the grade pass's multisampled target, so the canvas itself needs
    // no antialiasing.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));
    this.renderer.shadowMap.enabled = true;
    // r186 removed PCFSoftShadowMap; PCF with a blur radius gives the same soft edge.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Tone mapping happens in the grade pass.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = 'game-canvas';
    // Draw calls and triangles are counted over the whole frame (scene, shadows, inset, bloom and
    // grade), not only the last pass.
    this.renderer.info.autoReset = false;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 700);
    this.fog = new THREE.Fog(0xe8dcc0, 70, 230);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xc9dcea, 0x6f7f4a, 1);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xffe3b8, 2.5);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    sc.left = -52;
    sc.right = 52;
    sc.top = 52;
    sc.bottom = -52;
    sc.near = 1;
    sc.far = 260;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.04;
    this.key.shadow.radius = 3;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Switch the graphics tier (resolution, multisampling, shadow map and bloom). */
  setQuality(q: Quality) {
    this.quality = q;
    const t = QUALITY_TIERS[q];
    this.pixelRatioCap = t.cap;
    this.renderScale = t.scale;
    this.grade.setSamples(t.msaa);
    this.grade.bloomOff = !t.bloom;
    if (this.key.shadow.mapSize.x !== t.shadow) {
      this.key.shadow.mapSize.set(t.shadow, t.shadow);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    const pr = this.renderer.getPixelRatio() * this.renderScale;
    this.grade.setSize(Math.round(w * pr), Math.round(h * pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applyMood(t: number) {
    const m = sampleMood(t, this.mood);
    const W = this.weather;
    if (W.cloud > 0.001) {
      // Overcast: the key light weakens and greys, the sky fill carries more of the light, shadows
      // go soft, and the sky and fog flatten to cloud grey at the evening's own brightness.
      const c = W.cloud;
      const lum = (col: THREE.Color) => 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
      const grey = (col: THREE.Color, k: number, tint = GREY) => col.lerp(tmpC.copy(tint).multiplyScalar(lum(col) / lum(tint)), k);
      m.keyIntensity *= 1 - 0.55 * c;
      m.hemiIntensity *= 1 + 0.3 * c;
      grey(m.keyColor, 0.6 * c);
      grey(m.hemiSky, 0.5 * c);
      grey(m.skyTop, 0.75 * c);
      grey(m.skyHorizon, 0.7 * c);
      grey(m.fog, 0.7 * c);
      grey(m.ground, 0.4 * c);
      m.sunGlow.multiplyScalar(1 - 0.85 * c);
      m.shadow *= 1 - 0.65 * c;
      m.exposure *= 1 - 0.08 * c;
    }
    if (W.snow > 0.001) {
      // Snow light: the warm key goes cool white and the sky fill blue, so snow reads as snow
      // (under the golden-hour key it turned peach and read as sand).
      const k = W.snow;
      m.keyColor.lerp(SNOW_KEY, 0.7 * k);
      m.hemiSky.lerp(SNOW_SKY, 0.55 * k);
      m.hemiGround.lerp(SNOW_SKY, 0.35 * k);
      m.ground.lerp(SNOW_GROUND, 0.6 * k);
      m.fog.lerp(SNOW_SKY, 0.4 * k);
      m.exposure *= 1 - 0.06 * k;
    }
    if (W.flash > 0.001) {
      m.keyIntensity += 9 * W.flash;
      m.keyColor.lerp(FLASH, W.flash);
      m.hemiIntensity += 2 * W.flash;
    }
    // Mist colour: pale and pearly by day, a dim blue-grey under the moon.
    this.mistColor.copy(m.fog).lerp(MIST, 0.55).multiplyScalar(1 - 0.55 * m.night).convertLinearToSRGB();
    this.grade.setFlash(W.flash);
    this.key.color.copy(m.keyColor);
    this.key.intensity = m.keyIntensity;
    this.hemi.color.copy(m.hemiSky);
    this.hemi.groundColor.copy(m.hemiGround);
    this.hemi.intensity = m.hemiIntensity;
    this.fog.color.copy(m.fog);
    // The title's long view across the valley needs thinner air than the herding view. The fog
    // distances were set for a camera 48 m from the ground it looks at; the herding camera now
    // stands further back, so the fog starts that much further out.
    this.fog.near = this.titleShot ? m.fogNear * 1.8 : m.fogNear + this.fogShift;
    this.fog.far = this.titleShot ? m.fogFar * 1.5 : m.fogFar + this.fogShift;
    if (W.mist > 0.001) {
      // Mist: the scene fog closes in to the far side of the view (the grade adds the veil round Pip).
      const dist = Math.hypot(CAMERA.offset.x, CAMERA.offset.y, CAMERA.offset.z) * this.zoom;
      const k = this.titleShot ? 0.6 : 1;
      this.fog.near += (dist - 30 - this.fog.near) * W.mist * k;
      this.fog.far += (dist + 70 - this.fog.far) * W.mist * k;
      this.fog.color.lerp(MIST, 0.5 * W.mist).multiplyScalar(1 - 0.5 * m.night * W.mist);
    }
    this.key.shadow.intensity = m.shadow;
    this.grade.hazeScale = this.titleShot ? 0 : 1;
    const sky = tmpC.copy(m.skyHorizon).convertLinearToSRGB();
    this.grade.hazeSky = HAZE.set(sky.r, sky.g, sky.b);
    this.grade.apply(t, m.exposure);
    // Sun-side glow: warm while the sun is up, faint silver from the moon later on.
    // The glow stays on the sun's side (west) through the twilight, fading into the night.
    const moon = t >= 0.9;
    const dir = moon ? m.keyDir : m.sunDir;
    tmpV.copy(this.camera.position).addScaledVector(dir, 800).project(this.camera);
    const behind = tmpV.z > 1;
    // Gold while the sun is high, the rose of the horizon once it sets.
    const glow = moon ? MOON_GLOW : tmpC.copy(m.sunGlow).lerp(m.skyHorizon, t < 0.3 ? 0.4 : 0.4 + Math.min(1, (t - 0.3) / 0.15) * 0.35);
    // Strongest through sunset and dusk, when the western sky is the brightest thing in the world.
    // Kept modest: a strong glow washed the sun's side of the frame (and the stream in it) to a pale haze.
    const amount = this.titleShot ? 0 : moon ? 0.06 : t < 0.3 ? 0.12 : t < 0.5 ? 0.12 + (t - 0.3) * 0.35 : Math.max(0.08, 0.19 - (t - 0.5) * 0.3);
    this.grade.setSun(behind ? -tmpV.x : tmpV.x, behind ? -tmpV.y : tmpV.y, glow, Math.max(0, amount));
    return m;
  }

  /** Snap the camera to a point (used on restart so it doesn't swoop across the map). */
  snapTo(x: number, y: number, z: number, zoom = 1) {
    this.focus.set(x, y, z);
    this.focusGoal.set(x, y, z);
    this.zoom = this.zoomGoal = zoom;
  }

  setFocusGoal(x: number, y: number, z: number, zoom = 1) {
    this.focusGoal.set(x, y, z);
    this.zoomGoal = zoom;
    this.titleShot = false;
  }

  /** Low establishing shot for the title: across the valley towards the sunset sky. */
  setTitleShot(x: number, y: number, z: number, angle: number) {
    if (!this.titleShot) this.focus.set(x, y, z);
    this.focusGoal.set(x, y, z);
    this.titleShot = true;
    this.titleAngle = angle;
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }

  updateCamera(dt: number) {
    const f = this.focus;
    const g = this.focusGoal;
    const fov = this.titleShot ? CAMERA.titleFov : CAMERA.fov;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.titleShot) {
      f.lerp(g, 1 - Math.exp(-2 * dt));
      // East of the focus, looking west with the low sun just left of centre, slowly swinging.
      const a = this.titleAngle;
      this.camera.position.set(f.x + Math.cos(a) * 70, f.y + 14, f.z + Math.sin(a) * 70);
      this.camera.lookAt(f.x, f.y + 10, f.z);
    } else {
      f.x = damp(f.x, g.x, CAMERA.followRate, dt);
      f.y = damp(f.y, g.y, CAMERA.followRate * 0.6, dt);
      f.z = damp(f.z, g.z, CAMERA.followRate, dt);
      // Pull back quickly (a threat coming into the frame must be seen at once), push in gently.
      this.zoom = damp(this.zoom, this.zoomGoal, this.zoomGoal > this.zoom ? 3.2 : 1.2, dt);
      const o = CAMERA.offset;
      this.camera.position.set(f.x + o.x * this.zoom, f.y + o.y * this.zoom, f.z + o.z * this.zoom);
      const dist = Math.hypot(o.x, o.y, o.z) * this.zoom;
      this.fogShift = dist - 48.2;
      this.shakeT += dt;
      if (this.shake > 0.001) {
        // Scaled with the distance so a shake looks the same size whatever the lens.
        const s = this.shake * this.shake * 0.55 * (dist / 48.2);
        this.camera.position.x += Math.sin(this.shakeT * 53.1) * s;
        this.camera.position.y += Math.sin(this.shakeT * 61.7 + 1.3) * s * 0.6;
        this.camera.position.z += Math.cos(this.shakeT * 47.3 + 0.4) * s;
        this.shake = Math.max(0, this.shake - dt * 2.4);
      }
      this.camera.lookAt(f.x, f.y, f.z);
    }

    // The key light rides along with the focus point. Its angle never drops below 26 degrees:
    // a real low sun laid tree shadows across the whole valley in near-black stripes and barely
    // lit flat ground. The sky still shows the true low sun; the light just stays playable.
    const kd = this.mood.keyDir;
    // The moon that takes over in the twilight rides high, so walls never throw the fold into
    // black; the sun's light never drops below 26 degrees (lower, every far slope was a dark pool).
    const tm = this.mood.t;
    const minElev = THREE.MathUtils.degToRad(tm >= SUN_MOON_SWAP ? 38 : 26);
    const elev = Math.max(Math.asin(Math.min(1, Math.max(-1, kd.y))), minElev);
    const horiz = Math.hypot(kd.x, kd.z) || 1;
    const dx = (kd.x / horiz) * Math.cos(elev);
    const dz = (kd.z / horiz) * Math.cos(elev);
    const dy = Math.sin(elev);
    this.key.position.set(f.x + dx * 120, f.y + dy * 120, f.z + dz * 120);
    this.key.target.position.set(f.x, f.y, f.z);
  }

  // GPU time per frame, for the perf test only (EXT_disjoint_timer_query_webgl2).
  private gpu: { gl: WebGL2RenderingContext; ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; pending: WebGLQuery[]; ms: number[] } | null = null;

  /** The key light's shadows on or off (perf analysis and the low quality tier). */
  setShadows(on: boolean) {
    this.key.castShadow = on;
  }

  /** Start timing every frame on the GPU; false if the browser does not allow it. */
  startGpuTimer() {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return false;
    this.gpu = { gl, ext, pending: [], ms: [] };
    return true;
  }

  /** Mean GPU milliseconds per frame since the last call (and the samples behind it). */
  takeGpuTime() {
    if (!this.gpu) return null;
    const ms = this.gpu.ms.splice(0);
    const avg = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
    const sorted = ms.sort((a, b) => a - b);
    return { frames: ms.length, avg, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 };
  }

  private pollGpu() {
    const T = this.gpu;
    if (!T) return;
    const disjoint = T.gl.getParameter(T.ext.GPU_DISJOINT_EXT);
    while (T.pending.length) {
      const q = T.pending[0];
      if (!T.gl.getQueryParameter(q, T.gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) T.ms.push(T.gl.getQueryParameter(q, T.gl.QUERY_RESULT) / 1e6);
      T.gl.deleteQuery(q);
      T.pending.shift();
    }
  }

  /**
   * Render the scene into the grade target, let `extra` draw into it too (the wolf cam inset),
   * then grade it onto the screen.
   */
  render(extra?: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) => void) {
    const r = this.renderer;
    r.info.reset();
    const T = this.gpu;
    const query = T && T.pending.length < 8 ? T.gl.createQuery() : null;
    if (T && query) T.gl.beginQuery(T.ext.TIME_ELAPSED_EXT, query);
    r.setRenderTarget(this.grade.target);
    r.render(this.scene, this.camera);
    extra?.(r, this.grade.target);
    this.grade.render(r);
    if (T && query) {
      T.gl.endQuery(T.ext.TIME_ELAPSED_EXT);
      T.pending.push(query);
    }
    this.pollGpu();
  }
}
