"""
Restinga plants for Praia e Costão (game/PARK.md section 5.1, P4 "Restinga": the three plants
the player photographs from the boardwalk are a bromélia, a pitangueira and a cactus; the
praia zone scatters 20 pitangueiras and 14 cacti as PlantSpots).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/restinga.py [-- --no-render]

Files (in $CUSTOM_RAW_DIR; pack_props.py prefixes them with custom-):
- cacto-da-restinga.glb: a creeping clump of Cereus fernambucensis, 1.9 u across and 0.9 u
  tall, with three ripe fruits. <= 200 tris (the flora/prop budget of audit.mjs).
- pitangueira.glb: a pitanga shrub (Eugenia uniflora), 3.3 u tall and 3 u across, with red
  ribbed fruits and a few flushes of reddish young leaves. <= 450 tris (Tree v2).

Scale: like the bromélia, the cactus takes the x1.5 of small things (a 40 cm clump stands 0.6 u;
its upturned stem tips are drawn to 0.9 u so they read from the boardwalk). The pitangueira is
a shrub a little taller than the 3 u avatar, as the 2-4 m shrubs of the sources are taller than
a child; the trees' own compressed scale (ipê 10.5 u) would make it shorter than the avatar.

Biology and colours (ART.md section 2: plants keep to the ramps; fruit colours are the
species' own, lightness inside 12-90%):
- Cacto (Cereus fernambucensis Lem., "mandacaru-da-praia", "cardo-da-praia"): endemic to
  Brazil; many-branched clumps of creeping, sprawling stems on restinga sand and rocks of the
  coast of RJ, SP, ES and southern BA, up to 40 cm tall and 4-5 m wide; subsp. fernambucensis
  is light green to yellowish with 4-5 ribs and red-orange fruits; fruits crimson, narrowly
  oblong, 6-7 cm (Flora e Funga do Brasil via Wikidata Q1055059; Useful Tropical Plants,
  https://tropical.theferns.info/viewtropical.php?id=Cereus+fernambucensis ; PMC12730033).
  -> 4-sided stems (the ribs) in grass[2]/grass[3], fruit #b8263a (crimson, L 44%). The white
  night flowers open around 23:00 and are closed by day, when the game is played, so none.
- Pitangueira (Eugenia uniflora L.): a dense shrub 2-4 m, rarely a small tree, with a rounded
  crown 3-6 m across; leaves glossy dark green, the young ones reddish; the berry is globose,
  flattened at the poles, with 7-10 longitudinal grooves, 1.5-5 cm (Embrapa, Alice
  https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1106305/1/Pitanga.pdf ; UFSC Horto
  Didático https://hortodidatico.ufsc.br/pitangueira/ for the reddish young leaves). -> crown
  in leaf[1]/leaf[2], young flushes #9c4632 (L 40%), trunk wood[1], fruit #c8281e (L 45%)
  drawn as a hexagonal, flattened bipyramid (the grooves) at x3 so a child can spot it.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
import _props as P  # noqa: E402
from _props import G, L, W  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

CACTO_FRUTO = "#b8263a"
PITANGA = "#c8281e"
PITANGA_SOMBRA = "#9e1f19"
FOLHA_NOVA = "#9c4632"

# --------------------------------------------------------------------------- cacto-da-restinga

# Each stem: a creeping run over the sand that turns up at the tip, (x, y) of its start and its
# heading (deg), its length on the ground and the height its tip reaches.
STEMS = [
    ((0.0, 0.0), 15, 0.75, 0.75),
    ((0.1, 0.05), 130, 0.7, 0.55),
    ((-0.05, 0.05), 215, 0.8, 0.68),
    ((0.0, -0.1), 290, 0.65, 0.5),
    ((0.15, -0.05), 345, 0.45, 0.4),
    ((0.05, 0.12), 70, 0.5, 0.62),
]
STEM_R = 0.14


def cacto():
    m = C.Mesh("cacto-da-restinga")
    for i, ((x, y), heading, run, top) in enumerate(STEMS):
        d = Vector((math.cos(math.radians(heading)), math.sin(math.radians(heading)), 0))
        start = Vector((x, y, STEM_R * 0.7))
        bend = start + d * run
        pts = [start, start + d * run * 0.55 + Vector((0, 0, 0.02)), bend + Vector((0, 0, 0.08)),
               bend + d * 0.1 + Vector((0, 0, top))]
        cols = [G[2], G[3], G[2], G[3]] if i % 2 else [G[3], G[2], G[3], G[2]]
        m.tube(pts, [STEM_R * 1.05, STEM_R, STEM_R * 0.95, STEM_R * 0.8], 4, G[2], cap_end=True,
               colours=cols, twist=math.pi / 4)
        if i in (0, 2, 5):
            # One ripe fruit near the tip, on the stem's side: an oblong 4-sided bipyramid.
            tip = pts[-1]
            side = d.cross(Vector((0, 0, 1))).normalized() * (STEM_R + 0.02)
            c = tip + side + Vector((0, 0, -0.18))
            m.tube([c - Vector((0, 0, 0.12)), c, c + Vector((0, 0, 0.12))], [0.0, 0.075, 0.0], 4, CACTO_FRUTO,
                   cap_end=False)
    lo = min(v.z for v in m.verts)
    m.transformed(Matrix.Translation((0, 0, -lo)))
    return C.build_object(m, "cacto-da-restinga")


# --------------------------------------------------------------------------- pitangueira

# Crown blocks (base centre, rx, ry, height, twist): a low, rounded, dense shrub crown.
CROWN = [
    ((0.0, 0.0, 0.7), 1.45, 1.35, 1.65, 0.0),
    ((0.55, 0.35, 1.55), 0.95, 0.9, 1.6, 0.4),
    ((-0.6, -0.3, 1.4), 0.9, 0.85, 1.4, 0.9),
]
FLUSH = [(-0.2, 0.2, 2.98, 0.34), (0.75, -0.25, 2.98, 0.3), (-1.05, -0.2, 2.62, 0.28)]
FRUIT = [
    (1.42, -0.2, 1.3), (0.9, -1.05, 1.15), (-0.35, -1.35, 1.25), (-1.38, -0.55, 1.6), (0.2, 1.38, 1.4),
    (1.3, 0.75, 2.2), (-1.05, 0.95, 2.0), (0.6, -0.95, 2.3), (-0.8, -0.95, 2.45),
]


def pitanga(m: C.Mesh, c: Vector) -> None:
    """A ripe pitanga, hanging upright: a flattened hexagonal bipyramid (the grooves)."""
    r, h = 0.13, 0.09
    up = Vector((0, 0, 1))
    ring = [c + Vector((math.cos(2 * math.pi * k / 6) * r, math.sin(2 * math.pi * k / 6) * r, 0)) for k in range(6)]
    for k in range(6):
        a, b = ring[k], ring[(k + 1) % 6]
        col = PITANGA if k % 2 else PITANGA_SOMBRA
        m.add_out([a, b, c + up * h], col, c)
        m.add_out([b, a, c - up * h], PITANGA_SOMBRA, c)


def pitangueira():
    m = C.Mesh("pitangueira")
    # Two short, twisted trunks from one base, smooth light bark.
    m.tube([(0, 0, 0), (0.12, 0.05, 0.45), (0.05, 0.1, 0.95)], [0.13, 0.11, 0.09], 5, W[1], cap_end=True,
           colours=[W[1], W[2], W[1]])
    m.tube([(0, 0, 0), (-0.18, -0.06, 0.4), (-0.32, -0.1, 0.85)], [0.12, 0.1, 0.08], 5, W[1], cap_end=True,
           colours=[W[1], W[2], W[1]])
    for (cx, cy, cz), rx, ry, h, tw in CROWN:
        m.chunk((cx, cy, cz), rx, ry, h, 6, L[1], twist=tw, colour_top=L[2], colour_bottom=L[0], chamfer=0.32)
    # Flushes of young leaves on the crown's top, reddish.
    for x, y, z, r in FLUSH:
        m.slab((x, y, z - 0.12), r, r * 0.85, 0.2, 5, FOLHA_NOVA, colour_top=FOLHA_NOVA, colour_bottom=L[1],
               taper=0.45, twist=x)
    # Ripe fruits at the crown's outer surface.
    centre = Vector((0, 0, 1.6))
    for x, y, z in FRUIT:
        p = Vector((x, y, z))
        out = (p - centre).normalized()
        pitanga(m, p + out * 0.05)
    lo = min(v.z for v in m.verts)
    m.transformed(Matrix.Translation((0, 0, -lo)))
    return C.build_object(m, "pitangueira")


if __name__ == "__main__":
    P.run_all([
        ("cacto-da-restinga", cacto, 200, "1.9 u creeping cactus clump, tips 0.9 u (x1.5)",
         {"elevation_deg": 25.0, "closeup": True, "res": (900, 900)}),
        ("pitangueira", pitangueira, 450, "3.3 u pitanga shrub with red fruit", {"elevation_deg": 8.0, "res": (900, 1000)}),
    ])
