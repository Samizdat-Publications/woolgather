import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Loads every Blender export once (characters and props; the ground is generated per level). Materials are converted to flat-shaded Lambert (cheap, and the
// faceted look is the art direction); colours and emissive glow come straight from Blender.

const BASE = `${import.meta.env.BASE_URL}assets/`;

export interface Assets {
  collie: THREE.Object3D;
  sheep: THREE.Object3D;
  wolf: THREE.Object3D;
  nature: Map<string, THREE.Object3D>;
  structures: Map<string, THREE.Object3D>;
  fx: Map<string, THREE.Object3D>;
}

const matCache = new Map<string, THREE.Material>();

/** Swap glTF standard materials for shared flat Lambert ones (one per Blender material name). */
function convertMaterial(m: THREE.Material): THREE.Material {
  const src = m as THREE.MeshStandardMaterial;
  const key = src.name || src.uuid;
  const hit = matCache.get(key);
  if (hit) return hit;
  const out = new THREE.MeshLambertMaterial({
    name: src.name,
    color: src.color.clone(),
    emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0),
    emissiveIntensity: src.emissiveIntensity ?? 1,
    flatShading: true,
    vertexColors: !!src.vertexColors,
    side: src.side,
  });
  matCache.set(key, out);
  return out;
}

function prepare(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convertMaterial) : convertMaterial(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

function childrenByName(scene: THREE.Object3D) {
  const map = new Map<string, THREE.Object3D>();
  for (const c of scene.children) {
    // Props sit at the origin in their file; normalise in case one was exported with an offset.
    c.position.set(0, 0, 0);
    map.set(c.name, c);
  }
  return map;
}

export async function loadAssets(onProgress: (done: number, total: number) => void): Promise<Assets> {
  const loader = new GLTFLoader();
  const files = ['collie', 'sheep', 'wolf', 'nature', 'structures', 'fx'];
  const total = files.length;
  let done = 0;
  const tick = () => onProgress(++done, total);
  const gltfs = await Promise.all(
    files.map(async (f) => {
      const g = await loader.loadAsync(`${BASE}${f}.glb`);
      tick();
      return [f, g.scene] as const;
    }),
  );
  const scenes = Object.fromEntries(gltfs) as Record<string, THREE.Group>;
  for (const s of Object.values(scenes)) prepare(s);

  const pick = (scene: THREE.Group, name: string) => {
    const o = scene.getObjectByName(name);
    if (!o) throw new Error(`asset ${name} missing`);
    return o;
  };
  return {
    collie: pick(scenes.collie, 'collie'),
    sheep: pick(scenes.sheep, 'sheep'),
    wolf: pick(scenes.wolf, 'wolf'),
    nature: childrenByName(scenes.nature),
    structures: childrenByName(scenes.structures),
    fx: childrenByName(scenes.fx),
  };
}

/** First mesh under an object (props are single meshes, possibly nested under an empty). */
export function firstMesh(o: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  o.traverse((c) => {
    if (!found && (c as THREE.Mesh).isMesh) found = c as THREE.Mesh;
  });
  if (!found) throw new Error(`no mesh in ${o.name}`);
  return found;
}
