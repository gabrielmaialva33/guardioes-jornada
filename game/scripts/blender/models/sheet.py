"""
Comparison sheets for the custom trees (ART.md section 9, lineup next to the avatar and a
scale bar, in the standard light). Run after the tree generators:

    /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/sheet.py

Writes to $CUSTOM_RAW_DIR:
- sheet-arvores.png: every custom tree and the bromeliads side by side, between two Kenney
  Nature Kit trees for style (tree_oak and tree_palmTall, recoloured with OpenCode's
  color-map.json mapping, leafsGreen -> leaf[2], woodBark -> wood[1], scaled x10 so they sit
  in the canopy tier), with the 3.0 u avatar block and the 1 u rod.
- sheet-floresta.png: the same trees as a grove seen from the game camera (70 degree
  vertical FOV, eye ~4.4 u high, src/engine/constants.ts) 10-20 m (21-43 u) away, to check
  that the silhouettes read together at play distance.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
import _common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

KENNEY_SCALE = 10.0
KENNEY_COLOURS = {"leafsGreen": C.ramp("leaf", 2), "woodBark": C.ramp("wood", 1), "woodBarkDark": C.ramp("soil", 2),
                  "leafsDark": C.ramp("leaf", 1)}
LINEUP = [
    ("kenney:tree_oak", "Kenney tree_oak (ref.)"),
    ("araucaria", "araucária"),
    ("jequitiba-rosa", "jequitibá-rosa"),
    ("ipe-amarelo", "ipê-amarelo"),
    ("ipe-rosa", "ipê-rosa"),
    ("embauba", "embaúba"),
    ("palmeira-jucara", "palmeira-juçara"),
    ("xaxim", "xaxim"),
    ("bromelia", "bromélia"),
    ("bromelia-centro-vermelho", "bromélia vermelha"),
    ("kenney:tree_palmTall", "Kenney tree_palmTall (ref.)"),
]


def load(key: str) -> list:
    if key.startswith("kenney:"):
        objs = C.import_glb(C.NATURE_KIT / f"{key.split(':')[1]}.glb")
        C.recolour_kenney(objs, KENNEY_COLOURS)
        for o in objs:
            if o.parent is None:
                o.scale = (KENNEY_SCALE,) * 3
    else:
        objs = C.import_glb(C.OUT / f"{key}.glb")
        C.lambertise(objs)
    bpy.context.view_layer.update()
    return objs


def roots(objs):
    return [o for o in objs if o.parent is None]


def move(objs, offset: Vector):
    for o in roots(objs):
        o.location += offset
    bpy.context.view_layer.update()


def lineup(png: Path):
    C.reset_scene()
    C.setup_cycles(128)
    C.art_light(sun_azimuth_deg=-30)
    everything = []
    x = 0.0
    props = C.measuring_props(-2.2, 0.0, rod_height=18)
    for key, title in LINEUP:
        objs = load(key)
        lo, hi = C.world_bbox(objs)
        width = hi.x - lo.x
        size = 0.85 if width > 3 else 0.5
        text = f"{title}, {hi.z:.1f} u"
        slot = max(width, 0.56 * size * len(text))  # leave room for the label
        move(objs, Vector((x + (slot - width) / 2 - lo.x, 0, 0)))
        cx = x + slot / 2
        front = -max(3.0, (hi.y - lo.y) / 2 + 1.5)
        C.label(text, (cx, front, 0.1), size=size, rot_z_deg=0)
        everything += objs
        x += slot + (0.8 if width < 3 else 1.6)
    C.ground(size=600)
    C.frame_camera(everything + props, azimuth_deg=0.0, elevation_deg=4.0, lens=50.0, res=(3600, 1200), margin=0.04)
    C.render(png, 128)


GROVE = [  # key, x, y, rotation (deg)
    ("jequitiba-rosa", 6, 48, 30), ("araucaria", -16, 40, 10), ("araucaria", 22, 44, 70), ("ipe-amarelo", -4, 30, 40),
    ("embauba", 12, 32, 100), ("palmeira-jucara", -11, 26, 0), ("palmeira-jucara", 18, 27, 200),
    ("ipe-rosa", 27, 36, 150), ("xaxim", 3, 23, 60), ("xaxim", -20, 30, 120), ("embauba", -26, 42, 20),
    ("palmeira-jucara", -2, 40, 90), ("bromelia", 0.5, 21.5, 0), ("bromelia-centro-vermelho", 7, 22, 30),
    ("kenney:tree_oak", 33, 47, 0),
]


def grove(png: Path):
    C.reset_scene()
    C.setup_cycles(128)
    C.art_light(sun_azimuth_deg=-30)
    cache = {}
    for key, x, y, rot in GROVE:
        objs = load(key)
        for o in roots(objs):
            o.location = Vector((x, y, 0))
            o.rotation_euler.z += math.radians(rot)
        cache.setdefault(key, []).append(objs)
    avatar = C.flat_box("avatar-3u", (1.5, 14.0, 1.5), (0.9, 0.6, 3.0), C.PREVIEW["avatar"])
    _ = avatar
    C.ground(size=600)
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    cam_data = bpy.data.cameras.new("game-cam")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle_y = math.radians(70)
    cam = bpy.data.objects.new("game-cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = Vector((1.5, 6.5, 4.4))  # 7.5 u behind the avatar block, shoulder height
    target = Vector((5.0, 36.0, 7.5))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    C.render(png, 128)


if __name__ == "__main__":
    lineup(C.OUT / "sheet-arvores.png")
    grove(C.OUT / "sheet-floresta.png")
