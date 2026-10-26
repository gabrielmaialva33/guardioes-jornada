#!/usr/bin/env python3
"""
build_foliage_atlas.py — Build the shared 512x512 painted foliage & bark atlas
(`game/src/assets/skins/foliage-atlas.png`) from the CC0 FabinhoSC, DevEarley, and
Drummyfish textures in `~/.cache/agents/2026-10-25-trilha-secreta/downloads-v2/`,
recoloured into the exact `game/ART.md` ramps.

Layout: 4x4 grid of 128x128 tiles (512x512 PNG):
  glTF UV tile (col, row) where col in 0..3, row in 0..3 (row=3 is top row y=0..127):
    Row 3 (glTF v = 0.75..1.00):
      (0, 3): Ipê-amarelo painted blossom/leaf cluster (FabinhoSC toonsimplesleafintenseyellow)
      (1, 3): Pau-brasil / Canopy painted green leaf cluster (FabinhoSC toonsimplesleafs)
      (2, 3): Ipê-rosa painted blossom cluster (FabinhoSC toonsimplesbasicbranchexoticcontrastpink)
      (3, 3): Jequitibá-rosa / Emergent canopy medallion (FabinhoSC kapoktoonleavesmatured)
    Row 2 (glTF v = 0.50..0.75):
      (0, 2): Palmeira-juçara & Jerivá painted palm frond (FabinhoSC tropicaleliconialeaf)
      (1, 2): Mangue-vermelho glossy canopy cluster (FabinhoSC toonsimplesbasicbranchjungle)
      (2, 2): Sunlit canopy rosette medallion (FabinhoSC kapoktoonleaves)
      (3, 2): Broadleaf fringe leaf card (FabinhoSC younglargueleaf)
    Row 1 (glTF v = 0.25..0.50):
      (0, 1): Samambaia & Xaxim painted fern frond (FabinhoSC bigfernleaf)
      (1, 1): Bromélia & Helicônia channelled leaf blade (FabinhoSC bigtropicalleaf)
      (2, 1): Bromélia-centro-vermelho crimson bract (FabinhoSC lowpolysimlpeleaf)
      (3, 1): Serapilheira hand-painted leaf litter (DevEarley Grass-W-Mud + Drummyfish rainforest_litter)
    Row 0 (glTF v = 0.00..0.25):
      (0, 0): Warm brown furrowed bark (DevEarley BaoBabBark + Drummyfish default_tree, wood[0..2])
      (1, 0): Reddish-brown flaking Pau-brasil / Mangrove bark (DevEarley jungle-wood-with-bark-exposed)
      (2, 0): Ringed grey palm & Embaúba stipe (DevEarley palmtrunk, rock[0..3])
      (3, 0): Fibrous dark Xaxim caudex + green Juçara palmito shaft + purple/gold fruit bands
"""

from __future__ import annotations

import colorsys
import subprocess
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
GAME_ROOT = SCRIPT_DIR.parent.parent
SKINS_DIR = GAME_ROOT / "src" / "assets" / "skins"
OUT_ATLAS = SKINS_DIR / "foliage-atlas.png"

DL_DIR = Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta" / "downloads-v2"
FAB_SIMPLE = DL_DIR / "fabinhosc-simple-plant-textures"
FAB_TREETOPS = DL_DIR / "fabinhosc-shrubs-treetops"
DRUMMY_DIR = DL_DIR / "drummyfish-handpainted" / "extracted"
DEVEARLEY_DIR = DL_DIR / "devearley-jungle" / "extracted" / "plants-grass-wood"


def hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


def clamp_rgb_byte(r: float, g: float, b: float) -> tuple[int, int, int]:
    r = max(0.0, min(1.0, r))
    g = max(0.0, min(1.0, g))
    b = max(0.0, min(1.0, b))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    s = min(0.78, s)
    l = max(0.14, min(0.86, l))
    cr, cg, cb = colorsys.hls_to_rgb(h, l, s)
    return (int(round(cr * 255)), int(round(cg * 255)), int(round(cb * 255)))


def lerp_rgb(c0: tuple[float, float, float], c1: tuple[float, float, float], t: float) -> tuple[float, float, float]:
    t = max(0.0, min(1.0, t))
    return (c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t)


def ramp4(stops: list[str], t: float) -> tuple[int, int, int]:
    rgb_stops = [hex_rgb(s) for s in stops]
    t = max(0.0, min(1.0, t)) * (len(rgb_stops) - 1)
    idx = min(len(rgb_stops) - 2, int(t))
    frac = t - idx
    r, g, b = lerp_rgb(rgb_stops[idx], rgb_stops[idx + 1], frac)
    return clamp_rgb_byte(r, g, b)


def load_rgba(path: Path, w: int = 128, h: int = 128, crop: str | None = None) -> bytearray:
    cmd = ["magick", str(path)]
    if crop:
        cmd.extend(["-crop", crop, "+repage"])
    cmd.extend(["-resize", f"{w}x{h}!", "-depth", "8", "rgba:-"])
    return bytearray(subprocess.check_output(cmd))


def recolor_tile(
    rgba: bytearray,
    stops: list[str],
    *,
    bg_hex: str | None = None,
    contrast: float = 1.25,
) -> bytearray:
    """Recolour a 128x128 tile into `stops` with an opaque in-ramp background so low-tier
    opaque polygons never show black/white halos or alpha test artifacts (ART.md §5)."""
    out = bytearray(len(rgba))
    bg_rgb = clamp_rgb_byte(*hex_rgb(bg_hex or stops[0]))
    lums = []
    for i in range(0, len(rgba), 4):
        if rgba[i + 3] > 24:
            lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255.0
            lums.append(lum)
    lo = min(lums) if lums else 0.0
    hi = max(lums) if lums else 1.0
    span = max(0.08, hi - lo)

    for i in range(0, len(rgba), 4):
        a = rgba[i + 3] / 255.0
        lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255.0
        t = (lum - lo) / span
        t = 0.5 + (t - 0.5) * contrast
        r, g, b = ramp4(stops, t)
        if a < 0.08:
            out[i : i + 4] = bytes((*bg_rgb, 255))
        else:
            mr = int(round(bg_rgb[0] * (1.0 - a) + r * a))
            mg = int(round(bg_rgb[1] * (1.0 - a) + g * a))
            mb = int(round(bg_rgb[2] * (1.0 - a) + b * a))
            out[i : i + 4] = bytes((*clamp_rgb_byte(mr / 255.0, mg / 255.0, mb / 255.0), 255))
    return out


def blit_tile(atlas: bytearray, tile: bytearray, col: int, row: int) -> None:
    img_y0 = (3 - row) * 128
    img_x0 = col * 128
    for y in range(128):
        src_off = y * 128 * 4
        dst_off = ((img_y0 + y) * 512 + img_x0) * 4
        atlas[dst_off : dst_off + 128 * 4] = tile[src_off : src_off + 128 * 4]


def main() -> None:
    atlas = bytearray(512 * 512 * 4)
    LEAF_RAMP = ["#1e4d36", "#2f6b47", "#489460", "#76c879"]
    GRASS_RAMP = ["#265437", "#3f7d4f", "#63ab66", "#93d678"]
    WOOD_RAMP = ["#4a3423", "#6e4e35", "#966c4a", "#c29368"]
    ROCK_RAMP = ["#4f5c55", "#6e7d74", "#8e9b92", "#b8c4bc"]
    SOIL_RAMP = ["#473325", "#694c37", "#8f6a4d", "#b58b67"]
    IPE_AMARELO_RAMP = ["#8c681e", "#bf9028", "#e8b93a", "#f5d461"]
    IPE_ROSA_RAMP = ["#7a304c", "#ad466c", "#de6890", "#f29cb8"]
    BROMELIA_RED_RAMP = ["#6b2220", "#9e332e", "#cc4438", "#e66b56"]
    PAU_BRASIL_BARK = ["#422c1e", "#6e4730", "#9c5c38", "#bf7a4d"]

    # Row 3 (glTF v = 0.75..1.00)
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_TREETOPS / "toonsimplesleafintenseyellow.png", crop="660x660+180+180"),
            IPE_AMARELO_RAMP,
            bg_hex=IPE_AMARELO_RAMP[1],
            contrast=1.35,
        ),
        0,
        3,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_TREETOPS / "toonsimplesleafs.png", crop="660x660+180+180"),
            LEAF_RAMP,
            bg_hex=LEAF_RAMP[0],
            contrast=1.30,
        ),
        1,
        3,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_TREETOPS / "toonsimplesbasicbranchexoticcontrastpink.png", crop="760x760+132+132"),
            IPE_ROSA_RAMP,
            bg_hex=IPE_ROSA_RAMP[1],
            contrast=1.40,
        ),
        2,
        3,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_TREETOPS / "kapoktoonleavesmatured.png", crop="760x760+132+132"),
            LEAF_RAMP,
            bg_hex=LEAF_RAMP[0],
            contrast=1.30,
        ),
        3,
        3,
    )

    # Row 2 (glTF v = 0.50..0.75)
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_SIMPLE / "tropicaleliconialeaf.png"),
            LEAF_RAMP,
            bg_hex=LEAF_RAMP[1],
            contrast=1.30,
        ),
        0,
        2,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_TREETOPS / "toonsimplesbasicbranchjungle.png", crop="760x760+132+132"),
            LEAF_RAMP,
            bg_hex=LEAF_RAMP[0],
            contrast=1.30,
        ),
        1,
        2,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_TREETOPS / "kapoktoonleaves.png", crop="760x760+132+132"),
            GRASS_RAMP,
            bg_hex=LEAF_RAMP[0],
            contrast=1.30,
        ),
        2,
        2,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_SIMPLE / "younglargueleaf.png"),
            GRASS_RAMP,
            bg_hex=LEAF_RAMP[1],
            contrast=1.30,
        ),
        3,
        2,
    )

    # Row 1 (glTF v = 0.25..0.50)
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_SIMPLE / "bigfernleaf.png"),
            GRASS_RAMP,
            bg_hex=LEAF_RAMP[0],
            contrast=1.35,
        ),
        0,
        1,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_SIMPLE / "bigtropicalleaf.png"),
            GRASS_RAMP,
            bg_hex=LEAF_RAMP[1],
            contrast=1.25,
        ),
        1,
        1,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(FAB_SIMPLE / "lowpolysimlpeleaf.png"),
            BROMELIA_RED_RAMP,
            bg_hex=BROMELIA_RED_RAMP[1],
            contrast=1.25,
        ),
        2,
        1,
    )

    litter_raw = load_rgba(DEVEARLEY_DIR / "Grass-W-Mud.png")
    litter_tile = recolor_tile(litter_raw, SOIL_RAMP, bg_hex=SOIL_RAMP[1], contrast=1.35)
    rain_raw = load_rgba(DRUMMY_DIR / "default_rainforest_litter.png")
    for i in range(0, len(litter_tile), 4):
        rlum = (0.299 * rain_raw[i] + 0.587 * rain_raw[i + 1] + 0.114 * rain_raw[i + 2]) / 255.0
        if rlum > 0.45:
            c = ramp4(LEAF_RAMP, (rlum - 0.45) * 2.2)
            litter_tile[i] = int(round(litter_tile[i] * 0.45 + c[0] * 0.55))
            litter_tile[i + 1] = int(round(litter_tile[i + 1] * 0.45 + c[1] * 0.55))
            litter_tile[i + 2] = int(round(litter_tile[i + 2] * 0.45 + c[2] * 0.55))
    blit_tile(atlas, litter_tile, 3, 1)

    # Row 0 (glTF v = 0.00..0.25)
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(DEVEARLEY_DIR / "BaoBabBark.png"),
            WOOD_RAMP,
            bg_hex=WOOD_RAMP[1],
            contrast=1.35,
        ),
        0,
        0,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(DEVEARLEY_DIR / "jungle-wood-with-bark-exposed.png"),
            PAU_BRASIL_BARK,
            bg_hex=PAU_BRASIL_BARK[1],
            contrast=1.35,
        ),
        1,
        0,
    )
    blit_tile(
        atlas,
        recolor_tile(
            load_rgba(DEVEARLEY_DIR / "palmtrunk.png"),
            ROCK_RAMP,
            bg_hex=ROCK_RAMP[1],
            contrast=1.35,
        ),
        2,
        0,
    )

    xaxim_raw = load_rgba(DEVEARLEY_DIR / "at_wood.png")
    tile30 = recolor_tile(xaxim_raw, SOIL_RAMP[:3] + [WOOD_RAMP[1]], bg_hex=SOIL_RAMP[0], contrast=1.35)
    for y in range(64):
        for x in range(128):
            i = (y * 128 + x) * 4
            if y < 24:
                col_r = ramp4(["#382040", "#45274f", "#643a72"], x / 63.0) if x < 64 else ramp4(IPE_AMARELO_RAMP, (x - 64) / 63.0)
                tile30[i : i + 4] = bytes((*col_r, 255))
            else:
                t = 0.35 + 0.45 * ((y - 24) / 40.0)
                col_r = ramp4(GRASS_RAMP, t)
                tile30[i : i + 4] = bytes((*col_r, 255))
    blit_tile(atlas, tile30, 3, 0)

    with tempfile.TemporaryDirectory() as tmp_s:
        raw_path = Path(tmp_s) / "atlas.rgba"
        raw_path.write_bytes(bytes(atlas))
        subprocess.run(
            [
                "magick",
                "-size",
                "512x512",
                "-depth",
                "8",
                f"rgba:{raw_path}",
                "-dither",
                "None",
                "-colors",
                "256",
                "-strip",
                "-define",
                "png:compression-level=9",
                f"PNG8:{OUT_ATLAS}",
            ],
            check=True,
        )
    print(f"[build_foliage_atlas.py] Wrote {OUT_ATLAS} ({OUT_ATLAS.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
