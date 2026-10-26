"""
Bichos da Costa: the coast animals of Praia e Costão the P23 set lacks (PARK.md section 5.1;
praia-layout.ts homes and pools), built in the Cube Pets style of bichos_mata.py: bevelled
blocks, the Kenney Cube Pets eyes (CC0), one 64 x 64 palette per species, rigid rig nodes.

Run (headless Blender; reuses bichos_mata.py's helpers, read-only):

    blender -b --factory-startup -P game/scripts/blender/models/bichos_costa.py [-- <name> ... | --no-pack | --render]

For each model it writes, like bichos_mata.py:
- bicho-<name>.glb and .json (triangles per node) to $CUSTOM_RAW_DIR;
- game/src/assets/models/<name>.glb through gltfpack 1.3.0 (-cc -kn -vtf -vpf), unless --no-pack,
  then the animation clips below (_clips.py);
- game/src/assets/skins/palette-<species>.png.

Models (glTF axes: y up, facing +z, +x the animal's left, feet at y = 0):
- caranguejo-de-pedra: Pachygrapsus transversus, the small grapsid crab of the rocky shore. A
  flat, square carapace with transverse ridges, eyes on short stalks at its front corners, two
  small equal claws and four walking legs a side. Rig as the uçá (quadruped slots): root > body;
  root > leg-front-left/right (the two front walking legs of each side), leg-back-left/right
  (the two hind ones), so the animator's crab gait works unchanged.
- sargentinho: a juvenile Abudefduf saxatilis, the tide-pool fish. A tall, flattened body with
  five dark bars over a yellow back and pale belly, dorsal and anal fins, a forked tail. Rig:
  root > body > tail (pivot at the tail's base), so a swim swish is one rotation about y.
- atoba: Sula leucogaster (atobá-pardo). gaivotao: Larus dominicanus (gaivotão). Bird rig
  (rigs.ts BIRD_NODES): root > body > head, tail, wing-left, wing-right; root > leg-front-left,
  leg-front-right. Long, narrow wings modelled spread, so the rest pose is the glide and the
  game's wingbeat (a roll about z) flaps them.

Clips (glTF animations, linear, only node rotations; the game may use them or not):
- atoba, gaivotao: "perch" (one key: each wing turned back along its flank, upper side out:
  the rest pose cannot be the perch, since the runtime's folded wing, a -72 deg roll, would
  hang these long wings below the feet) and "glide" (4 s: a slight dihedral and a slow bank).
- sargentinho: "swim" (0.8 s: the tail swishes +-25 deg about y, the body counters 6 deg).

Species colours (ART.md section 2: animal colours may leave the ramps, lightness 12-90%):
- Pachygrapsus transversus: carapace 10-13 mm, colour very variable for camouflage, from light
  brown to dark green, up to shiny black (UFRGS Fauna Digital do RS,
  https://www.ufrgs.br/faunadigitalrs/pachygrapsus-transversus/ ); on rocky shores just above
  or below the water, hiding in crevices; recorded on the SP coast (Ubatuba, São Vicente,
  Cananéia; Mantelatto et al. 2020). -> dark olive-green shell, paler transverse ridges (the
  species name), olive legs.
- Abudefduf saxatilis (sargentinho): densely occupies the rocky shores of the South-East and
  South of Brazil (Peixes de Costão Rochoso de Santa Catarina,
  https://repositorio.uac.pt/server/api/core/bitstreams/c6fa2c32-6784-4496-8180-d1a369bf2845/content ).
  Five dark vertical bars on a yellowish back and silvery-white flanks: TODO-SOURCE for the
  juvenile's bars (the SC guide's juvenile text needs checking) before a Guia entry ships.
- Sula leucogaster: 64-85 cm, span 132-155 cm; dark brown with a white belly; bill pale yellow
  (female, pinkish tip) or yellow with a bluish eye ring (male); feet yellowish; Brazilian
  coasts, nests in ground colonies (WikiAves, https://www.wikiaves.com.br/wiki/atoba-pardo ).
  The white underwing band is drawn from field-guide plates: TODO-SOURCE.
- Larus dominicanus: about 58 cm; back and upper wings black, head and underparts white; bill
  yellow with a red spot near its tip; legs greenish-yellow; estuaries and beaches, generalist
  and opportunistic diet (WikiAves, https://www.wikiaves.com.br/wiki/gaivotao ). The white
  trailing edge of the wing: TODO-SOURCE.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _clips as Q  # noqa: E402
import _common as C  # noqa: E402
import _pets_kit as K  # noqa: E402
import bichos_mata as B  # noqa: E402
from bichos_mata import box, colours, kenney_eyes, rot_x, rot_y, rot_z  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

MODELS_DIR = B.MODELS_DIR
SKINS_DIR = B.SKINS_DIR
RAW_OUT = B.RAW_OUT
BUDGET = B.BUDGET

PALETTES = {
    "caranguejo-de-pedra": colours({"shell": "#3d4a2e", "ridge": "#6f7c4a", "claw": "#56603a", "clawtip": "#2c2a26",
                                    "leg": "#4b5734", "stalk": "#3d4a2e"}),
    "sargentinho": colours({"back": "#d9be3c", "belly": "#d6dbd5", "bar": "#26282c", "fin": "#a9a580",
                            "tail": "#b6ad6a", "snout": "#c7ad3a"}),
    "atoba-pardo": colours({"plumage": "#4a3727", "belly": "#e4e0d6", "underwing": "#e4e0d6", "bill": "#d8cd7c",
                            "billtip": "#c9a998", "foot": "#d3c35c", "wing": "#433223"}),
    "gaivotao": colours({"plumage": "#e8e6e0", "back": "#26282b", "wing": "#26282b", "edge": "#e8e6e0",
                         "underwing": "#dcdad4", "bill": "#e3c23a", "billspot": "#c8322c", "leg": "#b5b45c"}),
}

ORDERS = {
    "caranguejo-de-pedra": ["shell", "ridge", "claw", "clawtip", "leg", "stalk", "eyewhite", "pupil"],
    "sargentinho": ["back", "belly", "bar", "fin", "tail", "snout", "eyewhite", "pupil"],
    "atoba": ["plumage", "belly", "underwing", "bill", "billtip", "foot", "wing", "eyewhite", "pupil"],
    "gaivotao": ["plumage", "back", "wing", "edge", "underwing", "bill", "billspot", "leg", "eyewhite", "pupil"],
}

MODEL_PALETTES = {"atoba": ["atoba-pardo"]}


def _pet(name: str) -> K.Pet:
    pet = K.Pet(name)
    pet.pivots["root"] = Vector()
    pet.pivots["body"] = Vector((0, 0.18125, 0))
    pet.parents["body"] = "root"
    return pet


def _node(pet: K.Pet, name: str, pivot, parent: str) -> None:
    pet.pivots[name] = Vector(pivot)
    pet.parents[name] = parent


def _side_eye(pet: K.Pet, node: str, centre, scale: float, side: bool = True) -> None:
    """One Cube Pets eye each side (the chick's eye pair, split): with `side`, each eye turned to
    face out of its side (fish, birds) and moved to (±x, y, z) of `centre`; else facing +z
    there (the crab's eyes on their stalks)."""
    faces = kenney_eyes(scale, 0.0, 0.0, spread=1.0, node=node)
    for s in (1, -1):
        mine = [f for f in faces if f.centre.x * s > 0]
        cx = sum(p.x for f in mine for p in f.p) / sum(len(f.p) for f in mine)
        turn = rot_y(90 * s) if side else Matrix.Identity(3)
        for f in mine:
            pts = [turn @ Vector((p.x - cx, p.y, p.z)) + Vector((s * centre[0], centre[1], centre[2])) for p in f.p]
            pet.faces.append(K.Face(pts, f.uv, node, f.cell, f.sem))


# --------------------------------------------------------------------------- caranguejo-de-pedra

# Walking legs, front to back: each one's turn about y (deg; front pairs reach forward, hind ones back).
SPLAY = (30, 10, -10, -30)


def caranguejo_de_pedra() -> K.Pet:
    pet = _pet("caranguejo-de-pedra")
    # Carapace: flat and square, a little broader at the front (grapsid).
    box(pet, "body", (-0.48, 0.26, -0.40), (0.48, 0.46, 0.38), "shell", bevel=0.05)
    box(pet, "body", (-0.52, 0.30, 0.10), (0.52, 0.47, 0.42), "shell", bevel=0.05)
    for z in (-0.22, -0.04, 0.16):
        ridge = [(-0.38, 0.47, z - 0.035), (-0.38, 0.47, z + 0.035), (0.38, 0.47, z + 0.035), (0.38, 0.47, z - 0.035)]
        B.quad(pet, "body", ridge, "ridge", (0, 1, 0), 0.006)
    # Eyes on short stalks at the front corners.
    for s in (-1, 1):
        box(pet, "body", (s * 0.34 - 0.06, 0.44, 0.30), (s * 0.34 + 0.06, 0.60, 0.40), "stalk", bevel=0.02)
    _side_eye(pet, "body", (0.34, 0.66, 0.405), 0.3, side=False)
    # Two small, equal claws held in front (chelipeds: arm and claw).
    for s in (-1, 1):
        box(pet, "body", (s * 0.32 - 0.07, 0.25, 0.36), (s * 0.32 + 0.07, 0.35, 0.54), "claw", bevel=0.03,
            rot=rot_y(s * -25), about=(s * 0.32, 0.30, 0.40))
        box(pet, "body", (s * 0.22 - 0.09, 0.22, 0.50), (s * 0.22 + 0.09, 0.38, 0.66), "claw", bevel=0.03)
        box(pet, "body", (s * 0.18 - 0.05, 0.24, 0.64), (s * 0.18 + 0.05, 0.34, 0.72), "clawtip", bevel=0.015)
    # Four walking legs a side, spread out and bent down: thigh (out and up) and foot (down).
    zs = (0.22, 0.04, -0.14, -0.30)
    for side, s in (("left", 1), ("right", -1)):
        for pair, node in ((zs[:2], f"leg-front-{side}"), (zs[2:], f"leg-back-{side}")):
            _node(pet, node, (s * 0.46, 0.34, (pair[0] + pair[1]) / 2), "root")
            for z in pair:
                splay = SPLAY[zs.index(z)]
                r = rot_y(-s * splay)
                hip = Vector((s * 0.46, 0.34, z))
                x0, x1 = sorted((s * 0.40, s * 0.86))
                box(pet, node, (x0, 0.32, z - 0.045), (x1, 0.42, z + 0.045), "leg", bevel=0.0, rot=r @ rot_z(s * 18),
                    about=hip)
                knee = hip + r @ (rot_z(s * 18) @ Vector((s * 0.36, 0.04, 0)))
                box(pet, node, (knee.x - 0.04, 0.0, knee.z - 0.04), (knee.x + 0.04, knee.y + 0.03, knee.z + 0.04), "leg",
                    bevel=0.0, rot=rot_z(s * -14), about=(knee.x, knee.y, knee.z))
    return pet


# --------------------------------------------------------------------------- sargentinho

BARS = (0.2, 0.04, -0.12, -0.27, -0.42)
BAR_HALF = 0.045


def sargentinho() -> K.Pet:
    pet = _pet("sargentinho")
    # Tall, flattened body (the damselfish shape); a blunt snout.
    box(pet, "body", (-0.17, 0.14, -0.50), (0.17, 0.86, 0.32), "back", bevel=0.06)
    box(pet, "body", (-0.11, 0.36, 0.30), (0.11, 0.60, 0.42), "snout", bevel=0.04)
    pet.cut(lambda f: f.node == "body" and f.sem == "back", (0, 1, 0), 0.47)
    pet.label(lambda f: f.node == "body" and f.sem == "back" and f.centre.y < 0.47, "belly")
    for z in BARS:
        for edge in (z - BAR_HALF, z + BAR_HALF):
            pet.cut(lambda f: f.node == "body" and f.sem in ("back", "belly"), (0, 0, 1), edge)
    pet.label(lambda f: f.node == "body" and f.sem in ("back", "belly")
              and any(abs(f.centre.z - z) < BAR_HALF for z in BARS), "bar")
    # Fins: dorsal and anal, thin blocks.
    box(pet, "body", (-0.03, 0.84, -0.46), (0.03, 1.02, 0.14), "fin", bevel=0.0, rot=rot_x(-6), about=(0, 0.84, -0.1))
    box(pet, "body", (-0.03, 0.02, -0.44), (0.03, 0.16, -0.08), "fin", bevel=0.0)
    for s in (-1, 1):
        box(pet, "body", (s * 0.17 - 0.02, 0.36, 0.06), (s * 0.17 + 0.02, 0.50, 0.24), "fin", bevel=0.0,
            rot=rot_y(s * -25), about=(s * 0.17, 0.43, 0.2))
    _side_eye(pet, "body", (0.175, 0.62, 0.28), 0.34)
    # The tail: peduncle and a forked fin.
    _node(pet, "tail", (0, 0.5, -0.48), "body")
    box(pet, "tail", (-0.08, 0.38, -0.66), (0.08, 0.62, -0.46), "back", bevel=0.03)
    for s in (-1, 1):
        box(pet, "tail", (-0.03, 0.5 - 0.06, -0.98), (0.03, 0.5 + 0.06, -0.62), "tail", bevel=0.0,
            rot=rot_x(s * 32), about=(0, 0.5, -0.64))
    return pet


# --------------------------------------------------------------------------- seabirds


def _bird(name: str, *, body, head, bill, tail, wing_in, wing_out, legs, foot: str, drop: float = 0.0) -> K.Pet:
    """Common seabird blocks. Every argument is ((lo), (hi)) in model space; the wings are the
    left ones (mirrored), split at the wrist into arm and hand. `drop` lowers everything but
    the legs, which it shortens (seabirds stand on short legs)."""
    pet = _pet(name)
    box(pet, "body", *body, "plumage", bevel=0.06)
    _node(pet, "head", (0, head[0][1] + 0.08, head[0][2]), "body")
    box(pet, "head", *head, "plumage", bevel=0.05)
    for lo, hi, sem in bill:
        box(pet, "head", lo, hi, sem, bevel=0.02)
    _node(pet, "tail", (0, (tail[0][1] + tail[1][1]) / 2, tail[1][2]), "body")
    box(pet, "tail", *tail, "plumage", bevel=0.02)
    shoulder = (body[1][0], body[1][1] - 0.1, (wing_in[0][2] + wing_in[1][2]) / 2)
    for side, s in (("left", 1), ("right", -1)):
        node = f"wing-{side}"
        _node(pet, node, (s * shoulder[0], shoulder[1], shoulder[2]), "body")
        for lo, hi, sweep in ((wing_in[0], wing_in[1], 0), (wing_out[0], wing_out[1], 14)):
            a = Vector((s * lo[0], lo[1], lo[2]))
            b = Vector((s * hi[0], hi[1], hi[2]))
            wrist = Vector((s * wing_out[0][0], (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
            box(pet, node, (min(a.x, b.x), a.y, a.z), (max(a.x, b.x), b.y, b.z), "wing", bevel=0.02,
                rot=rot_y(s * sweep), about=wrist)
        leg = f"leg-front-{side}"
        (lx, lz), (ly1, w) = legs
        ly1 -= drop
        _node(pet, leg, (s * lx, ly1, lz), "root")
        box(pet, leg, (s * lx - w / 2, 0.03, lz - w / 2), (s * lx + w / 2, ly1 + 0.01, lz + w / 2), foot, bevel=0.015)
        box(pet, leg, (s * lx - w * 1.4, 0.0, lz - w * 0.6), (s * lx + w * 1.4, 0.05, lz + w * 2.6), foot, bevel=0.015)
    # The underside of each wing's inner part (arm) is the pale underwing.
    pet.label(lambda f: f.node.startswith("wing-") and f.normal.y < -0.7 and abs(f.centre.x) < wing_out[0][0], "underwing")
    _side_eye(pet, "head", (head[1][0] + 0.002, (head[0][1] + head[1][1]) / 2 + 0.06, head[1][2] - 0.13), 0.3)
    for node in ("body", "head", "tail", "wing-left", "wing-right"):
        pet.move_node(node, (0, -drop, 0))
    return pet


def atoba() -> K.Pet:
    pet = _bird(
        "atoba",
        body=((-0.27, 0.44, -0.56), (0.27, 0.94, 0.44)),
        head=((-0.17, 0.80, 0.40), (0.17, 1.14, 0.76)),
        bill=[((-0.10, 0.84, 0.72), (0.10, 1.04, 0.98), "bill"), ((-0.06, 0.86, 0.96), (0.06, 0.98, 1.18), "bill"),
              ((-0.04, 0.87, 1.16), (0.04, 0.95, 1.24), "billtip")],
        tail=((-0.13, 0.70, -1.06), (0.13, 0.80, -0.54)),
        wing_in=((0.27, 0.80, -0.20), (0.98, 0.88, 0.20)),
        wing_out=((0.98, 0.81, -0.18), (1.72, 0.87, 0.12)),
        legs=((0.13, -0.1), (0.46, 0.09)),
        foot="foot",
        drop=0.16,
    )
    # The white belly, sharply cut from the brown breast; brown upper wings.
    pet.cut(lambda f: f.node == "body", (0, 1, 0), 0.50)
    pet.cut(lambda f: f.node == "body", (0, 0, 1), 0.18)
    pet.label(lambda f: f.node == "body" and f.centre.y < 0.50 and f.centre.z < 0.18, "belly")
    return pet


def gaivotao() -> K.Pet:
    pet = _bird(
        "gaivotao",
        body=((-0.29, 0.44, -0.50), (0.29, 0.96, 0.42)),
        head=((-0.19, 0.84, 0.38), (0.19, 1.20, 0.74)),
        bill=[((-0.07, 0.90, 0.72), (0.07, 1.04, 0.98), "bill"), ((-0.06, 0.88, 0.96), (0.06, 1.02, 1.06), "bill")],
        tail=((-0.17, 0.72, -0.86), (0.17, 0.82, -0.48)),
        wing_in=((0.29, 0.82, -0.22), (0.98, 0.90, 0.20)),
        wing_out=((0.98, 0.83, -0.20), (1.66, 0.89, 0.12)),
        legs=((0.14, -0.08), (0.46, 0.08)),
        foot="leg",
        drop=0.1,
    )
    # The red spot under the bill near its tip (the lower mandible).
    box(pet, "head", (-0.065, 0.77, 0.92), (0.065, 0.83, 1.02), "billspot", bevel=0.01)
    # Black mantle: the back between the wings.
    pet.cut(lambda f: f.node == "body", (0, 1, 0), 0.76)
    pet.cut(lambda f: f.node == "body", (0, 0, 1), 0.24)
    pet.label(lambda f: f.node == "body" and f.centre.y > 0.76 and f.centre.z < 0.24, "back")
    # The white trailing edge of the wing.
    for side in ("left", "right"):
        pet.cut(lambda f, n=f"wing-{side}": f.node == n, (0, 0, 1), -0.15)
    pet.label(lambda f: f.node.startswith("wing-") and f.sem == "wing" and f.centre.z < -0.15, "edge")
    return pet


BUILDERS = {"caranguejo-de-pedra": caranguejo_de_pedra, "sargentinho": sargentinho, "atoba": atoba, "gaivotao": gaivotao}


# --------------------------------------------------------------------------- clips


def _fold(s: int) -> tuple:
    """A long wing turned back along its flank, upper side out (s = 1 the left wing): span
    (±x) to -z, the upper side (+y) to ±x, the leading edge (+z) to -y."""
    if s > 0:
        return Q.from_columns((0, 0, -1), (1, 0, 0), (0, -1, 0))
    return Q.from_columns((0, 0, 1), (-1, 0, 0), (0, -1, 0))


def clips_for(name: str) -> dict:
    import math

    if name in ("atoba", "gaivotao"):
        # Perch: wings folded, tilted 4 deg so the tips, past the tail, lie a little over it.
        perch = {"wing-left": ([0.0], [Q.mul(Q.axis_angle((1, 0, 0), -4), _fold(1))]),
                 "wing-right": ([0.0], [Q.mul(Q.axis_angle((1, 0, 0), -4), _fold(-1))])}
        # Glide: 6 deg dihedral, banking +-5 deg over 4 s (the whole bird rolls about z).
        glide = {
            "wing-left": ([0.0], [Q.axis_angle((0, 0, 1), 6)]),
            "wing-right": ([0.0], [Q.axis_angle((0, 0, 1), -6)]),
            "body": Q.loop(4.0, 8, lambda t: Q.axis_angle((0, 0, 1), 5 * math.sin(2 * math.pi * t))),
        }
        return {"perch": perch, "glide": glide}
    if name == "sargentinho":
        return {"swim": {
            "tail": Q.loop(0.8, 8, lambda t: Q.axis_angle((0, 1, 0), 25 * math.sin(2 * math.pi * t))),
            "body": Q.loop(0.8, 8, lambda t: Q.axis_angle((0, 1, 0), -6 * math.sin(2 * math.pi * t))),
        }}
    return {}


# --------------------------------------------------------------------------- build


def build(name: str, pack: bool, render: bool) -> dict:
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    pet = BUILDERS[name]()
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
    if tris > BUDGET:
        raise SystemExit(f"[gate] {name}: {tris} tris > {BUDGET}")
    if pack:
        out = MODELS_DIR / f"{name}.glb"
        subprocess.run(["pnpm", "dlx", "gltfpack@1.3.0", "-i", str(raw), "-o", str(out), "-cc", "-kn", "-vtf", "-vpf"],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        clips = clips_for(name)
        if clips:
            report["clips"] = Q.add_clips(out, clips)
        report["bytes"] = out.stat().st_size
    (RAW_OUT / f"bicho-{name}.json").write_text(json.dumps(report, indent=1))
    if render:
        B._render(name, top, RAW_OUT / f"bicho-{name}.png")
    print(f"[gate] {name}: {tris} tris {pet.stats()} clips {report.get('clips', {})} ok")
    return report


if __name__ == "__main__":
    flags = C.argv_flags()
    names = [a for a in flags if not a.startswith("--")] or list(BUILDERS)
    reports = [build(n, pack="--no-pack" not in flags, render="--render" in flags) for n in names]
    print("[gate] total", sum(r["tris"] for r in reports))
