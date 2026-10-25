"""
Bico do tucano-de-bico-verde (Ramphastos dicolorus): a bill attachment for the Cube Pets
parrot, which the game recolours as the toucan (palette-tucano-de-bico-verde.png).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/bico_tucano.py

Attach contract (assets-report.md section 2): the parrot's head is part of `body`; the
attach node is `Group`, pivot (0, 1.1621, 0.1125) in body space (glTF), which no clip ever
moves relative to `body` (checked in all 8 Cube Pets clips). The GLB root node
`bico-tucano` has an identity transform and its geometry is in Group-local space, so
`parrot.getObjectByName('Group').add(bill)` places it; equivalently add it to `body` at
position (0, 1.1621, 0.1125). It covers the parrot's own small bill.

Shape and colour decisions and sources:
- 42-48 cm bird, "boa parte correspondendo ao bico ... bico verde. O serrilhado do bico ...
  realçado pela cor vermelha sanguínea": WikiAves, https://www.wikiaves.com.br/wiki/tucano-de-bico-verde
- "The bill is mainly green, with a black basal line and some red above the tomial tooth":
  Perrella & Guida 2019, Biota Neotropica, https://doi.org/10.1590/1676-0611-bn-2018-0576
- So: a big, deep-based bill about 0.9 of the head's width long, culmen curving down to the
  tip, pale green, a black band at the base and a red line along the cutting edge (gape).
- Colours are the top rows of the toucan palette cells: green (6,2) = cell reserved for this
  bill, black (1,3), red (4,3); each face also carries a TEXCOORD_0 pointing at that cell,
  so the bill can use the parrot's palette material instead of COLOR_0.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

GREEN = C.SPECIES["tucanoBico"]
BLACK = C.SPECIES["tucanoBicoBase"]
RED = C.SPECIES["tucanoTomio"]
UV = {GREEN: C.pet_uv(6, 2), BLACK: C.pet_uv(1, 3), RED: C.pet_uv(4, 3)}


def bill(face_y: float) -> C.Mesh:
    """Loft of 8-vertex sections (front = -Y). Each section: top corners, the red gape
    strip on each side, bottom corners."""
    m = C.Mesh("bico-tucano")
    # (forward distance from the face, z top, z bottom, half width)
    stations = [(-0.06, 0.88, 0.46, 0.155), (0.12, 0.88, 0.46, 0.155), (0.46, 0.86, 0.5, 0.125),
                (0.75, 0.79, 0.53, 0.09), (0.94, 0.66, 0.55, 0.04)]
    rings = []
    for dist, top, bot, hw in stations:
        y = face_y - dist
        g = bot + 0.36 * (top - bot)  # gape line, nearer the bottom (the lower mandible is thinner)
        gh = 0.022
        rings.append([Vector(p) for p in [(-hw, y, top), (hw, y, top), (hw, y, g + gh), (hw, y, g - gh),
                                          (hw * 0.9, y, bot), (-hw * 0.9, y, bot), (-hw, y, g - gh), (-hw, y, g + gh)]])
    # faces between consecutive rings: 0 top, 1 right upper, 2 right red, 3 right lower,
    # 4 bottom, 5 left lower, 6 left red, 7 left upper
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(8):
            k1 = (k + 1) % 8
            if i == 0:
                col = BLACK  # the black basal line
            else:
                col = RED if k in (2, 6) else GREEN
            # a -> b runs forward (-Y); winding chosen so normals face outwards
            m.add([a[k], b[k], b[k1], a[k1]], col, UV[col])
    tip = rings[-1]
    m.add(list(tip), GREEN, UV[GREEN])
    return m


def build():
    bvh, pivots = C.pet_surface("parrot")
    hit, _n = C.surface_hit(bvh, (0.14, -3.0, 0.58), (0, 1, 0))  # beside the parrot's own bill
    face_y = hit.y
    group = pivots["Group"]
    ob = C.build_object(bill(face_y), "bico-tucano", pivot=group)
    ob.location = (0, 0, 0)  # Group-local geometry, identity node
    return ob


if __name__ == "__main__":
    C.run(build, name="bico-tucano", budget=470, target="attachment, ~0.9 u bill on the parrot head (raw units)",
          preview=lambda g, p: C.preview_attachment(g, p, "parrot", {"node": "Group"}, closeup_az=-62, closeup_el=12))
