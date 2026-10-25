"""
Araucária (Araucaria angustifolia), canopy tier, ~13.5 u (ART.md section 3), <= 400 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/araucaria.py

Shape decisions and sources:
- Straight, columnar, almost cylindrical trunk, bare below the crown: Embrapa, Espécies
  Arbóreas Brasileiras v.1, Pinheiro-do-paraná ("Tronco: reto, colunar e quase
  cilíndrico"), https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140113/1/Especies-Arboreas-Brasileiras-vol-1-Pinheiro-do-Parana.pdf
- Branches in (pseudo-)whorls; old trees keep only the top whorls, a cup/candelabrum
  crown that is wider on top ("Copa ... caliciforme ou em forma de taça, nas árvores mais
  velhas"; "formato de candelabro, devido à perda dos verticilos basais"): same Embrapa
  volume and https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1071142/1/AraucariaCapitulo1.pdf
- Needles only in tufts at the branch tips ("grimpas ... agrupados no ápice dos ramos
  primários"): Anselmini 2005, UFPR, https://hdl.handle.net/1884/1922
- Branches run out almost level and hook upwards so every tuft ends near one height, as
  in the app's diorama (src/lib/diorama/scene/araucaria.ts).

Blocky language: 6-sided tapered trunk, 4-sided branches, flat 6-sided plates (narrow at
the bottom, wide on top) like the Nature Kit tree_plateau tiers.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

BARK = C.ramp("wood", 1)  # Nature Kit woodBark -> wood[1] (color-map.json), same forest
BRANCH = C.ramp("wood", 0)
NEEDLES = C.ramp("leaf", 1)  # dark green grimpas
NEEDLES_TOP = C.ramp("leaf", 2)
NEEDLES_UNDER = C.ramp("leaf", 0)


def plate(m: C.Mesh, centre, r, h, twist):
    """A grimpa tuft: a flat 6-sided plate, narrow below and wide on top."""
    m.slab(centre, r * 0.5, r * 0.5, h, 6, NEEDLES, twist=twist, taper=1 / 0.5,
           colour_top=NEEDLES_TOP, colour_bottom=NEEDLES_UNDER)


def build():
    m = C.Mesh("araucaria")
    # Trunk: slight flare at the ground, straight and bare up to the crown.
    m.tube([(0, 0, 0), (0, 0, 0.6), (0, 0, 11.0), (0, 0, 12.75)], [0.8, 0.56, 0.38, 0.27], 6, BARK,
           cap_end=False, twist=math.radians(15))

    # Lower whorl: long arms, level then turning up (the candelabrum).
    lower = 6
    for j in range(lower):
        a = 2 * math.pi * j / lower + 0.25 + (0.12 if j % 2 else -0.08)
        d = Vector((math.cos(a), math.sin(a), 0))
        reach = 3.45 + (0.25 if j % 3 == 0 else 0.0)
        z0 = 9.25 + 0.12 * (j % 2)
        p0 = Vector((0, 0, z0)) + d * 0.2
        p1 = p0 + d * (reach * 0.72) + Vector((0, 0, 0.35))
        p2 = p0 + d * reach + Vector((0, 0, 1.95))
        m.tube([p0, p1, p2], [0.25, 0.19, 0.15], 4, BRANCH, cap_end=False, twist=a + math.pi / 4)
        plate(m, p2 - Vector((0, 0, 0.15)), 1.55, 0.75, a)

    # Upper whorl: shorter arms, rotated between the lower ones.
    upper = 4
    for j in range(upper):
        a = 2 * math.pi * j / upper + 0.65
        d = Vector((math.cos(a), math.sin(a), 0))
        p0 = Vector((0, 0, 10.8)) + d * 0.15
        p1 = p0 + d * 2.1 + Vector((0, 0, 1.3))
        m.tube([p0, p1], [0.21, 0.15], 4, BRANCH, cap_end=False, twist=a + math.pi / 4)
        plate(m, p1 - Vector((0, 0, 0.15)), 1.25, 0.7, a + 0.3)

    # Crown centre on the trunk top.
    plate(m, (0, 0, 12.65), 1.15, 0.75, 0.0)
    return C.build_object(m, "araucaria")


if __name__ == "__main__":
    C.run(build, name="araucaria", budget=400, target="12-14 u (canopy)")
