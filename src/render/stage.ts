import * as THREE from 'three';
import { CAMERA } from '../game/config';
import { damp } from '../game/math';
import { createMoodValues, sampleMood, type MoodValues } from './daycycle';

// Renderer, camera, key/fill lights and the fog. Owns nothing gameplay related.

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly hemi: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly mood: MoodValues = createMoodValues();
  readonly fog: THREE.Fog;
  /** Point the camera looks at (smoothed). */
  readonly focus = new THREE.Vector3();
  private readonly focusGoal = new THREE.Vector3();
  private zoom = 1;
  private zoomGoal = 1;
  private shake = 0;
  private shakeT = 0;
  private glanceX = 0;
  private glanceZ = 0;
  private glanceT = 0;
  private glanceDur = 1;
  private pixelRatioCap = 2;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));
    this.renderer.shadowMap.enabled = true;
    // r186 removed PCFSoftShadowMap; PCF with a blur radius gives the same soft edge.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Neutral keeps the painted palette's hues; ACES pushed everything towards olive and brown.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = 'game-canvas';
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 600);
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
    this.fog.near = m.fogNear;
    this.fog.far = m.fogFar;
    this.renderer.toneMappingExposure = m.exposure;
    return m;
  }

  /** Snap the camera to a point (used on restart so it doesn't swoop across the map). */
  snapTo(x: number, y: number, z: number) {
    this.focus.set(x, y, z);
    this.focusGoal.set(x, y, z);
  }

  setFocusGoal(x: number, y: number, z: number, zoom = 1) {
    this.focusGoal.set(x, y, z);
    this.zoomGoal = zoom;
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }

  /**
   * Briefly lean the camera towards something happening off to the side (a wolf snatching a
   * sheep), then settle back. The lean is capped so the player's dog stays in view.
   */
  glance(x: number, z: number, duration = 2.4) {
    this.glanceX = x;
    this.glanceZ = z;
    this.glanceT = duration;
    this.glanceDur = duration;
  }

  updateCamera(dt: number) {
    const f = this.focus;
    const g = this.focusGoal;
    let gx = g.x;
    let gz = g.z;
    let zoomGoal = this.zoomGoal;
    if (this.glanceT > 0) {
      this.glanceT -= dt;
      const w = Math.sin(Math.min(1, Math.max(0, 1 - this.glanceT / this.glanceDur)) * Math.PI);
      let ox = this.glanceX - g.x;
      let oz = this.glanceZ - g.z;
      const l = Math.hypot(ox, oz);
      const cap = 18;
      if (l > cap) {
        ox *= cap / l;
        oz *= cap / l;
      }
      gx += ox * w;
      gz += oz * w;
      zoomGoal *= 1 + 0.18 * w;
    }
    f.x = damp(f.x, gx, CAMERA.followRate, dt);
    f.y = damp(f.y, g.y, CAMERA.followRate * 0.6, dt);
    f.z = damp(f.z, gz, CAMERA.followRate, dt);
    this.zoom = damp(this.zoom, zoomGoal, 1.6, dt);
    const o = CAMERA.offset;
    this.camera.position.set(f.x + o.x * this.zoom, f.y + o.y * this.zoom, f.z + o.z * this.zoom);
    this.shakeT += dt;
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.55;
      this.camera.position.x += Math.sin(this.shakeT * 53.1) * s;
      this.camera.position.y += Math.sin(this.shakeT * 61.7 + 1.3) * s * 0.6;
      this.camera.position.z += Math.cos(this.shakeT * 47.3 + 0.4) * s;
      this.shake = Math.max(0, this.shake - dt * 2.4);
    }
    this.camera.lookAt(f.x, f.y, f.z);

    // Shadow frustum rides along with the focus point. Low suns are clamped to 10 degrees so the
    // shadow map never stretches across the whole valley.
    const kd = this.mood.keyDir;
    const elev = Math.max(Math.asin(Math.min(1, Math.max(-1, kd.y))), THREE.MathUtils.degToRad(10));
    const horiz = Math.hypot(kd.x, kd.z) || 1;
    const dx = (kd.x / horiz) * Math.cos(elev);
    const dz = (kd.z / horiz) * Math.cos(elev);
    const dy = Math.sin(elev);
    this.key.position.set(f.x + dx * 120, f.y + dy * 120, f.z + dz * 120);
    this.key.target.position.set(f.x, f.y, f.z);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
