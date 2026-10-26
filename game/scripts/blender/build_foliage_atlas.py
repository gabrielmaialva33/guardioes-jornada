#!/usr/bin/env python3
"""
build_foliage_atlas.py — Build the shared 512x512 painted foliage & bark atlas
(`game/src/assets/skins/foliage-atlas.png`) for Art Direction v2 (ART.md §§5-6).

Combines and recolours into the ART.md ramps:
  - CC BY Sketchfab tree textures in ~/.cache/agents/2026-10-25-trilha-secreta/downloads-v2/arvores/
    (ginkgo-outono, ginkgo-verao, arvore-rosa, pacote-copa-camadas, palmeiras-psx, mangue-a, mangue-alto)
  - CC0 FabinhoSC plant/canopy textures in ~/.cache/agents/2026-10-25-trilha-secreta/downloads-v2/
    (kapoktoonleaves, toonsimplesbasicbranch, younglargueleaf, bigfernleaf, tropicaleliconialeaf, lowpolysimlpeleaf)
  - CC0 Drummyfish & DevEarley bark / leaf-litter textures.

Layout: 4x4 grid of 128x128 tiles (512x512 RGBA PNG).
  glTF UV tile (col, row) where col in 0..3 (left to right), row in 0..3 (bottom to top in glTF v,
  so image y goes from (3 - row) * 128 to (4 - row) * 128):
    Row 3 (glTF v = 0.75..1.00, image top row y = 0..128):
      (0, 3): Ipê-amarelo painted leaf/blossom card (from ginkgo-outono, alpha)
      (1, 3): Pau-brasil painted green leaf card (from ginkgo-verao, alpha)
      (2, 3): Ipê-rosa painted blossom cluster card (from arvore-rosa, alpha)
      (3, 3): Jequitibá-rosa layered leaf branch card (from pacote-copa-camadas, alpha)
    Row 2 (glTF v = 0.50..0.75, image row y = 128..256):
      (0, 2): Palmeira-juçara / Jerivá painted pinnate palm frond (from palmeiras-psx, alpha)
      (1, 2): Mangue-vermelho painted glossy leaf cluster (from mangue-alto + mangue-a, alpha)
      (2, 2): Opaque painted canopy medallion (from FabinhoSC kapoktoonleaves + toonsimplesbasicbranch)
      (3, 2): Painted broadleaf cluster card (from FabinhoSC younglargueleaf + toonsimplesleafs, alpha)
    Row 1 (glTF v = 0.25..0.50, image row y = 256..384):
      (0, 1): Painted fern frond (from FabinhoSC bigfernleaf, alpha + opaque core for xaxim & samambaia)
      (1, 1): Painted channelled bromeliad / helicônia blade (from FabinhoSC tropicaleliconialeaf, opaque)
      (2, 1): Painted crimson bromeliad / wildflower bract (from FabinhoSC lowpolysimlpeleaf, opaque)
      (3, 1): Painted forest-floor leaf litter / serapilheira (from Drummyfish + DevEarley + fallen petals, opaque)
    Row 0 (glTF v = 0.00..0.25, image bottom row y = 384..512):
      (0, 0): Painted warm brown furrowed bark (wood[0..2], opaque)
      (1, 0): Painted reddish-brown flaking Pau-brasil / Mangrove bark (wood[0], soil[1..2], wood[2], opaque)
      (2, 0): Painted ringed grey palm / Embaúba stipe (rock[0..3], opaque)
      (3, 0): Painted dark fibrous Xaxim bark (bottom half) + green palmito shaft / purple & gold fruits (top half)
"""

from __future__ import annotations

import colorsys
import json
import struct
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
GAME_ROOT = SCRIPT_DIR.parent.parent
SKINS_DIR = GAME_ROOT / "src" / "assets" / "skins"
OUT_ATLAS = SKINS_DIR / "foliage-atlas.png"

DL_DIR = Path.home() / ".cache" / "agents" / "2026-10-25-trilha-secreta" / "downloads-v2"
ARV_DIR = DL_DIR / "arvores"
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


def extract_glb_image(glb_path: Path, img_idx: int, out_tmp: Path) -> Path:
    b = glb_path.read_bytes()
    jlen = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20 : 20 + jlen].decode("utf-8"))
    bin_start = 20 + jlen + 8
    bv = j["bufferViews"][j["images"][img_idx]["bufferView"]]
    off = bv.get("byteOffset", 0)
    out_tmp.write_bytes(b[bin_start + off : bin_start + off + bv["byteLength"]])
    return out_tmp


def recolor_tile(
    rgba: bytearray,
    stops: list[str],
    *,
    opaque: bool = False,
    bg_hex: str | None = None,
    alpha_boost: float = 1.15,
    contrast: float = 1.15,
) -> bytearray:
    out = bytearray(len(rgba))
    bg_rgb = clamp_rgb_byte(*hex_rgb(bg_hex or stops[1]))
    # Compute luminance range of visible pixels
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
        if opaque:
            if a < 0.15:
                out[i : i + 4] = bytes((*bg_rgb, 255))
            else:
                mr = int(round(bg_rgb[0] * (1.0 - a) + r * a))
                mg = int(round(bg_rgb[1] * (1.0 - a) + g * a))
                mb = int(round(bg_rgb[2] * (1.0 - a) + b * a))
                out[i : i + 4] = bytes((*clamp_rgb_byte(mr / 255.0, mg / 255.0, mb / 255.0), 255))
        else:
            # Dilate RGB into transparent pixels so bilinear filtering and UV edge samples stay in-ramp!
            px = (i // 4) % 128
            py = (i // 4) // 128
            if px < 2 or px >= 126 or py < 2 or py >= 126:
                out[i : i + 4] = bytes((*bg_rgb, 0))
                continue
            na = int(round(max(0.0, min(1.0, a * alpha_boost)) * 255))
            if na < 28:
                out[i : i + 4] = bytes((*bg_rgb, 0))
            else:
                out[i : i + 4] = bytes((r, g, b, na))
    return out


def blit_tile(atlas: bytearray, tile: bytearray, col: int, row: int) -> None:
    """Blit a 128x128 tile at glTF UV tile (col, row), where row=3 is image top (y=0..127)."""
    img_y0 = (3 - row) * 128
    img_x0 = col * 128
    for y in range(128):
        src_off = y * 128 * 4
        dst_off = ((img_y0 + y) * 512 + img_x0) * 4
        atlas[dst_off : dst_off + 128 * 4] = tile[src_off : src_off + 128 * 4]


def main() -> None:
    import tempfile

    atlas = bytearray(512 * 512 * 4)
    # Ramps from game/src/style/palette.ts
    LEAF_RAMP = ["#1e4d36", "#2f6b47", "#489460", "#76c879"]
    GRASS_RAMP = ["#265437", "#3f7d4f", "#63ab66", "#93d678"]
    WOOD_RAMP = ["#4a3423", "#6e4e35", "#966c4a", "#c29368"]
    ROCK_RAMP = ["#4f5c55", "#6e7d74", "#8e9b92", "#b8c4bc"]
    SOIL_RAMP = ["#473325", "#694c37", "#8f6a4d", "#b58b67"]
    IPE_AMARELO_RAMP = ["#8c681e", "#bf9028", "#e8b93a", "#f5d461"]
    IPE_ROSA_RAMP = ["#7a304c", "#ad466c", "#de6890", "#f29cb8"]
    BROMELIA_RED_RAMP = ["#6b2220", "#9e332e", "#cc4438", "#e66b56"]
    PAU_BRASIL_BARK = ["#422c1e", "#6e4730", "#9c5c38", "#bf7a4d"]

    with tempfile.TemporaryDirectory() as tmp_s:
        tmp = Path(tmp_s)

        # --- ROW 3 (glTF v = 0.75..1.00): CC BY tree leaf cards ---
        # (0, 3): Ipê-amarelo (ginkgo-outono img 0)
        p_ginkgo_y = extract_glb_image(ARV_DIR / "ginkgo-outono" / "ginkgo-outono.glb", 0, tmp / "gy.png")
        blit_tile(
            atlas,
            recolor_tile(load_rgba(p_ginkgo_y), IPE_AMARELO_RAMP, opaque=False, bg_hex=IPE_AMARELO_RAMP[2], alpha_boost=1.35),
            0,
            3,
        )

        # (1, 3): Pau-brasil (ginkgo-verao img 0)
        p_ginkgo_g = extract_glb_image(ARV_DIR / "ginkgo-verao" / "ginkgo-verao.glb", 0, tmp / "gg.png")
        blit_tile(
            atlas,
            recolor_tile(load_rgba(p_ginkgo_g), LEAF_RAMP, opaque=False, bg_hex=LEAF_RAMP[2], alpha_boost=1.35),
            1,
            3,
        )

        # (2, 3): Ipê-rosa (arvore-rosa img 0, contrast-boosted so petals have rich rose gradients)
        p_rosa = extract_glb_image(ARV_DIR / "arvore-rosa" / "arvore-rosa.glb", 0, tmp / "rosa.png")
        blit_tile(
            atlas,
            recolor_tile(load_rgba(p_rosa), IPE_ROSA_RAMP, opaque=False, bg_hex=IPE_ROSA_RAMP[2], alpha_boost=1.4, contrast=1.6),
            2,
            3,
        )

        # (3, 3): Jequitibá-rosa layered crown branch (pacote-copa-camadas img 3, bottom-right leaf card subrect 360x534+664+490)
        p_copa = extract_glb_image(ARV_DIR / "pacote-copa-camadas" / "pacote-copa-camadas.glb", 3, tmp / "copa.png")
        # Wait: in pacote-copa-camadas img 3, the white rectangle with the branch is at bottom-right (x=664..1024, y=490..1024).
        # Let's turn the white background inside that subrect into alpha=0 before recoloring!
        copa_raw = load_rgba(p_copa, 128, 128, crop="360x534+664+490")
        for i in range(0, len(copa_raw), 4):
            r, g, b = copa_raw[i], copa_raw[i + 1], copa_raw[i + 2]
            if r > 225 and g > 225 and b > 225:
                copa_raw[i + 3] = 0
            elif r > 180 and g > 195 and b > 180 and (r - g) > -15:
                copa_raw[i + 3] = int(max(0, min(255, (240 - max(r, b)) * 4)))
        blit_tile(
            atlas,
            recolor_tile(copa_raw, LEAF_RAMP, opaque=False, bg_hex=LEAF_RAMP[1], alpha_boost=1.3),
            3,
            3,
        )

        # --- ROW 2 (glTF v = 0.50..0.75): Palms, Mangrove, Canopy Medallion & Broadleaf Cluster ---
        # (0, 2): Palmeira-juçara & Jerivá pinnate palm frond (palmeiras-psx img 4)
        p_palm = extract_glb_image(ARV_DIR / "palmeiras-psx" / "palmeiras-psx.glb", 4, tmp / "palm.png")
        blit_tile(
            atlas,
            recolor_tile(load_rgba(p_palm), LEAF_RAMP, opaque=False, bg_hex=LEAF_RAMP[1], alpha_boost=1.45),
            0,
            2,
        )

        # (1, 2): Mangue-vermelho leaf cluster (mangue-alto img 3)
        p_mangue = extract_glb_image(ARV_DIR / "mangue-alto" / "mangue-alto.glb", 3, tmp / "mangue.png")
        blit_tile(
            atlas,
            recolor_tile(load_rgba(p_mangue), LEAF_RAMP, opaque=False, bg_hex=LEAF_RAMP[1], alpha_boost=1.35),
            1,
            2,
        )

        # (2, 2): Opaque painted canopy medallion (FabinhoSC kapoktoonleaves.png, cropped tightly to the rosette)
        kapok_raw = load_rgba(FAB_TREETOPS / "kapoktoonleaves.png", 128, 128, crop="760x760+132+132")
        blit_tile(
            atlas,
            recolor_tile(kapok_raw, LEAF_RAMP, opaque=True, bg_hex=LEAF_RAMP[0], contrast=1.25),
            2,
            2,
        )

        # (3, 2): Painted broadleaf cluster card (FabinhoSC toonsimplesleafs.png, cropped to leaf cluster)
        broad_raw = load_rgba(FAB_TREETOPS / "toonsimplesleafs.png", 128, 128, crop="660x660+180+180")
        blit_tile(
            atlas,
            recolor_tile(broad_raw, GRASS_RAMP, opaque=False, bg_hex=GRASS_RAMP[1], alpha_boost=1.35),
            3,
            2,
        )

        # --- ROW 1 (glTF v = 0.25..0.50): Fern Frond, Bromeliad/Helicônia Blade, Red Bract, Leaf Litter ---
        # (0, 1): Painted fern frond (FabinhoSC bigfernleaf.png) with alpha cut-out and dilated in-ramp green RGB
        fern_raw = load_rgba(FAB_SIMPLE / "bigfernleaf.png", 128, 128)
        blit_tile(
            atlas,
            recolor_tile(fern_raw, GRASS_RAMP, opaque=False, bg_hex=LEAF_RAMP[1], alpha_boost=1.45, contrast=1.3),
            0,
            1,
        )

        # (1, 1): Painted channelled bromeliad / helicônia leaf (FabinhoSC tropicaleliconialeaf.png, opaque)
        heli_raw = load_rgba(FAB_SIMPLE / "tropicaleliconialeaf.png", 128, 128)
        blit_tile(
            atlas,
            recolor_tile(heli_raw, GRASS_RAMP, opaque=True, bg_hex=LEAF_RAMP[1], contrast=1.25),
            1,
            1,
        )

        # (2, 1): Painted crimson bromeliad / flower bract (FabinhoSC lowpolysimlpeleaf.png, opaque)
        bract_raw = load_rgba(FAB_SIMPLE / "lowpolysimlpeleaf.png", 128, 128)
        blit_tile(
            atlas,
            recolor_tile(bract_raw, BROMELIA_RED_RAMP, opaque=True, bg_hex=BROMELIA_RED_RAMP[1], contrast=1.25),
            2,
            1,
        )

        # (3, 1): Hand-painted forest-floor leaf litter / serapilheira (DevEarley Grass-W-Mud + Drummyfish default_rainforest_litter)
        litter_raw = load_rgba(DEVEARLEY_DIR / "Grass-W-Mud.png", 128, 128)
        litter_tile = recolor_tile(litter_raw, SOIL_RAMP, opaque=True, bg_hex=SOIL_RAMP[1], contrast=1.3)
        # Overlay scattered painted fallen green/gold/pink leaves from drummyfish rainforest_litter
        rain_raw = load_rgba(DRUMMY_DIR / "default_rainforest_litter.png", 128, 128)
        for i in range(0, len(litter_tile), 4):
            rlum = (0.299 * rain_raw[i] + 0.587 * rain_raw[i + 1] + 0.114 * rain_raw[i + 2]) / 255.0
            if rlum > 0.46:
                c = ramp4(LEAF_RAMP, (rlum - 0.46) * 2.2)
                litter_tile[i] = int(round(litter_tile[i] * 0.45 + c[0] * 0.55))
                litter_tile[i + 1] = int(round(litter_tile[i + 1] * 0.45 + c[1] * 0.55))
                litter_tile[i + 2] = int(round(litter_tile[i + 2] * 0.45 + c[2] * 0.55))
        blit_tile(atlas, litter_tile, 3, 1)

        # --- ROW 0 (glTF v = 0.00..0.25): Painted Bark Strips ---
        # (0, 0): Warm brown furrowed bark (pacote-copa-camadas img 0 top-left bark strip)
        p_bark0 = extract_glb_image(ARV_DIR / "pacote-copa-camadas" / "pacote-copa-camadas.glb", 0, tmp / "bark0.png")
        bark0_raw = load_rgba(p_bark0, 128, 128, crop="512x512+0+0")
        blit_tile(
            atlas,
            recolor_tile(bark0_raw, WOOD_RAMP, opaque=True, bg_hex=WOOD_RAMP[1], contrast=1.35),
            0,
            0,
        )

        # (1, 0): Reddish-brown flaking Pau-brasil & Mangrove bark (DEVEARLEY jungle-wood-with-bark-exposed.png)
        bark1_raw = load_rgba(DEVEARLEY_DIR / "jungle-wood-with-bark-exposed.png", 128, 128)
        blit_tile(
            atlas,
            recolor_tile(bark1_raw, PAU_BRASIL_BARK, opaque=True, bg_hex=PAU_BRASIL_BARK[1], contrast=1.35),
            1,
            0,
        )

        # (2, 0): Ringed grey palm & Embaúba stipe (palmeiras-psx img 5)
        p_pbark = extract_glb_image(ARV_DIR / "palmeiras-psx" / "palmeiras-psx.glb", 5, tmp / "pbark.png")
        pbark_raw = load_rgba(p_pbark, 128, 128)
        blit_tile(
            atlas,
            recolor_tile(pbark_raw, ROCK_RAMP, opaque=True, bg_hex=ROCK_RAMP[1], contrast=1.35),
            2,
            0,
        )

        # (3, 0): Dark fibrous Xaxim bark (bottom half) + green palmito shaft & purple/gold fruit bands (top half)
        xaxim_raw = load_rgba(DEVEARLEY_DIR / "at_wood.png", 128, 128)
        tile30 = recolor_tile(xaxim_raw, SOIL_RAMP[:3] + [WOOD_RAMP[1]], opaque=True, bg_hex=SOIL_RAMP[0], contrast=1.35)
        for y in range(64):
            for x in range(128):
                i = (y * 128 + x) * 4
                if y < 24:
                    # Top 24 rows: Juçara purple fruit (left) & Jerivá golden fruit (right)
                    col_r = ramp4(["#382040", "#45274f", "#643a72"], x / 63.0) if x < 64 else ramp4(IPE_AMARELO_RAMP, (x - 64) / 63.0)
                    tile30[i : i + 4] = bytes((*col_r, 255))
                else:
                    # Rows 24..63: Green Juçara palmito crownshaft with subtle vertical shading
                    t = 0.35 + 0.45 * ((y - 24) / 40.0)
                    col_r = ramp4(GRASS_RAMP, t)
                    tile30[i : i + 4] = bytes((*col_r, 255))
        blit_tile(atlas, tile30, 3, 0)

        # Encode as optimized 512x512 RGBA PNG
        raw_path = tmp / "atlas.rgba"
        raw_path.write_bytes(bytes(atlas))
        subprocess.run(
            [
                "magick",
                "-size",
                "512x512",
                "-depth",
                "8",
                f"rgba:{raw_path}",
                "-strip",
                "-define",
                "png:compression-level=9",
                str(OUT_ATLAS),
            ],
            check=True,
        )
        print(f"[build_foliage_atlas.py] Wrote {OUT_ATLAS} ({OUT_ATLAS.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
