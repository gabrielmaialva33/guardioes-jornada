"""
Embaúba (Cecropia pachystachya), pioneer tree, ~10 u (canopy tier floor, ART.md section 3),
<= 400 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/embauba.py

Shape decisions and sources:
- Pioneer; trunk with conspicuous rings (leaf scars); leaves clustered at the branch tips,
  palmately lobed with 5-12 lobes, "densamente esbranquiçado-tomentosas na face inferior"
  (whitish underside): Embrapa, Espécies Arbóreas Brasileiras v.2, Embaúba,
  https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140767/1/Especies-Arboreas-Brasileiras-vol-2-Embauba.pdf
- Hollow branches in a candelabrum: Unicamp BDC (after Lorenzi),
  https://www.bdc.ib.unicamp.br/bdc/visualizarMaterial.php?idMaterial=710
- Peltate leaf (petiole in the middle of the blade, lobes radiating like an umbrella):
  Horto Didático UFSC, https://hortodidatico.ufsc.br/embauba-vermelha/ (weaker source;
  peltate Cecropia leaves are standard botany but not stated by Embrapa).
- So: a grey ringed trunk (rock ramp, darker rings), four candelabrum arms and a short
  apex leader, and at each of these five tips a cluster of big 7-lobed palmate leaves,
  domed like umbrellas with drooping lobes. Tops are green (leaf ramp); the whitish
  underside (rock[3], the lightest grey-green in the ramps) shows only from below and as a
  sliver at the drooping margins, so from 10-20 m the crown reads green, not metallic.
  Leaves are drawn about 4x real size (1.35-1.8 u radius) so the umbrella crown reads on a
  phone at 10-20 m next to the chunkier canopy trees.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

BARK = C.ramp("rock", 2)
RING = C.ramp("rock", 1)
BRANCH = C.ramp("rock", 2)
LEAF = C.ramp("leaf", 2)
LEAF_DARK = C.ramp("leaf", 1)
UNDER = C.ramp("rock", 3)  # whitish-tomentose underside


def palmate_leaf(m: C.Mesh, centre: Vector, normal: Vector, radius: float, lobes: int, spin: float, top: str):
    """A peltate palmatilobed leaf: a domed umbrella of broad lobes whose tips droop well
    below the centre (green on top, whitish below), two-sided."""
    basis = C.frame(normal)
    rim = []
    for k in range(lobes * 2):
        a = spin + math.pi * k / lobes
        tip = k % 2 == 0
        r = radius if tip else radius * 0.6
        drop = -0.46 * radius if tip else -0.24 * radius
        rim.append(centre + basis @ Vector((math.cos(a) * r, math.sin(a) * r, drop)))
    for k in range(len(rim)):
        m.add2([centre, rim[k], rim[(k + 1) % len(rim)]], top, UNDER)


def build():
    m = C.Mesh("embauba")
    # Ringed, slender grey trunk.
    zs = [0, 0.45, 2.35, 2.5, 4.35, 4.5, 6.2]
    radii = [0.4, 0.29, 0.27, 0.27, 0.25, 0.25, 0.23]
    cols = [BARK, BARK, RING, BARK, RING, BARK]
    m.tube([(0, 0, z) for z in zs], radii, 5, BARK, cap_end=False, colours=cols + [BARK], twist=0.2)

    fork = Vector((0, 0, 6.15))
    # Candelabrum: four arms out and up, plus a short leader on the trunk axis.
    arms = [(0.3, 1.7, 2.2), (1.85, 1.5, 2.6), (3.45, 1.75, 2.0), (5.0, 1.45, 2.45)]
    for i, (a, reach, rise) in enumerate(arms):
        d = Vector((math.cos(a), math.sin(a), 0))
        bend = fork + d * reach * 0.62 + Vector((0, 0, rise * 0.22))
        tip = fork + d * reach + Vector((0, 0, rise))
        m.tube([fork, bend, tip], [0.23, 0.18, 0.13], 4, BRANCH, cap_end=True, twist=a + math.pi / 4)
        # Two leaves per tip: a big umbrella over the tip, and a smaller one hanging off to
        # the side, tipped towards the trunk so its whitish underside faces out (the silver
        # accent of the crown, not its main colour).
        palmate_leaf(m, tip + Vector((0, 0, 0.14)), Vector((0, 0, 1)), 1.8, 7, a, LEAF if i % 2 else LEAF_DARK)
        out = d * math.cos(0.9) + Vector((-d.y, d.x, 0)) * math.sin(0.9) * (1 if i % 2 else -1)
        normal = (Vector((0, 0, 1)) * math.cos(0.7) - out * math.sin(0.7)).normalized()
        palmate_leaf(m, tip + out * 1.15 - Vector((0, 0, 0.3)), normal, 1.35, 7, a + 0.4,
                     LEAF_DARK if i % 2 else LEAF)
    leader = fork + Vector((0.05, -0.05, 3.0))
    m.tube([fork, leader], [0.2, 0.13], 4, BRANCH, cap_end=True, twist=math.pi / 4)
    palmate_leaf(m, leader + Vector((0, 0, 0.14)), Vector((0, 0, 1)), 1.55, 7, 0.2, LEAF)
    return C.build_object(m, "embauba")


if __name__ == "__main__":
    C.run(build, name="embauba", budget=400, target="~10 u (canopy tier floor)", preview_kw=C.TREE_VIEW)
