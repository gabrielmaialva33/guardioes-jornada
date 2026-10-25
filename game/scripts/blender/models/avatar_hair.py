"""
Avatar hair accessories (`game/src/assets/models/avatar-hair.glb`): 6 blocky hair/cap
meshes (`hair-long`, `hair-ponytail`, `hair-bun`, `hair-afro`, `hair-braids`, `cap`)
matching `avatar-regions-contract.md` (Version 2).

Run:
  /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/avatar_hair.py
"""

from __future__ import annotations

import math
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Euler, Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402

GAME_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = GAME_ROOT / "src" / "assets" / "models"

# Neutral grayscale shades within ART.md lightness bounds [0.12, 0.90] representing
# baked AO + sky-to-ground gradient on a white tintable surface.
AO_TOP = "#e0e3e1"     # L = 0.884
AO_UPPER = "#d2d6d4"   # L = 0.831
AO_MID = "#c2c7c4"     # L = 0.771
AO_LOW = "#b0b6b3"     # L = 0.702
AO_OCC = "#9ca39f"     # L = 0.625


def shaded_box(
    m: C.Mesh,
    centre: tuple[float, float, float],
    size: tuple[float, float, float],
    *,
    rot: Matrix | None = None,
    skip: tuple[str, ...] = (),
    top_col: str = AO_TOP,
    mid_col: str = AO_MID,
    bot_col: str = AO_OCC,
) -> None:
    m.box(
        centre,
        size,
        mid_col,
        rot=rot,
        skip=skip,
        colours={
            "top": top_col,
            "bottom": bot_col,
            "px": mid_col,
            "nx": mid_col,
            "py": mid_col,
            "ny": AO_UPPER,
        },
    )


def build_hair_long() -> C.Mesh:
    """Long hair (`hair-long`): crown cap, parted forehead bangs above z=0.64, side locks
    and a full back curtain ending at z=0.02 (72 tris <= 80)."""
    m = C.Mesh("hair-long")
    # Crown top cap sitting over z=0.80 (10 tris)
    shaded_box(m, (0.0, 0.02, 0.835), (0.86, 0.86, 0.09), skip=("bottom",))
    # Parted bangs across the top forehead (2 x 10 = 20 tris)
    shaded_box(m, (-0.23, -0.415, 0.73), (0.38, 0.06, 0.16), skip=("py",), top_col=AO_UPPER, mid_col=AO_MID)
    shaded_box(m, (0.23, -0.415, 0.73), (0.38, 0.06, 0.16), skip=("py",), top_col=AO_UPPER, mid_col=AO_MID)
    # Left and right side curtains framing the head down to the shoulders (2 x 10 = 20 tris)
    shaded_box(m, (-0.43, 0.02, 0.42), (0.08, 0.82, 0.78), skip=("px",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_LOW)
    shaded_box(m, (0.43, 0.02, 0.42), (0.08, 0.82, 0.78), skip=("nx",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_LOW)
    # Full back curtain + flared lower hem (10 + 12 = 22 tris -> 72 total)
    shaded_box(m, (0.0, 0.435, 0.42), (0.86, 0.09, 0.78), skip=("ny",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_LOW)
    shaded_box(m, (0.0, 0.465, 0.13), (0.82, 0.08, 0.20), top_col=AO_MID, mid_col=AO_LOW, bot_col=AO_OCC)
    return m


def build_hair_ponytail() -> C.Mesh:
    """Ponytail (`hair-ponytail`): crown cap, hair tie cuff, and 3 arched tail segments
    cascading down to z=0.09 (66 tris <= 80)."""
    m = C.Mesh("hair-ponytail")
    shaded_box(m, (0.0, 0.01, 0.83), (0.85, 0.85, 0.08), skip=("bottom",))
    shaded_box(m, (0.0, -0.415, 0.74), (0.82, 0.05, 0.14), skip=("py",), top_col=AO_UPPER, mid_col=AO_MID)
    shaded_box(m, (0.0, 0.425, 0.58), (0.84, 0.06, 0.46), skip=("ny",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_LOW)
    # Hair tie cuff at back of head (10 tris)
    shaded_box(m, (0.0, 0.465, 0.62), (0.22, 0.09, 0.18), skip=("ny",), top_col=AO_OCC, mid_col=AO_OCC, bot_col=AO_OCC)
    # 3 arched ponytail segments (10 + 10 + 12 = 32 tris -> 62 total)
    r1 = Euler((math.radians(-18), 0, 0), "XYZ").to_matrix()
    r2 = Euler((math.radians(12), 0, 0), "XYZ").to_matrix()
    r3 = Euler((math.radians(28), 0, 0), "XYZ").to_matrix()
    shaded_box(m, (0.0, 0.56, 0.63), (0.26, 0.20, 0.20), rot=r1, skip=("ny",), top_col=AO_TOP, mid_col=AO_UPPER, bot_col=AO_MID)
    shaded_box(m, (0.0, 0.65, 0.44), (0.28, 0.20, 0.28), rot=r2, skip=("top",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_LOW)
    shaded_box(m, (0.0, 0.68, 0.21), (0.22, 0.16, 0.24), rot=r3, top_col=AO_MID, mid_col=AO_LOW, bot_col=AO_OCC)
    return m


def build_hair_bun() -> C.Mesh:
    """Bun (`hair-bun`): crown cap, forehead fringe, wrap band, and a chunky 6-sided
    chamfered bun on top-back (76 tris <= 80)."""
    m = C.Mesh("hair-bun")
    shaded_box(m, (0.0, 0.01, 0.83), (0.85, 0.85, 0.08), skip=("bottom",))
    shaded_box(m, (0.0, -0.415, 0.74), (0.82, 0.05, 0.14), skip=("py",), top_col=AO_UPPER, mid_col=AO_MID)
    shaded_box(m, (0.0, 0.425, 0.56), (0.84, 0.06, 0.48), skip=("ny",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_LOW)
    shaded_box(m, (0.0, 0.22, 0.88), (0.34, 0.34, 0.08), skip=("bottom", "top"), top_col=AO_OCC, mid_col=AO_OCC, bot_col=AO_OCC)
    # 6-sided chamfered chunk with bottom=False -> 8*6 - 4 - 4 = 38 tris -> 76 total
    m.chunk(
        (0.0, 0.24, 0.90),
        0.26,
        0.26,
        0.28,
        6,
        AO_UPPER,
        chamfer=0.32,
        bottom=False,
        colour_top=AO_TOP,
        colour_bottom=AO_OCC,
    )
    return m


def build_hair_afro() -> C.Mesh:
    """Black power (`hair-afro`): voluminous rounded-blocky puff framing the head while
    leaving the entire front face window clear (68 tris <= 80)."""
    m = C.Mesh("hair-afro")
    # 6-sided chamfered dome on top (bottom=False -> 38 tris)
    m.chunk(
        (0.0, 0.03, 0.64),
        0.58,
        0.56,
        0.48,
        6,
        AO_UPPER,
        chamfer=0.34,
        bottom=False,
        colour_top=AO_TOP,
        colour_bottom=AO_LOW,
    )
    # Left, right, and back puffs (3 x 10 = 30 tris -> 68 total)
    shaded_box(m, (-0.46, 0.04, 0.48), (0.18, 0.84, 0.54), skip=("px",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_OCC)
    shaded_box(m, (0.46, 0.04, 0.48), (0.18, 0.84, 0.54), skip=("nx",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_OCC)
    shaded_box(m, (0.0, 0.46, 0.48), (0.88, 0.18, 0.56), skip=("ny",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_OCC)
    return m


def build_hair_braids() -> C.Mesh:
    """Braids (`hair-braids`): raised cornrow crown rows on top, two side braids framing
    the temples, and two back braids ending at the shoulders (76 tris <= 80)."""
    m = C.Mesh("hair-braids")
    # Base scalp cap (10 tris)
    shaded_box(m, (0.0, 0.01, 0.815), (0.83, 0.83, 0.05), skip=("bottom",), top_col=AO_LOW, mid_col=AO_OCC)
    # 3 raised cornrow ridges along the top of the head (3 x 10 = 30 tris)
    for x in (-0.25, 0.0, 0.25):
        shaded_box(m, (x, 0.02, 0.86), (0.13, 0.82, 0.06), skip=("bottom",), top_col=AO_TOP, mid_col=AO_MID)
    # 2 side braids (left & right, z = 0.04..0.78, 2 x 10 = 20 tris)
    shaded_box(m, (-0.44, 0.0, 0.41), (0.10, 0.22, 0.74), skip=("px",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_OCC)
    shaded_box(m, (0.44, 0.0, 0.41), (0.10, 0.22, 0.74), skip=("nx",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_OCC)
    # 2 back braids (y = 0.445, x = -0.20, +0.20, 2 x 8 = 16 tris -> 76 total)
    shaded_box(m, (-0.20, 0.44, 0.41), (0.16, 0.10, 0.74), skip=("ny", "top"), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_OCC)
    shaded_box(m, (0.20, 0.44, 0.41), (0.16, 0.10, 0.74), skip=("ny", "top"), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_OCC)
    return m


def build_cap() -> C.Mesh:
    """Ranger cap (`cap`, tinted by `shirt`): crown dome on z = 0.60..0.92 with a forward
    visor at z = 0.58..0.65 (42 tris <= 80)."""
    m = C.Mesh("cap")
    shaded_box(m, (0.0, 0.0, 0.69), (0.87, 0.87, 0.18), skip=("bottom",), top_col=AO_UPPER, mid_col=AO_MID, bot_col=AO_OCC)
    shaded_box(m, (0.0, 0.02, 0.845), (0.78, 0.80, 0.13), skip=("bottom",), top_col=AO_TOP, mid_col=AO_UPPER)
    shaded_box(m, (0.0, 0.02, 0.92), (0.12, 0.12, 0.04), skip=("bottom",), top_col=AO_TOP, mid_col=AO_MID)
    visor_rot = Euler((math.radians(6), 0, 0), "XYZ").to_matrix()
    shaded_box(
        m,
        (0.0, -0.55, 0.615),
        (0.82, 0.30, 0.055),
        rot=visor_rot,
        top_col=AO_TOP,
        mid_col=AO_MID,
        bot_col=AO_OCC,
    )
    return m


HAIR_BUILDERS = [
    ("hair-long", build_hair_long),
    ("hair-ponytail", build_hair_ponytail),
    ("hair-bun", build_hair_bun),
    ("hair-afro", build_hair_afro),
    ("hair-braids", build_hair_braids),
    ("cap", build_cap),
]


def build_all_hair() -> None:
    C.reset_scene()
    objs = []
    for name, fn in HAIR_BUILDERS:
        mesh = fn()
        tris = mesh.tris()
        assert tris <= 80, f"{name} exceeds 80 tris: {tris}"
        for v in mesh.verts:
            assert v.z >= -0.01, f"{name} hangs past shoulder plane z=0: z={v.z:.3f}"
            if v.y < -0.405 and abs(v.x) < 0.30:
                assert v.z >= 0.55, f"{name} covers face rect at ({v.x:.2f}, {v.y:.2f}, {v.z:.2f})"
        ob = C.build_object(mesh, name, pivot=(0, 0, 0))
        objs.append(ob)
        print(f"[gate] avatar-hair/{name}: {tris} tris (budget 80)")

    with tempfile.TemporaryDirectory() as tmp:
        raw_glb = Path(tmp) / "avatar-hair-raw.glb"
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.export_scene.gltf(
            filepath=str(raw_glb),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_texcoords=False,
            export_normals=True,
            export_tangents=False,
            export_materials="EXPORT",
            export_vertex_color="MATERIAL",
            export_all_vertex_colors=False,
            export_attributes=False,
        )
        out_glb = MODELS_DIR / "avatar-hair.glb"
        subprocess.run(
            [
                "pnpm",
                "dlx",
                "gltfpack@1.3.0",
                "-i",
                str(raw_glb),
                "-o",
                str(out_glb),
                "-cc",
                "-kn",
                "-vtf",
                "-vpf",
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        print(f"[avatar_hair] Wrote {out_glb} ({out_glb.stat().st_size} B)")


if __name__ == "__main__":
    build_all_hair()
