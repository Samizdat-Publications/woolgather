import type { Level } from '../game/level';
import type { Sim } from '../game/sim';

// Top-down map of the level: pens, water, every sheep, wolves and Pip. Redrawn at half rate.

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
  /** Long levels (the High Pass) scroll: the map is drawn at a readable scale and the panel shows a window round Pip. */
  private fullW = 200;
  private vx = 0;
  /**
   * In mist the map only knows what Pip has seen: each sheep's last seen place and time. Null when
   * the evening is clear (the map shows everything).
   */
  memory: Map<number, { x: number; z: number; t: number }> | null = null;
  /** The valley's colour on the map follows the season. */
  private fill = 'rgba(125, 150, 88, 0.92)';
  setSeason(season: string) {
    const f = season === 'winter' ? 'rgba(214, 220, 228, 0.94)' : season === 'autumn' ? 'rgba(150, 146, 86, 0.92)' : 'rgba(125, 150, 88, 0.92)';
    if (f !== this.fill) {
      this.fill = f;
      this.refresh();
    }
  }

  constructor(private level: Level) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.labels = document.createElement('canvas');
    this.resize(240, 192);
    document.fonts?.ready.then(() => this.drawLabelLayer(Math.min(2, window.devicePixelRatio || 1)));
  }

  setLevel(level: Level) {
    this.level = level;
    this.resize(this.w, this.h);
  }

  /** Redraw the static layer (a ford flooded). */
  refresh() {
    this.drawBase(Math.min(2, window.devicePixelRatio || 1));
  }

  resize(w: number, h: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    const xs = this.level.boundary.map((p) => p[0]);
    const zs = this.level.boundary.map((p) => p[1]);
    const minX = Math.min(...xs) - 4;
    const maxX = Math.max(...xs) + 4;
    const minZ = Math.min(...zs) - 4;
    const maxZ = Math.max(...zs) + 4;
    const fit = Math.min(w / (maxX - minX), h / (maxZ - minZ));
    // A level too long to fit at a readable scale scrolls with Pip instead.
    const readable = Math.min(h / (maxZ - minZ), w / 230);
    this.scale = fit < readable * 0.8 ? readable : fit;
    this.fullW = Math.max(w, Math.ceil((maxX - minX) * this.scale));
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    for (const c of [this.base, this.labels]) {
      c.width = Math.round(this.fullW * dpr);
      c.height = Math.round(h * dpr);
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ox = (this.fullW - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oz = (h - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;
    this.vx = 0;
    this.drawBase(dpr);
    this.drawLabelLayer(dpr);
  }

  /** Copy a layer (drawn at the full map width) into the panel through the current window. */
  private blit(src: HTMLCanvasElement) {
    const k = src.width / this.fullW;
    this.ctx.drawImage(src, this.vx * k, 0, this.w * k, src.height, 0, 0, this.w, this.h);
  }

  private drawLabelLayer(dpr: number) {
    const c = this.labels.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.fullW, this.h);
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
    c.clearRect(0, 0, this.fullW, this.h);
    const L = this.level;
    c.beginPath();
    L.boundary.forEach(([x, z], i) => (i ? c.lineTo(this.px(x), this.pz(z)) : c.moveTo(this.px(x), this.pz(z))));
    c.closePath();
    c.fillStyle = this.fill;
    c.fill();
    c.strokeStyle = 'rgba(40, 52, 36, 0.9)';
    c.lineWidth = 2;
    c.stroke();
    c.save();
    c.clip();
    for (const l of L.lochs) {
      c.beginPath();
      l.pts.forEach(([x, z], i) => (i ? c.lineTo(this.px(x), this.pz(z)) : c.moveTo(this.px(x), this.pz(z))));
      c.closePath();
      c.fillStyle = '#5e9ccc';
      c.fill();
    }
    for (const s of L.streams) {
      c.beginPath();
      s.pts.forEach(([x, z], i) => (i ? c.lineTo(this.px(x), this.pz(z)) : c.moveTo(this.px(x), this.pz(z))));
      c.strokeStyle = '#6aa6d6';
      c.lineWidth = Math.max(2, s.half * 2 * this.scale);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.stroke();
    }
    c.restore();
    for (const b of L.bridges) {
      c.save();
      c.translate(this.px(b.x), this.pz(b.z));
      c.rotate(Math.atan2(b.uz, b.ux));
      c.fillStyle = '#b08658';
      c.fillRect((-b.len / 2) * this.scale, (-b.w / 2) * this.scale, b.len * this.scale, b.w * this.scale);
      c.restore();
    }
    // Fords: a pale band across the stream while open; a red cross once flooded.
    for (const f of L.fords) {
      c.save();
      c.translate(this.px(f.x), this.pz(f.z));
      if (f.open) {
        c.fillStyle = 'rgba(190, 236, 222, 0.95)';
        c.fillRect(-f.r * this.scale * 1.1, -f.r * this.scale * 0.55, f.r * this.scale * 2.2, f.r * this.scale * 1.1);
      } else {
        c.strokeStyle = '#d8442e';
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(-4, -4);
        c.lineTo(4, 4);
        c.moveTo(4, -4);
        c.lineTo(-4, 4);
        c.stroke();
      }
      c.restore();
    }
    c.fillStyle = 'rgba(50, 80, 50, 0.3)';
    for (const t of L.trees) {
      c.beginPath();
      c.arc(this.px(t.x), this.pz(t.z), 1.4 * t.s * this.scale + 0.6, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(90, 88, 84, 0.4)';
    for (const [x, z, r] of L.def.rocks) {
      c.beginPath();
      c.arc(this.px(x), this.pz(z), r * this.scale * 0.7 + 0.4, 0, Math.PI * 2);
      c.fill();
    }
    for (const r of L.rects) {
      c.fillStyle = '#d8c7a6';
      c.fillRect(this.px(r.minX), this.pz(r.minZ), (r.maxX - r.minX) * this.scale, (r.maxZ - r.minZ) * this.scale);
    }
    for (const p of L.pens) {
      c.beginPath();
      [
        [-p.halfW, -p.halfD],
        [p.halfW, -p.halfD],
        [p.halfW, p.halfD],
        [-p.halfW, p.halfD],
      ].forEach(([lx, lz], i) => {
        const q = p.toWorld(lx, lz);
        if (i) c.lineTo(this.px(q.x), this.pz(q.z));
        else c.moveTo(this.px(q.x), this.pz(q.z));
      });
      c.closePath();
      c.fillStyle = 'rgba(246, 220, 150, 0.95)';
      c.fill();
    }
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
    if (sim && this.fullW > this.w) {
      const want = Math.max(0, Math.min(this.fullW - this.w, this.px(sim.dog.x) - this.w / 2));
      this.vx += (want - this.vx) * 0.2;
    }
    this.blit(this.base);
    if (!sim) return;
    c.save();
    c.translate(-this.vx, 0);
    const mem = this.memory;
    for (const s of sim.sheep) {
      if (s.state === 'lost' || s.state === 'hidden') continue;
      const grabbed = s.state === 'grabbed';
      let x = s.x;
      let z = s.z;
      let alpha = 1;
      if (mem && s.state !== 'folded' && !grabbed) {
        const m = mem.get(s.id);
        if (!m) continue;
        // Where Pip last saw it, fading as the memory gets old.
        x = m.x;
        z = m.z;
        alpha = Math.max(0, 1 - (sim.elapsed - m.t) / 40);
        if (alpha <= 0.02) continue;
      }
      const r = grabbed ? 4.8 + Math.sin(time * 12) : s.state === 'folded' ? 3 : s.kind === 'lamb' ? 3.4 : s.kind === 'ram' ? 5.6 : 4.6;
      c.globalAlpha = alpha;
      c.beginPath();
      c.arc(this.px(x), this.pz(z), r, 0, Math.PI * 2);
      if (grabbed) {
        c.save();
        c.strokeStyle = `rgba(255, 70, 50, ${0.5 + 0.4 * Math.sin(time * 8)})`;
        c.lineWidth = 2.5;
        c.beginPath();
        c.arc(this.px(x), this.pz(z), 10 + 5 * ((time * 1.5) % 1), 0, Math.PI * 2);
        c.stroke();
        c.restore();
        c.beginPath();
        c.arc(this.px(x), this.pz(z), r, 0, Math.PI * 2);
      }
      c.fillStyle = grabbed ? '#ff6b4a' : s.state === 'folded' ? '#f4e6c0' : s.kind === 'black' ? '#4a4450' : s.kind === 'ram' ? '#e8d8b4' : '#ffffff';
      c.fill();
      c.lineWidth = 1.6;
      c.strokeStyle = 'rgba(30, 24, 34, 0.95)';
      c.stroke();
      c.globalAlpha = 1;
    }
    for (const w of sim.wolves) {
      if (w.state === 'gone') continue;
      if (mem && Math.hypot(w.x - sim.dog.x, w.z - sim.dog.z) > 32 && w.state !== 'drag') continue;
      if (w.role === 'flanker') {
        // The wolf slipping round behind the flock: a pulsing ring, so it is not missed.
        const k = (sim.elapsed * 1.4) % 1;
        c.beginPath();
        c.arc(this.px(w.x), this.pz(w.z), 6 + k * 9, 0, Math.PI * 2);
        c.strokeStyle = `rgba(255, 90, 60, ${(0.9 * (1 - k)).toFixed(2)})`;
        c.lineWidth = 2;
        c.stroke();
      }
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
    if (!sim.watch) {
      const f = this.level.fold;
      const hx = this.px(f.mouth.x);
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
    }
    const d = sim.dog;
    c.save();
    c.translate(this.px(d.x), this.pz(d.z));
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
    c.restore();
    this.blit(this.labels);
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
    for (const p of this.level.places) {
      // Bridges and fords are drawn on the map; their names would crowd the place names.
      if (p.kind === 'crossing') continue;
      const name = p.name.charAt(0) + p.name.slice(1).toLowerCase();
      const half = c.measureText(name).width / 2 + 3;
      const lx = Math.max(half, Math.min(this.fullW - half, this.px(p.x)));
      const ly = Math.max(12, Math.min(this.h - 4, this.pz(p.z)));
      c.strokeText(name, lx, ly);
      c.fillText(name, lx, ly);
    }
    c.restore();
  }
}
