"""
Pau-brasil (Paubrasilia echinata, syn. Caesalpinia echinata), canopy tier ~11.5 u (ART.md
section 3), <= 450 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/pau_brasil.py

Shape decisions and sources:
- "Tronco: curto, tortuoso a quase reto ... casca externa pardo-acinzentada a pardo-escura,
  desprendendo-se em placas irregulares, deixando ver a casca interna de cor
  castanho-avermelhada": Embrapa, Espécies Arbóreas Brasileiras v.1, Pau-brasil,
  https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140111/1/Especies-Arboreas-Brasileiras-vol-1-Pau-Brasil.pdf
- "Copa: densa, arredondada, com folhagem verde-escura brilhante" and yellow raceme flowers
  with a red spot on the central petal (September-December): same Embrapa volume; CNCFlora,
  https://proflora.jbrj.gov.br/html/Paubrasilia%20echinata_2012.html
- So: a sturdy dark-barked trunk (wood[0]) with flaking orange-brown inner-bark patches
  (wood[2]/soil[2]), 3 spreading limbs, a rounded dense canopy of 5 smooth volume-shaded
  masses (leaf[1..2], shrunken 12%) surrounded by an opaque chunky leaf fringe (leaf[2..3])
  plus small yellow flower raceme accents (ACCENT.ipeAmarelo) on top.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

BARK_DARK = C.ramp("wood", 0)
BARK_INNER = C.ramp("wood", 2)
BARK_FLAKE = C.ramp("soil", 2)
CROWN_DARK = C.ramp("leaf", 1)
CROWN_MID = C.ramp("leaf", 2)
CROWN_LIGHT = C.ramp("leaf", 3)
BLOSSOM = C.ACCENT["ipeAmarelo"]


def build():
    m = C.Mesh("pau-brasil")
    fork = Vector((0.0, 0.0, 4.8))
    # Flared dark trunk with flaking orange-brown inner bark segments
    m.tube(
        [(0.0, 0.0, 0.0), (0.04, -0.02, 0.8), (-0.05, 0.04, 2.6), (0.03, -0.03, 3.8), fork],
        [0.85, 0.56, 0.48, 0.44, 0.38],
        6,
        BARK_DARK,
        cap_end=False,
        twist=0.25,
        colours=[BARK_DARK, BARK_FLAKE, BARK_DARK, BARK_INNER, BARK_DARK],
    )

    # 3 spreading limbs opening the rounded canopy
    limbs = [(0.35, 2.75, 2.85), (2.45, 2.60, 3.05), (4.55, 2.80, 2.75)]
    tips = []
    for a, reach, rise in limbs:
        d = Vector((math.cos(a), math.sin(a), 0))
        mid = fork + d * (reach * 0.52) + Vector((0, 0, rise * 0.55))
        tip = fork + d * reach + Vector((0, 0, rise))
        m.tube([fork - d * 0.08, mid, tip], [0.30, 0.22, 0.14], 5, BARK_DARK, cap_end=False, twist=a)
        tips.append((a, tip))

    # Central lower canopy core + 3 outer limb lobes + upper dome lobe (shrunken for fringe)
    m.chunk((0.0, 0.0, 6.2), 2.55, 2.45, 2.40, 6, CROWN_DARK, chamfer=0.34, twist=0.15)
    m.leaf_fringe((0.0, 0.0, 7.4), 2.85, 2.75, 1.25, 11, CROWN_MID, colour_alt=CROWN_LIGHT, length=1.32, width=0.74, seed=14)

    for idx, (a, tip) in enumerate(tips):
        c_pos = tip + Vector((0, 0, -0.55))
        m.chunk(c_pos, 2.05, 1.95, 2.20, 6, CROWN_MID, chamfer=0.34, twist=a)
        m.leaf_fringe(c_pos + Vector((0, 0, 1.1)), 2.25, 2.15, 1.15, 10, CROWN_LIGHT, colour_alt=CROWN_MID, length=1.26, width=0.70, seed=30 + idx)

    # Upper crown dome + yellow flowering raceme accents at the sunlit apex
    m.chunk((0.1, -0.05, 8.6), 2.25, 2.15, 2.35, 6, CROWN_MID, chamfer=0.34, twist=0.5, colour_top=CROWN_LIGHT)
    m.leaf_fringe((0.1, -0.05, 9.8), 2.45, 2.35, 1.25, 14, CROWN_LIGHT, colour_alt=BLOSSOM, length=1.24, width=0.68, z_min=-0.25, z_max=0.92, seed=77)

    return C.apply_v2_foliage(C.build_object(m, "pau-brasil"), mode="tree")


if __name__ == "__main__":
    C.run(build, name="pau-brasil", budget=450, target="~11.5 u (canopy)", preview_kw=C.TREE_VIEW)
