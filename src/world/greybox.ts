import * as THREE from 'three';
import type { Level } from '../game/level';
import { pointInPolygon, Rng } from '../game/math';
import { BRIDGE_DECK, type Terrain } from './terrain';

// Milestone 1 world: primitive shapes only. Replaced by Blender models in milestone 2.

const mat = (color: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
  new THREE.MeshLambertMaterial({ color, ...extra });

function ribbon(points: ReadonlyArray<readonly [number, number]>, halfWidth: number, y: number, material: THREE.Material) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    pos.push(p[0] - tz * halfWidth, y, p[1] + tx * halfWidth, p[0] + tz * halfWidth, y, p[1] - tx * halfWidth);
    if (i > 0) {
      // Counter-clockwise seen from above so the face points up (+Y).
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

function wallBox(ax: number, az: number, bx: number, bz: number, h: number, thick: number, material: THREE.Material) {
  const l = Math.hypot(bx - ax, bz - az);
  const m = new THREE.Mesh(new THREE.BoxGeometry(l, h, thick), material);
  m.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
  m.rotation.y = -Math.atan2(bz - az, bx - ax);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildGreybox(level: Level, _terrain: Terrain) {
  const root = new THREE.Group();
  root.name = 'greybox';
  const L = level.data;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(L.world.maxX - L.world.minX, L.world.maxZ - L.world.minZ), mat(0x86a95c));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  root.add(ribbon(L.path as [number, number][], 1.3, 0.02, mat(0xc2a878)));
  root.add(ribbon(L.stream.points as [number, number][], L.stream.halfWidth, 0.04, mat(0x4a86b8)));

  // Bridge deck and rails.
  const b = level.bridge;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(b.len, 0.3, b.w), mat(0x8a6240));
  deck.position.set(b.x, BRIDGE_DECK - 0.15, b.z);
  deck.castShadow = deck.receiveShadow = true;
  root.add(deck);
  for (const s of level.segs.filter((s) => s.tag === 'rail')) root.add(wallBox(s.ax, s.az, s.bx, s.bz, 1.3, 0.2, mat(0x6d4a2e)));

  // Ford stepping stones.
  const f = level.ford;
  for (let i = -2; i <= 2; i++) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.3, 7), mat(0x9a9a92));
    st.position.set(f.x + i * 1.6, 0.12, f.z + (i % 2) * 0.8);
    st.receiveShadow = true;
    root.add(st);
  }

  // Fold walls and guide fences.
  const stone = mat(0xa5a39a);
  const wood = mat(0x7a5638);
  for (const s of level.segs) {
    if (s.tag === 'wall') root.add(wallBox(s.ax, s.az, s.bx, s.bz, 1.2, 0.9, stone));
    if (s.tag === 'fence') root.add(wallBox(s.ax, s.az, s.bx, s.bz, 1.0, 0.18, wood));
  }

  // Farmhouse.
  for (const r of level.rects) {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const house = new THREE.Mesh(new THREE.BoxGeometry(w, 4.2, d), mat(0xd8cfbf));
    house.position.set((r.minX + r.maxX) / 2, 2.1, (r.minZ + r.maxZ) / 2);
    house.castShadow = house.receiveShadow = true;
    root.add(house);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.62, d * 0.62, w + 0.8, 3), mat(0x5c5f6e));
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = Math.PI / 2;
    roof.position.set(house.position.x, 4.2 + d * 0.3, house.position.z);
    roof.castShadow = true;
    root.add(roof);
  }

  // Trees, rocks, bushes, hay, lantern, signpost.
  const trunk = mat(0x6b4a33);
  for (const t of level.trees) {
    const g = new THREE.Group();
    if (t.kind === 'pine') {
      const c = new THREE.Mesh(new THREE.ConeGeometry(2.4, 7.5, 7), mat(0x3f6b45));
      c.position.y = 5.2;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.2, 6), trunk);
      tr.position.y = 1.1;
      g.add(c, tr);
    } else if (t.kind === 'oak') {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(3.3, 0), mat(0x6f8f3e));
      c.position.y = 5.3;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 4, 6), trunk);
      tr.position.y = 2;
      g.add(c, tr);
    } else {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 0), mat(0xb7c35a));
      c.position.y = 5.6;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 5.5, 6), mat(0xe8e4da));
      tr.position.y = 2.75;
      g.add(c, tr);
    }
    g.position.set(t.x, 0, t.z);
    g.scale.setScalar(t.s);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    root.add(g);
  }
  for (const [x, z, r] of L.rocks) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(0x8e8a84));
    m.position.set(x, r * 0.45, z);
    m.scale.y = 0.7;
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  for (const [x, z, s] of L.bushes) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 * s, 0), mat(0x557a3a));
    m.position.set(x, 0.8 * s, z);
    m.scale.y = 0.75;
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  for (const [x, z, a] of L.hay) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.3, 10), mat(0xd9b95e));
    m.position.set(x, 0.95, z);
    m.rotation.z = Math.PI / 2;
    m.rotation.y = (a * Math.PI) / 180;
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3, 5), trunk);
  lantern.position.set(L.lantern[0], 1.5, L.lantern[1]);
  root.add(lantern);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2, 0.15), trunk);
  sign.position.set(L.signpost[0], 1, L.signpost[1]);
  root.add(sign);

  // Forest ring outside the valley edge: instanced cones.
  const rng = new Rng(4242);
  const spots: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (let i = 0; i < 4000 && spots.length < 420; i++) {
    const x = rng.range(L.world.minX + 4, L.world.maxX - 4);
    const z = rng.range(L.world.minZ + 4, L.world.maxZ - 4);
    if (pointInPolygon(x, z, level.boundary)) continue;
    const d = level.boundaryDistance(x, z);
    if (d < 1.5 || d > 34) continue;
    const s = rng.range(0.8, 1.35);
    spots.push(new THREE.Matrix4().compose(v.set(x, 0, z), q, sc.set(s, s * rng.range(0.9, 1.2), s)));
  }
  const coneGeo = new THREE.ConeGeometry(2.4, 8, 6);
  coneGeo.translate(0, 5, 0);
  const forest = new THREE.InstancedMesh(coneGeo, mat(0x35583c), spots.length);
  spots.forEach((m, i) => forest.setMatrixAt(i, m));
  forest.castShadow = true;
  forest.receiveShadow = true;
  root.add(forest);

  return root;
}
