"""
Shared helpers for the park props of P26 (game/PARK.md, inventory section 7): walkway modules,
trail marks, the Casa da Iara, seeds, small field gear, coast animals and the landmark
assemblies. Built on _common.py, so every colour comes from palette.ts (RAMPS/ACCENT) unless a
generator documents a species colour next to its use.

Conventions on top of _common.py:
- Origins sit on the ground (or on the attach surface), with every vertex at z >= 0, because
  bake.py lays a ground plane at z = 0 for the AO bake. Attach points that are not the origin
  (ladder ends, the zipline cable, the trunk surface) are named empties exported with the GLB
  (gltfpack -kn keeps them), and are listed in the generator's docstring in glTF axes
  (x right, y up, z towards the model's front).
- Wood structures use the per-part tone rule of story_map.py: the walking or top surface in the
  light tones (wood[2], wood[3]), posts and rails in wood[1]/wood[2], beams and stringers in
  wood[0]. Thatch is wood[3] over wood[2]; ropes and nets are soil[3].
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

W = [C.ramp("wood", i) for i in range(4)]
S = [C.ramp("soil", i) for i in range(4)]
R = [C.ramp("rock", i) for i in range(4)]
L = [C.ramp("leaf", i) for i in range(4)]
G = [C.ramp("grass", i) for i in range(4)]
A = [C.ramp("water", i) for i in range(4)]
GOLD = C.ACCENT["gold"]
IPE_AMARELO = C.ACCENT["ipeAmarelo"]
IPE_ROSA = C.ACCENT["ipeRosa"]
ROPE = S[3]


def basis(d: Vector, up: Vector | None = None) -> Matrix:
    """3x3 rotation whose local Y runs along `d` and local Z is as close to `up` as possible."""
    y = Vector(d).normalized()
    x = y.cross(up or Vector((0, 0, 1)))
    if x.length < 1e-6:
        x = y.cross(Vector((1, 0, 0)))
    x.normalize()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed()


def beam(m: C.Mesh, p0, p1, w: float, h: float, colour: str, *, colours: dict | None = None, up=None,
         ends: bool = True, skip=()) -> None:
    """A box of section w x h from p0 to p1 (a rail, brace, stringer or log); `top` is the face
    nearest `up`. ends=False leaves the two end faces open (where it meets another piece)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    sk = set(skip)
    if not ends:
        sk |= {"py", "ny"}
    m.box((p0 + p1) / 2, (w, d.length, h), colour, rot=basis(d, up), colours=colours, skip=tuple(sk))


def post(m: C.Mesh, x: float, y: float, z0: float, z1: float, size: float, colour: str, top: str | None = None,
         cap: bool = True) -> None:
    """A square vertical post; no bottom face (it stands on something)."""
    skip = ("bottom",) if cap else ("bottom", "top")
    m.box((x, y, (z0 + z1) / 2), (size, size, z1 - z0), colour, skip=skip, colours={"top": top or colour})


def plank_floor(m: C.Mesh, centre, size_x: float, size_y: float, thick: float, n: int, tones=(W[2], W[3]),
                side: str = W[1], bottom: str = W[0], along: str = "x") -> None:
    """A deck slab whose top is split into n plank strips of alternating tones (the painted look
    of ponte-madeira) and whose sides and bottom are one closed box. `along` is the plank axis."""
    c = Vector(centre)
    m.box((c.x, c.y, c.z - thick / 2), (size_x, size_y, thick), side, skip=("top",), colours={"bottom": bottom})
    for k in range(n):
        if along == "x":
            y0 = c.y - size_y / 2 + size_y * k / n
            y1 = c.y - size_y / 2 + size_y * (k + 1) / n
            pts = [(c.x - size_x / 2, y0, c.z), (c.x + size_x / 2, y0, c.z), (c.x + size_x / 2, y1, c.z),
                   (c.x - size_x / 2, y1, c.z)]
        else:
            x0 = c.x - size_x / 2 + size_x * k / n
            x1 = c.x - size_x / 2 + size_x * (k + 1) / n
            pts = [(x0, c.y - size_y / 2, c.z), (x1, c.y - size_y / 2, c.z), (x1, c.y + size_y / 2, c.z),
                   (x0, c.y + size_y / 2, c.z)]
        m.add(pts, tones[k % len(tones)])


def polygon_floor(m: C.Mesh, outline: list, z_top: float, thick: float, n: int, tones=(W[2], W[3]),
                  side: str = W[1], bottom: str = W[0]) -> None:
    """A convex deck slab of any outline (counter-clockwise, seen from above) with its top split
    into n plank strips across Y, clipped to the outline."""
    pts = [Vector((p[0], p[1], 0)) for p in outline]
    k = len(pts)
    for i in range(k):
        a, b = pts[i], pts[(i + 1) % k]
        m.add([(a.x, a.y, z_top - thick), (b.x, b.y, z_top - thick), (b.x, b.y, z_top), (a.x, a.y, z_top)], side)
    m.add([(p.x, p.y, z_top - thick) for p in reversed(pts)], bottom)
    ys = [p.y for p in pts]
    y_lo, y_hi = min(ys), max(ys)
    for s in range(n):
        y0 = y_lo + (y_hi - y_lo) * s / n
        y1 = y_lo + (y_hi - y_lo) * (s + 1) / n
        strip = _clip_band(pts, y0, y1)
        if len(strip) >= 3:
            m.add([(p.x, p.y, z_top) for p in strip], tones[s % len(tones)])


def _clip_band(poly: list, y0: float, y1: float) -> list:
    def clip(points, keep, inter):
        out = []
        for i in range(len(points)):
            a, b = points[i], points[(i + 1) % len(points)]
            ka, kb = keep(a), keep(b)
            if ka:
                out.append(a)
            if ka != kb:
                out.append(inter(a, b))
        return out

    def at_y(y):
        return lambda a, b: a.lerp(b, (y - a.y) / (b.y - a.y))

    p = clip(poly, lambda v: v.y >= y0 - 1e-9, at_y(y0))
    p = clip(p, lambda v: v.y <= y1 + 1e-9, at_y(y1)) if p else p
    # drop repeated points
    out = []
    for v in p:
        if not out or (v - out[-1]).length > 1e-6:
            out.append(v)
    if len(out) > 1 and (out[0] - out[-1]).length < 1e-6:
        out.pop()
    return out


# --------------------------------------------------------------------------- the mico paw mark

# Golden lion tamarin hand print, stylised for the trail marks: a palm pad, four long fingers
# and a thumb set low on the side (primate hands; Leontopithecus has long slender digits).
# Points in mark units (the mark square is 1 x 1, centre 0, 0).
PAW_PALM = [(-0.20, -0.33), (0.13, -0.36), (0.25, -0.16), (0.21, 0.08), (-0.02, 0.15), (-0.22, 0.02)]
PAW_DIGITS = [  # (base, tip, width)
    ((-0.18, 0.12), (-0.30, 0.38), 0.11),
    ((-0.05, 0.17), (-0.09, 0.45), 0.11),
    ((0.08, 0.16), (0.12, 0.44), 0.11),
    ((0.19, 0.08), (0.31, 0.32), 0.10),
    ((-0.22, -0.12), (-0.39, -0.02), 0.10),  # thumb
]


def paw_polygons(scale: float = 1.0) -> list[list[tuple[float, float]]]:
    polys = [[(x * scale, y * scale) for x, y in PAW_PALM]]
    for (bx, by), (tx, ty), w in PAW_DIGITS:
        b, t = Vector((bx, by)), Vector((tx, ty))
        d = (t - b).normalized()
        n = Vector((-d.y, d.x)) * (w / 2)
        tip_in = t - d * (w * 0.45)
        polys.append([tuple(v * scale) for v in (b + n, b - n, tip_in - n * 0.85, t, tip_in + n * 0.85)])
    return polys


def place_2d(origin: Vector, right: Vector, up: Vector, pts2d, lift: Vector = Vector()) -> list[Vector]:
    return [origin + right * x + up * y + lift for x, y in pts2d]


def paw(m: C.Mesh, origin, right, up, size: float, colour: str, depth=None) -> None:
    """The paw on a plane (origin = mark centre; right x up = the outward normal). `depth(x)`
    optionally pushes each polygon back along the normal (to follow a curved trunk)."""
    o, r, u = Vector(origin), Vector(right).normalized(), Vector(up).normalized()
    nrm = r.cross(u)
    for poly in paw_polygons(size):
        cx = sum(p[0] for p in poly) / len(poly)
        lift = -nrm * depth(cx) if depth else Vector()
        m.add(place_2d(o, r, u, poly, lift), colour)


def tris_of(m: C.Mesh, start_faces: int = 0) -> int:
    return sum(len(f) - 2 for f in m.faces[start_faces:])


def run_all(items):
    """items: (name, build, budget, target, preview_kw)."""
    out = []
    for name, build, budget, target, kw in items:
        out.append(C.run(build, name=name, budget=budget, target=target, preview_kw=kw))
    return out
