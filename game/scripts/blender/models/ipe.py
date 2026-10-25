"""
Ipê-amarelo and ipê-rosa in bloom, canopy tier ~11 u (ART.md section 3), <= 400 tris each.
One broadleaf form, two files: ipe-amarelo.glb (ACCENT.ipeAmarelo) and ipe-rosa.glb
(ACCENT.ipeRosa). A child node `flores-caidas` is the carpet of fallen flowers under the
tree, so the game can hide it on steep ground.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/ipe.py

Shape decisions and sources:
- Deciduous; flowers come before the leaves, so a tree in bloom is almost leafless:
  Embrapa, Espécies Arbóreas Brasileiras v.1, Ipê-amarelo (Handroanthus albus: "árvore
  caducifólia", "Copa alta densifoliada, arredondada a umbeliforme", flowering July-October),
  https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140083/1/Especies-Arboreas-Brasileiras-vol-1-Ipe-Amarelo.pdf
  ; Martini et al. 2019, REVSBAU, H. chrysotrichus flowers in August-September "período no
  qual a planta também fica desprovida de folhas", https://doi.org/10.5380/revsbau.v6i4.66488
- Ipê-roxo/rosa (Handroanthus heptaphyllus): "Copa larga, mas esparsa", "As flores aparecem
  antes das folhas": Embrapa v.1, Ipê-roxo,
  https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140086/1/Especies-Arboreas-Brasileiras-vol-1-Ipe-Roxo.pdf
- So: a short trunk forking into three spreading limbs (an open, rounded-to-umbrella crown
  with the branches visible between the flower masses), five chunky flower masses, two small
  leaf tufts (leaf ramp) for the first new leaves, and the fallen flowers on the ground.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

BARK = C.ramp("wood", 1)
LEAF = C.ramp("leaf", 2)
LEAF_DARK = C.ramp("leaf", 1)


def tree(flower: str) -> C.Mesh:
    m = C.Mesh("ipe")
    fork = Vector((0, 0, 5.0))
    m.tube([(0, 0, 0), (0, 0, 0.5), fork], [0.62, 0.44, 0.34], 6, BARK, cap_end=False, twist=0.3)
    limbs = [(0.2, 3.1, 3.1), (2.3, 2.8, 3.5), (4.3, 3.2, 2.8)]
    tips = []
    for a, reach, rise in limbs:
        d = Vector((math.cos(a), math.sin(a), 0))
        mid = fork + d * reach * 0.55 + Vector((0, 0, rise * 0.62))
        tip = fork + d * reach + Vector((0, 0, rise))
        m.tube([fork - d * 0.1, mid, tip], [0.28, 0.2, 0.13], 5, BARK, cap_end=False, twist=a)
        tips.append((a, tip))
    # Flower masses at the limb tips, plus a crown mass and one low side mass.
    for a, tip in tips:
        m.chunk(tip + Vector((0, 0, -0.55)), 1.9, 1.75, 1.75, 6, flower, chamfer=0.32, twist=a)
    m.chunk((0.15, 0.1, 8.75), 2.0, 1.9, 1.7, 6, flower, chamfer=0.32, twist=0.5)
    lo = Vector((math.cos(1.25), math.sin(1.25), 0)) * 2.1 + Vector((0, 0, 6.7))
    m.chunk(lo, 1.35, 1.25, 1.3, 6, flower, chamfer=0.32, twist=1.25)
    # The first few leaves of the season, low in the crown.
    for a, r, z in [(3.3, 2.2, 6.6), (5.4, 2.4, 7.1)]:
        c = Vector((math.cos(a) * r, math.sin(a) * r, z))
        m.chunk(c, 0.85, 0.75, 0.75, 5, LEAF, chamfer=0.35, twist=a, colour_bottom=LEAF_DARK)
    return m


def fallen(flower: str) -> C.Mesh:
    """The carpet of fallen flowers: one irregular flat octagon and two loose patches."""
    m = C.Mesh("flores-caidas")
    pts = []
    for k in range(8):
        a = 2 * math.pi * k / 8 + 0.2
        r = 3.0 + (0.6 if k % 3 == 0 else -0.3 if k % 3 == 1 else 0.15)
        pts.append(Vector((math.cos(a) * r + 0.3, math.sin(a) * r * 0.9 - 0.2, 0.03)))
    m.add(pts, flower)
    for cx, cy, s in [(3.9, 1.6, 0.55), (-3.4, -2.3, 0.45)]:
        m.add([(cx - s, cy - s * 0.7, 0.03), (cx + s, cy - s * 0.5, 0.03), (cx + s * 0.6, cy + s * 0.8, 0.03),
               (cx - s * 0.7, cy + s * 0.6, 0.03)], flower)
    return m


def build_variant(flower: str, name: str):
    def build():
        root = C.build_object(tree(flower), name)
        C.build_object(fallen(flower), "flores-caidas", parent=root, pivot=(0, 0, 0))
        return root

    return build


if __name__ == "__main__":
    C.run(build_variant(C.ACCENT["ipeAmarelo"], "ipe-amarelo"), name="ipe-amarelo", budget=400,
          target="~11 u (canopy)", preview_kw=C.TREE_VIEW)
    C.run(build_variant(C.ACCENT["ipeRosa"], "ipe-rosa"), name="ipe-rosa", budget=400,
          target="~11 u (canopy)", preview_kw=C.TREE_VIEW)
