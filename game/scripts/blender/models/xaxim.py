"""
Xaxim / samambaiaçu (Dicksonia sellowiana), tree fern, ~6 u (understorey tier, ART.md
section 3), <= 400 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/xaxim.py

Shape decisions and sources:
- "cáudice arborescente, ereto, de até aproximadamente 6 m de altura, envolvido por uma
  espessa bainha de raízes adventícias" (the dark, fibrous root-mantle trunk), fronds "até
  cerca de 2,40 m" (max 2,95 m): Schmitt et al., Acta Botanica Brasilica,
  https://www.scielo.br/j/abb/a/KR6GxYkcGLwYs5x9FMhkqbd/?lang=pt
- Endangered (EN): CNCFlora, https://proflora.jbrj.gov.br/html/Dicksonia%20sellowiana_2012.html
  ; extraction banned in natural Mata Atlântica populations (CONAMA 278/2001, applied to
  xaxim by SEMIL-SP, https://semil.sp.gov.br/educacaoambiental/prateleira-ambiental/xaxim/).
- Crown silhouette: 36 narrow, arching fern fronds radiating from the top in 3 dense tiers
  (an ascending young inner tier, a wide-arching fountain middle tier, and a spreading outer
  tier), plus 3 prominent curled fiddleheads (báculos) unfurling in the centre, on a dark
  fibrous caudex trunk with root-mantle texture rings.
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
    """A prominent curled tree-fern crosier (báculo) unfurling in the centre of the crown."""
    d = Vector((math.cos(azimuth), math.sin(azimuth), 0))
    pts = [
        base + d * 0.08,
        base + d * 0.26 + Vector((0, 0, height * 0.62)),
        base + d * 0.42 + Vector((0, 0, height * 0.98)),
        base + d * 0.24 + Vector((0, 0, height * 1.12)),
        base + d * 0.05 + Vector((0, 0, height * 0.96)),
        base + d * 0.18 + Vector((0, 0, height * 0.82)),
    ]
    m.tube(
        pts,
        [0.095, 0.085, 0.08, 0.075, 0.07, 0.06],
        3,
        FIDDLEHEAD,
        cap_end=True,
        twist=azimuth,
        colours=[FROND_YOUNG, FROND_YOUNG, FIDDLEHEAD, FIDDLEHEAD, FIDDLEHEAD, FIDDLEHEAD],
    )


def add_arched_fern_frond(
    m: C.Mesh,
    top: Vector,
    azimuth: float,
    reach: float,
    rise: float,
    tip_z: float,
    width: float,
    col_top: str,
    col_under: str,
) -> None:
    """Two-part narrow arching fern frond (8 tris total: inner ascending blade + outer
    gracefully drooping blade) so 30+ fronds fit well inside the 400-tri budget."""
    d = Vector((math.cos(azimuth), math.sin(azimuth), 0))
    p0 = top + d * 0.14
    p_mid = top + d * (reach * 0.56) + Vector((0, 0, rise))
    p_tip = top + d * reach + Vector((0, 0, tip_z))
    m.blade(
        p0,
        p_mid,
        width * 0.85,
        col_top,
        mid=0.55,
        bend=Vector((0, 0, 0.18)),
        colour_under=col_under,
    )
    m.blade(
        p_mid - d * 0.12,
        p_tip,
        width,
        col_top,
        mid=0.38,
        bend=Vector((0, 0, 0.22)),
        colour_under=col_under,
    )


def build():
    m = C.Mesh("xaxim")
    # Dark fibrous caudex with stepped root-mantle texture rings (6 rings -> 5 segments x 5 sides = 53 tris)
    pts = [
        (0.0, 0.0, 0.0),
        (0.02, 0.0, 0.75),
        (-0.02, 0.02, 1.55),
        (0.02, -0.01, 2.35),
        (-0.01, 0.01, 3.15),
        (0.0, 0.0, 3.85),
    ]
    radii = [0.44, 0.35, 0.38, 0.32, 0.35, 0.38]
    cols = [MANTLE, MANTLE_ALT, MANTLE, MANTLE_ALT, MANTLE_TOP, MANTLE]
    m.tube(pts, radii, 5, MANTLE, cap_end=True, twist=0.15, colours=cols)

    top = Vector(pts[-1])

    # 3 prominent curled fiddleheads (báculos) unfurling in the center (3 x 16 = 48 tris)
    for az, h in [(0.35, 1.65), (2.45, 1.52), (4.55, 1.40)]:
        add_fiddlehead(m, top + Vector((0, 0, -0.04)), az, h)

    # Tier 1 (inner ascending whorl): 8 narrow young fern fronds (8 x 8 = 64 tris)
    for i in range(8):
        a = (2 * math.pi * i / 8) + 0.12
        reach = 2.35 + 0.18 * (i % 2)
        rise = 1.65 + 0.12 * (i % 3)
        tip_z = 1.25 - 0.15 * (i % 2)
        col = FROND_YOUNG if i % 2 == 0 else FROND
        add_arched_fern_frond(m, top + Vector((0, 0, 0.02)), a, reach, rise, tip_z, 0.34, col, FROND_UNDER)

    # Tier 2 (middle wide-arching fountain whorl): 11 narrow mature fronds (11 x 8 = 88 tris)
    for i in range(11):
        a = (2 * math.pi * i / 11) + 0.33
        reach = 3.10 + 0.20 * (i % 3)
        rise = 1.18 - 0.08 * (i % 2)
        tip_z = 0.25 - 0.20 * (i % 2)
        add_arched_fern_frond(m, top, a, reach, rise, tip_z, 0.38, FROND, FROND_UNDER)

    # Tier 3 (outer spreading/drooping whorl): 12 narrow lower fronds (12 x 8 = 96 tris)
    for i in range(12):
        a = (2 * math.pi * i / 12) + 0.05
        reach = 3.35 + 0.15 * (i % 2)
        rise = 0.72 - 0.06 * (i % 2)
        tip_z = -0.45 - 0.18 * (i % 3)
        add_arched_fern_frond(m, top + Vector((0, 0, -0.06)), a, reach, rise, tip_z, 0.36, FROND, FROND_UNDER)

    return C.build_object(m, "xaxim")


if __name__ == "__main__":
    C.run(build, name="xaxim", budget=400, target="~6 u (understorey)", preview_kw=C.TREE_VIEW)
