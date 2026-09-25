import * as THREE from 'three';

// Picture-in-picture view of a hunt happening away from Pip: a second camera renders the wolf
// and its prey into a small scissored viewport of the scene target, so the player sees the danger
// instead of reading about it. The frame sits at mid-height on the side of the screen the threat
// is on, so it also points the way.

export const INSET = {
  w: 248,
  h: 156,
  margin: 16,
};
const W = INSET.w;
const H = INSET.h;

export type InsetSide = 'left' | 'right';

/** Where the inset frame is on screen, in CSS pixels from the top-left (for HUD layout). */
export function insetRect(side: InsetSide, vw: number, vh: number) {
  const x = side === 'left' ? INSET.margin : vw - INSET.margin - W;
  const y = Math.round((vh - H) / 2);
  return { x, y, w: W, h: H };
}

export class WolfCam {
  readonly camera = new THREE.PerspectiveCamera(36, W / H, 0.5, 260);
  side: InsetSide = 'left';
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

  /**
   * Follow a hunt at (x, y, z). Call every frame while it matters; `text` labels the inset and
   * `side` is the side of the screen the threat lies towards.
   */
  track(x: number, y: number, z: number, heading: number, text: string, side: InsetSide, dt: number) {
    this.follow(x, y, z, heading, dt);
    this.label.textContent = text;
    // Only switch sides when the inset appears, so it never jumps across the screen mid-hunt.
    if (!this.visible) this.side = side;
    this.active = true;
    this.linger = 1.4;
  }

  /**
   * Keep the camera on a wolf (also while the inset lingers). A three-quarter side view from the
   * camera's side of the animal: the whole wolf, the sheep in its jaws and the trees it is heading
   * for, rather than a tight top view.
   */
  follow(x: number, y: number, z: number, heading: number, dt: number) {
    // Perpendicular to the heading, on the south (screen-near) side, pulled back a little.
    let px = Math.cos(heading);
    let pz = -Math.sin(heading);
    if (pz < 0) {
      px = -px;
      pz = -pz;
    }
    const goalPos = new THREE.Vector3(x + px * 9 + Math.sin(heading) * -3, y + 6, z + pz * 9 + Math.cos(heading) * -3);
    const goalLook = new THREE.Vector3(x + Math.sin(heading) * 1.5, y + 0.9, z + Math.cos(heading) * 1.5);
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

  /** Draw the inset into its part of `target` (the grade pass's scene target). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, target: THREE.WebGLRenderTarget) {
    if (!this.visible) return;
    const vw = renderer.domElement.clientWidth;
    const vh = renderer.domElement.clientHeight;
    const r = insetRect(this.side, vw, vh);
    // Render-target viewports are in its own pixels, measured from the bottom.
    const pr = renderer.getPixelRatio();
    target.viewport.set(r.x * pr, (vh - r.y - H) * pr, W * pr, H * pr);
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
    this.frame.style.left = `${r.x}px`;
    this.frame.style.top = `${r.y}px`;
  }

  hide() {
    this.linger = 0;
    this.active = false;
    this.hasPose = false;
    this.frame.hidden = true;
  }
}
