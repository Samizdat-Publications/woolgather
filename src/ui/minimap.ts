import type { Level } from '../game/level';
import type { Sim } from '../game/sim';

// Top-down valley map: fold, stream, every sheep, wolves and Pip. Redrawn every frame (cheap).

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private scale = 1;
  private ox = 0;
  private oz = 0;
  private w = 200;
  private h = 160;

  constructor(private level: Level) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.resize(200, 160);
  }

  resize(w: number, h: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    for (const c of [this.canvas, this.base]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fit the valley boundary with a small margin.
    const xs = this.level.boundary.map((p) => p[0]);
    const zs = this.level.boundary.map((p) => p[1]);
    const minX = Math.min(...xs) - 4;
    const maxX = Math.max(...xs) + 4;
    const minZ = Math.min(...zs) - 4;
    const maxZ = Math.max(...zs) + 4;
    this.scale = Math.min(w / (maxX - minX), h / (maxZ - minZ));
    this.ox = (w - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oz = (h - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;
    this.drawBase(dpr);
  }

  private px(x: number) {
    return this.ox + x * this.scale;
  }
  private pz(z: number) {
    return this.oz + z * this.scale;
  }

  private drawBase(dpr: number) {
    const c = this.base.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const L = this.level;
    // Valley
    c.beginPath();
    L.boundary.forEach(([x, z], i) => (i ? c.lineTo(this.px(x), this.pz(z)) : c.moveTo(this.px(x), this.pz(z))));
    c.closePath();
    c.fillStyle = 'rgba(125, 150, 88, 0.92)';
    c.fill();
    c.strokeStyle = 'rgba(40, 52, 36, 0.9)';
    c.lineWidth = 2;
    c.stroke();
    // Stream
    c.save();
    c.clip();
    c.beginPath();
    L.stream.forEach(([x, z], i) => (i ? c.lineTo(this.px(x), this.pz(z)) : c.moveTo(this.px(x), this.pz(z))));
    c.strokeStyle = '#6aa6d6';
    c.lineWidth = Math.max(2, L.streamHalf * 2 * this.scale);
    c.lineCap = 'round';
    c.stroke();
    c.restore();
    // Bridge + ford
    const b = L.bridge;
    c.fillStyle = '#b08658';
    c.fillRect(this.px(b.x - b.len / 2), this.pz(b.z - b.w / 2), b.len * this.scale, b.w * this.scale);
    c.fillStyle = 'rgba(210, 200, 170, 0.9)';
    c.beginPath();
    c.arc(this.px(L.ford.x), this.pz(L.ford.z), L.ford.r * this.scale * 0.8, 0, Math.PI * 2);
    c.fill();
    // Trees and rocks as faint small dots so they never read as sheep.
    c.fillStyle = 'rgba(50, 80, 50, 0.3)';
    for (const t of L.trees) {
      c.beginPath();
      c.arc(this.px(t.x), this.pz(t.z), 1.4 * t.s * this.scale + 0.6, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(90, 88, 84, 0.4)';
    for (const [x, z, r] of L.data.rocks) {
      c.beginPath();
      c.arc(this.px(x), this.pz(z), r * this.scale * 0.7 + 0.4, 0, Math.PI * 2);
      c.fill();
    }
    // Farmhouse
    for (const r of L.rects) {
      c.fillStyle = '#d8c7a6';
      c.fillRect(this.px(r.minX), this.pz(r.minZ), (r.maxX - r.minX) * this.scale, (r.maxZ - r.minZ) * this.scale);
    }
    // Region names (the end card refers to these).
    c.font = '600 9px system-ui, sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 2.5;
    c.strokeStyle = 'rgba(30, 36, 26, 0.75)';
    c.fillStyle = 'rgba(255, 250, 235, 0.8)';
    for (const [name, x, z] of [
      ['FAR BANK', -70, -30],
      ['GROVE', 22, -58],
      ['MEADOW', 8, 24],
      ['ROCKS', -18, 62],
      ['FARM', 80, 8],
    ] as const) {
      c.strokeText(name, this.px(x), this.pz(z));
      c.fillText(name, this.px(x), this.pz(z));
    }
    // Fold
    const f = L.fold;
    c.fillStyle = 'rgba(246, 220, 150, 0.95)';
    c.fillRect(this.px(f.minX), this.pz(f.minZ), (f.maxX - f.minX) * this.scale, (f.maxZ - f.minZ) * this.scale);
    c.strokeStyle = '#4a3f33';
    c.lineWidth = 1.5;
    for (const s of L.segs) {
      if (s.tag !== 'wall' && s.tag !== 'fence') continue;
      c.beginPath();
      c.moveTo(this.px(s.ax), this.pz(s.az));
      c.lineTo(this.px(s.bx), this.pz(s.bz));
      c.stroke();
    }
  }

  draw(sim: Sim | null, time: number) {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.drawImage(this.base, 0, 0, this.w, this.h);
    if (!sim) return;
    for (const s of sim.sheep) {
      if (s.state === 'lost') continue;
      const grabbed = s.state === 'grabbed';
      c.beginPath();
      c.arc(this.px(s.x), this.pz(s.z), grabbed ? 3.6 + Math.sin(time * 12) : s.state === 'folded' ? 2.2 : 3.1, 0, Math.PI * 2);
      c.fillStyle = grabbed ? '#ff6b4a' : s.state === 'folded' ? '#f4e6c0' : '#ffffff';
      c.fill();
      c.lineWidth = 1.3;
      c.strokeStyle = 'rgba(30, 24, 34, 0.9)';
      c.stroke();
    }
    for (const w of sim.wolves) {
      if (w.state === 'gone') continue;
      const x = this.px(w.x);
      const z = this.pz(w.z);
      c.beginPath();
      c.moveTo(x, z - 4);
      c.lineTo(x + 3.5, z + 3);
      c.lineTo(x - 3.5, z + 3);
      c.closePath();
      c.fillStyle = '#e0503c';
      c.fill();
    }
    const d = sim.dog;
    const dx = this.px(d.x);
    const dz = this.pz(d.z);
    c.save();
    c.translate(dx, dz);
    c.rotate(-d.facing + Math.PI);
    c.beginPath();
    c.moveTo(0, -5.5);
    c.lineTo(4, 4);
    c.lineTo(0, 2);
    c.lineTo(-4, 4);
    c.closePath();
    c.fillStyle = '#ffc94d';
    c.fill();
    c.strokeStyle = '#231c2b';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
  }
}
