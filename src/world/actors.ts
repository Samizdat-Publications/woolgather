import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Level } from '../game/level';
import type { Sim } from '../game/sim';
import type { MoodValues } from '../render/daycycle';
import type { Assets } from './assets';
import type { Terrain } from './terrain';

// Dog, sheep and wolves from the Blender rigs, synced from the sim. Parts are found by name so
// procedural animation can move them (milestone 3 adds the full motion).

// Characters are drawn larger than life so they read from the herding camera's height.
export const SCALE = { dog: 1.85, sheep: 1.42, wolf: 1.5 };

/**
 * Inverted-hull outline: every mesh under `root` (or under the named parts only) gets a
 * back-facing shell pushed out along smooth normals (rebuilt from the flat-shaded mesh so the
 * shell has no cracks), drawn unlit so the characters read against grass in any light.
 */
export function addOutline(root: THREE.Object3D, color: THREE.ColorRepresentation, width: number, parts?: string[]) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uOutline;');
  };
  // Each outline colour/width needs its own compiled program.
  mat.customProgramCacheKey = () => `outline-${width}`;
  const roots = parts ? parts.map((n) => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o) : [root];
  const meshes: THREE.Mesh[] = [];
  for (const r of roots) {
    r.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.outline && !meshes.includes(o as THREE.Mesh)) meshes.push(o as THREE.Mesh);
    });
  }
  for (const m of meshes) {
    const g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    const merged = mergeVertices(g, 1e-3);
    merged.computeVertexNormals();
    const shell = new THREE.Mesh(merged, mat);
    shell.userData.outline = true;
    shell.castShadow = false;
    shell.receiveShadow = false;
    m.add(shell);
  }
}

export interface Rig {
  root: THREE.Object3D;
  body: THREE.Object3D;
  head: THREE.Object3D | null;
  tail: THREE.Object3D | null;
  legs: THREE.Object3D[];
  ears: THREE.Object3D[];
}

export function rig(proto: THREE.Object3D, scale: number): Rig {
  const root = proto.clone(true);
  root.position.set(0, 0, 0);
  root.scale.setScalar(scale);
  const by = (n: string) => root.getObjectByName(n) ?? null;
  return {
    root,
    body: by('body') ?? root,
    head: by('head'),
    tail: by('tail'),
    legs: ['leg_fl', 'leg_fr', 'leg_bl', 'leg_br'].map(by).filter((o): o is THREE.Object3D => !!o),
    ears: ['ear_l', 'ear_r'].map(by).filter((o): o is THREE.Object3D => !!o),
  };
}

/**
 * A ring decal that hugs the ground: the Blender ring mesh's vertices are re-projected onto the
 * terrain every frame, so a 12 m ring on a hillside does not sink into the slope.
 */
export class GroundRing {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private base: Float32Array;

  constructor(
    proto: THREE.Object3D,
    color: THREE.ColorRepresentation,
    private terrain: Terrain,
    private lift = 0.07,
  ) {
    let src: THREE.Mesh | null = null;
    proto.traverse((o) => {
      if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
    });
    const geo = (src as unknown as THREE.Mesh).geometry.clone();
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    this.base = (posAttr.array as Float32Array).slice();
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  place(x: number, z: number, radius: number) {
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const wx = x + this.base[i] * radius;
      const wz = z + this.base[i + 2] * radius;
      arr[i] = wx;
      arr[i + 1] = this.terrain.surface(wx, wz) + this.lift;
      arr[i + 2] = wz;
    }
    pos.needsUpdate = true;
  }
}

/** Soft radial glow texture, drawn once on a canvas (procedural, no image files). */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,220,150,0.85)');
  grad.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Actors {
  readonly root = new THREE.Group();
  readonly dog: Rig;
  private sheep: Rig[] = [];
  private wolves = new Map<number, { rig: Rig; danger: GroundRing; glow: THREE.Sprite }>();
  private glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  private marker: GroundRing;
  private zone: GroundRing;
  private beacon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private zoneR = 10;
  private zoneA = 0.1;
  private time = 0;
  private eyeMats: THREE.MeshLambertMaterial[] = [];

  constructor(
    private a: Assets,
    private terrain: Terrain,
    level: Level,
  ) {
    this.dog = rig(a.collie, SCALE.dog);
    // ~0.1 m in the world: 2-3 px from the herding camera.
    addOutline(this.dog.root, 0xfff1d0, 0.055);
    this.root.add(this.dog.root);
    this.marker = new GroundRing(a.fx.get('bark_ring')!, 0xffd27a, terrain, 0.09);
    this.marker.mesh.material.opacity = 0.85;
    this.root.add(this.marker.mesh);
    this.zone = new GroundRing(a.fx.get('soft_ring')!, 0xfff4d6, terrain);
    this.root.add(this.zone.mesh);

    const f = level.fold;
    const ringProto = a.fx.get('bark_ring')!;
    const ringMesh = findMesh(ringProto);
    this.beacon = new THREE.Mesh(
      ringMesh.geometry,
      new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.beacon.scale.setScalar(3.1);
    this.beacon.position.set(f.minX - 0.5, a.meta.foldY + 0.08, f.cz);
    this.root.add(this.beacon);

    a.wolf.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m && m.name === 'wolf_eyes' && !this.eyeMats.includes(m)) this.eyeMats.push(m);
    });
    // Self-light keeps wool and Pip's white markings near-white under the coral sunset and the
    // moon; it is raised as the light warms or fades (see sync).
    // The wolves' grey coat gets the same treatment so a wolf stays grey instead of turning navy.
    const neutral = ['wool', 'coat_white', 'wolf_grey', 'wolf_light'];
    for (const proto of [a.sheep, a.collie, a.wolf]) {
      proto.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
        if (m && neutral.includes(m.name) && !this.whiteMats.includes(m)) {
          if (m.name === 'wool' || m.name === 'coat_white') m.emissive.set(m.name === 'wool' ? 0x4c4842 : 0x3a3834);
          // Coloured sun and sky light would dye the fleece pink at sunset and lilac at night:
          // most of the tint is taken back out so white stays white.
          m.onBeforeCompile = (shader) => {
            shader.uniforms.uWhiteKeep = this.whiteKeep;
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <common>', '#include <common>\nuniform float uWhiteKeep;')
              .replace(
                '#include <opaque_fragment>',
                '#include <opaque_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), uWhiteKeep);',
              );
          };
          m.customProgramCacheKey = () => 'wg-white';
          m.needsUpdate = true;
          this.whiteMats.push(m);
        }
      });
    }
    // Outlines make the animals read as characters, not as bushes and rocks: sheep get a dark
    // ink line round the fleece and face, wolves a hot ember line that says danger. Added to the
    // prototypes, so every clone shares them.
    addOutline(a.sheep, 0x2a2230, 0.04, ['body', 'head']);
    addOutline(a.wolf, 0xff6a3d, 0.045);
  }

  private whiteMats: THREE.MeshLambertMaterial[] = [];
  /** How much of the light's colour is removed from white wool and coat (0 = none). */
  private whiteKeep = { value: 0.3 };

  sync(sim: Sim, dt: number, gateGlow: boolean, mood: MoodValues, showRings = true) {
    const h = (x: number, z: number) => this.terrain.height(x, z);
    this.time += dt;
    const d = sim.dog;
    const night = mood.night;
    // The warmer (more orange) the key light, the more of its colour is taken out of white wool;
    // by moonlight the fleece may cool a little.
    const warm = 1 - Math.min(1, mood.keyColor.b / Math.max(0.01, mood.keyColor.r));
    this.whiteKeep.value = Math.min(0.85, 0.2 + 0.6 * warm * Math.min(1, mood.keyIntensity / 2) + 0.3 * night);
    for (const m of this.whiteMats) m.emissiveIntensity = 1 + 0.4 * night;
    // Gameplay rings belong to play, not to the pause menu or the results card.
    this.zone.mesh.visible = showRings;
    this.marker.mesh.visible = showRings;

    this.beacon.visible = gateGlow;
    this.beacon.material.opacity = 0.45 + 0.35 * Math.sin(this.time * 4);
    this.beacon.scale.setScalar(3.1 * (1 + 0.08 * Math.sin(this.time * 4)));

    const dr = this.dog.root;
    dr.position.set(d.x, h(d.x, d.z), d.z);
    dr.rotation.y = d.facing;
    this.marker.place(d.x, d.z, 1.05);

    this.zoneR += (sim.dogThreatRadius - this.zoneR) * (1 - Math.exp(-8 * dt));
    this.zone.place(d.x, d.z, this.zoneR);
    this.zone.mesh.material.color.set(d.creeping ? 0x8fd0ff : d.sprinting ? 0xffb07a : 0xfff4d6);
    const reach = this.zoneR + 9;
    const near = sim.sheep.some(
      (s) => s.state !== 'folded' && s.state !== 'lost' && s.state !== 'grabbed' && (s.x - d.x) ** 2 + (s.z - d.z) ** 2 < reach * reach,
    );
    const want = near ? (d.creeping ? 0.42 : 0.26) : 0.06;
    this.zoneA += (want - this.zoneA) * (1 - Math.exp(-5 * dt));
    this.zone.mesh.material.opacity = this.zoneA;

    while (this.sheep.length < sim.sheep.length) {
      const r = rig(this.a.sheep, SCALE.sheep);
      this.sheep.push(r);
      this.root.add(r.root);
    }
    sim.sheep.forEach((s, i) => {
      const r = this.sheep[i];
      r.root.visible = s.state !== 'lost';
      if (!r.root.visible) return;
      const grabbed = s.state === 'grabbed';
      r.root.position.set(s.x, h(s.x, s.z) + (grabbed ? 0.3 : 0), s.z);
      r.root.rotation.set(0, s.facing, grabbed ? 0.5 : 0);
      if (r.head) r.head.rotation.x = s.state === 'graze' ? 0.75 : s.fear > 0.3 ? -0.15 : 0;
    });

    for (const m of this.eyeMats) m.emissiveIntensity = 0.6 + 3.5 * night;
    this.glowMat.opacity = 0.25 + 0.75 * night;

    const seen = new Set<number>();
    for (const w of sim.wolves) {
      if (w.state === 'gone') continue;
      seen.add(w.id);
      let v = this.wolves.get(w.id);
      if (!v) {
        const r = rig(this.a.wolf, SCALE.wolf);
        // A thick, pulsing danger ring that hugs the ground under every hunting wolf.
        const danger = new GroundRing(this.a.fx.get('thick_ring')!, 0xff4a30, this.terrain, 0.1);
        // Warm eye-shine that reads from the herding camera once the light goes.
        const glow = new THREE.Sprite(this.glowMat);
        glow.scale.setScalar(0.7);
        glow.position.set(0, 0.1, 0.24); // heads face +Z: the eyes are in front
        (r.head ?? r.root).add(glow);
        this.root.add(r.root, danger.mesh);
        v = { rig: r, danger, glow };
        this.wolves.set(w.id, v);
      }
      const y = h(w.x, w.z);
      v.rig.root.position.set(w.x, y, w.z);
      v.rig.root.rotation.y = w.facing;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 7);
      v.danger.mesh.visible = w.state !== 'flee';
      if (v.danger.mesh.visible) v.danger.place(w.x, w.z, 2 + 0.25 * pulse);
      v.danger.mesh.material.opacity = 0.55 + 0.35 * pulse;
    }
    for (const [id, v] of this.wolves) {
      if (!seen.has(id)) {
        this.root.remove(v.rig.root, v.danger.mesh);
        this.wolves.delete(id);
      }
    }
  }

  /** Points the camera should keep clear of trees: Pip, nearby sheep and every wolf. */
  focusPoints(sim: Sim) {
    const d = sim.dog;
    const pts: { x: number; z: number }[] = [{ x: d.x, z: d.z }];
    for (const s of sim.sheep) {
      if (s.state === 'lost' || s.state === 'folded') continue;
      if ((s.x - d.x) ** 2 + (s.z - d.z) ** 2 < 32 * 32) pts.push({ x: s.x, z: s.z });
    }
    for (const w of sim.wolves) if (w.state !== 'gone') pts.push({ x: w.x, z: w.z });
    return pts;
  }
}

function findMesh(o: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  o.traverse((c) => {
    if (!found && (c as THREE.Mesh).isMesh) found = c as THREE.Mesh;
  });
  return found as unknown as THREE.Mesh;
}
