// Keyboard + gamepad, reduced to intents. Movement is screen relative: up = north = -Z.
// Ctrl is deliberately unused: Ctrl+W closes the browser tab and cannot be intercepted.

type Edge = 'bark' | 'pause' | 'latch' | 'confirm' | 'back' | 'mute' | 'any';

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
  /** Last input device, so prompts can show the right glyphs. */
  device: 'keyboard' | 'gamepad' = 'keyboard';

  private held = new Set<string>();
  private edges = new Set<Edge>();
  private padPrev: boolean[] = [];
  private enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      this.device = 'keyboard';
      this.held.add(e.code);
      if (e.repeat) return;
      this.edges.add('any');
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
      if (edge(0) || edge(2)) this.edges.add('bark');
      if (edge(9)) this.edges.add('pause');
      if (edge(3)) this.edges.add('latch');
      if (edge(0)) this.edges.add('confirm');
      if (edge(1)) this.edges.add('back');
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
    }
    this.moveX = mx;
    this.moveZ = mz;
    this.sprint = sprint;
    this.creep = creep;
  }

  pressed(e: Edge) {
    return this.edges.has(e);
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.edges.clear();
  }
}
