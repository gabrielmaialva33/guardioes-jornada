"""
Xaxim / samambaiaçu (Dicksonia sellowiana), tree fern, ~6 u (understorey tier, ART.md
section 3), <= 300 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/xaxim.py

Shape decisions and sources:
- "cáudice arborescente, ereto, de até aproximadamente 6 m de altura, envolvido por uma
  espessa bainha de raízes adventícias" (the thick, fibrous trunk), fronds "até cerca de
  2,40 m" (max 2.95 m): Schmitt et al., Acta Botanica Brasilica,
  https://www.scielo.br/j/abb/a/KR6GxYkcGLwYs5x9FMhkqbd/?lang=pt
- Endangered (EN): CNCFlora, https://proflora.jbrj.gov.br/html/Dicksonia%20sellowiana_2012.html
  ; extraction banned in natural Mata Atlântica populations (CONAMA 278/2001, applied to
  xaxim by SEMIL-SP, https://semil.sp.gov.br/educacaoambiental/prateleira-ambiental/xaxim/).
- So: a thick, slightly crooked trunk built from segments in two dark browns (the rough
  root mantle), and a rosette of 11 broad bipinnate fronds that rise and arch out from the
  top, younger ones steeper. Frond length 3.0-3.8 u, about the real 2.4-2.95 m at the tree factor.
  (Arching is the common habit of tree-fern crowns; the cited sources only give lengths.)
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

MANTLE = C.ramp("wood", 0)
MANTLE_ALT = C.ramp("soil", 0)
FROND = C.ramp("leaf", 2)
FROND_UNDER = C.ramp("leaf", 1)
FROND_YOUNG = C.ramp("leaf", 3)


def build():
    m = C.Mesh("xaxim")
    pts = [(0, 0, 0), (0.06, 0.0, 1.45), (-0.05, 0.05, 2.9), (0.03, -0.03, 4.3)]
    m.tube(pts, [0.72, 0.56, 0.52, 0.5], 6, MANTLE, cap_end=True, twist=0.1,
           colours=[MANTLE, MANTLE_ALT, MANTLE, MANTLE])
    top = Vector(pts[-1])
    golden = math.radians(137.5)
    n = 11
    for i in range(n):
        a = i * golden + 0.2
        d = Vector((math.cos(a), math.sin(a), 0))
        age = i / (n - 1)  # 0 youngest (steep), 1 oldest (spreading, tip drooping)
        reach = 3.0 + 0.75 * age
        rise = 1.65 - 0.85 * age
        path = [
            top + d * 0.25 + Vector((0, 0, -0.02)),
            top + d * reach * 0.36 + Vector((0, 0, rise)),
            top + d * reach * 0.75 + Vector((0, 0, rise * 0.95 - 0.25 * age)),
            top + d * reach + Vector((0, 0, rise * 0.45 - 0.75 * age)),
        ]
        colour = FROND_YOUNG if i < 2 else FROND
        m.frond(path, [0.28, 1.15, 0.95, 0.0], [0.0, 0.16, 0.18, 0.0], colour, colour_under=FROND_UNDER)
    return C.build_object(m, "xaxim")


if __name__ == "__main__":
    C.run(build, name="xaxim", budget=300, target="~6 u (understorey)", preview_kw=C.TREE_VIEW)
