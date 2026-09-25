"""Structures: the stone fold (walls, gate leaves, guide fences), farmhouse, bridge and props.

Outputs public/assets/structures.glb. Dimensions come from level/valley.json so the models match
the game's colliders exactly. Coordinates: a game point (x, z) with +Z south is Blender (x, -z).

    blender --background --factory-startup --python blender_scripts/structures.py [-- --preview]
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wg_lib as W  # noqa: E402

LEVEL = json.load(open(W.LEVEL))
# Warm greys with a touch of yellow: neutral grey stone went purple under the lilac sunset sky
# fill and flat blue by moonlight.
STONES = ["#9c9482", "#8c8474", "#a59c8a", "#827a6a", "#968c78"]


def stone_wall(p, a, b, rng, height=1.15, thick=0.85):
    """Dry-stone wall from Blender point a to b (x, y), built course by course."""
    ax, ay = a
    bx, by = b
    length = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / length, (by - ay) / length
    ang = math.atan2(uy, ux)
    mats = [W.mat(f"drystone_{c}", c, 0.95) for c in STONES]
    courses = 3
    ch = (height - 0.3) / courses
    for c in range(courses):
        s = -rng.uniform(0, 0.4) if c % 2 else 0.0
        while s < length:
            ln = rng.uniform(0.45, 0.85)
            e = min(length, s + ln)
            mid = (s + e) / 2
            if e - s > 0.12:
                z = c * ch + ch / 2
                w = thick * (1 - c * 0.08) * rng.uniform(0.92, 1.0)
                v = p.box(
                    rng.choice(mats),
                    loc=(ax + ux * mid, ay + uy * mid, z),
                    size=(e - s - 0.04, w, ch * rng.uniform(0.9, 1.05)),
                    rot=(rng.uniform(-0.04, 0.04), rng.uniform(-0.05, 0.05), ang + rng.uniform(-0.05, 0.05)),
                )
                p.jitter(v, 0.03, seed=rng.randint(0, 9999), scale=3.0)
            s = e
    # Upright coping stones along the top.
    s = 0.0
    while s < length - 0.1:
        mid = s + 0.12
        v = p.box(
            rng.choice(mats),
            loc=(ax + ux * mid, ay + uy * mid, height - 0.15),
            size=(0.2, thick * 0.7, 0.34),
            rot=(0, rng.uniform(-0.12, 0.12), ang + rng.uniform(-0.1, 0.1)),
        )
        p.jitter(v, 0.02, seed=rng.randint(0, 9999), scale=4.0)
        s += rng.uniform(0.22, 0.3)


def fence(p, a, b, rng, post_m, rail_m):
    """Post-and-rail fence from a to b (Blender x, y)."""
    ax, ay = a
    bx, by = b
    length = math.hypot(bx - ax, by - ay)
    n = max(1, round(length / 2.1))
    pts = [(ax + (bx - ax) * i / n, ay + (by - ay) * i / n) for i in range(n + 1)]
    for x, y in pts:
        v = p.cyl(post_m, loc=(x, y, 0.62), r1=0.1, r2=0.085, depth=1.24, seg=6, rot=(0, 0, rng.uniform(0, 1)))
        p.jitter(v, 0.01, seed=rng.randint(0, 9999))
    ang = math.atan2(by - ay, bx - ax)
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        seg_len = math.hypot(x1 - x0, y1 - y0)
        for z in (0.55, 0.98):
            p.box(rail_m, loc=((x0 + x1) / 2, (y0 + y1) / 2, z + rng.uniform(-0.03, 0.03)), size=(seg_len + 0.1, 0.07, 0.13), rot=(0, 0, ang))


def gate_leaf(name, rng, length, dir_sign):
    """A wooden five-bar gate leaf hinged at its origin, closed along Blender +/-Y."""
    wood = W.mat("gate_wood", "#8a6440", 0.85)
    iron = W.mat("gate_iron", "#3a3a40", 0.6)
    p = W.Part(name)
    d = dir_sign
    p.box(wood, loc=(0, 0, 0.62), size=(0.12, 0.12, 1.2))  # hinge stile
    p.box(wood, loc=(0, d * (length - 0.1), 0.62), size=(0.12, 0.12, 1.2))  # latch stile
    for z in (0.3, 0.52, 0.74, 0.96, 1.16):
        p.box(wood, loc=(0, d * (length / 2 - 0.05), z), size=(0.07, length - 0.1, 0.1))
    # Diagonal brace.
    p.limb(wood, (0, d * 0.1, 0.3), (0, d * (length - 0.2), 1.12), 0.045, 0.045, seg=4)
    p.box(iron, loc=(0, d * (length - 0.05), 0.95), size=(0.16, 0.12, 0.06))  # latch
    return p


def fold(rng):
    f = LEVEL["fold"]
    cx, cz = f["center"]
    hw, hd, gw = f["halfW"], f["halfD"], f["gateWidth"] / 2
    root = W.empty("fold")
    walls = W.Part("fold_walls")
    # Blender coords relative to the fold centre: (x, -z).
    N, S = hd, -hd  # north is -z in game = +y in Blender
    stone_wall(walls, (-hw, N), (hw, N), rng)
    stone_wall(walls, (hw, N), (hw, S), rng)
    stone_wall(walls, (hw, S), (-hw, S), rng)
    stone_wall(walls, (-hw, N), (-hw, gw + 0.45), rng)
    stone_wall(walls, (-hw, -gw - 0.45), (-hw, S), rng)
    pillar = W.mat("pillar", "#928a78", 0.95)
    cap = W.mat("pillar_cap", "#aaa08c", 0.95)
    for y in (gw + 0.25, -gw - 0.25):
        v = walls.box(pillar, loc=(-hw, y, 0.75), size=(0.95, 0.75, 1.5))
        walls.jitter(v, 0.02, seed=rng.randint(0, 99))
        walls.box(cap, loc=(-hw, y, 1.56), size=(1.1, 0.9, 0.14))
    # Hay rack and trough inside: an open slatted wooden frame with a mound of hay in it.
    wood = W.mat("rack_wood", "#7a5638", 0.85)
    hay = W.mat("hay_loose", "#c4ae7e", 1.0)
    rx, ry = hw - 1.6, 1.5
    for dx in (-0.42, 0.42):
        for dy in (-1.55, 1.55):
            walls.box(wood, loc=(rx + dx, ry + dy, 0.55), size=(0.12, 0.12, 1.1))
        walls.box(wood, loc=(rx + dx, ry, 1.08), size=(0.1, 3.2, 0.1))
        walls.box(wood, loc=(rx + dx, ry, 0.35), size=(0.1, 3.2, 0.08))
        for k in range(6):
            walls.box(wood, loc=(rx + dx, ry - 1.25 + k * 0.5, 0.72), size=(0.05, 0.06, 0.72), rot=(0.25 if dx > 0 else -0.25, 0, 0))
    walls.box(wood, loc=(rx, ry, 0.3), size=(0.8, 3.1, 0.06))
    v = walls.ico(hay, loc=(rx, ry, 0.72), radius=0.62, scale=(0.62, 2.3, 0.62), subdiv=1)
    walls.jitter(v, 0.08, seed=7, scale=2.5)
    water = W.mat("trough_water", "#5b88ad", 0.2)
    walls.box(wood, loc=(hw - 3.5, -4.6, 0.3), size=(2.2, 0.8, 0.6))
    walls.box(water, loc=(hw - 3.5, -4.6, 0.58), size=(2.0, 0.6, 0.04))
    walls.finish(parent=root)

    # Two gate leaves, hinged on the pillars and closing towards the middle. Exported closed; the
    # game swings them open (and shut again when the player latches the gate).
    leaf = gw - 0.05
    gate_leaf("gate_n", rng, leaf, -1).finish(parent=root, pivot=(-hw, gw, 0))
    gate_leaf("gate_s", rng, leaf, 1).finish(parent=root, pivot=(-hw, -gw, 0))

    # Guide fences (wings) from the gate posts out into the meadow.
    fences = W.Part("fold_fences")
    post = W.mat("fence_post", "#6d4c33", 0.9)
    rail = W.mat("fence_rail", "#8b6843", 0.85)
    for (ax, az), (bx, bz) in f["wings"]:
        fence(fences, (ax - cx, -(az - cz)), (bx - cx, -(bz - cz)), rng, post, rail)
    fences.finish(parent=root)
    return root


def farmhouse(rng):
    fh = LEVEL["farmhouse"]
    hw, hd = fh["halfW"], fh["halfD"]
    white = W.mat("whitewash", "#ece4d4", 0.95)
    plinth = W.mat("house_plinth", "#8d877d", 0.95)
    slate = W.mat("slate", "#4b5160", 0.8)
    ridge = W.mat("slate_ridge", "#3a3f4b", 0.8)
    frame = W.mat("window_frame", "#3f3024", 0.8)
    glass = W.mat("window_glass", "#ffd98a", 0.3, emit="#ffc766", emit_strength=2.0)
    door = W.mat("door_red", "#9a3b2c", 0.7)
    stone = W.mat("chimney_stone", "#8a8276", 0.95)
    root = W.empty("farmhouse")
    p = W.Part("farmhouse_body")
    wall_h = 3.0
    p.box(plinth, loc=(0, 0, 0.2), size=(hw * 2 + 0.2, hd * 2 + 0.2, 0.4))
    p.box(white, loc=(0, 0, wall_h / 2), size=(hw * 2, hd * 2, wall_h))
    # Gable (ridge runs east-west) as a whitewashed prism, with slate slabs laid on top.
    roof_h = 2.7
    p.prism_x(white, [(-hd, wall_h), (hd, wall_h), (0, wall_h + roof_h)], -hw, hw)
    slope = math.atan2(roof_h, hd)
    slab_len = math.hypot(roof_h, hd) + 0.45
    for sy in (1, -1):
        # Each slab falls away from the ridge towards its own eave.
        p.box(
            slate,
            loc=(0, sy * hd / 2, wall_h + roof_h / 2 + 0.14),
            size=(hw * 2 + 0.7, slab_len, 0.2),
            rot=(-sy * slope, 0, 0),
        )
    p.box(ridge, loc=(0, 0, wall_h + roof_h + 0.12), size=(hw * 2 + 0.8, 0.3, 0.22))
    # Chimneys at both gable ends.
    for sx in (1, -1):
        v = p.box(stone, loc=(sx * (hw - 0.4), 0, wall_h + roof_h + 0.2), size=(0.9, 0.9, 1.6))
        p.jitter(v, 0.02, seed=31 + sx)
        p.cyl(frame, loc=(sx * (hw - 0.4), 0, wall_h + roof_h + 1.1), r1=0.14, r2=0.14, depth=0.3, seg=6)
    # South facade (game +z = Blender -y): door and windows. West facade windows too.
    front = -hd - 0.02
    p.box(door, loc=(-1.2, front, 1.05), size=(1.1, 0.12, 2.1))
    p.box(frame, loc=(-1.2, front - 0.02, 2.15), size=(1.35, 0.14, 0.14))
    p.box(plinth, loc=(-1.2, front - 0.45, 0.1), size=(1.6, 0.9, 0.2))  # doorstep
    for x in (-4.3, 1.6, 4.3):
        p.box(frame, loc=(x, front, 1.65), size=(1.25, 0.1, 1.25))
        p.box(glass, loc=(x, front - 0.04, 1.65), size=(1.0, 0.06, 1.0))
        p.box(frame, loc=(x, front - 0.07, 1.65), size=(0.08, 0.06, 1.0))
    for y in (-2.0, 2.0):
        p.box(frame, loc=(-hw - 0.02, y, 1.65), size=(0.1, 1.25, 1.25))
        p.box(glass, loc=(-hw - 0.06, y, 1.65), size=(0.06, 1.0, 1.0))
    # Water butt by the corner.
    barrel = W.mat("barrel", "#6b4a31", 0.85)
    hoop = W.mat("barrel_hoop", "#39383d", 0.6)
    p.cyl(barrel, loc=(hw - 0.6, -hd - 0.7, 0.55), r1=0.45, r2=0.5, depth=1.1, seg=10)
    for z in (0.25, 0.85):
        p.cyl(hoop, loc=(hw - 0.6, -hd - 0.7, z), r1=0.49, r2=0.49, depth=0.06, seg=10)
    p.finish(parent=root)
    return root


def bridge(rng):
    b = LEVEL["bridge"]
    L, Wd = b["length"], b["width"]
    deck_top = 0.55
    plank_a = W.mat("plank_a", "#8a6440", 0.85)
    plank_b = W.mat("plank_b", "#7a5636", 0.85)
    beam = W.mat("beam", "#5a3f2a", 0.9)
    stone = [W.mat(f"drystone_{c}", c, 0.95) for c in STONES]
    root = W.empty("bridge")
    p = W.Part("bridge_body")
    x = -L / 2
    i = 0
    while x < L / 2 - 0.01:
        w = min(0.46, L / 2 - x)
        p.box(plank_a if i % 2 else plank_b, loc=(x + w / 2, rng.uniform(-0.04, 0.04), deck_top - 0.06), size=(w - 0.04, Wd, 0.12), rot=(0, 0, rng.uniform(-0.01, 0.01)))
        x += w
        i += 1
    for y in (-Wd / 2 + 0.4, 0, Wd / 2 - 0.4):
        p.box(beam, loc=(0, y, deck_top - 0.3), size=(L, 0.3, 0.3))
    # Stone abutments at both ends, half buried in the banks.
    for sx in (1, -1):
        for k in range(6):
            v = p.box(rng.choice(stone), loc=(sx * (L / 2 - 0.7), -Wd / 2 + 0.55 + k * (Wd - 1.1) / 5, 0.0), size=(1.5, 1.1, 1.0), rot=(0, 0, rng.uniform(-0.06, 0.06)))
            p.jitter(v, 0.04, seed=rng.randint(0, 999), scale=2.5)
    # Railings with posts.
    posts = 6
    for sy in (1, -1):
        y = sy * (Wd / 2 - 0.08)
        for k in range(posts + 1):
            px = -L / 2 + 0.2 + k * (L - 0.4) / posts
            p.box(beam, loc=(px, y, deck_top + 0.55), size=(0.16, 0.16, 1.1))
        p.box(plank_a, loc=(0, y, deck_top + 1.05), size=(L - 0.2, 0.14, 0.14))
        p.box(plank_b, loc=(0, y, deck_top + 0.55), size=(L - 0.2, 0.1, 0.1))
    p.finish(parent=root)
    return root


def lantern():
    wood = W.mat("post_wood", "#5a3f2a", 0.9)
    iron = W.mat("lantern_iron", "#2f2f35", 0.6)
    glass = W.mat("lantern_glass", "#ffe2a0", 0.3, emit="#ffc766", emit_strength=3.0)
    root = W.empty("lantern")
    p = W.Part("lantern_post")
    p.cyl(wood, loc=(0, 0, 1.4), r1=0.11, r2=0.09, depth=2.8, seg=6)
    p.box(wood, loc=(0.35, 0, 2.7), size=(0.8, 0.1, 0.1))
    p.finish(parent=root)
    g = W.Part("lantern_light")
    g.box(iron, loc=(0, 0, 0.26), size=(0.34, 0.34, 0.06))
    g.box(glass, loc=(0, 0, 0.05), size=(0.26, 0.26, 0.36))
    for sx in (1, -1):
        for sy in (1, -1):
            g.box(iron, loc=(sx * 0.14, sy * 0.14, 0.05), size=(0.04, 0.04, 0.4))
    g.cyl(iron, loc=(0, 0, 0.36), r1=0.2, r2=0.02, depth=0.18, seg=4, rot=(0, 0, math.pi / 4))
    g.finish(parent=root, pivot=(0.68, 0, 2.3))
    return root


def hay_bale():
    # Muted straw rather than saturated gold (the old bales read as orange traffic drums), with
    # rounded shoulders and a spiral of rings on each end.
    hay = W.mat("hay", "#c4ae7e", 1.0)
    band = W.mat("hay_band", "#a8905e", 1.0)
    p = W.Part("hay")
    v = p.cyl(hay, loc=(0, 0, 0.95), r1=0.95, r2=0.95, depth=1.1, rot=(0, math.pi / 2, 0), seg=16)
    p.jitter(v, 0.025, seed=3, scale=3.0)
    for sx in (1, -1):
        v = p.cyl(hay, loc=(sx * 0.6, 0, 0.95), r1=0.88, r2=0.88, depth=0.12, rot=(0, math.pi / 2, 0), seg=16)
        p.jitter(v, 0.02, seed=4 + sx, scale=3.0)
        for k, r in enumerate((0.72, 0.48, 0.24)):
            p.cyl(band if k % 2 == 0 else hay, loc=(sx * (0.665 + k * 0.004), 0, 0.95 + (k - 1) * 0.03), r1=r, r2=r, depth=0.015, rot=(0, math.pi / 2, 0), seg=12)
    return p.finish()


def stepping_stones(rng):
    stone = [W.mat(f"drystone_{c}", c, 0.95) for c in STONES]
    p = W.Part("stepping_stones")
    for i in range(6):
        x = -4.2 + i * 1.7
        v = p.ico(rng.choice(stone), loc=(x, rng.uniform(-0.5, 0.5), 0.05), radius=0.7, scale=(1.0, 0.85, 0.35), subdiv=1)
        p.jitter(v, 0.07, seed=40 + i, scale=2.0)
    return p.finish()


def signpost():
    wood = W.mat("post_wood", "#5a3f2a", 0.9)
    board = W.mat("sign_board", "#b58a5a", 0.85)
    p = W.Part("signpost")
    p.cyl(wood, loc=(0, 0, 1.1), r1=0.09, r2=0.08, depth=2.2, seg=6)
    p.box(board, loc=(0.45, 0, 1.85), size=(0.9, 0.06, 0.26), rot=(0, 0, 0.15))
    p.cyl(board, loc=(0.95, 0.07, 1.85), r1=0.16, r2=0.0, depth=0.06, seg=3, rot=(math.pi / 2, 0, 0.15))
    p.box(board, loc=(-0.42, 0, 1.5), size=(0.84, 0.06, 0.24), rot=(0, 0, -0.5))
    return p.finish()


def field_wall(rng, name, broken=False):
    """A 4 m section of old dry-stone field wall, centred on its origin along X. The game lays
    sections end to end across the hillsides; the broken variant is half fallen, with stones
    tumbled into the grass beside it."""
    p = W.Part(name)
    if broken:
        stone_wall(p, (-2.0, 0), (2.0, 0), rng, height=0.62, thick=0.78)
        mats = [W.mat(f"drystone_{c}", c, 0.95) for c in STONES]
        for i in range(6):
            side = 1 if i % 2 else -1
            v = p.box(
                rng.choice(mats),
                loc=(rng.uniform(-1.8, 1.8), side * rng.uniform(0.6, 1.3), 0.14),
                size=(rng.uniform(0.35, 0.6), rng.uniform(0.3, 0.45), rng.uniform(0.22, 0.3)),
                rot=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, math.tau)),
            )
            p.jitter(v, 0.03, seed=rng.randint(0, 9999), scale=3.0)
    else:
        stone_wall(p, (-2.0, 0), (2.0, 0), rng, height=1.0, thick=0.75)
    return p.finish()


def main():
    W.reset()
    rng = W.rng(2024)
    objs = [
        fold(rng),
        farmhouse(rng),
        bridge(rng),
        lantern(),
        hay_bale(),
        stepping_stones(rng),
        signpost(),
        field_wall(rng, "field_wall"),
        field_wall(rng, "field_wall_broken", broken=True),
    ]
    W.export_glb("structures.glb", objs)
    if "--preview" in W.args():
        layout = [(0, 0), (24, 2), (0, -24), (16, -18), (22, -18), (28, -24), (34, -18)]
        for o, (x, y) in zip(objs, layout):
            o.location = (x, y, 0)
        W.render_preview("structures.png", objs, elev=38, azim=20, distance=62, size=1200)


main()
