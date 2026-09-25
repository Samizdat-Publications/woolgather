"""Terrain: the valley ground, the stream surface and the gameplay heightfield.

Outputs:
  public/assets/terrain.glb         ground mesh, vertex colours, 2 m grid, fixed triangulation
  public/assets/water.glb           stream surface ribbon with flow UVs
  public/assets/terrain_height.bin  int32 nx, int32 nz, float32 minX, minZ, step, then nx*nz float32
                                    heights, index = iz * nx + ix (game coords, +Z south)
  public/assets/terrain_meta.json   water level along the stream, bridge deck height, ford level

Each grid cell is split along the (ix, iz) -> (ix+1, iz+1) diagonal so the game can reproduce the
exact surface. Game point (x, z) is Blender (x, -z).

    blender --background --factory-startup --python blender_scripts/terrain.py [-- --preview]
"""

import json
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wg_lib as W  # noqa: E402

LEVEL = json.load(open(W.LEVEL))
STEP = 2.0
STREAM_HALF = LEVEL["stream"]["halfWidth"]
BED = 1.6  # channel depth below the surrounding ground
WATER_DEPTH = 0.6  # water surface sits this far above the bed


def smoothstep(a, b, v):
    t = max(0.0, min(1.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def seg_dist(px, pz, ax, az, bx, bz):
    abx, abz = bx - ax, bz - az
    l2 = abx * abx + abz * abz
    t = 0.0 if l2 < 1e-9 else max(0.0, min(1.0, ((px - ax) * abx + (pz - az) * abz) / l2))
    cx, cz = ax + abx * t, az + abz * t
    return math.hypot(px - cx, pz - cz), t


def poly_dist(px, pz, pts, closed):
    best = 1e9
    n = len(pts)
    for i in range(n if closed else n - 1):
        a = pts[i]
        b = pts[(i + 1) % n]
        d, _ = seg_dist(px, pz, a[0], a[1], b[0], b[1])
        best = min(best, d)
    return best


def inside(px, pz, poly):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > pz) != (zj > pz) and px < (xj - xi) * (pz - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def fbm(x, z, octaves=3, seed=0.0):
    total, amp, freq = 0.0, 1.0, 1.0
    for _ in range(octaves):
        total += amp * noise.noise(Vector((x * freq, z * freq, seed)))
        amp *= 0.5
        freq *= 2.03
    return total


BOUND = LEVEL["boundary"]
STREAM = LEVEL["stream"]["points"]
PATH = LEVEL["path"]
FOLD = LEVEL["fold"]
FARM = LEVEL["farmhouse"]
BRIDGE = LEVEL["bridge"]
FORD = LEVEL["ford"]


def base_height(x, z):
    """Ground before carving the stream and flattening building pads."""
    h = fbm(x / 38.0, z / 38.0, 3, 1.7) * 1.3
    # West hillside inside the valley, rising towards the western woods.
    h += smoothstep(-42, -96, x) * (4.2 + fbm(x / 20.0, z / 20.0, 2, 5.1) * 0.8)
    # Gentle slope up to the northern grove.
    h += smoothstep(-30, -78, z) * 1.8
    # Hills beyond the valley edge, under the forest.
    if not inside(x, z, BOUND):
        d = poly_dist(x, z, BOUND, True)
        h += smoothstep(0, 28, d) * 6.5 + max(0.0, d - 28) * 0.08 + fbm(x / 16.0, z / 16.0, 2, 9.3) * 1.2 * smoothstep(0, 12, d)
    return h


def rect_falloff(x, z, x0, x1, z0, z1, fade):
    dx = max(x0 - x, 0.0, x - x1)
    dz = max(z0 - z, 0.0, z - z1)
    return 1.0 - smoothstep(0.0, fade, math.hypot(dx, dz))


fcx, fcz = FOLD["center"]
FOLD_RECT = (fcx - FOLD["halfW"] - 4, fcx + FOLD["halfW"] + 3, fcz - FOLD["halfD"] - 3, fcz + FOLD["halfD"] + 3)
FOLD_Y = base_height(fcx, fcz)
hx, hz = FARM["center"]
FARM_RECT = (hx - FARM["halfW"] - 3, hx + FARM["halfW"] + 3, hz - FARM["halfD"] - 3, hz + FARM["halfD"] + 4)
FARM_Y = base_height(hx, hz)
bx, bz = BRIDGE["center"]
BRIDGE_ENDS = [(bx - BRIDGE["length"] / 2, bz), (bx + BRIDGE["length"] / 2, bz)]
BRIDGE_Y = max(base_height(*e) for e in BRIDGE_ENDS)


def stream_query(x, z):
    """Distance to the stream centre line and the centre-line point's parameter along the stream."""
    best, best_s = 1e9, 0.0
    acc = 0.0
    for i in range(len(STREAM) - 1):
        a, b = STREAM[i], STREAM[i + 1]
        d, t = seg_dist(x, z, a[0], a[1], b[0], b[1])
        seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
        if d < best:
            best, best_s = d, acc + t * seg_len
        acc += seg_len
    return best, best_s


def channel_carve(d):
    """How far below the local ground the channel cuts at distance d from the centre line."""
    if d <= STREAM_HALF - 1.2:
        return BED
    if d <= STREAM_HALF:
        return BED - (BED - (BED - WATER_DEPTH)) * (d - (STREAM_HALF - 1.2)) / 1.2
    return (BED - WATER_DEPTH) * (1 - smoothstep(STREAM_HALF, STREAM_HALF + 5.0, d))


def height(x, z):
    h = base_height(x, z)
    # Building pads and bridge approaches are levelled.
    for rect, y, fade in ((FOLD_RECT, FOLD_Y, 7.0), (FARM_RECT, FARM_Y, 7.0)):
        k = rect_falloff(x, z, *rect, fade)
        h = h + (y - h) * k
    for ex, ez in BRIDGE_ENDS:
        k = 1 - smoothstep(2.0, 7.0, math.hypot(x - ex, z - ez))
        h = h + (BRIDGE_Y - h) * k
    d, _ = stream_query(x, z)
    if d < STREAM_HALF + 5.0:
        h -= channel_carve(d)
    # The dirt path is worn a little lower.
    pd = poly_dist(x, z, PATH, False)
    h -= 0.07 * (1 - smoothstep(0.8, 1.6, pd))
    return h


def water_level_at(s_x, s_z):
    """Water surface at a stream centre-line point: local ground there minus the bed plus depth."""
    return base_height(s_x, s_z) - BED + WATER_DEPTH


# ----------------------------------------------------------------------------- colours

GRASS_A = "#6ea34a"
GRASS_B = "#86b656"
GRASS_DRY = "#b1b563"
GRASS_LUSH = "#4f9443"
WORN = "#9aa35a"
HEATHER = "#86697f"
BED_C = "#7b7560"
DIRT = "#b39463"
FOLD_FLOOR = "#a38e5b"
YARD = "#9c8a6c"
FOREST = "#4f6a3a"
FOREST_DEEP = "#3d5430"
ROCKY = "#8b8471"


def lin(h):
    return W.hex_rgba(h)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))


def color(x, z, h):
    n = fbm(x / 22.0, z / 22.0, 2, 3.3)
    c = mix(lin(GRASS_A), lin(GRASS_B), 0.5 + n * 0.8)
    c = mix(c, lin(GRASS_DRY), smoothstep(0.25, 0.7, fbm(x / 45.0, z / 45.0, 2, 8.8)))
    # Highland heather on the western hillside.
    if x < -48:
        heat = smoothstep(-48, -70, x) * smoothstep(-0.05, 0.5, fbm(x / 21.0, z / 21.0, 2, 4.4))
        c = mix(c, lin(HEATHER), heat * 0.7)
    # Around rocks: bare, stony ground.
    for rx, rz, rr in LEVEL["rocks"]:
        dr = math.hypot(x - rx, z - rz)
        if dr < rr + 2.5:
            c = mix(c, lin(ROCKY), (1 - smoothstep(rr * 0.6, rr + 2.5, dr)) * 0.7)
    d, _ = stream_query(x, z)
    if d < STREAM_HALF + 5:
        c = mix(c, lin(GRASS_LUSH), 1 - smoothstep(STREAM_HALF, STREAM_HALF + 5, d))
    if d < STREAM_HALF + 0.3:
        c = mix(c, lin(BED_C), 1 - smoothstep(STREAM_HALF - 0.8, STREAM_HALF + 0.3, d))
    # The dirt path itself is a separate ribbon mesh; the ground under and beside it is just worn.
    pd = poly_dist(x, z, PATH, False)
    c = mix(c, lin(WORN), (1 - smoothstep(1.0, 2.6, pd)) * 0.6)
    if rect_falloff(x, z, fcx - FOLD["halfW"], fcx + FOLD["halfW"], fcz - FOLD["halfD"], fcz + FOLD["halfD"], 1.5) > 0.5:
        c = mix(c, lin(FOLD_FLOOR), 0.8 + fbm(x / 3.0, z / 3.0, 1, 2.0) * 0.2)
    c = mix(c, lin(YARD), rect_falloff(x, z, hx - FARM["halfW"] - 1.5, hx + FARM["halfW"] + 1.5, hz - FARM["halfD"] - 1.5, hz + FARM["halfD"] + 3.5, 2.5) * 0.85)
    if not inside(x, z, BOUND):
        db = poly_dist(x, z, BOUND, True)
        c = mix(c, lin(FOREST), smoothstep(0, 6, db))
        c = mix(c, lin(FOREST_DEEP), smoothstep(10, 30, db))
    return c


# ----------------------------------------------------------------------------- build


def build():
    world = LEVEL["world"]
    min_x, max_x, min_z, max_z = world["minX"], world["maxX"], world["minZ"], world["maxZ"]
    nx = int(round((max_x - min_x) / STEP)) + 1
    nz = int(round((max_z - min_z) / STEP)) + 1
    heights = []
    bm = bmesh.new()
    verts = []
    for iz in range(nz):
        z = min_z + iz * STEP
        row = []
        for ix in range(nx):
            x = min_x + ix * STEP
            h = height(x, z)
            heights.append(h)
            row.append(bm.verts.new((x, -z, h)))
        verts.append(row)
    for iz in range(nz - 1):
        for ix in range(nx - 1):
            v00, v10 = verts[iz][ix], verts[iz][ix + 1]
            v01, v11 = verts[iz + 1][ix], verts[iz + 1][ix + 1]
            # Diagonal v00-v11 (see module docstring). Winding chosen so normals face +Z.
            bm.faces.new((v00, v11, v10))
            bm.faces.new((v00, v01, v11))
    # Shared (smooth) vertices keep the file small; the game renders it faceted with flatShading.
    for f in bm.faces:
        f.smooth = True
    bm.normal_update()
    me = bpy.data.meshes.new("terrain")
    bm.to_mesh(me)
    bm.free()
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(me.vertices):
        x, gz, h = v.co.x, -v.co.y, v.co.z
        col.data[i].color = color(x, gz, h)
    me.color_attributes.active_color = col
    tm = W.mat("terrain", "#ffffff", 1.0)
    # Drive the base colour from the vertex colours so Blender previews match the game.
    nodes = tm.node_tree.nodes
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    tm.node_tree.links.new(attr.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    me.materials.append(tm)
    ob = bpy.data.objects.new("terrain", me)
    bpy.context.scene.collection.objects.link(ob)
    if me.polygons[0].normal.z < 0:
        print("WG_WARN terrain normals point down")

    # Gameplay heightfield.
    path = os.path.join(W.ASSETS, "terrain_height.bin")
    with open(path, "wb") as f:
        f.write(struct.pack("<iifff", nx, nz, min_x, min_z, STEP))
        f.write(struct.pack(f"<{len(heights)}f", *heights))
    print(f"WG_EXPORT terrain_height.bin {os.path.getsize(path)} bytes ({nx}x{nz})")
    return ob


def build_water():
    """Ribbon over the densified stream centre line, slightly wider than the channel."""
    pts = []
    for i in range(len(STREAM) - 1):
        a, b = STREAM[i], STREAM[i + 1]
        seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(seg_len / 2.0))
        for k in range(n):
            t = k / n
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    pts.append(tuple(STREAM[-1]))
    # Smooth the water heights along the stream so the surface never steps.
    levels = [water_level_at(x, z) for x, z in pts]
    for _ in range(6):
        levels = [levels[0]] + [(levels[i - 1] + 2 * levels[i] + levels[i + 1]) / 4 for i in range(1, len(levels) - 1)] + [levels[-1]]
    half = STREAM_HALF + 0.6
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    left, right, dist = [], [], [0.0]
    for i, (x, z) in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        tl = math.hypot(tx, tz) or 1.0
        tx, tz = tx / tl, tz / tl
        px, pz = -tz, tx
        y = levels[i]
        left.append(bm.verts.new((x + px * half, -(z + pz * half), y)))
        right.append(bm.verts.new((x - px * half, -(z - pz * half), y)))
        if i > 0:
            dist.append(dist[-1] + math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]))
    for i in range(len(pts) - 1):
        f = bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
        f.normal_update()  # new bmesh faces do not have a valid normal yet
        if f.normal.z < 0:
            f.normal_flip()
        for loop in f.loops:
            v = loop.vert
            k = i if v in (left[i], right[i]) else i + 1
            loop[uv_layer].uv = (dist[k] / (half * 2), 0.0 if v in (left[i], left[i + 1]) else 1.0)
    me = bpy.data.meshes.new("water")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(W.mat("water", "#4d86b0", 0.1))
    ob = bpy.data.objects.new("water", me)
    bpy.context.scene.collection.objects.link(ob)
    meta = {
        "stream": [[round(x, 3), round(z, 3), round(y, 3)] for (x, z), y in zip(pts, levels)],
        "bridgeDeck": round(BRIDGE_Y + 0.45, 3),
        "foldY": round(FOLD_Y, 3),
        "farmY": round(FARM_Y, 3),
    }
    with open(os.path.join(W.ASSETS, "terrain_meta.json"), "w") as f:
        json.dump(meta, f)
    print("WG_EXPORT terrain_meta.json")
    return ob


def build_path():
    """Dirt track as its own ribbon with ragged edges, draped a few cm over the ground."""
    pts = []
    for i in range(len(PATH) - 1):
        a, b = PATH[i], PATH[i + 1]
        seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(seg_len / 1.0))
        for k in range(n):
            t = k / n
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    pts.append(tuple(PATH[-1]))
    bm = bmesh.new()
    dirt = W.mat("path_dirt", "#b8976a", 1.0)
    dirt_edge = W.mat("path_edge", "#9f8358", 1.0)
    rows = []
    for i, (x, z) in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        tl = math.hypot(tx, tz) or 1.0
        px, pz = -tz / tl, tx / tl
        # Ragged edges: each side wanders independently.
        wl = 1.05 + fbm(x / 3.0, z / 3.0, 2, 11.0) * 0.45
        wr = 1.05 + fbm(x / 3.0, z / 3.0, 2, 17.0) * 0.45
        row = []
        for off in (-wl, -wl * 0.55, 0.0, wr * 0.55, wr):
            vx, vz = x + px * off, z + pz * off
            row.append(bm.verts.new((vx, -vz, height(vx, vz) + 0.05)))
        rows.append(row)
    # No dirt in the stream channel: the track resumes on the far side of the bridge.
    wet = [stream_query(x, z)[0] < STREAM_HALF + 2.5 for x, z in pts]
    for i in range(len(rows) - 1):
        if wet[i] or wet[i + 1]:
            continue
        for j in range(4):
            f = bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
            f.material_index = 1 if j in (0, 3) else 0
            f.smooth = True
    me = bpy.data.meshes.new("path")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(dirt)
    me.materials.append(dirt_edge)
    ob = bpy.data.objects.new("path", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main():
    W.reset()
    ground = build()
    path = build_path()
    W.export_glb("terrain.glb", [ground, path], vertex_colors=True)
    W.reset()
    water = build_water()
    W.export_glb("water.glb", [water], texcoords=True)
    if "--preview" in W.args():
        W.reset()
        ground = build()
        water = build_water()
        W.render_preview("terrain.png", [ground, water], elev=58, azim=0, distance=260, size=1200, target=(0, 0, 0))


main()
