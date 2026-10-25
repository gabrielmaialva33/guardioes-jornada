"""
Placas educativas: one trail-sign model, three faces, props (x1.5, sign 2.2 u, ART.md
section 3), <= 200 tris. Files: placa-proibido-cacar.glb, placa-nao-jogue-lixo.glb,
placa-area-de-soltura.glb, each with its 128x96 face texture embedded (also saved as
placa-<id>-face.png).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/placas.py

Decisions:
- Proportions from the Kenney Nature Kit `sign` (CC0): one light post, a dark board about
  3:2 in front of it. The board is vertex-coloured; the text is a texture on a separate
  face material (`placa-face-<id>`), NEAREST-filtered, the only image texture in the set
  (ART.md section 6: text in textures only on signs, at most 128x128).
- Text in pt-BR capitals in Atkinson Hyperlegible Next Bold, the app's UI font
  (--font-ui in src/app.css; SIL OFL 1.1, from node_modules/@fontsource-variable), drawn at
  the largest size that fits, so it reads on a phone. Light letters on the dark routed
  board, like Brazilian park signs, from the ramps only (no red: ART.md keeps the danger
  colours in the UI). No institution names or logos.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
import _common as C  # noqa: E402

FONT = C.REPO / "node_modules" / "@fontsource-variable" / "atkinson-hyperlegible-next" / "files" / \
    "atkinson-hyperlegible-next-latin-wght-normal.woff2"
FONT_WEIGHT = 700
TEX_W, TEX_H = 128, 96
BOARD = C.ramp("wood", 0)
TEXT = C.ramp("water", 3)  # the lightest ramp colour: 6.8:1 contrast on wood[0]
POST = C.ramp("wood", 2)
CAP = C.ramp("wood", 1)

SIGNS = {
    "proibido-cacar": ["PROIBIDO", "CAÇAR"],
    "nao-jogue-lixo": ["NÃO JOGUE", "LIXO"],
    "area-de-soltura": ["ÁREA DE", "SOLTURA", "DE FAUNA"],
}


def face_texture(lines: list[str], path: Path, text_hex: str = TEXT) -> Path:
    from PIL import Image, ImageDraw, ImageFont

    bg = tuple(int(c * 255) for c in C.hex_rgb(BOARD))
    fg = tuple(int(c * 255) for c in C.hex_rgb(text_hex))
    pad_x, pad_y, gap = 8, 7, 3
    best = None
    for size in range(40, 8, -1):
        font = ImageFont.truetype(str(FONT), size)
        font.set_variation_by_axes([FONT_WEIGHT])
        boxes = [font.getbbox(line, anchor="ls") for line in lines]
        width = max(b[2] - b[0] for b in boxes)
        ascent, descent = font.getmetrics()
        cap_top = min(b[1] for b in boxes)  # accents (Á, Ã) reach above the caps
        line_h = (-cap_top) + gap
        height = line_h * len(lines) - gap + max(0, max(b[3] for b in boxes))
        if width <= TEX_W - 2 * pad_x and height <= TEX_H - 2 * pad_y:
            best = (font, boxes, line_h, height, cap_top)
            break
    assert best, f"text does not fit: {lines}"
    font, boxes, line_h, height, cap_top = best
    img = Image.new("RGB", (TEX_W, TEX_H), bg)
    d = ImageDraw.Draw(img)
    d.rectangle([2, 2, TEX_W - 3, TEX_H - 3], outline=fg, width=2)  # painted border
    y = (TEX_H - height) / 2 - cap_top
    for line, box in zip(lines, boxes):
        d.text((TEX_W / 2, round(y)), line, font=font, fill=fg, anchor="ms")
        y += line_h
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"[placa] {path.name}: font {font.size}px, lines {lines}")
    return path


def face_material(sign_id: str, png: Path):
    img = bpy.data.images.load(str(png), check_existing=False)
    img.name = f"placa-{sign_id}-face"
    mat = bpy.data.materials.new(f"placa-face-{sign_id}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"  # exported as NEAREST
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def sign_mesh() -> tuple[C.Mesh, list[int]]:
    m = C.Mesh("placa")
    # Post behind the board, rising a little above it (Kenney sign).
    m.box((0, 0.11, 1.1), (0.2, 0.2, 2.2), POST, skip=("bottom",))
    # Board: 1.56 x 1.17 x 0.12, its front at y = -0.07 (the model faces -Y, glTF +Z).
    m.box((0, 0.0, 1.5), (1.56, 0.12, 1.17), BOARD)
    # Cap plank along the top edge.
    m.box((0, -0.005, 2.11), (1.66, 0.17, 0.07), CAP)
    mats = [0] * len(m.faces)
    # Text face, 4:3 like the texture, just proud of the board front.
    w, h, y = 1.4, 1.05, -0.065
    z0 = 1.5 - h / 2
    m.add([(-w / 2, y, z0), (w / 2, y, z0), (w / 2, y, z0 + h), (-w / 2, y, z0 + h)], "#ffffff",
          [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
    mats.append(1)
    return m, mats


def build_variant(sign_id: str):
    def build():
        png = face_texture(SIGNS[sign_id], C.OUT / f"placa-{sign_id}-face.png")
        mesh, mats = sign_mesh()
        return C.build_object(mesh, f"placa-{sign_id}", materials=[C.vertex_colour_material(), face_material(sign_id, png)],
                              face_materials=mats)

    return build


if __name__ == "__main__":
    for sign_id in SIGNS:
        C.run(build_variant(sign_id), name=f"placa-{sign_id}", budget=200, target="2.2 u (props x1.5)",
              preview_kw={"elevation_deg": 8.0, "closeup": True, "res": (900, 900), "azimuth_deg": -18.0})
