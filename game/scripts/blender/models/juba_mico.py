"""
Juba do mico-leão-dourado (Leontopithecus rosalia): a mane attachment for the Cube Pets
monkey, which the game recolours as the tamarin (palette-mico-leao-dourado.png).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/juba_mico.py

Attach contract (assets-report.md section 2): the monkey's head is part of `body` (pivot
(0, 0.1812, 0) in glTF). The GLB root node `juba-mico` has an identity transform and its
geometry is in body-local space: `monkey.getObjectByName('body').add(mane)`.

Budget: ART.md caps an animal at 1,000 tris and monkey.glb is 918, so the mane must stay
<= 82 tris; it is 64.

Shape and colour decisions and sources:
- "The hallmark ... is the prominently developed mane about the face ... the face is
  essentially bare": Rosenberger & Coimbra-Filho 1984, https://doi.org/10.1159/000156159
- "mane covers the ears and frames the dark, almost bare face": Smithsonian National Zoo,
  https://nationalzoo.si.edu/animals/golden-lion-tamarin
- So: an octagonal ruff in the Cube Pets lion's language, proud of the face panel, wide
  enough to hide the round ears, swept back over the head; the dark face stays open.
- Colours: the mane cell (3,2) of palette-mico-leao-dourado.png, reserved for it in
  assets-report.md: top row #ff8818 outside, row 8 #d6650f on the inner rim (depth). Each
  face also has a TEXCOORD_0 into that cell, so the mane follows the skin palette (the
  same cell is the bugio's beard colour).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

MANE = C.SPECIES["micoJuba"]
MANE_SHADE = C.SPECIES["micoJubaSombra"]
UV = {MANE: C.pet_uv(3, 2, 0), MANE_SHADE: C.pet_uv(3, 2, 8)}


def octagon(xz, y):
    return [Vector((x, y, z)) for x, z in xz]


def mane(face_y: float) -> C.Mesh:
    m = C.Mesh("juba-mico")
    front_y = face_y - 0.085  # proud of the face panel
    back_y = 0.2
    # Outline seen from the front (x, z), clockwise from the top left. The bottom covers the
    # throat; it stays in front of and above the front legs (y > -0.44, z < 0.31).
    outer = [(-0.56, 1.66), (0.56, 1.66), (1.02, 1.27), (1.02, 0.66), (0.62, 0.33), (-0.62, 0.33), (-1.02, 0.66),
             (-1.02, 1.27)]
    # The face window, fitted to the dark face panel (x +-0.45, z 0.46-1.15).
    window = [(-0.38, 1.22), (0.38, 1.22), (0.47, 1.13), (0.47, 0.58), (0.38, 0.49), (-0.38, 0.49), (-0.47, 0.58),
              (-0.47, 1.13)]
    # Back outline, swept in, and the hole that fits round the head (x +-0.62, z 0.2-1.44).
    # Swept in only a little: the wall must stay outside the round ears (x 0.96 at y -0.05).
    back_outer = [(x * 0.95, 0.95 + (z - 0.95) * 0.9) for x, z in outer]
    back_hole = [(-0.5, 1.45), (0.5, 1.45), (0.63, 1.3), (0.63, 0.55), (0.5, 0.42), (-0.5, 0.42), (-0.63, 0.55),
                 (-0.63, 1.3)]
    # The front ring bevels back from the face window: hair fanning out, not a flat frame.
    fo, fw = octagon(outer, front_y + 0.2), octagon(window, front_y)
    bo, bh = octagon(back_outer, back_y), octagon(back_hole, back_y)
    wi = octagon(window, face_y + 0.025)  # window rim runs just behind the face panel
    axis_z = 0.95  # the head's centre line runs along Y at this height

    def radial(face, sign=1.0):
        """A point that the face's normal must point away from: on the head axis for the
        outer wall (normals out), beyond the face for the window rim (normals in)."""
        c = sum(face, Vector()) / len(face)
        on_axis = Vector((0, c.y, axis_z))
        return on_axis if sign > 0 else on_axis + (c - on_axis) * 2.0

    n = 8
    for k in range(n):
        k1 = (k + 1) % n
        front = [fo[k], fo[k1], fw[k1], fw[k]]
        m.add_out(front, MANE, Vector((0, front_y + 1.0, axis_z)), UV[MANE])  # faces -Y
        wall = [fo[k], bo[k], bo[k1], fo[k1]]
        m.add_out(wall, MANE, radial(wall), UV[MANE])
        back = [bo[k], bh[k], bh[k1], bo[k1]]
        m.add_out(back, MANE, Vector((0, back_y - 1.0, axis_z)), UV[MANE])  # faces +Y
        rim = [fw[k], fw[k1], wi[k1], wi[k]]
        m.add_out(rim, MANE_SHADE, radial(rim, -1.0), UV[MANE_SHADE])
    return m


def build():
    bvh, pivots = C.pet_surface("monkey")
    hit, _n = C.surface_hit(bvh, (0.0, -3.0, 0.8), (0, 1, 0))
    body = pivots["body"]
    ob = C.build_object(mane(hit.y), "juba-mico", pivot=body)
    ob.location = (0, 0, 0)  # body-local geometry, identity node
    return ob


if __name__ == "__main__":
    C.run(build, name="juba-mico", budget=82, target="attachment, mane on the monkey head (raw units)",
          preview=lambda g, p: C.preview_attachment(g, p, "monkey", {"node": "body"}, closeup_az=-32, closeup_el=10))
