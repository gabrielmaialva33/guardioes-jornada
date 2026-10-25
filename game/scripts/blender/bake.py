#!/usr/bin/env python3
"""
bake.py — Headless Blender 5.2.3 LTS Cycles (OptiX RTX 4090) AO + Sky-to-Ground Vertex Colour Baker.

Usage:
  /usr/sbin/blender --background --python game/scripts/blender/bake.py
  /usr/sbin/blender --background --python game/scripts/blender/bake.py -- <in.glb> <out.glb>

For every static asset (`kit-flora.glb`, `kit-props.glb`, and any `custom-raw/*.glb`):
1. Configures Cycles on the NVIDIA RTX 4090 with OptiX acceleration.
2. Imports the GLB, spaces top-level asset nodes onto a baking grid with a ground-contact
   occluder plane at z = z_min so Cycles bakes true ground-contact + crevice AO.
3. Bakes Cycles AO (`bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')`) into the
   `COLOR_0` vertex color attribute (`BYTE_COLOR` on `CORNER` domain).
4. Combines baked AO with a vertical sky-to-ground gradient (multiply-ready in [0.52..1.00]),
   restores original transforms, exports glTF 2.0 with `COLOR_0`, and packs with
   `pnpm dlx gltfpack@1.3.0 -cc -kn -vtf -kv`.
"""

from __future__ import annotations

import gzip
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
GAME_ROOT = SCRIPT_DIR.parent.parent
MODELS_DIR = GAME_ROOT / "src" / "assets" / "models"
CUSTOM_RAW_DIR = Path(
    os.environ.get(
        "CUSTOM_RAW_DIR",
        str(Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta" / "custom-raw"),
    )
)
DELTA_REPORT_PATH = Path(
    os.environ.get(
        "BAKE_REPORT_PATH",
        str(Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta" / "lineup" / "bake-deltas.json"),
    )
)

sys.path.insert(0, str(SCRIPT_DIR))
import recolor  # noqa: E402


def configure_cycles_optix(samples: int = 32) -> str:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    active_gpu = "CPU"
    for dev in prefs.devices:
        if dev.type in ("OPTIX", "CUDA"):
            dev.use = True
            active_gpu = f"{dev.name} ({dev.type})"
        else:
            dev.use = False
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.bake.target = "VERTEX_COLORS"
    scene.render.bake.margin = 2

    if not scene.world:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.ao_factor = 1.0
    scene.world.light_settings.distance = 1.8
    return active_gpu


def extract_glb_images_and_samplers(glb_path: Path) -> tuple[dict[str, bytes], list[bytes], list[dict]]:
    buf = glb_path.read_bytes()
    j_len = struct.unpack_from("<I", buf, 12)[0]
    j_obj = json.loads(buf[20 : 20 + j_len].decode("utf-8"))
    bin_chunk = buf[28 + j_len :] if len(buf) > 20 + j_len else b""
    by_name: dict[str, bytes] = {}
    ordered: list[bytes] = []
    for idx, img in enumerate(j_obj.get("images", [])):
        bv_idx = img.get("bufferView")
        if bv_idx is not None:
            bv = j_obj["bufferViews"][bv_idx]
            off = bv.get("byteOffset", 0)
            length = bv["byteLength"]
            raw_img = bin_chunk[off : off + length]
            ordered.append(raw_img)
            by_name[img.get("name", f"palette-{idx}")] = raw_img
    samplers = j_obj.get(
        "samplers",
        [{"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071}],
    )
    return by_name, ordered, samplers


def restore_glb_images_and_clean(
    glb_path: Path, orig_by_name: dict[str, bytes], orig_ordered: list[bytes], orig_samplers: list[dict]
) -> None:
    """
    Re-inject compact PNG-8 images (matched by image/material name) and NEAREST samplers
    into Blender's exported GLB, and strip TANGENT before gltfpack.
    """
    buf = glb_path.read_bytes()
    j_len = struct.unpack_from("<I", buf, 12)[0]
    j_obj = json.loads(buf[20 : 20 + j_len].decode("utf-8"))
    bin_chunk = bytearray(buf[28 + j_len :] if len(buf) > 20 + j_len else b"")

    for mesh in j_obj.get("meshes", []):
        for prim in mesh.get("primitives", []):
            attrs = prim.get("attributes", {})
            if "TANGENT" in attrs:
                del attrs["TANGENT"]

    if orig_ordered and j_obj.get("images"):
        for idx, img_entry in enumerate(j_obj["images"]):
            img_name = img_entry.get("name", "")
            img_bytes = orig_by_name.get(img_name)
            if img_bytes is None:
                # Match prefix before '.001' if Blender renamed image
                base_name = img_name.split(".")[0]
                img_bytes = orig_by_name.get(base_name)
            if img_bytes is None and idx < len(orig_ordered):
                img_bytes = orig_ordered[idx]
            if img_bytes is None:
                continue
            pad = (4 - (len(bin_chunk) % 4)) % 4
            bin_chunk.extend(b"\x00" * pad)
            offset = len(bin_chunk)
            bin_chunk.extend(img_bytes)
            bv_idx = len(j_obj.setdefault("bufferViews", []))
            j_obj["bufferViews"].append(
                {"buffer": 0, "byteOffset": offset, "byteLength": len(img_bytes)}
            )
            j_obj["images"][idx] = {
                "bufferView": bv_idx,
                "mimeType": "image/png",
                "name": img_name or f"palette-{idx}",
            }

    if j_obj.get("textures"):
        j_obj["samplers"] = orig_samplers
        for tex in j_obj["textures"]:
            tex["sampler"] = 0

    for mat in j_obj.get("materials", []):
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 1.0

    if j_obj.get("buffers"):
        j_obj["buffers"][0]["byteLength"] = len(bin_chunk)

    j_bytes = json.dumps(j_obj, separators=(",", ":")).encode("utf-8")
    j_pad = (4 - (len(j_bytes) % 4)) % 4
    j_bytes += b" " * j_pad
    b_pad = (4 - (len(bin_chunk) % 4)) % 4
    bin_chunk.extend(b"\x00" * b_pad)

    total_len = 12 + 8 + len(j_bytes) + 8 + len(bin_chunk)
    out = bytearray()
    out.extend(struct.pack("<III", 0x46546C67, 2, total_len))
    out.extend(struct.pack("<II", len(j_bytes), 0x4E4F534A))
    out.extend(j_bytes)
    out.extend(struct.pack("<II", len(bin_chunk), 0x004E4942))
    out.extend(bin_chunk)
    glb_path.write_bytes(bytes(out))


def ensure_uncompressed_glb(in_glb: Path, tmp_dir: Path) -> Path:
    """If `in_glb` uses EXT_meshopt_compression, unpack it via gltfpack -noq -kn so Blender 5.2 can import it."""
    buf = in_glb.read_bytes()
    j_len = struct.unpack_from("<I", buf, 12)[0]
    j_obj = json.loads(buf[20 : 20 + j_len].decode("utf-8"))
    exts = j_obj.get("extensionsUsed", [])
    if "EXT_meshopt_compression" in exts or "KHR_meshopt_compression" in exts:
        unpacked = tmp_dir / f"unpacked-{in_glb.name}"
        subprocess.run(
            ["pnpm", "dlx", "gltfpack@1.3.0", "-i", str(in_glb), "-o", str(unpacked), "-noq", "-kn"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return unpacked
    return in_glb


def bake_static_glb(in_glb: Path, out_glb: Path) -> dict:
    """
    Import `in_glb`, bake Cycles OptiX AO + sky-to-ground gradient into `COLOR_0`,
    export, pack with `gltfpack -cc -kn -vtf -kv`, and return size delta stats.
    """
    with tempfile.TemporaryDirectory() as pre_tmp:
        # Measure packed baseline size before COLOR_0 baking
        baseline_packed = Path(pre_tmp) / "baseline-packed.glb"
        subprocess.run(
            [
                "pnpm",
                "dlx",
                "gltfpack@1.3.0",
                "-i",
                str(in_glb),
                "-o",
                str(baseline_packed),
                "-cc",
                "-kn",
                "-vtf",
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        pre_bytes = baseline_packed.read_bytes()
        pre_raw = len(pre_bytes)
        pre_gz = len(gzip.compress(pre_bytes, compresslevel=9))

        importable_glb = ensure_uncompressed_glb(in_glb, Path(pre_tmp))
        orig_by_name, orig_ordered, orig_samplers = extract_glb_images_and_samplers(importable_glb)

        bpy.ops.wm.read_factory_settings(use_empty=True)
        gpu_name = configure_cycles_optix(samples=32)

        bpy.ops.import_scene.gltf(filepath=str(importable_glb))

    # Identify top-level imported root objects
    roots = [o for o in bpy.context.scene.objects if o.parent is None]
    saved_locations: dict[str, Vector] = {}
    spacing = 12.0
    cols = max(1, int(math.ceil(math.sqrt(len(roots)))))
    for idx, root_obj in enumerate(roots):
        saved_locations[root_obj.name] = root_obj.location.copy()
        gx = (idx % cols) * spacing
        gy = (idx // cols) * spacing
        root_obj.location = Vector((gx, gy, root_obj.location.z))

    bpy.context.view_layer.update()

    # Add a temporary ground plane at z = 0 for ground-contact AO
    bpy.ops.mesh.primitive_plane_add(
        size=spacing * (cols + 2),
        location=(spacing * cols * 0.5, spacing * cols * 0.5, 0.0),
    )
    ground_obj = bpy.context.active_object
    ground_obj.name = "__bake_ground_plane__"
    ground_mat = bpy.data.materials.new("__BakeGroundMat__")
    ground_obj.data.materials.append(ground_mat)

    mesh_objs = [
        o for o in bpy.context.scene.objects if o.type == "MESH" and o != ground_obj
    ]

    # Prepare COLOR_0 attribute on every mesh (preserving any existing painted COLOR_0 RGB)
    orig_vertex_colors: dict[str, list[tuple[float, float, float]]] = {}
    for obj in mesh_objs:
        mesh = obj.data
        if not mesh.materials:
            m = bpy.data.materials.new("DefaultBakeMat")
            mesh.materials.append(m)
        existing_ca = mesh.color_attributes.get("COLOR_0")
        if existing_ca is None and len(mesh.color_attributes) > 0:
            existing_ca = mesh.color_attributes[0]
        if existing_ca is not None:
            if existing_ca.domain == "POINT":
                orig_vertex_colors[obj.name] = [
                    (
                        existing_ca.data[i].color[0],
                        existing_ca.data[i].color[1],
                        existing_ca.data[i].color[2],
                    )
                    for i in range(len(mesh.vertices))
                ]
            elif existing_ca.domain == "CORNER":
                v_cols: list[tuple[float, float, float]] = [(1.0, 1.0, 1.0)] * len(mesh.vertices)
                for loop_idx, loop in enumerate(mesh.loops):
                    c = existing_ca.data[loop_idx].color
                    v_cols[loop.vertex_index] = (c[0], c[1], c[2])
                orig_vertex_colors[obj.name] = v_cols
        while len(mesh.color_attributes) > 0:
            mesh.color_attributes.remove(mesh.color_attributes[0])
        ca = mesh.color_attributes.new(name="COLOR_0", type="BYTE_COLOR", domain="POINT")
        mesh.color_attributes.active_color = ca
        mesh.color_attributes.active_color_index = 0
        mesh.color_attributes.render_color_index = 0

    # Select all target meshes and bake Cycles OptiX AO into COLOR_0
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objs:
        obj.select_set(True)
    if mesh_objs:
        bpy.context.view_layer.objects.active = mesh_objs[0]
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")

    # Blend baked Cycles AO with vertical sky-to-ground gradient per root asset
    for root_obj in roots:
        descendants = [root_obj] if root_obj.type == "MESH" else []
        queue = list(root_obj.children)
        while queue:
            cur = queue.pop(0)
            if cur.type == "MESH":
                descendants.append(cur)
            queue.extend(cur.children)

        if not descendants:
            continue

        # Compute world Z bounds of this asset (in Blender, Z is up)
        z_min = float("inf")
        z_max = float("-inf")
        for m_obj in descendants:
            mw = m_obj.matrix_world
            for v in m_obj.data.vertices:
                wz = (mw @ v.co).z
                if wz < z_min:
                    z_min = wz
                if wz > z_max:
                    z_max = wz
        span = max(0.25, z_max - z_min)

        for m_obj in descendants:
            mesh = m_obj.data
            mw = m_obj.matrix_world
            ca = mesh.color_attributes.get("COLOR_0")
            if ca is None:
                continue
            saved_vc = orig_vertex_colors.get(m_obj.name)
            for v_idx, vert in enumerate(mesh.vertices):
                wz = (mw @ vert.co).z
                h = max(0.0, min(1.0, (wz - z_min) / span))
                # Smoothstep height gradient (quantized to 32 levels for high meshopt compression)
                h_smooth = round(h * h * (3.0 - 2.0 * h) * 32.0) / 32.0
                ao_raw = ca.data[v_idx].color[0]
                if ao_raw <= 0.001:
                    ao_raw = 0.85
                ao_q = round(max(0.0, min(1.0, ao_raw)) * 16.0) / 16.0
                ao_term = 0.72 + 0.28 * ao_q
                grad_term = 0.78 + 0.22 * h_smooth
                shade = max(0.56, min(1.0, ao_term * grad_term))
                base_r, base_g, base_b = saved_vc[v_idx] if saved_vc else (1.0, 1.0, 1.0)
                r_val = min(1.0, base_r * shade * (0.97 + 0.03 * h_smooth))
                g_val = min(1.0, base_g * shade)
                b_val = min(1.0, base_b * shade * (0.95 + 0.05 * h_smooth))
                if saved_vc:
                    # Clamp sRGB lightness of pre-colored vertex attributes strictly into [0.125, 0.895]
                    srgb_tuple = (
                        int(round(recolor.linear_to_srgb(r_val) * 255)),
                        int(round(recolor.linear_to_srgb(g_val) * 255)),
                        int(round(recolor.linear_to_srgb(b_val) * 255)),
                    )
                    cr, cg, cb = recolor.clamp_lightness(srgb_tuple, 0.125, 0.895)
                    r_val = recolor.srgb_to_linear(cr)
                    g_val = recolor.srgb_to_linear(cg)
                    b_val = recolor.srgb_to_linear(cb)
                ca.data[v_idx].color = (r_val, g_val, b_val, 1.0)

    # Remove ground plane and restore original root positions
    bpy.data.objects.remove(ground_obj, do_unlink=True)
    for root_obj in roots:
        if root_obj.name in saved_locations:
            root_obj.location = saved_locations[root_obj.name]
    bpy.context.view_layer.update()

    # Wire a Vertex Color node ('COLOR_0') into every material's node tree so Blender 5.2's
    # glTF 2.0 exporter includes COLOR_0 on every primitive without warnings.
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        vc_node = next((n for n in nodes if n.type == "VERTEX_COLOR"), None)
        if not vc_node:
            vc_node = nodes.new(type="ShaderNodeVertexColor")
            vc_node.layer_name = "COLOR_0"
        base_input = bsdf.inputs.get("Base Color")
        if base_input:
            if base_input.is_linked:
                orig_socket = base_input.links[0].from_socket
                mix_node = nodes.new(type="ShaderNodeMix")
                mix_node.data_type = "RGBA"
                mix_node.blend_type = "MULTIPLY"
                mix_node.inputs["Factor"].default_value = 1.0
                links.new(orig_socket, mix_node.inputs[6])
                links.new(vc_node.outputs["Color"], mix_node.inputs[7])
                links.new(mix_node.outputs[2], base_input)
            else:
                links.new(vc_node.outputs["Color"], base_input)

    with tempfile.TemporaryDirectory() as tmp:
        exported_glb = Path(tmp) / "baked-export.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(exported_glb),
            export_format="GLB",
            export_yup=True,
            export_apply=False,
            export_texcoords=True,
            export_normals=True,
            export_tangents=False,
            export_materials="EXPORT",
            export_all_vertex_colors=True,
            export_active_vertex_color_when_no_material=True,
        )
        restore_glb_images_and_clean(exported_glb, orig_by_name, orig_ordered, orig_samplers)
        subprocess.run(
            [
                "pnpm",
                "dlx",
                "gltfpack@1.3.0",
                "-i",
                str(exported_glb),
                "-o",
                str(out_glb),
                "-cc",
                "-kn",
                "-vtf",
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    post_bytes = out_glb.read_bytes()
    post_raw = len(post_bytes)
    post_gz = len(gzip.compress(post_bytes, compresslevel=9))
    return {
        "file": out_glb.name,
        "gpu": gpu_name,
        "preRawBytes": pre_raw,
        "postRawBytes": post_raw,
        "deltaRawBytes": post_raw - pre_raw,
        "preGzipBytes": pre_gz,
        "postGzipBytes": post_gz,
        "deltaGzipBytes": post_gz - pre_gz,
    }


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    cmap = recolor.load_color_map()
    deltas = []

    if len(argv) >= 2 and not argv[0].startswith("--"):
        in_p = Path(argv[0]).resolve()
        out_p = Path(argv[1]).resolve()
        deltas.append(bake_static_glb(in_p, out_p))
    else:
        custom_only = "--custom-only" in argv
        if not custom_only:
            for static_name in ("kit-flora.glb", "kit-props.glb"):
                target = MODELS_DIR / static_name
                if target.exists():
                    deltas.append(bake_static_glb(target, target))

        # Ingest any custom raw GLBs in CUSTOM_RAW_DIR -> game/src/assets/models/custom-*.glb
        if CUSTOM_RAW_DIR.exists():
            for custom_in in sorted(CUSTOM_RAW_DIR.glob("*.glb")):
                stem = custom_in.stem
                out_name = f"{stem}.glb" if stem.startswith("custom-") else f"custom-{stem}.glb"
                out_target = MODELS_DIR / out_name
                with tempfile.TemporaryDirectory() as tmp:
                    recolored = Path(tmp) / out_name
                    recolor.recolor_custom_glb(custom_in, recolored, cmap)
                    deltas.append(bake_static_glb(recolored, out_target))

    DELTA_REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, dict] = {}
    if DELTA_REPORT_PATH.exists():
        try:
            for item in json.loads(DELTA_REPORT_PATH.read_text(encoding="utf-8")):
                existing[item["file"]] = item
        except Exception:
            pass
    for d in deltas:
        existing[d["file"]] = d
    DELTA_REPORT_PATH.write_text(
        json.dumps(list(existing.values()), indent=2), encoding="utf-8"
    )
    for d in deltas:
        print(
            f"[bake.py] {d['file']}: raw {d['preRawBytes']}B -> {d['postRawBytes']}B "
            f"(delta {d['deltaRawBytes']:+d}B), gz {d['preGzipBytes']}B -> {d['postGzipBytes']}B "
            f"(delta {d['deltaGzipBytes']:+d}B) on {d['gpu']}"
        )


if __name__ == "__main__":
    main()
