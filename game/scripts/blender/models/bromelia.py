"""
Bromélia-tanque (tank bromeliad), ground cover / epiphyte, ~100 tris, two files:
bromelia.glb (plain) and bromelia-centro-vermelho.glb (flowering, red centre).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/bromelia.py

Size: not in the ART.md scale table; drawn with the x1.5 factor of small things (props and
animals) so it reads next to the 3 u avatar: a real 40-60 cm rosette becomes ~1.6 u wide
and ~1 u tall.

Shape decisions and sources:
- Leaves in a spiral rosette whose bases overlap into small tanks that hold rain water
  ("armazenam água da chuva ... distribuição espiralada de suas folhas, que formam pequenos
  tanques"): Cogliatti-Carvalho et al. 2010, Acta Bot. Bras.,
  https://doi.org/10.1590/s0102-33062010000100009 . Hence channelled (keeled) leaves
  and a little water (water[1]) in the centre. Leaves are solid keeled wedges.
- Red centre at flowering: in Neoregelia carolinae the inner leaves turn "vermelhas ou
  róseas na base durante a floração" (Kessous et al. 2019, Rodriguésia,
  https://doi.org/10.1590/2175-7860201970021); in Nidularium innocentii it is the bracts
  that turn red (CNCFlora). The variant paints the inner whorl the documented species red.
- Leaf texture varies by species ("cartácea" in N. carolinae), so "stiff" is read as
  firm, arching straps rather than rigid spikes.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

# Leaf ramp, not grass: the plant must not vanish into the grass[2] ground.
GREEN = C.ramp("leaf", 3)
GREEN_UNDER = C.ramp("leaf", 2)
GREEN_YOUNG = C.ramp("grass", 3)
RED = C.SPECIES["bromeliaVermelho"]
WATER = C.ramp("water", 1)
UP = Vector((0, 0, 1))


def wedge_leaf(m: C.Mesh, root: Vector, tip: Vector, width: float, thick: float, arch: float, top: str, side: str):
    """A thick strap leaf, Kenney-chunky: a triangular section with a flat upper face and
    a keel below (the channel that feeds the tank), widest at 40 % of its length and
    arched upwards; closed solid, 9 triangles."""
    axis = tip - root
    across = axis.cross(UP).normalized()
    up = across.cross(axis).normalized()

    def section(c, w, t):
        return [c - across * w / 2 + up * t / 2, c + across * w / 2 + up * t / 2, c - up * t / 2]

    mid = root + axis * 0.4 + UP * arch
    a = section(root, width * 0.55, thick)
    b = section(mid, width, thick)
    cols = [top, side, side]  # faces: upper (0-1), keel sides (1-2, 2-0)
    inside_root = (sum(a, Vector()) + sum(b, Vector())) / 6
    inside_tip = (sum(b, Vector()) + tip) / 4
    for k in range(3):
        k1 = (k + 1) % 3
        m.add_out([a[k], a[k1], b[k1], b[k]], cols[k], inside_root)
        m.add_out([b[k], b[k1], tip], cols[k], inside_tip)


def rosette(red_centre: bool) -> C.Mesh:
    m = C.Mesh("bromelia")
    golden = math.radians(137.5)
    # Outer whorl: 7 broad leaves rising and arching out: a vase.
    for i in range(7):
        a = i * 2 * math.pi / 7 + 0.15
        d = Vector((math.cos(a), math.sin(a), 0))
        root = d * 0.06 + UP * 0.08
        tip = d * (0.95 + 0.06 * (i % 2)) + UP * (0.3 + 0.08 * (i % 3))
        wedge_leaf(m, root, tip, 0.5, 0.1, 0.36, GREEN, GREEN_UNDER)
    # Inner whorl: 4 narrower, more upright leaves around the tank.
    inner = RED if red_centre else GREEN_YOUNG
    for i in range(4):
        a = i * golden + 0.6
        d = Vector((math.cos(a), math.sin(a), 0))
        root = d * 0.05 + UP * 0.12
        tip = d * (0.5 + 0.05 * (i % 2)) + UP * (0.92 + 0.06 * (i % 3))
        wedge_leaf(m, root, tip, 0.36, 0.09, 0.12, inner, inner if red_centre else GREEN_UNDER)
    # Rain water held in the tank.
    m.add([Vector((math.cos(a) * 0.14, math.sin(a) * 0.14, 0.27)) for a in (2 * math.pi * k / 6 for k in range(6))], WATER)
    return m


def build_variant(red: bool, name: str):
    return lambda: C.apply_v2_foliage(C.build_object(rosette(red), name), mode="cover")


if __name__ == "__main__":
    small = {"elevation_deg": 22.0, "closeup": True, "res": (900, 900)}
    C.run(build_variant(False, "bromelia"), name="bromelia", budget=150, target="~1 u tall, ~1.6 u wide",
          preview_kw=small)
    C.run(build_variant(True, "bromelia-centro-vermelho"), name="bromelia-centro-vermelho", budget=150,
          target="~1 u tall, ~1.6 u wide", preview_kw=small)
