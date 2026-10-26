"""
Shared helpers for the custom Atlantic Forest models of the Secret Trail (game/ART.md).

Every generator in this folder is a standalone, reproducible Blender script:

    /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/<asset>.py [-- --no-render]

It rebuilds its asset from nothing, exports a raw GLB with COLOR_0 vertex colours and
renders a preview PNG in the standard ART light. Outputs go outside the repo, to
$CUSTOM_RAW_DIR (default ~/.cache/agents/2026-10-25-trilha-secreta/custom-raw).

Conventions (ART.md sections 1-6):
- Blender is Z-up; the exporter writes glTF Y-up, so the model's front (glTF +Z, the
  direction the Cube Pets and the avatar face) is Blender -Y.
- One unit = one game unit (u, about 0.47 m; avatar 3.0 u).
- Colours come only from RAMPS/ACCENT in game/src/style/palette.ts (parsed at run
  time, never copied) or from the documented SPECIES colours below.
- Flat shading, no modifiers, transforms applied (rotation and scale identity; a
  node's translation is its pivot), origin at the trunk base or the attach point.
- One material that multiplies a white base by COLOR_0; the only image texture in
  the set is the sign face.
"""

from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
GAME = REPO / "game"
PALETTE_TS = GAME / "src" / "style" / "palette.ts"
SKINS = GAME / "src" / "assets" / "skins"
CACHE = Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta"
OUT = Path(os.environ.get("CUSTOM_RAW_DIR", str(CACHE / "custom-raw")))
KENNEY = Path(os.environ.get("KENNEY_RAW_DIR", str(CACHE / "kenney-raw")))
NATURE_KIT = KENNEY / "nature-kit" / "Models" / "GLTF format"
CUBE_PETS = KENNEY / "cube-pets" / "Models" / "GLB format"
FONT_LABEL = Path("/usr/share/fonts/noto/NotoSans-Bold.ttf")


def argv_flags() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


# --------------------------------------------------------------------------- palette


def _load_palette() -> tuple[dict[str, list[str]], dict[str, str]]:
    src = PALETTE_TS.read_text(encoding="utf-8")
    ramps_src = re.search(r"RAMPS\s*=\s*\{(.*?)\}\s*as const", src, re.S).group(1)
    accent_src = re.search(r"ACCENT\s*=\s*\{(.*?)\}\s*as const", src, re.S).group(1)
    ramps = {
        name: re.findall(r"'(#[0-9a-fA-F]{6})'", body)
        for name, body in re.findall(r"(\w+):\s*\[([^\]]*)\]", ramps_src)
    }
    accent = dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", accent_src))
    assert all(len(v) == 4 for v in ramps.values()) and len(accent) == 3, "palette.ts changed shape"
    return ramps, accent


RAMPS, ACCENT = _load_palette()

# Documented species colours (ART.md section 2: allowed outside the ramps when they are
# the species' real colours, lightness inside the world's range). Sources in the report
# (custom-models.md) and next to each use. The animal-attachment colours are the top row
# of the cells reserved for them in game/src/assets/skins/palette-*.png (assets-report.md
# section 3.2), so the vertex-colour and palette routes agree.
SPECIES = {
    # Euterpe edulis: ripe fruit black-violet (Embrapa; Flora e Funga do Brasil).
    "jucaraFruto": "#45274f",
    "jucaraFrutoLuz": "#643a72",
    # Red centre of a flowering tank bromeliad (Neoregelia / Nidularium; Flora e Funga).
    "bromeliaVermelho": "#c4453b",
    # Ramphastos dicolorus bill: green with a black basal line and a red cutting edge
    # (WikiAves; Perrella & Guida 2019). Top rows of tucano palette cells (6,2), (1,3), (4,3).
    "tucanoBico": "#bce84c",
    "tucanoBicoBase": "#242730",
    "tucanoTomio": "#e6392e",
    # Jaguar rosette ring and its darker-than-coat centre, onca palette cells (5,3), (3,2).
    "oncaRoseta": "#26201e",
    "oncaRosetaMiolo": "#b85d19",
    # Golden lion tamarin mane, mico palette cell (3,2) top row (ICMBio).
    "micoJuba": "#ff8818",
    "micoJubaSombra": "#d6650f",
}

# Helper colours used only in previews (never exported).
PREVIEW = {"avatar": "#8c8c8c", "rodDark": "#3b3b3b", "rodLight": "#d9d9d9"}


def ramp(name: str, i: int) -> str:
    return RAMPS[name][i]


def hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_linear(h: str) -> tuple[float, float, float, float]:
    return (*(srgb_to_linear(c) for c in hex_rgb(h)), 1.0)


def colour_source(h: str) -> str:
    """Where a colour comes from: 'leaf[1]', 'ACCENT.ipeRosa', 'SPECIES.jucaraFruto',
    or '~<ramp> (v2 gradient)' when within ART.md lightness bounds [0.12, 0.90]."""
    h = h.lower()
    for name, values in RAMPS.items():
        for i, v in enumerate(values):
            if v.lower() == h:
                return f"{name}[{i}]"
    for name, v in ACCENT.items():
        if v.lower() == h:
            return f"ACCENT.{name}"
    for name, v in SPECIES.items():
        if v.lower() == h:
            return f"SPECIES.{name}"
    r, g, b = hex_rgb(h)
    lum = (max(r, g, b) + min(r, g, b)) * 0.5
    if 0.115 <= lum <= 0.905:
        best_name = "leaf[1]"
        best_d = 1e9
        for name, values in RAMPS.items():
            for i, v in enumerate(values):
                vr, vg, vb = hex_rgb(v)
                d = (r - vr) ** 2 + (g - vg) ** 2 + (b - vb) ** 2
                if d < best_d:
                    best_d = d
                    best_name = f"{name}[{i}]"
        return f"~{best_name}"
    return "UNLISTED"


def clamp_srgb_lightness(r: float, g: float, b: float, lo: float = 0.125, hi: float = 0.895) -> tuple[float, float, float]:
    """Clamp sRGB (0..1) so HSL lightness stays strictly inside [lo, hi] (ART.md section 2)."""
    import colorsys

    r = max(0.0, min(1.0, r))
    g = max(0.0, min(1.0, g))
    b = max(0.0, min(1.0, b))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    s = min(0.78, s)
    l_clamped = max(lo, min(hi, l))
    return colorsys.hls_to_rgb(h, l_clamped, s)


# --------------------------------------------------------------------------- geometry


def V(*p) -> Vector:
    return Vector(p[0] if len(p) == 1 else p)


def rot_z(a: float) -> Matrix:
    return Matrix.Rotation(a, 3, "Z")


def frame(axis: Vector, up_hint: Vector | None = None) -> Matrix:
    """3x3 basis whose Z column is `axis` (normalised)."""
    z = Vector(axis).normalized()
    hint = up_hint or (Vector((0, 0, 1)) if abs(z.z) < 0.95 else Vector((1, 0, 0)))
    x = hint.cross(z)
    if x.length < 1e-6:
        x = Vector((1, 0, 0)).cross(z)
    x.normalize()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


class Mesh:
    """A flat-shaded polygon soup with one colour (and optional UV) per face."""

    def __init__(self, name: str):
        self.name = name
        self.verts: list[Vector] = []
        self.faces: list[tuple[int, ...]] = []
        self.colours: list[str] = []
        self.uvs: list[tuple[float, float] | None] = []

    # basic
    def add(self, pts, colour: str, uv=None) -> None:
        base = len(self.verts)
        self.verts.extend(Vector(p) for p in pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.colours.append(colour)
        self.uvs.append(uv)

    def add2(self, pts, front: str, back: str, uv=None, gap: float = 0.006) -> None:
        """A two-sided face: the front with its own winding and a reversed back face,
        each pushed gap/2 along its normal so no renderer has to pick between two
        coincident faces (three.js culls the back one anyway)."""
        pts = [Vector(p) for p in pts]
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        n = n.normalized() * (gap / 2) if n.length > 1e-12 else Vector()
        self.add([p + n for p in pts], front, uv)
        self.add([p - n for p in reversed(pts)], back, uv)

    def add_out(self, pts, colour: str, inside, uv=None) -> None:
        """Add a face wound so its normal points away from `inside` (a point within the
        solid it closes)."""
        pts = [Vector(p) for p in pts]
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        centroid = sum(pts, Vector()) / len(pts)
        self.add(pts if n.dot(centroid - Vector(inside)) >= 0 else pts[::-1], colour, uv)

    def tris(self) -> int:
        return sum(len(f) - 2 for f in self.faces)

    def transformed(self, m: Matrix, start: int = 0) -> None:
        """Apply a 4x4 matrix to the vertices added since index `start` of faces."""
        idx = {i for f in self.faces[start:] for i in f}
        for i in idx:
            self.verts[i] = m @ self.verts[i]

    # primitives
    def box(self, centre, size, colour, rot: Matrix | None = None, colours: dict | None = None, uv=None, skip=()):
        """Axis box (optionally rotated about its centre). colours: per side override
        keyed by 'top','bottom','px','nx','py','ny'. skip: sides to leave open."""
        c = Vector(centre)
        sx, sy, sz = (s / 2 for s in size)
        r = rot or Matrix.Identity(3)
        p = [c + r @ Vector((x, y, z)) for z in (-sz, sz) for y in (-sy, sy) for x in (-sx, sx)]
        # index: z0: 0(-,-) 1(+,-) 2(-,+) 3(+,+); z1: 4..7
        sides = {
            "bottom": (0, 2, 3, 1),
            "top": (4, 5, 7, 6),
            "ny": (0, 1, 5, 4),
            "py": (2, 6, 7, 3),
            "nx": (0, 4, 6, 2),
            "px": (1, 3, 7, 5),
        }
        for key, quad in sides.items():
            if key in skip:
                continue
            self.add([p[i] for i in quad], (colours or {}).get(key, colour), uv)

    def prism(self, p0, p1, r0, r1, n, colour, *, twist=0.0, cap0=False, cap1=True, sx=1.0, sy=1.0,
              colour_cap=None, up_hint=None, uv=None):
        """Tapered n-sided prism from p0 to p1 (radius r0 -> r1). r1 == 0 makes a cone."""
        p0, p1 = Vector(p0), Vector(p1)
        b = frame(p1 - p0, up_hint)

        def ring(p, r):
            return [p + b @ Vector((math.cos(twist + 2 * math.pi * k / n) * r * sx,
                                    math.sin(twist + 2 * math.pi * k / n) * r * sy, 0)) for k in range(n)]

        a = ring(p0, r0)
        if r1 <= 0:
            for k in range(n):
                self.add([a[k], a[(k + 1) % n], p1], colour, uv)
        else:
            t = ring(p1, r1)
            for k in range(n):
                self.add([a[k], a[(k + 1) % n], t[(k + 1) % n], t[k]], colour, uv)
            if cap1:
                self.add(t, colour_cap or colour, uv)
        if cap0:
            self.add(list(reversed(a)), colour_cap or colour, uv)
        return a

    def slab(self, centre, rx, ry, h, n, colour, *, twist=0.0, colour_top=None, colour_bottom=None, taper=1.0, rot=None, uv=None):
        """A flat n-gon plate (a Kenney-style canopy tier): bottom ring rx,ry, top ring
        scaled by `taper`, height h, centred on `centre` (bottom at centre.z)."""
        c = Vector(centre)
        r = rot or Matrix.Identity(3)
        bot = [c + r @ Vector((math.cos(twist + 2 * math.pi * k / n) * rx, math.sin(twist + 2 * math.pi * k / n) * ry, 0)) for k in range(n)]
        top = [c + r @ Vector((math.cos(twist + 2 * math.pi * k / n) * rx * taper, math.sin(twist + 2 * math.pi * k / n) * ry * taper, h)) for k in range(n)]
        for k in range(n):
            self.add([bot[k], bot[(k + 1) % n], top[(k + 1) % n], top[k]], colour, uv)
        self.add(top, colour_top or colour, uv)
        self.add(list(reversed(bot)), colour_bottom or colour, uv)

    def blade(self, root, tip, width, colour, *, thickness=0.0, mid=0.5, bend: Vector | None = None, normal_hint=None, colour_under=None, uv=None):
        """A leaf/frond: a flat diamond root -> widest at `mid` -> tip, optionally bent by
        `bend` at the middle. Two-sided (front and back faces) so it never vanishes
        under back-face culling."""
        root, tip = Vector(root), Vector(tip)
        axis = tip - root
        m = root + axis * mid + (bend or Vector())
        side = axis.cross(normal_hint or Vector((0, 0, 1)))
        if side.length < 1e-6:
            side = axis.cross(Vector((1, 0, 0)))
        side = side.normalized() * (width / 2)
        l, r = m + side, m - side
        up = (l - root).cross(r - root).normalized() * thickness
        top = [root, l + up, tip, r + up] if thickness else [root, l, tip, r]
        # quads would be non-planar when bent: split into 2 triangles each side
        back = colour_under or colour
        self.add2([top[0], top[1], top[2]], colour, back, uv)
        self.add2([top[0], top[2], top[3]], colour, back, uv)

    def chunk(self, base, rx, ry, h, n, colour, *, chamfer=0.3, twist=0.0, colour_top=None, colour_bottom=None,
              top_scale=1.0, bottom=True, rot: Matrix | None = None, uv=None):
        """The Kenney Nature Kit canopy block: an n-gon prism with a chamfer ring at the
        bottom and at the top (8n-4 triangles). `base` is the centre of the bottom face."""
        c = Vector(base)
        r = rot or Matrix.Identity(3)
        ch = chamfer

        def ring(scale, z):
            return [c + r @ Vector((math.cos(twist + 2 * math.pi * k / n) * rx * scale,
                                    math.sin(twist + 2 * math.pi * k / n) * ry * scale, z)) for k in range(n)]

        rings = [ring(1 - ch * 0.55, 0.0), ring(1.0, h * ch), ring(top_scale, h * (1 - ch)), ring(top_scale * (1 - ch * 0.55), h)]
        cols = [colour_bottom or colour, colour, colour_top or colour]
        for i in range(3):
            a, b = rings[i], rings[i + 1]
            for k in range(n):
                self.add([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]], cols[i], uv)
        self.add(rings[3], colour_top or colour, uv)
        if bottom:
            self.add(list(reversed(rings[0])), colour_bottom or colour, uv)

    def tube(self, points, radii, n, colour, *, cap_end=True, cap_start=False, twist=0.0, colours=None, uv=None):
        """A bent n-sided branch along a polyline, rings parallel-transported so the
        faces never twist; colours: optional per-segment colour list."""
        pts = [Vector(p) for p in points]
        tangents = []
        for i in range(len(pts)):
            if i == 0:
                t = pts[1] - pts[0]
            elif i == len(pts) - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            tangents.append(t.normalized())
        basis = frame(tangents[0])
        rings = []
        for i, p in enumerate(pts):
            if i > 0:
                q = tangents[i - 1].rotation_difference(tangents[i])
                basis = q.to_matrix() @ basis
            rings.append([p + basis @ Vector((math.cos(twist + 2 * math.pi * k / n) * radii[i],
                                              math.sin(twist + 2 * math.pi * k / n) * radii[i], 0)) for k in range(n)])
        for i in range(len(pts) - 1):
            col = (colours or [colour] * len(pts))[i]
            a, b = rings[i], rings[i + 1]
            if radii[i + 1] <= 1e-6:
                for k in range(n):
                    self.add([a[k], a[(k + 1) % n], pts[i + 1]], col, uv)
            else:
                for k in range(n):
                    self.add([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]], col, uv)
        if cap_end and radii[-1] > 1e-6:
            self.add(rings[-1], (colours or [colour])[-1], uv)
        if cap_start:
            self.add(list(reversed(rings[0])), colour, uv)
        return rings

    def frond(self, path, widths, droops, colour, *, colour_under=None, normal_hint=None, uv=None):
        """A palm or fern frond as a folded strip along `path` (list of points): at
        each point the two edges sit `widths[i]/2` to the sides and `droops[i]` below
        the rachis, so the leaflets hang down on both sides (a roof-shaped cross
        section). The last width may be 0 for a pointed tip. Two-sided."""
        pts = [Vector(p) for p in path]
        hint = normal_hint or Vector((0, 0, 1))
        left, right = [], []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            side = t.cross(hint)
            if side.length < 1e-6:
                side = t.cross(Vector((1, 0, 0)))
            side.normalize()
            down = Vector((0, 0, -droops[i]))
            left.append(p + side * widths[i] / 2 + down)
            right.append(p - side * widths[i] / 2 + down)
        under = colour_under or colour
        for i in range(len(pts) - 1):
            for e in (left, right):
                quad = [pts[i], pts[i + 1], e[i + 1], e[i]]
                if (e[i + 1] - pts[i + 1]).length < 1e-6:
                    tri = [pts[i], pts[i + 1], e[i]]
                    self.add2(tri if e is right else tri[::-1], colour, under, uv)
                else:
                    q = quad if e is right else quad[::-1]
                    # keep each side as two triangles: the strip is usually non-planar
                    self.add2([q[0], q[1], q[2]], colour, under, uv)
                    self.add2([q[0], q[2], q[3]], colour, under, uv)

    def leaf_fringe(
        self,
        centre,
        rx: float,
        ry: float,
        rz: float,
        count: int,
        colour: str,
        *,
        colour_alt: str | None = None,
        length: float = 1.15,
        width: float = 0.62,
        z_min: float = -0.55,
        z_max: float = 0.90,
        seed: int = 7,
    ) -> None:
        """Opaque chunky leaf-shaped diamond quads (2 tris each, no alpha test) distributed
        around a canopy lobe's ellipsoid shell to break up the polygonal silhouette (ART.md §1/§5)."""
        c = Vector(centre)
        golden = math.pi * (3.0 - math.sqrt(5.0))
        for i in range(count):
            t = (i + 0.5) / max(1, count)
            zz = z_max - t * (z_max - z_min)
            rad = math.sqrt(max(0.0, 1.0 - zz * zz))
            th = golden * i + seed * 0.73
            dx = math.cos(th) * rad
            dy = math.sin(th) * rad
            #Deterministic pseudo-random jitter from index & seed
            j1 = math.sin(i * 12.9898 + seed * 78.233) * 43758.5453
            j1 = j1 - math.floor(j1)
            j2 = math.sin(i * 93.989 + seed * 17.13) * 24634.6345
            j2 = j2 - math.floor(j2)

            shell_scale = 0.88 + 0.12 * j1
            pos = c + Vector((dx * rx, dy * ry, zz * rz)) * shell_scale
            out_n = Vector((dx / max(0.1, rx), dy / max(0.1, ry), zz / max(0.1, rz))).normalized()
            # Leaf axis points outward from the lobe and droops slightly at the rim
            radial_xy = Vector((dx, dy, 0.0))
            if radial_xy.length < 1e-4:
                radial_xy = Vector((1.0, 0.0, 0.0))
            else:
                radial_xy.normalize()
            tangent = Vector((-radial_xy.y, radial_xy.x, 0.0))
            leaf_dir = (radial_xy * 0.78 + tangent * ((j2 - 0.5) * 0.55) + Vector((0.0, 0.0, 0.25 * zz - 0.18))).normalized()
            side = leaf_dir.cross(out_n)
            if side.length < 1e-4:
                side = leaf_dir.cross(Vector((0.0, 0.0, 1.0)))
            side.normalize()

            L = length * (0.85 + 0.30 * j1)
            W = width * (0.85 + 0.30 * j2)
            p_root = pos - leaf_dir * (L * 0.28)
            p_mid = pos + leaf_dir * (L * 0.22) + out_n * 0.06
            p_tip = pos + leaf_dir * (L * 0.72)
            p_left = p_mid + side * (W * 0.5)
            p_right = p_mid - side * (W * 0.5)
            col = (colour_alt or colour) if (i % 3 == 0) else colour
            self.add_out([p_root, p_left, p_tip, p_right], col, c)

    def merge(self, other: "Mesh") -> None:
        base = len(self.verts)
        self.verts.extend(other.verts)
        self.faces.extend(tuple(i + base for i in f) for f in other.faces)
        self.colours.extend(other.colours)
        self.uvs.extend(other.uvs)


# --------------------------------------------------------------------------- blender objects


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def vertex_colour_material(name: str = "mata-vertex-colour") -> bpy.types.Material:
    """Export material: white, rough, non-metal base multiplied by COLOR_0 (ART.md 5)."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Color"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    mat.use_backface_culling = False
    return mat


def build_object(mesh: Mesh, name: str | None = None, parent=None, pivot=(0, 0, 0), material=None,
                 face_materials: list[int] | None = None, materials: list | None = None):
    """Create the Blender object. Vertices are given in the asset's space; the object
    origin is put at `pivot` (in the same space) and the geometry shifted so nothing
    moves: transforms stay applied (rotation 0, scale 1)."""
    name = name or mesh.name
    piv = Vector(pivot)
    me = bpy.data.meshes.new(name)
    me.from_pydata([v - piv for v in mesh.verts], [], mesh.faces)
    me.validate(clean_customdata=False)
    me.update()
    assert len(me.polygons) == len(mesh.faces), f"{name}: degenerate faces were dropped"
    col = me.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for poly, hexc in zip(me.polygons, mesh.colours):
        rgba = (*hex_rgb(hexc), 1.0)
        for li in poly.loop_indices:
            col.data[li].color_srgb = rgba
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = 0
    if any(uv is not None for uv in mesh.uvs):
        uvl = me.uv_layers.new(name="UVMap")
        for poly, uv in zip(me.polygons, mesh.uvs):
            loops = list(poly.loop_indices)
            if uv is None:
                uv = (0.0, 0.0)
            if isinstance(uv, tuple) and len(uv) == 2 and not isinstance(uv[0], tuple):
                for li in loops:
                    uvl.data[li].uv = uv
            else:  # explicit per-corner list
                for li, u in zip(loops, uv):
                    uvl.data[li].uv = u
    me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
    for m in materials or [material or vertex_colour_material()]:
        me.materials.append(m)
    if face_materials:
        me.polygons.foreach_set("material_index", face_materials)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
        ob.location = piv - parent_world_pivot(parent)
    else:
        ob.location = piv
    return ob


def _atlas_tile_uv(col: int, row: int, u: float, v: float, pad: float = 0.015) -> tuple[float, float]:
    u_c = max(0.0, min(1.0, u))
    v_c = max(0.0, min(1.0, v))
    u0 = col * 0.25 + pad
    u1 = (col + 1) * 0.25 - pad
    v0 = row * 0.25 + pad
    v1 = (row + 1) * 0.25 - pad
    return (u0 + (u1 - u0) * u_c, v0 + (v1 - v0) * v_c)


def foliage_atlas_material(name: str = "FoliageAtlasMat"):
    atlas_path = GAME / "src" / "assets" / "skins" / "foliage-atlas.png"
    mat = bpy.data.materials.new(name)
    mat.use_backface_culling = False
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(atlas_path), check_existing=True)
    tex.interpolation = "Linear"
    vc = nt.nodes.new("ShaderNodeAttribute")
    vc.attribute_name = "Color"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(vc.outputs["Fac"], bsdf.inputs["Roughness"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def apply_v2_foliage(ob, mode: str = "tree"):
    """Apply Art Direction v2 volume normals (or 'up' normals for ground cover), smooth
    canopy shading, flat trunk/branch/root normals, UV-mapped painted colour from the
    shared 512x512 `foliage-atlas.png`, and 3-step hue-shifted lighting + AO in COLOR_0
    (ART.md sections 1, 2, 5, 6 & a-visual.md T3a)."""
    import bmesh
    import colorsys

    bpy.context.view_layer.update()
    targets = [o for o in [ob, *ob.children_recursive] if o.type == "MESH"]
    foliage_hexes = {h.lower() for h in (*RAMPS["leaf"], *RAMPS["grass"], ACCENT["ipeAmarelo"], ACCENT["ipeRosa"], RAMPS["rock"][3])}
    atlas_mat = foliage_atlas_material(f"Atlas_{ob.name}")
    quad_corners = [(0.12, 0.10), (0.88, 0.10), (0.88, 0.90), (0.12, 0.90)]

    for m_obj in targets:
        me = m_obj.data
        attr = me.color_attributes.active_color or me.color_attributes[0]
        uvl = me.uv_layers.active or me.uv_layers.new(name="UVMap")
        loops = me.loops
        co = [m_obj.matrix_world @ v.co for v in me.vertices]
        obj_name = m_obj.name.lower()

        if mode == "cover":
            lo = Vector((min(v.x for v in co), min(v.y for v in co), min(v.z for v in co)))
            hi = Vector((max(v.x for v in co), max(v.y for v in co), max(v.z for v in co)))
            c = (lo + hi) * 0.5
            r_xy = max(0.15, math.hypot(hi.x - lo.x, hi.y - lo.y) * 0.5)
            z_span = max(0.05, hi.z - lo.z)
            normals = [None] * len(loops)
            for p in me.polygons:
                p.use_smooth = True
                li0 = p.loop_indices[0]
                sr0, sg0, sb0, _ = attr.data[li0].color_srgb
                h_val, _l_val, _s_val = colorsys.rgb_to_hls(sr0, sg0, sb0)
                if "serapilheira" in obj_name:
                    t_col, t_row, planar = 3, 1, True
                elif "samambaia" in obj_name:
                    t_col, t_row, planar = 0, 1, False
                elif "bromelia" in obj_name:
                    if h_val < 0.08 or h_val > 0.90:
                        t_col, t_row, planar = 2, 1, False
                    else:
                        t_col, t_row, planar = 1, 1, False
                else:  # flores-mata or flores-caidas
                    if 0.18 <= h_val <= 0.48:
                        t_col, t_row, planar = 1, 1, False
                    elif 0.08 <= h_val < 0.18:
                        t_col, t_row, planar = 0, 3, False
                    else:
                        t_col, t_row, planar = 2, 3, False

                for idx_l, li in enumerate(p.loop_indices):
                    v = co[loops[li].vertex_index]
                    rad_vec = Vector((v.x - c.x, v.y - c.y, 0.0))
                    if rad_vec.length > 1e-4:
                        rad_vec.normalize()
                    # "Up" normal (0, 0, 1) in Blender Z-up -> (0, 1, 0) in glTF Y-up so ground cover never shows black edges
                    normals[li] = (Vector((0.0, 0.0, 1.0)) * 0.88 + rad_vec * 0.12).normalized()
                    if planar:
                        u_loc = 0.5 + (v.x - c.x) / max(0.3, hi.x - lo.x)
                        v_loc = 0.5 + (v.y - c.y) / max(0.3, hi.y - lo.y)
                    else:
                        u_loc, v_loc = quad_corners[idx_l % 4]
                    uvl.data[li].uv = _atlas_tile_uv(t_col, t_row, u_loc, v_loc)

                    t_z = max(0.0, min(1.0, (v.z - lo.z) / z_span))
                    t_r = max(0.0, min(1.0, math.hypot(v.x - c.x, v.y - c.y) / r_xy))
                    u = max(0.0, min(1.0, 0.65 * t_z + 0.35 * t_r))
                    # 3-step lighting + AO multiplier in COLOR_0 (multiplies painted atlas colour)
                    nr, ng, nb = clamp_srgb_lightness(0.68 + 0.24 * u, 0.74 + 0.18 * u, 0.80 + 0.10 * u)
                    attr.data[li].color_srgb = (nr, ng, nb, 1.0)
            me.normals_split_custom_set(normals)
            me.materials.clear()
            me.materials.append(atlas_mat)
            continue

        # Tree mode: classify foliage faces vs trunk/branch/root faces
        fol_faces = set()
        for p in me.polygons:
            li0 = p.loop_indices[0]
            sr, sg, sb, _ = attr.data[li0].color_srgb
            h_hex = "#%02x%02x%02x" % (int(round(sr * 255)), int(round(sg * 255)), int(round(sb * 255)))
            h_val, _l_val, s_val = colorsys.rgb_to_hls(sr, sg, sb)
            if h_hex in foliage_hexes or (0.20 <= h_val <= 0.48 and s_val > 0.16):
                # Exclude vertical grey stem on embaúba/juçara/jerivá (rock[1..2] below z=6.2)
                avg_z = sum(co[loops[li].vertex_index].z for li in p.loop_indices) / p.loop_total
                if h_hex == RAMPS["rock"][3].lower() and avg_z < 5.0:
                    continue
                fol_faces.add(p.index)

        # Connected foliage islands (lobes)
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        island: dict[int, int] = {}
        nid = 0
        for f in bm.faces:
            if f.index in fol_faces and f.index not in island:
                stack = [f]
                island[f.index] = nid
                while stack:
                    cur = stack.pop()
                    for e in cur.edges:
                        for nf in e.link_faces:
                            if nf.index in fol_faces and nf.index not in island:
                                island[nf.index] = nid
                                stack.append(nf)
                nid += 1
        bm.free()

        fv = [co[loops[li].vertex_index] for fi in fol_faces for li in me.polygons[fi].loop_indices]
        trunk_v = [co[loops[li].vertex_index] for p in me.polygons if p.index not in fol_faces for li in p.loop_indices]
        tz0 = min((v.z for v in trunk_v), default=0.0)
        tz1 = max((v.z for v in trunk_v), default=1.0)

        if fv:
            lo = Vector((min(v.x for v in fv), min(v.y for v in fv), min(v.z for v in fv)))
            hi = Vector((max(v.x for v in fv), max(v.y for v in fv), max(v.z for v in fv)))
            c = (lo + hi) * 0.5
            r = Vector((max(0.25, (hi.x - lo.x) * 0.5), max(0.25, (hi.y - lo.y) * 0.5), max(0.25, (hi.z - lo.z) * 0.5)))
            c_norm = c.copy()
            c_norm.z -= r.z * 0.35
        else:
            lo = Vector((0.0, 0.0, 0.0))
            hi = Vector((1.0, 1.0, 1.0))
            c = Vector((0.0, 0.0, 0.5))
            c_norm = c.copy()
            r = Vector((1.0, 1.0, 1.0))

        icent: dict[int, tuple[Vector, float]] = {}
        for fi, isl_id in island.items():
            icent.setdefault(isl_id, []).extend(co[loops[li].vertex_index] for li in me.polygons[fi].loop_indices)
        icent_stats = {}
        for isl_id, vs in icent.items():
            ctr = sum(vs, Vector()) / len(vs)
            rad = max(0.2, max((v - ctr).length for v in vs))
            icent_stats[isl_id] = (ctr, rad)

        normals = [None] * len(loops)
        for p in me.polygons:
            is_fol = p.index in fol_faces
            p.use_smooth = is_fol
            li0 = p.loop_indices[0]
            sr0, sg0, sb0, _ = attr.data[li0].color_srgb
            h_val, _l_val, _s_val = colorsys.rgb_to_hls(sr0, sg0, sb0)

            # Determine painted tile (t_col, t_row) in foliage-atlas.png
            if is_fol:
                if "ipe-amarelo" in obj_name or (0.08 <= h_val < 0.18):
                    t_col, t_row = 0, 3
                elif "ipe-rosa" in obj_name or h_val > 0.82 or h_val < 0.05:
                    t_col, t_row = 2, 3
                elif "xaxim" in obj_name:
                    t_col, t_row = 0, 1
                elif "jucara" in obj_name or "jeriva" in obj_name:
                    t_col, t_row = (3, 2) if (p.loop_total == 4 and p.area < 0.9) else (0, 2)
                elif "mangue" in obj_name:
                    t_col, t_row = 1, 2
                elif "jequitiba" in obj_name:
                    t_col, t_row = (3, 2) if (p.loop_total == 4 and p.area < 1.5) else (3, 3)
                elif "pau-brasil" in obj_name:
                    t_col, t_row = 1, 3
                else:  # araucaria, embauba
                    t_col, t_row = (3, 2) if (p.loop_total == 4 and p.area < 1.1) else (2, 2)
            else:
                if "cacho" in obj_name:
                    t_col, t_row = 3, 0
                elif "xaxim" in obj_name:
                    t_col, t_row = 3, 0
                elif "embauba" in obj_name or "jucara" in obj_name or "jeriva" in obj_name:
                    t_col, t_row = 2, 0
                elif "pau-brasil" in obj_name or "mangue" in obj_name:
                    t_col, t_row = 1, 0
                else:
                    t_col, t_row = 0, 0

            for idx_l, li in enumerate(p.loop_indices):
                v = co[loops[li].vertex_index]
                if is_fol:
                    g = Vector(((v.x - c_norm.x) / (r.x ** 2), (v.y - c_norm.y) / (r.y ** 2), (v.z - c_norm.z) / (r.z ** 2))).normalized()
                    ctr, rad = icent_stats[island[p.index]]
                    l_vec = v - Vector((ctr.x, ctr.y, ctr.z - rad * 0.25))
                    l_n = l_vec.normalized() if l_vec.length > 1e-4 else g
                    normals[li] = (g * 0.58 + l_n * 0.42).normalized()

                    if (t_col, t_row) in ((2, 2), (3, 3), (1, 2)) and p.loop_total >= 4 and p.area >= 1.1:
                        u_loc = 0.5 + (v.x - ctr.x) / max(0.4, rad * 1.8)
                        v_loc = 0.5 + (v.y - ctr.y) / max(0.4, rad * 1.8)
                    else:
                        u_loc, v_loc = quad_corners[idx_l % 4]
                    uvl.data[li].uv = _atlas_tile_uv(t_col, t_row, u_loc, v_loc)

                    t = max(0.0, min(1.0, (v.z - lo.z) / max(0.2, hi.z - lo.z)))
                    core = max(0.15, min(1.0, (v - ctr).length / rad))
                    u = max(0.0, min(1.0, 0.62 * t + 0.38 * core))
                    # 3-step lighting + AO multiplier in COLOR_0 (multiplies painted atlas colour)
                    nr, ng, nb = clamp_srgb_lightness(0.64 + 0.28 * u, 0.72 + 0.20 * u, 0.80 + 0.10 * u)
                    attr.data[li].color_srgb = (nr, ng, nb, 1.0)
                else:
                    # Trunks, branches, and roots stay flat-shaded with painted bark UVs + AO
                    normals[li] = p.normal.copy()
                    ang = (math.atan2(v.y, v.x) / (2 * math.pi)) + 0.5
                    t_trunk = max(0.0, min(1.0, (v.z - tz0) / max(0.2, tz1 - tz0)))
                    if "cacho" in obj_name:
                        uvl.data[li].uv = _atlas_tile_uv(3, 0, 0.1 + 0.3 * (idx_l % 2), 0.88 + 0.08 * (idx_l // 2))
                    elif "xaxim" in obj_name:
                        uvl.data[li].uv = _atlas_tile_uv(3, 0, ang, (t_trunk * 0.45) % 0.45)
                    else:
                        uvl.data[li].uv = _atlas_tile_uv(t_col, t_row, ang, t_trunk)
                    base_ao = 0.66 + 0.24 * min(1.0, t_trunk * 2.5)
                    canopy_occ = 0.84 if (fv and v.z > lo.z + 0.15 * (hi.z - lo.z)) else 1.0
                    k = max(0.15, min(0.88, base_ao * canopy_occ))
                    attr.data[li].color_srgb = (k, k, k, 1.0)

        me.normals_split_custom_set(normals)
        me.materials.clear()
        me.materials.append(atlas_mat)
    return ob


def parent_world_pivot(ob) -> Vector:
    p = Vector()
    while ob is not None:
        p += ob.location
        ob = ob.parent
    return p


def empty(name: str, location=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob.empty_display_size = 0.25
    if parent is not None:
        ob.parent = parent
        ob.location = Vector(location) - parent_world_pivot(parent)
    else:
        ob.location = Vector(location)
    return ob


def export_glb(path: Path, root) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    stack = [root]
    while stack:
        o = stack.pop()
        o.select_set(True)
        stack.extend(o.children)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_vertex_color="MATERIAL",
        export_all_vertex_colors=False,
        export_attributes=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_image_format="AUTO",
    )
    _nearest_without_mipmaps(path)
    return path


def _nearest_without_mipmaps(path: Path) -> None:
    """Blender writes Closest images as NEAREST / NEAREST_MIPMAP_NEAREST; ART.md section 6
    wants NearestFilter with no mipmaps, so both filters become NEAREST (9728)."""
    buf = Path(path).read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    doc = json.loads(buf[20 : 20 + jlen])
    if not doc.get("samplers"):
        return
    for smp in doc["samplers"]:
        smp["magFilter"] = smp["minFilter"] = 9728
    j = json.dumps(doc, separators=(",", ":")).encode()
    j += b" " * ((4 - len(j) % 4) % 4)
    rest = buf[20 + jlen :]
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + len(rest)) + struct.pack("<II", len(j), 0x4E4F534A) + j + rest
    Path(path).write_bytes(out)


# --------------------------------------------------------------------------- GLB audit


def read_glb(path: Path) -> tuple[dict, bytes]:
    buf = Path(path).read_bytes()
    magic, _version, _length = struct.unpack_from("<III", buf, 0)
    assert magic == 0x46546C67, "not a GLB"
    jlen, _ = struct.unpack_from("<II", buf, 12)
    doc = json.loads(buf[20 : 20 + jlen])
    off = 20 + jlen
    binc = b""
    if off < len(buf):
        blen, _ = struct.unpack_from("<II", buf, off)
        binc = buf[off + 8 : off + 8 + blen]
    return doc, binc


_COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor(doc, binc, i):
    a = doc["accessors"][i]
    bv = doc["bufferViews"][a["bufferView"]]
    fmt, size = _COMP[a["componentType"]]
    n = _NCOMP[a["type"]]
    stride = bv.get("byteStride", size * n)
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    out = []
    for k in range(a["count"]):
        vals = struct.unpack_from("<" + fmt * n, binc, base + k * stride)
        if a.get("normalized"):
            mx = {5121: 255, 5123: 65535, 5120: 127, 5122: 32767}[a["componentType"]]
            vals = tuple(v / mx for v in vals)
        out.append(vals)
    return out


def audit_glb(path: Path) -> dict:
    """Numbers for the quality gate, read back from the exported file itself."""
    doc, binc = read_glb(path)
    nodes = doc.get("nodes", [])

    def local(n):
        m = Matrix.Identity(4)
        if "matrix" in n:
            m = Matrix([n["matrix"][i::4] for i in range(4)])
        else:
            t = n.get("translation", [0, 0, 0])
            r = n.get("rotation", [0, 0, 0, 1])
            s = n.get("scale", [1, 1, 1])
            from mathutils import Quaternion
            m = Matrix.Translation(t) @ Quaternion((r[3], r[0], r[1], r[2])).to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))
        return m

    tris = 0
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    colours: dict[str, int] = {}
    names = []
    non_identity = []
    has_uv = False

    def walk(i, parent_m, depth):
        nonlocal tris, lo, hi, has_uv
        n = nodes[i]
        m = parent_m @ local(n)
        names.append(("  " * depth) + n.get("name", f"node{i}") + (f"  t={tuple(round(x, 4) for x in n.get('translation', [0, 0, 0]))}" if n.get("translation") else ""))
        if n.get("rotation", [0, 0, 0, 1]) != [0, 0, 0, 1] or n.get("scale", [1, 1, 1]) != [1, 1, 1]:
            non_identity.append(n.get("name"))
        if "mesh" in n:
            for prim in doc["meshes"][n["mesh"]]["primitives"]:
                pos = accessor(doc, binc, prim["attributes"]["POSITION"])
                count = doc["accessors"][prim["indices"]]["count"] if "indices" in prim else len(pos)
                tris += count // 3
                for p in pos:
                    w = m @ Vector(p)
                    lo = Vector(map(min, lo, w))
                    hi = Vector(map(max, hi, w))
                has_uv |= "TEXCOORD_0" in prim["attributes"]
                mat = doc.get("materials", [{}])[prim["material"]] if "material" in prim else {}
                textured = "baseColorTexture" in mat.get("pbrMetallicRoughness", {})
                if "COLOR_0" in prim["attributes"] and not textured:
                    for c in accessor(doc, binc, prim["attributes"]["COLOR_0"]):
                        h = "#%02x%02x%02x" % tuple(int(round(linear_to_srgb(x) * 255)) for x in c[:3])
                        colours[h] = colours.get(h, 0) + 1
        for c in n.get("children", []):
            walk(c, m, depth + 1)

    for r in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        walk(r, Matrix.Identity(4), 0)
    return {
        "file": Path(path).name,
        "bytes": Path(path).stat().st_size,
        "tris": tris,
        # glTF is Y-up: height is Y, footprint X/Z.
        "min": tuple(round(x, 3) for x in lo),
        "max": tuple(round(x, 3) for x in hi),
        "height": round(hi.y - lo.y, 3),
        "colours": {h: colour_source(h) for h in sorted(colours)},
        "nodes": names,
        "non_identity_nodes": non_identity,
        "materials": [m.get("name") for m in doc.get("materials", [])],
        "images": [
            {"name": im.get("name"), "mimeType": im.get("mimeType"),
             "size": _png_size(binc, doc["bufferViews"][im["bufferView"]]) if "bufferView" in im else None}
            for im in doc.get("images", [])
        ],
        "samplers": doc.get("samplers", []),
        "texcoord": has_uv,
        "extensions": doc.get("extensionsUsed", []),
    }


def _png_size(binc: bytes, view: dict):
    off = view.get("byteOffset", 0)
    if binc[off + 1 : off + 4] == b"PNG":
        return struct.unpack(">II", binc[off + 16 : off + 24])
    return None


def write_audit(path: Path, budget: int, target: str, extra: dict | None = None) -> dict:
    a = audit_glb(path)
    a["budget"] = budget
    a["target"] = target
    a.update(extra or {})
    bad = [h for h, s in a["colours"].items() if s == "UNLISTED"]
    print(f"[gate] {a['file']}: {a['tris']} tris (budget {budget}), height {a['height']} u (target {target}), "
          f"colours {a['colours']}, nodes {a['nodes']}")
    assert a["tris"] <= budget, f"{a['file']} over budget: {a['tris']} > {budget}"
    assert not bad, f"{a['file']} has colours outside the palette: {bad}"
    assert not a["non_identity_nodes"], f"{a['file']} has unapplied rotation/scale: {a['non_identity_nodes']}"
    path.with_suffix(".audit.json").write_text(json.dumps(a, indent=2, ensure_ascii=False), encoding="utf-8")
    return a


# --------------------------------------------------------------------------- preview (ART light)


def setup_cycles(samples: int = 96) -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    gpu = False
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
        gpu |= d.use
    scene.cycles.device = "GPU" if gpu else "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 24
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"  # the game renders with NoToneMapping
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.display_settings.display_device = "sRGB"


def art_light(sun_azimuth_deg: float = -35.0) -> None:
    """ART.md section 5 / palette.ts LIGHT.daylight, matched to the game's three.js setup
    (src/scene/Graybox.svelte: HemisphereLight intensity 1, DirectionalLight 1.6, no tone
    mapping). three.js lights a Lambert surface with albedo/pi * irradiance, and a Cycles
    world of radiance L gives pi*L of irradiance, so the hemisphere becomes a world split
    at the horizon (sky above, ground below) at strength 1/pi and the sun keeps 1.6."""
    ctx_light = _palette_light()
    scene = bpy.context.scene
    world = bpy.data.worlds.new("ART daylight")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    up = nt.nodes.new("ShaderNodeMath")
    up.operation = "GREATER_THAN"
    up.inputs[1].default_value = 0.0
    nt.links.new(sep.outputs["Z"], up.inputs[0])
    hemi = nt.nodes.new("ShaderNodeMix")
    hemi.data_type = "RGBA"
    nt.links.new(up.outputs[0], hemi.inputs["Factor"])
    hemi.inputs["A"].default_value = hex_linear(ctx_light["hemisphereGround"])
    hemi.inputs["B"].default_value = hex_linear(ctx_light["hemisphereSky"])
    light_bg = nt.nodes.new("ShaderNodeBackground")
    light_bg.inputs["Strength"].default_value = 1.0 / math.pi
    nt.links.new(hemi.outputs["Result"], light_bg.inputs["Color"])
    # What the camera sees behind the models: the game's sky (horizon -> skyTop).
    grad = nt.nodes.new("ShaderNodeMapRange")
    grad.inputs["From Min"].default_value = 0.0
    grad.inputs["From Max"].default_value = 0.6
    nt.links.new(sep.outputs["Z"], grad.inputs["Value"])
    sky = nt.nodes.new("ShaderNodeMix")
    sky.data_type = "RGBA"
    nt.links.new(grad.outputs["Result"], sky.inputs["Factor"])
    sky.inputs["A"].default_value = hex_linear(ctx_light["horizon"])
    sky.inputs["B"].default_value = hex_linear(ctx_light["skyTop"])
    cam_bg = nt.nodes.new("ShaderNodeBackground")
    cam_bg.inputs["Strength"].default_value = 1.0
    nt.links.new(sky.outputs["Result"], cam_bg.inputs["Color"])
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(light_bg.outputs[0], mix.inputs[1])
    nt.links.new(cam_bg.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])

    sun_data = bpy.data.lights.new("ART sun", "SUN")
    sun_data.color = hex_linear(ctx_light["sun"])[:3]
    sun_data.energy = 1.6
    sun_data.angle = math.radians(2.0)
    sun = bpy.data.objects.new("ART sun", sun_data)
    scene.collection.objects.link(sun)
    el = math.radians(ctx_light["sunElevationDeg"])
    az = math.radians(sun_azimuth_deg)
    # direction towards the sun: from the front-left of the camera (front = -Y)
    to_sun = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()


def _palette_light() -> dict:
    src = PALETTE_TS.read_text(encoding="utf-8")
    block = re.search(r"daylight:\s*\{(.*?)\}", src, re.S).group(1)
    d = dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", block))
    d["sunElevationDeg"] = float(re.search(r"sunElevationDeg:\s*([\d.]+)", block).group(1))
    return d


def diffuse_material(name: str, hexc: str | None = None, use_attr: bool = True, image=None):
    """Lambert (Diffuse BSDF, roughness 0) material for previews, like MeshLambertMaterial."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfDiffuse")
    bsdf.inputs["Roughness"].default_value = 0.0
    # three.js renders FrontSide only: back faces are culled, so two-sided leaves show
    # the face that points at the camera. Cycles has no culling; a transparent back
    # face reproduces it (also for shadow rays, like a culled shadow pass).
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mix.inputs["Fac"])
    nt.links.new(bsdf.outputs[0], mix.inputs[1])
    nt.links.new(clear.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Color"])
    elif use_attr:
        attr = nt.nodes.new("ShaderNodeVertexColor")
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Color"])
    else:
        bsdf.inputs["Color"].default_value = hex_linear(hexc or "#ffffff")
    return mat


def import_glb(path: Path) -> list:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    return new


def lambertise(objs) -> None:
    """Swap imported materials for Lambert ones: COLOR_0 meshes read the colour
    attribute, image materials keep their image with nearest filtering."""
    for o in objs:
        if o.type != "MESH":
            continue
        has_col = len(o.data.color_attributes) > 0
        for slot in o.material_slots:
            m = slot.material
            img = None
            if m and m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image:
                        img = n.image
            if img is not None:
                slot.material = diffuse_material(f"{m.name}-lambert", image=img)
            elif has_col:
                slot.material = diffuse_material("vc-lambert")
            else:
                col = "#ffffff"
                if m and m.use_nodes:
                    b = m.node_tree.nodes.get("Principled BSDF")
                    if b:
                        c = b.inputs["Base Color"].default_value
                        col = "#%02x%02x%02x" % tuple(int(round(linear_to_srgb(x) * 255)) for x in c[:3])
                slot.material = diffuse_material(f"flat-{col}", col, use_attr=False)


def recolour_kenney(objs, mapping: dict[str, str]) -> None:
    """Kenney Nature Kit materials -> ramp colours (the same mapping OpenCode's
    color-map.json reviews), for a fair style comparison."""
    for o in objs:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            name = slot.material.name.split(".")[0] if slot.material else ""
            slot.material = diffuse_material(f"k-{name}", mapping.get(name, ramp("rock", 2)), use_attr=False)


def flat_box(name, centre, size, hexc):
    m = Mesh(name)
    m.box(centre, size, hexc)
    ob = build_object(m, name, material=diffuse_material(f"{name}-mat", hexc, use_attr=False))
    return ob


def measuring_props(x: float, y: float = 0.0, rod_height: float | None = None, bar_y: float | None = None) -> list:
    """The 3.0 u grey avatar block (Blocky avatar footprint 0.9 x 0.6 u) and a scale rod
    of alternating 1 u bands next to it; plus a 1 u bar on the ground."""
    objs = [flat_box("avatar-3u", (x, y, 1.5), (0.9, 0.6, 3.0), PREVIEW["avatar"])]
    h = int(math.ceil(rod_height or 3))
    rod = Mesh("rod")
    for i in range(h):
        rod.box((x + 0.85, y, i + 0.5), (0.18, 0.18, 1.0), PREVIEW["rodDark"] if i % 2 == 0 else PREVIEW["rodLight"])
    objs.append(build_object(rod, "rod-1u", material=diffuse_material("rod-mat")))
    bar = Mesh("bar")
    by = (y - 0.75) if bar_y is None else bar_y
    bar.box((x + 0.5, by, 0.04), (1.0, 0.16, 0.08), PREVIEW["rodDark"])
    bar.box((x + 0.0, by, 0.1), (0.04, 0.2, 0.2), PREVIEW["rodDark"])
    bar.box((x + 1.0, by, 0.1), (0.04, 0.2, 0.2), PREVIEW["rodDark"])
    objs.append(build_object(bar, "bar-1u", material=diffuse_material("bar-mat")))
    return objs


def ground(size: float = 200.0, hexc: str | None = None):
    m = Mesh("ground")
    s = size / 2
    m.add([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], hexc or ramp("grass", 2))
    ob = build_object(m, "preview-ground", material=diffuse_material("ground-mat"))
    # The ground shows shadows but does not block the hemisphere's ground light, so the
    # models are lit like the game's HemisphereLight (sky above, ground colour below).
    ob.visible_diffuse = False
    ob.visible_glossy = False
    ob.visible_shadow = False
    ob.location.z = -0.002
    return ob


def label(text: str, location, size: float = 0.5, hexc: str = "#2b2b2b", rot_z_deg: float = 0.0):
    curve = bpy.data.curves.new(f"label-{text}", "FONT")
    curve.body = text
    curve.size = size
    curve.align_x = "CENTER"
    if FONT_LABEL.exists():
        curve.font = bpy.data.fonts.load(str(FONT_LABEL), check_existing=True)
    ob = bpy.data.objects.new(f"label-{text}", curve)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(location)
    ob.rotation_euler = (math.radians(90), 0, math.radians(rot_z_deg))
    mat = bpy.data.materials.new(f"label-{text}")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = hex_linear(hexc)
    nt.links.new(e.outputs[0], o.inputs["Surface"])
    curve.materials.append(mat)
    ob.visible_shadow = False
    return ob


def world_bbox(objs) -> tuple[Vector, Vector]:
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    bpy.context.view_layer.update()
    for o in objs:
        if o.type not in {"MESH", "FONT"}:
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def frame_camera(objs, azimuth_deg=-28.0, elevation_deg=12.0, lens=50.0, res=(1200, 1200), margin=0.08,
                 look_from=None):
    """Perspective camera fitted to the objects' bounding box from the front-left."""
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    cam_data = bpy.data.cameras.new("preview-cam")
    cam_data.lens = lens
    cam_data.sensor_fit = "AUTO"
    cam_data.clip_start = 0.05
    cam_data.clip_end = 2000
    cam = bpy.data.objects.new("preview-cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    lo, hi = world_bbox(objs)
    centre = (lo + hi) / 2
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    rot = (-d).to_track_quat("-Z", "Y").to_matrix()
    right, upv, fwd = rot.col[0], rot.col[1], -rot.col[2]
    aspect = res[0] / res[1]
    fov = 2 * math.atan(18.0 / lens)  # sensor 36 mm on the longer side
    tx = math.tan(fov / 2) * (1 if aspect >= 1 else aspect)
    ty = math.tan(fov / 2) / (aspect if aspect >= 1 else 1)
    tx *= 1 - margin
    ty *= 1 - margin
    corners = [Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    # centre the projected box, then back off until every corner fits
    for _ in range(3):
        xs = [(c - centre).dot(right) for c in corners]
        ys = [(c - centre).dot(upv) for c in corners]
        centre = centre + right * ((max(xs) + min(xs)) / 2) + upv * ((max(ys) + min(ys)) / 2)
    dist = 0.0
    for c in corners:
        rel = c - centre
        x, y, z = rel.dot(right), rel.dot(upv), rel.dot(fwd)
        dist = max(dist, abs(x) / tx - z, abs(y) / ty - z)
    cam.location = centre - fwd * dist
    cam.rotation_euler = rot.to_euler()
    return cam


def render(png: Path, samples: int = 96) -> Path:
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(png)
    png.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    return png


def compose_side_by_side(left: Path, right: Path, out: Path) -> Path:
    """Join two renders of equal height (left: game scale lineup, right: close-up)."""
    return compose_row([left, right], out)


def compose_row(images: list, out: Path) -> Path:
    """Join renders of equal height left to right, with a thin white gap."""
    import numpy as np

    rows = []
    for k, path in enumerate(images):
        img = bpy.data.images.load(str(path))
        px = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4)
        if k:
            rows.append(np.ones((px.shape[0], 8, 4)))
        rows.append(px)
    joined = np.concatenate(rows, axis=1)
    img = bpy.data.images.new("joined", joined.shape[1], joined.shape[0])
    img.pixels[:] = joined.ravel()
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()
    return out


def preview_static(glb: Path, png: Path, *, closeup: bool = False, res=(1200, 1200), azimuth_deg=-28.0,
                   elevation_deg=12.0, lens=50.0, samples=96) -> Path:
    """Asset next to the 3.0 u avatar block, the 1 u rod and bar, in the ART light.
    closeup=True adds a second, tighter render of the asset alone (small props)."""
    reset_scene()
    setup_cycles(samples)
    art_light()
    objs = import_glb(glb)
    lambertise(objs)
    lo, hi = world_bbox(objs)
    x = lo.x - 1.6
    props = measuring_props(x, 0.0, rod_height=max(3.0, hi.z))
    ground()
    frame_camera(objs + props, azimuth_deg, elevation_deg, lens, res)
    if not closeup:
        return render(png, samples)
    left = render(png.with_name(png.stem + "-lineup.png"), samples)
    for o in props:
        o.hide_render = True
    bpy.data.objects.remove(bpy.context.scene.camera, do_unlink=True)
    frame_camera(objs, azimuth_deg, max(elevation_deg, 20.0), lens, res, margin=0.15)
    right = render(png.with_name(png.stem + "-closeup.png"), samples)
    out = compose_side_by_side(left, right, png)
    left.unlink()
    right.unlink()
    return out


def run(build, *, name: str, budget: int, target: str, preview=None, preview_kw: dict | None = None) -> dict:
    """Build -> export -> audit -> preview. `build()` returns the root object."""
    reset_scene()
    root = build()
    glb = export_glb(OUT / f"{name}.glb", root)
    audit = write_audit(glb, budget, target)
    if "--no-render" not in argv_flags():
        if preview is not None:
            preview(glb, OUT / f"{name}.png")
        else:
            preview_static(glb, OUT / f"{name}.png", **(preview_kw or {}))
    return audit


# Trees are seen by a 3 u avatar from the trail: a low camera that looks up into the crown.
TREE_VIEW = {"elevation_deg": 3.0, "res": (1000, 1300), "lens": 45.0}


# --------------------------------------------------------------------------- Cube Pets attachments

# Kenney Cube Pets (CC0) as shipped in kenney-raw, with the species palettes that the game
# already uses (game/src/assets/skins, read only). Game size from the ART.md scale table.
PETS = {
    "parrot": {"glb": "animal-parrot.glb", "skin": "palette-tucano-de-bico-verde.png", "size": ("height", 0.9)},
    "monkey": {"glb": "animal-monkey.glb", "skin": "palette-mico-leao-dourado.png", "size": ("height", 0.9)},
    "tiger": {"glb": "animal-tiger.glb", "skin": "palette-onca-pintada.png", "size": ("length", 3.0)},
}


def pet_uv(col: int, band: int, row: int = 0) -> tuple[float, float]:
    """UV (Blender convention, v up) of a texel row in the 8x4 grid of the 64x64 pets
    palette (assets-report.md section 3.1): column `col`, band `band`, row 0 = top."""
    u = (col * 8 + 4) / 64
    v_gltf = (band * 16 + row + 0.5) / 64
    return (u, 1.0 - v_gltf)


def import_pet(pet: str, palette: bool = True):
    objs = import_glb(CUBE_PETS / PETS[pet]["glb"])
    if palette:
        img = bpy.data.images.load(str(SKINS / PETS[pet]["skin"]), check_existing=True)
        mat = diffuse_material(f"skin-{pet}", image=img)
        for o in objs:
            if o.type == "MESH":
                for slot in o.material_slots:
                    slot.material = mat
    return objs


def pet_surface(pet: str, nodes=("body",)):
    """BVH of the pet's rest pose (Blender world space), for placing attachments flush."""
    import bmesh
    from mathutils.bvhtree import BVHTree

    objs = import_pet(pet, palette=False)
    bpy.context.view_layer.update()
    bm = bmesh.new()
    pivots = {}
    for o in objs:
        pivots[o.name] = o.matrix_world.translation.copy()
        if o.type == "MESH" and o.name in nodes:
            tmp = o.data.copy()
            tmp.transform(o.matrix_world)
            bm.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
    bvh = BVHTree.FromBMesh(bm)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return bvh, pivots


def surface_hit(bvh, origin, direction):
    loc, normal, _i, _d = bvh.ray_cast(Vector(origin), Vector(direction).normalized(), 50.0)
    assert loc is not None, f"no surface hit from {tuple(origin)} towards {tuple(direction)}"
    return loc, normal


def attach_by_contract(pet_objs, att_objs, contract: dict) -> None:
    """Emulate the game's attach code. contract = {"node": "<pet node>"} (the GLB root goes
    under that node with an identity transform) or {"groups": "<prefix>"} (each child
    group '<prefix><node>' hands its children to pet node '<node>', keeping their local
    transforms)."""
    pet = {o.name.split(".")[0]: o for o in pet_objs}
    roots = [o for o in att_objs if o.parent is None]
    if "node" in contract:
        for r in roots:
            r.parent = pet[contract["node"]]
            r.matrix_parent_inverse.identity()
    else:
        prefix = contract["groups"]
        for r in roots:
            for g in list(r.children):
                target = pet[g.name[len(prefix):]]
                for child in list(g.children):
                    loc = child.location.copy()
                    child.parent = target
                    child.matrix_parent_inverse.identity()
                    child.location = loc
    bpy.context.view_layer.update()


def preview_attachment(glb: Path, png: Path, pet: str, contract: dict, *, closeup_az=-35.0, closeup_el=18.0,
                       views=None, samples=96) -> Path:
    """Left: the pet with the attachment at game size next to the 3.0 u avatar block and the
    1 u rod. Then one close-up per (azimuth, elevation) in `views`, in the ART light."""
    reset_scene()
    setup_cycles(samples)
    art_light()
    pet_objs = import_pet(pet)
    att = import_glb(glb)
    lambertise(att)
    attach_by_contract(pet_objs, att, contract)
    top = [o for o in pet_objs if o.parent is None][0]
    lo, hi = world_bbox([o for o in pet_objs if o.type == "MESH" and o.name.split(".")[0] != "tail"])
    kind, size = PETS[pet]["size"]
    s = size / ((hi.z - lo.z) if kind == "height" else (hi.y - lo.y))
    top.scale = (s, s, s)
    bpy.context.view_layer.update()
    everything = pet_objs + att
    lo, hi = world_bbox(everything)
    props = measuring_props(lo.x - 1.4, 0.0, rod_height=3.0)
    ground()
    frame_camera(everything + props, -28.0, 14.0, 50.0, (900, 900))
    panels = [render(png.with_name(png.stem + "-lineup.png"), samples)]
    for o in props:
        o.hide_render = True
    for k, (az, el) in enumerate(views or [(closeup_az, closeup_el)]):
        bpy.data.objects.remove(bpy.context.scene.camera, do_unlink=True)
        frame_camera(everything, az, el, 50.0, (900, 900), margin=0.12)
        panels.append(render(png.with_name(png.stem + f"-closeup{k}.png"), samples))
    out = compose_row(panels, png)
    for panel in panels:
        panel.unlink()
    return out


# --------------------------------------------------------------------------- conforming decals


def _simplify(profile: list, tol: float) -> list:
    """Douglas-Peucker on a 1D profile [(s, d)]: the s values where the slope changes."""
    if len(profile) <= 2:
        return [profile[0][0], profile[-1][0]]
    (s0, d0), (s1, d1) = profile[0], profile[-1]
    worst, idx = -1.0, 0
    for k in range(1, len(profile) - 1):
        s, d = profile[k]
        line = d0 + (d1 - d0) * (s - s0) / (s1 - s0) if s1 != s0 else d0
        if abs(d - line) > worst:
            worst, idx = abs(d - line), k
    if worst <= tol:
        return [s0, s1]
    left = _simplify(profile[: idx + 1], tol)
    right = _simplify(profile[idx:], tol)
    return left[:-1] + right


def conform_quad(m: "Mesh", bvh, centre: Vector, axis_u: Vector, axis_v: Vector, normal: Vector, cu: float, cv: float,
                 hu: float, hv: float, angle_deg: float, lift: float, colour: str, uv=None, tol: float = 0.009,
                 merge: float = 0.015):
    """A decal rectangle (centre (cu, cv) and half sizes in the patch's (u, v) plane, turned
    by `angle_deg`) laid onto the surface below it: the surface is sampled along the
    rectangle's own axes and only the breakpoints of that profile become vertices, so a
    flat spot stays 2 triangles and one crossing a ridge bends over it. Vertices are
    `centre`-relative world positions lifted `lift` along `normal`; keep `tol` below `lift`
    so the surface between breakpoints never pokes through."""
    assert tol < lift, "the decal would sink into the surface between breakpoints"
    a = math.radians(angle_deg)
    e1 = (math.cos(a), math.sin(a))
    e2 = (-math.sin(a), math.cos(a))

    def world(s, t):
        du = cu + e1[0] * s + e2[0] * t
        dv = cv + e1[1] * s + e2[1] * t
        return centre + axis_u * du + axis_v * dv

    def hit(s, t):
        p = world(s, t)
        loc, _n, _i, _d = bvh.ray_cast(p + normal * 0.6, -normal, 2.0)
        assert loc is not None, f"decal off the surface at {tuple(round(c, 3) for c in p)}"
        return loc

    def depth(s, t):
        return (hit(s, t) - centre).dot(normal)

    def breaks(half, other_half, along_first: bool):
        n = max(2, int(round(2 * half / 0.01)) + 1)
        keys = set()
        for o in (-other_half, 0.0, other_half):
            prof = []
            for k in range(n):
                x = -half + 2 * half * k / (n - 1)
                prof.append((x, depth(x, o) if along_first else depth(o, x)))
            keys.update(_simplify(prof, tol))
        out = []
        for x in sorted(keys):
            if not out or x - out[-1] > merge:
                out.append(x)
        out[0], out[-1] = -half, half
        return out

    ss = breaks(hu, hv, True)
    ts = breaks(hv, hu, False)
    for i in range(len(ss) - 1):
        for j in range(len(ts) - 1):
            corners = [(ss[i], ts[j]), (ss[i + 1], ts[j]), (ss[i + 1], ts[j + 1]), (ss[i], ts[j + 1])]
            pts = [hit(s, t) + normal * lift - centre for s, t in corners]
            # two triangles (the cell may be non-planar on a slope)
            m.add([pts[0], pts[1], pts[2]], colour, uv)
            m.add([pts[0], pts[2], pts[3]], colour, uv)
