"""
Bichos da Mata: the Atlantic Forest species built on Kenney Cube Pets 2.0 (CC0), plus three
custom ones built here in the same blocky style (tatu-galinha, jabuti-tinga, sapo-cururu).

Run (headless Blender reads the raw Kenney GLBs, which are not meshopt-compressed):

    blender -b --factory-startup -P game/scripts/blender/models/bichos_mata.py [-- <name> ... | --no-pack | --render]

For each model it writes:
- the raw GLB to $CUSTOM_RAW_DIR (default ~/.cache/agents/2026-10-25-trilha-secreta/custom-raw)
  as bicho-<name>.glb, with bicho-<name>.json (triangles per node);
- game/src/assets/models/<name>.glb through gltfpack 1.3.0 (-cc -kn -vtf -vpf, as scripts/assets.mjs packs the pets), unless --no-pack;
- game/src/assets/skins/palette-<species>.png for every species (and variant) that uses it.

Contract with the game (game/src/animation/animals/rigs.ts): the Cube Pets rig node tree
root > body > head (neck pivot), tail, wing-*; root > leg-front-left ... leg-back-right; feet
at y = 0, facing +Z. Every face samples one cell of its species' 64 x 64 palette (8 x 4 cells
of 8 x 16 texels, light at the top of a cell); the species colours are in SPECIES below with
their sources. ART.md section 3 sizes are applied in the game (species.ts), not here.

Shape changes, per model, and why (sources in the report and next to each colour):
- capivara (beaver): no flat tail, a blunt square snout, tiny ears, a longer barrel body.
- anta (pig): a body 1.5x longer, a short drooping trunk (custom part), rounded white-rimmed
  ears and the low neck crest of T. terrestris; the calf shares the model (striped palette).
- cateto (hog): tusks and back ridges removed, a dark dorsal crest, the pale collar cut out
  of the coat as its own region.
- veado (deer): branched antlers replaced by two short spikes (Mazama), a short tail.
- cachorro-do-mato (fox), tapiti (bunny, shorter ears, no head tufts), caranguejo (crab, six
  extra walking legs): recolours with small edits.
- onca-parda (lion): mane removed, body 1.2x longer, dark tail tip.
- jaguatirica (cat): smaller, chain-like rosettes and neck stripes as flat patches on the coat.
- passaro (chick, crest tufts removed, a tail added): saíra-sete-cores and sabiá-laranjeira.
- jacutinga (parrot): straight bill, red wattle, white wing patch; the crest stays (white).
- colhereiro (parrot): crest removed, the flat spoon bill (custom part), long legs, bare head.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
import _pets_kit as K  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

MODELS_DIR = C.GAME / "src" / "assets" / "models"
SKINS_DIR = C.GAME / "src" / "assets" / "skins"
RAW_OUT = C.OUT
PETS = C.CUBE_PETS

# --------------------------------------------------------------------------- colours
# Real colours by body region, simplified (ART.md section 2: species colours may leave the
# ramps if their lightness stays inside 12-90 %). Sources: report p23-bichos.md, section 3.
EYE = {"eyewhite": "#e8e4dc", "pupil": "#2c2a30", "neck": None}


def colours(base: dict) -> dict:
    out = {"eyewhite": EYE["eyewhite"], "pupil": EYE["pupil"]}
    out.update(base)
    return out


PALETTES = {
    # Hydrochoerus hydrochaeris: reddish to greyish brown, paler yellowish belly, dark muzzle.
    "capivara": colours({"coat": "#9c6a47", "belly": "#b08758", "muzzle": "#7a5236", "nose": "#2f2622",
                         "ear": "#7a5236", "hoof": "#3b2c25", "leg": "#86593b"}),
    # Tapirus terrestris adult: dark brown to blackish, ears rimmed white, darker mane and legs.
    # Dark grey-brown, light enough to read under the game's sun (coordinator review, 26/10).
    "anta": colours({"coat": "#6c605a", "belly": "#776a62", "snout": "#5c514b", "nose": "#3a322e",
                     "ear": "#5e534d", "rim": "#d6cfc6", "mane": "#4b423d", "hoof": "#3a322e", "leg": "#5f544e"}),
    # Calf: reddish brown with whitish horizontal stripes and spots, kept about six months.
    "anta-filhote": colours({"coat": ("stripes", "#7a4b2e", "#e2d2b4", 2), "belly": ("stripes", "#7a4b2e", "#d9c7a6", 3),
                             "snout": "#5a3a28", "nose": "#2f2622", "ear": "#6a4430", "rim": "#e2d6c2",
                             "mane": "#5b3a27", "hoof": "#2f2622", "leg": ("stripes", "#6e442b", "#d8c6a4", 4)}),
    # Pecari tajacu: grizzled grey-brown, a pale (whitish to yellowish) collar, dark crest and legs.
    "cateto": colours({"coat": "#6b625b", "collar": "#cfc5b2", "mane": "#2f2b29", "snout": "#4a423e",
                       "nose": "#2b2624", "ear": "#4a433e", "leg": "#3a3532", "hoof": "#2a2624"}),
    # Mazama americana: bright reddish brown, greyer head and neck, white under the tail and belly.
    "veado-mateiro": colours({"coat": "#a24e26", "head": "#6e4434", "belly": "#d9c6ad", "muzzle": "#5a3f33",
                      "nose": "#2a2422", "ear": "#8a5a40", "antler": "#c9b08a", "hoof": "#2f2725",
                      "leg": "#7a3d22", "tail": "#a24e26"}),
    # Cerdocyon thous: grizzled grey to grey-brown, darker (blackish) legs, black tail tip,
    # reddish-brown ears and face, pale throat.
    "cachorro-do-mato": colours({"coat": "#6f655a", "bib": "#c4baa8", "ear": "#8a5a3a", "earin": "#d0c2ac",
                                 "nose": "#262220", "leg": "#86573a", "paw": "#262220", "tailtip": "#262220",
                                 "muzzle": "#86603f", "stripe": "#2a2624"}),
    # Puma concolor: uniform tawny ("pardo"), pale muzzle, chin and belly, dark tail tip and ear backs.
    "onca-parda": colours({"coat": "#a87d4f", "muzzle": "#e2d3b9", "nose": "#a8665a", "mouth": "#3a2a26",
                           "ear": "#a87d4f", "earback": "#3b2d27", "paw": "#cdb894", "tailtip": "#3b2d27"}),
    # Sylvilagus brasiliensis: dark agouti brown, rufous nape, paler belly, very small dark tail.
    "tapiti": colours({"coat": "#7e5c42", "earin": "#b98f78", "nose": "#a56a62", "mouth": "#4a3a30",
                       "tail": "#4a3628", "belly": "#a58a6e"}),
    # Leopardus pardalis: tawny-ochre coat with black-bordered chain rosettes, open centres darker
    # than the coat, white belly and chin, black stripes on cheeks and neck, banded tail.
    "jaguatirica": colours({"coat": "#c49a5a", "rosette": "#2a2220", "centre": "#a87436", "white": "#e3dccd",
                            "earin": "#d8cdb8", "nose": "#8c5a52", "mouth": "#2a2220",
                            "tail": ("stripes", "#c49a5a", "#2a2220", 2), "pad": "#3a2c28"}),
    # Ucides cordatus: carapace blue-grey to greyish brown, legs and claws orange-red to purplish,
    # with dark hair on the legs.
    "caranguejo-uca": colours({"shell": "#5d6f80", "claw": "#c4552e", "arm": "#b34a2d", "leg": "#c9643a",
                           "mouth": "#2b2523"}),
    # Dasypus novemcinctus: grey-brown shell with paler (yellowish) bands, pinkish-grey skin.
    "tatu-galinha": colours({"shell": "#6f6458", "band": "#a8977c", "skin": "#b7a08c", "ear": "#8a7666",
                     "nose": "#5e4c44", "leg": "#8f7c6c", "claw": "#3b3330"}),
    # Chelonoidis denticulatus (jabuti-tinga), the forest tortoise: a dark brown shell with yellow
    # to light-orange patches, black skin with yellow to light-orange scales on the head and
    # legs (Animália Park species sheet; Silva et al. 2022, GMR 21:gmr18977), yellowish plastron.
    "jabuti-tinga": colours({"shell": "#2e2925", "scute": "#d9a441", "rim": "#36302b", "plastron": "#c8ac70",
                             "skin": "#2c2724", "scale": "#e0a63a", "headtop": "#e8b84a", "nose": "#2a2422",
                             "claw": "#2a2422"}),
    # Rhinella (cururu): brown to olive-brown with darker blotches and warts, large pale parotoids,
    # cream belly.
    "sapo-cururu": colours({"coat": ("rows", ["#8b6a48", "#8b6a48", "#6e5236", "#8b6a48", "#97754f", "#7a5c3e",
                                       "#8b6a48", "#6a4f35", "#8b6a48", "#856446", "#6e5236", "#7d5e40",
                                       "#76583c", "#6a4f35", "#705339", "#664c33"]),
                     "wart": "#5e4630", "parotoid": "#b08a58", "belly": "#d6c4a0", "leg": "#7a5c3e",
                     "eyelid": "#7a5c3e", "mouth": "#3a2c22"}),
    # Tangara seledon: turquoise head, yellow-green nape, black back and wings edged blue-green,
    # orange rump, blue to turquoise underparts, black bill.
    "saira-sete-cores": colours({"head": "#2fb3a6", "throat": "#2d3b8a", "nape": "#a6c63a", "back": "#262626",
                                 "rump": "#e8892a", "belly": "#3aa6c4", "wing": "#2a3a3a", "tail": "#26302f",
                                 "bill": "#2a2a2a", "leg": "#4a4a4a"}),
    # Turdus rufiventris: olive-brown upperparts, rufous-orange belly, pale streaked throat, yellow bill.
    "sabia-laranjeira": colours({"head": "#76664f", "throat": ("stripes", "#cfc2a6", "#76664f", 2), "nape": "#76664f",
                                 "back": "#6f604b", "rump": "#6f604b", "belly": "#d7782f", "wing": "#665844",
                                 "tail": "#5e5140", "bill": "#c9a63a", "leg": "#8a7a68"}),
    # Aburria jacutinga: glossy blue-black, white crest and wing patch, red dewlap (blue at the
    # base), pale bluish bill with a dark tip, red legs.
    "jacutinga": colours({"plumage": "#22252e", "crest": "#dcdad2", "wingpatch": "#dedbd2", "wattle": "#c8322c",
                          "wattlebase": "#3b62a8", "bill": "#7f9fc4", "billtip": "#26262a", "leg": "#b8352c"}),
    # Platalea ajaja (WikiAves): pink, the wings and lower back strongly pink with reddish feathers
    # (the carmine shoulder), neck, breast and upper back paler, almost white; red legs; grey
    # spoon-shaped bill; the adult's bare grey head (greenish in the field guides).
    "colhereiro": colours({"plumage": "#e8a2b6", "shoulder": "#c9415f", "wing": "#de7f9b", "neck": "#f0d3da",
                           "face": "#a3ad94", "tail": "#e48c7c", "bill": "#8f978d", "leg": "#c8414b"}),
}

# Palette region order per model (cell i -> column i % 8, band i // 8).
ORDERS = {
    "capivara": ["coat", "belly", "muzzle", "nose", "ear", "leg", "eyewhite", "pupil"],
    "anta": ["coat", "belly", "snout", "nose", "ear", "rim", "mane", "hoof", "leg", "eyewhite", "pupil"],
    "cateto": ["coat", "collar", "mane", "snout", "nose", "ear", "leg", "eyewhite", "pupil"],
    "veado": ["coat", "head", "belly", "muzzle", "nose", "ear", "antler", "hoof", "leg", "tail", "eyewhite", "pupil"],
    "cachorro-do-mato": ["coat", "bib", "ear", "earin", "nose", "leg", "paw", "tailtip", "muzzle", "stripe", "eyewhite", "pupil"],
    "onca-parda": ["coat", "muzzle", "nose", "mouth", "ear", "earback", "paw", "tailtip", "eyewhite", "pupil"],
    "tapiti": ["coat", "earin", "nose", "mouth", "tail", "belly", "eyewhite", "pupil"],
    "jaguatirica": ["coat", "rosette", "centre", "white", "earin", "nose", "mouth", "tail", "pad", "eyewhite", "pupil"],
    "caranguejo": ["shell", "claw", "arm", "leg", "mouth", "eyewhite", "pupil"],
    "tatu": ["shell", "band", "skin", "ear", "nose", "leg", "claw", "eyewhite", "pupil"],
    "jabuti": ["shell", "scute", "rim", "plastron", "skin", "scale", "headtop", "nose", "claw", "eyewhite", "pupil"],
    "sapo": ["coat", "wart", "parotoid", "belly", "leg", "eyelid", "mouth", "eyewhite", "pupil"],
    "passaro": ["head", "throat", "nape", "back", "rump", "belly", "wing", "tail", "bill", "leg", "eyewhite", "pupil"],
    "jacutinga": ["plumage", "crest", "wingpatch", "wattle", "wattlebase", "bill", "billtip", "leg", "eyewhite", "pupil"],
    "colhereiro": ["plumage", "shoulder", "wing", "neck", "face", "tail", "bill", "leg", "eyewhite", "pupil"],
}

# Which species palettes each model gets (the first is embedded in the GLB).
MODEL_PALETTES = {
    "anta": ["anta", "anta-filhote"],
    "veado": ["veado-mateiro"],
    "caranguejo": ["caranguejo-uca"],
    "tatu": ["tatu-galinha"],
    "jabuti": ["jabuti-tinga"],
    "sapo": ["sapo-cururu"],
    "passaro": ["saira-sete-cores", "sabia-laranjeira"],
}

# The neck caps take the coat region of their model.
NECK = {"capivara": "coat", "anta": "coat", "cateto": "coat", "veado": "head", "cachorro-do-mato": "coat",
        "onca-parda": "coat", "tapiti": "coat", "jaguatirica": "coat", "caranguejo": "shell", "tatu": "skin",
        "jabuti": "skin", "sapo": "coat", "passaro": "head", "jacutinga": "plumage", "colhereiro": "plumage"}


# --------------------------------------------------------------------------- helpers

def kenney(name: str, model: str) -> K.Pet:
    return K.Pet.load(PETS / f"animal-{name}.glb", model)


def comp_of(pet: K.Pet, node: str, test) -> set[int]:
    """Component ids of `node` whose bounding box passes test(lo, hi)."""
    out = set()
    for comp, faces in pet.components(node).items():
        pts = [p for f in faces for p in f.p]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        if test(lo, hi):
            out.add(comp)
    return out


def by_cell(pet: K.Pet, mapping: dict) -> None:
    """Initial regions from the Kenney palette cells: {(col, band): region}."""
    for f in pet.faces:
        if f.sem is None and f.cell in mapping:
            f.sem = mapping[f.cell]


def eyes(pet: K.Pet, white: tuple = (1, 2)) -> None:
    """The Cube Pets eyes: the face components made of the white disc cell and the pupil cell (7, 3)."""
    for comp, faces in pet.components("body").items():
        cells = {f.cell for f in faces}
        if cells == {white, (7, 3)}:
            for f in faces:
                f.sem = "eyewhite" if f.cell == white else "pupil"


def stretch_back(pet: K.Pet, nodes, factor: float, legs_to: float | None = None) -> None:
    """Lengthens everything behind the body's middle (z < 0) by `factor`; moves the hind legs."""
    pet.transform(lambda f: f.node in nodes, lambda p: Vector((p.x, p.y, p.z * factor)) if p.z < 0 else p)
    for node in ("tail",):
        if node in pet.pivots and node not in nodes:
            back = pet.pivots[node].z * (factor - 1)
            pet.move_node(node, (0, 0, back))
    if legs_to is not None:
        for leg in ("leg-back-left", "leg-back-right"):
            pet.move_node(leg, (0, 0, legs_to - pet.pivots[leg].z))


def legs_split(pet: K.Pet, upper: str, lower: str, cut_y: float = 0.12) -> None:
    """Upper leg and foot (hoof, paw) as two regions, cut at `cut_y` above the ground."""
    pet.cut(lambda f: f.node in K.LEGS, (0, 1, 0), cut_y)
    pet.label(lambda f: f.node in K.LEGS and f.centre.y < cut_y, lower)
    pet.label(lambda f: f.node in K.LEGS and f.centre.y >= cut_y, upper)


def box(pet, node, lo, hi, sem, **kw):
    pet.add_box(node, lo, hi, sem, **kw)


def rot_x(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 3, "X")


def rot_z(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 3, "Z")


def rot_y(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 3, "Y")


def kenney_eyes(scale: float, centre_y: float, front_z: float, spread: float = 1.0, node: str = "head") -> list[K.Face]:
    """The Cube Pets eye pair (white disc and pupil, CC0, from the chick), scaled about its
    centre and moved to (0, centre_y, front_z): the same eyes on the custom models."""
    pet = kenney("chick", "eyes")
    faces = [f for f in pet.faces if f.node == "body" and f.cell in ((1, 2), (7, 3)) and f.centre.z > 0.62 and f.centre.y > 0.7]
    ys = [p.y for f in faces for p in f.p]
    cy = (min(ys) + max(ys)) / 2
    return [K.Face([Vector((p.x * scale * spread, centre_y + (p.y - cy) * scale, front_z + (p.z - 0.625) * scale + 0.004))
                    for p in f.p], f.uv, node, f.cell, "eyewhite" if f.cell == (1, 2) else "pupil") for f in faces]


def quad(pet: K.Pet, node: str, corners, sem: str, out=(0, 1, 0), lift: float = 0.0) -> None:
    """A flat patch facing `out` (its winding is fixed to match), lifted `lift` along it."""
    o = Vector(out).normalized()
    pts = [Vector(c) + o * lift for c in corners]
    f = K.Face(pts, [(0, 0)] * len(pts), node, None, sem, keep_v=False)
    if f.normal.dot(o) < 0:
        f.p.reverse()
    pet.faces.append(f)


# --------------------------------------------------------------------------- Kenney-based models

def capivara() -> K.Pet:
    pet = kenney("beaver", "capivara")
    pet.delete_node("tail")
    ears = comp_of(pet, "body", lambda lo, hi: lo.y > 1.15 and abs(lo.x) > 0.2)
    face = comp_of(pet, "body", lambda lo, hi: lo.z > 0.55 and hi.y < 0.95 and (hi.x - lo.x) < 0.45)
    pet.delete(lambda f: f.comp in ears or f.comp in face)  # round ears, nose, whisker pads, buck teeth
    eyes(pet)
    pet.label(lambda f: f.node == "body" and f.sem is None, "coat")
    pet.label(lambda f: f.node in K.LEGS, "leg")
    stretch_back(pet, ("body",), 1.25, legs_to=-0.34)
    # The capybara's deep, blunt, square muzzle: wide, tall, flat-fronted, sharp-edged (a bear's
    # is rounded and narrow), the nostrils two slits on its top front, a mouth line low in front.
    box(pet, "body", (-0.42, 0.30, 0.56), (0.42, 0.80, 0.92), "muzzle", bevel=0.02)
    for s in (-1, 1):
        box(pet, "body", (s * 0.14 - 0.06, 0.795, 0.80), (s * 0.14 + 0.06, 0.815, 0.88), "nose", bevel=0.0)
    box(pet, "body", (-0.20, 0.40, 0.915), (0.20, 0.425, 0.93), "nose", bevel=0.0)
    # Tiny rounded ears high on the head.
    for s in (-1, 1):
        box(pet, "body", (s * 0.30 - 0.07, 1.40, 0.38), (s * 0.30 + 0.07, 1.53, 0.50), "ear", bevel=0.03)
    # Pale underside.
    pet.cut(lambda f: f.node == "body" and f.sem == "coat", (0, 1, 0), 0.40)
    pet.label(lambda f: f.node == "body" and f.sem == "coat" and f.centre.y < 0.40, "belly")
    pet.split_head()
    return pet


def anta() -> K.Pet:
    pet = kenney("pig", "anta")
    ears = comp_of(pet, "body", lambda lo, hi: lo.y > 1.15)
    snout = comp_of(pet, "body", lambda lo, hi: lo.z > 0.6 and hi.y < 1.0 and (hi.x - lo.x) < 0.5)
    pet.delete(lambda f: f.comp in ears or f.comp in snout)
    eyes(pet)
    pet.label(lambda f: f.node == "body" and f.sem is None, "coat")
    stretch_back(pet, ("body",), 1.5, legs_to=-0.42)
    # Trunk (custom part): a short proboscis from the muzzle, under the eyes, pointing FORWARD
    # and a little down at the tip (8°), the dark nose disc at its end.
    box(pet, "body", (-0.19, 0.50, 0.58), (0.19, 0.76, 0.86), "snout", bevel=0.05)
    box(pet, "body", (-0.15, 0.52, 0.84), (0.15, 0.73, 1.06), "snout", bevel=0.045, rot=rot_x(8), about=(0, 0.63, 0.85))
    box(pet, "body", (-0.12, 0.535, 1.04), (0.12, 0.715, 1.09), "nose", bevel=0.02, rot=rot_x(8), about=(0, 0.63, 0.85))
    # Small rounded ears with the white rim (T. terrestris), and the low crest (crina) on the nape.
    for s in (-1, 1):
        box(pet, "body", (s * 0.38 - 0.09, 1.40, 0.34), (s * 0.38 + 0.09, 1.52, 0.44), "ear", bevel=0.055)
        box(pet, "body", (s * 0.38 - 0.095, 1.505, 0.335), (s * 0.38 + 0.095, 1.545, 0.445), "rim", bevel=0.018)
    box(pet, "body", (-0.06, 1.41, -0.15), (0.06, 1.47, 0.50), "mane", bevel=0.025)
    box(pet, "body", (-0.09, 0.98, -0.99), (0.09, 1.14, -0.90), "coat", bevel=0.02)  # tail stub
    pet.cut(lambda f: f.node == "body" and f.sem == "coat", (0, 1, 0), 0.42)
    pet.label(lambda f: f.node == "body" and f.sem == "coat" and f.centre.y < 0.42, "belly")
    by_cell(pet, {(0, 3): "leg", (2, 2): "hoof"})
    pet.split_head()
    return pet


def cateto() -> K.Pet:
    pet = kenney("hog", "cateto")
    tusks = comp_of(pet, "body", lambda lo, hi: lo.z > 0.4 and hi.y < 0.9 and abs(lo.x + hi.x) > 0.4)
    ridges = comp_of(pet, "body", lambda lo, hi: (hi.x - lo.x) > 1.3 and lo.y > 0.7)
    pet.delete(lambda f: f.comp in tusks or f.comp in ridges)
    eyes(pet)
    snout = comp_of(pet, "body", lambda lo, hi: lo.z > 0.6 and hi.y < 1.05 and (hi.x - lo.x) < 0.45 and (hi.x - lo.x) > 0.3)
    pet.label(lambda f: f.comp in snout, "snout")
    pet.label(lambda f: f.cell == (7, 3) and f.sem is None and f.centre.z > 0.8, "nose")
    ears = comp_of(pet, "body", lambda lo, hi: lo.y > 1.15)
    pet.label(lambda f: f.comp in ears and f.cell == (2, 3), "ear")
    pet.label(lambda f: f.node == "body" and f.sem is None, "coat")
    # Collar: the pale band behind the head on the sides and throat.
    pet.cut(lambda f: f.node == "body" and f.sem == "coat", (0, 0, 1), 0.08)
    pet.cut(lambda f: f.node == "body" and f.sem == "coat", (0, 0, 1), K.NECK_Z)
    pet.label(lambda f: f.node == "body" and f.sem == "coat" and 0.08 < f.centre.z < K.NECK_Z and f.normal.y < 0.6
              and f.centre.y < 1.38, "collar")
    box(pet, "body", (-0.08, 1.40, -0.62), (0.08, 1.55, 0.30), "mane", bevel=0.03)
    pet.label(lambda f: f.node in K.LEGS, "leg")
    pet.split_head()
    return pet


def veado() -> K.Pet:
    pet = kenney("deer", "veado")
    antlers = comp_of(pet, "body", lambda lo, hi: lo.y > 1.25 and (hi.x - lo.x) < 0.6)
    pet.delete(lambda f: f.comp in antlers)
    eyes(pet)
    by_cell(pet, {(2, 3): "belly"})
    muzzle = comp_of(pet, "body", lambda lo, hi: lo.z > 0.6 and hi.y < 0.95 and (hi.x - lo.x) > 0.4)
    nose = comp_of(pet, "body", lambda lo, hi: lo.z > 0.78)
    pet.label(lambda f: f.comp in nose, "nose")
    pet.label(lambda f: f.comp in muzzle and f.sem is None, "muzzle")
    pet.label(lambda f: f.node == "body" and f.sem is None, "coat")
    # Ears stick out at the cube's sides (|x| > 0.62).
    pet.label(lambda f: f.node == "body" and abs(f.centre.x) > 0.63 and f.centre.y > 1.0, "ear")
    # Spike antlers (Mazama americana males: short, unbranched, pointing back).
    for s in (-1, 1):
        box(pet, "body", (s * 0.22 - 0.035, 1.40, 0.40), (s * 0.22 + 0.035, 1.66, 0.47), "antler", bevel=0.012,
            rot=rot_x(-22), about=(s * 0.22, 1.42, 0.43))
    box(pet, "body", (-0.10, 1.00, -0.69), (0.10, 1.26, -0.60), "tail", bevel=0.02, rot=rot_x(-25), about=(0, 1.2, -0.62))
    by_cell(pet, {(3, 2): "hoof", (2, 2): "leg"})
    pet.split_head()
    pet.label(lambda f: f.node == "head" and f.sem == "coat", "head")
    return pet


def cachorro() -> K.Pet:
    pet = kenney("fox", "cachorro-do-mato")
    eyes(pet)
    muzzle = comp_of(pet, "body", lambda lo, hi: lo.z > 0.6 and hi.y < 0.95 and (hi.x - lo.x) > 0.4)
    pet.label(lambda f: f.comp in muzzle and f.cell == (3, 3), "muzzle")
    pet.label(lambda f: f.cell == (7, 3) and f.sem is None, "nose")
    pet.label(lambda f: f.node == "tail" and f.cell == (2, 3), "tailtip")
    pet.label(lambda f: f.node == "body" and f.cell == (2, 3), "earin")
    pet.label(lambda f: f.cell == (1, 2) and f.sem is None, "bib")
    pet.label(lambda f: f.node in ("body", "tail") and f.sem is None, "coat")
    pet.label(lambda f: f.node == "body" and f.sem == "coat" and f.centre.y > 1.43, "ear")
    by_cell(pet, {(3, 3): "leg", (3, 2): "paw"})
    # The black stripe along the back (UFRGS: "uma faixa de pelos pretos sobre o dorso").
    box(pet, "body", (-0.07, 1.42, -0.62), (0.07, 1.47, 0.28), "stripe", bevel=0.015)
    pet.split_head()
    return pet


def onca_parda() -> K.Pet:
    pet = kenney("lion", "onca-parda")
    mane = comp_of(pet, "body", lambda lo, hi: (hi.x - lo.x) > 1.5)
    pet.delete(lambda f: f.comp in mane)
    eyes(pet)
    nose = comp_of(pet, "body", lambda lo, hi: lo.z > 0.6 and hi.y < 0.95 and (hi.x - lo.x) < 0.26 and hi.z > 0.78)
    pet.label(lambda f: f.comp in nose, "nose")
    pet.label(lambda f: f.cell == (7, 3) and f.sem is None, "mouth")
    pet.label(lambda f: f.node == "body" and f.cell == (2, 3) and f.centre.y > 1.15, "ear")
    pet.label(lambda f: f.node == "body" and f.cell == (2, 3), "muzzle")
    pet.label(lambda f: f.node == "tail" and f.cell == (2, 2), "tailtip")
    ears = comp_of(pet, "body", lambda lo, hi: lo.y > 1.1 and (hi.x - lo.x) < 0.4)
    pet.label(lambda f: f.comp in ears and f.normal.z < -0.5, "earback")
    pet.label(lambda f: f.node in ("body", "tail") and f.sem is None, "coat")
    by_cell(pet, {(7, 2): "coat", (2, 3): "paw"})
    stretch_back(pet, ("body",), 1.2, legs_to=-0.3)
    pet.split_head()
    return pet


def tapiti() -> K.Pet:
    pet = kenney("bunny", "tapiti")
    ears = comp_of(pet, "body", lambda lo, hi: hi.y > 1.9)
    tufts = comp_of(pet, "body", lambda lo, hi: lo.y > 1.1 and hi.y < 1.55 and hi.z > 0.5 or (lo.y > 1.1 and hi.y < 1.55 and (hi.x - lo.x) < 0.33))
    pet.delete(lambda f: f.comp in tufts and f.comp not in ears)
    base = 1.12
    pet.transform(lambda f: f.comp in ears, lambda p: Vector((p.x, base + (p.y - base) * 0.62, p.z)) if p.y > base else p)
    eyes(pet)
    by_cell(pet, {(0, 3): "nose", (3, 2): "mouth", (2, 3): "earin"})
    pet.label(lambda f: f.sem is None, "coat")
    box(pet, "body", (-0.10, 0.40, -0.69), (0.10, 0.58, -0.60), "tail", bevel=0.03)
    pet.cut(lambda f: f.node == "body" and f.sem == "coat", (0, 1, 0), 0.38)
    pet.label(lambda f: f.node == "body" and f.sem == "coat" and f.centre.y < 0.38, "belly")
    pet.split_head()
    return pet


def jaguatirica() -> K.Pet:
    pet = kenney("cat", "jaguatirica")
    eyes(pet, white=(7, 2))
    by_cell(pet, {(0, 2): "earin"})
    nose = comp_of(pet, "body", lambda lo, hi: lo.z > 0.55 and (hi.x - lo.x) < 0.2)
    pet.label(lambda f: f.comp in nose, "nose")
    pet.label(lambda f: f.node == "body" and f.cell == (7, 3) and f.sem is None, "mouth")
    pet.label(lambda f: f.node in K.LEGS and f.cell == (7, 3), "pad")
    pet.label(lambda f: f.node == "tail", "tail")
    pet.label(lambda f: f.sem is None, "coat")
    # White chin, throat and belly.
    pet.cut(lambda f: f.node == "body" and f.sem == "coat", (0, 1, 0), 0.36)
    pet.label(lambda f: f.node == "body" and f.sem == "coat" and f.centre.y < 0.36, "white")
    # Rosettes: open chains along the flanks, stripes on the neck and cheeks, spots on the back,
    # head and legs, as flat patches just above the coat (the cube's faces are flat inside
    # its bevel). Smaller and more elongated than the onça's (custom-rosetas-onca).
    for s in (-1, 1):
        for (z, y, w, h) in ((-0.40, 0.66, 0.28, 0.18), (-0.10, 0.70, 0.28, 0.18), (0.17, 0.66, 0.20, 0.18),
                             (-0.38, 1.02, 0.26, 0.16), (-0.08, 1.04, 0.26, 0.16), (0.16, 1.01, 0.20, 0.16)):
            _rosette_side(pet, s, z, y, w, h)
        x = s * 0.625
        for (z0, z1, y) in ((0.30, 0.56, 1.20), (0.33, 0.58, 0.98)):
            quad(pet, "body", [(x, y, z0), (x, y, z1), (x, y + 0.05, z1), (x, y + 0.05, z0)], "rosette", (s, 0, 0), 0.007)
    for (x0, z0) in ((-0.30, -0.42), (0.12, -0.36), (-0.14, -0.06), (0.18, 0.04), (-0.26, 0.20), (0.06, 0.44)):
        y = 1.431
        quad(pet, "body", [(x0, y, z0), (x0 + 0.14, y, z0), (x0 + 0.14, y, z0 + 0.09), (x0, y, z0 + 0.09)], "rosette",
             (0, 1, 0), 0.007)
    for leg in K.LEGS:
        p = pet.pivots[leg]
        for s in (-1, 1):
            x = p.x + s * 0.1875
            for (y, dz) in ((-0.13, -0.02),):
                yy, zz = p.y + y, p.z + dz
                quad(pet, leg, [(x, yy, zz - 0.04), (x, yy, zz + 0.04), (x, yy + 0.05, zz + 0.04), (x, yy + 0.05, zz - 0.04)],
                     "rosette", (s, 0, 0), 0.007)
    pet.split_head()
    return pet


def _rosette_side(pet, s, z, y, w, h):
    """An open, elongated rosette on a flank: a centre a little darker than the coat inside four
    broken black bars."""
    t, g, x = 0.035, 0.03, s * 0.625

    def q(z0, y0, z1, y1, sem, lift):
        quad(pet, "body", [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)], sem, (s, 0, 0), lift)

    q(z - w / 2 + t, y - h / 2 + t, z + w / 2 - t, y + h / 2 - t, "centre", 0.006)
    q(z - w / 2 + g, y + h / 2 - t, z + w / 2 - g, y + h / 2, "rosette", 0.007)
    q(z - w / 2 + g * 2, y - h / 2, z + w / 2 - g, y - h / 2 + t, "rosette", 0.007)
    q(z - w / 2, y - h / 2 + g, z - w / 2 + t, y + h / 2 - g, "rosette", 0.007)
    q(z + w / 2 - t, y - h / 2 + g * 1.5, z + w / 2, y + h / 2 - g, "rosette", 0.007)


def caranguejo() -> K.Pet:
    pet = kenney("crab", "caranguejo")
    eyes(pet)
    claws = comp_of(pet, "body", lambda lo, hi: abs(lo.x + hi.x) > 1.2 and lo.y > 0.6)
    arms = comp_of(pet, "body", lambda lo, hi: abs(lo.x + hi.x) > 0.9 and hi.y < 0.8)
    pet.label(lambda f: f.comp in claws, "claw")
    pet.label(lambda f: f.comp in arms, "arm")
    pet.label(lambda f: f.cell == (7, 3) and f.sem is None, "mouth")
    pet.label(lambda f: f.node == "body" and f.sem is None, "shell")
    pet.label(lambda f: f.node in K.LEGS, "leg")
    # Four more walking legs (two a side, static, bent down): eight walking legs and the claws.
    for s in (-1, 1):
        for i, z in enumerate((-0.32, 0.06)):
            box(pet, "body", (s * 0.62, 0.36, z - 0.06), (s * 1.10, 0.46, z + 0.06), "leg", bevel=0.0,
                rot=rot_z(s * -28), about=(s * 0.62, 0.42, z))
    pet.split_head()
    return pet


def passaro() -> K.Pet:
    pet = kenney("chick", "passaro")
    tufts = comp_of(pet, "body", lambda lo, hi: lo.y > 1.2 and (hi.x - lo.x) < 0.4)
    pet.delete(lambda f: f.comp in tufts)
    eyes(pet)
    beak = comp_of(pet, "body", lambda lo, hi: lo.z > 0.5 and hi.y < 0.9 and (hi.x - lo.x) < 0.5)
    pet.label(lambda f: f.comp in beak, "bill")
    pet.label(lambda f: f.node in K.LEGS, "leg")
    pet.label(lambda f: f.node in ("wing-left", "wing-right"), "wing")
    pet.label(lambda f: f.sem is None, "back")
    # The tail: a flat block behind, a little raised.
    pet.pivots["tail"] = Vector((0, 0.72, -0.5))
    pet.parents["tail"] = "body"
    box(pet, "tail", (-0.20, 0.66, -1.12), (0.20, 0.78, -0.48), "tail", bevel=0.03, rot=rot_x(14), about=(0, 0.72, -0.5))
    # Regions: belly below y 0.62 (body space ~0.44), rump at the back, throat under the face.
    pet.cut(lambda f: f.node == "body" and f.sem == "back", (0, 1, 0), 0.75)
    pet.label(lambda f: f.node == "body" and f.sem == "back" and f.centre.y < 0.75, "belly")
    pet.label(lambda f: f.node == "body" and f.sem == "back" and f.centre.z < -0.6, "rump")
    pet.split_head()
    pet.label(lambda f: f.node == "head" and f.sem == "back", "head")
    # The breast is the lower front of the head block: belly colour below, a throat band under the bill.
    pet.cut(lambda f: f.node == "head" and f.sem == "belly", (0, 1, 0), 0.6)
    pet.label(lambda f: f.node == "head" and f.sem == "belly" and f.centre.y > 0.6, "throat")
    pet.cut(lambda f: f.node == "body" and f.sem == "back", (0, 0, 1), 0.0)
    pet.label(lambda f: f.node == "body" and f.sem == "back" and f.centre.z > 0.0, "nape")
    return pet


def jacutinga() -> K.Pet:
    pet = kenney("parrot", "jacutinga")
    beak = comp_of(pet, "body", lambda lo, hi: lo.z > 0.5 and hi.y < 0.95 and (hi.x - lo.x) < 0.5)
    pet.delete(lambda f: f.comp in beak)
    eyes(pet)
    crest = comp_of(pet, "body", lambda lo, hi: lo.y > 1.3)
    pet.label(lambda f: f.comp in crest, "crest")
    for wing in ("wing-left", "wing-right"):
        pet.label(lambda f, w=wing: f.node == w and f.cell == (1, 3) and f.centre.z > -0.02, "wingpatch")
    pet.label(lambda f: f.node in K.LEGS, "leg")
    pet.label(lambda f: f.sem is None, "plumage")
    # A short, straight cracid bill, the bare dewlap hanging under it.
    box(pet, "body", (-0.12, 0.66, 0.60), (0.12, 0.84, 0.86), "bill", bevel=0.03)
    box(pet, "body", (-0.08, 0.68, 0.84), (0.08, 0.80, 0.94), "billtip", bevel=0.025)
    box(pet, "body", (-0.13, 0.54, 0.60), (0.13, 0.66, 0.74), "wattlebase", bevel=0.03)
    box(pet, "body", (-0.11, 0.30, 0.60), (0.11, 0.56, 0.72), "wattle", bevel=0.04)
    pet.split_head()
    return pet


def colhereiro() -> K.Pet:
    """Platalea ajaja (colhereiro): pink, the wings deeper pink with a carmine shoulder, a paler
    neck and breast, the bare grey-green head, red legs, and the flat spoon-shaped grey bill
    (custom part), long wading legs."""
    pet = kenney("parrot", "colhereiro")
    beak = comp_of(pet, "body", lambda lo, hi: lo.z > 0.5 and hi.y < 0.95 and (hi.x - lo.x) < 0.5)
    crest = comp_of(pet, "body", lambda lo, hi: lo.y > 1.3)
    pet.delete(lambda f: f.comp in beak or f.comp in crest)
    eyes(pet)
    # Wing tops: the carmine shoulder in front, deeper pink behind.
    for wing in ("wing-left", "wing-right"):
        pet.label(lambda f, w=wing: f.node == w and f.cell == (1, 3) and f.centre.z > -0.02, "shoulder")
        pet.label(lambda f, w=wing: f.node == w and f.sem is None, "wing")
    pet.label(lambda f: f.node == "tail", "tail")
    pet.label(lambda f: f.node in K.LEGS, "leg")
    pet.label(lambda f: f.sem is None, "plumage")
    # Long wading legs: the Kenney leg block 3x longer and half as thick; the body rises.
    rise = 0.6
    for leg in ("leg-front-left", "leg-front-right"):
        piv = pet.pivots[leg]
        pet.transform(lambda f, l=leg: f.node == l,
                      lambda p, c=piv: Vector((c.x + (p.x - c.x) * 0.45, c.y + (p.y - c.y) * 3.0, c.z + (p.z - c.z) * 0.45)))
        pet.move_node(leg, (0, rise, 0))
    for node in ("body", "tail", "wing-left", "wing-right"):
        pet.move_node(node, (0, rise, 0))
    # The spoon bill (custom part): a straight shaft, then the flat, wide, rounded spoon, tilted down 12°.
    y, z = 0.66 + rise, 0.60
    r = rot_x(12)
    box(pet, "body", (-0.08, y - 0.05, z), (0.08, y + 0.05, z + 0.56), "bill", bevel=0.02, rot=r, about=(0, y, z))
    box(pet, "body", (-0.21, y - 0.045, z + 0.50), (0.21, y + 0.045, z + 0.86), "bill", bevel=0.04, rot=r, about=(0, y, z))
    pet.split_head()
    # The bare head: the face (the block's front) above the throat; the rest of the head and the
    # throat are pale feathered neck.
    pet.cut(lambda f: f.node == "head" and f.sem == "plumage", (0, 1, 0), 0.62 + rise)
    pet.label(lambda f: f.node == "head" and f.sem == "plumage" and f.centre.y > 0.62 + rise and f.normal.z > 0.5, "face")
    pet.label(lambda f: f.node == "head" and f.sem == "plumage", "neck")
    # Neck, breast and upper back paler: the body's front half.
    pet.label(lambda f: f.node == "body" and f.sem == "plumage" and f.centre.z > 0.0, "neck")
    return pet


# --------------------------------------------------------------------------- custom models


def _custom(name: str, head_pivot) -> K.Pet:
    pet = K.Pet(name)
    pet.pivots["root"] = Vector()
    pet.pivots["body"] = Vector((0, 0.18125, 0))
    pet.parents["body"] = "root"
    pet.pivots["head"] = Vector(head_pivot)
    pet.parents["head"] = "body"
    return pet


def _legs(pet: K.Pet, hip_x: float, hip_y: float, hip_z_front: float, hip_z_back: float, width: float,
          sem: str, foot: str, foot_h: float = 0.05, depth: float | None = None) -> None:
    """Four Cube Pets legs: one bevelled block each hanging from its hip, the foot (claws,
    nails) cut off as its own region."""
    for name, x, z in (("leg-front-left", hip_x, hip_z_front), ("leg-front-right", -hip_x, hip_z_front),
                       ("leg-back-left", hip_x, hip_z_back), ("leg-back-right", -hip_x, hip_z_back)):
        pet.pivots[name] = Vector((x, hip_y, z))
        pet.parents[name] = "root"
        d, w = (depth or width) / 2, width / 2
        box(pet, name, (x - w, 0.0, z - d), (x + w, hip_y + 0.01, z + d), sem, bevel=0.03)
    pet.cut(lambda f: f.node in K.LEGS, (0, 1, 0), foot_h)
    pet.label(lambda f: f.node in K.LEGS and f.centre.y < foot_h, foot)


def tatu() -> K.Pet:
    """Dasypus novemcinctus: a low body under a shell of a front shield, about nine movable
    bands and a rear shield; a long snout, upright ears, small eyes, a long ringed tail."""
    pet = _custom("tatu", (0, 0.50, 0.64))
    _legs(pet, 0.26, 0.24, 0.30, -0.36, 0.17, "leg", "claw", 0.05)
    box(pet, "body", (-0.46, 0.22, 0.12), (0.46, 0.86, 0.66), "shell", bevel=0.08)
    zs = [0.12 - 0.075 * i for i in range(10)]
    for i in range(9):
        box(pet, "body", (-0.48, 0.20, zs[i + 1]), (0.48, 0.90, zs[i]), "band" if i % 2 == 0 else "shell", bevel=0.0)
    box(pet, "body", (-0.46, 0.22, -1.10), (0.46, 0.84, -0.55), "shell", bevel=0.08)
    box(pet, "head", (-0.20, 0.30, 0.62), (0.20, 0.68, 0.92), "skin", bevel=0.05)
    box(pet, "head", (-0.13, 0.30, 0.90), (0.13, 0.52, 1.18), "skin", bevel=0.04)
    box(pet, "head", (-0.08, 0.30, 1.16), (0.08, 0.42, 1.30), "nose", bevel=0.03)
    for s in (-1, 1):
        box(pet, "head", (s * 0.13 - 0.05, 0.64, 0.66), (s * 0.13 + 0.05, 0.88, 0.74), "ear", bevel=0.0,
            rot=rot_z(s * -12), about=(s * 0.13, 0.66, 0.70))
    pet.add_faces(kenney_eyes(0.4, 0.60, 0.92, spread=0.9))
    pet.pivots["tail"] = Vector((0, 0.52, -1.08))
    pet.parents["tail"] = "body"
    zt = -1.08
    for i, (length, t) in enumerate(((0.32, 0.18), (0.30, 0.13), (0.30, 0.09))):
        box(pet, "tail", (-t / 2, 0.52 - t / 2 - i * 0.07, zt - length), (t / 2, 0.52 + t / 2 - i * 0.07, zt + 0.02),
            "band" if i % 2 == 0 else "shell", bevel=0.02, rot=rot_x(-8), about=(0, 0.52, -1.08))
        zt -= length
    return pet


def jabuti() -> K.Pet:
    """Chelonoidis denticulatus (jabuti-tinga): a high blocky dome, dark with yellow-orange scute
    centres, a yellowish plastron, yellow-orange scales on the head and legs."""
    pet = _custom("jabuti", (0, 0.40, 0.62))
    _legs(pet, 0.42, 0.26, 0.40, -0.40, 0.24, "scale", "claw", 0.05)
    box(pet, "body", (-0.62, 0.16, -0.72), (0.62, 0.28, 0.72), "plastron", bevel=0.05)
    box(pet, "body", (-0.66, 0.26, -0.74), (0.66, 0.50, 0.74), "rim", bevel=0.07)
    box(pet, "body", (-0.56, 0.48, -0.62), (0.56, 0.78, 0.62), "shell", bevel=0.08)
    box(pet, "body", (-0.40, 0.76, -0.46), (0.40, 0.96, 0.46), "shell", bevel=0.07)
    for z in (-0.28, 0.0, 0.28):
        quad(pet, "body", [(-0.09, 0.96, z - 0.08), (-0.09, 0.96, z + 0.08), (0.09, 0.96, z + 0.08), (0.09, 0.96, z - 0.08)],
             "scute", (0, 1, 0), 0.004)
    for s in (-1, 1):
        for z in (-0.36, 0.0, 0.36):
            x = s * 0.56
            quad(pet, "body", [(x, 0.56, z - 0.09), (x, 0.56, z + 0.09), (x, 0.70, z + 0.09), (x, 0.70, z - 0.09)], "scute",
                 (s, 0, 0), 0.004)
            xx = s * 0.48
            quad(pet, "body", [(xx - 0.05, 0.78, z - 0.07), (xx - 0.05, 0.78, z + 0.07), (xx + 0.05, 0.78, z + 0.07),
                               (xx + 0.05, 0.78, z - 0.07)], "scute", (0, 1, 0), 0.004)
        for z in (-0.5, -0.17, 0.17, 0.5):
            x = s * 0.66
            quad(pet, "body", [(x, 0.33, z - 0.07), (x, 0.33, z + 0.07), (x, 0.43, z + 0.07), (x, 0.43, z - 0.07)], "scute",
                 (s, 0, 0), 0.004)
    box(pet, "head", (-0.13, 0.22, 0.56), (0.13, 0.44, 0.84), "skin", bevel=0.04)
    box(pet, "head", (-0.19, 0.26, 0.80), (0.19, 0.58, 1.14), "skin", bevel=0.05)
    box(pet, "head", (-0.17, 0.56, 0.84), (0.17, 0.62, 1.10), "headtop", bevel=0.02)
    box(pet, "head", (-0.10, 0.30, 1.12), (0.10, 0.40, 1.17), "nose", bevel=0.015)
    pet.add_faces(kenney_eyes(0.36, 0.48, 1.14, spread=0.85))
    box(pet, "body", (-0.06, 0.24, -0.86), (0.06, 0.34, -0.70), "skin", bevel=0.02)  # tail
    return pet


def sapo() -> K.Pet:
    """Rhinella (cururu): squat and broad, warty, big parotoid glands behind the eyes; it sits
    on straight forelegs with the hind legs folded beside it."""
    pet = _custom("sapo", (0, 0.40, 0.32))
    for name, x, z in (("leg-front-left", 0.30, 0.30), ("leg-front-right", -0.30, 0.30)):
        pet.pivots[name] = Vector((x, 0.30, z))
        pet.parents[name] = "root"
        box(pet, name, (x - 0.07, 0.04, z - 0.07), (x + 0.07, 0.31, z + 0.07), "leg", bevel=0.025)
        box(pet, name, (x - 0.10, 0.0, z - 0.06), (x + 0.10, 0.05, z + 0.13), "leg", bevel=0.015)
    for name, x, z in (("leg-back-left", 0.48, -0.26), ("leg-back-right", -0.48, -0.26)):
        pet.pivots[name] = Vector((x, 0.30, z))
        pet.parents[name] = "root"
        box(pet, name, (x - 0.12, 0.10, z - 0.30), (x + 0.12, 0.34, z + 0.16), "leg", bevel=0.04)
        box(pet, name, (x - 0.10, 0.0, z + 0.02), (x + 0.10, 0.06, z + 0.34), "leg", bevel=0.02)
    box(pet, "body", (-0.50, 0.16, -0.58), (0.50, 0.70, 0.36), "coat", bevel=0.10)
    box(pet, "body", (-0.40, 0.14, -0.50), (0.40, 0.20, 0.34), "belly", bevel=0.03)
    for s in (-1, 1):
        box(pet, "body", (s * 0.30 - 0.11, 0.64, -0.02), (s * 0.30 + 0.11, 0.78, 0.34), "parotoid", bevel=0.05)
    for (x, z) in ((0.18, -0.30), (-0.20, -0.22), (0.02, -0.05), (0.32, -0.10), (-0.34, -0.40), (0.10, -0.46),
                   (-0.10, 0.16), (0.36, -0.42)):
        box(pet, "body", (x - 0.05, 0.68, z - 0.05), (x + 0.05, 0.74, z + 0.05), "wart", bevel=0.0)
    box(pet, "head", (-0.46, 0.18, 0.30), (0.46, 0.62, 0.72), "coat", bevel=0.09)
    box(pet, "head", (-0.38, 0.15, 0.32), (0.38, 0.20, 0.66), "belly", bevel=0.02)
    for s in (-1, 1):
        box(pet, "head", (s * 0.27 - 0.11, 0.58, 0.40), (s * 0.27 + 0.11, 0.74, 0.62), "eyelid", bevel=0.04)
    box(pet, "head", (-0.32, 0.30, 0.71), (0.32, 0.33, 0.73), "mouth", bevel=0.0)
    pet.add_faces(kenney_eyes(0.5, 0.52, 0.72, spread=1.1))
    return pet


BUILDERS = {
    "capivara": capivara, "anta": anta, "cateto": cateto, "veado": veado, "cachorro-do-mato": cachorro,
    "onca-parda": onca_parda, "tapiti": tapiti, "jaguatirica": jaguatirica, "caranguejo": caranguejo,
    "tatu": tatu, "jabuti": jabuti, "sapo": sapo, "passaro": passaro, "jacutinga": jacutinga, "colhereiro": colhereiro,
}

BUDGET = 1000


def build(name: str, pack: bool, render: bool) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    pet = BUILDERS[name]()
    pet.label(lambda f: f.sem == "neck", NECK[name])
    pet.label(lambda f: f.sem is None, "?")
    cells = pet.assign_cells(ORDERS[name])
    palettes = MODEL_PALETTES.get(name, [name])
    for species in palettes:
        K.write_palette(SKINS_DIR / f"palette-{species}.png", cells, PALETTES[species])
    material = K.palette_material(palettes[0], SKINS_DIR / f"palette-{palettes[0]}.png")
    top = pet.build(material)
    raw = RAW_OUT / f"bicho-{name}.glb"
    C.export_glb(raw, top)
    tris = pet.tris()
    report = {"model": name, "tris": tris, "budget": BUDGET, "nodes": pet.stats(), "palettes": palettes,
              "cells": {k: list(v) for k, v in cells.items()}}
    (RAW_OUT / f"bicho-{name}.json").write_text(json.dumps(report, indent=1))
    if tris > BUDGET:
        raise SystemExit(f"[gate] {name}: {tris} tris > {BUDGET}")
    if pack:
        out = MODELS_DIR / f"{name}.glb"
        subprocess.run(["pnpm", "dlx", "gltfpack@1.3.0", "-i", str(raw), "-o", str(out), "-cc", "-kn", "-vtf", "-vpf"],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        report["bytes"] = out.stat().st_size
    if render:
        _render(name, top, RAW_OUT / f"bicho-{name}.png")
    print(f"[gate] {name}: {tris} tris {pet.stats()} ok")
    return report


def _render(name: str, top, png: Path) -> None:
    sc = bpy.context.scene
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else engines[0]
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x, sc.render.resolution_y = 640, 360
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.55, 0.62, 0.6)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 3.6
    files = []
    for tag, pos in (("a", (3.2, -4.2, 2.2)), ("b", (5.0, 0.0, 1.0))):
        cam.location = Vector(pos)
        cam.rotation_euler = (Vector((0, 0, 0.75)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        f = png.with_name(png.stem + f"-{tag}.png")
        sc.render.filepath = str(f)
        bpy.ops.render.render(write_still=True)
        files.append(f)


if __name__ == "__main__":
    flags = C.argv_flags()
    names = [a for a in flags if not a.startswith("--")] or list(BUILDERS)
    reports = [build(n, pack="--no-pack" not in flags, render="--render" in flags) for n in names]
    print("[gate] total", sum(r["tris"] for r in reports))
