"""Nature props: trees, bushes, rocks, grass, flowers, reeds, logs.

Outputs public/assets/nature.glb with one top-level object per prop, named as the game looks
them up. Origins sit at ground contact. Trees are kept moderate in height so they frame the
top-down view instead of walling it off.

    blender --background --factory-startup --python blender_scripts/nature.py [-- --preview]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wg_lib as W  # noqa: E402


def pine(name, tiers, height, seed, needle="#2f5b3c", needle2="#3b6c46"):
    bark = W.mat("bark_pine", "#5a3f2c")
    m1 = W.mat(f"needles_{needle}", needle)
    m2 = W.mat(f"needles_{needle2}", needle2)
    r = W.rng(seed)
    p = W.Part(name)
    p.cyl(bark, loc=(0, 0, 0.7), r1=0.24, r2=0.15, depth=1.4, seg=7)
    base = 1.1
    step = (height - base - 0.6) / tiers
    for i in range(tiers):
        k = 1 - i / tiers
        rad = 0.55 + 1.25 * k
        z = base + i * step
        v = p.cyl(m1 if i % 2 == 0 else m2, loc=(0, 0, z + step * 0.9), r1=rad, r2=0.05, depth=step * 1.9, seg=7, rot=(0, 0, r.uniform(0, 1)))
        p.jitter(v, 0.12, seed=seed * 10 + i, scale=1.2)
    return p.finish()


def oak(name, seed):
    bark = W.mat("bark_oak", "#5b4130")
    leaf1 = W.mat("leaf_oak_a", "#5c8a3a")
    leaf2 = W.mat("leaf_oak_b", "#6f9c46")
    r = W.rng(seed)
    p = W.Part(name)
    p.cyl(bark, loc=(0, 0, 1.1), r1=0.34, r2=0.24, depth=2.2, seg=7)
    p.limb(bark, (0, 0, 1.9), (0.9, 0.3, 2.9), 0.16, 0.08, seg=5)
    p.limb(bark, (0, 0, 2.0), (-0.7, -0.5, 3.0), 0.15, 0.07, seg=5)
    for i, (x, y, z, rad) in enumerate(((0, 0, 3.6, 1.7), (1.1, 0.4, 3.2, 1.2), (-1.0, -0.5, 3.3, 1.25), (0.3, -1.0, 3.1, 1.1), (-0.4, 0.9, 3.4, 1.15), (0.2, 0.2, 4.5, 1.1))):
        v = p.ico(leaf1 if i % 2 == 0 else leaf2, loc=(x, y, z), radius=rad * r.uniform(0.92, 1.08), subdiv=1)
        p.jitter(v, 0.18, seed=seed * 10 + i, scale=0.9)
    return p.finish()


def birch(name, seed):
    bark = W.mat("bark_birch", "#ebe6da")
    mark = W.mat("bark_birch_mark", "#2c2a2a")
    leaf = W.mat("leaf_birch", "#a9bf4f")
    leaf2 = W.mat("leaf_birch_b", "#94b048")
    r = W.rng(seed)
    p = W.Part(name)
    p.cyl(bark, loc=(0, 0, 2.3), r1=0.2, r2=0.12, depth=4.6, seg=6)
    for i in range(7):
        z = 0.5 + i * 0.6 + r.uniform(-0.1, 0.1)
        a = r.uniform(0, math.tau)
        rr = 0.2 - z * 0.017
        p.box(mark, loc=(math.cos(a) * rr, math.sin(a) * rr, z), size=(0.12, 0.05, 0.05), rot=(0, 0, a + math.pi / 2))
    for i, (x, y, z, rad) in enumerate(((0, 0, 4.6, 1.0), (0.5, 0.2, 4.0, 0.75), (-0.45, -0.25, 4.2, 0.75), (0.1, -0.4, 5.2, 0.6))):
        v = p.ico(leaf if i % 2 == 0 else leaf2, loc=(x, y, z), radius=rad, scale=(1, 1, 1.25), subdiv=1)
        p.jitter(v, 0.1, seed=seed * 10 + i, scale=1.3)
    return p.finish()


def bush(name, seed, color="#4f7a36"):
    leaf = W.mat(f"bush_{color}", color)
    leaf2 = W.mat("bush_dark", "#436a2f")
    berry = W.mat("berry", "#c9463d", 0.6)
    r = W.rng(seed)
    p = W.Part(name)
    for i in range(4):
        a = i * 1.7
        v = p.ico(leaf if i % 2 == 0 else leaf2, loc=(math.cos(a) * 0.45, math.sin(a) * 0.4, 0.55 + r.uniform(-0.1, 0.15)), radius=r.uniform(0.6, 0.85), scale=(1, 1, 0.8), subdiv=1)
        p.jitter(v, 0.08, seed=seed * 10 + i, scale=1.8)
    for i in range(5):
        a = r.uniform(0, math.tau)
        p.ico(berry, loc=(math.cos(a) * 0.75, math.sin(a) * 0.7, r.uniform(0.5, 0.95)), radius=0.06, subdiv=0)
    return p.finish()


def rock(name, seed, color, size=(1.0, 0.85, 0.6), moss=True):
    stone = W.mat(f"stone_{color}", color, 0.95)
    moss_m = W.mat("moss", "#6b7f45")
    p = W.Part(name)
    v = p.ico(stone, loc=(0, 0, size[2] * 0.55), radius=1.0, scale=size, subdiv=2)
    p.jitter(v, 0.22, seed=seed, scale=1.4)
    if moss:
        # A mossy cap just proud of the top surface.
        v = p.ico(moss_m, loc=(0.08, 0.05, size[2] * 1.38), radius=0.5, scale=(size[0] * 0.85, size[1] * 0.85, 0.22), subdiv=1)
        p.jitter(v, 0.06, seed=seed + 1, scale=2.0)
    return p.finish()


def grass(name, seed):
    blade = W.mat("grass_blade", "#86a64a")
    blade2 = W.mat("grass_blade_b", "#9ab556")
    r = W.rng(seed)
    p = W.Part(name)
    for i in range(7):
        a = r.uniform(0, math.tau)
        d = r.uniform(0.02, 0.16)
        h = r.uniform(0.3, 0.55)
        lean = r.uniform(0.05, 0.2)
        base = (math.cos(a) * d, math.sin(a) * d, 0)
        tip = (math.cos(a) * (d + lean), math.sin(a) * (d + lean), h)
        p.limb(blade if i % 2 else blade2, base, tip, 0.035, 0.004, seg=3)
    return p.finish()


def flower(name, petal_hex, seed):
    stem = W.mat("flower_stem", "#5f8a3a")
    petal = W.mat(f"petal_{petal_hex}", petal_hex, 0.7)
    heart = W.mat("flower_heart", "#f0b43c", 0.7)
    r = W.rng(seed)
    p = W.Part(name)
    for i in range(3):
        a = r.uniform(0, math.tau)
        d = r.uniform(0.05, 0.18)
        h = r.uniform(0.28, 0.42)
        x, y = math.cos(a) * d, math.sin(a) * d
        p.limb(stem, (x * 0.3, y * 0.3, 0), (x, y, h), 0.012, 0.01, seg=3)
        p.cyl(petal, loc=(x, y, h + 0.01), r1=0.075, r2=0.03, depth=0.04, seg=5)
        p.ico(heart, loc=(x, y, h + 0.035), radius=0.025, subdiv=0)
    return p.finish()


def heather(name, seed):
    # Muted, low clumps: heather should tint the hillside, not dot it with purple berries.
    purple = W.mat("heather", "#94708f", 0.95)
    stem = W.mat("heather_green", "#5f6d42")
    p = W.Part(name)
    for i in range(3):
        a = i * 2.1
        v = p.ico(stem, loc=(math.cos(a) * 0.2, math.sin(a) * 0.2, 0.08), radius=0.22, scale=(1, 1, 0.45), subdiv=1)
        p.jitter(v, 0.03, seed=seed + i)
        v = p.ico(purple, loc=(math.cos(a) * 0.2, math.sin(a) * 0.2, 0.16), radius=0.17, scale=(1.1, 1.1, 0.45), subdiv=1)
        p.jitter(v, 0.035, seed=seed + 10 + i, scale=3.0)
    return p.finish()


def reeds(name, seed):
    green = W.mat("reed", "#6f8f45")
    head = W.mat("reed_head", "#6b4a2e")
    r = W.rng(seed)
    p = W.Part(name)
    for i in range(8):
        a = r.uniform(0, math.tau)
        d = r.uniform(0.02, 0.3)
        h = r.uniform(0.8, 1.4)
        x, y = math.cos(a) * d, math.sin(a) * d
        tip = (x + r.uniform(-0.1, 0.1), y + r.uniform(-0.1, 0.1), h)
        p.limb(green, (x, y, 0), tip, 0.02, 0.006, seg=3)
        if i % 3 == 0:
            p.cyl(head, loc=(tip[0], tip[1], h - 0.12), r1=0.035, r2=0.035, depth=0.18, seg=5)
    return p.finish()


def log(name):
    bark = W.mat("bark_oak", "#5b4130")
    wood = W.mat("wood_end", "#c9a26b")
    p = W.Part(name)
    p.cyl(bark, loc=(0, 0, 0.32), r1=0.32, r2=0.3, depth=2.6, rot=(0, math.pi / 2, 0), seg=8)
    for sx in (1, -1):
        p.cyl(wood, loc=(1.305 * sx, 0, 0.32), r1=0.27, r2=0.27, depth=0.02, rot=(0, math.pi / 2, 0), seg=8)
    return p.finish()


def stump(name):
    bark = W.mat("bark_oak", "#5b4130")
    wood = W.mat("wood_end", "#c9a26b")
    p = W.Part(name)
    p.cyl(bark, loc=(0, 0, 0.3), r1=0.45, r2=0.38, depth=0.6, seg=8)
    p.cyl(wood, loc=(0, 0, 0.605), r1=0.36, r2=0.36, depth=0.02, seg=8)
    for i in range(4):
        a = i * math.pi / 2 + 0.4
        p.limb(bark, (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.12), (math.cos(a) * 0.62, math.sin(a) * 0.62, 0.0), 0.12, 0.05, seg=5)
    return p.finish()


def main():
    W.reset()
    objs = [
        pine("pine_a", 4, 5.6, 1),
        pine("pine_b", 5, 6.6, 2, needle="#2b5236", needle2="#35613f"),
        oak("oak", 3),
        birch("birch", 4),
        bush("bush_a", 5),
        bush("bush_b", 6, color="#5a8540"),
        # Warm, slightly yellow greys: neutral grey went purple under the lilac sunset sky fill.
        rock("rock_a", 7, "#958d7a", (1.0, 0.85, 0.62)),
        rock("rock_b", 8, "#827a69", (1.0, 0.7, 0.5), moss=False),
        rock("rock_c", 9, "#a09682", (0.8, 0.9, 0.75)),
        grass("grass_a", 10),
        grass("grass_b", 11),
        flower("flower_white", "#f5f2e8", 12),
        flower("flower_yellow", "#f2c84b", 13),
        heather("heather", 14),
        reeds("reeds", 15),
        log("log"),
        stump("stump"),
    ]
    # Every prop sits at the origin in the file; the game places copies itself.
    W.export_glb("nature.glb", objs)
    if "--preview" in W.args():
        # Lay them out on a grid only for the preview render.
        cols = 6
        for i, o in enumerate(objs):
            o.location.x = (i % cols) * 6.0
            o.location.y = (i // cols) * 7.0
        W.render_preview("nature.png", objs, elev=32, azim=0, distance=46, size=1200)


main()
