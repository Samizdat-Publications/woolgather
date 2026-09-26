import { PLACES, type Level } from '../game/level';
import type { Sim } from '../game/sim';

// Top-down valley map: fold, stream, every sheep, wolves and Pip. Redrawn every frame (cheap).

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  /** The place names, drawn once (text is costly to draw every frame) and laid over the dots. */
  private labels: HTMLCanvasElement;
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
    this.labels = document.createElement('canvas');
    this.resize(240, 192);
    // Redraw the names once the bundled font has loaded.
    document.fonts?.ready.then(() => this.drawLabelLayer(Math.min(2, window.devicePixelRatio || 1)));
  }

  resize(w: number, h: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    for (const c of [this.canvas, this.base, this.labels]) {
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
    this.drawLabelLayer(dpr);
  }

  private drawLabelLayer(dpr: number) {
    const c = this.labels.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    this.drawLabels(c);
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
    // The ford: a pale band across the stream, labelled, since it is the second way over.
    c.save();
    c.translate(this.px(L.ford.x), this.pz(L.ford.z));
    c.fillStyle = 'rgba(190, 236, 222, 0.95)';
    c.fillRect(-L.ford.r * this.scale * 1.1, -L.ford.r * this.scale * 0.55, L.ford.r * this.scale * 2.2, L.ford.r * this.scale * 1.1);
    c.restore();
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
    // Fold
    const f = L.fold;
    c.fillStyle = 'rgba(246, 220, 150, 0.95)';
    c.fillRect(this.px(f.minX), this.pz(f.minZ), (f.maxX - f.minX) * this.scale, (f.maxZ - f.minZ) * this.scale);
    c.strokeStyle = '#4a3f33';
    c.lineWidth = 1.5;
    for (const s of L.segs) {
      if (s.tag !== 'wall' && s.tag !== 'fence' && s.tag !== 'field') continue;
      c.beginPath();
      c.moveTo(this.px(s.ax), this.pz(s.az));
      c.lineTo(this.px(s.bx), this.pz(s.bz));
      c.stroke();
    }
  }

  /**
   * Tint the map with the evening (warm and a little faded by day, dimmer and cooler as the dusk
   * deepens), so it never becomes the brightest, greenest thing on a sunset or night screen.
   */
  setMood(t: number) {
    const dusk = Math.min(1, Math.max(0, (t - 0.5) / 0.4));
    const f = `sepia(${(0.2 + 0.1 * dusk).toFixed(2)}) brightness(${(0.97 - 0.3 * dusk).toFixed(2)}) saturate(${(0.92 - 0.35 * dusk).toFixed(2)}) hue-rotate(${Math.round(-12 * dusk)}deg)`;
    if (this.canvas.style.filter !== f) this.canvas.style.filter = f;
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
      c.arc(this.px(s.x), this.pz(s.z), grabbed ? 4.8 + Math.sin(time * 12) : s.state === 'folded' ? 3 : 4.6, 0, Math.PI * 2);
      if (grabbed) {
        // The snatch pulses on the map, so the place the banner names can be found at a glance.
        c.save();
        c.strokeStyle = `rgba(255, 70, 50, ${0.5 + 0.4 * Math.sin(time * 8)})`;
        c.lineWidth = 2.5;
        c.beginPath();
        c.arc(this.px(s.x), this.pz(s.z), 10 + 5 * ((time * 1.5) % 1), 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
      c.fillStyle = grabbed ? '#ff6b4a' : s.state === 'folded' ? '#f4e6c0' : '#ffffff';
      c.fill();
      c.lineWidth = 1.6;
      c.strokeStyle = 'rgba(30, 24, 34, 0.95)';
      c.stroke();
    }
    // Wolves: the red diamond of their edge markers.
    for (const w of sim.wolves) {
      if (w.state === 'gone') continue;
      c.save();
      c.translate(this.px(w.x), this.pz(w.z));
      c.rotate(Math.PI / 4);
      c.fillStyle = '#ff5a3c';
      c.fillRect(-4.2, -4.2, 8.4, 8.4);
      c.lineWidth = 1.6;
      c.strokeStyle = 'rgba(30, 16, 20, 0.95)';
      c.strokeRect(-4.2, -4.2, 8.4, 8.4);
      c.restore();
    }
    // The fold: the gold home badge of its edge marker, at the gate.
    const f = this.level.fold;
    const hx = this.px(f.mouth.x) + 2;
    const hz = this.pz(f.mouth.z);
    c.beginPath();
    c.arc(hx, hz, 7.5, 0, Math.PI * 2);
    c.fillStyle = '#f2b45a';
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(30, 24, 34, 0.9)';
    c.stroke();
    c.beginPath();
    c.moveTo(hx - 4, hz + 0.5);
    c.lineTo(hx, hz - 3.5);
    c.lineTo(hx + 4, hz + 0.5);
    c.moveTo(hx - 2.8, hz);
    c.lineTo(hx - 2.8, hz + 3.6);
    c.lineTo(hx + 2.8, hz + 3.6);
    c.lineTo(hx + 2.8, hz);
    c.strokeStyle = '#231c2b';
    c.lineWidth = 1.5;
    c.lineJoin = 'round';
    c.stroke();
    const d = sim.dog;
    const dx = this.px(d.x);
    const dz = this.pz(d.z);
    c.save();
    c.translate(dx, dz);
    c.rotate(-d.facing + Math.PI);
    c.scale(1.8, 1.8);
    c.beginPath();
    c.moveTo(0, -5.5);
    c.lineTo(4, 4);
    c.lineTo(0, 2);
    c.lineTo(-4, 4);
    c.closePath();
    c.fillStyle = '#ffc94d';
    c.fill();
    c.strokeStyle = '#231c2b';
    c.lineWidth = 1.3;
    c.stroke();
    c.restore();
    c.drawImage(this.labels, 0, 0, this.w, this.h);
  }

  /** Place names over everything else, so no dot ever hides a name a banner uses. */
  private drawLabels(c: CanvasRenderingContext2D) {
    c.save();
    c.font = "800 11.5px 'Nunito Variable', system-ui, sans-serif";
    c.textAlign = 'center';
    c.lineWidth = 3;
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(30, 36, 26, 0.75)';
    c.fillStyle = 'rgba(255, 248, 228, 0.9)';
    for (const p of PLACES) {
      const name = p.name.charAt(0) + p.name.slice(1).toLowerCase();
      c.strokeText(name, this.px(p.x), this.pz(p.z));
      c.fillText(name, this.px(p.x), this.pz(p.z));
    }
    c.restore();
  }
}
