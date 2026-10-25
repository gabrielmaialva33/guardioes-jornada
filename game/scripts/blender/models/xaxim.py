"""
Xaxim / samambaiaçu (Dicksonia sellowiana), tree fern, ~6 u (understorey tier, ART.md
section 3), <= 400 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/xaxim.py

Shape decisions and sources:
- "cáudice arborescente, ereto, de até aproximadamente 6 m de altura, envolvido por uma
  espessa bainha de raízes adventícias" (the dark, fibrous root-mantle trunk), fronds "até
  cerca de 2,40 m" (max 2.95 m): Schmitt et al., Acta Botanica Brasilica,
  https://www.scielo.br/j/abb/a/KR6GxYkcGLwYs5x9FMhkqbd/?lang=pt
- Endangered (EN): CNCFlora, https://proflora.jbrj.gov.br/html/Dicksonia%20sellowiana_2012.html
  ; extraction banned in natural Mata Atlântica populations (CONAMA 278/2001, applied to
  xaxim by SEMIL-SP, https://semil.sp.gov.br/educacaoambiental/prateleira-ambiental/xaxim/).
- Crown silhouette: 20 narrow, gracefully arching fern fronds radiating from the top in two
  dense whorls (an ascending inner whorl and a wide-arching outer fountain whorl), plus 3
  curled young fiddleheads (báculos) unfurling in the centre, sobre um cáudice escuro e
  fibroso com anéis de raízes adventícias.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

MANTLE = C.ramp("wood", 0)
MANTLE_ALT = C.ramp("soil", 0)
MANTLE_TOP = C.ramp("soil", 1)
FROND = C.ramp("leaf", 2)
FROND_UNDER = C.ramp("leaf", 1)
FROND_YOUNG = C.ramp("leaf", 3)
FIDDLEHEAD = C.ramp("grass", 3)


def add_fiddlehead(m: C.Mesh, base: Vector, azimuth: float, height: float) -> None:
    """A curled young tree-fern crosier (báculo) rising in the centre of the crown."""
    d = Vector((math.cos(azimuth), math.sin(azimuth), 0))
    # Stem rising and arching slightly outward, then curling inward into a tight spiral hook
    pts = [
        base + d * 0.08,
        base + d * 0.22 + Vector((0, 0, height * 0.55)),
        base + d * 0.36 + Vector((0, 0, height * 0.96)),
        base + d * 0.20 + Vector((0, 0, height * 1.08)),
        base + d * 0.06 + Vector((0, 0, height * 0.90)),
        base + d * 0.17 + Vector((0, 0, height * 0.80)),
    ]
    m.tube(
        pts,
        [0.065, 0.055, 0.05, 0.048, 0.045, 0.035],
        4,
        FIDDLEHEAD,
        cap_end=True,
        twist=azimuth,
        colours=[FROND_YOUNG, FROND_YOUNG, FIDDLEHEAD, FIDDLEHEAD, FIDDLEHEAD, FIDDLEHEAD],
    )


def build():
    m = C.Mesh("xaxim")
    # Dark fibrous caudex with stepped root-mantle texture rings (7 rings -> 6 segments x 5 sides = 65 tris)
    pts = [
        (0.0, 0.0, 0.0),
        (0.02, 0.0, 0.65),
        (-0.02, 0.02, 1.35),
        (0.03, -0.01, 2.05),
        (-0.02, 0.02, 2.75),
        (0.01, -0.02, 3.35),
        (0.0, 0.0, 3.85),
    ]
    radii = [0.46, 0.37, 0.39, 0.34, 0.36, 0.32, 0.36]
    cols = [MANTLE, MANTLE_ALT, MANTLE, MANTLE_ALT, MANTLE, MANTLE_TOP, MANTLE]
    m.tube(pts, radii, 5, MANTLE, cap_end=True, twist=0.15, colours=cols)

    top = Vector(pts[-1])

    # 3 curled fiddleheads (báculos) unfurling in the center of the rosette
    for k, (az, h) in enumerate([(0.3, 1.45), (2.4, 1.30), (4.5, 1.18)]):
        add_fiddlehead(m, top + Vector((0, 0, -0.05)), az, h)

    # Inner ascending whorl: 8 narrow, high-arching young fronds (10 tris each = 80 tris)
    for i in range(8):
        a = (2 * math.pi * i / 8) + 0.18
        d = Vector((math.cos(a), math.sin(a), 0))
        reach = 2.45 + 0.18 * (i % 2)
        rise = 1.95 - 0.12 * (i % 2)
        path = [
            top + d * 0.18 + Vector((0, 0, 0.02)),
            top + d * (reach * 0.38) + Vector((0, 0, rise * 0.78)),
            top + d * (reach * 0.76) + Vector((0, 0, rise)),
            top + d * reach + Vector((0, 0, rise * 0.62)),
        ]
        col = FROND_YOUNG if i % 2 == 0 else FROND
        m.frond(path, [0.14, 0.38, 0.32, 0.0], [0.0, 0.08, 0.09, 0.0], col, colour_under=FROND_UNDER)

    # Outer fountain whorl: 14 narrow, long-arching mature fern fronds radiating round the crown (140 tris)
    for i in range(14):
        a = (2 * math.pi * i / 14) + 0.42
        d = Vector((math.cos(a), math.sin(a), 0))
        v = (i % 3) * 0.12
        reach = 3.15 + v
        rise = 1.35 - 0.15 * (i % 2)
        path = [
            top + d * 0.24 + Vector((0, 0, -0.04)),
            top + d * (reach * 0.36) + Vector((0, 0, rise)),
            top + d * (reach * 0.74) + Vector((0, 0, rise * 0.82)),
            top + d * reach + Vector((0, 0, rise * 0.12 - 0.25)),
        ]
        m.frond(path, [0.16, 0.44, 0.36, 0.0], [0.0, 0.10, 0.11, 0.0], FROND, colour_under=FROND_UNDER)

    return C.build_object(m, "xaxim")


if __name__ == "__main__":
    C.run(build, name="xaxim", budget=400, target="~6 u (understorey)", preview_kw=C.TREE_VIEW)
