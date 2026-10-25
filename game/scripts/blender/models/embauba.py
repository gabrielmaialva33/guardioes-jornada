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
- So: a pale grey ringed trunk (rock ramp, darker rings), three candelabrum arms, and at
  each tip three big 7-lobed star leaves, domed like umbrellas: two spread out, the oldest
  hangs down beside the tip with its silvery underside (rock[3], the lightest grey-green in
  the ramps) turned out to the light. Under the game's hemisphere light a downward-facing
  underside is lit by the ground colour and looks dark, so the hanging leaf is what shows
  the silver.
  Leaves are drawn about 3x real size so the umbrella crown reads on a phone.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

BARK = C.ramp("rock", 3)
RING = C.ramp("rock", 1)
BRANCH = C.ramp("rock", 2)
LEAF = C.ramp("leaf", 2)
UNDER = C.ramp("rock", 3)  # whitish-tomentose underside


def star_leaf(m: C.Mesh, centre: Vector, normal: Vector, radius: float, lobes: int, spin: float):
    """A peltate palmatilobed leaf: a domed star, tips drooping, two-sided."""
    basis = C.frame(normal)
    rim = []
    for k in range(lobes * 2):
        a = spin + math.pi * k / lobes
        tip = k % 2 == 0
        r = radius if tip else radius * 0.6
        drop = -0.34 * radius if tip else -0.12 * radius
        rim.append(centre + basis @ Vector((math.cos(a) * r, math.sin(a) * r, drop)))
    for k in range(len(rim)):
        a, b = rim[k], rim[(k + 1) % len(rim)]
        m.add2([centre, a, b], LEAF, UNDER)


def build():
    m = C.Mesh("embauba")
    # Ringed, slender pale trunk.
    zs = [0, 0.45, 2.35, 2.5, 4.35, 4.5, 6.2]
    radii = [0.4, 0.29, 0.27, 0.27, 0.25, 0.25, 0.23]
    cols = [BARK, BARK, RING, BARK, RING, BARK]
    m.tube([(0, 0, z) for z in zs], radii, 5, BARK, cap_end=False, colours=cols + [BARK], twist=0.2)

    fork = Vector((0, 0, 6.15))
    arms = [(0.35, 1.5, 2.45), (2.45, 1.35, 2.2), (4.4, 1.55, 2.6)]
    for i, (a, reach, rise) in enumerate(arms):
        d = Vector((math.cos(a), math.sin(a), 0))
        bend = fork + d * reach * 0.6 + Vector((0, 0, rise * 0.25))
        tip = fork + d * reach + Vector((0, 0, rise))
        m.tube([fork, bend, tip], [0.2, 0.16, 0.12], 4, BRANCH, cap_end=True, twist=a + math.pi / 4)
        # Three leaves per tip, tilted outwards around the arm's tip.
        for k in range(3):
            b = a + (k - 1) * 2.1 + 0.25 * i
            out = Vector((math.cos(b), math.sin(b), 0))
            # Young blades spread and droop a little outwards; the oldest one hangs down
            # beside the tip with its whitish underside turned out to the light, the
            # silver flash that marks embaúbas in the forest.
            hanging = k == 0
            tilt = math.radians(112 if hanging else 14 + 8 * k)
            normal = (Vector((0, 0, 1)) * math.cos(tilt) - out * math.sin(tilt)).normalized()
            centre = tip + out * (0.75 if hanging else 0.95) + Vector((0, 0, -0.95 if hanging else 0.1 + 0.2 * (k % 2)))
            star_leaf(m, centre, normal, 1.35 if hanging else 1.65 - 0.1 * k, 7, b)
    _ = Matrix
    return C.build_object(m, "embauba")


if __name__ == "__main__":
    C.run(build, name="embauba", budget=400, target="~10 u (canopy tier floor)", preview_kw=C.TREE_VIEW)
