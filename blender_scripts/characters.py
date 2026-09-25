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
    black = W.mat("coat_black", "#433c4b", 0.85)
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
    b.cyl(white, loc=(0, -0.33, 0.2), r1=0.2, r2=0.17, depth=0.12, rot=(math.radians(-40), 0, 0), seg=10)
    # White stripe down the back of the neck and a white tail base spot break up the dark back.
    v = b.ico(white, loc=(0, -0.2, 0.2), radius=0.07, scale=(0.9, 1.8, 0.5))
    b.jitter(v, 0.01, seed=6)
    # Red neckerchief: a band round the neck and a point hanging over the chest. Reads from above.
    b.cyl(red, loc=(0, -0.38, 0.16), r1=0.19, r2=0.17, depth=0.07, rot=(math.radians(-35), 0, 0), seg=10)
    b.cyl(red, loc=(0, -0.47, 0.03), r1=0.13, r2=0.0, depth=0.18, rot=(math.radians(200), 0, 0), seg=3)
    body = b.finish(parent=root, pivot=(0, 0, 0.58))

    h = W.Part("head")
    v = h.sphere(black, loc=(0, -0.09, 0.06), scale=(0.165, 0.185, 0.16), seg=9, rings=7)
    h.jitter(v, 0.01, seed=4)
    v = h.ico(white, loc=(0, -0.17, 0.155), radius=0.05, scale=(0.55, 1.7, 0.45))  # blaze
    h.limb(white, (0, -0.18, 0.02), (0, -0.37, -0.02), 0.08, 0.052, seg=8)  # muzzle
    h.ico(nose, loc=(0, -0.375, -0.005), radius=0.034)
    catch = W.mat("eye_catchlight", "#ffffff", 0.2)
    for sx in (1, -1):
        h.ico(tan, loc=(0.105 * sx, -0.17, -0.01), radius=0.034, scale=(1, 1.2, 0.85))  # cheeks
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
    v = t.ico(white, loc=(0, 0.41, -0.33), radius=0.06, scale=(1, 1.3, 1))  # white tip
    t.jitter(v, 0.008, seed=5)
    t.finish(parent=body, pivot=(0, 0.45, 0.06))

    for sx, sy, name, upper in ((1, -1, "leg_fl", white), (-1, -1, "leg_fr", white), (1, 1, "leg_bl", black), (-1, 1, "leg_br", black)):
        L = W.Part(name)
        L.limb(upper, (0, 0, 0.02), (0, 0, -0.26), 0.058, 0.046, seg=6)
        L.limb(white, (0, 0, -0.26), (0, -0.02, -0.46), 0.046, 0.04, seg=6)
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

    h = W.Part("head")
    h.sphere(face, loc=(0, -0.12, -0.03), scale=(0.13, 0.2, 0.14), rot=(math.radians(28), 0, 0), seg=8, rings=6)
    v = h.ico(wool, loc=(0, -0.03, 0.12), radius=0.11, scale=(1.1, 1.0, 0.8))  # topknot
    h.jitter(v, 0.015, seed=41)
    for sx in (1, -1):
        h.sphere(face, loc=(0.16 * sx, -0.04, 0.05), scale=(0.12, 0.05, 0.035), rot=(0, 0, math.radians(18 * sx)), seg=6, rings=4)  # ears
        h.ico(eye, loc=(0.085 * sx, -0.2, 0.05), radius=0.022)
    h.finish(parent=body, pivot=(0, -0.5, 0.12))

    for sx, sy, name in ((1, -1, "leg_fl"), (-1, -1, "leg_fr"), (1, 1, "leg_bl"), (-1, 1, "leg_br")):
        L = W.Part(name)
        L.limb(face, (0, 0, 0.05), (0, 0, -0.34), 0.05, 0.042, seg=6)
        L.cyl(hoof, loc=(0, -0.01, -0.37), r1=0.048, r2=0.05, depth=0.06, seg=6)
        L.finish(parent=body, pivot=(0.17 * sx, 0.28 * sy, -0.22))
    return root


def wolf():
    grey = W.mat("wolf_grey", "#5f6470", 0.9)
    light = W.mat("wolf_light", "#b3b7bf", 0.9)
    dark = W.mat("wolf_dark", "#2e3038", 0.85)
    nose = W.mat("wolf_nose", "#111114", 0.5)
    glow = W.mat("wolf_eyes", "#ffc045", 0.4, emit="#ffb030", emit_strength=4.0)

    root = W.empty("wolf")
    b = W.Part("body")
    v = b.sphere(grey, loc=(0, 0.04, 0.0), scale=(0.26, 0.62, 0.25), seg=10, rings=7)
    b.jitter(v, 0.02, seed=51)
    v = b.ico(grey, loc=(0, -0.36, 0.1), radius=0.26, scale=(1.1, 0.95, 1.1), subdiv=1)  # shoulder ruff
    b.jitter(v, 0.035, seed=52, scale=4.0)
    b.sphere(light, loc=(0, -0.02, -0.15), scale=(0.19, 0.46, 0.11), seg=8, rings=5)  # belly
    v = b.ico(light, loc=(0, -0.5, -0.05), radius=0.16, scale=(1.1, 0.8, 1.1))  # chest
    b.jitter(v, 0.02, seed=53)
    v = b.sphere(dark, loc=(0, 0.06, 0.13), scale=(0.17, 0.5, 0.13), seg=8, rings=5)  # darker saddle
    b.jitter(v, 0.015, seed=55)
    body = b.finish(parent=root, pivot=(0, 0, 0.78))

    h = W.Part("head")
    v = h.sphere(grey, loc=(0, -0.08, 0.03), scale=(0.17, 0.2, 0.16), seg=8, rings=6)
    h.jitter(v, 0.012, seed=54)
    h.limb(light, (0, -0.17, -0.02), (0, -0.44, -0.07), 0.09, 0.05, seg=7)  # long snout
    h.ico(nose, loc=(0, -0.45, -0.06), radius=0.035)
    h.ico(light, loc=(0, -0.2, -0.1), radius=0.08, scale=(1.2, 1.4, 0.7))  # jaw
    head = h.finish(parent=body, pivot=(0, -0.64, 0.2))

    eyes = W.Part("eyes")
    for sx in (1, -1):
        eyes.ico(glow, loc=(0.075 * sx, -0.2, 0.08), radius=0.03, scale=(1.2, 0.8, 0.8))
    eyes.finish(parent=head, pivot=(0, 0, 0))

    for sx, name in ((1, "ear_l"), (-1, "ear_r")):
        e = W.Part(name)
        e.cyl(grey, loc=(0, 0, 0.09), r1=0.065, r2=0.008, depth=0.18, seg=4, rot=(0, 0.15 * sx, 0))
        e.finish(parent=head, pivot=(0.09 * sx, -0.02, 0.14))

    t = W.Part("tail")
    t.limb(grey, (0, 0, 0), (0, 0.32, -0.3), 0.09, 0.085, seg=7)
    t.limb(grey, (0, 0.32, -0.3), (0, 0.44, -0.52), 0.085, 0.07, seg=7)
    t.limb(dark, (0, 0.44, -0.52), (0, 0.48, -0.62), 0.07, 0.02, seg=7)
    t.finish(parent=body, pivot=(0, 0.62, 0.06))

    for sx, sy, name in ((1, -1, "leg_fl"), (-1, -1, "leg_fr"), (1, 1, "leg_bl"), (-1, 1, "leg_br")):
        L = W.Part(name)
        L.limb(grey, (0, 0, 0.04), (0, 0, -0.36), 0.068, 0.05, seg=6)
        L.limb(light, (0, 0, -0.36), (0, -0.02, -0.62), 0.05, 0.042, seg=6)
        L.ico(dark, loc=(0, -0.04, -0.63), radius=0.055, scale=(1, 1.35, 0.55))
        L.finish(parent=body, pivot=(0.13 * sx, 0.4 * sy if sy > 0 else -0.36, -0.12))
    return root


def main():
    preview = "--preview" in W.args()
    for name, build in (("collie", collie), ("sheep", sheep), ("wolf", wolf)):
        W.reset()
        root = build()
        W.export_glb(f"{name}.glb", [root])
        if preview:
            W.render_preview(f"{name}.png", [root], elev=24, azim=40)


main()
