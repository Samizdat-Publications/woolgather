"""Shared helpers for the Woolgather asset scripts.

Every family script (characters.py, nature.py, structures.py, terrain.py, fx.py) imports this,
builds its models from primitives with bmesh, and exports .glb files into public/assets/.

Run a family script headless:
    blender --background --factory-startup --python blender_scripts/<family>.py [-- --preview]

Conventions (see CLAUDE.md): metres, Blender Z up (exported as glTF Y up), characters face -Y
(three.js +Z), part origins sit on their joints, low-poly flat-shaded, colour from materials.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "public", "assets")
PREVIEWS = os.path.join(ROOT, "docs", "assets")
LEVEL = os.path.join(ROOT, "level", "valley.json")


def args():
    """Arguments after `--` on the Blender command line."""
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()


# ----------------------------------------------------------------------------- colour + materials


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h, alpha=1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


_MATS = {}


def mat(name, color, rough=0.9, emit=None, emit_strength=1.0, metal=0.0):
    """Principled material, cached by name. `color`/`emit` are sRGB hex strings."""
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_rgba(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    if emit:
        bsdf.inputs["Emission Color"].default_value = hex_rgba(emit)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    m.diffuse_color = hex_rgba(color)
    _MATS[name] = m
    return m


# ----------------------------------------------------------------------------- geometry builder


def trs(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    return Matrix.LocRotScale(Vector(loc), Euler(rot).to_quaternion(), Vector(scale))


class Part:
    """Accumulates primitives (in coordinates relative to the part's pivot) into one mesh."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _tag(self, verts, m):
        faces = {f for v in verts for f in v.link_faces}
        mi = self._mi(m)
        for f in faces:
            f.material_index = mi
            f.smooth = False
        return list(verts)

    def box(self, m, loc=(0, 0, 0), size=(1, 1, 1), rot=(0, 0, 0)):
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=trs(loc, rot, size))
        return self._tag(r["verts"], m)

    def ico(self, m, loc=(0, 0, 0), radius=1.0, scale=(1, 1, 1), rot=(0, 0, 0), subdiv=1):
        r = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=radius, matrix=trs(loc, rot, scale))
        return self._tag(r["verts"], m)

    def sphere(self, m, loc=(0, 0, 0), radius=1.0, scale=(1, 1, 1), rot=(0, 0, 0), seg=8, rings=6):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=radius, matrix=trs(loc, rot, scale))
        return self._tag(r["verts"], m)

    def cyl(self, m, loc=(0, 0, 0), r1=0.5, r2=None, depth=1.0, rot=(0, 0, 0), seg=8, scale=(1, 1, 1)):
        """Cylinder/cone along local Z, centred on `loc`."""
        r = bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r1 if r2 is None else r2, depth=depth, matrix=trs(loc, rot, scale)
        )
        return self._tag(r["verts"], m)

    def prism_x(self, m, pts_yz, x0, x1):
        """Extrude a convex 2D polygon given in (y, z) along X from x0 to x1 (closed both ends)."""
        a = [self.bm.verts.new((x0, y, z)) for y, z in pts_yz]
        b = [self.bm.verts.new((x1, y, z)) for y, z in pts_yz]
        n = len(pts_yz)
        self.bm.faces.new(list(reversed(a)))
        self.bm.faces.new(b)
        for i in range(n):
            j = (i + 1) % n
            self.bm.faces.new((a[i], a[j], b[j], b[i]))
        self.bm.normal_update()
        return self._tag(a + b, m)

    def limb(self, m, a, b, r1, r2=None, seg=6):
        """Tapered cylinder from point a to point b."""
        a = Vector(a)
        b = Vector(b)
        d = b - a
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        mtx = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r1 if r2 is None else r2, depth=d.length, matrix=mtx)
        return self._tag(r["verts"], m)

    def jitter(self, verts, amount, seed=0, scale=2.5):
        """Displace verts with smooth noise for organic, hand-made looking shapes."""
        off = Vector((seed * 7.31, seed * 3.17, seed * 5.53))
        for v in verts:
            n = noise.noise_vector(v.co * scale + off)
            v.co += n * amount

    def finish(self, collection=None, parent=None, pivot=(0, 0, 0)):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        ob.location = Vector(pivot)
        if parent is not None:
            ob.parent = parent
        return ob


def empty(name, parent=None, loc=(0, 0, 0), collection=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.3
    (collection or bpy.context.scene.collection).objects.link(ob)
    ob.location = Vector(loc)
    if parent is not None:
        ob.parent = parent
    return ob


def descendants(ob):
    out = [ob]
    for c in ob.children:
        out.extend(descendants(c))
    return out


# ----------------------------------------------------------------------------- export + preview


def export_glb(filename, roots, vertex_colors=False, texcoords=False):
    """Export the given root objects (and their children) to public/assets/<filename>."""
    os.makedirs(ASSETS, exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for r in roots:
        for o in descendants(r):
            o.select_set(True)
    bpy.context.view_layer.objects.active = roots[0]
    path = os.path.join(ASSETS, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE" if vertex_colors else "NONE",
        export_normals=True,
        export_texcoords=texcoords,
        export_animations=False,
        export_extras=False,
    )
    print(f"WG_EXPORT {filename} {os.path.getsize(path)} bytes")
    return path


def render_preview(filename, roots, distance=None, elev=22, azim=35, size=640, target=None):
    """Render a quick EEVEE preview of `roots` to docs/assets/<filename> for visual QA."""
    os.makedirs(PREVIEWS, exist_ok=True)
    scene = bpy.context.scene
    bpy.context.view_layer.update()  # world matrices must reflect any layout moves
    objs = [o for r in roots for o in descendants(r) if o.type == "MESH"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    center = Vector(target) if target else (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.5)
    dist = distance or radius * 3.0
    e = math.radians(elev)
    a = math.radians(azim)
    cam_data = bpy.data.cameras.new("wg_preview_cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("wg_preview_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = center + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun_data = bpy.data.lights.new("wg_preview_sun", "SUN")
    sun_data.energy = 3.2
    sun_data.color = (1.0, 0.92, 0.8)
    sun = bpy.data.objects.new("wg_preview_sun", sun_data)
    sun.rotation_euler = Euler((math.radians(50), 0, math.radians(-40)))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("wg_preview_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = hex_rgba("#c9d6dc")
    bg.inputs["Strength"].default_value = 0.9
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = os.path.join(PREVIEWS, filename)
    bpy.ops.render.render(write_still=True)
    for o in (cam, sun):
        bpy.data.objects.remove(o)
    print(f"WG_PREVIEW {filename}")


def rng(seed):
    return random.Random(seed)
