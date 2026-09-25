import * as THREE from 'three';

// Picture-in-picture view of a hunt happening away from Pip: a second camera renders the wolf
// and its prey into a small scissored viewport of the scene target, so the player sees the danger
// instead of reading about it. The frame docks on the screen edge the threat lies beyond, level
// with it, clear of Pip, the flock and the fold, and an arrow on its border with the distance
// points the way.

export const INSET = {
  w: 248,
  h: 156,
  margin: 16,
};
const W = INSET.w;
const H = INSET.h;

/** A rectangle in CSS pixels from the top-left of the page. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class WolfCam {
  readonly camera = new THREE.PerspectiveCamera(36, W / H, 0.5, 260);
  /** Where the frame is now (it glides to new spots rather than jumping). */
  readonly rect: ScreenRect = { x: INSET.margin, y: 280, w: W, h: H };
  private frame: HTMLElement;
  private label: HTMLElement;
  private arrow: HTMLElement;
  private active = false;
  private linger = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private hasPose = false;

  constructor(hudRoot: HTMLElement) {
    this.frame = document.createElement('div');
    this.frame.className = 'wolfcam';
    this.frame.hidden = true;
    this.frame.innerHTML =
      '<div class="wolfcam-label"></div><div class="wolfcam-arrow"><svg viewBox="-14 -14 28 28"><path d="M12 0 L-6 -10 L-2 0 L-6 10 Z" fill="#ff5a3c" stroke="rgba(20,16,26,0.8)" stroke-width="2" stroke-linejoin="round"/></svg></div>';
    this.label = this.frame.querySelector('.wolfcam-label') as HTMLElement;
    this.arrow = this.frame.querySelector('.wolfcam-arrow') as HTMLElement;
    hudRoot.appendChild(this.frame);
  }

  /**
   * Follow a hunt at (x, y, z). Call every frame while it matters: `text` labels the inset,
   * (`dockX`, `dockY`) is where its top-left corner should be, and `pointAt` is the threat's
   * screen position (off screen), which the arrow on the frame's border points to.
   */
  track(x: number, y: number, z: number, heading: number, text: string, dockX: number, dockY: number, pointAt: { x: number; y: number }, dt: number) {
    this.follow(x, y, z, heading, dt);
    if (this.label.textContent !== text) this.label.textContent = text;
    if (!this.visible) {
      this.rect.x = dockX;
      this.rect.y = dockY;
    } else {
      const k = 1 - Math.exp(-7 * dt);
      this.rect.x += (dockX - this.rect.x) * k;
      this.rect.y += (dockY - this.rect.y) * k;
    }
    // The arrow sits where the line from the frame's centre to the threat leaves the frame.
    const cx = this.rect.x + W / 2;
    const cy = this.rect.y + H / 2;
    const ang = Math.atan2(pointAt.y - cy, pointAt.x - cx);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const t = Math.min(Math.abs(W / 2 / (c || 1e-4)), Math.abs(H / 2 / (s || 1e-4)));
    this.arrow.style.transform = `translate(${W / 2 + c * (t + 12) - 14}px, ${H / 2 + s * (t + 12) - 14}px) rotate(${ang}rad)`;
    // The label moves to the bottom edge when the arrow leaves through the top, so it never hides it.
    this.label.classList.toggle('below', s < -0.5 && Math.abs(H / 2 / s) <= Math.abs(W / 2 / (c || 1e-4)));
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
    const vh = renderer.domElement.clientHeight;
    const x = Math.round(this.rect.x);
    const y = Math.round(this.rect.y);
    // Render-target viewports are in its own pixels, measured from the bottom.
    const pr = renderer.getPixelRatio();
    target.viewport.set(x * pr, (vh - y - H) * pr, W * pr, H * pr);
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
    this.frame.style.left = `${x}px`;
    this.frame.style.top = `${y}px`;
  }

  hide() {
    this.linger = 0;
    this.active = false;
    this.hasPose = false;
    this.frame.hidden = true;
  }
}
