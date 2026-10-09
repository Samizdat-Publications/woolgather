// The shape of a level file (level/*.json): everything about a place that does not change from one
// evening to the next. Who is in it (the flock, the wolves, the weather) comes from the evening.

export type XZ = [number, number];

export interface PenDef {
  id: string;
  center: XZ;
  /** Rotation in degrees. 0 = the gate faces west (-X), 90 = the gate faces south (+Z). */
  angleDeg: number;
  /** 'fold' takes the whole flock home; 'shed' is the shearing pen for marked sheep only. */
  role: 'fold' | 'shed';
  /** Size relative to the stone fold model (1 = 18 x 13 m inside). */
  scale?: number;
}

export interface StreamDef {
  points: XZ[];
  halfWidth: number;
}

export interface LochDef {
  /** Shoreline, a closed polygon. */
  points: XZ[];
  /** Water surface height. */
  level: number;
}

export interface BridgeDef {
  center: XZ;
  length: number;
  width: number;
  angleDeg: number;
}

export interface FordDef {
  center: XZ;
  radius: number;
}

export interface PlaceDef {
  name: string;
  /** How a banner says it: "in the grove", "by the bridge". */
  phrase: string;
  x: number;
  z: number;
  /** Bridges and fords win over the nearest region when a point is within `r` of them. */
  kind?: 'crossing' | 'region' | 'bank';
  r?: number;
}

export interface ReliefDef {
  /** Rolling floor amplitude (metres). */
  floor: number;
  /** Hills rising beyond the valley edge (metres at 28 m out). */
  rim: number;
  /** Bumps: x, z, height, radius. Negative height makes a hollow. */
  knolls: [number, number, number, number][];
  /** Ramps: the ground rises by `height` from `from` to `to` along an axis. */
  slopes: { axis: 'x' | 'z'; from: number; to: number; height: number }[];
  noiseSeed?: number;
}

export type LandmarkKind = 'crag_a' | 'crag_b' | 'scree' | 'standing_stone' | 'cairn' | 'shieling' | 'stell' | 'jetty' | 'rowing_boat' | 'judges_box' | 'snow_pole' | 'peat_hag' | 'cotton_grass';

/** One landmark: where, turned how far (degrees, as the game's y rotation), and how big. */
export interface LandmarkDef {
  kind: LandmarkKind;
  at: [number, number];
  angle?: number;
  scale?: number;
}

/**
 * What a landmark blocks, in the landmark's own frame (x right, z towards the camera at angle 0):
 * circles [x, z, r], and wall segments for the stell (three quarters of a ring, open on one side).
 */
export function landmarkColliders(l: LandmarkDef) {
  const s = l.scale ?? 1;
  const rot = ((l.angle ?? 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  // three.js rotation about y: x' = x cos + z sin, z' = -x sin + z cos.
  const w = (x: number, z: number): [number, number] => [l.at[0] + (x * c + z * sn) * s, l.at[1] + (-x * sn + z * c) * s];
  const circles: { x: number; z: number; r: number }[] = [];
  const segs: { ax: number; az: number; bx: number; bz: number }[] = [];
  const circ = (x: number, z: number, r: number) => {
    const [px, pz] = w(x, z);
    circles.push({ x: px, z: pz, r: r * s });
  };
  switch (l.kind) {
    case 'crag_a':
      for (const ox of [-3.4, 0, 3.4]) circ(ox, 0, 3.3);
      break;
    case 'crag_b':
      for (const ox of [-1.8, 1.8]) circ(ox, 0, 2.9);
      break;
    case 'standing_stone':
      circ(0, 0, 0.7);
      break;
    case 'cairn':
      circ(0, 0, 1.1);
      break;
    case 'shieling':
      circ(0, 0, 3.1);
      break;
    case 'rowing_boat':
      circ(0, 0, 1.3);
      break;
    case 'judges_box':
      circ(0, 0, 1.9);
      break;
    case 'peat_hag':
      for (const ox of [-1.1, 1.1]) circ(ox, 0, 1.35);
      break;
    case 'stell':
      // Arcs 0..2 of the ring (the fourth quarter is the way in): each quarter runs from local +x
      // round to local -z, turned a further quarter for each arc.
      for (let k = 0; k < 3; k++) {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 3; i++) {
          const t = (i / 3) * (Math.PI / 2);
          const lx = 6 * Math.cos(t);
          const lz = -6 * Math.sin(t);
          const a = (k * Math.PI) / 2;
          pts.push(w(lx * Math.cos(a) + lz * Math.sin(a), -lx * Math.sin(a) + lz * Math.cos(a)));
        }
        for (let i = 0; i < 3; i++) segs.push({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1] });
      }
      break;
  }
  return { circles, segs };
}

export interface LevelDef {
  id: string;
  name: string;
  world: { minX: number; maxX: number; minZ: number; maxZ: number };
  boundary: XZ[];
  dogStart: XZ;
  pens: PenDef[];
  farmhouse?: { center: XZ; halfW: number; halfD: number };
  streams: StreamDef[];
  lochs: LochDef[];
  bridges: BridgeDef[];
  fords: FordDef[];
  paths: XZ[][];
  rocks: [number, number, number][];
  trees: [string, number, number, number][];
  bushes: [number, number, number][];
  hay: [number, number, number][];
  signposts: [number, number, number][];
  fieldWalls: XZ[][];
  /** Where flocks may start; the evening says how many of what go where. */
  sheepGroups: { id: string; center: XZ; radius: number }[];
  wolfDens: XZ[];
  places: PlaceDef[];
  relief: ReliefDef;
  /** Where heather grows: 'rim' (along every slope near the edge) plus optional x/z bands. */
  heather?: { minX?: number; maxX?: number; minZ?: number; maxZ?: number }[];
  /** A sheepdog trial course: gates to drive the flock through in order, and the handler's post. */
  trial?: { gates: { name: string; a: XZ; b: XZ }[]; post: XZ };
  /** The title shot's camera focus and swing for this level. */
  titleShot?: { x: number; z: number; angle: number };
  /**
   * The place's own ground colours over the season's (not in snow), so places differ: a lush
   * machair by the loch, a brown heather moor in the corrie.
   */
  ground?: { grassA?: string; grassB?: string; dry?: string; lush?: string; heatherAmt?: number };
  /** Landmarks the herding camera passes: crags, standing stones, a stell, a jetty (landmarks.glb). */
  landmarks?: LandmarkDef[];
  /**
   * What grows here, as multiples of the usual scatter, so each place has its own ground from the
   * herding camera: flowers (a machair is thick with them), heather, bracken, stones (a rocky
   * pass has them everywhere, not only under the rim), and sand (pale patches near a loch).
   */
  cover?: { flowers?: number; heather?: number; bracken?: number; stones?: number; sand?: number };
}
