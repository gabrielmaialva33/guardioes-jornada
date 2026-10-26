"""
Contact sheet for the P26 park props (ART.md section 9, step 1: the lineup next to the avatar
and a scale reference, in the standard light). The WebGL lineup (`?golden&scene=lineup`) loads
a fixed file list from game code, so this is the Blender route: it reuses lineup.py's light,
GLB unpacking and Lambert conversion, and renders the packed files (the ones that ship, with
their baked COLOR_0) next to the real avatar (preset 0 with its hair), the custom ipê-amarelo
and the trail sign (custom-placa-trilha-da-reserva), all at one scale.

Run (after pack_props.py):

    /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/props_sheet.py -- <packed dir> <out dir>

Writes <out dir>/props-lineup.png (everything in one row), props-detail.png (the small props
row, same scale and light, closer camera) and props-tris.json; build_props.py stacks the two
into props-sheet.png. Preview-only
context, never exported: a trunk stub behind the trunk mark and the camera trap, a cable for
the pulley, and a flat water sheet and pool in front of the Cachoeira Grande wall.
"""

import json
import math
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import bpy  # noqa: E402
import _common as C  # noqa: E402
import lineup as LU  # noqa: E402
from mathutils import Vector  # noqa: E402

MODELS = LU.MODELS_DIR

# name, x, y, yaw (deg), label size
BIG = [
    ("casa-iara", 17.0, 2.0, -20, 0.7),
    ("torre-observacao", 27.5, 2.0, -20, 0.7),
    ("observatorio-aves", 37.5, 2.0, -20, 0.7),
    ("cachoeira-grande-paredao", 88.0, 6.0, 0, 1.0),
]
WALKWAY_X0 = 45.5  # the assembled walkway run starts here and runs along +X
SMALL = [  # (name, x, yaw, label)
    ("marco-trilha", 0.0, -20),
    ("marco-trilha-tronco", 1.8, 0),
    ("semente-paubrasil", 3.0, -30),
    ("semente-jequitiba", 4.0, 0),
    ("propagulo-mangue", 5.2, -10),
    ("propagulo-mangue-plantado", 6.5, 0),
    ("armadilha-fotografica", 8.0, 0),
    ("polia-tirolesa", 9.8, -30),
    ("binoculos", 11.2, -30),
    ("tartaruga-verde", 13.4, -30),
    ("tartaruga-verde-linha", 16.0, -30),
    ("ourico-do-mar", 18.2, 0),
    ("estrela-do-mar", 19.5, 0),
    ("anemona", 20.8, 0),
]
SMALL_Y = -9.0


def tris_of(roots) -> int:
    n = 0
    for r in roots:
        for o in [r, *r.children_recursive]:
            if o.type == "MESH":
                n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def place(roots, x, y, yaw):
    for r in roots:
        r.location = Vector((x, y, 0.0))
        r.rotation_mode = "XYZ"
        r.rotation_euler = (0.0, 0.0, math.radians(yaw))
    bpy.context.view_layer.update()


def load(path: Path, tmp: Path):
    roots = LU.import_single_glb(path, tmp)
    for r in roots:
        LU.convert_to_flat_lambert(r)
    return roots


def context_mesh(name, build):
    m = C.Mesh(name)
    build(m)
    return C.build_object(m, name, material=C.diffuse_material(f"{name}-mat"))


def avatar(tmp: Path, x: float, y: float, yaw: float = -15.0):
    spec = json.loads((LU.SKINS_DIR / "avatar-regions.json").read_text(encoding="utf-8"))
    preset = spec["presets"][0]
    png = LU.composite_preset_png(spec, preset, tmp / "av.png")
    av = LU.import_single_glb(MODELS / "avatar.glb", tmp)[0]
    LU.convert_to_flat_lambert(av, png)
    LU.place_and_scale_root(av, (x, y), target_height=3.0, yaw_deg=yaw)
    LU.attach_avatar_hair(av, preset, spec, tmp)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    packed, out = Path(argv[0]), Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    LU.configure_scene_and_art_light()
    # lineup.py's camera looks from +Y at models turned 165 degrees; this sheet keeps the models'
    # own front (-Y) towards a camera at -Y, so the same sun is mirrored to keep it on the
    # camera's side, as in lineup.png.
    sun = bpy.data.objects["ArtSun"]
    sun.rotation_euler = Vector((-0.35, 0.93, -1.0)).normalized().to_track_quat("-Z", "Y").to_euler()
    ground = bpy.data.objects.get("LineupStageGround")
    if ground:
        ground.scale = (2.2, 1.0, 1.0)
        ground.location.x = 45.0
    counts = {}
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        # References: avatar, trail sign, ipê-amarelo (in the back row and again in the small row).
        avatar(tmp, 1.0, 2.0)
        avatar(tmp, -3.2, SMALL_Y)
        for x, y in ((3.2, 2.0), (-1.4, SMALL_Y)):
            place(load(MODELS / "custom-placa-trilha-da-reserva.glb", tmp), x, y, 0)
        place(load(MODELS / "custom-ipe-amarelo.glb", tmp), 9.0, 4.0, 15)
        C.label("avatar 3 u", (1.0, 0.3, 0.05), size=0.45)
        C.label("placa 2.2 u", (3.4, 0.3, 0.05), size=0.45)
        C.label("ipê-amarelo 10.5 u", (9.0, 0.3, 0.05), size=0.6)
        for name, x, y, yaw, size in BIG:
            roots = load(packed / f"custom-{name}.glb", tmp)
            place(roots, x, y, yaw)
            counts[name] = tris_of(roots)
            C.label(f"{name} · {counts[name]} tris", (x, y - 4.2 if 'cachoeira' not in name else -5.8, 0.05), size=size)
        # Placeholder water for the wall (preview only).
        wall = next(o for o in bpy.data.objects if o.name.startswith("queda-topo"))
        top = wall.matrix_world.translation
        context_mesh("agua", lambda m: (
            m.add([(top.x - 3.4, top.y, 0.02), (top.x + 3.4, top.y, 0.02), (top.x + 3.4, top.y, top.z),
                   (top.x - 3.4, top.y, top.z)], C.ramp("water", 2)),
            m.add([(top.x - 8, top.y - 9, 0.03), (top.x + 8, top.y - 9, 0.03), (top.x + 8, top.y + 0.4, 0.03),
                   (top.x - 8, top.y + 0.4, 0.03)], C.ramp("water", 1))))
        # The walkway, assembled as it tiles: stair, tiles, lookout, tiles, both rails.
        x = WALKWAY_X0
        seq = ["passarela-deck", "passarela-deck-livre", "passarela-deck", "passarela-mirante",
               "passarela-deck-livre", "passarela-deck", "passarela-deck-livre"]
        cursor = x + 5.6  # the stair's top edge (the stair runs 5.6 u)
        # stair: descends towards glTF +z = Blender -Y; turned so it descends towards -X
        roots = load(packed / "custom-passarela-escada.glb", tmp)
        place(roots, cursor, 0.0, -90)
        counts["passarela-escada"] = tris_of(roots)
        for name in seq:
            length = 4.0 if name == "passarela-mirante" else 2.0
            cx = cursor + length / 2
            roots = load(packed / f"custom-{name}.glb", tmp)
            place(roots, cx, 0.0, -90)
            counts[name] = tris_of(roots)
            if name != "passarela-mirante":
                for yaw in (-90, 90):
                    r2 = load(packed / "custom-passarela-guarda.glb", tmp)
                    place(r2, cx, 0.0, yaw)
                    counts["passarela-guarda"] = tris_of(r2)
            cursor += length
        mid = (WALKWAY_X0 + cursor) / 2
        C.label("passarela: escada · deck · deck-livre · guarda · mirante", (mid, -4.2, 0.85), size=0.7)
        C.label(" · ".join(f"{n.replace('passarela-', '')} {counts[n]}" for n in
                           ("passarela-escada", "passarela-deck", "passarela-deck-livre", "passarela-guarda",
                            "passarela-mirante")) + " tris", (mid, -5.3, 0.05), size=0.55)
        # Small props row.
        for name, sx, yaw in SMALL:
            roots = load(packed / f"custom-{name}.glb", tmp)
            y = SMALL_Y
            if name in ("marco-trilha-tronco", "armadilha-fotografica"):
                # on a trunk stub of radius 0.6 u (the mark) / 0.45 u (the trap), preview only
                rad = 0.6 if "marco" in name else 0.45
                context_mesh(f"tronco-{name}", lambda m, sx=sx, rad=rad: m.prism(
                    (sx, y + rad, 0), (sx, y + rad, 2.6), rad, rad * 0.92, 8, C.ramp("wood", 0), cap1=True))
                place(roots, sx, y, 0)
                if name == "armadilha-fotografica":
                    for r in roots:
                        r.location.z = 0.9
            elif name == "polia-tirolesa":
                place(roots, sx, y, yaw)
                cable_z = 1.11 + 1.4
                for r in roots:
                    r.location.z = 1.4
                d = Vector((-math.sin(math.radians(yaw)), math.cos(math.radians(yaw)), 0.0))
                c = Vector((sx, y, cable_z))
                context_mesh("cabo", lambda m, c=c, d=d: m.prism(c - d * 1.0, c + d * 1.0, 0.03, 0.03, 4, C.ramp("rock", 0)))
            else:
                place(roots, sx, y, yaw)
            counts[name] = tris_of(roots)
            short = name.replace("propagulo-mangue", "propágulo").replace("armadilha-fotografica", "armadilha foto.")
            short = short.replace("tartaruga-verde", "tartaruga").replace("semente-", "").replace("marco-trilha", "marco")
            lab = C.label(f"{short} {counts[name]}", (sx, SMALL_Y - 2.4, 0.01), size=0.2)
            lab.rotation_euler.x = math.radians(35)  # leaning back, readable from the detail camera
        # Renders: the whole lineup, then the small row closer (same light and scale).
        LU.render_camera_view(cam_pos=(50.0, -150.0, 16.0), look_at=(50.0, 0.0, 10.5), out_file=out / "props-lineup.png",
                              res=(4800, 1700), fov_deg=46.0)
        LU.render_camera_view(cam_pos=(8.6, -54.0, 9.5), look_at=(8.6, SMALL_Y, 1.3), out_file=out / "props-detail.png",
                              res=(4800, 1500), fov_deg=34.0)
    (out / "props-tris.json").write_text(json.dumps(counts, indent=2), encoding="utf-8")
    print("[sheet]", json.dumps(counts))


if __name__ == "__main__":
    main()
