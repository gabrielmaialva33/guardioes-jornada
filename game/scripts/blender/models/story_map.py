"""
Story map ("Reserva da Iara", `game/LEVEL.md` section 11) custom assets generator.

Run:
  /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/story_map.py [-- --no-render]

Generates and audits in `$CUSTOM_RAW_DIR`:
  - `viveiro.glb` (seedling nursery shade-house with 6 seedlings on benches, ~2.8 u tall)
  - `radio.glb` (walkie-talkie field radio, 0.65 u tall)
  - `cacho-jucara.glb` (harvestable juçara fruit bunch, 0.55 u tall, 0.95 u long)
  - `muda-etapa-1.glb`, `muda-etapa-2.glb`, `muda-etapa-3.glb` (seedling in 3 growth steps)
  - `bandeira-marcacao.glb` (2.2 u trap-marking flag with gold/yellow pennant)
  - `lixo-garrafa.glb` (0.5 u), `lixo-lata.glb` (0.3 u), `lixo-saco.glb` (0.65 u)
  - `pedra-observacao.glb` (~4.0 u tall granite boulder for Mission 2)
  - `toco-cortado.glb` (1.2 u axe-free cut tree stump with notch exposing heartwood)
  - `pedra-rio-1.glb`, `pedra-rio-2.glb`, `pedra-rio-3.glb` (top radius 1.3 u, top 0.6 u above base)
  - `degrau-rocha.glb`, `degrau-raiz.glb`, `degrau-tronco.glb` (2.5 x 2.5 u top mirante ledges)
  - `ponte-madeira.glb` (wooden river bridge, 15.6 u span x 3.4 u wide)
  - `jequitiba-silhueta.glb` (18.0 u flat crossed-plane silhouette of jequitibá-rosa)
  - `ipe-amarelo-silhueta.glb` (10.45 u flat crossed-plane silhouette of ipê-amarelo)
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
from mathutils import Euler, Vector  # noqa: E402

WOOD0 = C.ramp("wood", 0)
WOOD1 = C.ramp("wood", 1)
WOOD2 = C.ramp("wood", 2)
WOOD3 = C.ramp("wood", 3)

SOIL0 = C.ramp("soil", 0)
SOIL1 = C.ramp("soil", 1)
SOIL2 = C.ramp("soil", 2)

ROCK0 = C.ramp("rock", 0)
ROCK1 = C.ramp("rock", 1)
ROCK2 = C.ramp("rock", 2)
ROCK3 = C.ramp("rock", 3)

LEAF0 = C.ramp("leaf", 0)
LEAF1 = C.ramp("leaf", 1)
LEAF2 = C.ramp("leaf", 2)
LEAF3 = C.ramp("leaf", 3)

GRASS1 = C.ramp("grass", 1)
GRASS2 = C.ramp("grass", 2)
GRASS3 = C.ramp("grass", 3)

WATER1 = C.ramp("water", 1)
WATER2 = C.ramp("water", 2)
WATER3 = C.ramp("water", 3)

GOLD = C.ACCENT["gold"]
IPE_AMARELO = C.ACCENT["ipeAmarelo"]
IPE_ROSA = C.ACCENT["ipeRosa"]
FRUIT = C.SPECIES["jucaraFruto"]
FRUIT_LIGHT = C.SPECIES["jucaraFrutoLuz"]


# --------------------------------------------------------------------------- 1. Viveiro
def build_viveiro():
    """Seedling nursery shade-house (3.2 x 2.0 u footprint, 2.8 u tall, <= 200 tris)."""
    m = C.Mesh("viveiro")
    # 4 corner timber posts (4 x 8 = 32 tris)
    for sx in (-1.45, 1.45):
        for sy in (-0.85, 0.85):
            m.box((sx, sy, 1.35), (0.16, 0.16, 2.70), WOOD0, skip=("bottom", "top"))
    # Front and back roof beams (2 x 10 = 20 tris)
    m.box((0.0, -0.85, 2.66), (3.16, 0.14, 0.14), WOOD1, skip=("bottom",))
    m.box((0.0, 0.85, 2.66), (3.16, 0.14, 0.14), WOOD1, skip=("bottom",))
    # 2 shade-cloth roof panels (2 x 12 = 24 tris)
    for ry in (-0.42, 0.42):
        m.box((0.0, ry, 2.76), (3.20, 0.72, 0.06), LEAF0, colours={"top": LEAF1, "bottom": LEAF0})
    # Two stepped nursery bench shelves (2 x 10 = 20 tris)
    m.box((0.0, -0.28, 0.72), (2.76, 0.56, 0.10), WOOD2, skip=("bottom",))
    m.box((0.0, 0.36, 0.98), (2.76, 0.56, 0.10), WOOD2, skip=("bottom",))
    # 6 seedling pots on the shelves with bright green sprouts (6 x (10 + 4) = 84 tris -> 180 total)
    pots = [
        (-0.92, -0.28, 0.77),
        (0.0, -0.28, 0.77),
        (0.92, -0.28, 0.77),
        (-0.92, 0.36, 1.03),
        (0.0, 0.36, 1.03),
        (0.92, 0.36, 1.03),
    ]
    for k, (px, py, pz) in enumerate(pots):
        m.box((px, py, pz + 0.14), (0.28, 0.28, 0.28), SOIL0, skip=("bottom",), colours={"top": SOIL1})
        ang = 0.5 * k
        d = Vector((math.cos(ang), math.sin(ang), 0))
        m.blade(
            Vector((px, py, pz + 0.26)) - d * 0.18,
            Vector((px, py, pz + 0.54)) + d * 0.22,
            0.22,
            LEAF3 if k % 2 == 0 else GRASS2,
            bend=Vector((0, 0, 0.06)),
            colour_under=LEAF2,
        )
    return C.build_object(m, "viveiro")


# --------------------------------------------------------------------------- 2. Radio
def build_radio():
    """Field walkie-talkie radio (~0.65 u tall, <= 200 tris)."""
    m = C.Mesh("radio")
    # Main rugged body (10 tris)
    m.box((0.0, 0.0, 0.21), (0.26, 0.14, 0.42), ROCK0, skip=("bottom",), colours={"top": ROCK1, "ny": ROCK1})
    # Upper grip collar (10 tris)
    m.box((0.0, 0.0, 0.43), (0.28, 0.16, 0.06), ROCK0, skip=("bottom",))
    # Backlit LCD display on front (-Y) (10 tris)
    m.box((0.0, -0.072, 0.29), (0.18, 0.02, 0.11), WATER2, skip=("py",), colours={"ny": WATER3})
    # Speaker grille plate below screen (10 tris)
    m.box((0.0, -0.072, 0.13), (0.18, 0.02, 0.13), ROCK2, skip=("py",))
    # Yellow push-to-talk (PTT) side button + channel knob (20 tris)
    m.box((-0.14, -0.01, 0.28), (0.04, 0.07, 0.11), IPE_AMARELO, skip=("px",))
    m.box((0.06, 0.0, 0.475), (0.06, 0.06, 0.05), ROCK2, skip=("bottom",))
    # Stubby antenna rising to 0.65 u (4-sided prism = 12 tris -> 72 total)
    m.prism((-0.07, 0.01, 0.45), (-0.07, 0.01, 0.65), 0.032, 0.020, 4, ROCK0, cap0=False, cap1=True)
    return C.build_object(m, "radio")


# --------------------------------------------------------------------------- 3. Cacho de juçara
def build_cacho_jucara():
    """Standalone harvestable juçara fruit bunch on the ground (0.55 u tall, 0.95 u long, <= 200 tris)."""
    m = C.Mesh("cacho-jucara")
    # Curved olive-green peduncle base + branched woody rachis
    m.tube([(-0.38, 0.0, 0.34), (-0.12, 0.0, 0.26), (0.28, 0.0, 0.14)], [0.11, 0.085, 0.05], 5, GRASS1,
           cap_start=True, cap_end=True, colours=[GRASS1, WOOD2, WOOD2])
    # Side rachillae branches
    for sy in (-1, 1):
        m.tube([(-0.08, 0.0, 0.24), (0.18, sy * 0.24, 0.10)], [0.05, 0.03], 4, WOOD2, cap_end=True)
    # 8 chunky ripe dark-purple berry clusters
    berries = [
        (-0.05, -0.16, 0.16, 0.22, FRUIT),
        (0.14, -0.22, 0.12, 0.20, FRUIT_LIGHT),
        (-0.04, 0.16, 0.16, 0.22, FRUIT_LIGHT),
        (0.15, 0.22, 0.12, 0.20, FRUIT),
        (0.02, 0.0, 0.22, 0.24, FRUIT),
        (0.22, -0.05, 0.14, 0.22, FRUIT_LIGHT),
        (0.24, 0.07, 0.13, 0.20, FRUIT),
        (0.36, 0.0, 0.11, 0.18, FRUIT_LIGHT),
    ]
    for k, (bx, by, bz, s, col) in enumerate(berries):
        rot = Euler((0.2 * k, -0.15 * k, 0.4 * k), "XYZ").to_matrix()
        m.box((bx, by, bz), (s, s, s * 1.1), col, rot=rot)
    return C.build_object(m, "cacho-jucara")


# --------------------------------------------------------------------------- 4. Mudas (3 etapas)
def build_muda_1():
    """Seedling growth step 1: freshly planted sprout (~0.55 u tall, <= 200 tris)."""
    m = C.Mesh("muda-etapa-1")
    m.chunk((0, 0, 0), 0.32, 0.32, 0.14, 6, SOIL0, chamfer=0.35, bottom=False, colour_top=SOIL1)
    m.prism((0, 0, 0.12), (0, 0, 0.38), 0.035, 0.025, 4, GRASS1, cap0=False, cap1=True)
    top = Vector((0, 0, 0.36))
    m.blade(top, top + Vector((0.22, -0.06, 0.18)), 0.15, LEAF3, bend=Vector((0, 0, 0.04)), colour_under=LEAF2)
    m.blade(top, top + Vector((-0.22, 0.06, 0.16)), 0.15, GRASS3, bend=Vector((0, 0, 0.04)), colour_under=LEAF2)
    return C.build_object(m, "muda-etapa-1")


def build_muda_2():
    """Seedling growth step 2: young woody stem with 5 leaves (~1.25 u tall, <= 200 tris)."""
    m = C.Mesh("muda-etapa-2")
    m.chunk((0, 0, 0), 0.38, 0.38, 0.16, 6, SOIL0, chamfer=0.35, bottom=False, colour_top=SOIL1)
    m.tube([(0, 0, 0.12), (0.02, 0, 0.55), (0, 0, 0.98)], [0.055, 0.042, 0.03], 5, WOOD1, cap_end=True)
    for k in range(5):
        a = 2 * math.pi * k / 5 + 0.3
        d = Vector((math.cos(a), math.sin(a), 0))
        z0 = 0.68 + 0.07 * k
        col = LEAF3 if k >= 3 else LEAF2
        m.blade(
            Vector((0, 0, z0)),
            Vector((0, 0, z0 + 0.22)) + d * 0.42,
            0.22,
            col,
            bend=Vector((0, 0, 0.06)),
            colour_under=LEAF1,
        )
    return C.build_object(m, "muda-etapa-2")


def build_muda_3():
    """Seedling growth step 3: established sapling (~2.40 u tall, <= 200 tris)."""
    m = C.Mesh("muda-etapa-3")
    m.slab((0, 0, 0), 0.44, 0.44, 0.16, 5, SOIL0, taper=0.82, colour_top=SOIL1, colour_bottom=SOIL0)
    fork = Vector((0, 0, 1.35))
    m.tube([(0, 0, 0.14), (0.02, 0, 0.75), fork], [0.09, 0.07, 0.055], 5, WOOD1, cap_end=False)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.4
        d = Vector((math.cos(a), math.sin(a), 0))
        tip = fork + d * 0.48 + Vector((0, 0, 0.52))
        m.tube([fork, tip], [0.045, 0.028], 4, WOOD1, cap_end=False)
        m.chunk(tip + Vector((0, 0, -0.10)), 0.46, 0.44, 0.48, 5, LEAF2, chamfer=0.32, bottom=False, colour_top=LEAF3)
    m.chunk((0, 0, 1.92), 0.50, 0.48, 0.48, 5, LEAF3, chamfer=0.32, bottom=False, colour_bottom=LEAF2)
    return C.build_object(m, "muda-etapa-3")


# --------------------------------------------------------------------------- 5. Bandeira de marcação
def build_bandeira_marcacao():
    """Marker flag for Mission 5 traps (2.2 u tall, gold/yellow pennant, <= 200 tris)."""
    m = C.Mesh("bandeira-marcacao")
    # Wooden stake post + gold finial ball
    m.prism((0, 0, 0), (0, 0, 2.12), 0.055, 0.045, 5, WOOD1, cap0=False, cap1=True)
    m.box((0, 0, 2.16), (0.13, 0.13, 0.10), GOLD)
    # Pennant flag in ACCENT.gold and ACCENT.ipeAmarelo
    m.box((0.28, 0.0, 1.88), (0.50, 0.05, 0.34), GOLD)
    m.box((0.64, 0.0, 1.88), (0.26, 0.04, 0.24), IPE_AMARELO)
    return C.build_object(m, "bandeira-marcacao")


# --------------------------------------------------------------------------- 6. Lixo (garrafa, lata, saco)
def build_lixo_garrafa():
    """Plastic bottle trash collectible (0.5 u tall, <= 200 tris)."""
    m = C.Mesh("lixo-garrafa")
    m.prism((0, 0, 0), (0, 0, 0.32), 0.095, 0.095, 6, WATER1, cap0=True, cap1=False)
    m.prism((0, 0, 0.32), (0, 0, 0.43), 0.095, 0.040, 6, WATER2, cap0=False, cap1=False)
    m.prism((0, 0, 0.43), (0, 0, 0.50), 0.044, 0.044, 6, ROCK0, cap0=False, cap1=True)
    return C.build_object(m, "lixo-garrafa")


def build_lixo_lata():
    """Aluminum soda can trash collectible (0.3 u tall, <= 200 tris)."""
    m = C.Mesh("lixo-lata")
    m.prism((0, 0, 0), (0, 0, 0.08), 0.085, 0.09, 6, ROCK2, cap0=True, cap1=False)
    m.prism((0, 0, 0.08), (0, 0, 0.22), 0.09, 0.09, 6, IPE_ROSA, cap0=False, cap1=False)
    m.prism((0, 0, 0.22), (0, 0, 0.30), 0.09, 0.082, 6, ROCK3, cap0=False, cap1=True)
    return C.build_object(m, "lixo-lata")


def build_lixo_saco():
    """Tied trash bag collectible (0.65 u tall, <= 200 tris)."""
    m = C.Mesh("lixo-saco")
    m.chunk((0, 0, 0), 0.26, 0.24, 0.46, 6, ROCK0, chamfer=0.34, colour_top=ROCK1)
    # Tied neck knot + two bunny-ear ties at top
    m.box((0, 0, 0.48), (0.12, 0.12, 0.08), IPE_AMARELO)
    r_l = Euler((0, math.radians(-24), 0), "XYZ").to_matrix()
    r_r = Euler((0, math.radians(24), 0), "XYZ").to_matrix()
    m.box((-0.07, 0, 0.57), (0.08, 0.06, 0.14), ROCK1, rot=r_l)
    m.box((0.07, 0, 0.57), (0.08, 0.06, 0.14), ROCK1, rot=r_r)
    return C.build_object(m, "lixo-saco")


# --------------------------------------------------------------------------- 7. Pedra de observação (~4 u)
def build_pedra_observacao():
    """Observation boulder (~4.0 u tall, Mission 2 cover rock, <= 200 tris)."""
    m = C.Mesh("pedra-observacao")
    # Main 7-sided granite mass rising to 4.0 u
    m.chunk((0.0, 0.0, 0.0), 2.15, 1.75, 4.00, 7, ROCK1, chamfer=0.30, top_scale=0.68,
            colour_top=ROCK2, colour_bottom=ROCK0, twist=0.25)
    # Side shoulder boulder for natural asymmetry
    m.chunk((1.35, -0.35, 0.0), 1.15, 1.05, 2.35, 6, ROCK0, chamfer=0.32, top_scale=0.75,
            colour_top=ROCK1, bottom=False, twist=0.8)
    # Moss cap on top shelf
    m.slab((-0.10, 0.05, 3.96), 1.18, 0.95, 0.12, 6, GRASS1, taper=0.82, colour_top=GRASS2, twist=0.25)
    return C.build_object(m, "pedra-observacao")


# --------------------------------------------------------------------------- 8. Toco cortado (sem machado)
def build_toco_cortado():
    """Axe-free cut tree stump with a saw/notch cut mark exposing heartwood (1.2 u tall, <= 200 tris)."""
    m = C.Mesh("toco-cortado")
    # Flared root buttresses + lower bark cylinder (z = 0..0.78)
    m.tube([(0, 0, 0), (0, 0, 0.28), (0, 0, 0.78)], [0.76, 0.54, 0.48], 6, WOOD0,
           cap_end=True, colours=[WOOD0, WOOD0, WOOD3], twist=0.2)
    # Upper back half of the stump standing above the directional felling notch (z = 0.78..1.20)
    m.box((0.0, 0.15, 0.99), (0.82, 0.46, 0.42), WOOD0, skip=("bottom",),
          colours={"top": WOOD3, "ny": WOOD2})
    # Angled notch ramp showing fresh pale heartwood
    notch_rot = Euler((math.radians(-32), 0, 0), "XYZ").to_matrix()
    m.box((0.0, -0.05, 0.90), (0.80, 0.34, 0.08), WOOD2, rot=notch_rot, colours={"top": WOOD3})
    return C.build_object(m, "toco-cortado")


# --------------------------------------------------------------------------- 9. Pedras do rio (3 variantes)
def build_pedra_rio(variant: int):
    """River stepping stone: top radius 1.3 u (2.6 u across), top 0.6 u above base (<= 200 tris)."""
    def _build():
        name = f"pedra-rio-{variant}"
        m = C.Mesh(name)
        sides = 7 if variant != 2 else 8
        twist = 0.25 * variant
        rx = 1.30 if variant == 1 else (1.34 if variant == 2 else 1.28)
        ry = 1.30 if variant == 1 else (1.26 if variant == 2 else 1.32)
        # Submerged dark rim base (z = 0.00..0.18) + flat-topped stepping stone reaching z = 0.60
        m.slab((0, 0, 0.0), rx * 1.10, ry * 1.10, 0.20, sides, ROCK0, taper=0.96,
               colour_top=ROCK1, colour_bottom=ROCK0, twist=twist)
        m.slab((0, 0, 0.18), rx * 1.04, ry * 1.04, 0.42, sides, ROCK1, taper=0.96,
               colour_top=ROCK2 if variant != 3 else ROCK3, colour_bottom=ROCK0, twist=twist)
        if variant >= 2:
            # Small low moss patch near the edge (0.02 u high so the top stays flat for jumping)
            mx = 0.55 if variant == 2 else -0.50
            my = 0.35 if variant == 2 else -0.40
            m.slab((mx, my, 0.59), 0.38, 0.32, 0.02, 5, GRASS1, taper=0.85, colour_top=GRASS2, twist=twist)
        return C.build_object(m, name)

    return _build


# --------------------------------------------------------------------------- 10. Degraus do mirante (rocha, raiz, tronco)
def build_degrau_rocha():
    """Mirante rock ledge: 2.5 x 2.5 u walkable top, height 0.90 u (<= 200 tris)."""
    m = C.Mesh("degrau-rocha")
    # Flat 2.5 x 2.5 u top slab (z = 0.52..0.90) with grassy top surface
    m.box((0.0, 0.0, 0.71), (2.50, 2.50, 0.38), ROCK1, colours={"top": GRASS1, "bottom": ROCK0})
    # Tapered lower rock corbel supporting the shelf (z = 0.00..0.52)
    m.box((0.0, 0.15, 0.26), (2.15, 2.15, 0.52), ROCK0, skip=("top",), colours={"ny": ROCK1})
    return C.build_object(m, "degrau-rocha")


def build_degrau_raiz():
    """Mirante root ledge: 2.5 x 2.5 u earth/moss top cradled by giant roots (<= 200 tris)."""
    m = C.Mesh("degrau-raiz")
    # 2.5 x 2.5 u soil/moss platform top (z = 0.56..0.90)
    m.box((0.0, 0.0, 0.73), (2.50, 2.50, 0.34), SOIL1, colours={"top": GRASS1, "bottom": SOIL0})
    # 3 gnarled buttress roots curving under the platform
    for rx in (-0.85, 0.0, 0.85):
        m.tube([(rx, 1.15, 0.05), (rx * 0.9, 0.1, 0.38), (rx * 0.85, -1.05, 0.58)],
               [0.24, 0.20, 0.15], 5, WOOD0, cap_start=True, cap_end=True, colours=[WOOD0, WOOD1, WOOD1])
    return C.build_object(m, "degrau-raiz")


def build_degrau_tronco():
    """Mirante log ledge: 4 timber logs lashed into a 2.5 x 2.5 u shelf (<= 200 tris)."""
    m = C.Mesh("degrau-tronco")
    # 2 lower cross-bearer beams (z = 0.00..0.38)
    for bx in (-0.82, 0.82):
        m.box((bx, 0.0, 0.19), (0.34, 2.46, 0.38), WOOD0)
    # 4 top deck logs spanning 2.5 x 2.5 u (z = 0.38..0.90)
    for k, ly in enumerate((-0.93, -0.31, 0.31, 0.93)):
        col = WOOD1 if k % 2 == 0 else WOOD2
        m.box((0.0, ly, 0.64), (2.50, 0.58, 0.52), col, colours={"top": WOOD2, "px": WOOD3, "nx": WOOD3})
    return C.build_object(m, "degrau-tronco")


# --------------------------------------------------------------------------- 11. Ponte de madeira
def build_ponte_madeira():
    """Wooden footbridge across the river (~15.6 u span x 3.4 u wide, <= 300 tris)."""
    m = C.Mesh("ponte-madeira")
    span = 15.6
    width = 3.4
    # 2 main arched longitudinal stringer beams (z = 0.45..0.85)
    for sx in (-1.35, 1.35):
        m.box((sx, 0.0, 0.62), (0.28, span, 0.34), WOOD0)
    # 6 vertical support pilings into the riverbed (z = 0.00..1.85)
    for sx in (-1.48, 1.48):
        for py in (-6.5, 0.0, 6.5):
            m.box((sx, py, 0.92), (0.24, 0.24, 1.84), WOOD0, skip=("bottom",), colours={"top": WOOD2})
    # Left and right safety handrails (z = 1.55..1.72)
    for sx in (-1.48, 1.48):
        m.box((sx, 0.0, 1.64), (0.16, span, 0.14), WOOD1, colours={"top": WOOD2})
    # 11 chunky cross-deck planks forming a solid walkable surface (z = 0.80..0.96)
    for k in range(11):
        py = -7.0 + k * 1.4
        col = WOOD2 if k % 2 == 0 else WOOD1
        m.box((0.0, py, 0.88), (width, 1.18, 0.16), col, colours={"top": WOOD2 if k % 2 == 0 else WOOD3})
    return C.build_object(m, "ponte-madeira")


# --------------------------------------------------------------------------- 12. Silhuetas (jequitibá 18 u & ipê-amarelo 10.45 u)
def build_jequitiba_silhueta():
    """Flat crossed-plane silhouette of the 18.0 u jequitibá-rosa landmark (<= 80 tris)."""
    m = C.Mesh("jequitiba-silhueta")
    for angle in (0.0, math.pi / 2):
        c, s = math.cos(angle), math.sin(angle)

        def pt(x: float, z: float) -> Vector:
            return Vector((x * c, x * s, z))

        # Trunk silhouette (z = 0..13.5)
        m.add2([pt(-1.1, 0.0), pt(1.1, 0.0), pt(0.55, 13.5), pt(-0.55, 13.5)], WOOD0, WOOD0)
        # Broad umbrella lower crown tier (z = 13.0..16.2, width 11.8 u)
        m.add2([pt(-5.9, 13.4), pt(5.9, 13.4), pt(4.8, 16.2), pt(-4.8, 16.2)], LEAF1, LEAF1)
        # Upper globose crown dome reaching 18.0 u
        m.add2([pt(-4.2, 15.8), pt(4.2, 15.8), pt(2.4, 18.0), pt(-2.4, 18.0)], LEAF2, LEAF2)
    return C.build_object(m, "jequitiba-silhueta")


def build_ipe_amarelo_silhueta():
    """Flat crossed-plane silhouette of the 10.45 u ipê-amarelo landmark (<= 80 tris)."""
    m = C.Mesh("ipe-amarelo-silhueta")
    for angle in (0.0, math.pi / 2):
        c, s = math.cos(angle), math.sin(angle)

        def pt(x: float, z: float) -> Vector:
            return Vector((x * c, x * s, z))

        # Trunk + forked limbs silhouette (z = 0..7.5)
        m.add2([pt(-0.55, 0.0), pt(0.55, 0.0), pt(0.35, 5.2), pt(-0.35, 5.2)], WOOD1, WOOD1)
        m.add2([pt(-0.35, 4.8), pt(0.35, 4.8), pt(2.8, 7.8), pt(-2.8, 7.8)], WOOD1, WOOD1)
        # Golden-yellow flowering crown silhouette reaching 10.45 u (width 8.6 u)
        m.add2([pt(-4.3, 6.8), pt(4.3, 6.8), pt(3.8, 9.4), pt(-3.8, 9.4)], IPE_AMARELO, IPE_AMARELO)
        m.add2([pt(-2.6, 8.8), pt(2.6, 8.8), pt(1.6, 10.45), pt(-1.6, 10.45)], IPE_AMARELO, IPE_AMARELO)
    return C.build_object(m, "ipe-amarelo-silhueta")


ASSETS = [
    ("viveiro", build_viveiro, 200, "2.8 u nursery shade-house"),
    ("radio", build_radio, 200, "0.65 u field radio"),
    ("cacho-jucara", build_cacho_jucara, 200, "0.55 u juçara fruit bunch"),
    ("muda-etapa-1", build_muda_1, 200, "0.55 u seedling step 1"),
    ("muda-etapa-2", build_muda_2, 200, "1.25 u seedling step 2"),
    ("muda-etapa-3", build_muda_3, 200, "2.40 u seedling step 3"),
    ("bandeira-marcacao", build_bandeira_marcacao, 200, "2.2 u trap marker flag"),
    ("lixo-garrafa", build_lixo_garrafa, 200, "0.50 u trash bottle"),
    ("lixo-lata", build_lixo_lata, 200, "0.30 u trash can"),
    ("lixo-saco", build_lixo_saco, 200, "0.65 u trash bag"),
    ("pedra-observacao", build_pedra_observacao, 200, "4.0 u observation boulder"),
    ("toco-cortado", build_toco_cortado, 200, "1.2 u cut stump"),
    ("pedra-rio-1", build_pedra_rio(1), 200, "0.6 u river stone 1 (r=1.3 u)"),
    ("pedra-rio-2", build_pedra_rio(2), 200, "0.6 u river stone 2 (r=1.3 u)"),
    ("pedra-rio-3", build_pedra_rio(3), 200, "0.6 u river stone 3 (r=1.3 u)"),
    ("degrau-rocha", build_degrau_rocha, 200, "2.5x2.5 u rock ledge"),
    ("degrau-raiz", build_degrau_raiz, 200, "2.5x2.5 u root ledge"),
    ("degrau-tronco", build_degrau_tronco, 200, "2.5x2.5 u log ledge"),
    ("ponte-madeira", build_ponte_madeira, 300, "15.6 u wooden bridge"),
]


if __name__ == "__main__":
    for name, fn, budget, target in ASSETS:
        C.run(fn, name=name, budget=budget, target=target, preview_kw={"res": (800, 800)})
