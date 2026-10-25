"""
Rosetas da onça-pintada (Panthera onca): dark blocky rosettes and solid spots for the Cube
Pets tiger, which the game recolours as the jaguar (palette-onca-pintada.png, stripes
painted out). Rosettes are how kids tell an onça from a tiger, so they are the point here.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/rosetas_onca.py

Attach contract: root node `rosetas-onca` (identity) -> one group per tiger node,
`rosetas-<node>` (`rosetas-body`, `rosetas-leg-front-left`, ...), translated to that node's
pivot in the tiger's rest pose -> one node per patch (`roseta-dorso-1`, `pinta-pata-...`),
translated to the patch centre. Game code: for each group `rosetas-<node>`, move its
children into `tiger.getObjectByName('<node>')` keeping their local transforms (leg spots
then swing with the legs). Adding the whole root to the tiger root also lines up, in rest
pose only. "esq"/"dir" are the animal's own left (+X) and right (-X).

Budget: ART.md lets the onça reach 1,200 tris for its rosettes; tiger.glb is 951, so this
set must stay <= 249.

Shape and colour decisions and sources:
- "Na cabeça, na nuca e na cauda as pintas são sólidas (cheias), enquanto nos flancos elas
  formam rosetas com uma ou mais pintas em seu interior": ICMBio/CENAP, Guia prático de
  convivência com predadores,
  https://www.imasul.ms.gov.br/wp-content/uploads/2020/06/GUIA-PR%C3%81TICO-DE-CONVIVENCIA-PREDADORES-CENAP.pdf
- "rosetas pretas ocas nos flancos, interior marrom e com manchas pretas; outras manchas ...
  pernas, barriga e cauda são totalmente pretas": Guia de identificação de felinos
  (CENAP/ICMBio partners), https://panthera.org/sites/default/files/cwc/FieldGuides_GuiadeIdentificacion_Brasil.pdf
- So: 11 rosettes on the flanks, shoulders, back and haunches, each a broken ring of four
  dark bars (open corners, each bar slightly turned) round a brown centre with one or two
  dark dots; solid spots on the head and on the legs. Sizes vary (0.2-0.3) like real coats.
- The Cube Pets tiger keeps raised stripe ridges on its back and upper flanks, so every
  piece is laid onto the surface below it (conform_quad): flat pieces stay 2 triangles,
  pieces crossing a ridge bend over it.
- Colours: top rows of the onça palette cells (5,3) ring, dots and spots, (3,2) the brown
  centre (both reserved for rosettes in assets-report.md); each face also has a TEXCOORD_0
  into its cell, so the melanistic palette darkens them automatically.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

RING = C.SPECIES["oncaRoseta"]
CENTRE = C.SPECIES["oncaRosetaMiolo"]
UV = {RING: C.pet_uv(5, 3), CENTRE: C.pet_uv(3, 2)}
BUDGET = 1200 - 951

# Patch faces: outward normal and in-plane axes (u x v = normal), Blender space (front -Y).
FACES = {
    "esq": ((1, 0, 0), (0, 1, 0), (0, 0, 1)),  # animal's left flank
    "dir": ((-1, 0, 0), (0, -1, 0), (0, 0, 1)),  # right flank
    "dorso": ((0, 0, 1), (1, 0, 0), (0, 1, 0)),  # back / top of the head
    "frente": ((0, -1, 0), (1, 0, 0), (0, 0, 1)),  # face / front of the legs
    "tras": ((0, 1, 0), (-1, 0, 0), (0, 0, 1)),  # haunches
}

# name, tiger node, face, a point on the surface plane (the normal axis is found by ray
# casting), kind, size, rotation (deg), inner dots
PATCHES = [
    # flanks, lower half (flat)
    ("roseta-flanco-esq-1", "body", "esq", (None, -0.15, 0.66), "rosette", 0.29, 7, 2),
    ("roseta-flanco-esq-2", "body", "esq", (None, 0.19, 0.64), "rosette", 0.25, -9, 1),
    ("roseta-flanco-dir-1", "body", "dir", (None, -0.13, 0.67), "rosette", 0.28, -6, 1),
    ("roseta-flanco-dir-2", "body", "dir", (None, 0.2, 0.65), "rosette", 0.25, 10, 2),
    # flanks, upper half over the ridges, towards the shoulders
    ("roseta-ombro-esq", "body", "esq", (None, -0.26, 1.03), "rosette", 0.23, -5, 1),
    ("roseta-ombro-dir", "body", "dir", (None, -0.24, 1.05), "rosette", 0.22, 8, 1),
    # back
    ("roseta-dorso-1", "body", "dorso", (-0.17, 0.04, None), "rosette", 0.27, 12, 2),
    ("roseta-dorso-2", "body", "dorso", (0.18, -0.07, None), "rosette", 0.25, -8, 1),
    ("roseta-dorso-3", "body", "dorso", (0.04, 0.33, None), "rosette", 0.23, 4, 2),
    # haunches, either side of the tail
    ("roseta-anca-esq", "body", "tras", (0.22, None, 0.74), "rosette", 0.2, -6, 1),
    ("roseta-anca-dir", "body", "tras", (-0.22, None, 0.74), "rosette", 0.2, 7, 1),
    # solid spots: head (between the ears, forehead) ...
    ("pinta-cabeca-1", "body", "dorso", (-0.08, -0.42, None), "spot", 0.07, 15, 0),
    ("pinta-cabeca-2", "body", "dorso", (0.09, -0.4, None), "spot", 0.06, -10, 0),
    ("pinta-testa", "body", "frente", (0.0, None, 1.13), "spot", 0.065, 20, 0),
    # ... and legs (outer side; front of the forelegs)
    ("pinta-pata-dianteira-esq", "leg-front-left", "esq", (None, -0.25, 0.11), "spot", 0.08, 10, 0),
    ("pinta-pata-dianteira-dir", "leg-front-right", "dir", (None, -0.25, 0.12), "spot", 0.075, -12, 0),
    ("pinta-pata-traseira-esq", "leg-back-left", "esq", (None, 0.25, 0.12), "spot", 0.075, -8, 0),
    ("pinta-pata-traseira-dir", "leg-back-right", "dir", (None, 0.25, 0.11), "spot", 0.08, 14, 0),
    ("pinta-pata-dianteira-esq-frente", "leg-front-left", "frente", (0.26, None, 0.1), "spot", 0.065, 18, 0),
    ("pinta-pata-dianteira-dir-frente", "leg-front-right", "frente", (-0.24, None, 0.12), "spot", 0.065, -15, 0),
]

LIFT = 0.012  # above the coat
DOT_LIFT = 0.018  # dots above the brown centre


def patch(name: str, bvh, centre: Vector, face: str, kind: str, size: float, angle: float, dots: int) -> C.Mesh:
    n, u, v = (Vector(x) for x in FACES[face])
    m = C.Mesh(name)

    def piece(cu, cv, hu, hv, spin, lift, colour):
        C.conform_quad(m, bvh, centre, u, v, n, cu, cv, hu, hv, angle + spin, lift, colour, UV[colour])

    h = size / 2
    if kind == "spot":
        piece(0, 0, h, h * 0.85, 0, LIFT, RING)
        return m
    # A rotated frame for the ring: offsets turn with the patch angle.
    import math

    ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))

    def at(du, dv):
        return du * ca - dv * sa, du * sa + dv * ca

    b = max(0.045, 0.2 * size)  # ring thickness
    g = 0.2 * size  # open corners
    piece(0, 0, h - b, h - b, 0, LIFT, CENTRE)  # brown centre
    for (du, dv, hu, hv, spin) in (
        (0, h - b / 2, h - g, b / 2, 3),  # top bar
        (g * 0.2, -h + b / 2, h - g * 1.2, b / 2, -4),  # bottom bar
        (-h + b / 2, 0, b / 2, h - g, 4),  # back bar
        (h - b / 2, -g * 0.15, b / 2, h - g * 1.1, -3),  # front bar
    ):
        cu, cv = at(du, dv)
        piece(cu, cv, hu, hv, spin, LIFT, RING)
    d = 0.033 if dots == 1 else 0.026
    spots = [(0.012, -0.012)] if dots == 1 else [(-0.04 * size / 0.25, 0.03 * size / 0.25), (0.035 * size / 0.25, -0.035 * size / 0.25)]
    for du, dv in spots:
        cu, cv = at(du, dv)
        piece(cu, cv, d, d, 25, DOT_LIFT, RING)
    return m


def build():
    nodes = sorted({node for _, node, *_ in PATCHES})
    surfaces = {node: C.pet_surface("tiger", nodes=(node,)) for node in nodes}
    pivots = surfaces["body"][1]
    root = C.empty("rosetas-onca")
    groups = {node: C.empty(f"rosetas-{node}", pivots[node], parent=root) for node in nodes}
    for name, node, face, point, kind, size, angle, dots in PATCHES:
        bvh = surfaces[node][0]
        n = Vector(FACES[face][0])
        axis = [i for i in range(3) if point[i] is None][0]
        origin = Vector([3.0 * n[i] if i == axis else point[i] for i in range(3)])
        centre, _normal = C.surface_hit(bvh, origin, -n)
        mesh = patch(name, bvh, centre, face, kind, size, angle, dots)
        ob = C.build_object(mesh, name, parent=groups[node], pivot=(0, 0, 0))
        ob.location = centre - C.parent_world_pivot(groups[node])
    return root


if __name__ == "__main__":
    C.run(build, name="rosetas-onca", budget=BUDGET,
          target="attachment, 11 rosettes 0.2-0.3 + 9 solid spots (raw units)",
          preview=lambda g, p: C.preview_attachment(g, p, "tiger", {"groups": "rosetas-"},
                                                    views=[(-48, 30), (135, 34)]))
