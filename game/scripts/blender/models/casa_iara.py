"""
Casa na árvore da Iara (game/PARK.md section 3: "A platform 6 u up with a rail", mission 0,
the first climb of the game; inventory p22 section 7, priority 3). <= 800 tris.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/casa_iara.py [-- --no-render]

File: casa-iara.glb (bake.py prefixes custom-).

Shape:
- A 4.4 x 4.4 u plank deck whose top is at 6.0 u, on four splayed log stilts with diagonal
  braces, so it stands on its own next to the ipê's neighbour tree (place the back edge against
  the trunk; the crown overhangs the roof). It does not depend on a trunk passing through it.
- A rail 1.2 u high (handrail at 7.2 u) on the left and right sides with Kenney-style crossed
  braces, and on the front either side of a 1.7 u opening for the ladder. The back is a plank
  wall with a wide window, the "casa" part, and a thatched gable roof (eaves 9.3 u, ridge
  10.9 u) on four corner posts: 3.3 u of headroom for the 3 u avatar.
- A vertical ladder on the front, rails 1.3 u apart and rungs every 0.45 u like the Ladder
  fixture mesh (src/mechanics/meshes.ts), its rails running 0.8 u above the deck as hand holds.

Ladder mechanic (src/mechanics/ladder.ts, LadderSpec feet positions), in the model's glTF axes
(x right, y up, z towards the front), also exported as empties with these names:
- ladder-base (0, 0, 2.65): 0.35 u in front of the ladder plane (z = 2.3), so the avatar's
  body stays in front of the rungs;
- ladder-top (0, 6.0, 2.65);
- ladder-exit (0, 6.0, 0.65): on the deck, 1.55 u inside the front edge, clear of the ladder
  and the rails (2 u from the base, as in the fixture);
- radius 0.85 (the fixture's value).
Rotate and translate the three points with the model's placement.

Colours: wood ramp only (deck wood[2]/wood[3], stilts and beams wood[0], posts wood[1],
rails wood[2]), thatch wood[3] over wood[2] (dry palm thatch, the same as the tower and the bird
hide), the potted plant leaf[1]/leaf[2] in a soil[1] pot.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
import _props as P  # noqa: E402
from _props import L, S, W  # noqa: E402
from mathutils import Vector  # noqa: E402

DECK = 6.0
HALF = 2.2
EDGE = 2.05  # post line
RAIL = DECK + 1.2
EAVE = 9.3
RIDGE = 10.9
LADDER_Y = -2.3
LADDER_X = 0.65
OPEN = 0.85


def build():
    m = C.Mesh("casa-iara")
    # Deck: 8 planks on a closed slab.
    P.plank_floor(m, (0, 0, DECK), 2 * HALF, 2 * HALF, 0.3, 8, along="x")
    # Joists under the deck, proud of the sides.
    for y in (-1.5, 1.5):
        P.beam(m, (-2.55, y, DECK - 0.45), (2.55, y, DECK - 0.45), 0.3, 0.3, W[0], colours={"top": W[1]})
    # Four splayed log stilts and their braces.
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.tube([(sx * 2.15, sy * 2.0, 0.0), (sx * 1.85, sy * 1.5, DECK - 0.6)], [0.25, 0.21], 6, W[0],
                   cap_end=False, twist=math.pi / 6)
            P.beam(m, (sx * 2.06, sy * 1.86, 2.6), (sx * 0.9, sy * 1.5, DECK - 0.62), 0.16, 0.16, W[1],
                   ends=False)
    # Corner posts from the deck to the eaves.
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.post(m, sx * EDGE, sy * EDGE, DECK, EAVE, 0.24, W[1], cap=False)
    # Side rails (left and right): handrail, mid rail and a crossed brace.
    for sx in (-1, 1):
        x = sx * EDGE
        P.beam(m, (x, -EDGE, RAIL), (x, EDGE, RAIL), 0.16, 0.14, W[2], ends=False, colours={"top": W[3]})
        P.beam(m, (x, -EDGE, DECK + 0.55), (x, EDGE, DECK + 0.55), 0.1, 0.12, W[1], ends=False)
        P.beam(m, (x, -EDGE, DECK + 0.08), (x, EDGE, RAIL - 0.08), 0.08, 0.1, W[1], ends=False, up=C.V(sx, 0, 0))
        P.beam(m, (x, -EDGE, RAIL - 0.08), (x, EDGE, DECK + 0.08), 0.08, 0.1, W[1], ends=False, up=C.V(sx, 0, 0))
    # Front rail either side of the ladder opening.
    for sx in (-1, 1):
        a, b = sx * EDGE, sx * OPEN
        P.beam(m, (a, -EDGE, RAIL), (b, -EDGE, RAIL), 0.16, 0.14, W[2], ends=False, colours={"top": W[3]})
        P.beam(m, (a, -EDGE, DECK + 0.55), (b, -EDGE, DECK + 0.55), 0.1, 0.12, W[1], ends=False)
        P.post(m, b, -EDGE, DECK, RAIL + 0.15, 0.2, W[1], top=W[2])
    # Back wall with a wide window (the "casa").
    wy = EDGE + 0.02
    m.box((0, wy, DECK + 0.5), (2 * EDGE, 0.14, 1.0), W[1], skip=("bottom",), colours={"top": W[2], "ny": W[2]})
    m.box((0, wy, EAVE - 0.6), (2 * EDGE, 0.14, 1.2), W[1], skip=("top",), colours={"ny": W[2]})
    for sx in (-1, 1):
        m.box((sx * 1.45, wy, DECK + 1.55), (1.2, 0.14, 1.1), W[1], skip=("top", "bottom"), colours={"ny": W[2]})
    m.box((0, wy - 0.06, DECK + 1.03), (1.8, 0.3, 0.08), W[2], skip=("bottom",), colours={"top": W[3]})
    # Gable roof, ridge along X: two thatch layers per slope, a ridge cap and gable boards.
    for sy in (-1, 1):
        for layer, (over, lift, col, top) in enumerate([(0.6, 0.0, W[2], W[2]), (0.45, 0.2, W[2], W[3])]):
            p_eave = Vector((0, sy * (EDGE + over), EAVE - 0.18 * (1 - layer) + lift - over * 0.55))
            p_ridge = Vector((0, 0, RIDGE + lift))
            width = 2 * EDGE + (1.1 if layer == 0 else 0.8)
            d = p_ridge - p_eave
            up = Vector((0, -d.z, d.y))  # the roof normal, pointing up and out
            if up.z < 0:
                up = -up
            # basis puts local Y along the slope and local Z on the roof normal ("top" = outside)
            m.box((p_eave + p_ridge) / 2, (width, d.length, 0.22), col, rot=P.basis(d, up), colours={"top": top})
            if layer == 0:
                # A ragged thatch fringe hanging from the eave (single-sided, facing out).
                edge = p_eave - up.normalized() * 0.11
                n = 9
                for k in range(n):
                    x0 = -width / 2 + width * k / n
                    x1 = x0 + width / n
                    drop = 0.34 if k % 2 else 0.24
                    tip = Vector(((x0 + x1) / 2, edge.y + sy * 0.04, edge.z - drop))
                    m.add_out([(x0, edge.y, edge.z), (x1, edge.y, edge.z), tip], W[3], (0, 0, edge.z))
    m.box((0, 0, RIDGE + 0.3), (2 * EDGE + 1.0, 0.36, 0.22), W[0], colours={"top": W[1]})
    for sx in (-1, 1):
        x = sx * EDGE
        m.add_out([(x, -EDGE, EAVE), (x, EDGE, EAVE), (x, 0, RIDGE - 0.05)], W[1], (0, 0, EAVE + 0.4))
    # Ladder: two rails from the ground to 0.8 u above the deck, rungs every 0.45 u.
    for sx in (-1, 1):
        m.box((sx * LADDER_X, LADDER_Y, (DECK + 0.8) / 2), (0.14, 0.16, DECK + 0.8), W[1], skip=("bottom",),
              colours={"top": W[2]})
    z = 0.35
    while z < DECK - 0.1:
        P.beam(m, (-LADDER_X, LADDER_Y, z), (LADDER_X, LADDER_Y, z), 0.11, 0.11, W[2], ends=False,
               colours={"top": W[3]})
        z += 0.45
    # A potted bromeliad-like plant on the back-left corner of the deck.
    pot = Vector((-1.55, 1.5, DECK))
    m.box(pot + Vector((0, 0, 0.2)), (0.42, 0.42, 0.4), S[1], skip=("bottom",), colours={"top": S[0]})
    for k in range(3):
        a = 2.1 * k + 0.4
        d = Vector((math.cos(a), math.sin(a), 0))
        m.blade(pot + Vector((0, 0, 0.38)), pot + d * 0.42 + Vector((0, 0, 0.85)), 0.26,
                L[2] if k % 2 else L[1], colour_under=L[1], bend=Vector((0, 0, 0.05)))

    ob = C.build_object(m, "casa-iara")
    for name, loc in (("ladder-base", (0, LADDER_Y - 0.35, 0)), ("ladder-top", (0, LADDER_Y - 0.35, DECK)),
                      ("ladder-exit", (0, LADDER_Y - 0.35 + 2.0, DECK))):
        C.empty(name, loc, parent=ob)
    return ob


if __name__ == "__main__":
    C.run(build, name="casa-iara", budget=800, target="deck top 6.0 u, 4.4 x 4.4 u, ridge 10.9 u",
          preview_kw={"elevation_deg": 14.0, "res": (1000, 1000), "azimuth_deg": -30.0})
