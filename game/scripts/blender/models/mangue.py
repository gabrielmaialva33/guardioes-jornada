"""
Mangue-vermelho (Rhizophora mangle), mangrove tree with arched prop roots (rizóforos),
~8.5 u (understorey/canopy tier, ART.md section 3), <= 450 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/mangue.py

Shape decisions and sources:
- Signature arched stilt/prop roots (rizóforos em arco) branching from the trunk and upper
  stems down into the tidal mud for stability and aeration: ICMBio, Atlas dos Manguezais
  do Brasil (2018), https://www.gov.br/icmbio/pt-br/centrais-de-conteudo/publicacoes/atlas/atlas_dos_manguezais_do_brasil.pdf
- Dense, rounded crown of opposite, thick, glossy deep-green elliptical leaves: Schaeffer-
  Novelli 1995; Flora e Funga do Brasil (Rhizophora mangle).
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

ROOT_DARK = C.ramp("wood", 0)
ROOT_REDDISH = C.ramp("soil", 1)
BARK = C.ramp("wood", 1)
CROWN_DARK = C.ramp("leaf", 0)
CROWN_MID = C.ramp("leaf", 1)
CROWN_LIGHT = C.ramp("leaf", 2)
CROWN_BRIGHT = C.ramp("leaf", 3)


def build():
    m = C.Mesh("mangue-vermelho")
    # 8 arched prop roots (rizóforos) radiating from z = 1.6..2.8 u on the trunk out to r = 1.7..2.3 u on the mud
    for k in range(8):
        a = (2 * math.pi * k / 8) + 0.18 * (k % 2)
        d = Vector((math.cos(a), math.sin(a), 0))
        z_start = 2.45 if k % 2 == 0 else 1.75
        r_end = 2.15 if k % 2 == 0 else 1.65
        p0 = d * 0.18 + Vector((0, 0, z_start))
        p1 = d * (r_end * 0.58) + Vector((0, 0, z_start * 0.86))
        p2 = d * (r_end * 0.90) + Vector((0, 0, z_start * 0.42))
        p3 = d * r_end + Vector((0, 0, 0.0))
        m.tube(
            [p0, p1, p2, p3],
            [0.14, 0.12, 0.10, 0.09],
            4,
            ROOT_REDDISH,
            cap_end=False,
            twist=a,
            colours=[BARK, ROOT_REDDISH, ROOT_DARK, ROOT_DARK],
        )

    # Central trunk rising from z = 1.2 u (elevated on the stilt roots!) to the fork at z = 4.6 u
    fork = Vector((0.0, 0.0, 4.6))
    m.tube([(0.0, 0.0, 1.15), (0.03, -0.02, 2.8), fork], [0.36, 0.30, 0.24], 5, BARK, cap_end=False, twist=0.2)

    # 3 spreading branches supporting the glossy green mangrove crown
    limbs = [(0.4, 2.05, 1.85), (2.5, 1.95, 2.05), (4.6, 2.10, 1.75)]
    tips = []
    for a, reach, rise in limbs:
        d = Vector((math.cos(a), math.sin(a), 0))
        tip = fork + d * reach + Vector((0, 0, rise))
        m.tube([fork, tip], [0.20, 0.12], 4, BARK, cap_end=False, twist=a)
        tips.append((a, tip))

    # Smooth volume-shaded canopy lobes + elliptical opaque leaf fringe
    m.chunk((0.0, 0.0, 5.15), 2.10, 2.00, 1.95, 6, CROWN_MID, chamfer=0.34, twist=0.2, colour_bottom=CROWN_DARK)
    m.leaf_fringe((0.0, 0.0, 6.1), 2.35, 2.25, 1.05, 16, CROWN_LIGHT, colour_alt=CROWN_BRIGHT, length=1.12, width=0.64, seed=19)

    for idx, (a, tip) in enumerate(tips):
        c_pos = tip + Vector((0, 0, -0.45))
        m.chunk(c_pos, 1.65, 1.55, 1.75, 6, CROWN_LIGHT, chamfer=0.34, twist=a, colour_bottom=CROWN_MID)
        m.leaf_fringe(c_pos + Vector((0, 0, 0.88)), 1.80, 1.70, 0.92, 10, CROWN_BRIGHT, colour_alt=CROWN_LIGHT, length=1.05, width=0.60, seed=50 + idx)

    m.chunk((0.05, -0.05, 6.65), 1.75, 1.68, 1.85, 6, CROWN_LIGHT, chamfer=0.34, twist=0.6, colour_top=CROWN_BRIGHT)
    m.leaf_fringe((0.05, -0.05, 7.55), 1.90, 1.82, 0.95, 14, CROWN_BRIGHT, colour_alt=CROWN_LIGHT, length=1.08, width=0.62, z_min=-0.25, z_max=0.92, seed=88)

    return C.apply_v2_foliage(C.build_object(m, "mangue-vermelho"), mode="tree")


if __name__ == "__main__":
    C.run(build, name="mangue-vermelho", budget=450, target="~8.5 u (mangrove with prop roots)", preview_kw=C.TREE_VIEW)
