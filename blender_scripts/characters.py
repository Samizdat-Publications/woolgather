"""Characters: Pip the collie, the sheep and the wolf.

Outputs public/assets/collie.glb, sheep.glb, wolf.glb. Each is an empty root with rigid parts
(body, head, tail, leg_fl/fr/bl/br, plus ears/eyes where present) whose origins sit on their
joints, so the game animates them procedurally. Forward is -Y (three.js +Z).

    blender --background --factory-startup --python blender_scripts/characters.py [-- --preview]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wg_lib as W  # noqa: E402


def collie():
    black = W.mat("coat_black", "#2a2e3c", 0.85)
    white = W.mat("coat_white", "#f4efe6", 0.9)
    tan = W.mat("coat_tan", "#c9824a", 0.9)
    nose = W.mat("nose", "#121014", 0.5)
    eye = W.mat("eye_brown", "#3a2414", 0.35)
    red = W.mat("bandana_red", "#d6453a", 0.8)

    root = W.empty("collie")

    b = W.Part("body")
    v = b.sphere(black, loc=(0, 0.03, 0.02), scale=(0.24, 0.47, 0.22), seg=10, rings=7)
    b.jitter(v, 0.015, seed=1)
    v = b.ico(white, loc=(0, -0.3, -0.03), radius=0.2, scale=(1.15, 0.95, 1.05))  # chest ruff
    b.jitter(v, 0.02, seed=2)
    b.sphere(white, loc=(0, 0.0, -0.13), scale=(0.16, 0.3, 0.1), seg=8, rings=5)  # belly
    v = b.ico(white, loc=(0, -0.37, 0.13), radius=0.17, scale=(1.2, 0.9, 1.0))  # neck ruff
    b.jitter(v, 0.02, seed=3)
    # White collar right round the neck: a collie's full ruff, readable from above and behind.
    b.cyl(white, loc=(0, -0.3, 0.2), r1=0.25, r2=0.22, depth=0.2, rot=(math.radians(-40), 0, 0), seg=10)
    # A broad white ruff over the shoulders, the collie's mark from above.
    v = b.ico(white, loc=(0, -0.22, 0.2), radius=0.2, scale=(1.25, 0.8, 0.45))
    b.jitter(v, 0.015, seed=6)
    # Red neckerchief: a band round the neck and a point hanging over the chest. Reads from above.
    b.cyl(red, loc=(0, -0.38, 0.16), r1=0.19, r2=0.17, depth=0.07, rot=(math.radians(-35), 0, 0), seg=10)
    b.cyl(red, loc=(0, -0.47, 0.03), r1=0.13, r2=0.0, depth=0.18, rot=(math.radians(200), 0, 0), seg=3)
    body = b.finish(parent=root, pivot=(0, 0, 0.58))

    h = W.Part("head")
    v = h.sphere(black, loc=(0, -0.09, 0.06), scale=(0.165, 0.185, 0.16), seg=9, rings=7)
    h.jitter(v, 0.01, seed=4)
    v = h.ico(white, loc=(0, -0.15, 0.165), radius=0.07, scale=(0.8, 1.9, 0.5))  # broad blaze
    h.limb(white, (0, -0.18, 0.02), (0, -0.37, -0.02), 0.08, 0.052, seg=8)  # muzzle
    h.ico(nose, loc=(0, -0.375, -0.005), radius=0.034)
    catch = W.mat("eye_catchlight", "#ffffff", 0.2)
    for sx in (1, -1):
        h.ico(tan, loc=(0.105 * sx, -0.17, -0.01), radius=0.034, scale=(1, 1.2, 0.85))  # cheeks
        h.ico(tan, loc=(0.07 * sx, -0.2, 0.13), radius=0.026, scale=(1.2, 0.9, 0.5))  # eyebrows
        h.ico(eye, loc=(0.075 * sx, -0.235, 0.085), radius=0.028)
        h.ico(catch, loc=(0.08 * sx, -0.258, 0.095), radius=0.008)
    head = h.finish(parent=body, pivot=(0, -0.42, 0.18))

    # Semi-erect ears with the tips folding forward, like a working collie's.
    for sx, name in ((1, "ear_l"), (-1, "ear_r")):
        e = W.Part(name)
        e.limb(black, (0, 0, 0), (0.025 * sx, 0.0, 0.1), 0.05, 0.022, seg=5)
        e.limb(black, (0.025 * sx, 0.0, 0.1), (0.035 * sx, -0.055, 0.115), 0.022, 0.006, seg=5)
        e.finish(parent=head, pivot=(0.085 * sx, -0.05, 0.17))

    t = W.Part("tail")
    t.limb(black, (0, 0, 0), (0, 0.24, -0.16), 0.065, 0.06, seg=7)
    t.limb(black, (0, 0.24, -0.16), (0, 0.36, -0.28), 0.06, 0.05, seg=7)
    v = t.ico(white, loc=(0, 0.4, -0.32), radius=0.08, scale=(1, 1.6, 1))  # white tip
    t.jitter(v, 0.008, seed=5)
    t.finish(parent=body, pivot=(0, 0.45, 0.06))

    # Dark legs with white socks, so from above Pip is a black dog with a white collar.
    for sx, sy, name in ((1, -1, "leg_fl"), (-1, -1, "leg_fr"), (1, 1, "leg_bl"), (-1, 1, "leg_br")):
        L = W.Part(name)
        L.limb(black, (0, 0, 0.02), (0, 0, -0.3), 0.058, 0.046, seg=6)
        L.limb(white, (0, 0, -0.3), (0, -0.02, -0.46), 0.046, 0.04, seg=6)
        L.ico(white, loc=(0, -0.035, -0.47), radius=0.05, scale=(1, 1.35, 0.6))
        L.finish(parent=body, pivot=(0.11 * sx, 0.3 * sy if sy > 0 else -0.27, -0.06))
    return root


def sheep():
    wool = W.mat("wool", "#f1eadb", 0.95)
    face = W.mat("sheep_face", "#2b2427", 0.8)
    hoof = W.mat("hoof", "#1c1719", 0.7)
    eye = W.mat("sheep_eye", "#e8d49a", 0.4)

    root = W.empty("sheep")
    b = W.Part("body")
    v = b.ico(wool, radius=0.42, scale=(1.0, 1.32, 0.9), subdiv=2)
    b.jitter(v, 0.05, seed=11, scale=4.0)
    for i, (x, y, z, r) in enumerate(
        ((0.27, -0.26, 0.08, 0.25), (-0.27, -0.26, 0.08, 0.25), (0.29, 0.24, 0.04, 0.26), (-0.29, 0.24, 0.04, 0.26), (0, 0.46, 0.1, 0.24), (0, -0.4, 0.14, 0.23), (0, 0.02, 0.22, 0.27), (0.16, 0.0, 0.18, 0.2), (-0.16, 0.0, 0.18, 0.2))
    ):
        v = b.ico(wool, loc=(x, y, z), radius=r, subdiv=1)
        b.jitter(v, 0.035, seed=20 + i, scale=5.0)
    v = b.ico(wool, loc=(0, 0.6, 0.08), radius=0.1)  # tail puff
    b.jitter(v, 0.015, seed=40)
    body = b.finish(parent=root, pivot=(0, 0, 0.62))

    # A big dark face and wide ears stick out past the fleece, so from the herding camera a sheep
    # has a head and never reads as a round bush.
    h = W.Part("head")
    h.sphere(face, loc=(0, -0.15, -0.03), scale=(0.165, 0.25, 0.175), rot=(math.radians(28), 0, 0), seg=8, rings=6)
    v = h.ico(wool, loc=(0, -0.04, 0.13), radius=0.13, scale=(1.1, 1.0, 0.8))  # topknot
    h.jitter(v, 0.015, seed=41)
    for sx in (1, -1):
        h.sphere(face, loc=(0.2 * sx, -0.05, 0.06), scale=(0.16, 0.07, 0.045), rot=(0, 0, math.radians(22 * sx)), seg=6, rings=4)  # ears
        h.ico(eye, loc=(0.1 * sx, -0.25, 0.06), radius=0.026)
    h.finish(parent=body, pivot=(0, -0.54, 0.12))

    for sx, sy, name in ((1, -1, "leg_fl"), (-1, -1, "leg_fr"), (1, 1, "leg_bl"), (-1, 1, "leg_br")):
        L = W.Part(name)
        L.limb(face, (0, 0, 0.05), (0, 0, -0.34), 0.05, 0.042, seg=6)
        L.cyl(hoof, loc=(0, -0.01, -0.37), r1=0.048, r2=0.05, depth=0.06, seg=6)
        L.finish(parent=body, pivot=(0.17 * sx, 0.28 * sy, -0.22))
    return root


def wolf():
    # Built to read from the herding camera, i.e. from above, at 40-60 px: a tawny grey-brown coat
    # with a grizzled saddle and buff (never white) muzzle, cheeks and legs, so it cannot be taken
    # for the black and white collie; big upright ears; a thick brush of a tail in one colour; long
    # legs splayed out from under the body, so four legs show from above; the head carried low.
    # (Earlier versions read as a foal, a dark smudge, a pale tube head-on and a hooded figure.)
    grey = W.mat("wolf_grey", "#6c6257", 0.9)
    light = W.mat("wolf_light", "#b8a488", 0.9)
    dark = W.mat("wolf_dark", "#433c36", 0.85)
    saddle = W.mat("wolf_saddle", "#8c8072", 0.9)
    nose = W.mat("wolf_nose", "#111114", 0.5)
    glow = W.mat("wolf_eyes", "#ffc045", 0.4, emit="#ffb030", emit_strength=4.0)

    root = W.empty("wolf")
    b = W.Part("body")
    v = b.sphere(grey, loc=(0, 0.08, 0.0), scale=(0.36, 0.72, 0.25), seg=10, rings=7)
    b.jitter(v, 0.02, seed=51)
    v = b.ico(dark, loc=(0, -0.38, 0.1), radius=0.36, scale=(1.5, 0.95, 1.0), subdiv=1)  # broad shoulder ruff
    b.jitter(v, 0.045, seed=52, scale=4.0)
    b.sphere(light, loc=(0, 0.02, -0.16), scale=(0.22, 0.54, 0.11), seg=8, rings=5)  # belly
    v = b.ico(light, loc=(0, -0.6, -0.02), radius=0.2, scale=(1.1, 0.8, 1.1))  # chest
    b.jitter(v, 0.02, seed=53)
    v = b.sphere(saddle, loc=(0, 0.14, 0.16), scale=(0.25, 0.52, 0.12), seg=8, rings=5)  # grizzled grey saddle
    b.jitter(v, 0.015, seed=55)
    body = b.finish(parent=root, pivot=(0, 0, 0.62))

    h = W.Part("head")
    v = h.sphere(grey, loc=(0, -0.08, 0.03), scale=(0.22, 0.25, 0.19), seg=8, rings=6)
    h.jitter(v, 0.012, seed=54)
    h.limb(light, (0, -0.17, -0.02), (0, -0.6, -0.07), 0.13, 0.07, seg=7)  # white muzzle
    h.ico(nose, loc=(0, -0.61, -0.05), radius=0.055)
    h.ico(light, loc=(0, -0.22, -0.11), radius=0.1, scale=(1.2, 1.5, 0.7))  # jaw
    for sx in (1, -1):
        # White cheek mask: a pale patch each side of the face, readable from above.
        v = h.ico(light, loc=(0.15 * sx, -0.12, -0.02), radius=0.1, scale=(0.9, 1.3, 0.8))
        h.jitter(v, 0.01, seed=56 + (sx > 0))
    head = h.finish(parent=body, pivot=(0, -0.8, 0.06))

    eyes = W.Part("eyes")
    for sx in (1, -1):
        eyes.ico(glow, loc=(0.09 * sx, -0.22, 0.09), radius=0.038, scale=(1.2, 0.8, 0.8))
    eyes.finish(parent=head, pivot=(0, 0, 0))

    # Big upright pointed ears, a little apart: two clear triangles above the pale mask.
    for sx, name in ((1, "ear_l"), (-1, "ear_r")):
        e = W.Part(name)
        e.cyl(dark, loc=(0, 0, 0.18), r1=0.16, r2=0.01, depth=0.4, seg=4, rot=(0, 0.3 * sx, 0))
        e.finish(parent=head, pivot=(0.12 * sx, -0.01, 0.15))

    # A thick brush of a tail in one colour, hanging low like a skulking wolf's: from behind it
    # drops out of sight instead of pointing at the camera like a column.
    t = W.Part("tail")
    t.limb(grey, (0, 0, 0), (0, 0.3, -0.22), 0.14, 0.2, seg=8)
    t.limb(grey, (0, 0.3, -0.22), (0, 0.46, -0.52), 0.2, 0.14, seg=8)
    v = t.ico(grey, loc=(0, 0.48, -0.58), radius=0.14, scale=(1, 1.1, 1.3))
    t.jitter(v, 0.02, seed=57)
    t.finish(parent=body, pivot=(0, 0.74, 0.1))

    # Legs splayed outwards from under a low body: the feet land clear of the body's outline, so
    # four legs show from above. Pale lower legs catch the light.
    for sx, sy, name in ((1, -1, "leg_fl"), (-1, -1, "leg_fr"), (1, 1, "leg_bl"), (-1, 1, "leg_br")):
        L = W.Part(name)
        L.limb(grey, (0, 0, 0.04), (0.1 * sx, 0, -0.27), 0.085, 0.06, seg=6)
        L.limb(light, (0.1 * sx, 0, -0.27), (0.16 * sx, -0.02, -0.5), 0.06, 0.048, seg=6)
        L.ico(dark, loc=(0.17 * sx, -0.05, -0.51), radius=0.065, scale=(1, 1.35, 0.55))
        L.finish(parent=body, pivot=(0.24 * sx, 0.46 * sy if sy > 0 else -0.42, -0.1))
    return root


def main():
    preview = "--preview" in W.args()
    for name, build in (("collie", collie), ("sheep", sheep), ("wolf", wolf)):
        W.reset()
        root = build()
        W.export_glb(f"{name}.glb", [root])
        if preview:
            W.render_preview(f"{name}.png", [root], elev=24, azim=40)
        if "--topdown" in W.args():
            # As the herding camera sees it (about 48 degrees down), facing 8 ways.
            for i in range(8):
                W.render_preview(f"{name}_td_{i}.png", [root], elev=48, azim=i * 45, size=280)


main()
