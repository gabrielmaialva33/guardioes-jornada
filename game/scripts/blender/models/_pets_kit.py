"""
Polygon-soup toolkit for the Cube Pets species of the Secret Trail (bichos_mata.py).

The raw Kenney Cube Pets GLBs (CC0, kenney-raw/cube-pets) are read directly here, without
Blender's importer, into a list of faces in the model's root space (glTF axes: +Y up,
+Z front, +X the animal's left; one unit = one Cube Pets unit). Each face keeps its node,
its original palette cell and its UVs, so a species can be reshaped (delete, move, scale,
add bevelled blocks, cut along a plane) and then re-coloured by giving every face a
semantic region ("coat", "belly", "eye" ...) that maps to a cell of the species palette.

The Cube Pets palette is the 8 x 4 grid of 8 x 16 texel cells of the 64 x 64 pets palette
(assets-report.md section 3.1): u picks a column, and v runs down a cell from its light top
to its darker bottom, so every face keeps its vertical shading when it changes cell.

build() turns the faces into the rig node tree the game binds (root > body > head / tail /
wings, root > leg-*), with the head cut from the body at the neck (z = 0.3125, the pivot the
game's MODEL_RIGS use since commit d165b4a), and returns the root object for export.
"""

from __future__ import annotations

import colorsys
import json
import math
import struct
import zlib
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

NECK_Z = 0.3125
HEAD_PIVOT = (0.0, 0.625, 0.3125)  # in body space
RIG = ("root", "body", "head", "tail", "wing-left", "wing-right",
       "leg-front-left", "leg-front-right", "leg-back-left", "leg-back-right")
LEGS = ("leg-front-left", "leg-front-right", "leg-back-left", "leg-back-right")


# --------------------------------------------------------------------------- GLB reading

_COMP = {5126: ("f", 4), 5123: ("H", 2), 5125: ("I", 4), 5121: ("B", 1)}
_N = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def _read_glb(path: Path):
    buf = Path(path).read_bytes()
    jlen = struct.unpack_from("<I", buf, 12)[0]
    doc = json.loads(buf[20:20 + jlen])
    blen = struct.unpack_from("<I", buf, 20 + jlen)[0]
    binc = buf[28 + jlen:28 + jlen + blen]
    return doc, binc


def _accessor(doc, binc, i):
    a = doc["accessors"][i]
    bv = doc["bufferViews"][a["bufferView"]]
    fmt, size = _COMP[a["componentType"]]
    n = _N[a["type"]]
    stride = bv.get("byteStride", size * n)
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return [struct.unpack_from("<" + fmt * n, binc, base + k * stride) for k in range(a["count"])]


def _trs(node) -> Matrix:
    t = Vector(node.get("translation", (0, 0, 0)))
    r = node.get("rotation", (0, 0, 0, 1))
    s = node.get("scale", (1, 1, 1))
    m = Matrix.Translation(t) @ Quaternion((r[3], r[0], r[1], r[2])).to_matrix().to_4x4()
    return m @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))


class Face:
    """One polygon in root space (glTF axes) with per-corner UVs (glTF convention, v down)."""

    __slots__ = ("p", "uv", "node", "cell", "sem", "comp", "keep_v")

    def __init__(self, p, uv, node, cell, sem=None, keep_v=True):
        self.p = [Vector(x) for x in p]
        self.uv = [tuple(x) for x in uv]
        self.node = node
        self.cell = cell  # original (col, band) or None for new geometry
        self.sem = sem
        self.comp = -1
        self.keep_v = keep_v

    @property
    def centre(self) -> Vector:
        return sum(self.p, Vector()) / len(self.p)

    @property
    def normal(self) -> Vector:
        n = Vector()
        for i in range(len(self.p)):
            a, b = self.p[i], self.p[(i + 1) % len(self.p)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        return n.normalized() if n.length > 1e-12 else Vector((0, 1, 0))


class Pet:
    """A Cube Pets model as faces in root space plus its rig node pivots (root space)."""

    def __init__(self, name: str):
        self.name = name
        self.faces: list[Face] = []
        self.pivots: dict[str, Vector] = {}
        self.parents: dict[str, str] = {}

    @classmethod
    def load(cls, path: Path, name: str) -> "Pet":
        doc, binc = _read_glb(path)
        pet = cls(name)
        nodes = doc["nodes"]
        parent_of = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}

        def world(i):
            m = _trs(nodes[i])
            while i in parent_of:
                i = parent_of[i]
                m = _trs(nodes[i]) @ m
            return m

        root = next(i for i, n in enumerate(nodes) if n.get("name") == "root")
        to_root = world(root).inverted()

        def rig_owner(i):
            while i is not None:
                if nodes[i].get("name") in RIG:
                    return nodes[i]["name"]
                i = parent_of.get(i)
            return "root"

        for i, n in enumerate(nodes):
            name_i = n.get("name", "")
            if name_i in RIG and name_i != "root":
                pet.pivots[name_i] = (to_root @ world(i)).to_translation()
                pet.parents[name_i] = rig_owner(parent_of.get(i))
            if "mesh" not in n:
                continue
            m = to_root @ world(i)
            owner = rig_owner(i)
            for prim in doc["meshes"][n["mesh"]]["primitives"]:
                pos = _accessor(doc, binc, prim["attributes"]["POSITION"])
                uv = _accessor(doc, binc, prim["attributes"]["TEXCOORD_0"])
                idx = [x[0] for x in _accessor(doc, binc, prim["indices"])]
                for t in range(0, len(idx), 3):
                    tri = idx[t:t + 3]
                    uvs = [uv[k] for k in tri]
                    u = sum(x[0] for x in uvs) / 3
                    v = sum(x[1] for x in uvs) / 3
                    cell = (min(7, int(u * 8)), min(3, int(v * 4)))
                    pet.faces.append(Face([m @ Vector(pos[k]) for k in tri], uvs, owner, cell))
        pet.pivots["root"] = Vector()
        pet.label_components()
        return pet

    # ------------------------------------------------------------------ queries

    def label_components(self) -> None:
        """Connected pieces per node (vertices welded by position), for selecting ears, manes, teeth."""
        parent: dict = {}

        def find(k):
            while parent[k] != k:
                parent[k] = parent[parent[k]]
                k = parent[k]
            return k

        keys = []
        for f in self.faces:
            ks = [(f.node, round(p.x, 4), round(p.y, 4), round(p.z, 4)) for p in f.p]
            for k in ks:
                parent.setdefault(k, k)
            for a, b in zip(ks, ks[1:]):
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[ra] = rb
            keys.append(ks[0])
        ids: dict = {}
        for f, k in zip(self.faces, keys):
            f.comp = ids.setdefault(find(k), len(ids))

    def components(self, node: str | None = None) -> dict[int, list[Face]]:
        out: dict[int, list[Face]] = {}
        for f in self.faces:
            if node is None or f.node == node:
                out.setdefault(f.comp, []).append(f)
        return out

    def describe(self) -> str:
        lines = [f"== {self.name}: {self.tris()} tris"]
        for comp, faces in sorted(self.components().items()):
            pts = [p for f in faces for p in f.p]
            lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
            hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            cells = sorted({f.cell for f in faces})
            lines.append(f"  comp {comp:3d} {faces[0].node:16s} tris {len(faces):4d} cells {cells} "
                         f"x[{lo.x:.2f},{hi.x:.2f}] y[{lo.y:.2f},{hi.y:.2f}] z[{lo.z:.2f},{hi.z:.2f}]")
        return "\n".join(lines)

    def tris(self) -> int:
        return sum(len(f.p) - 2 for f in self.faces)

    # ------------------------------------------------------------------ edits

    def delete(self, pred) -> int:
        before = len(self.faces)
        self.faces = [f for f in self.faces if not pred(f)]
        return before - len(self.faces)

    def delete_node(self, node: str) -> None:
        self.delete(lambda f: f.node == node)
        self.pivots.pop(node, None)
        self.parents.pop(node, None)

    def transform(self, pred, fn) -> None:
        """Moves every vertex of the faces `pred` selects: fn(Vector) -> Vector (root space).
        Shared corners move once per face, so fn must be a pure function of the position."""
        for f in self.faces:
            if pred(f):
                f.p = [Vector(fn(p.copy())) for p in f.p]

    def move_node(self, node: str, offset) -> None:
        """Moves a node, its faces and its pivot (children of it are not moved)."""
        d = Vector(offset)
        self.transform(lambda f: f.node == node, lambda p: p + d)
        self.pivots[node] = self.pivots[node] + d

    def label(self, pred, sem: str) -> int:
        n = 0
        for f in self.faces:
            if pred(f):
                f.sem = sem
                n += 1
        return n

    def cut(self, pred, normal, offset: float) -> None:
        """Splits the faces `pred` selects along the plane normal·p = offset (Sutherland-Hodgman
        both sides, UVs interpolated): the parts on each side become separate faces."""
        n = Vector(normal).normalized()
        out: list[Face] = []
        for f in self.faces:
            if not pred(f):
                out.append(f)
                continue
            d = [n.dot(p) - offset for p in f.p]
            if all(x >= -1e-7 for x in d) or all(x <= 1e-7 for x in d):
                out.append(f)
                continue
            for side in (1, -1):
                pts, uvs = [], []
                k = len(f.p)
                for i in range(k):
                    j = (i + 1) % k
                    di, dj = d[i] * side, d[j] * side
                    if di >= 0:
                        pts.append(f.p[i])
                        uvs.append(f.uv[i])
                    if (di >= 0) != (dj >= 0):
                        t = di / (di - dj)
                        pts.append(f.p[i].lerp(f.p[j], t))
                        uvs.append(tuple(f.uv[i][c] + (f.uv[j][c] - f.uv[i][c]) * t for c in (0, 1)))
                if len(pts) >= 3:
                    g = Face(pts, uvs, f.node, f.cell, f.sem, f.keep_v)
                    g.comp = f.comp
                    out.append(g)
        self.faces = out

    def add_box(self, node: str, lo, hi, sem: str, bevel: float = 0.03, rot: Matrix | None = None,
                about=None, skip=()) -> None:
        """A bevelled block, the Cube Pets way (Kenney's legs are 0.375 boxes with ~0.03
        chamfers): 6 inset faces, 12 edge strips and 8 corner triangles (44 tris). `rot`
        turns it about `about` (default: its centre); `skip` drops sides ('px','nx','py','ny','pz','nz')."""
        lo, hi = Vector(lo), Vector(hi)
        c = (lo + hi) / 2
        h = (hi - lo) / 2
        b = min(bevel, *(h * 0.45))
        pivot = Vector(about) if about is not None else c
        r = rot or Matrix.Identity(3)

        def P(sx, sy, sz, ex=0, ey=0, ez=0):
            # corner (sx,sy,sz in ±1) pulled in by the bevel on the axes not in (ex,ey,ez)
            q = Vector((sx * (h.x - (0 if ex else b)), sy * (h.y - (0 if ey else b)), sz * (h.z - (0 if ez else b))))
            return pivot + r @ (c + q - pivot)

        faces = []
        # main faces
        for axis, name in ((0, "x"), (1, "y"), (2, "z")):
            for s, tag in ((1, "p"), (-1, "n")):
                if tag + name in skip:
                    continue
                o = [0, 0, 0]
                o[axis] = 1
                a1, a2 = [k for k in range(3) if k != axis]
                quad = []
                for u, v in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    sv = [0, 0, 0]
                    sv[axis] = s
                    sv[a1] = u
                    sv[a2] = v
                    quad.append(P(*sv, *o))
                faces.append(quad)
        # edge strips between faces (x-y, x-z, y-z edges) and corner triangles
        if b > 1e-6:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    faces.append([P(sx, sy, -1, 1, 0, 0), P(sx, sy, 1, 1, 0, 0), P(sx, sy, 1, 0, 1, 0), P(sx, sy, -1, 0, 1, 0)])
                for sz in (-1, 1):
                    faces.append([P(sx, -1, sz, 1, 0, 0), P(sx, 1, sz, 1, 0, 0), P(sx, 1, sz, 0, 0, 1), P(sx, -1, sz, 0, 0, 1)])
            for sy in (-1, 1):
                for sz in (-1, 1):
                    faces.append([P(-1, sy, sz, 0, 1, 0), P(1, sy, sz, 0, 1, 0), P(1, sy, sz, 0, 0, 1), P(-1, sy, sz, 0, 0, 1)])
            for sx in (-1, 1):
                for sy in (-1, 1):
                    for sz in (-1, 1):
                        faces.append([P(sx, sy, sz, 1, 0, 0), P(sx, sy, sz, 0, 1, 0), P(sx, sy, sz, 0, 0, 1)])
        inside = pivot + r @ (c - pivot)
        for quad in faces:
            f = Face(quad, [(0, 0)] * len(quad), node, None, sem, keep_v=False)
            if f.normal.dot(f.centre - inside) < 0:
                f.p.reverse()
            self.faces.append(f)

    def add_faces(self, faces: list[Face]) -> None:
        self.faces.extend(faces)

    # ------------------------------------------------------------------ the rig

    def split_head(self, from_node: str = "body", cap: tuple = (0.48, 0.14, 1.11), neck: float = NECK_Z,
                   pivot: tuple = HEAD_PIVOT) -> None:
        """The head node: every body face in front of the neck plane (body space z ≥ `neck`,
        0.3125 on the Cube Pets), with a 2-triangle cap on each side of the cut so a turned
        head never shows the inside. `cap` is (half width, bottom, top) in body space."""
        body = self.pivots[from_node]
        z = body.z + neck
        self.cut(lambda f: f.node == from_node, (0, 0, 1), z)
        for f in self.faces:
            if f.node == from_node and f.centre.z > z + 1e-6:
                f.node = "head"
        self.pivots["head"] = body + Vector(pivot)
        self.parents["head"] = from_node
        x, y0, y1 = cap
        for node, sign in ((from_node, 1), ("head", -1)):
            q = [Vector((-x, body.y + y0, z)), Vector((x, body.y + y0, z)), Vector((x, body.y + y1, z)), Vector((-x, body.y + y1, z))]
            f = Face(q if sign > 0 else q[::-1], [(0, 0)] * 4, node, None, "neck", keep_v=False)
            self.faces.append(f)

    # ------------------------------------------------------------------ output

    def assign_cells(self, order: list[str]) -> dict[str, tuple[int, int]]:
        """One palette cell per semantic region, in `order` (row-major over the 8 x 4 grid)."""
        missing = sorted({f.sem for f in self.faces if f.sem not in order}, key=str)
        if missing:
            raise ValueError(f"{self.name}: faces without a palette region: {missing}")
        cells = {sem: (i % 8, i // 8) for i, sem in enumerate(order)}
        spans: dict = {}
        for f in self.faces:
            col, band = cells[f.sem]
            if f.keep_v and f.cell is not None:
                # keep the shading row inside the cell
                vs = [min(15.9, max(0.1, uv[1] * 64 - f.cell[1] * 16)) for uv in f.uv]
            else:
                ys = [p.y for p in f.p]
                key = (f.node, f.sem)
                if key not in spans:
                    spans[key] = self._part_span(f)
                lo, hi = spans[key]
                vs = [1.6 + 12.8 * (1 - (y - lo) / (hi - lo)) if hi - lo > 1e-6 else 8.0 for y in ys]
            f.uv = [((col * 8 + 4.5) / 64, (band * 16 + v) / 64) for v in vs]
        return cells

    def _part_span(self, f: Face) -> tuple[float, float]:
        pts = [p.y for g in self.faces if g.node == f.node and g.sem == f.sem and not g.keep_v for p in g.p]
        return (min(pts), max(pts)) if pts else (0.0, 1.0)

    def build(self, material) -> bpy.types.Object:
        """Blender objects for the rig tree: one mesh per rig node (glTF → Blender: (x, -z, y))."""
        def b(v: Vector) -> Vector:
            return Vector((v.x, -v.z, v.y))

        top = bpy.data.objects.new(f"animal-{self.name}", None)
        bpy.context.scene.collection.objects.link(top)
        objs = {"root": bpy.data.objects.new("root", None)}
        bpy.context.scene.collection.objects.link(objs["root"])
        objs["root"].parent = top
        order = ["body", "head", "tail", "wing-left", "wing-right", *LEGS]
        nodes = [n for n in order if n in self.pivots]
        for n in nodes:
            faces = [f for f in self.faces if f.node == n]
            piv = self.pivots[n]
            mesh = bpy.data.meshes.new(n)
            verts, polys, uvs = [], [], []
            for f in faces:
                base = len(verts)
                verts.extend(b(p - piv) for p in f.p)
                polys.append(list(range(base, base + len(f.p))))
                uvs.extend((u, 1 - v) for u, v in f.uv)
            mesh.from_pydata(verts, [], polys)
            layer = mesh.uv_layers.new(name="UVMap")
            for i, uv in enumerate(uvs):
                layer.data[i].uv = uv
            for poly in mesh.polygons:
                poly.use_smooth = False
            mesh.materials.append(material)
            mesh.validate()
            ob = bpy.data.objects.new(n, mesh)
            bpy.context.scene.collection.objects.link(ob)
            objs[n] = ob
        for n in nodes:
            parent = self.parents.get(n, "root")
            objs[n].parent = objs[parent]
            objs[n].location = b(self.pivots[n] - self.pivots[parent])
        return top

    def stats(self) -> dict:
        per = {}
        for f in self.faces:
            per[f.node] = per.get(f.node, 0) + len(f.p) - 2
        return per


# --------------------------------------------------------------------------- palettes


def hex_rgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _clamp_l(rgb, lo=0.125, hi=0.885):
    h, l, s = colorsys.rgb_to_hls(*rgb)
    return colorsys.hls_to_rgb(h, min(hi, max(lo, l)), s)


def cell_column(spec) -> list[tuple[float, float, float]]:
    """16 rows of one cell: a hex (light top to a darker bottom, as Kenney's palette shades),
    or ("stripes", hex_a, hex_b, rows) for horizontal bands, or ("rows", [hex x 16])."""
    if isinstance(spec, str):
        r, g, b = hex_rgb(spec)
        out = []
        for i in range(16):
            k = 1.06 - 0.2 * i / 15  # +6% at the top, -14% at the bottom
            out.append(_clamp_l((min(1, r * k), min(1, g * k), min(1, b * k))))
        return out
    kind = spec[0]
    if kind == "stripes":
        a, bb, rows = cell_column(spec[1]), cell_column(spec[2]), spec[3]
        return [bb[i] if (i // rows) % 2 else a[i] for i in range(16)]
    if kind == "rows":
        return [_clamp_l(hex_rgb(h)) for h in spec[1]]
    raise ValueError(spec)


def write_palette(path: Path, cells: dict[str, tuple[int, int]], colours: dict, fill: str = "#1e4d36") -> None:
    """64 x 64 RGB PNG: every assigned cell painted from colours[sem]; the rest `fill`
    (the darkest leaf tone, inside ART.md's lightness range, as unused cells in the
    repo's species palettes are)."""
    px = [[hex_rgb(fill)] * 64 for _ in range(64)]
    for sem, (col, band) in cells.items():
        column = cell_column(colours[sem])
        for row in range(16):
            for x in range(8):
                px[band * 16 + row][col * 8 + x] = column[row]
    raw = b"".join(b"\x00" + bytes(int(round(c * 255)) for rgb in line for c in rgb) for line in px)

    def chunk(t, data):
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(png)


def palette_material(name: str, png: Path):
    img = bpy.data.images.load(str(png), check_existing=False)
    img.name = f"palette-{name}"
    mat = bpy.data.materials.new(f"palette-{name}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def deg(a: float) -> float:
    return math.radians(a)
