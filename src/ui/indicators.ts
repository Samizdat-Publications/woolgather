import * as THREE from 'three';
import { insetRect, type InsetSide } from '../render/wolfcam';

// Screen-edge arrows for things that matter but are off camera: the fold, sheep in a wolf's jaws,
// hunting wolves and (when no sheep are on screen) the nearest loose sheep.

export type MarkerKind = 'fold' | 'grab' | 'wolf' | 'sheep';

export interface Marker {
  id: string;
  kind: MarkerKind;
  x: number;
  y: number;
  z: number;
  /** Also show a label over the thing while it is on screen. */
  labelOnScreen?: string;
}

const v = new THREE.Vector3();

// Each kind gets its own glyph so "home" and "danger" never read alike. The how-to card's legend
// shows the same glyphs.
export const MARKER_ICONS: Record<MarkerKind, string> = {
  fold: '<svg viewBox="-12 -12 24 24"><path d="M-7 1 L0 -6 L7 1 M-5 0 V7 H5 V0" fill="none" stroke="#231c2b" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  wolf: '<svg viewBox="-12 -12 24 24"><path d="M-7 -7 L-3 -1 L3 -1 L7 -7 L6 3 L0 8 L-6 3 Z" fill="#231c2b"/><circle cx="-2.5" cy="1.5" r="1.3" fill="#ffd040"/><circle cx="2.5" cy="1.5" r="1.3" fill="#ffd040"/></svg>',
  grab: '<svg viewBox="-12 -12 24 24"><path d="M0 -7 V2" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="0" cy="6.5" r="1.9" fill="#fff"/></svg>',
  sheep:
    '<svg viewBox="-12 -12 24 24"><circle cx="-3" cy="0" r="4" fill="#231c2b" opacity="0.18"/><path d="M-6 2 a3.5 3.5 0 0 1 1-6 a4 4 0 0 1 7-1 a3.5 3.5 0 0 1 3 6 Z" fill="#fff" stroke="#231c2b" stroke-width="1.4"/><rect x="4" y="-2" width="4" height="4.5" rx="1.5" fill="#231c2b"/></svg>',
};

/** Set while the wolf-cam inset is up, and on which side. */
export const hudState: { insetVisible: boolean; insetSide: InsetSide } = { insetVisible: false, insetSide: 'left' };

// Screen regions taken by HUD panels (top-left counts, top-right minimap, the timer and message
// banner across the top middle, the wolf-cam inset), in CSS pixels.
function avoidHud(px: number, py: number, w: number, h: number) {
  if (px > w - 250 && py < 215) py = 230;
  if (px < 190 && py < 135) py = 150;
  if (Math.abs(px - w / 2) < 340 && py < 150) py = 165;
  if (hudState.insetVisible) {
    // Markers on the inset's edge hop above it.
    const r = insetRect(hudState.insetSide, w, h);
    if (px > r.x - 34 && px < r.x + r.w + 34 && py > r.y - 30 && py < r.y + r.h + 30) py = r.y - 34;
  }
  return py;
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
    e.className = `ind ind-${m.kind}`;
    return e;
  }

  update(camera: THREE.Camera, markers: Marker[]) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.id);
      const e = this.el(m);
      v.set(m.x, m.y, m.z).project(camera);
      const behind = v.z > 1;
      let nx = behind ? -v.x : v.x;
      let ny = behind ? -v.y : v.y;
      const onScreen = !behind && Math.abs(nx) < 0.94 && Math.abs(ny) < 0.9;
      const label = e.querySelector('.ind-label') as HTMLElement;
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
      e.hidden = false;
      e.classList.remove('on-screen');
      label.textContent = '';
      // Push the point onto the screen edge along the ray from the centre.
      const ang = Math.atan2(-ny, nx);
      // Keep clear of the HUD panels in the top corners and the stamina bar at the bottom.
      const mx = 0.88;
      const my = ny > 0 ? 0.62 : 0.78;
      const k = Math.min(mx / Math.max(Math.abs(nx), 1e-4), my / Math.max(Math.abs(ny), 1e-4));
      nx *= k;
      ny *= k;
      const px = ((nx + 1) / 2) * w;
      const py = avoidHud(px, ((1 - ny) / 2) * h, w, h);
      e.style.transform = `translate(${px}px, ${py}px)`;
      (e.querySelector('.ind-arrow') as HTMLElement).style.transform = `rotate(${ang}rad)`;
    }
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
