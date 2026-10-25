"""
Palmeira-juçara (Euterpe edulis), mid-storey palm, ~8 u (understorey tier top, ART.md
section 3), <= 400 tris. The fruit cluster is a child node, `cacho-frutos`, pivoted where
it hangs from the stem, so the game can show it in the fruiting season or hide it.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/jucara.py

Shape decisions and sources:
- Single, slender, never clumping stem; 5-12 m tall and 10-15 cm thick; 8-15 leaves;
  inflorescences below the leaves (infrafoliar); fruit 1-1.4 cm, almost black when ripe:
  Embrapa Florestas, Documentos 372 (2022),
  https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1146954/1/EmbrapaFlorestas-2022-Documentos372-atualizado.pdf
  and CNCFlora, https://proflora.jbrj.gov.br/html/Euterpe%20edulis_2012.html
- Green crownshaft (the palmito) "olive green to dark green"; pinnae "spreading or
  pendulous": Galeano & Henderson, Flora Neotropica 72, via PALMweb,
  https://www.palmweb.org/cdm_dataportal/taxon/f2d4f2f1-50e9-428c-b12e-39f1ca71268c
- Grey stem (rock ramp), olive crownshaft (grass[1]), 9 pinnate fronds in a spiral, young
  ones upright and old ones drooping, each a roof-shaped strip so the leaflets hang on both
  sides; the cluster hangs just below the crownshaft as a fan of fruit-laden rachillae in
  the documented species purple (simplified from black-violet so it reads on a phone).

Blocky language: 5-sided stem like the Nature Kit tree_palmTall, folded flat fronds.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

STEM = C.ramp("rock", 2)
SHAFT = C.ramp("grass", 1)
FROND = C.ramp("leaf", 2)
FROND_UNDER = C.ramp("leaf", 1)
RACHIS = C.ramp("wood", 2)
FRUIT = C.SPECIES["jucaraFruto"]
FRUIT_LIGHT = C.SPECIES["jucaraFrutoLuz"]

SHAFT_BOTTOM = 5.55
SHAFT_TOP = 6.75


def palm() -> C.Mesh:
    m = C.Mesh("palmeira-jucara")
    m.tube([(0, 0, 0), (0, 0, 0.35), (0.04, 0, 3.0), (0.06, 0, SHAFT_BOTTOM)], [0.25, 0.16, 0.145, 0.13], 5, STEM,
           cap_end=False, twist=0.3)
    m.tube([(0.06, 0, SHAFT_BOTTOM), (0.06, 0, 6.15), (0.06, 0, SHAFT_TOP)], [0.17, 0.205, 0.15], 5, SHAFT,
           cap_end=True, twist=0.3)
    top = Vector((0.06, 0, SHAFT_TOP - 0.05))
    golden = math.radians(137.5)
    for i in range(9):
        a = i * golden + 0.4
        d = Vector((math.cos(a), math.sin(a), 0))
        age = i / 8  # 0 = youngest (upright), 1 = oldest (drooping)
        reach = 3.3 + 0.8 * age
        rise = 1.75 - 1.15 * age
        tip_drop = -0.45 - 1.3 * age
        path = [
            top + d * 0.08,
            top + d * (reach * 0.33) + Vector((0, 0, rise)),
            top + d * (reach * 0.72) + Vector((0, 0, rise * 0.85 + tip_drop * 0.25)),
            top + d * reach + Vector((0, 0, rise * 0.4 + tip_drop)),
        ]
        m.frond(path, [0.2, 0.86, 0.74, 0.0], [0.0, 0.38, 0.36, 0.0], FROND, colour_under=FROND_UNDER)
    return m


def cluster(anchor: Vector) -> C.Mesh:
    """Infructescence: a stout peduncle out from under the crownshaft and a lumpy bunch
    of fruit-laden rachillae hanging from it, as chunky berry blocks."""
    from mathutils import Euler

    m = C.Mesh("cacho-frutos")
    d = Vector((-0.55, -0.83, 0)).normalized()  # towards the front-left, seen in the preview
    end = anchor + d * 0.5 + Vector((0, 0, -0.2))
    m.tube([anchor - d * 0.05, end], [0.075, 0.06], 4, RACHIS, cap_end=True, twist=0.6)
    side = d.cross(Vector((0, 0, 1)))
    # (sideways, outwards, down, size, colour): three hanging strands, longest in the middle
    berries = [(-0.2, 0.0, 0.32, 0.30, FRUIT), (-0.26, 0.05, 0.72, 0.26, FRUIT_LIGHT),
               (0.02, 0.06, 0.42, 0.32, FRUIT_LIGHT), (0.0, 0.1, 0.86, 0.29, FRUIT), (0.03, 0.12, 1.22, 0.24, FRUIT_LIGHT),
               (0.22, 0.0, 0.34, 0.29, FRUIT), (0.27, 0.06, 0.74, 0.25, FRUIT)]
    for k, (s, o, down, size, col) in enumerate(berries):
        c = end + side * s + d * o + Vector((0, 0, -down))
        rot = Euler((0.25 * ((k % 3) - 1), 0.2 * ((k % 2) * 2 - 1), 0.5 * k), "XYZ").to_matrix()
        m.box(c, (size, size, size * 1.15), col, rot=rot)
    return m


def build():
    root = C.build_object(palm(), "palmeira-jucara")
    anchor = Vector((0.06, 0, SHAFT_BOTTOM - 0.05)) + Vector((-0.55, -0.83, 0)).normalized() * 0.12
    C.build_object(cluster(anchor), "cacho-frutos", parent=root, pivot=anchor)
    return root


if __name__ == "__main__":
    C.run(build, name="palmeira-jucara", budget=400, target="~8 u (understorey/mid-storey)", preview_kw=C.TREE_VIEW)
