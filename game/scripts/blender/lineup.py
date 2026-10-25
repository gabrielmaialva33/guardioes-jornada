#!/usr/bin/env python3
"""
lineup.py — Headless Blender 5.2.3 LTS (Cycles OptiX RTX 4090) True-Scale Asset Lineup Renderer.

Usage:
  /usr/sbin/blender --background --python game/scripts/blender/lineup.py

Renders all game assets in one master lineup (`lineup.png`) + 3 category close-up sheets
at true ART.md §3 scale next to:
  - the 3.0 u avatar in 3 skins (skin-a, skin-f, skin-l),
  - a 1.0 u scale bar (and 3.0 u reference post),
  - a 3-patch neutral grey card (18%, 50%, 85%),
using the exact ART.md §5 daylight setup (`game/src/style/palette.ts`: hemisphere sky `#cfe8f2`,
hemisphere ground `#3f6b48`, 45° elevation sun `#fff1d0`) and flat Lambert (`Diffuse BSDF`)
shading multiplying `COLOR_0 * palette_texture` (`Closest` / `NEAREST`).
"""

from __future__ import annotations

import json
import math
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Euler, Vector

SCRIPT_DIR = Path(__file__).resolve().parent
GAME_ROOT = SCRIPT_DIR.parent.parent
MODELS_DIR = GAME_ROOT / "src" / "assets" / "models"
SKINS_DIR = GAME_ROOT / "src" / "assets" / "skins"
OUT_DIR = Path(
    os.environ.get(
        "LINEUP_OUT_DIR",
        str(Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta" / "lineup"),
    )
)

# Exact constants from game/src/style/palette.ts
LIGHT_DAYLIGHT = {
    "hemisphereSky": "#cfe8f2",
    "hemisphereGround": "#3f6b48",
    "sun": "#fff1d0",
    "sunElevationDeg": 45.0,
    "skyTop": "#8fd0f0",
    "horizon": "#e9f4e4",
}


sys.path.insert(0, str(SCRIPT_DIR))
import recolor  # noqa: E402


DECAL_LEGEND = {
    "k": "#242228",
    "w": "#e2e6e0",
    "m": "#5a2e2e",
}


def composite_preset_png(regions_spec: dict, preset: dict, out_path: Path) -> Path:
    rgba = bytearray(64 * 64 * 4)

    def fill_rect(rect: list[int], hex_col: str) -> None:
        r, g, b = recolor.hex_to_rgb(hex_col)
        x0, y0, w, h = rect
        for y in range(y0, min(64, y0 + h)):
            for x in range(x0, min(64, x0 + w)):
                p = (y * 64 + x) * 4
                rgba[p] = r
                rgba[p + 1] = g
                rgba[p + 2] = b
                rgba[p + 3] = 255

    fill_rect([0, 0, 64, 64], "#1e4d36")
    for slot_name in regions_spec["paintOrder"]:
        color_hex = preset.get(slot_name)
        if not color_hex:
            continue
        for rect in regions_spec["slots"].get(slot_name, []):
            fill_rect(rect, color_hex)

    fx0, fy0, fw, fh = regions_spec["face"]["rect"]
    decals = regions_spec["face"]["decals"]
    rows = decals.get(preset.get("face", "smile")) or decals["smile"]
    row_count = len(rows)
    col_count = len(rows[0]) if row_count else 1
    for dy in range(fh):
        r_idx = min(row_count - 1, (dy * row_count) // fh)
        row_str = rows[r_idx]
        for dx in range(fw):
            c_idx = min(col_count - 1, (dx * col_count) // fw)
            ch = row_str[c_idx]
            if ch and ch != ".":
                col_hex = DECAL_LEGEND.get(ch)
                if col_hex:
                    fill_rect([fx0 + dx, fy0 + dy, 1, 1], col_hex)

    out_path.write_bytes(recolor.encode_png8(64, 64, bytes(rgba)))
    return out_path


def hex_to_linear_rgba(hex_str: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    v = int(hex_str.lstrip("#"), 16)
    r, g, b = ((v >> 16) & 255) / 255.0, ((v >> 8) & 255) / 255.0, (v & 255) / 255.0

    def to_lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (to_lin(r), to_lin(g), to_lin(b), alpha)


def unpack_glb_if_needed(glb_path: Path, tmp_dir: Path) -> Path:
    buf = glb_path.read_bytes()
    j_len = struct.unpack_from("<I", buf, 12)[0]
    j_obj = json.loads(buf[20 : 20 + j_len].decode("utf-8"))
    exts = j_obj.get("extensionsUsed", [])
    if "EXT_meshopt_compression" in exts or "KHR_meshopt_compression" in exts:
        out = tmp_dir / f"unpacked-{glb_path.name}"
        subprocess.run(
            ["pnpm", "dlx", "gltfpack@1.3.0", "-i", str(glb_path), "-o", str(out), "-noq", "-kn"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return out
    return glb_path


def configure_scene_and_art_light() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = dev.type in ("OPTIX", "CUDA")
    scene.cycles.device = "GPU"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPTIX"
    except Exception:
        pass
    scene.cycles.max_bounces = 2
    scene.cycles.diffuse_bounces = 1
    scene.cycles.glossy_bounces = 0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    # World hemisphere light (sky #cfe8f2 above, ground #3f6b48 below, horizon #e9f4e4)
    world = bpy.data.worlds.new("ArtDaylightWorld")
    scene.world = world
    nt = world.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()

    tex_coord = nodes.new("ShaderNodeTexCoord")
    sep_xyz = nodes.new("ShaderNodeSeparateXYZ")
    map_range = nodes.new("ShaderNodeMapRange")
    map_range.inputs["From Min"].default_value = -0.35
    map_range.inputs["From Max"].default_value = 0.65
    mix_hemi = nodes.new("ShaderNodeMix")
    mix_hemi.data_type = "RGBA"
    mix_hemi.inputs[6].default_value = hex_to_linear_rgba(LIGHT_DAYLIGHT["hemisphereGround"])
    mix_hemi.inputs[7].default_value = hex_to_linear_rgba(LIGHT_DAYLIGHT["hemisphereSky"])

    bg_hemi = nodes.new("ShaderNodeBackground")
    bg_hemi.inputs["Strength"].default_value = 0.72
    bg_cam = nodes.new("ShaderNodeBackground")
    bg_cam.inputs["Color"].default_value = hex_to_linear_rgba(LIGHT_DAYLIGHT["horizon"])
    bg_cam.inputs["Strength"].default_value = 1.0

    light_path = nodes.new("ShaderNodeLightPath")
    mix_shader = nodes.new("ShaderNodeMixShader")
    out_node = nodes.new("ShaderNodeOutputWorld")

    links.new(tex_coord.outputs["Generated"], sep_xyz.inputs["Vector"])
    links.new(sep_xyz.outputs["Z"], map_range.inputs["Value"])
    links.new(map_range.outputs["Result"], mix_hemi.inputs["Factor"])
    links.new(mix_hemi.outputs[2], bg_hemi.inputs["Color"])
    links.new(light_path.outputs["Is Camera Ray"], mix_shader.inputs["Fac"])
    links.new(bg_hemi.outputs["Background"], mix_shader.inputs[1])
    links.new(bg_cam.outputs["Background"], mix_shader.inputs[2])
    links.new(mix_shader.outputs["Shader"], out_node.inputs["Surface"])

    # Sun light at 45° elevation (#fff1d0) shining from front-right (towards -Y)
    sun_data = bpy.data.lights.new(name="ArtSun", type="SUN")
    sun_data.color = hex_to_linear_rgba(LIGHT_DAYLIGHT["sun"])[:3]
    sun_data.energy = 2.4
    sun_data.angle = math.radians(4.0)
    sun_obj = bpy.data.objects.new(name="ArtSun", object_data=sun_data)
    bpy.context.collection.objects.link(sun_obj)
    sun_dir = Vector((-0.35, -0.93, -1.0)).normalized()
    sun_obj.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()

    # Ground stage plane in RAMPS.grass[1] (#3f7d4f)
    bpy.ops.mesh.primitive_plane_add(size=120.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.name = "LineupStageGround"
    gmat = make_flat_color_material("StageGroundMat", "#3f7d4f")
    ground.data.materials.append(gmat)


def make_flat_color_material(name: str, hex_color: str) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()
    diff = nodes.new("ShaderNodeBsdfDiffuse")
    diff.inputs["Color"].default_value = hex_to_linear_rgba(hex_color)
    diff.inputs["Roughness"].default_value = 0.0
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(diff.outputs["BSDF"], out.inputs["Surface"])
    return mat


def convert_to_flat_lambert(obj: bpy.types.Object, override_image_path: Path | None = None) -> None:
    """
    Force flat polygon shading and convert all materials on `obj` and its hierarchy
    to flat Lambert (`ShaderNodeBsdfDiffuse`, roughness=0) multiplying `COLOR_0 * texture`
    with `Closest` (`NEAREST`) texture filtering.
    """
    queue = [obj]
    img_loaded = None
    if override_image_path is not None and override_image_path.exists():
        img_loaded = bpy.data.images.load(str(override_image_path), check_existing=True)

    converted_cache: dict[str, bpy.types.Material] = {}
    while queue:
        cur = queue.pop(0)
        queue.extend(cur.children)
        if cur.type != "MESH":
            continue
        mesh = cur.data
        for poly in mesh.polygons:
            poly.use_smooth = False

        has_vc = len(mesh.color_attributes) > 0
        vc_attr_name = mesh.color_attributes[0].name if has_vc else "COLOR_0"
        for slot in cur.material_slots:
            orig_mat = slot.material
            if not orig_mat:
                continue
            cache_key = f"{orig_mat.name}|{override_image_path}|{has_vc}|{vc_attr_name}"
            if cache_key in converted_cache:
                slot.material = converted_cache[cache_key]
                continue
            mat = orig_mat.copy() if img_loaded is not None else orig_mat
            slot.material = mat
            converted_cache[cache_key] = mat
            if not mat.node_tree:
                continue
            nt = mat.node_tree
            nodes = nt.nodes
            links = nt.links

            tex_node = next((n for n in nodes if n.type == "TEX_IMAGE"), None)
            base_rgba = (0.8, 0.8, 0.8, 1.0)
            bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                base_rgba = tuple(bsdf.inputs["Base Color"].default_value)

            tex_img = img_loaded if img_loaded is not None else (tex_node.image if tex_node else None)
            nodes.clear()

            diff = nodes.new("ShaderNodeBsdfDiffuse")
            diff.inputs["Roughness"].default_value = 0.0
            out = nodes.new("ShaderNodeOutputMaterial")
            links.new(diff.outputs["BSDF"], out.inputs["Surface"])

            color_out_socket = None
            if tex_img is not None:
                tn = nodes.new("ShaderNodeTexImage")
                tn.image = tex_img
                tn.interpolation = "Closest"
                tn.extension = "REPEAT"
                color_out_socket = tn.outputs["Color"]
            else:
                rgb_node = nodes.new("ShaderNodeRGB")
                rgb_node.outputs[0].default_value = base_rgba
                color_out_socket = rgb_node.outputs[0]

            if has_vc and tex_img is not None:
                vc = nodes.new("ShaderNodeVertexColor")
                vc.layer_name = vc_attr_name
                mix = nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                links.new(color_out_socket, mix.inputs[6])
                links.new(vc.outputs["Color"], mix.inputs[7])
                links.new(mix.outputs[2], diff.inputs["Color"])
            elif has_vc:
                vc = nodes.new("ShaderNodeVertexColor")
                vc.layer_name = vc_attr_name
                links.new(vc.outputs["Color"], diff.inputs["Color"])
            else:
                links.new(color_out_socket, diff.inputs["Color"])


def get_hierarchy_bounds(root_obj: bpy.types.Object) -> tuple[Vector, Vector]:
    bpy.context.view_layer.update()
    mins = Vector((float("inf"), float("inf"), float("inf")))
    maxs = Vector((float("-inf"), float("-inf"), float("-inf")))
    queue = [root_obj]
    found = False
    while queue:
        cur = queue.pop(0)
        queue.extend(cur.children)
        if cur.type == "MESH":
            found = True
            mw = cur.matrix_world
            for v in cur.data.vertices:
                w = mw @ v.co
                mins.x = min(mins.x, w.x)
                mins.y = min(mins.y, w.y)
                mins.z = min(mins.z, w.z)
                maxs.x = max(maxs.x, w.x)
                maxs.y = max(maxs.y, w.y)
                maxs.z = max(maxs.z, w.z)
    if not found:
        return (Vector((0, 0, 0)), Vector((1, 1, 1)))
    return (mins, maxs)


def place_and_scale_root(
    root_obj: bpy.types.Object,
    pos_xy: tuple[float, float],
    target_height: float | None = None,
    target_length: float | None = None,
    uniform_scale: float | None = None,
    yaw_deg: float = 0.0,
) -> None:
    root_obj.location = Vector((0.0, 0.0, 0.0))
    root_obj.rotation_mode = "XYZ"
    root_obj.rotation_euler = Euler((0.0, 0.0, math.radians(yaw_deg)), "XYZ")
    root_obj.scale = Vector((1.0, 1.0, 1.0))
    mins, maxs = get_hierarchy_bounds(root_obj)
    size = maxs - mins

    s = 1.0
    if uniform_scale is not None:
        s = uniform_scale
    elif target_height is not None and size.z > 1e-4:
        s = target_height / size.z
    elif target_length is not None and max(size.x, size.y) > 1e-4:
        s = target_length / max(size.x, size.y)

    root_obj.scale = Vector((s, s, s))
    mins, maxs = get_hierarchy_bounds(root_obj)
    cx = (mins.x + maxs.x) * 0.5
    cy = (mins.y + maxs.y) * 0.5
    root_obj.location = Vector((pos_xy[0] - cx, pos_xy[1] - cy, -mins.z))
    bpy.context.view_layer.update()


def import_single_glb(glb_path: Path, tmp_dir: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    unpacked = unpack_glb_if_needed(glb_path, tmp_dir)
    bpy.ops.import_scene.gltf(filepath=str(unpacked))
    after = set(bpy.context.scene.objects) - before
    return [o for o in after if o.parent is None]


def build_reference_bars_and_grey_card(origin_xy: tuple[float, float]) -> None:
    ox, oy = origin_xy
    # 1.0 u scale bar (2 segments of 0.5 u: gold #ffd166 and dark rock #4f5c55)
    for seg, col_hex in enumerate(("#4f5c55", "#ffd166")):
        bpy.ops.mesh.primitive_cube_add(
            size=1.0, location=(ox, oy, 0.25 + seg * 0.5)
        )
        bar = bpy.context.active_object
        bar.scale = Vector((0.22, 0.22, 0.5))
        bar.data.materials.append(make_flat_color_material(f"Scale1u_{seg}", col_hex))

    # 3.0 u avatar height reference bar (3 segments of 1.0 u)
    for seg, col_hex in enumerate(("#4f5c55", "#8e9b92", "#ffd166")):
        bpy.ops.mesh.primitive_cube_add(
            size=1.0, location=(ox - 0.55, oy, 0.5 + seg * 1.0)
        )
        bar3 = bpy.context.active_object
        bar3.scale = Vector((0.16, 0.16, 1.0))
        bar3.data.materials.append(make_flat_color_material(f"Scale3u_{seg}", col_hex))

    # 3-step neutral grey card (dark 20% #333333, mid 50% #777777, light 85% #d9d9d9)
    for idx, hex_g in enumerate(("#333333", "#777777", "#d9d9d9")):
        bpy.ops.mesh.primitive_cube_add(
            size=1.0, location=(ox + 0.65, oy, 0.35 + idx * 0.65)
        )
        card = bpy.context.active_object
        card.scale = Vector((0.45, 0.08, 0.6))
        card.data.materials.append(make_flat_color_material(f"GreyCard_{idx}", hex_g))


def render_camera_view(
    cam_pos: tuple[float, float, float],
    look_at: tuple[float, float, float],
    out_file: Path,
    res: tuple[int, int] = (2560, 1440),
    fov_deg: float = 38.0,
) -> None:
    scene = bpy.context.scene
    scene.render.resolution_x = res[0]
    scene.render.resolution_y = res[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(out_file)

    cam_data = bpy.data.cameras.new("LineupCam")
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(fov_deg)
    cam_data.clip_start = 0.1
    cam_data.clip_end = 250.0
    cam_obj = bpy.data.objects.new("LineupCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = Vector(cam_pos)
    direction = Vector(look_at) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam_obj

    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam_obj, do_unlink=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    configure_scene_and_art_light()

    with tempfile.TemporaryDirectory() as tmp_str:
        tmp_dir = Path(tmp_str)

        # 1. Scale bar (1.0 u + 3.0 u) & Grey card at front-left (-12.5, 5.5)
        build_reference_bars_and_grey_card((-12.5, 5.5))

        regions_spec = json.loads((SKINS_DIR / "avatar-regions.json").read_text(encoding="utf-8"))

        # 2. Avatar (3.0 u tall, in 3 Roblox-classic flat-colour presets: Iara, Dandara, Bento)
        for idx, preset_idx in enumerate((0, 2, 3)):
            preset = regions_spec["presets"][preset_idx]
            preset_png = composite_preset_png(regions_spec, preset, tmp_dir / f"av-{preset['id']}.png")
            roots = import_single_glb(MODELS_DIR / "avatar.glb", tmp_dir)
            if roots:
                av = roots[0]
                convert_to_flat_lambert(av, preset_png)
                place_and_scale_root(av, (-10.2 + idx * 1.6, 5.5), target_height=3.0, yaw_deg=165.0)

        # 3. 7 Atlantic Forest Animals at true ART.md §3 scale (front row y = 5.5) + custom attachments
        animal_specs = [
            ("monkey.glb", "palette-mico-leao-dourado.png", (-4.8, 5.5), 0.9, None, "custom-juba-mico.glb"),
            ("parrot.glb", "palette-tucano-de-bico-verde.png", (-3.1, 5.5), 0.9, None, "custom-bico-tucano.glb"),
            ("monkey.glb", "palette-bugio-ruivo.png", (-1.3, 5.5), 1.4, None, None),
            ("koala.glb", "palette-preguica-de-coleira.png", (0.7, 5.5), 1.4, None, None),
            ("monkey.glb", "palette-muriqui.png", (2.8, 5.5), 1.7, None, None),
            ("tiger.glb", "palette-onca-pintada.png", (5.6, 5.5), None, 3.0, "custom-rosetas-onca.glb"),
            ("tiger.glb", "palette-onca-melanica.png", (9.0, 5.5), None, 3.0, None),
        ]
        for model_name, pal_name, xy, th, tl, attach_glb in animal_specs:
            roots = import_single_glb(MODELS_DIR / model_name, tmp_dir)
            if roots:
                pet = roots[0]
                pet_nodes = {o.name.split(".")[0]: o for o in [pet, *pet.children_recursive]}
                group_loc = Vector((0.0, -0.1125, 1.1621))
                if model_name == "parrot.glb":
                    # Hide/remove cockatoo crest ('Group') so the toucan has a smooth black crown
                    for ch in list(pet.children_recursive):
                        if ch.name.startswith("Group"):
                            group_loc = ch.location.copy()
                            bpy.data.objects.remove(ch, do_unlink=True)
                convert_to_flat_lambert(pet, SKINS_DIR / pal_name)
                place_and_scale_root(pet, xy, target_height=th, target_length=tl, yaw_deg=160.0)
                if attach_glb and (MODELS_DIR / attach_glb).exists():
                    att_roots = import_single_glb(MODELS_DIR / attach_glb, tmp_dir)
                    for ar in att_roots:
                        convert_to_flat_lambert(ar)
                        if "bico-tucano" in attach_glb and "body" in pet_nodes:
                            ar.parent = pet_nodes["body"]
                            ar.matrix_parent_inverse.identity()
                            ar.location = group_loc
                            ar.rotation_euler = Euler((0.0, 0.0, 0.0), "XYZ")
                            ar.scale = Vector((1.0, 1.0, 1.0))
                        elif "juba-mico" in attach_glb and "body" in pet_nodes:
                            ar.parent = pet_nodes["body"]
                            ar.matrix_parent_inverse.identity()
                            ar.location = Vector((0.0, 0.0, 0.0))
                            ar.rotation_euler = Euler((0.0, 0.0, 0.0), "XYZ")
                            ar.scale = Vector((1.0, 1.0, 1.0))
                        elif "rosetas-onca" in attach_glb:
                            for g in list(ar.children):
                                base_g = g.name.split(".")[0]
                                if base_g.startswith("rosetas-"):
                                    target = pet_nodes.get(base_g[len("rosetas-") :])
                                    if target:
                                        for child in list(g.children):
                                            loc = child.location.copy()
                                            child.parent = target
                                            child.matrix_parent_inverse.identity()
                                            child.location = loc
                                            child.rotation_euler = Euler((0.0, 0.0, 0.0), "XYZ")
                                            child.scale = Vector((1.0, 1.0, 1.0))
                bpy.context.view_layer.update()

        # 4. Props, Obby & Cabin from kit-props.glb (middle row y = 1.5)
        props_roots = import_single_glb(MODELS_DIR / "kit-props.glb", tmp_dir)
        props_by_name = {o.name.split(".")[0]: o for o in props_roots}
        for r in props_roots:
            convert_to_flat_lambert(r)

        prop_placements = [
            ("soda-bottle", (-11.5, 1.8), 0.5, None),
            ("soda-can", (-10.7, 1.8), 0.3, None),
            ("soda-can-crushed", (-10.0, 1.8), 0.25, None),
            ("bag", (-9.1, 1.8), 0.65, None),
            ("coin-gold", (-7.9, 1.8), 0.75, None),
            ("flag", (-6.5, 1.8), 2.2, None),
            ("platform", (-4.2, 1.5), None, 2.0),
            ("platform-ramp", (-1.6, 1.5), None, 2.0),
            ("platform-fortified", (1.0, 1.5), None, 2.0),
            ("block-grass", (3.6, 1.5), None, 2.0),
            ("block-grass-large", (6.6, 1.5), None, 3.0),
            ("cabin-wall", (10.2, 2.2), 3.2, None),
            ("cabin-doorway", (12.3, 2.2), 3.2, None),
            ("cabin-window-a", (14.4, 2.2), 3.2, None),
            ("cabin-corner", (16.2, 2.2), 3.2, None),
            ("cabin-roof", (11.2, -0.5), None, 2.8),
            ("cabin-roof-point", (14.2, -0.5), None, 2.8),
            ("floor-wood", (16.9, -0.5), None, 2.2),
        ]
        for p_name, xy, th, tl in prop_placements:
            obj = props_by_name.get(p_name)
            if obj:
                place_and_scale_root(obj, xy, target_height=th, target_length=tl, yaw_deg=-15.0)

        # 5. Understorey Flora & Rocks from kit-flora.glb (row y = -2.8)
        flora_roots = import_single_glb(MODELS_DIR / "kit-flora.glb", tmp_dir)
        flora_by_name = {o.name.split(".")[0]: o for o in flora_roots}
        for r in flora_roots:
            convert_to_flat_lambert(r)

        flora_placements = [
            ("sign", (-12.0, -2.8), 2.2, None),
            ("campfire_logs", (-10.2, -2.8), 0.6, None),
            ("pot_large", (-8.6, -2.8), 0.9, None),
            ("crops_leafsStageA", (-7.2, -2.8), 0.7, None),
            ("flower_yellowA", (-5.8, -2.8), 0.8, None),
            ("grass_leafsLarge", (-4.4, -2.8), 0.9, None),
            ("hanging_moss", (-2.8, -2.8), 1.4, None),
            ("plant_bushLarge", (-0.8, -2.8), 1.6, None),
            ("stump_old", (1.4, -2.8), 1.1, None),
            ("log_large", (3.9, -2.8), None, 2.6),
            ("rock_largeA", (7.2, -2.8), 2.4, None),
        ]
        for f_name, xy, th, tl in flora_placements:
            obj = flora_by_name.get(f_name)
            if obj:
                place_and_scale_root(obj, xy, target_height=th, target_length=tl, yaw_deg=12.0)

        # 6. Custom Atlantic Forest Trees (back row y = -8.5) & Custom Props/Signs/Bromeliads
        custom_tree_layout = [
            ("custom-xaxim.glb", (-13.5, -8.5)),
            ("custom-palmeira-jucara.glb", (-9.2, -8.5)),
            ("custom-embauba.glb", (-4.6, -8.5)),
            ("custom-ipe-amarelo.glb", (0.2, -8.5)),
            ("custom-ipe-rosa.glb", (5.4, -8.5)),
            ("custom-araucaria.glb", (11.0, -8.5)),
            ("custom-jequitiba-rosa.glb", (17.2, -8.5)),
        ]
        for c_name, xy in custom_tree_layout:
            if (MODELS_DIR / c_name).exists():
                for cr in import_single_glb(MODELS_DIR / c_name, tmp_dir):
                    convert_to_flat_lambert(cr)
                    place_and_scale_root(cr, xy, uniform_scale=1.0, yaw_deg=15.0)

        custom_prop_layout = [
            ("custom-bromelia.glb", (11.8, 5.5)),
            ("custom-bromelia-centro-vermelho.glb", (13.2, 5.5)),
            ("custom-arapuca.glb", (14.8, 5.5)),
            ("custom-laco.glb", (16.4, 5.5)),
            ("custom-placa-nao-jogue-lixo.glb", (-13.8, -2.8)),
            ("custom-placa-proibido-cacar.glb", (-15.6, -2.8)),
            ("custom-placa-area-de-soltura.glb", (-17.4, -2.8)),
        ]
        for c_name, xy in custom_prop_layout:
            if (MODELS_DIR / c_name).exists():
                for cr in import_single_glb(MODELS_DIR / c_name, tmp_dir):
                    convert_to_flat_lambert(cr)
                    place_and_scale_root(cr, xy, uniform_scale=1.0, yaw_deg=165.0)

        # Render 1: Master Lineup Overview (2560x1440)
        render_camera_view(
            cam_pos=(1.5, 36.0, 14.5),
            look_at=(1.5, -2.5, 5.5),
            out_file=OUT_DIR / "lineup.png",
            res=(2560, 1440),
            fov_deg=48.0,
        )

        # Render 2: Close-up Sheet — Avatars (3 skins), 1 u Scale Bar, Grey Card & 7 Animals
        render_camera_view(
            cam_pos=(0.5, 19.5, 3.8),
            look_at=(0.5, 5.5, 1.3),
            out_file=OUT_DIR / "closeup-avatars-animals.png",
            res=(1920, 1080),
            fov_deg=45.0,
        )

        # Render 3: Close-up Sheet — Props, Obby Platforms, Checkpoint Flag & Ranger Cabin
        render_camera_view(
            cam_pos=(2.5, 19.0, 5.2),
            look_at=(2.5, 1.2, 1.4),
            out_file=OUT_DIR / "closeup-props-obby-cabin.png",
            res=(1920, 1080),
            fov_deg=48.0,
        )

        # Render 4: Close-up Sheet — Custom Atlantic Forest Trees (6 u to 18 u) & Understorey Flora
        render_camera_view(
            cam_pos=(1.5, 30.0, 12.5),
            look_at=(1.5, -7.5, 6.8),
            out_file=OUT_DIR / "closeup-trees-flora.png",
            res=(1920, 1080),
            fov_deg=48.0,
        )

        # Render 5: 18 Roblox-Classic Flat-Colour Avatar Presets Sheet (6x3 grid in lineup light)
        configure_scene_and_art_light()
        for idx, preset in enumerate(regions_spec["presets"]):
            col = idx % 6
            row = idx // 6
            preset_png = composite_preset_png(regions_spec, preset, tmp_dir / f"sheet-{preset['id']}.png")
            roots = import_single_glb(MODELS_DIR / "avatar.glb", tmp_dir)
            if roots:
                av = roots[0]
                convert_to_flat_lambert(av, preset_png)
                place_and_scale_root(
                    av,
                    (-6.25 + col * 2.5, 3.5 - row * 3.5),
                    target_height=3.0,
                    yaw_deg=165.0,
                )
        render_camera_view(
            cam_pos=(0.0, 16.5, 6.2),
            look_at=(0.0, 0.0, 1.5),
            out_file=OUT_DIR / "avatar-presets-18.png",
            res=(1920, 1080),
            fov_deg=42.0,
        )

    print(f"[lineup.py] Rendered master lineup and 3 category sheets to {OUT_DIR}")


if __name__ == "__main__":
    main()
