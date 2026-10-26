"""
Jequitibá-rosa (Cariniana legalis), the landmark emergent tree, ~18 u (ART.md section 3),
<= 400 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/jequitiba.py

Shape decisions and sources:
- Emergent of the upper stratum, "Tronco: reto, cilíndrico e colunar", "Copa ampla e
  globosa, em forma de guarda-chuva": Embrapa, Espécies Arbóreas Brasileiras v.1,
  Jequitibá-rosa, https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140093/1/Especies-Arboreas-Brasileiras-vol-1-Jequitiba-Rosa.pdf
  and https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/370829/1/CPATCCIR.TEC.2501.pdf
  ("comumente com 30 m a 50 m de altura ... copa em forma de guarda-chuva").
- Bark: "casca externa é marrom-escura a parda, rugosa ... profundamente sulcada" (the
  reddish part is only the inner bark), so the trunk is the darkest wood tone, wood[0].
- Very thick trunk with a flared base, bare for two thirds of the height, a few thick
  limbs opening into a broad, high umbrella crown; the crown is kept narrower than real
  (about 13 u) so the landmark stays in frame.

Blocky language: 6-sided trunk, 5-sided limbs, Nature Kit-style chamfered octagon and
hexagon canopy blocks.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

BARK = C.ramp("wood", 0)
CROWN_LOW = C.ramp("leaf", 1)
CROWN_HIGH = C.ramp("leaf", 2)


def build():
    m = C.Mesh("jequitiba-rosa")
    m.tube([(0, 0, 0), (0, 0, 0.9), (0, 0, 12.6)], [1.5, 1.0, 0.66], 6, BARK, cap_end=False, twist=0.2)

    # 4 flared buttress roots (sapopemas) at the base of the emergent trunk (z = 0..2.8 u)
    for k in range(4):
        ang = k * (math.pi / 2) + 0.35
        d = Vector((math.cos(ang), math.sin(ang), 0))
        s = Vector((-d.y, d.x, 0)) * 0.22
        p_in_bot = d * 0.85
        p_out_bot = d * 2.25
        p_in_top = d * 0.72 + Vector((0, 0, 2.8))
        p_out_mid = d * 1.35 + Vector((0, 0, 1.35))
        m.add_out([p_in_bot - s, p_out_bot, p_out_mid, p_in_top - s * 0.5], BARK, (0, 0, 1.0))
        m.add_out([p_in_bot + s, p_in_top + s * 0.5, p_out_mid, p_out_bot], BARK, (0, 0, 1.0))
        m.add_out([p_out_bot - s * 0.4, p_out_bot + s * 0.4, p_out_mid, p_in_top], BARK, (0, 0, 1.0))

    # Thick limbs opening the umbrella.
    limbs = [(0.3, 3.2, 14.6), (1.9, 3.0, 14.4), (3.4, 3.3, 14.8), (4.8, 2.8, 14.5)]
    for a, reach, ztop in limbs:
        d = Vector((math.cos(a), math.sin(a), 0))
        m.tube([Vector((0, 0, 11.4)) + d * 0.2, d * reach + Vector((0, 0, ztop))], [0.5, 0.3], 5, BARK,
               cap_end=False, twist=a)

    # Shrunken smooth umbrella core (shrink = 0.88) + opaque chunky leaf fringe (ART.md v2)
    m.chunk((0, 0, 13.35), 5.9 * 0.88, 5.6 * 0.88, 2.8, 8, CROWN_LOW, chamfer=0.36, twist=math.radians(11), top_scale=0.82)
    m.leaf_fringe((0, 0, 14.75), 5.6, 5.3, 1.45, 38, CROWN_HIGH, colour_alt=C.ramp("leaf", 3), length=1.55, width=0.88, z_min=-0.65, z_max=0.65, seed=11)

    lobes = [(0.55, 4.0, 14.6, 2.5), (2.15, 3.8, 14.8, 2.35), (3.7, 4.1, 14.5, 2.45), (5.2, 3.7, 14.7, 2.4)]
    for idx, (a, r, z, size) in enumerate(lobes):
        cx, cy = math.cos(a) * r, math.sin(a) * r
        m.chunk((cx, cy, z), size * 0.88, size * 0.82, 2.15, 6, CROWN_HIGH, chamfer=0.32, twist=a)
        m.leaf_fringe((cx, cy, z + 1.1), size * 0.95, size * 0.88, 1.15, 10, CROWN_HIGH, colour_alt=C.ramp("leaf", 3), length=1.35, width=0.78, seed=20 + idx)

    m.chunk((0.2, -0.1, 15.85), 3.1 * 0.88, 2.9 * 0.88, 2.15, 6, CROWN_HIGH, chamfer=0.32, twist=0.4)
    m.leaf_fringe((0.2, -0.1, 16.9), 3.0, 2.8, 1.1, 14, C.ramp("leaf", 3), colour_alt=CROWN_HIGH, length=1.35, width=0.78, z_min=-0.3, z_max=0.92, seed=99)
    return C.apply_v2_foliage(C.build_object(m, "jequitiba-rosa"), mode="tree")


if __name__ == "__main__":
    C.run(build, name="jequitiba-rosa", budget=700, target="~18 u (emergent)", preview_kw=C.TREE_VIEW)
