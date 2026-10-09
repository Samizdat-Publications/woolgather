// Keyboard + gamepad, reduced to intents. Movement is screen relative: up = north = -Z.
// Ctrl is deliberately unused: Ctrl+W closes the browser tab and cannot be intercepted.

type Edge = 'bark' | 'pause' | 'latch' | 'confirm' | 'back' | 'mute' | 'any' | 'up' | 'down' | 'left' | 'right';

/** Menu directions from the keyboard (movement keys double as menu keys). */
const NAV_KEYS: Record<string, Edge> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const BLOCK_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  moveX = 0;
  moveZ = 0;
  sprint = false;
  creep = false;
  /** Lie down (held): Pip drops flat and the flock stops. */
  lie = false;
  /**
   * Flank (held): Pip runs round the nearest flock at the edge of its flight zone, clockwise
   * ("come bye", 1) or anticlockwise ("away", -1) as seen on screen; 0 = steer by hand.
   */
  flank = 0;
  /** Last input device, so prompts can show the right glyphs. */
  device: 'keyboard' | 'gamepad' = 'keyboard';

  private held = new Set<string>();
  private edges = new Set<Edge>();
  private padPrev: boolean[] = [];
  private stickPrev = { x: 0, y: 0 };
  private enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Sliders and checkboxes in the menus keep their own keys; Tab moves between buttons
      // outside play.
      const field = e.target instanceof HTMLInputElement;
      if (BLOCK_DEFAULT.has(e.code) && !field && (this.enabled || e.code !== 'Tab')) e.preventDefault();
      this.device = 'keyboard';
      this.held.add(e.code);
      if (e.repeat) return;
      this.edges.add('any');
      const nav = NAV_KEYS[e.code];
      if (nav && !field) this.edges.add(nav);
      if (e.code === 'Space' || e.code === 'KeyB') this.edges.add('bark');
      if (e.code === 'Escape' || e.code === 'KeyP') this.edges.add('pause');
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        this.edges.add('latch');
        this.edges.add('confirm');
      }
      if (e.code === 'Escape' || e.code === 'Backspace') this.edges.add('back');
      if (e.code === 'KeyM') this.edges.add('mute');
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.held.clear();
    });
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.held.clear();
  }

  /** Call once per frame before the simulation reads intents. */
  poll() {
    let mx = 0;
    let mz = 0;
    for (const code of this.held) {
      const m = MOVE_KEYS[code];
      if (m) {
        mx += m[0];
        mz += m[1];
      }
    }
    const l = Math.hypot(mx, mz);
    if (l > 1) {
      mx /= l;
      mz /= l;
    }
    let sprint = this.held.has('ShiftLeft') || this.held.has('ShiftRight');
    let creep = this.held.has('KeyC');
    let lie = this.held.has('KeyQ');
    let flank = (this.held.has('KeyX') ? 1 : 0) - (this.held.has('KeyZ') ? 1 : 0);

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const ax = pad.axes[0] ?? 0;
      const az = pad.axes[1] ?? 0;
      const mag = Math.hypot(ax, az);
      const pressed = (i: number) => !!pad.buttons[i]?.pressed;
      const btn = pad.buttons.map((b) => b.pressed);
      const edge = (i: number) => btn[i] && !this.padPrev[i];
      if (mag > 0.18) {
        // Rescale past the dead zone so small tilts still creep precisely.
        const k = Math.min(1, (mag - 0.18) / 0.82) / mag;
        mx = ax * k;
        mz = az * k;
        this.device = 'gamepad';
      }
      if (pressed(7) || pressed(5)) sprint = true;
      if (pressed(6) || pressed(4)) creep = true;
      if (pressed(1)) lie = true;
      if (pressed(15)) flank = 1;
      if (pressed(14)) flank = -1;
      if (edge(0) || edge(2)) this.edges.add('bark');
      if (edge(9)) this.edges.add('pause');
      if (edge(3)) this.edges.add('latch');
      if (edge(0)) this.edges.add('confirm');
      if (edge(1)) this.edges.add('back');
      // Menu directions: the d-pad, or a flick of the stick.
      if (edge(12)) this.edges.add('up');
      if (edge(13)) this.edges.add('down');
      if (edge(14)) this.edges.add('left');
      if (edge(15)) this.edges.add('right');
      const flick = (v: number, prev: number) => (v > 0.6 && prev <= 0.6 ? 1 : v < -0.6 && prev >= -0.6 ? -1 : 0);
      const fx = flick(ax, this.stickPrev.x);
      const fy = flick(az, this.stickPrev.y);
      if (fx) this.edges.add(fx > 0 ? 'right' : 'left');
      if (fy) this.edges.add(fy > 0 ? 'down' : 'up');
      this.stickPrev = { x: ax, y: az };
      if (btn.some((b, i) => b && !this.padPrev[i])) {
        this.edges.add('any');
        this.device = 'gamepad';
      }
      this.padPrev = btn;
      break;
    }

    if (!this.enabled) {
      mx = 0;
      mz = 0;
      sprint = false;
      creep = false;
      lie = false;
      flank = 0;
    }
    this.moveX = mx;
    this.moveZ = mz;
    this.sprint = sprint;
    this.creep = creep;
    this.lie = lie;
    this.flank = flank;
  }

  pressed(e: Edge) {
    return this.edges.has(e);
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.edges.clear();
  }
}
