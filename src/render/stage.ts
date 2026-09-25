import * as THREE from 'three';
import { CAMERA } from '../game/config';
import { damp } from '../game/math';
import { createMoodValues, sampleMood, type MoodValues } from './daycycle';
import { GradePass } from './grade';

// Renderer, camera, key/fill lights, fog and the colour grade. Owns nothing gameplay related.

const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const MOON_GLOW = new THREE.Color(0.62, 0.68, 0.95);
const HAZE = new THREE.Vector3();

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
  /** Title shot: a low camera across the valley towards the setting sun, instead of the herding view. */
  private titleShot = false;
  private titleAngle = 0;
  /** Metres the herding camera stands further back than the one the fog was set for. */
  private fogShift = 0;

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

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    const pr = this.renderer.getPixelRatio();
    this.grade.setSize(Math.round(w * pr), Math.round(h * pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applyMood(t: number) {
    const m = sampleMood(t, this.mood);
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
    const amount = this.titleShot ? 0 : moon ? 0.07 : t < 0.3 ? 0.16 : t < 0.5 ? 0.16 + (t - 0.3) * 0.8 : Math.max(0.1, 0.32 - (t - 0.5) * 0.5);
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
    // Relaxed through the dusk (down to 15 degrees) for the long, light shadows of the last minute.
    const minElev = THREE.MathUtils.degToRad(26 - 11 * Math.min(1, Math.max(0, (this.mood.t - 0.6) / 0.14)));
    const elev = Math.max(Math.asin(Math.min(1, Math.max(-1, kd.y))), minElev);
    const horiz = Math.hypot(kd.x, kd.z) || 1;
    const dx = (kd.x / horiz) * Math.cos(elev);
    const dz = (kd.z / horiz) * Math.cos(elev);
    const dy = Math.sin(elev);
    this.key.position.set(f.x + dx * 120, f.y + dy * 120, f.z + dz * 120);
    this.key.target.position.set(f.x, f.y, f.z);
  }

  /**
   * Render the scene into the grade target, let `extra` draw into it too (the wolf cam inset),
   * then grade it onto the screen.
   */
  render(extra?: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) => void) {
    const r = this.renderer;
    r.setRenderTarget(this.grade.target);
    r.render(this.scene, this.camera);
    extra?.(r, this.grade.target);
    this.grade.render(r);
  }
}
