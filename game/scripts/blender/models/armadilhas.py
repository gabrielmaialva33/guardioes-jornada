"""
Illegal hunting traps for the "never touch, report it" missions, props (x1.5, trap ~1.0 u,
ART.md section 3), 60-120 tris each, two files: arapuca.glb and laco.glb. Empty and
not gory: no animal is ever in or near them.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/armadilhas.py

Shape decisions and sources:
- Arapuca: "De forma piramidal ... As varetas ... decrescem em tamanho ... disposta
  inclinadamente ... graças a uma estaca. A esta liga-se uma linha que, tocada pelo pássaro,
  faz com que caia": INEPAC-RJ, http://www.inepac.rj.gov.br/application/assets/img/site/Aves_23out05.pdf
  ; "four-sided pyramidal structures ... suspended and armed with a trigger": Alves et al.
  2009, https://pmc.ncbi.nlm.nih.gov/articles/PMC2678999/ . So: a log-cabin pyramid of
  pairs of sticks, each layer shorter, closed on top, tilted up on one side by a prop stick
  (armed, which is what makes it read as a trap, not a box).
- Laço: a noose "bound to a tensioned branch of a tree ... the branch snaps upward" (Alves
  et al. 2009); "vara de bambu que, envergada em forma de arco" (INEPAC-RJ). So: a sapling
  pole bent into an arc, a cord down to an open noose held by a small trigger peg.
- Hunting wild fauna is a crime: Lei 9.605/1998, art. 29,
  https://www.planalto.gov.br/ccivil_03/leis/l9605.htm
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

STICK = C.ramp("wood", 2)
STICK_ALT = C.ramp("wood", 3)
PROP = C.ramp("wood", 1)
CORD = C.ramp("soil", 3)


def arapuca() -> C.Mesh:
    m = C.Mesh("arapuca")
    t = 0.062  # stick thickness
    step = t - 0.006  # each layer rests on the one below
    layers = 5
    for i in range(layers):
        length = 1.0 - 0.13 * i
        z = t / 2 + i * step
        off = length / 2 - 0.05
        col = STICK if i % 2 == 0 else STICK_ALT
        for s in (-1, 1):
            if i % 2 == 0:
                m.box((0, s * off, z), (length, t, t), col, skip=("bottom",))
            else:
                m.box((s * off, 0, z), (t, length, t), col, skip=("bottom",))
    # Lid: one stick across the narrow top opening.
    top_len = 1.0 - 0.13 * (layers - 1)
    m.box((0, 0, t / 2 + layers * step), (top_len, t * 1.4, t), STICK, skip=("bottom",))
    # Armed: hinge on the -X bottom edge, the +X side lifted by the prop stick.
    tilt = math.radians(17)
    hinge = Vector((-0.5, 0, 0))
    rot = Matrix.Translation(hinge) @ Matrix.Rotation(tilt, 4, "Y").inverted() @ Matrix.Translation(-hinge)
    m.transformed(rot)
    # Prop stick (the "estaca"/trigger) from the ground to the raised edge.
    lift = 1.0 * math.sin(tilt)
    m.tube([(0.45, 0.0, 0.0), (0.44, 0.0, lift + 0.03)], [0.03, 0.03], 3, PROP, cap_end=False)
    return m


def laco() -> C.Mesh:
    m = C.Mesh("laco")
    # Sapling pole planted at -X, bent over in an arc (the spring).
    pole = [(-0.6, 0, 0), (-0.58, 0, 0.75), (-0.42, 0, 1.25), (-0.1, 0, 1.48), (0.25, 0, 1.42), (0.45, 0, 1.22)]
    m.tube(pole, [0.065, 0.058, 0.05, 0.043, 0.036, 0.03], 4, PROP, cap_end=True, twist=math.pi / 4)
    # Cord from the tip down to the noose.
    noose_c = Vector((0.47, 0, 0.4))
    r = 0.3
    m.tube([(0.45, 0, 1.2), noose_c + Vector((0, 0, r))], [0.026, 0.026], 3, CORD, cap_end=False)
    # Open noose standing on the trail, slightly turned to face the path.
    ring = []
    for k in range(9):
        a = 2 * math.pi * k / 8 + math.pi / 2
        ring.append(noose_c + Matrix.Rotation(math.radians(-40), 3, "Z") @ Vector((0, math.cos(a) * r, math.sin(a) * r)))
    m.tube(ring, [0.03] * 9, 3, CORD, cap_end=False)
    # Trigger peg that holds the noose down.
    m.box((0.47, 0.0, 0.07), (0.07, 0.07, 0.18), PROP, skip=("bottom",))
    return m


if __name__ == "__main__":
    small = {"elevation_deg": 20.0, "closeup": True, "res": (900, 900)}
    C.run(lambda: C.build_object(arapuca(), "arapuca"), name="arapuca", budget=120,
          target="~1.0 u wide (props x1.5)", preview_kw=small)
    C.run(lambda: C.build_object(laco(), "laco"), name="laco", budget=120,
          target="~1.5 u tall pole, noose ~0.5 u (props x1.5)", preview_kw=small)
