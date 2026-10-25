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

    # Thick limbs opening the umbrella.
    limbs = [(0.3, 3.2, 14.6), (1.9, 3.0, 14.4), (3.4, 3.3, 14.8), (4.8, 2.8, 14.5)]
    for a, reach, ztop in limbs:
        d = Vector((math.cos(a), math.sin(a), 0))
        m.tube([Vector((0, 0, 11.4)) + d * 0.2, d * reach + Vector((0, 0, ztop))], [0.5, 0.3], 5, BARK,
               cap_end=False, twist=a)

    # The umbrella: a broad, flat-bottomed block ...
    m.chunk((0, 0, 13.3), 5.9, 5.6, 3.0, 8, CROWN_LOW, chamfer=0.36, twist=math.radians(11), top_scale=0.8)
    # ... domed by a ring of lobes and a crown lobe, globose on top.
    lobes = [(0.55, 4.1, 14.6, 2.6), (2.15, 3.9, 14.8, 2.45), (3.7, 4.2, 14.5, 2.55), (5.2, 3.8, 14.7, 2.5)]
    for a, r, z, size in lobes:
        m.chunk((math.cos(a) * r, math.sin(a) * r, z), size, size * 0.92, 2.3, 6, CROWN_HIGH, chamfer=0.3,
                twist=a)
    m.chunk((0.2, -0.1, 15.85), 3.1, 2.9, 2.15, 6, CROWN_HIGH, chamfer=0.32, twist=0.4)
    return C.build_object(m, "jequitiba-rosa")


if __name__ == "__main__":
    C.run(build, name="jequitiba-rosa", budget=400, target="~18 u (emergent)")
