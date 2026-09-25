import * as THREE from 'three';

// Picture-in-picture view of a snatch happening away from Pip: a second camera renders the
// wolf and its prey into a small scissored viewport while the drag is under way, so the player
// sees the danger instead of reading about it.

const W = 280;
const H = 176;
const MARGIN = 16;
/** Sits under the top-left counter panel, away from the fold's side of the screen. */
const TOP = 132;

export class WolfCam {
  readonly camera = new THREE.PerspectiveCamera(36, W / H, 0.5, 260);
  private frame: HTMLElement;
  private label: HTMLElement;
  private active = false;
  private linger = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private hasPose = false;

  constructor(hudRoot: HTMLElement) {
    this.frame = document.createElement('div');
    this.frame.className = 'wolfcam';
    this.frame.hidden = true;
    this.frame.innerHTML = '<div class="wolfcam-label"></div>';
    this.label = this.frame.querySelector('.wolfcam-label') as HTMLElement;
    hudRoot.appendChild(this.frame);
  }

  /** Follow a snatch at (x, y, z). Call every frame while it matters; `text` labels the inset. */
  track(x: number, y: number, z: number, text: string, dt: number) {
    const goalPos = new THREE.Vector3(x, y + 9, z + 7.5);
    const goalLook = new THREE.Vector3(x, y + 0.8, z);
    if (!this.hasPose) {
      this.pos.copy(goalPos);
      this.look.copy(goalLook);
      this.hasPose = true;
    } else {
      const k = 1 - Math.exp(-6 * dt);
      this.pos.lerp(goalPos, k);
      this.look.lerp(goalLook, k);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.label.textContent = text;
    this.active = true;
    this.linger = 1.4;
  }

  /** Call once per frame after `track` (or without it when nothing is happening). */
  update(dt: number) {
    if (!this.active) {
      this.linger -= dt;
      if (this.linger <= 0) this.hasPose = false;
    }
    this.frame.hidden = this.linger <= 0;
    this.active = false;
  }

  get visible() {
    return this.linger > 0;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    if (!this.visible) return;
    const vw = renderer.domElement.clientWidth;
    const vh = renderer.domElement.clientHeight;
    const x = MARGIN;
    const y = vh - TOP - H; // viewport y is measured from the bottom
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, W, H);
    renderer.setViewport(x, y, W, H);
    renderer.render(scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, vw, vh);
    this.frame.style.width = `${W}px`;
    this.frame.style.height = `${H}px`;
    this.frame.style.left = `${MARGIN}px`;
    this.frame.style.top = `${TOP}px`;
  }

  hide() {
    this.linger = 0;
    this.active = false;
    this.hasPose = false;
    this.frame.hidden = true;
  }
}
