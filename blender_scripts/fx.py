"""FX geometry: sky dome, bark shockwave ring, moon disc and small particle meshes.

Outputs public/assets/fx.glb. The game gives these its own shader materials (gradient sky,
additive glow, instanced particles), so the Blender materials here are only placeholders.

    blender --background --factory-startup --python blender_scripts/fx.py [-- --preview]
"""

import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wg_lib as W  # noqa: E402


def sky_dome():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=1.0)
    bm.normal_update()
    # Faces point inwards: the camera sits inside the dome.
    for f in bm.faces:
        if f.normal.dot(f.calc_center_median()) > 0:
            f.normal_flip()
        f.smooth = True
    me = bpy.data.meshes.new("sky_dome")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(W.mat("sky", "#8fb4d8", 1.0))
    ob = bpy.data.objects.new("sky_dome", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def ring(name, inner, outer, seg=64):
    bm = bmesh.new()
    a = [bm.verts.new((math.cos(t) * inner, math.sin(t) * inner, 0)) for t in (i * math.tau / seg for i in range(seg))]
    b = [bm.verts.new((math.cos(t) * outer, math.sin(t) * outer, 0)) for t in (i * math.tau / seg for i in range(seg))]
    for i in range(seg):
        j = (i + 1) % seg
        f = bm.faces.new((a[i], b[i], b[j], a[j]))
        f.normal_update()  # new bmesh faces do not have a valid normal yet
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(W.mat("fx_ring", "#fff4d6", 1.0))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def moon():
    p = W.Part("moon")
    m = W.mat("moon", "#f3f0e2", 1.0, emit="#f3f0e2", emit_strength=1.0)
    crater = W.mat("moon_crater", "#d9d5c6", 1.0, emit="#d9d5c6", emit_strength=1.0)
    p.cyl(m, loc=(0, 0, 0), r1=1.0, r2=1.0, depth=0.02, seg=24, rot=(math.pi / 2, 0, 0))
    for x, z, r in ((0.3, 0.25, 0.22), (-0.35, -0.1, 0.16), (0.05, -0.45, 0.12), (-0.2, 0.45, 0.09)):
        p.cyl(crater, loc=(x, -0.012, z), r1=r, r2=r, depth=0.004, seg=10, rot=(math.pi / 2, 0, 0))
    return p.finish()


def heart():
    red = W.mat("heart", "#ff6b6b", 0.6, emit="#ff4f5e", emit_strength=0.6)
    p = W.Part("heart")
    for sx in (1, -1):
        p.ico(red, loc=(0.22 * sx, 0, 0.18), radius=0.28, subdiv=1)
    p.cyl(red, loc=(0, 0, -0.12), r1=0.02, r2=0.42, depth=0.5, seg=4, rot=(0, 0, math.pi / 4), scale=(1.0, 0.55, 1.0))
    return p.finish()


def small(name, color, radius, subdiv=0):
    p = W.Part(name)
    v = p.ico(W.mat(name, color, 1.0), radius=radius, subdiv=subdiv)
    p.jitter(v, radius * 0.15, seed=len(name))
    return p.finish()


def main():
    W.reset()
    objs = [
        sky_dome(),
        ring("bark_ring", 0.86, 1.0),
        ring("soft_ring", 0.97, 1.0, 96),
        moon(),
        heart(),
        small("wool_tuft", "#f4efe2", 0.12, 1),
        small("dust_puff", "#c9b48a", 0.3, 1),
        small("splash_drop", "#cfe6f5", 0.08, 0),
    ]
    W.export_glb("fx.glb", objs)
    if "--preview" in W.args():
        for i, o in enumerate(objs[3:]):
            o.location = (i * 1.6, 0, 0.5)
        W.render_preview("fx.png", objs[3:], elev=15, azim=0, size=800)


main()
