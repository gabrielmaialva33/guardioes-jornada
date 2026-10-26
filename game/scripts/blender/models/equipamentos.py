"""
Small field gear (inventory p22 section 7, priority 5; game/PARK.md sections 3, 4.1 and 6):
the camera trap of V4, the zipline (tirolesa) pulley and Seu Zé's binoculars. <= 80 tris each,
props scale (x1.5) rounded up for readability.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/equipamentos.py [-- --no-render]

Files (in $CUSTOM_RAW_DIR; bake.py prefixes them with custom-):
- armadilha-fotografica.glb: a camouflaged box 0.42 x 0.58 u with a lens, a motion (PIR)
  sensor window, an infrared LED panel and a strap whose two tails wrap back around a trunk
  (radius about 0.4 u). Origin on the trunk surface at the box's bottom edge (the lens faces
  glTF +z): place it at a "marked trunk" point, yawed to face the trail. Camera traps are the
  standard tool of muriqui monitoring (PARK.md V4).
- polia-tirolesa.glb: the zipline trolley: two cheek plates around a grooved wheel, a hanger
  bar and a T handle with yellow grips (the player grabs them: an interaction point, so
  ACCENT.ipeAmarelo, never gold). The cable runs along glTF z. Origin at the bottom of the
  handle; empties: cabo (0, 1.11, 0), where the cable touches the wheel's groove, and mao
  (0, 0.06, 0), the hands on the handle. So the model goes at (point on the cable) - (0, 1.11, 0).
- binoculos.glb: field binoculars 0.42 u long, objectives towards glTF +z, rubber-armoured body
  (rock[0]), blue-tinted lenses (water[1]). Origin at the bottom centre.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
import _props as P  # noqa: E402
from _props import A, IPE_AMARELO, L, R, S  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402


def build_trap():
    m = C.Mesh("armadilha-fotografica")
    w, d, h = 0.42, 0.28, 0.58
    by = -0.04 - d / 2  # body centre (Blender front = -Y; the trunk is behind, +Y)
    m.box((0, by, h / 2), (w, d, h), L[1], colours={"top": L[2], "bottom": L[0], "py": L[0], "ny": L[1]})
    front = by - d / 2
    # Camouflage patches on the sides.
    for sx in (-1, 1):
        x = sx * (w / 2 + 0.004)
        pts = [(x, by - 0.08, 0.12), (x, by + 0.06, 0.08), (x, by + 0.1, 0.3), (x, by - 0.04, 0.36)]
        m.add(pts if sx > 0 else pts[::-1], S[1])
    # Lens: a short six-sided barrel with a blue glass.
    lens_c = Vector((0.0, front, 0.38))
    m.prism(lens_c + Vector((0, 0.01, 0)), lens_c + Vector((0, -0.06, 0)), 0.085, 0.08, 6, R[0], cap1=True,
            colour_cap=A[0], twist=math.pi / 6)
    # Infrared LED panel above the lens and the motion sensor window below it.
    yl = front - 0.004
    m.add([(-0.15, yl, 0.47), (0.15, yl, 0.47), (0.15, yl, 0.54), (-0.15, yl, 0.54)], R[0])
    m.box((0.0, front - 0.015, 0.17), (0.16, 0.03, 0.1), R[3], skip=("py",), colours={"top": R[3], "bottom": R[2]})
    # Strap: from the body's sides back around the trunk (two tails).
    zs = 0.3
    for sx in (-1, 1):
        a = Vector((sx * (w / 2 - 0.02), by + 0.06, zs))
        b = Vector((sx * 0.36, 0.12, zs))
        c = Vector((sx * 0.28, 0.42, zs))
        P.beam(m, a, b, 0.035, 0.11, S[0], ends=False, up=Vector((0, 0, 1)))
        P.beam(m, b, c, 0.035, 0.11, S[0], ends=False, up=Vector((0, 0, 1)))
    return C.build_object(m, "armadilha-fotografica")


WHEEL_Z = 0.95
WHEEL_R = 0.16


def build_pulley():
    m = C.Mesh("polia-tirolesa")
    # Grooved wheel, axis along X (the cable runs along Y).
    m.prism((-0.05, 0, WHEEL_Z), (0.05, 0, WHEEL_Z), WHEEL_R, WHEEL_R, 6, R[0], cap0=True, cap1=True,
            colour_cap=R[1], twist=math.pi / 6)
    # Cheek plates either side of the wheel.
    for sx in (-1, 1):
        m.box((sx * 0.085, 0, 0.9), (0.04, 0.44, 0.36), R[1], colours={"top": R[2], "bottom": R[0]})
    # Hanger bar down to the handle.
    P.beam(m, (0, 0, 0.73), (0, 0, 0.11), 0.07, 0.07, R[0], ends=False, up=Vector((0, 1, 0)))
    # T handle: middle bar and two yellow grips.
    m.box((0, 0, 0.06), (0.4, 0.1, 0.1), R[1], skip=("px", "nx"), colours={"top": R[2]})
    for sx in (-1, 1):
        m.box((sx * 0.33, 0, 0.06), (0.26, 0.13, 0.13), IPE_AMARELO, skip=("nx" if sx > 0 else "px",))
    ob = C.build_object(m, "polia-tirolesa")
    C.empty("cabo", (0, 0, WHEEL_Z + WHEEL_R), parent=ob)
    C.empty("mao", (0, 0, 0.06), parent=ob)
    return ob


def build_binoculars():
    m = C.Mesh("binoculos")
    r_body, r_eye = 0.075, 0.05
    z = r_body + 0.005
    for sx in (-1, 1):
        x = sx * 0.095
        # body: objective cap (blue glass) at the front (-Y)
        m.prism((x, 0.08, z), (x, -0.21, z), r_body, r_body * 1.04, 6, R[0], cap1=True, colour_cap=A[1],
                twist=math.pi / 6)
        # eyepiece, narrower, at the back (+Y)
        m.prism((x, 0.06, z + 0.01), (x, 0.2, z + 0.01), r_eye, r_eye, 6, R[1], cap1=True, colour_cap=R[0],
                twist=math.pi / 6)
    # Hinge bridge between the barrels.
    m.box((0, -0.01, z + 0.02), (0.12, 0.16, 0.07), R[1], colours={"top": R[2]})
    lo = min(v.z for v in m.verts)
    m.transformed(Matrix.Translation((0, 0, -lo)))
    return C.build_object(m, "binoculos")


if __name__ == "__main__":
    small = {"elevation_deg": 18.0, "closeup": True, "res": (900, 900), "azimuth_deg": -30.0}
    P.run_all([
        ("armadilha-fotografica", build_trap, 80, "0.58 u camera trap with strap (props x1.5)", small),
        ("polia-tirolesa", build_pulley, 80, "1.1 u zipline trolley, cable at 1.11 u", small),
        ("binoculos", build_binoculars, 80, "0.42 u binoculars (props x1.5)", small),
    ])
