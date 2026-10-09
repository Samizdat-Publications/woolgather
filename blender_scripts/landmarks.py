"""Landmarks: crags, scree, a standing stone, a cairn, a ruined shieling, a stell wall arc, a
jetty and rowing boat, a trial judges' box, a snow pole, a peat hag and cotton grass.

Outputs public/assets/landmarks.glb with one top-level object per prop, named as the game looks
them up. Origins sit at ground contact, centred, except where noted:
  - `stell_arc`: origin at the centre of its ring (radius 6 m to the wall's centre line); the arc
    runs from Blender +X round to +Y (a quarter turn), so four copies at one point rotated by
    0, 90, 180 and 270 degrees close the ring. Leave one out (or turn it short) for the gap.
  - `jetty`: origin at the landward end at ground level; the jetty runs out along Blender -Y
    (the game's +Z) with its deck 0.6 m above the origin.
Stone materials are named `stone_*` or `drystone_*` so the game's moonlight rule for stone
(world.ts) picks them up; `moss`, `heather`, `heather_b`, `heather_green` and `grass_blade` reuse
nature.py's names and colours so the season recolouring applies to them too.

    blender --background --factory-startup --python blender_scripts/landmarks.py [-- --preview]
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wg_lib as W  # noqa: E402

# Crag stone matches nature.py's rocks (#958d7a, #827a69, #a09682) and the dry-stone walls:
# warm, slightly yellow greys (neutral grey went purple under the lilac sunset sky fill).
CRAG = "#908874"
CRAG_DARK = "#7b7363"
CRAG_LIGHT = "#a39a86"
LICHEN = "#9b9a78"
STONES = ["#9c9482", "#8c8474", "#a59c8a", "#827a6a", "#968c78"]  # structures.py dry-stone


def stone_mats():
    return (
        W.mat("stone_crag", CRAG, 0.95),
        W.mat("stone_crag_dark", CRAG_DARK, 0.95),
        W.mat("stone_crag_light", CRAG_LIGHT, 0.95),
        W.mat("stone_crag_lichen", LICHEN, 0.95),
    )


# ----------------------------------------------------------------------------- local helpers


def jit(verts, amount, seed=0, scale=1.0, zk=1.0):
    """Like Part.jitter, but with the vertical displacement scaled by `zk` (flatter tops)."""
    off = Vector((seed * 7.31, seed * 3.17, seed * 5.53))
    for v in verts:
        n = noise.noise_vector(v.co * scale + off) * amount
        v.co += Vector((n.x, n.y, n.z * zk))


def block(p, m, loc, size, rot=(0, 0, 0), cuts=1, amt=0.0, seed=0, scale=0.6, zk=0.5, taper=0.0, rnd=0.0, tops=None, top_nz=0.72):
    """A box subdivided `cuts` times per edge, then shaped in its own frame and jittered: a
    faceted, blocky stone. `taper` narrows the top (0..1), `rnd` pulls the corners in towards an
    ellipsoid (0 = box, 1 = ellipsoid). `tops` = (mat_a, mat_b): faces left facing up (normal z
    above `top_nz`) take one of the two, picked by smooth noise, so ledges read lighter."""
    # New elements are appended at the end of each sequence; take them by index (a set of the
    # old BMVerts did not reliably tell new ones apart, and every block took the last material).
    n0, e0, f0 = len(p.bm.verts), len(p.bm.edges), len(p.bm.faces)
    bmesh.ops.create_cube(p.bm, size=1.0)
    if cuts:
        p.bm.edges.ensure_lookup_table()
        edges = [p.bm.edges[i] for i in range(e0, len(p.bm.edges))]
        bmesh.ops.subdivide_edges(p.bm, edges=edges, cuts=cuts, use_grid_fill=True)
    p.bm.verts.ensure_lookup_table()
    p.bm.faces.ensure_lookup_table()
    vs = [p.bm.verts[i] for i in range(n0, len(p.bm.verts))]
    fs = [p.bm.faces[i] for i in range(f0, len(p.bm.faces))]
    mtx = W.trs(loc, rot, (1, 1, 1))
    for v in vs:
        q = v.co * 2.0  # -1..1 on the unit cube
        d = Vector((q.x * size[0] / 2, q.y * size[1] / 2, q.z * size[2] / 2))
        if rnd:
            d *= 1.0 + rnd * (1.0 / max(q.length, 1.0) - 1.0)
        if taper:
            k = 1.0 - taper * (q.z * 0.5 + 0.5)
            d.x *= k
            d.y *= k
        v.co = mtx @ d
    p._tag(vs, m)
    if amt:
        jit(vs, amt, seed=seed, scale=scale, zk=zk)
    if tops:
        for f in fs:
            f.normal_update()
            if f.normal.z > top_nz:
                c = f.calc_center_median()
                f.material_index = p._mi(tops[0] if noise.noise(c * 0.45 + Vector((seed, 0, 0))) > -0.05 else tops[1])
    return vs


def tris(ob):
    return sum(len(f.vertices) - 2 for f in ob.data.polygons)


# ----------------------------------------------------------------------------- rock landmarks


def crag(name, blocks, mossy, seed, rnd=0.12, taper=0.12):
    """A rock outcrop from big jittered blocks laid in tilted strata. Faces left facing up take
    lichen or a lighter weathered grey, so the ledges catch the light from the high camera;
    moss gathers at the foot."""
    stone, dark, light, lichen = stone_mats()
    moss = W.mat("moss", "#6b7f45")
    pick = {"S": stone, "D": dark, "L": light}
    p = W.Part(name)
    for i, (k, loc, size, rot, cuts) in enumerate(blocks):
        big = max(size)
        block(
            p, pick[k], loc, size, rot, cuts=cuts, amt=0.1 + big * 0.035, seed=seed * 31 + i, scale=0.5, zk=0.4,
            taper=taper, rnd=rnd, tops=(lichen, light),
        )
    for i, (x, y, z, r) in enumerate(mossy):
        v = p.ico(moss, loc=(x, y, z), radius=r, scale=(1.3, 1.0, 0.32), rot=(0, 0, i * 1.3), subdiv=1)
        p.jitter(v, 0.08, seed=seed * 13 + i, scale=1.6)
    return p.finish()


def crag_a():
    """Schist outcrop: strata dipping south (towards the game camera) in broad ledges, rising to
    a blocky summit and a broken scarp on the north-west, fallen blocks round the foot."""
    blocks = [
        # (material, centre, size, rotation, cuts)
        ("D", (0.0, 0.0, 0.4), (9.4, 6.4, 1.4), (0.06, 0.0, 0.05), 3),
        ("S", (-1.2, 0.8, 1.55), (5.6, 4.4, 1.3), (0.14, -0.04, 0.12), 3),
        ("S", (2.7, 0.3, 1.4), (3.4, 4.6, 1.1), (0.12, 0.05, -0.1), 2),
        ("D", (-1.6, 1.3, 2.75), (4.2, 3.4, 1.2), (0.16, -0.06, 0.22), 3),
        ("S", (1.4, 1.7, 2.4), (2.0, 2.4, 1.0), (0.18, 0.08, -0.3), 2),
        ("S", (-2.2, 1.7, 3.75), (2.6, 2.2, 1.0), (0.2, -0.04, 0.35), 2),
        ("D", (-0.8, 2.2, 4.0), (1.0, 1.1, 1.1), (0.25, 0.1, 0.1), 1),
        ("D", (-4.6, -1.4, 0.35), (1.8, 1.5, 1.2), (0.25, 0.15, 0.6), 1),
        ("S", (4.7, 1.7, 0.5), (1.6, 2.0, 1.4), (-0.12, 0.15, -0.4), 1),
        ("S", (1.2, -3.4, 0.15), (1.4, 1.0, 0.6), (0.1, 0.2, 0.9), 1),
        ("L", (-2.4, -3.4, 0.1), (0.9, 0.8, 0.5), (0.2, 0.0, 0.3), 1),
        ("S", (4.4, -1.4, 0.75), (0.8, 2.2, 1.7), (0.0, 0.3, 0.15), 1),
    ]
    mossy = [(-3.2, -3.0, 0.1, 0.9), (3.4, -3.0, 0.1, 0.8), (-4.8, 1.9, 0.1, 0.7), (0.2, -3.3, 0.45, 0.5)]
    return crag("crag_a", blocks, mossy, seed=1, rnd=0.1, taper=0.14)


def crag_b():
    """Granite tor: two stacks of rounded, jointed slabs on a low plinth, with boulders."""
    blocks = [
        ("D", (0.0, 0.0, 0.2), (7.0, 5.2, 0.9), (0.0, 0.0, 0.1), 3),
        ("S", (-1.6, 0.2, 1.1), (3.2, 2.8, 0.95), (0.03, 0.02, 0.2), 2),
        ("L", (-1.4, 0.3, 1.9), (2.7, 2.4, 0.8), (-0.04, 0.05, 0.5), 2),
        ("S", (-1.7, 0.1, 2.6), (2.2, 1.9, 0.75), (0.05, 0.0, 0.1), 2),
        ("D", (-1.5, 0.25, 3.25), (1.6, 1.4, 0.65), (0.08, -0.06, 0.7), 2),
        ("S", (1.8, -0.3, 1.05), (3.0, 3.0, 0.85), (0.0, -0.04, -0.15), 2),
        ("D", (1.9, -0.2, 1.8), (2.4, 2.3, 0.8), (0.04, 0.03, 0.3), 2),
        ("L", (1.7, -0.4, 2.45), (1.7, 1.6, 0.65), (-0.06, 0.02, -0.2), 2),
        ("S", (3.4, 1.9, 0.35), (1.3, 1.1, 0.9), (0.1, 0.0, 0.5), 1),
        ("D", (-3.5, -1.8, 0.25), (1.2, 1.0, 0.7), (0.0, 0.15, 1.1), 1),
        ("S", (0.3, -2.7, 0.2), (1.0, 0.9, 0.6), (0.1, -0.1, 0.4), 1),
    ]
    mossy = [(-2.4, -2.5, 0.08, 0.8), (2.8, -2.4, 0.08, 0.7), (0.2, 2.6, 0.08, 0.8)]
    return crag("crag_b", blocks, mossy, seed=2, rnd=0.4, taper=0.1)


def scree():
    """A fan of angular stones on a low gravel bed: narrow apex at +Y (uphill), 6 m wide at -Y,
    bigger stones at the foot where they roll furthest."""
    stone, dark, light, _ = stone_mats()
    bed = W.mat("stone_scree_bed", "#8a8270", 1.0)
    r = W.rng(41)
    p = W.Part("scree")
    # Gravel bed: a fan-shaped grid, crowned along the middle and feathered to the ground at its
    # edges (an open surface: nothing under it shows from above).
    rows, cols = 8, 6
    grid = []
    for i in range(rows + 1):
        u = i / rows  # 0 at the apex, 1 at the toe
        y = 3.8 - 7.9 * u
        half = 0.55 + 2.5 * u ** 0.9
        row = []
        for j in range(cols + 1):
            v = j / cols * 2 - 1
            edge = i in (0, rows) or j in (0, cols)
            z = -0.03 if edge else 0.04 + 0.16 * (1 - v * v) * math.sin(min(1.0, u * 1.3) * math.pi * 0.5 + 0.3)
            row.append(p.bm.verts.new((v * half, y - (0.3 * (1 - v * v) if i == rows else 0.0), z)))
        grid.append(row)
    for i in range(rows):
        for j in range(cols):
            p.bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    flat = [v for row in grid for v in row]
    jit(flat, 0.08, seed=3, scale=0.9, zk=0.4)
    p._tag(flat, bed)
    mats = (stone, dark, light, stone)
    for i in range(40):
        u = r.random() ** 0.7
        y = 3.5 - 7.5 * u
        half = 0.5 + 2.5 * u
        x = r.uniform(-half, half) * 0.9
        crown = 0.12 * (1 - (x / half) ** 2)
        sz = 0.2 + 0.42 * u * r.uniform(0.6, 1.0) + r.uniform(0, 0.08)
        h = min(0.5, sz * r.uniform(0.45, 0.7))
        v = p.box(
            r.choice(mats),
            loc=(x, y, crown + h * 0.35),
            size=(sz * r.uniform(0.9, 1.4), sz * r.uniform(0.7, 1.1), h),
            rot=(r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), r.uniform(0, math.tau)),
        )
        p.jitter(v, sz * 0.12, seed=100 + i, scale=3.0)
    return p.finish()


def standing_stone():
    """A tall rough menhir, slightly leaning, tapering to a broken top, with lichen patches."""
    stone, dark, light, lichen = stone_mats()
    pale = W.mat("stone_lichen_pale", "#c4bf98", 0.95)
    p = W.Part("standing_stone")
    vs = block(p, stone, (0, 0, 1.42), (1.0, 0.56, 3.44), cuts=3, rnd=0.22, taper=0.3)
    for v in vs:  # a broken top, sloping down towards +X
        if v.co.z > 2.8:
            v.co.z -= 0.42 * (v.co.x / 0.35 + 1.0) * 0.5 * min(1.0, (v.co.z - 2.8) / 0.34)
    jit(vs, 0.12, seed=5, scale=1.3, zk=0.35)

    def face(z):  # half thickness of the broad faces at height z
        return 0.28 * (1 - 0.3 * (z + 0.3) / 3.3)

    # Lichen just proud of the broad faces (both sides), and pale rosettes.
    for i, (x, z, rr, side) in enumerate(((0.12, 0.9, 0.3, -1), (-0.15, 1.9, 0.22, -1), (0.05, 1.5, 0.26, 1), (-0.1, 0.5, 0.2, 1))):
        v = p.ico(lichen, loc=(x, side * face(z), z), radius=rr, scale=(1.2, 0.22, 1.0), subdiv=1)
        p.jitter(v, 0.03, seed=20 + i, scale=3.0)
    for i, (x, z, side) in enumerate(((-0.2, 1.2, -1), (0.2, 2.3, -1), (0.15, 0.8, 1))):
        p.ico(pale, loc=(x, side * face(z), z), radius=0.11, scale=(1.0, 0.3, 1.0), subdiv=0)
    v = p.ico(W.mat("moss", "#6b7f45"), loc=(0, 0, 0.05), radius=0.75, scale=(1.0, 0.75, 0.22), subdiv=1)
    p.jitter(v, 0.06, seed=9, scale=2.0)
    # Lean: about 6 degrees towards Blender -Y, pivoting at the foot.
    bmesh.ops.rotate(p.bm, verts=list(p.bm.verts), cent=(0, 0, 0), matrix=Matrix.Rotation(-0.1, 3, "X"))
    return p.finish()


def cairn():
    """A conical pile of stones, 1.8 m tall on a 2 m base, around a dark core."""
    stone, dark, light, lichen = stone_mats()
    r = W.rng(51)
    p = W.Part("cairn")
    v = p.cyl(dark, loc=(0, 0, 0.8), r1=0.85, r2=0.16, depth=1.6, seg=8)
    p.jitter(v, 0.05, seed=4)
    mats = (stone, light, stone, dark, stone, lichen)
    layers = 7
    for k in range(layers):
        z = 0.14 + k * 0.23
        rad = 0.86 * (1 - k / (layers + 0.4))
        count = max(3, int(round(rad * 10)))
        for i in range(count):
            a = i * math.tau / count + k * 0.5 + r.uniform(-0.15, 0.15)
            sz = 0.4 - k * 0.035
            v = p.box(
                r.choice(mats),
                loc=(math.cos(a) * rad, math.sin(a) * rad, z),
                size=(sz * r.uniform(1.0, 1.35), sz * r.uniform(0.8, 1.0), sz * r.uniform(0.6, 0.75)),
                rot=(r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25), a + r.uniform(-0.3, 0.3)),
            )
            p.jitter(v, 0.04, seed=200 + k * 20 + i, scale=3.5)
    v = p.box(light, loc=(0, 0, 1.68), size=(0.36, 0.3, 0.24), rot=(0.1, -0.08, 0.4))  # cap stone
    p.jitter(v, 0.02, seed=7, scale=4.0)
    return p.finish()


# ----------------------------------------------------------------------------- dry-stone ruins


def ruin_wall(p, a, b, rng, profile, thick=0.62, ch=0.3, skip=0.08):
    """Dry-stone wall from Blender point a to b, course by course, whose top follows
    `profile(t)` (t 0..1 along the wall): a broken wall of uneven height."""
    ax, ay = a
    bx, by = b
    length = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / length, (by - ay) / length
    ang = math.atan2(uy, ux)
    mats = [W.mat(f"drystone_{c}", c, 0.95) for c in STONES]
    c = 0
    while c * ch < 1.8:
        s = -rng.uniform(0, 0.3) if c % 2 else 0.0
        while s < length:
            ln = rng.uniform(0.5, 0.85)
            e = min(length, s + ln)
            mid = max(0.0, (s + e) / 2)
            z = c * ch + ch / 2
            top = profile(mid / length)
            if e - max(s, 0) > 0.15 and z < top and not (c > 0 and rng.random() < skip):
                v = p.box(
                    rng.choice(mats),
                    loc=(ax + ux * mid, ay + uy * mid, z),
                    size=(e - max(s, 0) - 0.04, thick * (1 - c * 0.05) * rng.uniform(0.92, 1.0), ch * rng.uniform(0.9, 1.05)),
                    rot=(rng.uniform(-0.05, 0.05), rng.uniform(-0.06, 0.06), ang + rng.uniform(-0.05, 0.05)),
                )
                p.jitter(v, 0.03, seed=rng.randint(0, 9999), scale=3.0)
            s = e
        c += 1


def shieling():
    """A roofless ruined shieling hut, 5 x 4 m: one gable end still standing, the far end
    tumbled, a doorway in the south wall, fallen stones in the grass around it."""
    rng = W.rng(61)
    p = W.Part("shieling")
    hx, hy, t = 2.5, 2.0, 0.62
    xi, yi = hx - t / 2, hy - t / 2
    wave = lambda t0, a0, a1, dip=0.0: (lambda u: a0 + (a1 - a0) * u - dip * math.sin(u * math.pi))  # noqa: E731
    # North (back) wall, full length, dipping in the middle.
    ruin_wall(p, (-hx, yi), (hx, yi), rng, wave(0, 1.15, 1.3, 0.45))
    # South (front) wall in two pieces either side of the doorway (x 0.35 .. 1.35).
    ruin_wall(p, (-hx, -yi), (0.35, -yi), rng, wave(0, 0.75, 1.05, 0.2))
    ruin_wall(p, (1.35, -yi), (hx, -yi), rng, wave(0, 0.9, 0.7))
    # East gable: the tallest remnant, peaking in the middle.
    ruin_wall(p, (xi, -yi + t / 2), (xi, yi - t / 2), rng, lambda u: 1.25 + 0.4 * math.sin(u * math.pi), skip=0.04)
    # West end: tumbled almost to the footings.
    ruin_wall(p, (-xi, -yi + t / 2), (-xi, yi - t / 2), rng, lambda u: 0.62 + 0.25 * math.sin(u * 5.0), skip=0.2)
    mats = [W.mat(f"drystone_{c}", c, 0.95) for c in STONES]
    # Door jambs: two big upright stones.
    for x in (0.25, 1.45):
        v = p.box(rng.choice(mats), loc=(x, -yi, 0.62), size=(0.3, t * 1.05, 1.24), rot=(0, rng.uniform(-0.04, 0.04), 0))
        p.jitter(v, 0.03, seed=rng.randint(0, 999), scale=3.0)
    # Fallen stones: outside by the tumbled end and the dips, and rubble inside.
    spots = [(-3.2, 0.3), (-3.0, -1.0), (-3.4, 1.2), (-2.9, 2.5), (0.2, 2.8), (-0.6, 2.6), (2.0, -2.9), (3.2, -1.4), (-1.6, -2.7),
             (-1.6, 0.9), (-1.2, -0.6), (1.4, 1.0), (0.5, 0.1)]
    for i, (x, y) in enumerate(spots):
        sz = rng.uniform(0.35, 0.6)
        v = p.box(
            rng.choice(mats),
            loc=(x, y, 0.12),
            size=(sz, sz * rng.uniform(0.6, 0.9), sz * rng.uniform(0.45, 0.6)),
            rot=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, math.tau)),
        )
        p.jitter(v, 0.03, seed=300 + i, scale=3.0)
    return p.finish()


def stell_arc():
    """A quarter of a round sheep stell: a dry-stone wall on a 6 m radius (to the wall's centre
    line), 1.1 m high and 0.6 m thick, from Blender +X round to +Y, origin at the ring's centre."""
    rng = W.rng(71)
    mats = [W.mat(f"drystone_{c}", c, 0.95) for c in STONES]
    p = W.Part("stell_arc")
    R, height, thick = 6.0, 1.1, 0.6
    arc = R * math.pi / 2
    courses = 3
    ch = (height - 0.28) / courses

    def at(s):
        a = s / R
        return math.cos(a) * R, math.sin(a) * R, a + math.pi / 2

    for c in range(courses):
        s = -rng.uniform(0.1, 0.35) if c % 2 else 0.0
        while s < arc:
            e = min(arc, s + rng.uniform(0.5, 0.85))
            s0 = max(0.0, s)
            if e - s0 > 0.15:
                x, y, ang = at((s0 + e) / 2)
                v = p.box(
                    rng.choice(mats),
                    loc=(x, y, c * ch + ch / 2),
                    size=(e - s0 - 0.04, thick * (1 - c * 0.07) * rng.uniform(0.93, 1.0), ch * rng.uniform(0.9, 1.05)),
                    rot=(rng.uniform(-0.04, 0.04), rng.uniform(-0.05, 0.05), ang + rng.uniform(-0.04, 0.04)),
                )
                p.jitter(v, 0.03, seed=rng.randint(0, 9999), scale=3.0)
            s = e
    s = 0.12
    while s < arc - 0.1:  # upright coping stones along the top
        x, y, ang = at(s)
        v = p.box(rng.choice(mats), loc=(x, y, height - 0.15), size=(0.2, thick * 0.72, 0.32), rot=(0, rng.uniform(-0.12, 0.12), ang + rng.uniform(-0.1, 0.1)))
        p.jitter(v, 0.02, seed=rng.randint(0, 9999), scale=4.0)
        s += rng.uniform(0.24, 0.32)
    return p.finish()


# ----------------------------------------------------------------------------- loch side


def jetty():
    """A small timber jetty, 8 m by 2 m, deck 0.6 m up, running out along Blender -Y from its
    landward end (the origin) on a stone footing."""
    r = W.rng(81)
    plank_a = W.mat("jetty_plank", "#8c7457", 0.9)
    plank_b = W.mat("jetty_plank_b", "#7b6449", 0.9)
    post = W.mat("jetty_post", "#4e3d2d", 0.9)
    rope = W.mat("jetty_rope", "#c4ae80", 1.0)
    stones = [W.mat(f"drystone_{c}", c, 0.95) for c in STONES]
    p = W.Part("jetty")
    L, Wd, deck = 8.0, 2.0, 0.6
    y = -0.05
    i = 0
    while y > -L + 0.1:
        w = 0.26
        p.box(plank_a if i % 2 else plank_b, loc=(r.uniform(-0.04, 0.04), y - w / 2, deck - 0.04), size=(Wd + r.uniform(-0.05, 0.08), w - 0.04, 0.08), rot=(0, 0, r.uniform(-0.015, 0.015)))
        y -= w
        i += 1
    for x in (-0.68, 0.68):  # stringers
        p.box(post, loc=(x, -L / 2, deck - 0.17), size=(0.14, L - 0.05, 0.18))
    for k, py in enumerate((-0.45, -2.9, -5.35, -7.8)):
        p.box(post, loc=(0, py, deck - 0.33), size=(Wd + 0.2, 0.16, 0.16))  # bearer
        far = k == 3
        for x in (-0.95, 0.95):
            top = deck + 0.45 if far else deck - 0.06
            bottom = -1.6
            p.cyl(post, loc=(x, py, (top + bottom) / 2), r1=0.11, r2=0.1, depth=top - bottom, seg=6)
    # Stone footing at the landward end, the deck resting on it.
    for k in range(3):
        v = p.box(r.choice(stones), loc=(-0.7 + k * 0.7, -0.35, 0.22), size=(0.72, 0.7, 0.62), rot=(0, 0, r.uniform(-0.08, 0.08)))
        p.jitter(v, 0.03, seed=400 + k, scale=3.0)
    # A coil of rope by the far mooring post.
    for k in range(2):
        p.cyl(rope, loc=(0.55, -7.45, deck + 0.03 + k * 0.05), r1=0.24 - k * 0.04, r2=0.22 - k * 0.04, depth=0.05, seg=8)
    return p.finish()


def rowing_boat():
    """A small clinker-built rowing boat, 4 m long, bow at Blender -Y (the game's +Z), sitting
    on its keel at the origin: painted blue-green strakes stepping out one over the next, a cream
    inside, two thwarts, floorboards and a pair of oars."""
    hull = W.mat("boat_hull", "#4f817b", 0.7)
    hull_b = W.mat("boat_hull_b", "#5a8c85", 0.7)
    inside = W.mat("boat_inside", "#e6dbbf", 0.85)
    wood = W.mat("boat_wood", "#8a6440", 0.85)
    keel_m = W.mat("boat_keel", "#3b3631", 0.8)
    oar_m = W.mat("boat_oar", "#b8925e", 0.85)
    p = W.Part("rowing_boat")
    bm = p.bm
    L = 4.0
    n = 14

    def beam(u):  # half breadth at the gunwale
        if u < 0.55:
            return 0.72 * math.sin(u / 0.55 * math.pi / 2) ** 0.75
        return 0.72 - 0.26 * ((u - 0.55) / 0.45) ** 2

    def gun(u):  # gunwale height (sheer rising to the bow)
        return 0.64 + 0.24 * max(0.0, 1 - u / 0.45) ** 2 + 0.08 * max(0.0, (u - 0.55) / 0.45) ** 2

    def keel(u):  # height of the hull bottom at the centre line (rocker)
        return 0.05 + 0.32 * max(0.0, 1 - u / 0.4) ** 2 + 0.05 * max(0.0, (u - 0.6) / 0.4) ** 2

    def sect(u, s):
        b, g, k = beam(u), gun(u), keel(u)
        a = s * math.pi / 2
        return b * math.sin(a) ** 0.55, k + (g - k) * (1 - math.cos(a))

    def point(u, s, sx, off=0.0):
        """Hull point on side sx (+1/-1), pushed `off` along the outward section normal."""
        x, z = sect(u, s)
        e = 0.01
        x0, z0 = sect(u, max(0.0, s - e))
        x1, z1 = sect(u, min(1.0, s + e))
        tx, tz = x1 - x0, z1 - z0
        ln = math.hypot(tx, tz) or 1.0
        nx, nz = tz / ln, -tx / ln
        f = min(1.0, beam(u) / 0.22)
        return Vector((sx * (x + nx * off * f), -L / 2 + u * L, z + nz * off * f))

    us = [i / n for i in range(n + 1)]
    S = [0.0, 0.32, 0.56, 0.78, 1.0]
    lap = 0.05
    faces_hull, faces_hull_b, faces_in, faces_wood = [], [], [], []

    def strip(rows_a, rows_b, sx, bucket, flip=False):
        for i in range(n):
            q = [rows_a[i], rows_a[i + 1], rows_b[i + 1], rows_b[i]]
            if (sx < 0) != flip:
                q.reverse()
            bucket.append(bm.faces.new(q))

    for sx in (1, -1):
        prev_top = None
        for k in range(4):
            low = [bm.verts.new(point(u, S[k], sx, lap if k else 0.0)) for u in us]
            up = [bm.verts.new(point(u, S[k + 1], sx)) for u in us]
            strip(low, up, sx, faces_hull_b if k % 2 else faces_hull)  # strakes in two shades of the paint
            if prev_top is not None:  # the lap: the lower edge of a strake stands out over the one below
                strip(prev_top, low, sx, faces_hull)
            prev_top = up
        # Inside skin, a plank's thickness in, facing inwards.
        rows = [[bm.verts.new(point(u, s, sx, -0.04)) for u in us] for s in S]
        for k in range(4):
            strip(rows[k], rows[k + 1], sx, faces_in, flip=True)
        strip(rows[4], prev_top, sx, faces_wood, flip=True)  # gunwale capping
    # Transom: a flat U-shaped board closing the stern.
    fine = [i / 8 for i in range(9)]
    ring = [bm.verts.new(point(1.0, s, 1)) for s in reversed(fine)] + [bm.verts.new(point(1.0, s, -1)) for s in fine[1:]]
    faces_hull.append(bm.faces.new(ring))
    for f in faces_hull:
        f.material_index = p._mi(hull)
    for f in faces_in:
        f.material_index = p._mi(inside)
    for f in faces_wood:
        f.material_index = p._mi(wood)
    for f in faces_hull_b:
        f.material_index = p._mi(hull_b)
    for f in faces_hull + faces_hull_b + faces_in + faces_wood:
        f.smooth = False
    # Keel and stem.
    pts = [Vector((0, -L / 2 + u * L, keel(u))) for u in (0.0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0)]
    for a, b in zip(pts, pts[1:]):
        p.limb(keel_m, a, b, 0.05, 0.05, seg=4)
    p.limb(wood, (0, -L / 2, keel(0.0)), (0, -L / 2 - 0.06, gun(0.0) + 0.06), 0.05, 0.045, seg=4)
    # Thwarts, stern seat and floorboards.
    for u in (0.36, 0.64):
        y = -L / 2 + u * L
        z = gun(u) - 0.2
        p.box(wood, loc=(0, y, z), size=(2 * beam(u) - 0.12, 0.24, 0.05))
    u = 0.9
    p.box(wood, loc=(0, -L / 2 + u * L + 0.05, gun(u) - 0.22), size=(2 * beam(u) - 0.14, 0.36, 0.05))
    p.box(wood, loc=(0, -0.05, keel(0.5) + 0.07), size=(0.62, 2.3, 0.04))
    # A pair of oars resting on the thwarts, blades towards the stern.
    for sx in (1, -1):
        z = gun(0.5) - 0.15
        a = Vector((sx * 0.18, -1.15, z))
        b = Vector((sx * 0.32, 1.05, z + 0.02))
        p.limb(oar_m, a, b, 0.035, 0.035, seg=5)
        p.box(oar_m, loc=(sx * 0.34, 1.35, z + 0.02), size=(0.15, 0.6, 0.025), rot=(0, 0, sx * 0.06))
        p.box(hull, loc=(sx * 0.35, 1.55, z + 0.03), size=(0.155, 0.2, 0.027), rot=(0, 0, sx * 0.06))
    bm.normal_update()
    return p.finish()


# ----------------------------------------------------------------------------- trial field + moor


def judges_box():
    """A sheepdog trial judges' box: a small white weatherboarded hut on short legs, green trim,
    open at the front (Blender -Y, towards the game camera) above a counter, a pent roof, and a
    little flag pole flying a saltire."""
    white = W.mat("judges_white", "#ece6d6", 0.9)
    board = W.mat("judges_board", "#d6cfbd", 0.9)
    green = W.mat("judges_green", "#3f6b4a", 0.8)
    roof = W.mat("judges_roof", "#35553d", 0.85)
    leg = W.mat("judges_leg", "#4e3d2d", 0.9)
    blue = W.mat("flag_saltire", "#1f5aa6", 0.8)
    cross = W.mat("flag_white", "#f4f1e8", 0.8)
    gold = W.mat("flag_finial", "#f2b45a", 0.5)
    p = W.Part("judges_box")
    hw, hd, fl = 1.5, 1.25, 0.66
    for x in (-hw + 0.1, 0, hw - 0.1):
        for y in (-hd + 0.1, hd - 0.1):
            p.box(leg, loc=(x, y, fl / 2 - 0.03), size=(0.14, 0.14, fl))
    p.box(green, loc=(0, 0, fl - 0.06), size=(2 * hw + 0.1, 2 * hd + 0.1, 0.12))
    front_z, back_z = fl + 2.25, fl + 1.95  # underside of the pent roof
    p.box(white, loc=(0, hd - 0.04, (fl + back_z) / 2), size=(2 * hw, 0.08, back_z - fl))
    for sx in (1, -1):
        x0, x1 = sx * hw - 0.04, sx * hw + 0.04
        p.prism_x(white, [(-hd, fl), (hd, fl), (hd, back_z), (-hd, front_z)], min(x0, x1), max(x0, x1))
        # Weatherboard lines on the side.
        for k in range(1, 6):
            z = fl + k * 0.36
            p.box(board, loc=(sx * (hw + 0.045), 0, z), size=(0.02, 2 * hd - 0.1, 0.04))
    p.box(white, loc=(0, -hd + 0.04, fl + 0.48), size=(2 * hw, 0.08, 0.96))  # front panel below the opening
    p.box(green, loc=(0, -hd + 0.08, fl + 0.98), size=(2 * hw + 0.12, 0.36, 0.06))  # counter
    for sx in (1, -1):  # green corner posts
        for sy, top in ((-1, front_z), (1, back_z)):
            p.box(green, loc=(sx * (hw - 0.02), sy * (hd - 0.02), (fl + top) / 2), size=(0.12, 0.12, top - fl))
    p.box(green, loc=(0, -hd + 0.02, front_z - 0.08), size=(2 * hw, 0.12, 0.16))  # lintel
    # Pent roof, high at the front, overhanging most at the front.
    slope = math.atan2(front_z - back_z, 2 * hd)
    y0, y1 = -hd - 0.45, hd + 0.15
    yc = (y0 + y1) / 2
    zc = back_z + (front_z - back_z) * (hd - yc) / (2 * hd) + 0.06
    p.box(roof, loc=(0, yc, zc), size=(2 * hw + 0.3, (y1 - y0) / math.cos(slope), 0.1), rot=(-slope, 0, 0))
    # Inside: a bench along the back wall.
    p.box(board, loc=(0, hd - 0.35, fl + 0.45), size=(2 * hw - 0.3, 0.4, 0.06))
    # Steps up at the back.
    for k in range(2):
        p.box(leg, loc=(hw - 0.5, hd + 0.25 + (1 - k) * 0.25, 0.11 + k * 0.22), size=(0.8, 0.26 + k * 0.0, 0.06))
    # Flag pole at the front right corner, saltire flag flying towards +X.
    px, py = hw + 0.12, -hd - 0.1
    p.cyl(cross, loc=(px, py, (0.5 + 4.4) / 2), r1=0.035, r2=0.03, depth=3.9, seg=6)
    p.ico(gold, loc=(px, py, 4.43), radius=0.06, subdiv=1)
    fw, fh, fz = 0.72, 0.46, 4.08
    fx = px + 0.04 + fw / 2
    p.box(blue, loc=(fx, py, fz), size=(fw, 0.02, fh))
    diag = math.hypot(fw, fh) - 0.06
    ang = math.atan2(fh, fw)
    for s in (1, -1):
        p.box(cross, loc=(fx, py, fz), size=(diag, 0.03, 0.075), rot=(0, s * ang, 0))
    return p.finish()


def snow_pole():
    """A thin roadside snow pole, 2.5 m, banded red and white, red at the top."""
    red = W.mat("pole_red", "#c23b30", 0.6)
    white = W.mat("pole_white", "#f1ede4", 0.6)
    p = W.Part("snow_pole")
    bands = 10
    h = 2.5 / bands
    for i in range(bands):
        top = i == bands - 1
        p.cyl(red if (bands - 1 - i) % 2 == 0 else white, loc=(0, 0, i * h + h / 2), r1=0.05, r2=0.045 if top else 0.05, depth=h, seg=6)
    return p.finish()


def peat_hag():
    """An eroded peat hag: dark banked sides under an overhanging mat of moor grass and heather,
    with slumped peat at its foot. 4 x 2.5 m, about 1.2 m high."""
    peat = W.mat("peat", "#4b3729", 1.0)
    peat_dark = W.mat("peat_dark", "#3a2a20", 1.0)
    turf = W.mat("peat_turf", "#77733f", 0.95)
    heather = W.mat("heather", "#a0689e", 0.95)
    heather_b = W.mat("heather_b", "#8a5a8e", 0.95)
    stem = W.mat("heather_green", "#5f6d42")
    p = W.Part("peat_hag")
    # Two banks of peat, the upper one wider at the top (undercut by the weather), under a
    # rounded mat of turf that hangs over the edge.
    block(p, peat_dark, (0, 0, 0.2), (3.4, 2.0, 0.6), cuts=2, amt=0.14, seed=1, scale=0.8, zk=0.4, rnd=0.45, taper=-0.04)
    block(p, peat, (0.05, 0.02, 0.68), (3.6, 2.15, 0.55), cuts=2, amt=0.14, seed=2, scale=0.9, zk=0.4, rnd=0.35, taper=-0.1)
    block(p, turf, (0.05, 0.03, 1.0), (4.0, 2.5, 0.34), cuts=3, amt=0.16, seed=3, scale=0.8, zk=0.9, rnd=0.65)
    r = W.rng(91)
    for i in range(13):
        a = i * 2.4 + r.uniform(-0.3, 0.3)
        x, y = math.cos(a) * r.uniform(0.1, 1.55), math.sin(a) * r.uniform(0.1, 0.85)
        v = p.ico(stem, loc=(x, y, 1.1), radius=0.32, scale=(1.2, 1, 0.38), subdiv=1)
        p.jitter(v, 0.03, seed=40 + i)
        v = p.ico(heather if i % 2 == 0 else heather_b, loc=(x, y, 1.16), radius=0.26, scale=(1.25, 1.05, 0.36), rot=(0, 0, a), subdiv=1)
        p.jitter(v, 0.04, seed=50 + i, scale=3.0)
    # Slumped peat: a low ragged apron all round the foot (separate lumps read as legs).
    block(p, peat_dark, (0.0, 0.0, -0.02), (4.3, 2.75, 0.3), cuts=3, amt=0.18, seed=6, scale=0.9, zk=0.5, rnd=0.7)
    return p.finish()


def cotton_grass():
    """A clump of bog cotton: thin stems with white tufts over a few grass blades, 0.5 m."""
    blade = W.mat("grass_blade", "#98b262")
    stem = W.mat("cotton_stem", "#6f8a45", 0.9)
    # Off-white, not pure white: tiny bright specks bloom into glowing "orbs" in the game's grade.
    tuft = W.mat("cotton_tuft", "#ebe6d8", 0.9)
    r = W.rng(95)
    p = W.Part("cotton_grass")
    for i in range(6):
        a = r.uniform(0, math.tau)
        d = r.uniform(0.02, 0.1)
        h = r.uniform(0.18, 0.28)
        lean = r.uniform(0.06, 0.14)
        p.limb(blade, (math.cos(a) * d, math.sin(a) * d, 0), (math.cos(a) * (d + lean), math.sin(a) * (d + lean), h), 0.025, 0.004, seg=3)
    for i in range(9):
        a = i * 2.4 + r.uniform(-0.3, 0.3)
        d = r.uniform(0.0, 0.08)
        h = r.uniform(0.34, 0.48)
        lean = r.uniform(0.05, 0.16)
        tip = (math.cos(a) * (d + lean), math.sin(a) * (d + lean), h)
        p.limb(stem, (math.cos(a) * d, math.sin(a) * d, 0), tip, 0.009, 0.007, seg=3)
        v = p.ico(tuft, loc=(tip[0], tip[1], h + 0.03), radius=0.04, scale=(1.0, 1.0, 1.5), subdiv=1)
        p.jitter(v, 0.012, seed=70 + i, scale=8.0)
    return p.finish()


# ----------------------------------------------------------------------------- main


def main():
    W.reset()
    objs = [
        crag_a(),
        crag_b(),
        scree(),
        standing_stone(),
        cairn(),
        shieling(),
        stell_arc(),
        jetty(),
        rowing_boat(),
        judges_box(),
        snow_pole(),
        peat_hag(),
        cotton_grass(),
    ]
    bpy.context.view_layer.update()
    for o in objs:
        lo = [min((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for i in range(3)]
        hi = [max((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for i in range(3)]
        print(
            f"WG_PROP {o.name} tris={tris(o)} mats={len(o.data.materials)} "
            f"x={lo[0]:.2f}..{hi[0]:.2f} y={lo[1]:.2f}..{hi[1]:.2f} z={lo[2]:.2f}..{hi[2]:.2f}"
        )
    # Every prop sits at the origin in the file; the game places copies itself.
    W.export_glb("landmarks.glb", objs)
    if "--preview" in W.args():
        out = os.path.join(W.PREVIEWS, "landmarks")
        os.makedirs(out, exist_ok=True)
        # A grass ground plane at z = 0 (preview only) shows the ground contact of every prop.
        g = W.Part("preview_ground")
        g.box(W.mat("preview_grass", "#7f9a55"), loc=(0, 0, -0.05), size=(400, 400, 0.1))
        ground = g.finish()
        for o in objs:
            for other in objs:
                other.hide_render = other is not o
            W.render_preview(f"landmarks/{o.name}.png", [o], elev=34, azim=30, size=640)
        for o in objs:
            o.hide_render = False
        # Contact sheet from the game camera's pitch (about 48 degrees), looking north.
        layout = {
            "crag_a": (-16, 12), "crag_b": (-3, 12), "scree": (8, 12), "shieling": (18, 12),
            "stell_arc": (-21, -4), "jetty": (-7, 4), "rowing_boat": (-2, 0), "judges_box": (5, 0), "peat_hag": (13, 0),
            "standing_stone": (-6, -8), "cairn": (-2, -8), "snow_pole": (2, -8), "cotton_grass": (4, -8),
        }
        for o in objs:
            o.location = (*layout[o.name], 0)
        ground.hide_render = False
        W.render_preview("landmarks/landmarks.png", objs, elev=48, azim=0, size=1400, distance=56)


main()
