"""
Walkway modules shared by the Copa canopy walkway, the restinga boardwalk and the mangrove
boardwalk (game/PARK.md sections 4.2, 5.1, 5.2; inventory p22 section 7, priority 1).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/passarela.py [-- --no-render]

Files (in $CUSTOM_RAW_DIR; bake.py prefixes them with custom-):
- passarela-deck.glb: a 2 x 2 u deck tile with one post frame (two posts, a cross beam and two
  knee braces) under its middle. <= 200 tris.
- passarela-deck-livre.glb: the same tile without the post frame, for the spans between frames
  (alternate the two: one frame every 4 u). <= 200 tris.
- passarela-guarda.glb: one 2 u rail panel on the tile's +X edge: a post at the middle, a
  handrail, a kick rail and a crossed rope net. <= 200 tris.
- passarela-mirante.glb: an inline lookout, an elongated octagon 5.2 u wide and 4 u long (two
  tiles), open at both ends, railed on the six other sides. <= 300 tris (it replaces two deck
  tiles and four rail panels, 2 x 80 + 4 x 42 = 328 tris).
- passarela-escada.glb: a 2 u wide stair from the ground up to the deck, 8 rises of 0.5 u.
  <= 200 tris.

Shared frame (glTF axes; Blender: front = -Y):
- The origin is on the ground under the path's centreline. The walking surface is at
  y = 4.0 u (PARK.md: the Copa deck is 4 u above the forest floor). For the restinga (about 1 u)
  and the mangrove (1.5 u) the same tiles are placed 3.0 and 2.5 u lower, so the posts sink into
  the sand or mud; a tile placed higher than 4 u above the ground shows a gap under its posts.
- Tiles run along z from -1 to +1 and are 2 u wide (x from -1 to +1), the width of PARK.md and
  of the Boardwalk mechanic's collider. Place one every 2 u along the path, yawed to the path's
  direction. On the 26-32 u loops the outer edge opens by about 0.08 u per joint.
- The rail panel sits on the +X edge; its post is at the tile's middle (z = 0), so the same
  panel turned 180 degrees is the -X rail and both posts line up with the deck frame. Handrail
  top at 1.4 u above the deck, like the mechanic's collider.
- The stair's top edge is at z = 0, y = 4.0; it descends towards +z (glTF; the model's front) to
  the ground at z = 5.6. Put it at the end of the last tile with that tile's yaw.
- The lookout is centred on its origin: its open ends are the 2 u edges at z = -2 and z = +2,
  so it replaces two tiles in a straight run.

Colours: wood ramp (planks wood[2]/wood[3], posts and rails wood[1]/wood[2], beams wood[0]) and
soil[3] for the rope net, as the bridge and fixture meshes use.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
import _props as P  # noqa: E402
from _props import ROPE, W  # noqa: E402

WALK = 4.0
DECK_T = 0.22
HALF = 1.0
RAIL_X = 0.9
RAIL_TOP = WALK + 1.4


def deck_tile(m: C.Mesh) -> None:
    # Four transverse planks (alternating tones) on one closed slab.
    P.plank_floor(m, (0, 0, WALK), 2.0, 2.0, DECK_T, 4, along="x")
    # Two stringers under the planks, open where they meet the next tile.
    for x in (-0.72, 0.72):
        P.beam(m, (x, -HALF, WALK - DECK_T - 0.14), (x, HALF, WALK - DECK_T - 0.14), 0.2, 0.28, W[0],
               ends=False, colours={"top": W[1]})


def post_frame(m: C.Mesh) -> None:
    z_beam = WALK - DECK_T - 0.28 - 0.16
    # Cross beam under the stringers, proud of the deck edges like a Kenney dock.
    m.box((0, 0, z_beam), (2.36, 0.26, 0.32), W[0], colours={"top": W[1]})
    for x in (-1.04, 1.04):
        P.post(m, x, 0, 0.0, WALK - DECK_T, 0.26, W[1], cap=False)
        s = 1 if x > 0 else -1
        # Knee brace from the post to the cross beam.
        P.beam(m, (x - s * 0.08, 0, z_beam - 1.0), (x - s * 0.62, 0, z_beam - 0.12), 0.14, 0.14, W[1],
               ends=False, up=C.V(0, 1, 0))


def build_deck():
    m = C.Mesh("passarela-deck")
    deck_tile(m)
    post_frame(m)
    return C.build_object(m, "passarela-deck")


def build_deck_livre():
    m = C.Mesh("passarela-deck-livre")
    deck_tile(m)
    return C.build_object(m, "passarela-deck-livre")


def rail_panel(m: C.Mesh, a, b, *, post_at=None, net: bool = True, kick: bool = True) -> None:
    """A rail between 2D points a and b at the rail line: handrail, kick rail and a rope X."""
    a3 = C.V(a[0], a[1], 0)
    b3 = C.V(b[0], b[1], 0)
    P.beam(m, a3 + C.V(0, 0, RAIL_TOP - 0.07), b3 + C.V(0, 0, RAIL_TOP - 0.07), 0.16, 0.14, W[2],
           ends=False, colours={"top": W[3]})
    if kick:
        P.beam(m, a3 + C.V(0, 0, WALK + 0.16), b3 + C.V(0, 0, WALK + 0.16), 0.1, 0.12, W[1], ends=False)
    if net:
        lo, hi = WALK + 0.22, RAIL_TOP - 0.14
        P.beam(m, a3 + C.V(0, 0, lo), b3 + C.V(0, 0, hi), 0.05, 0.05, ROPE, ends=False)
        P.beam(m, a3 + C.V(0, 0, hi), b3 + C.V(0, 0, lo), 0.05, 0.05, ROPE, ends=False)
    for p in post_at or []:
        P.post(m, p[0], p[1], WALK, RAIL_TOP + 0.08, 0.2, W[1], top=W[2])


def build_guarda():
    m = C.Mesh("passarela-guarda")
    rail_panel(m, (RAIL_X, -HALF), (RAIL_X, HALF), post_at=[(RAIL_X, 0.0)])
    return C.build_object(m, "passarela-guarda")


OCT = [(1.0, -2.0), (2.6, -0.9), (2.6, 0.9), (1.0, 2.0), (-1.0, 2.0), (-2.6, 0.9), (-2.6, -0.9), (-1.0, -2.0)]


def build_mirante():
    m = C.Mesh("passarela-mirante")
    P.polygon_floor(m, OCT, WALK, DECK_T, 8)
    z_beam = WALK - DECK_T - 0.16
    for x in (-0.72, 0.72):  # stringers continue the tiles' through the lookout
        P.beam(m, (x, -2.0, z_beam), (x, 2.0, z_beam), 0.2, 0.28, W[0], colours={"top": W[1]})
    for y in (-0.9, 0.9):  # cross beams under the wide part
        m.box((0, y, z_beam - 0.3), (5.3, 0.26, 0.32), W[0], colours={"top": W[1]})
        for x in (-2.3, 2.3):
            P.post(m, x, y, 0.0, z_beam - 0.46, 0.28, W[1], cap=False)
    # Rails on both sides, inset 0.1 u: three panels per side, posts at the four vertices.
    inset = 0.1
    for s in (1, -1):
        chain = [(s * (1.0 - inset * 0.5), -2.0 + inset * 0.5), (s * (2.6 - inset), -0.9),
                 (s * (2.6 - inset), 0.9), (s * (1.0 - inset * 0.5), 2.0 - inset * 0.5)]
        for i in range(3):
            rail_panel(m, chain[i], chain[i + 1], net=(i == 1), kick=(i == 1))
        for p in chain:  # no cap: the handrail runs over the post top
            P.post(m, p[0], p[1], WALK, RAIL_TOP, 0.2, W[1], cap=False)
    return C.build_object(m, "passarela-mirante")


RISES = 8
RISE = WALK / RISES
TREAD = 0.7


def build_escada():
    m = C.Mesh("passarela-escada")
    # Treads k = 1..7 (the 8th rise ends on the deck at z = 0). The stair descends towards -Y
    # in Blender, which is +z (the front) in glTF.
    for k in range(1, RISES):
        y1 = -(RISES - k - 1) * TREAD  # back edge (towards the deck)
        y0 = y1 - TREAD
        z = k * RISE
        m.box((0, (y0 + y1) / 2, z - 0.06), (2.0, TREAD + 0.04, 0.12), W[1],
              colours={"top": W[2] if k % 2 else W[3], "bottom": W[0]})
    run = (RISES - 1) * TREAD
    for x in (-1.08, 1.08):
        P.beam(m, (x, -run - 0.45, 0.0), (x, 0.0, WALK - 0.02), 0.16, 0.42, W[0], colours={"top": W[1]})
        # Handrail on two posts.
        P.post(m, x, -run + 0.2, 0.0, RISE * 1 + 1.4, 0.18, W[1], top=W[2])
        P.post(m, x, -0.15, WALK - RISE, RAIL_TOP + 0.05, 0.18, W[1], top=W[2])
        P.beam(m, (x, -run + 0.2, RISE + 1.3), (x, -0.15, RAIL_TOP - 0.05), 0.14, 0.13, W[2], ends=False,
               colours={"top": W[3]})
    return C.build_object(m, "passarela-escada")


if __name__ == "__main__":
    kw = {"elevation_deg": 18.0, "res": (900, 900)}
    P.run_all([
        ("passarela-deck", build_deck, 200, "2 x 2 u tile, walk surface 4.0 u", kw),
        ("passarela-deck-livre", build_deck_livre, 200, "2 x 2 u tile without posts, walk surface 4.0 u", kw),
        ("passarela-guarda", build_guarda, 200, "2 u rail panel, handrail 1.4 u above the deck", kw),
        ("passarela-mirante", build_mirante, 300, "5.2 x 4 u inline lookout, walk surface 4.0 u", kw),
        ("passarela-escada", build_escada, 200, "2 u wide stair, 8 x 0.5 u rises to 4.0 u", kw),
    ])
