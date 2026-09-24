import * as THREE from 'three';
import type { Level } from '../game/level';
import type { Sim } from '../game/sim';
import type { Terrain } from './terrain';

// Milestone 1 actors: dog, sheep and wolves out of primitive shapes, synced from the sim.

const lam = (c: number, e = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e });

function shadowed(o: THREE.Object3D) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = true;
  });
  return o;
}

function makeDog() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 1.15), lam(0x1e1c22));
  body.position.y = 0.75;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), lam(0xf2eee6));
  chest.position.set(0, 0.7, 0.48);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.5), lam(0x1e1c22));
  head.position.set(0, 1.1, 0.7);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), lam(0xf2eee6));
  snout.position.set(0, 1.0, 1.0);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.6), lam(0x1e1c22));
  tail.position.set(0, 0.85, -0.8);
  tail.rotation.x = 0.5;
  for (const [x, z] of [
    [-0.18, 0.4],
    [0.18, 0.4],
    [-0.18, -0.4],
    [0.18, -0.4],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), lam(0xf2eee6));
    leg.position.set(x, 0.28, z);
    g.add(leg);
  }
  g.add(body, chest, head, snout, tail);
  return shadowed(g);
}

// A little self-light keeps wool reading as white under orange sunset and blue moonlight.
const woolMat = new THREE.MeshLambertMaterial({ color: 0xf7f1e3, emissive: 0x5a5650 });

function makeSheep() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), woolMat);
  body.scale.set(1, 0.85, 1.25);
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.42), lam(0x2a2528));
  head.position.set(0, 1.0, 0.78);
  head.name = 'head';
  for (const [x, z] of [
    [-0.25, 0.35],
    [0.25, 0.35],
    [-0.25, -0.35],
    [0.25, -0.35],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), lam(0x2a2528));
    leg.position.set(x, 0.25, z);
    g.add(leg);
  }
  g.add(body, head);
  return shadowed(g);
}

function makeWolf() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1.4), lam(0x8b909c));
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 5), lam(0x7a7f8a));
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 1.05, 1.0);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd040 });
  for (const x of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), eyeMat);
    eye.position.set(x, 1.2, 0.85);
    g.add(eye);
  }
  const danger = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.5, 32),
    new THREE.MeshBasicMaterial({ color: 0xff4a30, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  danger.rotation.x = -Math.PI / 2;
  danger.position.y = 0.06;
  danger.name = 'danger';
  g.add(danger);
  for (const [x, z] of [
    [-0.2, 0.5],
    [0.2, 0.5],
    [-0.2, -0.5],
    [0.2, -0.5],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), lam(0x4b4e56));
    leg.position.set(x, 0.3, z);
    g.add(leg);
  }
  g.add(body, head);
  return shadowed(g);
}

export class GreyboxActors {
  readonly root = new THREE.Group();
  private dog = makeDog();
  private sheep: THREE.Object3D[] = [];
  private wolves = new Map<number, THREE.Object3D>();
  private ring: THREE.Mesh;
  private zone: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private zoneR = 10;
  private zoneA = 0.1;
  private beacon: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private time = 0;

  constructor(
    private terrain: Terrain,
    level: Level,
  ) {
    // Gold beacon in the fold gateway, pulsing while the gate can be latched.
    this.beacon = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.beacon.rotation.x = -Math.PI / 2;
    const f = level.fold;
    this.beacon.position.set(f.minX - 0.5, terrain.height(f.minX - 0.5, f.cz) + 0.07, f.cz);
    this.root.add(this.beacon);
    this.root.add(this.dog);
    // Ground marker so the player always finds the dog.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.1, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.root.add(this.ring);
    // Flight-zone ring: sheep inside it run from Pip. Shrinks when creeping, grows when sprinting.
    this.zone = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1.0, 96),
      new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.zone.rotation.x = -Math.PI / 2;
    this.root.add(this.zone);
  }

  sync(sim: Sim, dt = 1 / 60, gateGlow = false) {
    const h = (x: number, z: number) => this.terrain.height(x, z);
    const d = sim.dog;
    this.time += dt;
    this.beacon.visible = gateGlow;
    this.beacon.material.opacity = 0.45 + 0.35 * Math.sin(this.time * 4);
    this.beacon.scale.setScalar(1 + 0.08 * Math.sin(this.time * 4));
    this.dog.position.set(d.x, h(d.x, d.z), d.z);
    this.dog.rotation.y = d.facing;
    this.ring.position.set(d.x, h(d.x, d.z) + 0.05, d.z);
    this.zoneR += (sim.dogThreatRadius - this.zoneR) * (1 - Math.exp(-8 * dt));
    this.zone.position.set(d.x, h(d.x, d.z) + 0.04, d.z);
    this.zone.scale.setScalar(this.zoneR);
    this.zone.material.color.set(d.creeping ? 0x8fd0ff : d.sprinting ? 0xffb07a : 0xfff4d6);
    // Only draw attention to the ring when there are loose sheep near enough for it to matter.
    const reach = this.zoneR + 9;
    const near = sim.sheep.some(
      (s) => s.state !== 'folded' && s.state !== 'lost' && s.state !== 'grabbed' && (s.x - d.x) ** 2 + (s.z - d.z) ** 2 < reach * reach,
    );
    const want = near ? (d.creeping ? 0.42 : 0.26) : 0.06;
    this.zoneA += (want - this.zoneA) * (1 - Math.exp(-5 * dt));
    this.zone.material.opacity = this.zoneA;

    while (this.sheep.length < sim.sheep.length) {
      const m = makeSheep();
      this.sheep.push(m);
      this.root.add(m);
    }
    sim.sheep.forEach((s, i) => {
      const m = this.sheep[i];
      m.visible = s.state !== 'lost';
      const lift = s.state === 'grabbed' ? 0.4 : 0;
      m.position.set(s.x, h(s.x, s.z) + lift, s.z);
      m.rotation.y = s.facing;
      const head = m.getObjectByName('head');
      if (head) head.position.y = s.state === 'graze' ? 0.62 : 1.0;
    });

    const seen = new Set<number>();
    for (const w of sim.wolves) {
      if (w.state === 'gone') continue;
      seen.add(w.id);
      let m = this.wolves.get(w.id);
      if (!m) {
        m = makeWolf();
        this.wolves.set(w.id, m);
        this.root.add(m);
      }
      m.position.set(w.x, h(w.x, w.z), w.z);
      m.rotation.y = w.facing;
      const danger = m.getObjectByName('danger') as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | undefined;
      if (danger) {
        danger.visible = w.state !== 'flee';
        danger.material.opacity = 0.45 + 0.35 * Math.sin(this.time * 8);
      }
    }
    for (const [id, m] of this.wolves) {
      if (!seen.has(id)) {
        this.root.remove(m);
        this.wolves.delete(id);
      }
    }
  }
}
