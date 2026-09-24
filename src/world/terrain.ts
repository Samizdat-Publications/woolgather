import type { Level } from '../game/level';
import { clamp } from '../game/math';

// Walkable surface height. Greybox: flat ground plus the bridge deck. The Blender heightfield
// replaces the flat ground in milestone 2.

export const BRIDGE_DECK = 0.55;
const RAMP = 1.6;

export class Terrain {
  constructor(private level: Level) {}

  /** Bare ground height. */
  ground(_x: number, _z: number) {
    return 0;
  }

  /** Where feet go: the ground, or the bridge deck (with short ramps at both ends). */
  height(x: number, z: number) {
    const g = this.ground(x, z);
    const b = this.level.bridge;
    const dx = x - b.x;
    const dz = z - b.z;
    const along = dx * b.ux + dz * b.uz;
    const across = -dx * b.uz + dz * b.ux;
    if (Math.abs(across) > b.w / 2 + 0.2 || Math.abs(along) > b.len / 2) return g;
    const k = clamp((b.len / 2 - Math.abs(along)) / RAMP, 0, 1);
    const deckY = this.ground(b.x, b.z) + BRIDGE_DECK;
    return Math.max(g, g + (deckY - g) * (k * k * (3 - 2 * k)));
  }
}
