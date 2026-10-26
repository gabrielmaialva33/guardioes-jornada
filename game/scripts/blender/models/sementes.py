"""
Seeds for the seed missions (game/PARK.md: Ana's "Sementes para o viveiro" in the Reserva,
C3 "Vovó Jequitibá" in the Copa, M3 "Propágulos" in the Manguezal; inventory p22 section 7,
priority 4). <= 60 tris each.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/sementes.py [-- --no-render]

Files (in $CUSTOM_RAW_DIR; bake.py prefixes them with custom-). The names avoid "pau-brasil"
and "mangue-vermelho", which bake.py reserves for the trees' foliage path:
- semente-paubrasil.glb: a ripe pau-brasil pod lying on the ground, 0.45 u long.
- semente-jequitiba.glb: the jequitibá "cuia" (the woody fruit), standing, 0.4 u tall.
- propagulo-mangue.glb: a red-mangrove propagule lying on the mud, 0.8 u long.
- propagulo-mangue-plantado.glb: the same propagule planted upright in a mud mound, with its
  first pair of leaves (the "planted" state of M3), 0.75 u tall.

Scale: the propagule follows the props factor (a 25 cm hypocotyl x 1.5 is 0.8 u). The pod and
the cuia would be 0.2-0.25 u at x1.5, a speck next to the 3 u avatar, so they are drawn at about
x3, in the size class of the collectibles already in the game (lixo-lata 0.3 u, cacho-jucara
0.55 u).

Botany (simplified, never false):
- Pau-brasil (Paubrasilia echinata): the fruit is a flat, slightly sickle-shaped legume pod
  covered in prickles, brown when ripe; it opens and twists to release the seeds. Flora e Funga
  do Brasil, https://floradobrasil.jbrj.gov.br (Paubrasilia echinata); Lorenzi, Árvores
  Brasileiras vol. 1. -> a flattened pod with a pale suture rim and prickles, wood ramp.
- Jequitibá-rosa (Cariniana legalis): the fruit is a woody pyxidium, cylindrical-conical, about
  7-8 cm long, whose lid falls off to free the winged seeds around a central column (popular
  names "cumbuca/pito-de-macaco"). Flora e Funga do Brasil (Cariniana legalis); Lorenzi vol. 1.
  -> an open woody cup with a rim, a dark inside and the column, standing slightly tilted.
- Mangue-vermelho (Rhizophora mangle): viviparous; the propagule is a green, cigar-shaped
  hypocotyl 15-30 cm long, pointed at the root end, with the brown fruit cap at the top; planted
  in the mud it roots and opens its first pair of leaves at the top. Tomlinson, The Botany of
  Mangroves (2016). -> grass-ramp hypocotyl, wood[0] cap, leaf[1]/leaf[2] first leaves.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
import _props as P  # noqa: E402
from _props import G, L, S, W  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402


def build_pod():
    m = C.Mesh("semente-paubrasil")
    # Centreline: a slight sickle in the ground plane (Blender XY), the pod lying flat.
    length = 0.45
    # Stations along the pod: blunt rounded ends (short end fans), widest in the middle.
    stations = [(0.0, 0.0, 0.0), (0.07, 0.05, 0.02), (0.35, 0.082, 0.034), (0.65, 0.082, 0.034),
                (0.93, 0.05, 0.02), (1.0, 0.0, 0.0)]
    n = len(stations)
    pts, half_w, half_t = [], [], []
    for t, hw, ht in stations:
        x = (t - 0.5) * length
        y = 0.06 * math.sin(math.pi * t) - 0.02
        pts.append(Vector((x, y, 0.0)))
        half_w.append(hw)
        half_t.append(ht)
    lift = 0.04
    rings = []
    for i, c in enumerate(pts):
        tan = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = tan.cross(Vector((0, 0, 1))).normalized()
        z = lift
        # diamond section: side +, top, side -, bottom
        rings.append([c + side * half_w[i] + Vector((0, 0, z)), c + Vector((0, 0, z + half_t[i])),
                      c - side * half_w[i] + Vector((0, 0, z)), c + Vector((0, 0, z - half_t[i]))])
    cols = [W[1], W[1], W[0], W[0]]  # faces after corner k: top-front, top-back, bottom-back, bottom-front
    rims = [W[2], W[1], W[1], W[2]]
    for i in range(n - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            k1 = (k + 1) % 4
            col = cols[k] if 0 < i < n - 2 else rims[k]
            if i == 0:
                m.add_out([a[0], b[k1], b[k]], col, pts[1] + Vector((0, 0, lift)))
            elif i == n - 2:
                m.add_out([a[k], a[k1], b[0]], col, pts[-2] + Vector((0, 0, lift)))
            else:
                m.add_out([a[k], a[k1], b[k1], b[k]], col, (pts[i] + pts[i + 1]) / 2 + Vector((0, 0, lift)))
    # Prickles: small three-sided spikes on the top and the bottom faces.
    for i, (u, sgn) in enumerate([(0.3, 1), (0.5, 1), (0.7, 1), (0.42, -1), (0.62, -1), (0.22, 1), (0.8, -1),
                                  (0.55, 1)]):
        j = max(k for k in range(n - 1) if stations[k][0] <= u)
        f = (u - stations[j][0]) / (stations[j + 1][0] - stations[j][0])
        c = pts[j].lerp(pts[j + 1], f) + Vector((0, 0, lift))
        tan = (pts[j + 1] - pts[j]).normalized()
        side = tan.cross(Vector((0, 0, 1))).normalized()
        ht = half_t[j] * (1 - f) + half_t[j + 1] * f
        off = side * (0.03 * (1 if i % 2 else -1))
        base = c + off + Vector((0, 0, sgn * ht * 0.7))
        r = 0.016
        tri = [base + tan * r, base + side * r - tan * r * 0.5, base - side * r - tan * r * 0.5]
        tip = base + Vector((0, 0, sgn * 0.032)) + off * 0.4
        for k in range(3):
            m.add_out([tri[k], tri[(k + 1) % 3], tip], W[0], base - Vector((0, 0, sgn * 0.02)))
    return C.build_object(m, "semente-paubrasil")


def build_cuia():
    m = C.Mesh("semente-jequitiba")
    n = 7  # 7 sides keep it at 59 tris
    h, r_mouth, r_inner, r_mid = 0.38, 0.14, 0.11, 0.115

    def ring(r, z):
        return [Vector((math.cos(2 * math.pi * k / n + 0.2) * r, math.sin(2 * math.pi * k / n + 0.2) * r, z))
                for k in range(n)]

    tip = Vector((0, 0, 0.0))
    base = ring(0.075, 0.07)
    mid = ring(r_mid, 0.2)
    mouth = ring(r_mouth, h)
    inner = ring(r_inner, h - 0.01)
    inside = Vector((0, 0, h - 0.12))
    ctr = Vector((0, 0, h * 0.5))
    for k in range(n):
        k1 = (k + 1) % n
        m.add_out([tip, base[k1], base[k]], W[0], ctr)
        m.add_out([base[k], base[k1], mid[k1], mid[k]], W[1] if k % 2 else W[0], ctr)
        m.add_out([mid[k], mid[k1], mouth[k1], mouth[k]], W[1], ctr)
        m.add([mouth[k], mouth[k1], inner[k1], inner[k]], W[2])  # rim, facing up
        m.add([inner[k], inner[k1], inside], S[0])  # the dark inside, facing up
    # The central column the winged seeds sat around.
    col = [Vector((0.025, 0, h - 0.12)), Vector((-0.012, 0.022, h - 0.12)), Vector((-0.012, -0.022, h - 0.12))]
    top = Vector((0, 0, h + 0.02))
    for k in range(3):
        m.add_out([col[k], col[(k + 1) % 3], top], W[3], Vector((0, 0, h - 0.1)))
    # Stand slightly tilted, like a fruit that fell and rests on the litter.
    rot = Matrix.Rotation(math.radians(14), 4, "X")
    m.transformed(rot)
    lo = min(v.z for v in m.verts)
    m.transformed(Matrix.Translation((0, 0, -lo)))
    return C.build_object(m, "semente-jequitiba")


def propagule(m: C.Mesh, top: Vector, axis: Vector, length: float, *, cap: bool, buried: float = 0.0):
    """Hypocotyl from `top` along `axis` (towards the root tip), 6-sided. `buried` cuts that
    fraction off the root end (the part in the mud)."""
    ax = axis.normalized()
    stations = [(0.0, 0.04), (0.12, 0.05), (0.6, 0.058), (0.92, 0.03), (1.0, 0.0)]
    keep = [(t, r) for t, r in stations if t <= 1.0 - buried + 1e-6]
    if buried > 0:
        keep.append((1.0 - buried, 0.055))
    pts = [top + ax * (t * length) for t, _ in keep]
    radii = [r for _, r in keep]
    cols = [G[1], G[2], G[2], G[1]][: len(pts) - 1]
    m.tube(pts, radii, 6, G[2], cap_end=radii[-1] > 0 and not buried, cap_start=not cap, colours=cols + [G[2]], twist=0.3)
    if cap:
        # The brown fruit cap (cotyledon collar) at the top.
        m.prism(top + ax * 0.02, top - ax * 0.07, 0.062, 0.05, 6, W[0], cap0=False, cap1=True, colour_cap=S[1],
                twist=0.3)


def build_propagule():
    m = C.Mesh("propagulo-mangue")
    # Lying on the mud, slightly raised at the cap end.
    axis = Vector((1.0, 0.15, -0.09)).normalized()
    top = Vector((-0.36, -0.05, 0.11))
    propagule(m, top, axis, 0.8, cap=True)
    lo = min(v.z for v in m.verts)
    m.transformed(Matrix.Translation((0, 0, -lo)))
    return C.build_object(m, "propagulo-mangue")


def build_planted():
    m = C.Mesh("propagulo-mangue-plantado")
    # Mud mound: a low five-sided pyramid.
    n = 5
    rim = [Vector((math.cos(2 * math.pi * k / n) * 0.26, math.sin(2 * math.pi * k / n) * 0.24, 0.0)) for k in range(n)]
    apex = Vector((0, 0, 0.09))
    for k in range(n):
        m.add_out([rim[k], rim[(k + 1) % n], apex], S[0] if k % 2 else S[1], (0, 0, -0.1))
    # Upright hypocotyl, the lower 35% in the mud, root end down; plumule and first leaves on top.
    length = 0.8
    top = Vector((0.0, 0.0, 0.07 + length * 0.65))
    propagule(m, top, Vector((0.04, 0.0, -1.0)), length, cap=False, buried=0.35)
    plumule = top + Vector((0, 0, 0.09))
    m.prism(top, plumule, 0.035, 0.0, 6, G[1], twist=0.3)
    for k, sgn in enumerate((1, -1)):
        root = plumule - Vector((0, 0, 0.03))
        tip = root + Vector((sgn * 0.22, 0.03 * sgn, 0.1))
        m.blade(root, tip, 0.12, L[2] if k else L[1], colour_under=L[1], bend=Vector((0, 0, 0.03)))
    return C.build_object(m, "propagulo-mangue-plantado")


if __name__ == "__main__":
    small = {"elevation_deg": 24.0, "closeup": True, "res": (900, 900)}
    P.run_all([
        ("semente-paubrasil", build_pod, 60, "0.45 u pod (collectible, about x3)", small),
        ("semente-jequitiba", build_cuia, 60, "0.4 u woody cuia (collectible, about x3)", small),
        ("propagulo-mangue", build_propagule, 60, "0.8 u propagule (props x1.5)", small),
        ("propagulo-mangue-plantado", build_planted, 60, "0.75 u planted propagule with first leaves", small),
    ])
