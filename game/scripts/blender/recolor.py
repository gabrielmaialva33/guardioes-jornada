#!/usr/bin/env python3
"""
recolor.py — CIE Lab colour remapper and lightness-bounds enforcer for Secret Trail.

Can run either standalone (`python3 game/scripts/blender/recolor.py`) or inside
headless Blender 5.2 (`blender --background --python game/scripts/blender/recolor.py`).

Responsibilities:
1. Loads `game/scripts/blender/color-map.json` (which mirrors `game/src/style/palette.ts`).
2. Remaps Kenney static kit palettes (Platformer Kit 4.1, Food Kit 2.0, Holiday Kit 2.0)
   to the explicit reviewed ART ramp swatches, and maps any remaining texels to the
   nearest ART ramp colour in CIE Lab (D65).
3. Enforces HSL lightness bounds (`0.12 <= L <= 0.90`) on all species palettes
   (`game/src/assets/skins/palette-*.png`) and downscales/clamps the 18 avatar skins
   (`game/src/assets/skins/skin-{a..r}.webp`) to 128x128 lossless WebP per ART.md §6.
4. Remaps material baseColorFactors in any custom GLBs found in
   `~/.cache/agents/2026-10-25-trilha-secreta/custom-raw/*.glb` to the nearest ART ramp
   colour in CIE Lab.
"""

from __future__ import annotations

import colorsys
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
GAME_ROOT = SCRIPT_DIR.parent.parent
COLOR_MAP_PATH = SCRIPT_DIR / "color-map.json"
SKINS_DIR = GAME_ROOT / "src" / "assets" / "skins"
RAW_ROOT = Path(
    os.environ.get(
        "KENNEY_RAW_DIR",
        str(Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta" / "kenney-raw"),
    )
)
CUSTOM_RAW_DIR = Path(
    os.environ.get(
        "CUSTOM_RAW_DIR",
        str(Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta" / "custom-raw"),
    )
)


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    v = int(hex_str.lstrip("#"), 16)
    return ((v >> 16) & 255, (v >> 8) & 255, v & 255)


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"


def srgb_to_linear(c: float) -> float:
    u = c / 255.0
    return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4


def linear_to_srgb(u: float) -> float:
    u = max(0.0, min(1.0, u))
    return u * 12.92 if u <= 0.0031308 else 1.055 * (u ** (1.0 / 2.4)) - 0.055


def rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    r = srgb_to_linear(rgb[0])
    g = srgb_to_linear(rgb[1])
    b = srgb_to_linear(rgb[2])
    # sRGB to XYZ (D65)
    x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047
    y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) / 1.00000
    z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883

    def f(t: float) -> float:
        return t ** (1.0 / 3.0) if t > 0.008856 else (7.787 * t) + (16.0 / 116.0)

    fx, fy, fz = f(x), f(y), f(z)
    return (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))


def delta_e_lab(lab1: tuple[float, float, float], lab2: tuple[float, float, float]) -> float:
    return math.sqrt(
        (lab1[0] - lab2[0]) ** 2 + (lab1[1] - lab2[1]) ** 2 + (lab1[2] - lab2[2]) ** 2
    )


def rgb_to_hsl(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    # colorsys uses HLS (Hue, Lightness, Saturation)
    h, l, s = colorsys.rgb_to_hls(rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0)
    return (h, s, l)


def clamp_lightness(
    rgb: tuple[int, int, int], l_min: float = 0.125, l_max: float = 0.895
) -> tuple[int, int, int]:
    h, l, s = colorsys.rgb_to_hls(rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0)
    if l < l_min or l > l_max:
        l_clamped = max(l_min, min(l_max, l))
        # Preserve mild saturation when lifting pure black
        if s < 0.05 and l < l_min:
            h, s = 0.42, 0.18
        r, g, b = colorsys.hls_to_rgb(h, l_clamped, min(0.85, s))
        return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))
    return rgb


def encode_png8(width: int, height: int, rgba: bytes | bytearray) -> bytes:
    """Deterministic indexed PNG-8 (or RGB PNG) encoder."""
    palette: list[tuple[int, int, int]] = []
    color_idx: dict[tuple[int, int, int], int] = {}
    for i in range(width * height):
        rgb = (rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
        if rgb not in color_idx:
            color_idx[rgb] = len(palette)
            palette.append(rgb)

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    if len(palette) <= 256:
        ihdr = struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0)
        plte = b"".join( bytes(c) for c in palette )
        rows = bytearray()
        for y in range(height):
            rows.append(0)
            for x in range(width):
                p = (y * width + x) * 4
                rows.append(color_idx[(rgba[p], rgba[p + 1], rgba[p + 2])])
        idat = zlib.compress(bytes(rows), 9)
        return sig + chunk(b"IHDR", ihdr) + chunk(b"PLTE", plte) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            p = (y * width + x) * 4
            rows.extend(rgba[p : p + 3])
    idat = zlib.compress(bytes(rows), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def load_color_map() -> dict:
    with open(COLOR_MAP_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def build_ramp_lookup(cmap: dict, include_accent: bool = False) -> list[dict]:
    entries = []
    for ramp_name, hex_list in cmap["ramps"].items():
        for idx, hx in enumerate(hex_list):
            rgb = hex_to_rgb(hx)
            entries.append(
                {
                    "key": f"{ramp_name}[{idx}]",
                    "ramp": ramp_name,
                    "hex": hx,
                    "rgb": rgb,
                    "lab": rgb_to_lab(rgb),
                }
            )
    if include_accent:
        for acc_name, hx in cmap["accent"].items():
            rgb = hex_to_rgb(hx)
            entries.append(
                {
                    "key": f"accent.{acc_name}",
                    "ramp": "accent",
                    "hex": hx,
                    "rgb": rgb,
                    "lab": rgb_to_lab(rgb),
                }
            )
    return entries


def find_nearest_ramp(rgb: tuple[int, int, int], entries: list[dict]) -> dict:
    lab = rgb_to_lab(rgb)
    best = entries[0]
    best_d = float("inf")
    for e in entries:
        d = delta_e_lab(lab, e["lab"])
        if d < best_d:
            best_d = d
            best = e
    return {**best, "distance": round(best_d, 2)}


def build_recolored_kit_palette(pack_name: str, src_png: Path, cmap: dict) -> bytes:
    """
    Build a 64x64 NEAREST PNG-8 for a static Kenney kit (`platformer-kit`, `food-kit`, `holiday-kit`)
    where every used swatch is mapped via the reviewed 4-step ramp table in `color-map.json`
    and every remaining pixel is mapped to the nearest CIE Lab colour in `RAMPS`.
    """
    raw_rgba = bytearray(
        subprocess.check_output(
            ["magick", str(src_png), "-filter", "point", "-resize", "64x64", "-depth", "8", "rgba:-"]
        )
    )
    entries = build_ramp_lookup(cmap, include_accent=False)
    swatch_overrides = cmap.get("kitPropsSwatches", {}).get(pack_name, {})

    # First remap every pixel in the 64x64 texture to its nearest CIE Lab ramp colour
    for i in range(64 * 64):
        rgb = (raw_rgba[i * 4], raw_rgba[i * 4 + 1], raw_rgba[i * 4 + 2])
        if rgb == (0, 0, 0):
            # Replace pure black padding with darkest leaf shadow #1e4d36
            nr = hex_to_rgb(cmap["ramps"]["leaf"][0])
        else:
            nr = find_nearest_ramp(rgb, entries)["rgb"]
        raw_rgba[i * 4 : i * 4 + 3] = bytes(nr)
        raw_rgba[i * 4 + 3] = 255

    # Then paint the reviewed 4-step vertical ramp swatches for this kit
    for key_str, spec in swatch_overrides.items():
        col_str, band_str = key_str.strip("()").split(",")
        col, band = int(col_str), int(band_str)
        target_hexes = spec["targetHexes"]  # 4 steps from top (light) to bottom (shadow)
        x0, y0 = col * 8, band * 16
        for r in range(16):
            step_idx = min(3, r // 4)
            rgb = hex_to_rgb(target_hexes[step_idx])
            for dx in range(8):
                p = ((y0 + r) * 64 + (x0 + dx)) * 4
                raw_rgba[p : p + 3] = bytes(rgb)
                raw_rgba[p + 3] = 255

    return encode_png8(64, 64, raw_rgba)


def enforce_species_and_skin_bounds(cmap: dict) -> None:
    """
    Ensure every species palette (`palette-*.png`) and every player skin (`skin-{a..r}.webp`)
    stays within `LIGHTNESS` bounds (`0.12 <= L <= 0.90`) and `skin-*.webp` is 128x128 per ART.md §6.
    """
    l_min = cmap["bounds"]["lightness"]["min"] + 0.005
    l_max = cmap["bounds"]["lightness"]["max"] - 0.005
    bg_rgb = hex_to_rgb(cmap["ramps"]["leaf"][0])  # #1e4d36 (L = 0.21)

    if SKINS_DIR.exists():
        for png_path in sorted(SKINS_DIR.glob("palette-*.png")):
            rgba = bytearray(
                subprocess.check_output(["magick", str(png_path), "-depth", "8", "rgba:-"])
            )
            w_h = subprocess.check_output(
                ["magick", "identify", "-format", "%w %h", str(png_path)], text=True
            ).split()
            w, h = int(w_h[0]), int(w_h[1])
            for i in range(w * h):
                rgb = (rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
                if rgb == (0, 0, 0):
                    clamped = bg_rgb
                else:
                    clamped = clamp_lightness(rgb, l_min, l_max)
                rgba[i * 4 : i * 4 + 3] = bytes(clamped)
                rgba[i * 4 + 3] = 255
            png_path.write_bytes(encode_png8(w, h, rgba))

    blocky_tex_dir = RAW_ROOT / "blocky-characters" / "Models" / "GLB format" / "Textures"
    if blocky_tex_dir.exists() and SKINS_DIR.exists():
        with tempfile.TemporaryDirectory() as tmp:
            for code in range(ord("a"), ord("r") + 1):
                letter = chr(code)
                src_png = blocky_tex_dir / f"texture-{letter}.png"
                if not src_png.exists():
                    continue
                rgba = bytearray(
                    subprocess.check_output(
                        [
                            "magick",
                            str(src_png),
                            "-filter",
                            "point",
                            "-resize",
                            "128x128",
                            "-depth",
                            "8",
                            "rgba:-",
                        ]
                    )
                )
                for i in range(128 * 128):
                    rgb = (rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
                    clamped = clamp_lightness(rgb, l_min, l_max)
                    rgba[i * 4 : i * 4 + 3] = bytes(clamped)
                    rgba[i * 4 + 3] = 255
                tmp_png = Path(tmp) / f"skin-{letter}.png"
                tmp_png.write_bytes(encode_png8(128, 128, rgba))
                dst_webp = SKINS_DIR / f"skin-{letter}.webp"
                subprocess.run(
                    ["magick", str(tmp_png), "-strip", "-define", "webp:lossless=true", str(dst_webp)],
                    check=True,
                )


def recolor_custom_glb(glb_path: Path, out_path: Path, cmap: dict) -> list[dict]:
    """
    Remap material baseColorFactors in a custom GLB to the nearest CIE Lab ART ramp colour,
    unless the mesh already uses painted vertex colours (`COLOR_0`) with a neutral white material.
    """
    buf = glb_path.read_bytes()
    j_len = struct.unpack_from("<I", buf, 12)[0]
    j_obj = json.loads(buf[20 : 20 + j_len].decode("utf-8"))
    bin_chunk = bytearray(buf[28 + j_len :] if len(buf) > 20 + j_len else b"")

    has_vertex_colors = any(
        "COLOR_0" in prim.get("attributes", {})
        for mesh in j_obj.get("meshes", [])
        for prim in mesh.get("primitives", [])
    )

    entries = build_ramp_lookup(cmap, include_accent=True)
    if any("foliage-atlas" in (im.get("name") or "") for im in j_obj.get("images", [])):
        j_obj["images"] = [{"name": "foliage-atlas", "uri": "../skins/foliage-atlas.png"}]
    report = []
    for mat in j_obj.get("materials", []):
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        factor = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
        if has_vertex_colors and factor[0] > 0.98 and factor[1] > 0.98 and factor[2] > 0.98:
            pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 1.0
            continue
        srgb = (
            int(round(linear_to_srgb(factor[0]) * 255)),
            int(round(linear_to_srgb(factor[1]) * 255)),
            int(round(linear_to_srgb(factor[2]) * 255)),
        )
        nearest = find_nearest_ramp(srgb, entries)
        trgb = nearest["rgb"]
        pbr["baseColorFactor"] = [
            round(srgb_to_linear(trgb[0]), 6),
            round(srgb_to_linear(trgb[1]), 6),
            round(srgb_to_linear(trgb[2]), 6),
            factor[3] if len(factor) > 3 else 1.0,
        ]
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 1.0
        report.append(
            {
                "material": mat.get("name", "unnamed"),
                "sourceHex": rgb_to_hex(srgb),
                "targetRamp": nearest["key"],
                "targetHex": nearest["hex"],
                "deltaELab": nearest["distance"],
            }
        )

    j_bytes = json.dumps(j_obj, separators=(",", ":")).encode("utf-8")
    j_pad = (4 - (len(j_bytes) % 4)) % 4
    j_bytes += b" " * j_pad
    b_pad = (4 - (len(bin_chunk) % 4)) % 4
    bin_padded = bin_chunk + (b"\x00" * b_pad)
    total_len = 12 + 8 + len(j_bytes) + (8 + len(bin_padded) if bin_padded else 0)
    out = bytearray()
    out.extend(struct.pack("<III", 0x46546C67, 2, total_len))
    out.extend(struct.pack("<II", len(j_bytes), 0x4E4F534A))
    out.extend(j_bytes)
    if bin_padded:
        out.extend(struct.pack("<II", len(bin_padded), 0x004E4942))
        out.extend(bin_padded)
    out_path.write_bytes(bytes(out))
    return report


def main() -> None:
    cmap = load_color_map()
    enforce_species_and_skin_bounds(cmap)
    print(f"[recolor.py] Enforced ART.md lightness bounds on species palettes and 128x128 skins in {SKINS_DIR}")


if __name__ == "__main__":
    main()
