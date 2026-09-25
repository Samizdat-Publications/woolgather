import type { Dog, Sheep, Wolf } from '../game/sim';
import type { Rig } from './actors';

// Procedural animation for the rigid-part Blender rigs. Every part rotates about its joint:
// legs swing about the hip or shoulder (rotation.x, positive swings the foot back), the head
// nods about the neck (positive lowers the nose), the tail lifts (positive) and wags
// (rotation.y). Gaits are blended by angle, not by phase, so walk, trot and gallop cross-fade
// without pops. Stride frequency follows ground speed so the feet do not skate.

const TAU = Math.PI * 2;
/** Phase offsets per leg in rig order [fl, fr, bl, br]. */
const WALK = [0.25, 0.75, 0, 0.5];
const TROT = [0, 0.5, 0.5, 0];
const GALLOP = [0.5, 0.6, 0, 0.1];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const damp = (cur: number, want: number, rate: number, dt: number) => cur + (want - cur) * (1 - Math.exp(-rate * dt));

interface RestPose {
  bodyY: number;
  hipH: number;
}

/** Per-actor animation memory. */
export class AnimState {
  phase = Math.random();
  amp = 0;
  gallop = 0;
  walk = 1;
  crouch = 0;
  prevFacing = 0;
  turn = 0;
  headYaw = 0;
  hop = 0;
  hopT = 99;
  lift = 0;
  prevState = '';
  seed = Math.random() * 100;
  rest: RestPose | null = null;
}

function rest(r: Rig, st: AnimState): RestPose {
  if (!st.rest) {
    const leg = r.legs[0];
    st.rest = { bodyY: r.body.position.y, hipH: r.body.position.y + (leg ? leg.position.y : 0) };
  }
  return st.rest;
}

/**
 * Advance the gait and pose the legs. `speed` is signed ground speed along the facing (negative
 * walks backwards), `legLen` is the world leg length, `gallopAt` the speed where the gallop is
 * fully in.
 */
function gait(r: Rig, st: AnimState, speed: number, dt: number, legLen: number, walkBelow: number, gallopAt: number, maxAmp: number) {
  const s = Math.abs(speed);
  const wantAmp = s < 0.25 ? 0 : clamp(0.22 + (s / gallopAt) * (maxAmp - 0.22), 0.22, maxAmp);
  st.amp = damp(st.amp, wantAmp, 8, dt);
  st.gallop = damp(st.gallop, clamp((s - gallopAt * 0.72) / (gallopAt * 0.28), 0, 1), 5, dt);
  st.walk = damp(st.walk, s < walkBelow ? 1 : 0, 5, dt);
  if (s > 0.05) {
    const stride = 4 * legLen * Math.max(0.2, Math.sin(Math.max(st.amp, 0.2)));
    const f = clamp(s / stride, 0.6, 4.6);
    st.phase += Math.sign(speed) * f * dt;
  }
  const trotW = (1 - st.walk) * (1 - st.gallop);
  const walkW = st.walk * (1 - st.gallop);
  for (let i = 0; i < r.legs.length; i++) {
    const a =
      walkW * Math.sin(TAU * (st.phase + WALK[i])) +
      trotW * Math.sin(TAU * (st.phase + TROT[i])) +
      st.gallop * Math.sin(TAU * (st.phase + GALLOP[i]));
    r.legs[i].rotation.x = -a * st.amp;
  }
}

/** Crouch: drop the body and shorten the legs so the feet stay on the ground. */
function crouch(r: Rig, p: RestPose, amount: number, bob: number) {
  const drop = amount * 0.2 * p.hipH;
  r.body.position.y = p.bodyY - drop + bob;
  const k = (p.hipH - drop) / p.hipH;
  for (const l of r.legs) l.scale.y = k;
}

export function animateDog(r: Rig, st: AnimState, d: Dog, dt: number, time: number, lookAt: number | null) {
  const p = rest(r, st);
  const fwd = d.vx * Math.sin(d.facing) + d.vz * Math.cos(d.facing);
  gait(r, st, fwd, dt, 1.1, 3.5, 11.5, 0.8);
  // Turn rate for a lean into corners.
  let df = d.facing - st.prevFacing;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  st.prevFacing = d.facing;
  st.turn = damp(st.turn, dt > 0 ? df / dt : 0, 10, dt);
  st.crouch = damp(st.crouch, d.creeping ? 1 : 0, 8, dt);
  const s = d.speed;
  const trotBob = st.amp * (1 - st.gallop) * 0.035 * Math.abs(Math.sin(TAU * st.phase));
  const galBob = st.gallop * 0.05 * Math.sin(TAU * st.phase + 1.2);
  // Bark: a quick upward jerk of the head and a little hop.
  const bark = d.sinceBark < 0.35 ? Math.sin((d.sinceBark / 0.35) * Math.PI) : 0;
  crouch(r, p, st.crouch, trotBob + galBob + bark * 0.03);
  r.body.rotation.x = st.gallop * 0.12 * Math.sin(TAU * st.phase) - bark * 0.08;
  r.body.rotation.z = clamp(-st.turn * 0.05, -0.22, 0.22) * clamp(s / 6, 0, 1);
  if (r.head) {
    // Eye on the flock: the head turns towards the sheep Pip is working.
    st.headYaw = damp(st.headYaw, lookAt === null ? 0 : clamp(lookAt, -0.7, 0.7), 6, dt);
    r.head.rotation.y = st.headYaw;
    r.head.rotation.x = st.crouch * 0.3 - bark * 0.45 - r.body.rotation.x * 0.6 + st.gallop * 0.1;
  }
  for (const e of r.ears) e.rotation.x = -0.35 * bark - 0.25 * st.gallop + 0.08 * Math.sin(TAU * st.phase * 2);
  if (r.tail) {
    // Happy wag when strolling or standing, streaming out behind at speed, low when creeping.
    const wag = clamp(1 - s / 5, 0, 1) * (1 - st.crouch);
    r.tail.rotation.y = wag * 0.5 * Math.sin(time * TAU * 4.2) + (1 - wag) * 0.12 * Math.sin(TAU * st.phase);
    r.tail.rotation.x = 0.1 * wag + 0.45 * clamp(s / 10, 0, 1) - 0.4 * st.crouch;
  }
}

export function animateSheep(r: Rig, st: AnimState, s: Sheep, dt: number, time: number) {
  const p = rest(r, st);
  const grabbed = s.state === 'grabbed';
  if (s.state !== st.prevState) {
    // A startled jump the moment a sheep takes fright.
    if ((s.state === 'flee' || s.state === 'panic') && st.prevState !== 'flee' && st.prevState !== 'panic') st.hopT = 0;
    st.prevState = s.state;
  }
  if (grabbed) {
    // Kicking in the wolf's jaws.
    for (let i = 0; i < r.legs.length; i++) r.legs[i].rotation.x = 0.7 * Math.sin(time * 17 + i * 1.9 + st.seed);
    r.body.position.y = p.bodyY;
    if (r.head) r.head.rotation.x = -0.4 + 0.15 * Math.sin(time * 11);
    return;
  }
  const fwd = s.vx * Math.sin(s.facing) + s.vz * Math.cos(s.facing);
  gait(r, st, fwd, dt, 0.74, 1.6, 7.5, 0.7);
  st.hopT += dt;
  const startle = st.hopT < 0.38 ? Math.sin((st.hopT / 0.38) * Math.PI) * 0.3 : 0;
  // Panicked sheep pronk: stiff-legged bounces.
  const pronk = s.state === 'panic' ? Math.max(0, Math.sin(time * TAU * 2.4 + st.seed)) * 0.16 : 0;
  if (pronk > 0) for (const l of r.legs) l.rotation.x *= 0.3;
  const bob = st.amp * 0.03 * Math.abs(Math.sin(TAU * st.phase));
  r.body.position.y = p.bodyY + bob + startle + pronk;
  r.body.rotation.x = st.gallop * 0.1 * Math.sin(TAU * st.phase);
  if (r.head) {
    st.lift = Math.max(0, st.lift - dt);
    const graze = s.state === 'graze' ? 1 : 0;
    const nibble = graze * 0.06 * Math.sin(time * 9 + st.seed);
    const want = graze * 0.8 + nibble - (s.fear > 0.3 ? 0.2 : 0) - (st.lift > 0 ? 0.35 : 0);
    r.head.rotation.x = damp(r.head.rotation.x, want, 7, dt);
  }
}

/** Lift the head for a bleat. */
export function sheepBleat(st: AnimState) {
  st.lift = 0.6;
}

export function animateWolf(r: Rig, st: AnimState, w: Wolf, dt: number, time: number) {
  const p = rest(r, st);
  const fwd = w.vx * Math.sin(w.facing) + w.vz * Math.cos(w.facing);
  gait(r, st, fwd, dt, 1.05, 5.5, 9.5, 0.85);
  const stalking = w.state === 'stalk';
  const dragging = w.state === 'drag';
  const fleeing = w.state === 'flee';
  st.crouch = damp(st.crouch, stalking ? 0.75 : dragging ? 0.45 : 0, 5, dt);
  const bob = st.amp * (1 - st.gallop) * 0.03 * Math.abs(Math.sin(TAU * st.phase)) + st.gallop * 0.05 * Math.sin(TAU * st.phase + 1.2);
  crouch(r, p, st.crouch, bob);
  r.body.rotation.x = st.gallop * 0.14 * Math.sin(TAU * st.phase) - (dragging ? 0.1 : 0);
  if (r.head) {
    // Low and forward when stalking, braced down gripping the prey while dragging.
    const want = stalking ? 0.28 : dragging ? 0.5 : w.state === 'charge' ? 0.12 : 0;
    r.head.rotation.x = damp(r.head.rotation.x, want, 6, dt) + (dragging ? 0.05 * Math.sin(time * 9) : 0);
  }
  for (const e of r.ears) e.rotation.x = damp(e.rotation.x, w.state === 'charge' || fleeing ? -0.6 : stalking ? 0.15 : 0, 8, dt);
  if (r.tail) {
    // Level when hunting, streaming at the charge, tucked between the legs in flight.
    const want = fleeing ? -0.75 : stalking ? -0.3 : w.state === 'charge' ? 0.25 : -0.1;
    r.tail.rotation.x = damp(r.tail.rotation.x, want, 6, dt);
    r.tail.rotation.y = 0.12 * Math.sin(TAU * st.phase) + (stalking ? 0.08 * Math.sin(time * 1.3 + st.seed) : 0);
  }
}
