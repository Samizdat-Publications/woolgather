import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Sim } from '../game/sim';
import type { MoodValues } from '../render/daycycle';
import type { Assets } from './assets';
import type { Terrain } from './terrain';

// Dog, sheep and wolves from the Blender rigs, synced from the sim. Parts are found by name so
// procedural animation can move them (milestone 3 adds the full motion).

// Characters are drawn larger than life so they read from the herding camera's height.
export const SCALE = { dog: 2.2, sheep: 1.9, wolf: 2.3 };
const RIM_MOON = new THREE.Color(0.62, 0.7, 1.0);

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
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uOutline;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nmvPosition.z -= 0.45;\ngl_Position = projectionMatrix * mvPosition;');
    // Part of the animal for the colour grade (see actors' character shader): keeps its colour.
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = 0.0;');
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

  /** Centre the ring at (x, z) with the given radius, turned by `angle` radians. */
  place(x: number, z: number, radius: number, angle = 0) {
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    for (let i = 0; i < arr.length; i += 3) {
      const bx = this.base[i];
      const bz = this.base[i + 2];
      const wx = x + (bx * c - bz * sn) * radius;
      const wz = z + (bx * sn + bz * c) * radius;
      arr[i] = wx;
      arr[i + 1] = this.terrain.surface(wx, wz) + this.lift;
      arr[i + 2] = wz;
    }
    pos.needsUpdate = true;
  }
}

/**
 * A dashed line drawn on the ground from one point to another (a stalking wolf to the sheep it is
 * after): short quads laid along the line and dropped onto the terrain, marching towards the prey.
 */
export class GroundDash {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly n: number;

  constructor(
    color: THREE.ColorRepresentation,
    private terrain: Terrain,
    dashes = 14,
  ) {
    this.n = dashes;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dashes * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < dashes; i++) idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3);
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Dashes from (ax, az) to (bx, bz), shifted along by `phase` (0..1) so they march. */
  place(ax: number, az: number, bx: number, bz: number, phase: number, width = 0.3) {
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const px = -uz * width * 0.5;
    const pz = ux * width * 0.5;
    const step = len / this.n;
    for (let i = 0; i < this.n; i++) {
      // Leave clear ground at both ends (under the wolf's ring and the sheep).
      let s0 = (i + phase) * step;
      let s1 = s0 + step * 0.5;
      s0 = Math.min(Math.max(s0, 3.4), len - 1.4);
      s1 = Math.min(Math.max(s1, 3.4), len - 1.4);
      const pts = [
        [ax + ux * s0 + px, az + uz * s0 + pz],
        [ax + ux * s0 - px, az + uz * s0 - pz],
        [ax + ux * s1 + px, az + uz * s1 + pz],
        [ax + ux * s1 - px, az + uz * s1 - pz],
      ];
      pts.forEach(([x, z], k) => {
        const o = (i * 4 + k) * 3;
        arr[o] = x;
        arr[o + 1] = this.terrain.surface(x, z) + 0.12;
        arr[o + 2] = z;
      });
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
  private wolves = new Map<number, { rig: Rig; danger: GroundRing; under: GroundRing; glow: THREE.Sprite; dash: GroundDash; mark: GroundRing }>();
  private glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  private marker: GroundRing;
  private zone: GroundRing;
  private zoneUnder: GroundRing;
  private zoneR = 10;
  private zoneA = 0.1;
  private time = 0;
  private eyeMats: THREE.MeshLambertMaterial[] = [];

  constructor(
    private a: Assets,
    private terrain: Terrain,
  ) {
    this.dog = rig(a.collie, SCALE.dog);
    // Two outlines: a thin dark ink line against pale ground, and outside it a friendly sky-blue
    // one (the counterpart of the wolves' ember) that finds him on rose, violet and night ground.
    addOutline(this.dog.root, 0x8fd8ff, 0.06);
    addOutline(this.dog.root, 0x1c2030, 0.032);
    this.root.add(this.dog.root);
    // A chevron in front of Pip, pointing where he faces: it finds him in a crowd and cannot be
    // mistaken for his reach ring.
    this.marker = new GroundRing(a.fx.get('chevron')!, 0xffd27a, terrain, 0.1);
    this.marker.mesh.material.opacity = 0.9;
    this.root.add(this.marker.mesh);
    // Pip's reach: a dashed ring over a faint dark stroke, so it reads on pale and dark ground
    // alike without framing everything like a debug overlay.
    this.zoneUnder = new GroundRing(a.fx.get('thin_ring')!, 0x231c2b, terrain, 0.07);
    this.zone = new GroundRing(a.fx.get('dashed_ring')!, 0xfff4d6, terrain);
    this.root.add(this.zoneUnder.mesh, this.zone.mesh);

    a.wolf.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m && m.name === 'wolf_eyes' && !this.eyeMats.includes(m)) this.eyeMats.push(m);
    });
    // Character materials get two touches in their shader:
    // - White wool, Pip's white coat and the wolves' grey fur take most of the light's colour back
    //   out, so they stay white and grey under the coral sunset and the moon.
    // - A rim light: silhouettes catch the sky, faintly by day and silver by moonlight, so the
    //   animals stand off the ground at dusk and at night.
    const neutral = new Set(['wool', 'coat_white', 'coat_black', 'wolf_grey', 'wolf_light', 'wolf_dark', 'wolf_saddle']);
    const noKeep = { value: 0 };
    for (const proto of [a.sheep, a.collie, a.wolf]) {
      proto.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
        if (!m || !m.isMeshLambertMaterial || m.name === 'wolf_eyes' || this.charMats.includes(m)) return;
        const keep = neutral.has(m.name);
        if (m.name === 'wool' || m.name === 'coat_white') m.emissive.set(m.name === 'wool' ? 0x4c4842 : 0x3a3834);
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uWhiteKeep = keep ? this.whiteKeep : noKeep;
          shader.uniforms.uRim = this.rim;
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWhiteKeep;\nuniform vec3 uRim;').replace(
            '#include <opaque_fragment>',
            `#include <opaque_fragment>
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), uWhiteKeep);
            float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
            gl_FragColor.rgb += uRim * rimF;
            // Alpha 0 marks a character for the colour grade, which leaves most of its own colour
            // alone: cream sheep, grey wolves and a black and white dog against the evening.
            gl_FragColor.a = 0.0;`,
          );
        };
        m.customProgramCacheKey = () => (keep ? 'wg-char-keep' : 'wg-char');
        m.needsUpdate = true;
        this.charMats.push(m);
        if (keep) this.whiteMats.push(m);
      });
    }
    // Outlines make the animals read as characters, not as bushes and rocks: sheep get a dark
    // ink line round the fleece and face, wolves a hot ember line that says danger. Added to the
    // prototypes, so every clone shares them.
    addOutline(a.sheep, 0x2a2230, 0.04, ['body', 'head']);
    addOutline(a.wolf, 0xff6a3d, 0.045);
  }

  private whiteMats: THREE.MeshLambertMaterial[] = [];
  private charMats: THREE.MeshLambertMaterial[] = [];
  /** How much of the light's colour is removed from white wool and coat (0 = none). */
  private whiteKeep = { value: 0.3 };
  /** Rim light colour (times strength) on every character. */
  private rim = { value: new THREE.Color(0, 0, 0) };

  sync(sim: Sim, dt: number, mood: MoodValues, showRings = true) {
    const h = (x: number, z: number) => this.terrain.height(x, z);
    this.time += dt;
    const d = sim.dog;
    const night = mood.night;
    // An orange-gold key light is taken out of white wool (orange sheep read as dirty), but the
    // rose sunset's pink is left on it: sixteen pink-lit sheep are the sunset. By moonlight the
    // fleece may cool a little.
    const k = mood.keyColor;
    const orange = Math.min(1, Math.max(0, (k.g - k.b) / Math.max(0.01, k.r)) * 2.2);
    this.whiteKeep.value = Math.min(0.85, 0.12 + 0.6 * orange * Math.min(1, mood.keyIntensity / 2) + 0.3 * night);
    for (const m of this.whiteMats) m.emissiveIntensity = 1 + 0.4 * night;
    // Rim light: faint and warm by day, rose-pink through the sunset and dusk, silver by moonlight.
    // Pink from the sunset until the sun goes, then the moon's silver.
    const sunset = Math.min(1, Math.max(0, (mood.t - 0.4) / 0.1)) * Math.min(1, Math.max(0, (0.63 - mood.t) / 0.05));
    const gold = 1 - Math.min(1, Math.max(0, (mood.t - 0.3) / 0.15));
    this.rim.value.setRGB(1, 0.7 - 0.12 * sunset, 0.5 + 0.16 * sunset).lerp(RIM_MOON, night).multiplyScalar(0.06 + 0.1 * gold + 0.16 * sunset + 0.45 * night);
    // Gameplay rings belong to play, not to the pause menu or the results card.
    this.zone.mesh.visible = showRings;
    this.zoneUnder.mesh.visible = showRings;
    this.marker.mesh.visible = showRings;


    const dr = this.dog.root;
    dr.position.set(d.x, h(d.x, d.z), d.z);
    dr.rotation.y = d.facing;
    this.marker.place(d.x + Math.sin(d.facing) * 1.9, d.z + Math.cos(d.facing) * 1.9, 0.62, -d.facing);

    this.zoneR += (sim.dogThreatRadius - this.zoneR) * (1 - Math.exp(-8 * dt));
    // The dashes creep round slowly, so the ring reads as Pip's and alive, not as a ground mark.
    this.zone.place(d.x, d.z, this.zoneR, this.time * 0.12);
    this.zoneUnder.place(d.x, d.z, this.zoneR + 0.3);
    this.zone.mesh.material.color.set(d.creeping ? 0x8fd0ff : d.sprinting ? 0xffb07a : 0xfff4d6);
    const reach = this.zoneR + 9;
    const near = sim.sheep.some(
      (s) => s.state !== 'folded' && s.state !== 'lost' && s.state !== 'grabbed' && (s.x - d.x) ** 2 + (s.z - d.z) ** 2 < reach * reach,
    );
    // Always readable (the how-to points at it), stronger with sheep about or while creeping, and
    // at full strength for the first seconds of the day while its label explains it.
    const intro = sim.elapsed < 20 ? 1 : 0;
    const want = Math.max(intro * 0.5, near ? (d.creeping ? 0.5 : 0.38) : 0.22);
    this.zoneA += (want - this.zoneA) * (1 - Math.exp(-5 * dt));
    this.zone.mesh.material.opacity = this.zoneA;
    this.zoneUnder.mesh.material.opacity = this.zoneA * 0.4;

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
      // A snatched sheep hangs crosswise from the wolf's jaws by the scruff, rolled on its side so
      // its dark face and legs show.
      r.root.position.set(s.x, h(s.x, s.z) + (grabbed ? 0.35 : 0), s.z);
      r.root.rotation.set(0, s.facing, grabbed ? 0.6 : 0);
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
        // A toothed red ring that hugs the ground around every hunting wolf, over a dark band: it
        // frames the animal instead of covering it, and the teeth and the dark band still read
        // for players who cannot tell red from green.
        const under = new GroundRing(this.a.fx.get('thick_ring')!, 0x1a1420, this.terrain, 0.09);
        under.mesh.material.opacity = 0.35;
        const danger = new GroundRing(this.a.fx.get('danger_ring')!, 0xff4a30, this.terrain, 0.1);
        // A plain saturated red-orange: strong enough in colour that the grade leaves it alone at
        // every hour (pushing it above white made the tone mapping wash it to salmon).
        // Warm eye-shine that reads from the herding camera once the light goes.
        const glow = new THREE.Sprite(this.glowMat);
        glow.scale.setScalar(0.7);
        glow.position.set(0, 0.1, 0.24); // heads face +Z: the eyes are in front
        (r.head ?? r.root).add(glow);
        // While it stalks: a dashed line to the sheep it is after, and a pulsing ring on that sheep.
        const dash = new GroundDash(0xff4a30, this.terrain);
        const mark = new GroundRing(this.a.fx.get('bark_ring')!, 0xff4a30, this.terrain, 0.1);
        this.root.add(r.root, under.mesh, danger.mesh, dash.mesh, mark.mesh);
        v = { rig: r, danger, under, glow, dash, mark };
        this.wolves.set(w.id, v);
      }
      const y = h(w.x, w.z);
      v.rig.root.position.set(w.x, y, w.z);
      v.rig.root.rotation.y = w.facing;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 7);
      v.danger.mesh.visible = v.under.mesh.visible = w.state !== 'flee';
      if (v.danger.mesh.visible) {
        v.danger.place(w.x, w.z, 3.2 + 0.2 * pulse, this.time * 0.8);
        v.under.place(w.x, w.z, 3.35);
      }
      v.danger.mesh.material.opacity = 0.7 + 0.25 * pulse;
      const prey = w.target;
      const marking = !!prey && (w.state === 'stalk' || w.state === 'charge') && (prey.x - w.x) ** 2 + (prey.z - w.z) ** 2 < 26 * 26;
      v.dash.mesh.visible = v.mark.mesh.visible = marking;
      if (marking && prey) {
        v.dash.place(w.x, w.z, prey.x, prey.z, (this.time * 0.9) % 1);
        v.mark.place(prey.x, prey.z, 1.5 + 0.25 * pulse);
        v.mark.mesh.material.opacity = 0.5 + 0.4 * pulse;
      }
    }
    for (const [id, v] of this.wolves) {
      if (!seen.has(id)) {
        this.root.remove(v.rig.root, v.danger.mesh, v.under.mesh, v.dash.mesh, v.mark.mesh);
        this.wolves.delete(id);
      }
    }
  }

  /** Points the camera should keep clear of trees: Pip first, then every wolf, then nearby sheep. */
  focusPoints(sim: Sim) {
    const d = sim.dog;
    const pts: { x: number; z: number }[] = [{ x: d.x, z: d.z }];
    for (const w of sim.wolves) if (w.state !== 'gone') pts.push({ x: w.x, z: w.z });
    const near = sim.sheep
      .filter((s) => s.state !== 'lost' && s.state !== 'folded' && (s.x - d.x) ** 2 + (s.z - d.z) ** 2 < 32 * 32)
      .sort((a, b) => (a.x - d.x) ** 2 + (a.z - d.z) ** 2 - ((b.x - d.x) ** 2 + (b.z - d.z) ** 2));
    for (const s of near) pts.push({ x: s.x, z: s.z });
    return pts;
  }
}
