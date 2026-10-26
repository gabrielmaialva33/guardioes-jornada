"""
Contact sheet for the P35 coast models (ART.md section 9, step 1: the lineup next to the avatar
in the standard light), the Blender route of props_sheet.py: lineup.py's light, GLB unpacking
and Lambert conversion, the packed files as they ship, next to the real avatar (preset 0 with
its hair) and, for scale, the P23 guará and caranguejo-uçá.

Run (build_costa.py does it, after the pack):

    /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/costa_sheet.py -- <packed dir> <out dir>

Writes <out dir>/costa-lineup.png (everything at one scale), costa-detail.png (the small ones,
same scale and light, closer camera) and costa-sizes.json. The Cube Pets models are scaled to
the heights proposed in the P35 report (the game sizes them in species.ts; the uçá and guará at
their measures.ts heights); the birds are shown perched (their "perch" clip) and gliding (rest
pose, raised), the turtle mid-stroke (its "swim" clip at 0.5 s). Preview-only context: a sand
patch under the restinga plants and a shallow pool under the fish.
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
import _clips as Q  # noqa: E402
import _common as C  # noqa: E402
import bichos_costa as BC  # noqa: E402
import lineup as LU  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402

MODELS = LU.MODELS_DIR
# measures.ts: height (m) x 1.5 / 0.47 u per m. The coast species' proposed heights (report §2).
GAME_HEIGHT = 1.5 / 0.47
SIZES = {
    "guara": 0.5 * GAME_HEIGHT,
    "caranguejo": 0.08 * GAME_HEIGHT,
    "atoba": 0.45 * GAME_HEIGHT,
    "gaivotao": 0.4 * GAME_HEIGHT,
    "caranguejo-de-pedra": 0.14,
    "sargentinho": 0.28,
}
# name, file, x, y (Blender), yaw, size key or None, pose, label
ROW = [
    ("pitangueira", "custom-pitangueira", 4.5, 0.0, -20, None, None),
    ("cacto", "custom-cacto-da-restinga", 7.6, -0.5, 10, None, None),
    ("tartaruga", "custom-tartaruga-verde", 10.4, -0.5, -30, None, ("swim", 0.5)),
    ("guará (P23)", "guara", 13.0, 0.0, -30, "guara", None),
    ("atobá pousado", "atoba", 15.4, 0.0, -30, "atoba", ("perch", 0.0)),
    ("atobá planando", "atoba", 18.6, 0.0, -20, "atoba", "glide"),
    ("gaivotão pousado", "gaivotao", 21.8, 0.0, -30, "gaivotao", ("perch", 0.0)),
    ("gaivotão planando", "gaivotao", 25.0, 0.0, -20, "gaivotao", "glide"),
]
# The small ones, in their own row out of the lineup camera's view, next to a second avatar.
SMALL_X, SMALL_Y = 34.0, 0.0
SMALL = [
    ("uçá (P23)", "caranguejo", SMALL_X - 1.5, "caranguejo", None),
    ("caranguejo-de-pedra", "caranguejo-de-pedra", SMALL_X - 0.5, "caranguejo-de-pedra", None),
    ("sargentinho", "sargentinho", SMALL_X + 0.5, "sargentinho", ("swim", 0.2)),
    ("ouriço (P26)", "custom-ourico-do-mar", SMALL_X + 1.5, None, None),
]


def tris_of(roots) -> int:
    n = 0
    for r in roots:
        for o in [r, *r.children_recursive]:
            if o.type == "MESH":
                n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def load(path: Path, tmp: Path):
    roots = LU.import_single_glb(path, tmp)
    for r in roots:
        for o in [r, *r.children_recursive]:
            o.animation_data_clear()
        LU.convert_to_flat_lambert(r)
    return roots


def objects(roots) -> dict:
    return {o.name.split(".")[0]: o for r in roots for o in [r, *r.children_recursive]}


def pose(roots, clips: dict, clip: str, t: float) -> None:
    """Sets every node a clip moves to its rotation at time t (glTF quaternion -> Blender axes)."""
    by_name = objects(roots)
    for node, (times, quats) in clips[clip].items():
        i = max(k for k, tk in enumerate(times) if tk <= t + 1e-9)
        x, y, z, w = quats[i]
        ob = by_name[node]
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = Quaternion((w, x, -z, y))
    bpy.context.view_layer.update()


def bbox(roots):
    pts = [o.matrix_world @ Vector(c) for r in roots for o in [r, *r.children_recursive] if o.type == "MESH"
           for c in o.bound_box]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), \
        Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


def place(roots, x, y, yaw, size=None, lift=0.0) -> float:
    for r in roots:
        r.location = Vector((0, 0, 0))
        r.rotation_mode = "XYZ"
        r.rotation_euler = (0.0, 0.0, math.radians(yaw))
        r.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    lo, hi = bbox(roots)
    s = size / (hi.z - lo.z) if size else 1.0
    for r in roots:
        r.scale = (s, s, s)
        r.location = Vector((x, y, lift - lo.z * s))
    bpy.context.view_layer.update()
    return (hi.z - lo.z) * s


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


def clips_of(file: str) -> dict:
    if file.startswith("custom-tartaruga"):
        return Q.turtle_swim()
    return BC.clips_for(file)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    packed, out = Path(argv[0]), Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    LU.configure_scene_and_art_light()
    sun = bpy.data.objects["ArtSun"]
    sun.rotation_euler = Vector((-0.35, 0.93, -1.0)).normalized().to_track_quat("-Z", "Y").to_euler()
    ground = bpy.data.objects.get("LineupStageGround")
    if ground:
        ground.location.x = 17.0
        ground.scale = (1.6, 1.0, 1.0)
    sizes, counts = {}, {}

    def source(file: str) -> Path:
        return packed / f"{file}.glb" if (packed / f"{file}.glb").exists() else MODELS / f"{file}.glb"

    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        avatar(tmp, 1.2, 0.0)
        C.label("avatar 3 u", (1.2, -1.6, 0.05), size=0.4)
        # Sand under the restinga plants (preview only).
        context_mesh("areia", lambda m: m.add([(3.0, -2.2, 0.01), (9.2, -2.2, 0.01), (9.2, 1.8, 0.01), (3.0, 1.8, 0.01)],
                                              C.ramp("soil", 3)))
        for label, file, x, y, yaw, size_key, how in ROW:
            roots = load(source(file), tmp)
            lift = 0.0
            if isinstance(how, tuple):
                pose(roots, clips_of(file), *how)
            elif how == "glide":
                pose(roots, clips_of(file), "glide", 0.0)
                lift = 2.2
            h = place(roots, x, y, yaw, SIZES[size_key] if size_key else None, lift)
            sizes[label] = round(h, 3)
            counts[file] = tris_of(roots)
            C.label(f"{label} · {h:.2f} u", (x, -1.9, 0.05), size=0.3)
        avatar(tmp, SMALL_X - 3.0, SMALL_Y, yaw=-10)
        px = SMALL_X + 0.5
        context_mesh("poca", lambda m: m.add([(px - 0.45, SMALL_Y - 0.6, 0.012), (px + 0.45, SMALL_Y - 0.6, 0.012),
                                              (px + 0.45, SMALL_Y + 0.6, 0.012), (px - 0.45, SMALL_Y + 0.6, 0.012)],
                                             C.ramp("water", 1)))
        for label, file, x, size_key, how in SMALL:
            roots = load(source(file), tmp)
            if how:
                pose(roots, clips_of(file), *how)
            h = place(roots, x, SMALL_Y, -35, SIZES[size_key] if size_key else None, 0.08 if file == "sargentinho" else 0.0)
            sizes[label] = round(h, 3)
            counts[file] = tris_of(roots)
            lab = C.label(f"{label} {h:.2f} u", (x, SMALL_Y - 0.9, 0.01), size=0.09)
            lab.rotation_euler.x = math.radians(35)
        LU.render_camera_view(cam_pos=(14.2, -31.5, 4.6), look_at=(14.2, 0.0, 1.7), out_file=out / "costa-lineup.png",
                              res=(3600, 1100), fov_deg=50.0)
        LU.render_camera_view(cam_pos=(SMALL_X - 0.6, -5.2, 1.4), look_at=(SMALL_X - 0.6, SMALL_Y, 0.35),
                              out_file=out / "costa-detail.png", res=(2400, 1100), fov_deg=40.0)
    (out / "costa-sizes.json").write_text(json.dumps({"heights": sizes, "tris": counts}, indent=2, ensure_ascii=False),
                                          encoding="utf-8")
    print("[sheet]", json.dumps(counts))


if __name__ == "__main__":
    main()
