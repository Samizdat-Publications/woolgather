import * as THREE from 'three';
import type { ScreenRect } from '../render/wolfcam';

// Screen-edge arrows for things that matter but are off camera: the fold, sheep in a wolf's jaws,
// hunting wolves and (when no sheep are on screen) the nearest loose sheep.

export type MarkerKind = 'fold' | 'grab' | 'wolf' | 'sheep' | 'note';

export interface Marker {
  id: string;
  kind: MarkerKind;
  x: number;
  y: number;
  z: number;
  /** Also show a label over the thing while it is on screen. */
  labelOnScreen?: string;
  /** A label only: nothing at the screen edge when the point is off screen. */
  onScreenOnly?: boolean;
  /** Also float the icon over the thing while it is in view (the loudest alerts). */
  iconOnScreen?: boolean;
  /** Steady rather than pulsing: nothing can be done about it (a snatch too far away to save). */
  muted?: boolean;
}

const v = new THREE.Vector3();

// Each kind gets its own glyph so "home" and "danger" never read alike. The how-to card's legend
// shows the same glyphs.
export const MARKER_ICONS: Record<MarkerKind, string> = {
  fold: '<svg viewBox="-12 -12 24 24"><path d="M-7 1 L0 -6 L7 1 M-5 0 V7 H5 V0" fill="none" stroke="#231c2b" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  wolf: '<svg viewBox="-12 -12 24 24"><path d="M-7 -7 L-3 -1 L3 -1 L7 -7 L6 3 L0 8 L-6 3 Z" fill="#231c2b"/><circle cx="-2.5" cy="1.5" r="1.3" fill="#ffd040"/><circle cx="2.5" cy="1.5" r="1.3" fill="#ffd040"/></svg>',
  grab: '<svg viewBox="-12 -12 24 24"><path d="M0 -7 V2" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="0" cy="6.5" r="1.9" fill="#fff"/></svg>',
  sheep:
    '<svg viewBox="-12 -12 24 24"><path d="M-5.5 3v4.5M0.5 3v4.5" stroke="#231c2b" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="-2.5" cy="0" rx="7" ry="4.6" fill="#fff" stroke="#231c2b" stroke-width="1.4"/><ellipse cx="6" cy="-2.2" rx="3.4" ry="2.7" fill="#231c2b"/><path d="M4.6 -4.4l-1.9-1.6" stroke="#231c2b" stroke-width="1.8" stroke-linecap="round"/></svg>',
  note: '',
};

/** Set while the wolf-cam inset is up, and where it is; and where the minimap panel is. */
export const hudState: { insetVisible: boolean; insetRect: ScreenRect | null; mapRect: DOMRect | null; countsRect: DOMRect | null } = { insetVisible: false, insetRect: null, mapRect: null, countsRect: null };

// Screen regions taken by HUD panels (top-left counts, top-right minimap, the timer and message
// banner across the top middle, the wolf-cam inset), in CSS pixels.
function avoidHud(px: number, py: number, w: number): [number, number] {
  const m = hudState.mapRect;
  // Under the minimap panel: drop below it, clear of its edge.
  if (m && px > m.left - 30 && py < m.bottom + 22) py = m.bottom + 36;
  else if (!m && px > w - 250 && py < 215) py = 230;
  // Under the flock counter: drop below it.
  const c = hudState.countsRect;
  if (c && px < c.right + 30 && py < c.bottom + 26) py = c.bottom + 40;
  else if (!c && px < 190 && py < 135) py = 150;
  // The timer and banner across the top middle: slide along the edge past them rather than
  // dropping into the field, where a marker reads as an object in the world.
  if (Math.abs(px - w / 2) < 340 && py < 150) px = px < w / 2 ? w / 2 - 350 : w / 2 + 350;
  const r = hudState.insetRect;
  if (hudState.insetVisible && r) {
    // Markers on the inset's edge hop above it.
    if (px > r.x - 34 && px < r.x + r.w + 34 && py > r.y - 30 && py < r.y + r.h + 30) py = r.y - 34;
  }
  return [px, py];
}

export class Indicators {
  readonly root: HTMLElement;
  private els = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'indicators';
    parent.appendChild(this.root);
  }

  private el(m: Marker) {
    let e = this.els.get(m.id);
    if (!e) {
      e = document.createElement('div');
      e.innerHTML = `<div class="ind-arrow"><svg viewBox="-30 -30 60 60"><path d="M30 0 L17 -9 L17 9 Z" fill="currentColor" stroke="rgba(20,16,26,0.7)" stroke-width="2" stroke-linejoin="round"/></svg></div><div class="ind-icon">${MARKER_ICONS[m.kind]}</div><div class="ind-label"></div>`;
      this.root.appendChild(e);
      this.els.set(m.id, e);
    }
    e.className = `ind ind-${m.kind}${m.muted ? ' muted' : ''}`;
    return e;
  }

  update(camera: THREE.Camera, markers: Marker[]) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const seen = new Set<string>();
    const edge: { e: HTMLElement; x: number; y: number }[] = [];
    for (const m of markers) {
      seen.add(m.id);
      const e = this.el(m);
      v.set(m.x, m.y, m.z).project(camera);
      const behind = v.z > 1;
      let nx = behind ? -v.x : v.x;
      let ny = behind ? -v.y : v.y;
      const inFrame = !behind && Math.abs(nx) < 1 && Math.abs(ny) < 1;
      const onScreen = inFrame && Math.abs(nx) < 0.92 && ny > -0.8 && ny < 0.66;
      const label = e.querySelector('.ind-label') as HTMLElement;
      if (onScreen && m.iconOnScreen) {
        // The icon floats up and to the side of the thing, never over it, with no arrow.
        e.hidden = false;
        e.classList.add('beside');
        e.classList.remove('on-screen');
        label.textContent = '';
        e.style.transform = `translate(${Math.min(w - 30, ((nx + 1) / 2) * w + 46)}px, ${Math.max(30, ((1 - ny) / 2) * h - 46)}px)`;
        continue;
      }
      if (onScreen) {
        if (m.labelOnScreen) {
          e.hidden = false;
          e.classList.add('on-screen');
          label.textContent = m.labelOnScreen;
          e.style.transform = `translate(${((nx + 1) / 2) * w}px, ${((1 - ny) / 2) * h}px)`;
        } else {
          e.hidden = true;
        }
        continue;
      }
      if (m.onScreenOnly) {
        e.hidden = true;
        continue;
      }
      if (inFrame && m.kind !== 'fold') {
        // Partly hidden under the HUD: the icon floats beside it (above it at the bottom, below
        // it at the top), with no arrow, so it never covers the animal.
        e.hidden = false;
        e.classList.add('beside');
        e.classList.remove('on-screen');
        label.textContent = '';
        const px = Math.min(w - 30, Math.max(30, ((nx + 1) / 2) * w));
        const py = ((1 - ny) / 2) * h + (ny < 0 ? -58 : 58);
        e.style.transform = `translate(${px}px, ${Math.min(h - 30, Math.max(30, py))}px)`;
        continue;
      }
      e.hidden = false;
      e.classList.remove('on-screen', 'beside');
      label.textContent = '';
      // Push the point onto the screen edge along the ray from the centre.
      const ang = Math.atan2(-ny, nx);
      // Keep clear of the HUD panels in the top corners and the stamina bar at the bottom.
      const mx = 0.88;
      const my = ny > 0 ? 0.62 : 0.78;
      const k = Math.min(mx / Math.max(Math.abs(nx), 1e-4), my / Math.max(Math.abs(ny), 1e-4));
      nx *= k;
      ny *= k;
      const [px, py] = avoidHud(((nx + 1) / 2) * w, ((1 - ny) / 2) * h, w);
      edge.push({ e, x: px, y: py });
      (e.querySelector('.ind-arrow') as HTMLElement).style.transform = `rotate(${ang}rad)`;
    }
    // Markers landing on the same stretch of edge slide apart along it instead of stacking.
    const GAP = 52;
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < edge.length; i++) {
        for (let j = i + 1; j < edge.length; j++) {
          const a = edge[i];
          const b = edge[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d >= GAP) continue;
          if (d < 0.5) {
            // Exactly on top of each other: part along the edge they sit on.
            const side = a.x < 80 || a.x > w - 80;
            dx = side ? 0 : 1;
            dy = side ? 1 : 0;
            d = 1;
          }
          const push = (GAP - Math.min(d, GAP)) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
    for (const m of edge) m.e.style.transform = `translate(${Math.min(w - 30, Math.max(30, m.x))}px, ${Math.min(h - 30, Math.max(30, m.y))}px)`;
    for (const [id, e] of this.els) {
      if (!seen.has(id)) {
        e.remove();
        this.els.delete(id);
      }
    }
  }

  clear() {
    for (const e of this.els.values()) e.remove();
    this.els.clear();
  }
}
