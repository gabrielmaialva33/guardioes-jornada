"""
Ground cover v2 assets (ART.md sections 1, 4, 5 & d-assets.md section 5.3):
  - `samambaia.glb` (`custom-samambaia.glb`): ground fern rosette, <= 150 tris, ~0.85 u tall
  - `flores-mata.glb` (`custom-flores-mata.glb`): native forest wildflowers cluster, <= 150 tris, ~0.75 u tall
  - `serapilheira.glb` (`custom-serapilheira.glb`): forest floor leaf-litter patch, <= 150 tris, ~2.2 u wide

All carry 'up' normals ((0, 0, 1) in Blender Z-up -> (0, 1, 0) in glTF Y-up) and a 3-step
base-to-tip vertex colour gradient so they blend into the ground and never show black edges.

Run:
  /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/ground_cover_v2.py [-- --no-render]
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

LEAF0 = C.ramp("leaf", 0)
LEAF1 = C.ramp("leaf", 1)
LEAF2 = C.ramp("leaf", 2)
LEAF3 = C.ramp("leaf", 3)

GRASS1 = C.ramp("grass", 1)
GRASS2 = C.ramp("grass", 2)
GRASS3 = C.ramp("grass", 3)

SOIL0 = C.ramp("soil", 0)
SOIL1 = C.ramp("soil", 1)
SOIL2 = C.ramp("soil", 2)
SOIL3 = C.ramp("soil", 3)

WOOD1 = C.ramp("wood", 1)
WOOD2 = C.ramp("wood", 2)

IPE_AMARELO = C.ACCENT["ipeAmarelo"]
IPE_ROSA = C.ACCENT["ipeRosa"]
BROMELIA_RED = C.SPECIES["bromeliaVermelho"]


def build_samambaia():
    """Ground fern (samambaia) rosette: 11 arching two-segment fronds + 2 inner young fronds
    with 'up' normals (104 tris <= 150)."""
    m = C.Mesh("samambaia")
    # 7 outer arching fern fronds (7 x 8 = 56 tris)
    for i in range(7):
        a = (2 * math.pi * i / 7) + 0.15
        d = Vector((math.cos(a), math.sin(a), 0))
        p0 = d * 0.05 + Vector((0, 0, 0.04))
        p_mid = d * 0.46 + Vector((0, 0, 0.56 + 0.05 * (i % 2)))
        p_tip = d * (0.82 + 0.06 * (i % 3)) + Vector((0, 0, 0.24 + 0.04 * (i % 2)))
        m.blade(p0, p_mid, 0.30, LEAF2, mid=0.55, bend=Vector((0, 0, 0.10)), colour_under=LEAF1)
        m.blade(p_mid - d * 0.06, p_tip, 0.34, LEAF3 if i % 2 == 0 else LEAF2, mid=0.40, bend=Vector((0, 0, 0.08)), colour_under=LEAF1)

    # 5 inner ascending young fronds (5 x 8 = 40 tris -> 96 tris total)
    for i in range(5):
        a = (2 * math.pi * i / 5) + 0.52
        d = Vector((math.cos(a), math.sin(a), 0))
        p0 = d * 0.03 + Vector((0, 0, 0.06))
        p_mid = d * 0.26 + Vector((0, 0, 0.62))
        p_tip = d * 0.48 + Vector((0, 0, 0.84 - 0.04 * (i % 2)))
        m.blade(p0, p_mid, 0.24, GRASS3, mid=0.55, bend=Vector((0, 0, 0.08)), colour_under=LEAF2)
        m.blade(p_mid - d * 0.04, p_tip, 0.26, LEAF3, mid=0.42, bend=Vector((0, 0, 0.06)), colour_under=LEAF2)

    return C.apply_v2_foliage(C.build_object(m, "samambaia"), mode="cover")


def build_flores_mata():
    """Native Atlantic Forest wildflowers cluster: broad tropical basal leaves + 3 flower
    spikes in ipê-rosa, ipê-amarelo and bromeliad red (112 tris <= 150)."""
    m = C.Mesh("flores-mata")
    # 7 broad basal tropical leaves (7 x 4 = 28 tris)
    for i in range(7):
        a = (2 * math.pi * i / 7) + 0.2
        d = Vector((math.cos(a), math.sin(a), 0))
        m.blade(
            d * 0.05 + Vector((0, 0, 0.03)),
            d * (0.64 + 0.06 * (i % 2)) + Vector((0, 0, 0.34 + 0.05 * (i % 3))),
            0.34,
            LEAF2 if i % 2 else LEAF3,
            mid=0.52,
            bend=Vector((0, 0, 0.08)),
            colour_under=LEAF1,
        )

    # 3 flower stalks with 4 blossom petals each (3 x (8 + 16) = 72 tris -> 100 tris total)
    stalks = [
        ((-0.18, -0.10, 0.04), (-0.24, -0.14, 0.68), IPE_ROSA, IPE_AMARELO),
        ((0.20, -0.06, 0.04), (0.26, -0.08, 0.74), IPE_AMARELO, BROMELIA_RED),
        ((0.02, 0.20, 0.04), (0.04, 0.25, 0.62), BROMELIA_RED, IPE_AMARELO),
    ]
    for p0, p1, petal_col, center_col in stalks:
        v0, v1 = Vector(p0), Vector(p1)
        m.prism(v0, v1, 0.035, 0.025, 3, GRASS1, cap0=False, cap1=True, colour_cap=center_col)
        for k in range(4):
            ang = (2 * math.pi * k / 4) + 0.35
            pd = Vector((math.cos(ang), math.sin(ang), 0))
            m.blade(
                v1 - Vector((0, 0, 0.04)),
                v1 + pd * 0.24 + Vector((0, 0, 0.06)),
                0.18,
                petal_col,
                mid=0.55,
                bend=Vector((0, 0, 0.04)),
                colour_under=petal_col,
            )

    return C.apply_v2_foliage(C.build_object(m, "flores-mata"), mode="cover")


def build_serapilheira():
    """Forest-floor leaf-litter patch: irregular layered patch of fallen dry leaves, humus,
    twigs and a few fallen petals (~2.2 u wide, <= 150 tris)."""
    m = C.Mesh("serapilheira")
    # Base humus/leaf-mold octagon (6 tris)
    base_pts = []
    for k in range(8):
        a = 2 * math.pi * k / 8 + 0.15
        r = 0.95 + (0.18 if k % 2 == 0 else -0.10)
        base_pts.append(Vector((math.cos(a) * r, math.sin(a) * r, 0.015)))
    m.add(base_pts, SOIL1)

    # 14 scattered fallen leaves and petals on the forest floor (14 x 4 = 56 tris -> 62 tris total)
    leaves = [
        (-0.55, -0.35, 0.42, 0.26, 0.4, SOIL2),
        (0.48, -0.42, 0.45, 0.28, 1.2, WOOD2),
        (-0.22, 0.52, 0.44, 0.26, 2.1, SOIL3),
        (0.58, 0.32, 0.40, 0.25, 2.8, SOIL2),
        (0.05, -0.18, 0.48, 0.30, 0.9, WOOD1),
        (-0.68, 0.18, 0.38, 0.24, 1.7, SOIL0),
        (0.22, 0.65, 0.36, 0.22, 0.3, LEAF1),
        (-0.38, -0.68, 0.38, 0.24, 2.5, SOIL3),
        (0.75, -0.08, 0.36, 0.22, 1.9, WOOD2),
        (-0.08, 0.22, 0.42, 0.26, 3.0, SOIL2),
        (0.32, 0.12, 0.26, 0.18, 0.7, IPE_AMARELO),
        (-0.42, 0.05, 0.24, 0.16, 2.2, IPE_ROSA),
        (0.12, -0.58, 0.25, 0.17, 1.4, IPE_AMARELO),
        (-0.18, 0.78, 0.34, 0.20, 0.8, LEAF2),
    ]
    for cx, cy, length, width, ang, col in leaves:
        d = Vector((math.cos(ang), math.sin(ang), 0))
        p0 = Vector((cx, cy, 0.025)) - d * (length * 0.5)
        p1 = Vector((cx, cy, 0.045)) + d * (length * 0.5)
        m.blade(p0, p1, width, col, mid=0.5, bend=Vector((0, 0, 0.015)), colour_under=SOIL0)

    return C.apply_v2_foliage(C.build_object(m, "serapilheira"), mode="cover")


if __name__ == "__main__":
    small = {"elevation_deg": 24.0, "closeup": True, "res": (900, 900)}
    C.run(build_samambaia, name="samambaia", budget=150, target="~0.85 u ground fern", preview_kw=small)
    C.run(build_flores_mata, name="flores-mata", budget=150, target="~0.75 u forest wildflowers", preview_kw=small)
    C.run(build_serapilheira, name="serapilheira", budget=150, target="~2.2 u leaf-litter patch", preview_kw=small)
