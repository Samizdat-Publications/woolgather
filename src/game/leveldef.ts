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
}
