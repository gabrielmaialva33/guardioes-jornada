"""
Jerivá (Syagrus romanzoffiana), native Atlantic Forest palm, ~11.0 u (canopy tier, ART.md
section 3), <= 450 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/jeriva.py

Shape decisions and sources:
- Native palm (never a coconut palm!): straight, cylindrical grey-fissured stipe with
  conspicuous ring scars and persistent dead leaf bases near the top; NO green tubular
  crownshaft (unlike Euterpe edulis / juçara): Embrapa, Espécies Arbóreas Brasileiras v.1,
  Jerivá, https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140095/1/Especies-Arboreas-Brasileiras-vol-1-Jeriva.pdf
- Plumose ("feathery", ruffled) arching fronds up to 3-4 m long with pinnae inserted at
  multiple angles, plus a large interfoliar woody spathe and hanging golden-orange fruit
  bunch: Lorenzi et al. 2010, Flora Brasileira: Arecaceae (Palmeiras).
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Euler, Vector  # noqa: E402

STIPE = C.ramp("rock", 2)
STIPE_RING = C.ramp("rock", 1)
SHEATH = C.ramp("wood", 1)
SPATHE = C.ramp("wood", 2)
FROND = C.ramp("leaf", 2)
FROND_UNDER = C.ramp("leaf", 1)
FROND_LIGHT = C.ramp("leaf", 3)
FRUIT = C.ACCENT["ipeAmarelo"]


def build():
    m = C.Mesh("jeriva")
    # Straight grey ringed stipe (thicker than juçara) with brown leaf-base collar at the top (no green palmito shaft!)
    zs = [0.0, 0.55, 2.8, 3.0, 5.4, 5.6, 7.6, 8.35]
    radii = [0.42, 0.30, 0.27, 0.28, 0.25, 0.26, 0.24, 0.31]
    cols = [STIPE, STIPE, STIPE_RING, STIPE, STIPE_RING, STIPE, SHEATH, SHEATH]
    m.tube([(0.0, 0.0, z) for z in zs], radii, 5, STIPE, cap_end=True, twist=0.2, colours=cols)

    top = Vector((0.0, 0.0, 8.25))

    # Interfoliar woody boat-shaped spathe + hanging golden-orange jerivá fruit cluster
    for az in (0.8, 3.9):
        d = Vector((math.cos(az), math.sin(az), 0))
        m.blade(top + d * 0.18, top + d * 1.05 + Vector((0, 0, -0.35)), 0.32, SPATHE, bend=Vector((0, 0, 0.14)), colour_under=SHEATH)
        for k, (reach, drop, sz) in enumerate([(0.48, 0.38, 0.28), (0.62, 0.72, 0.25), (0.42, 0.68, 0.24)]):
            c_pos = top + d * reach + Vector((0, 0, -drop))
            rot = Euler((0.2 * k, 0.3 * k, az), "XYZ").to_matrix()
            m.box(c_pos, (sz, sz, sz * 1.15), FRUIT, rot=rot)

    # 11 long, plumose (feathery/ruffled) arching fronds in 2 whorls + multi-plane leaflet fringe
    golden = math.radians(137.5)
    for i in range(11):
        a = i * golden + 0.25
        d = Vector((math.cos(a), math.sin(a), 0))
        age = i / 10.0  # 0 = ascending central fronds, 1 = wide arching/drooping lower fronds
        reach = 3.45 + 0.65 * age
        rise = 2.45 - 1.35 * age
        tip_drop = -0.35 - 1.35 * age
        path = [
            top + d * 0.14,
            top + d * (reach * 0.36) + Vector((0, 0, rise)),
            top + d * (reach * 0.74) + Vector((0, 0, rise * 0.82 + tip_drop * 0.28)),
            top + d * reach + Vector((0, 0, rise * 0.32 + tip_drop)),
        ]
        col = FROND_LIGHT if i < 3 else FROND
        m.frond(path, [0.22, 0.92, 0.78, 0.0], [0.0, 0.42, 0.40, 0.0], col, colour_under=FROND_UNDER)

    # Ruffled plumose leaflet fringe around the crown so it reads feathery, never like a smooth coconut umbrella
    m.leaf_fringe(top + Vector((0, 0, 0.75)), 2.65, 2.65, 1.25, 26, FROND_LIGHT, colour_alt=FROND, length=1.35, width=0.52, seed=44)

    return C.apply_v2_foliage(C.build_object(m, "jeriva"), mode="tree")


if __name__ == "__main__":
    C.run(build, name="jeriva", budget=450, target="~11.0 u (canopy palm)", preview_kw=C.TREE_VIEW)
