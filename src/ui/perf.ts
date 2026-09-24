import type * as THREE from 'three';

// Optional frame-time overlay (?fps=1): FPS, worst frame, draw calls and triangles.

export class PerfOverlay {
  private el: HTMLDivElement;
  private frames: number[] = [];
  private acc = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.el = document.createElement('div');
    this.el.className = 'perf-overlay';
    document.body.appendChild(this.el);
  }

  frame(dtMs: number) {
    this.frames.push(dtMs);
    if (this.frames.length > 120) this.frames.shift();
    this.acc += dtMs;
    if (this.acc < 250) return;
    this.acc = 0;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    const worst = Math.max(...this.frames);
    const info = this.renderer.info.render;
    this.el.textContent = `${(1000 / avg).toFixed(0)} fps · ${avg.toFixed(1)} ms avg · ${worst.toFixed(1)} ms worst · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
  }
}
