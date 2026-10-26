"""
Trail marks (game/PARK.md section 3, "Trail marks": every ~20 u on all trails; inventory p22
section 7, priority 2): the mico-paw mark on a post, and the same mark painted on a trunk.

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/marco_trilha.py [-- --no-render]

Files (in $CUSTOM_RAW_DIR; bake.py prefixes them with custom-):
- marco-trilha.glb: a chunky wooden post (1.95 u, below the 2.2 u signs) carrying a square
  plate 0.6 u across at 1.45 u. <= 60 tris.
- marco-trilha-tronco.glb: the same plate as a decal painted on a trunk, curved for a trunk of
  radius 0.6 u. Origin on the trunk surface at the mark's bottom edge, the mark facing glTF +z;
  yaw it towards the trail and push it 0.02 u out of thinner trunks. <= 60 tris.

The real standard (Rede Brasileira de Trilhas, the national trail network recognised by MMA,
MTur and ICMBio) paints a yellow footprint on a black base for the way forward and the black
footprint on a yellow base for the opposite way; each regional trail may use its own animal's
footprint. So the post's front (glTF +z) is the yellow paw on the dark base and its back is the
dark paw on yellow; the trunk mark shows the forward version. The paw is a golden lion tamarin
hand: a palm pad, four long fingers and a low thumb (_props.paw).

Colours: the yellow is ACCENT.ipeAmarelo (a wayfinding mark, never gold: gold is only for
things to touch); the "black" is leaf[0] #1e4d36, the darkest object colour ART.md section 2
allows (nothing pure black). The post is wood[1] with a wood[2] cap.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
import _props as P  # noqa: E402
from _props import IPE_AMARELO, L, W  # noqa: E402

YELLOW = IPE_AMARELO
DARK = L[0]
POST_H = 1.95
POST_W = 0.3
PLATE = 0.6
PLATE_Z = 1.45
PAW = 1.0  # paw size relative to the plate (the hand spans about 0.8 of it)


def build_post():
    m = C.Mesh("marco-trilha")
    # Post: four sides and a low pyramid cap (Kenney-style chunky top).
    h, w = POST_H - 0.12, POST_W / 2
    m.box((0, 0, h / 2), (POST_W, POST_W, h), W[1], skip=("bottom", "top"))
    apex = C.V(0, 0, POST_H)
    corners = [C.V(-w, -w, h), C.V(w, -w, h), C.V(w, w, h), C.V(-w, w, h)]
    for i in range(4):
        m.add_out([corners[i], corners[(i + 1) % 4], apex], W[2], (0, 0, h - 0.1))
    # Plate through the post: front (Blender -Y) dark, back yellow, edges split the same way.
    d = POST_W + 0.08
    # (no bottom face: the camera is always above it, and it keeps the post at 60 tris)
    m.box((0, 0, PLATE_Z), (PLATE, d, PLATE), DARK, skip=("bottom",),
          colours={"py": YELLOW, "top": W[2], "px": W[2], "nx": W[2]})
    s = PLATE * PAW
    # Front: yellow paw on the dark base (the way forward).
    P.paw(m, C.V(0, -d / 2 - 0.012, PLATE_Z), C.V(1, 0, 0), C.V(0, 0, 1), s, YELLOW)
    # Back: dark paw on the yellow base (the opposite way), mirrored so it reads the same.
    P.paw(m, C.V(0, d / 2 + 0.012, PLATE_Z), C.V(-1, 0, 0), C.V(0, 0, 1), s, DARK)
    return C.build_object(m, "marco-trilha")


TRUNK_R = 0.6
STRIPS = 4


def build_trunk():
    m = C.Mesh("marco-trilha-tronco")
    half = PLATE / 2
    lift = 0.012

    def depth(x: float) -> float:
        """How far the trunk surface falls back (towards +Y) at x across the mark."""
        return TRUNK_R - math.sqrt(max(0.0, TRUNK_R ** 2 - x * x))

    for k in range(STRIPS):
        x0 = -half + PLATE * k / STRIPS
        x1 = -half + PLATE * (k + 1) / STRIPS
        m.add([(x0, depth(x0) - lift, 0.0), (x1, depth(x1) - lift, 0.0), (x1, depth(x1) - lift, PLATE),
               (x0, depth(x0) - lift, PLATE)], DARK)
    P.paw(m, C.V(0, -2 * lift, PLATE / 2), C.V(1, 0, 0), C.V(0, 0, 1), PLATE * PAW, YELLOW,
          depth=depth)
    ob = C.build_object(m, "marco-trilha-tronco")
    return ob


if __name__ == "__main__":
    kw = {"elevation_deg": 10.0, "closeup": True, "res": (900, 900), "azimuth_deg": -20.0}
    P.run_all([
        ("marco-trilha", build_post, 60, "1.95 u post, 0.6 u mark at 1.45 u (props x1.5)", kw),
        ("marco-trilha-tronco", build_trunk, 60, "0.6 u mark painted on a trunk of radius ~0.6 u", kw),
    ])
