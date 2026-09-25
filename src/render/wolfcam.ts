import * as THREE from 'three';

// Picture-in-picture view of a snatch happening away from Pip: a second camera renders the
// wolf and its prey into a small scissored viewport while the drag is under way, so the player
// sees the danger instead of reading about it.

export const INSET = {
  w: 248,
  h: 156,
  left: 16,
  /** Sits just above the stamina and bark meters in the bottom-left corner. */
  bottom: 74,
};
const W = INSET.w;
const H = INSET.h;

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
    this.follow(x, y, z, dt);
    this.label.textContent = text;
    this.active = true;
    this.linger = 1.4;
  }

  /** Keep the camera on a wolf while the inset lingers after the hunt stops mattering. */
  follow(x: number, y: number, z: number, dt: number) {
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

  /** Draw the inset into the frame's corner of `target` (the grade pass's scene target). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, target: THREE.WebGLRenderTarget) {
    if (!this.visible) return;
    // Render-target viewports are in its own pixels (canvas pixels, not CSS pixels).
    const pr = renderer.getPixelRatio();
    target.viewport.set(INSET.left * pr, INSET.bottom * pr, W * pr, H * pr);
    target.scissor.copy(target.viewport);
    target.scissorTest = true;
    renderer.setRenderTarget(target);
    // Reuse the shadow map the main view just rendered instead of drawing it a second time.
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.render(scene, this.camera);
    renderer.shadowMap.autoUpdate = auto;
    target.viewport.set(0, 0, target.width, target.height);
    target.scissor.set(0, 0, target.width, target.height);
    target.scissorTest = false;
    renderer.setRenderTarget(target);
    this.frame.style.width = `${W}px`;
    this.frame.style.height = `${H}px`;
    this.frame.style.left = `${INSET.left}px`;
    this.frame.style.bottom = `${INSET.bottom}px`;
  }

  hide() {
    this.linger = 0;
    this.active = false;
    this.hasPose = false;
    this.frame.hidden = true;
  }
}
