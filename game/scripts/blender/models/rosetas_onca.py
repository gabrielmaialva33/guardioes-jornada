"""
Rosetas da onça-pintada (Panthera onca): dark blocky rosette decals for the Cube Pets tiger,
which the game recolours as the jaguar (palette-onca-pintada.png, stripes painted out).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/rosetas_onca.py

Attach contract: root node `rosetas-onca` (identity) -> group `rosetas-body`, whose
translation is the tiger's `body` pivot (0, 0.1812, 0) in glTF -> one node per patch,
`roseta-flanco-esq-1` ..., each translated to its patch centre in body space. Game code:
for each group `rosetas-<node>`, move its children into `tiger.getObjectByName('<node>')`
keeping their local transforms (or add the whole root to the tiger root in rest pose).
"esq"/"dir" are the animal's own left (+X) and right (-X).

Budget: ART.md caps an animal at 1,000 tris and tiger.glb is 951, so the set must stay
<= 49 tris: four flank rosettes of 12 tris = 48 (onça total 999). More patches (solid
spots on the head, nape and legs, tail rings) would need that budget raised; the
per-patch nodes make it easy to add or drop them. Three-blotch rings and extra solid
spots were tried and read as scattered dashes, not rosettes.

Shape and colour decisions and sources:
- "Na cabeça, na nuca e na cauda as pintas são sólidas (cheias), enquanto nos flancos elas
  formam rosetas com uma ou mais pintas em seu interior": ICMBio/CENAP, Guia prático de
  convivência com predadores,
  https://www.imasul.ms.gov.br/wp-content/uploads/2020/06/GUIA-PR%C3%81TICO-DE-CONVIVENCIA-PREDADORES-CENAP.pdf
- "rosetas pretas ocas nos flancos, interior marrom e com manchas pretas": Guia de
  identificação de felinos (CENAP/ICMBio partners),
  https://panthera.org/sites/default/files/cwc/FieldGuides_GuiadeIdentificacion_Brasil.pdf
- So, on the flanks: broken rings of four dark bars with open corners, each slightly
  turned, round a brown centre with one dark dot inside. The tiger's flanks carry
  raised stripe ridges above z 0.85, so every patch is checked flat by ray casts.
- Colours: top rows of the onça palette cells (5,3) ring and dot, (3,2) the brown centre
  (both reserved for rosettes in assets-report.md); each face also has a TEXCOORD_0 into
  its cell, so the melanistic palette darkens them automatically.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

RING = C.SPECIES["oncaRoseta"]
CENTRE = C.SPECIES["oncaRosetaMiolo"]
UV = {RING: C.pet_uv(5, 3), CENTRE: C.pet_uv(3, 2)}

# name, kind, face, along, up, size, rotation (degrees). Faces: "esq" = animal's left flank
# (+X), "dir" = right flank (-X), "topo" = top (the nape strip between the stripe ridges;
# the forehead between the ears is not flat). For flanks `along` is Blender Y
# and `up` is Z; for the head `along` is X and `up` is Y.
PATCHES = [
    ("roseta-flanco-esq-1", "rosette", "esq", -0.16, 0.675, 0.3, 7),
    ("roseta-flanco-esq-2", "rosette", "esq", 0.175, 0.66, 0.27, -9),
    ("roseta-flanco-dir-1", "rosette", "dir", -0.15, 0.67, 0.29, -6),
    ("roseta-flanco-dir-2", "rosette", "dir", 0.18, 0.665, 0.26, 10),
]
FACES = {
    # ray origin from (along, up), ray direction, normal, u axis, v axis (u x v = normal)
    "esq": (lambda a, b: (3.0, a, b), (-1, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)),
    "dir": (lambda a, b: (-3.0, a, b), (1, 0, 0), (-1, 0, 0), (0, -1, 0), (0, 0, 1)),
    "topo": (lambda a, b: (a, b, 3.0), (0, 0, -1), (0, 0, 1), (1, 0, 0), (0, 1, 0)),
}


def patch(name: str, kind: str, n: Vector, u: Vector, v: Vector, size: float, angle: float) -> C.Mesh:
    m = C.Mesh(name)

    def quad(u0, v0, u1, v1, lift, colour, spin=0.0):
        """Axis-aligned in the patch frame, rotated by the patch angle plus `spin`
        about its own centre (each bar of a ring is a slightly different blotch)."""
        cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
        own = Matrix.Rotation(math.radians(spin), 2)
        whole = Matrix.Rotation(math.radians(angle), 2)
        pts = []
        for a, b in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):  # CCW seen from outside
            r = whole @ (Vector((cu, cv)) + own @ Vector((a - cu, b - cv)))
            pts.append(u * r.x + v * r.y + n * lift)
        m.add(pts, colour, UV[colour])

    h = size / 2
    if kind == "spot":  # solid spot (head, nape)
        quad(-h, -h, h, h, 0.01, RING)
        return m
    # Broken ring: four dark bars with open corners (real rosettes are broken rings), each
    # turned a little so the ring is irregular, round a brown centre with a dark dot.
    b = 0.062  # ring thickness
    g = 0.05  # open corners
    quad(-h + b, -h + b, h - b, h - b, 0.008, CENTRE)  # brown centre
    quad(-h + g, h - b, h - g, h, 0.008, RING, 3)  # top bar
    quad(-h + g * 1.4, -h, h - g, -h + b, 0.008, RING, -4)  # bottom bar
    quad(-h, -h + g, -h + b, h - g * 1.3, 0.008, RING, 4)  # back bar
    quad(h - b, -h + g, h, h - g, 0.008, RING, -3)  # front bar
    d = 0.042
    quad(0.018 - d, -0.016 - d, 0.018 + d, -0.016 + d, 0.014, RING, 18)  # the dot inside
    return m


def build():
    bvh, pivots = C.pet_surface("tiger")
    root = C.empty("rosetas-onca")
    group = C.empty("rosetas-body", pivots["body"], parent=root)
    for name, kind, face, a, b, size, angle in PATCHES:
        origin, direction, n, u, v = FACES[face]
        n, u, v = Vector(n), Vector(u), Vector(v)
        centre, _normal = C.surface_hit(bvh, origin(a, b), direction)
        # the patch must sit on a flat part of the body: every corner hits the same plane
        for da in (-size / 2, size / 2):
            for db in (-size / 2, size / 2):
                corner, _ = C.surface_hit(bvh, origin(a + da, b + db), direction)
                assert abs((corner - centre).dot(n)) < 0.012, f"{name} is not on a flat area ({tuple(corner)})"
        mesh = patch(name, kind, n, u, v, size, angle)
        C.build_object(mesh, name, parent=group, pivot=(0, 0, 0)).location = centre - C.parent_world_pivot(group)
    return root


if __name__ == "__main__":
    C.run(build, name="rosetas-onca", budget=49, target="attachment, 4 flank rosettes ~0.28 u (raw units)",
          preview=lambda g, p: C.preview_attachment(g, p, "tiger", {"groups": "rosetas-"}, closeup_az=-64, closeup_el=16))
