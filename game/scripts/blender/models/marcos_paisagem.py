"""
Landmark assemblies (inventory p22 section 7, priority 7; game/PARK.md sections 4.1, 4.2, 5.2):
the Copa observation tower, the guará bird hide and the Cachoeira Grande rock wall. <= 1,500
tris each (ART.md section 4, landmark).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/marcos_paisagem.py [-- --no-render] [-- only=<name>]

Files (in $CUSTOM_RAW_DIR; bake.py prefixes them with custom-):

- torre-observacao.glb (C4 "A torre", at (272, -100)): a four-legged timber tower whose deck is
  12 u up (the climb), 5 u square, with a rail 1.2 u high, a thatched pyramid roof (eaves 15.2 u,
  apex 18.1 u) and a vertical ladder on the front face. The legs lean in from a 5.2 u footprint;
  three tiers of ring beams and crossed braces. It is the casa's family (same deck, rails,
  ladder and thatch), built from primitives in the proportions of Kenney's Pirate Kit
  `structure`/`structure-roof` stilt huts (CC0, reference only, no geometry reused); the
  Pirate `tower-watch` is a stone castle turret and would not read as a canopy tower.
  Ladder (LadderSpec feet positions, glTF axes, also exported as empties):
  ladder-base (0, 0, 3.2), ladder-top (0, 12.0, 3.2), ladder-exit (0, 12.0, 1.2), radius 0.85.
  The ladder plane is z = 2.85, 0.35 u in front of the deck's front edge (z = 2.5).

- observatorio-aves.glb (M5 "Os guarás", the hide at (52, 282)): a low plank hut 5 x 3.4 u on
  short stilts (floor 0.9 u up, for the mangrove mud), walls to 4.6 u, a long viewing slot in the
  front wall at the avatar's eye height (floor + 2.0 to 2.7 u), a door and two steps at the back,
  a bench inside, palm fronds leaning on the front wall as camouflage, and the same thatched
  gable roof. The slot faces glTF +z: turn it towards the guarás' feeding flat.

- cachoeira-grande-paredao.glb (the Vale's landmark, PARK.md 4.1, fall y 50 -> 30): a rock wall
  that frames a 20 u waterfall: a forward-leaning table-rock caprock whose flat top is the lip, 20 u
  above the pool, over a recessed stack; flanks that rise to about 24 u; outcrops at the pool's edge. Assembled from the five
  formations of "Stylized Rocks Formation Asset Pack" by Gebus (deadzik), CC BY 4.0
  (https://sketchfab.com/3d-models/726e8563eb634c529410f4e00857bbb3), already used by
  decor/rock-deadzik-*.glb: each piece is welded, decimated to the budget, scaled uniformly
  (never stretched) and rotated, its textures dropped, and its faces recoloured by facing and
  height to the rock ramp (wet rock[0] band at the pool and behind the fall, rock[1]/rock[2]
  sides, rock[3] lit ledges) with moss tops (grass[1], grass[2], leaf[1]). Flat shading.
  The origin is at the pool's surface below the fall. Empties: queda-topo (0, 20.0, -0.85), the
  centre of the lip where the water sheet starts, and queda-base (0, 0, -0.85), where it lands;
  the sheet is about 7 u wide (the notch between the flanks). The waterfall sheet itself
  (decor/ground-waterfall.glb stretched to 20 u, PARK.md) and its spray stay separate.

Colours: ramps only (wood, soil, rock, leaf, grass).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
import _common as C  # noqa: E402
import _props as P  # noqa: E402
from _props import A, G, L, R, W  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402


# --------------------------------------------------------------------------- shared: thatch roofs


def gable_roof(m: C.Mesh, half_x: float, half_y: float, eave: float, ridge: float, *, fringe: int = 9) -> None:
    """The casa's thatched gable roof (ridge along X): two layers per slope, a ragged fringe at
    each eave, a ridge cap and triangular gable boards."""
    for sy in (-1, 1):
        for layer, (over, lift, top) in enumerate([(0.6, 0.0, W[2]), (0.45, 0.2, W[3])]):
            p_eave = Vector((0, sy * (half_y + over), eave - 0.18 * (1 - layer) + lift - over * 0.55))
            p_ridge = Vector((0, 0, ridge + lift))
            width = 2 * half_x + (1.1 if layer == 0 else 0.8)
            d = p_ridge - p_eave
            up = Vector((0, -d.z, d.y))
            if up.z < 0:
                up = -up
            m.box((p_eave + p_ridge) / 2, (width, d.length, 0.22), W[2], rot=P.basis(d, up), colours={"top": top})
            if layer == 0:
                edge = p_eave - up.normalized() * 0.11
                for k in range(fringe):
                    x0 = -width / 2 + width * k / fringe
                    x1 = x0 + width / fringe
                    drop = 0.34 if k % 2 else 0.24
                    tip = Vector(((x0 + x1) / 2, edge.y + sy * 0.04, edge.z - drop))
                    m.add_out([(x0, edge.y, edge.z), (x1, edge.y, edge.z), tip], W[3], (0, 0, edge.z))
    m.box((0, 0, ridge + 0.3), (2 * half_x + 1.0, 0.36, 0.22), W[0], colours={"top": W[1]})
    for sx in (-1, 1):
        x = sx * half_x
        m.add_out([(x, -half_y, eave), (x, half_y, eave), (x, 0, ridge - 0.05)], W[1], (0, 0, eave + 0.4))


def pyramid_roof(m: C.Mesh, half: float, eave: float, apex: float, *, fringe: int = 7) -> None:
    """A thatched hip roof on a square plan: a wide lower skirt, an upper cone, a ragged fringe."""
    r = lambda h: h * math.sqrt(2)  # noqa: E731  (square prism: radius of the corners)
    lower_top = eave + (apex - eave) * 0.5
    m.prism((0, 0, eave - 0.25), (0, 0, lower_top), r(half + 0.8), r(half * 0.62), 4, W[2], cap0=True,
            cap1=False, colour_cap=W[1], twist=math.pi / 4)
    m.prism((0, 0, lower_top - 0.35), (0, 0, apex), r(half * 0.72), 0.0, 4, W[3], twist=math.pi / 4)
    h = half + 0.8
    for side in range(4):
        rot = Matrix.Rotation(side * math.pi / 2, 3, "Z")
        for k in range(fringe):
            x0 = -h + 2 * h * k / fringe
            x1 = x0 + 2 * h / fringe
            drop = 0.36 if k % 2 else 0.26
            pts = [rot @ Vector((x0, -h, eave - 0.25)), rot @ Vector((x1, -h, eave - 0.25)),
                   rot @ Vector(((x0 + x1) / 2, -h - 0.04, eave - 0.25 - drop))]
            m.add_out(pts, W[3], (0, 0, eave))
    m.box((0, 0, apex + 0.1), (0.3, 0.3, 0.5), W[0], skip=("bottom",), colours={"top": W[1]})


def ladder(m: C.Mesh, y: float, top: float, half: float = 0.65, pitch: float = 0.45) -> None:
    for sx in (-1, 1):
        m.box((sx * half, y, (top + 0.8) / 2), (0.14, 0.16, top + 0.8), W[1], skip=("bottom",), colours={"top": W[2]})
    z = 0.35
    while z < top - 0.1:
        P.beam(m, (-half, y, z), (half, y, z), 0.11, 0.11, W[2], ends=False, colours={"top": W[3]})
        z += pitch


def rail_square(m: C.Mesh, edge: float, deck: float, opening: float | None) -> None:
    """Handrail and mid rail on four sides of a square deck; the front (-Y) side open in the
    middle when `opening` is given."""
    rail = deck + 1.2
    for sx in (-1, 1):  # left and right
        x = sx * edge
        P.beam(m, (x, -edge, rail), (x, edge, rail), 0.16, 0.14, W[2], ends=False, colours={"top": W[3]})
        P.beam(m, (x, -edge, deck + 0.55), (x, edge, deck + 0.55), 0.1, 0.12, W[1], ends=False)
    P.beam(m, (-edge, edge, rail), (edge, edge, rail), 0.16, 0.14, W[2], ends=False, colours={"top": W[3]})
    P.beam(m, (-edge, edge, deck + 0.55), (edge, edge, deck + 0.55), 0.1, 0.12, W[1], ends=False)
    if opening is None:
        P.beam(m, (-edge, -edge, rail), (edge, -edge, rail), 0.16, 0.14, W[2], ends=False, colours={"top": W[3]})
        P.beam(m, (-edge, -edge, deck + 0.55), (edge, -edge, deck + 0.55), 0.1, 0.12, W[1], ends=False)
        return
    for sx in (-1, 1):
        a, b = sx * edge, sx * opening
        P.beam(m, (a, -edge, rail), (b, -edge, rail), 0.16, 0.14, W[2], ends=False, colours={"top": W[3]})
        P.beam(m, (a, -edge, deck + 0.55), (b, -edge, deck + 0.55), 0.1, 0.12, W[1], ends=False)
        P.post(m, b, -edge, deck, rail + 0.15, 0.2, W[1], top=W[2])


# --------------------------------------------------------------------------- tower

T_DECK = 12.0
T_FOOT = 2.6
T_TOP = 2.05
T_EDGE = 2.3
T_LADDER_Y = -2.85


def build_tower():
    m = C.Mesh("torre-observacao")

    def leg_at(sx, sy, z):
        t = z / (T_DECK - 0.4)
        return Vector((sx * (T_FOOT + (T_TOP - T_FOOT) * t), sy * (T_FOOT + (T_TOP - T_FOOT) * t), z))

    for sx in (-1, 1):
        for sy in (-1, 1):
            P.beam(m, leg_at(sx, sy, 0.0), leg_at(sx, sy, T_DECK - 0.4), 0.42, 0.42, W[0], ends=False,
                   up=Vector((sx, sy, 0)), colours={"top": W[1]})
    levels = [0.25, 3.9, 7.8, T_DECK - 0.75]
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for li, z in enumerate(levels):
        for i in range(4):
            a, b = corners[i], corners[(i + 1) % 4]
            if li > 0:
                P.beam(m, leg_at(*a, z), leg_at(*b, z), 0.26, 0.3, W[1], ends=False, colours={"top": W[2]})
            if li < len(levels) - 1:
                z1 = levels[li + 1]
                out = Vector(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0)).normalized()
                for p0, p1 in ((leg_at(*a, z), leg_at(*b, z1)), (leg_at(*b, z), leg_at(*a, z1))):
                    P.beam(m, p0 + out * 0.05, p1 + out * 0.05, 0.16, 0.18, W[1], ends=False, up=out)
    # Deck, joists and the cab.
    P.plank_floor(m, (0, 0, T_DECK), 5.0, 5.0, 0.35, 10, along="x")
    for y in (-1.6, 1.6):
        P.beam(m, (-2.7, y, T_DECK - 0.5), (2.7, y, T_DECK - 0.5), 0.3, 0.3, W[0], colours={"top": W[1]})
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.post(m, sx * T_EDGE, sy * T_EDGE, T_DECK, 15.3, 0.26, W[1], cap=False)
    rail_square(m, T_EDGE, T_DECK, opening=0.85)
    pyramid_roof(m, T_EDGE, 15.2, 18.1)
    # Ladder up the front, with two stand-off brackets to the legs' ring beams.
    ladder(m, T_LADDER_Y, T_DECK)
    for z in (3.9, 7.8):
        y_leg = -(T_FOOT + (T_TOP - T_FOOT) * z / (T_DECK - 0.4))
        for sx in (-1, 1):
            P.beam(m, (sx * 0.65, T_LADDER_Y + 0.06, z), (sx * 0.65, y_leg + 0.13, z), 0.1, 0.1, W[0], ends=False)
    ob = C.build_object(m, "torre-observacao")
    base_y = T_LADDER_Y - 0.35
    for name, loc in (("ladder-base", (0, base_y, 0)), ("ladder-top", (0, base_y, T_DECK)),
                      ("ladder-exit", (0, base_y + 2.0, T_DECK))):
        C.empty(name, loc, parent=ob)
    return ob


# --------------------------------------------------------------------------- bird hide

H_FLOOR = 0.9
H_TOP = 4.6
H_X = 2.5
H_Y = 1.7


def build_hide():
    m = C.Mesh("observatorio-aves")
    # Floor on short stilts.
    P.plank_floor(m, (0, 0, H_FLOOR), 2 * H_X + 0.2, 2 * H_Y + 0.2, 0.25, 7, along="x")
    for x in (-H_X, 0.0, H_X):
        for y in (-H_Y, H_Y):
            P.post(m, x, y, 0.0, H_FLOOR - 0.25, 0.26, W[0], cap=False)
    # Corner posts.
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.post(m, sx * H_X, sy * H_Y, H_FLOOR, H_TOP + 0.1, 0.26, W[0], cap=False)
    t = 0.14
    slot0, slot1 = H_FLOOR + 2.0, H_FLOOR + 2.7
    # Front wall (-Y): lower panel, viewing slot with a sill, upper panel.
    m.box((0, -H_Y, (H_FLOOR + slot0) / 2), (2 * H_X, t, slot0 - H_FLOOR), W[1], skip=("bottom",),
          colours={"top": W[2], "ny": W[1]})
    m.box((0, -H_Y - 0.05, slot0 + 0.04), (2 * H_X, 0.34, 0.08), W[2], skip=("bottom",), colours={"top": W[3]})
    m.box((0, -H_Y, (slot1 + H_TOP) / 2), (2 * H_X, t, H_TOP - slot1), W[1], skip=("top",), colours={"bottom": W[0]})
    # Back wall (+Y) with a doorway in the middle.
    door = 0.6
    for sx in (-1, 1):
        cx = sx * (door + (H_X - door) / 2)
        m.box((cx, H_Y, (H_FLOOR + H_TOP) / 2), (H_X - door, t, H_TOP - H_FLOOR), W[1], skip=("top", "bottom"),
              colours={"py": W[2]})
    m.box((0, H_Y, H_TOP - 0.45), (2 * door, t, 0.9), W[1], skip=("top",), colours={"py": W[2]})
    # Side walls.
    for sx in (-1, 1):
        m.box((sx * H_X, 0, (H_FLOOR + H_TOP) / 2), (t, 2 * H_Y, H_TOP - H_FLOOR), W[1], skip=("top", "bottom"),
              colours={"px" if sx > 0 else "nx": W[2]})
    # Bench inside, along the front wall.
    m.box((0, -H_Y + 0.45, H_FLOOR + 0.55), (2 * H_X - 0.6, 0.5, 0.12), W[2], colours={"top": W[3]})
    # Two steps up to the door at the back.
    for k, (dy, h) in enumerate(((0.95, 0.3), (0.5, 0.6))):
        m.box((0, H_Y + dy, h / 2), (1.4, 0.45, h), W[1], skip=("bottom",), colours={"top": W[2] if k else W[3]})
    gable_roof(m, H_X, H_Y, H_TOP, H_TOP + 1.4, fringe=8)
    # Camouflage: palm fronds leaning on the front wall (folded strips, like the juçara's).
    for k, x in enumerate((-2.0, -1.15, -0.25, 0.65, 1.5, 2.15)):
        lean = 0.3 * (1 if k % 2 else -1)
        top = slot0 - 0.1 - 0.3 * (k % 2)
        path = [(x, -H_Y - 0.75, 0.0), (x + lean * 0.4, -H_Y - 0.45, top * 0.45), (x + lean * 0.8, -H_Y - 0.22, top * 0.8),
                (x + lean, -H_Y - 0.14, top)]
        m.frond(path, [0.12, 0.62, 0.5, 0.0], [0.0, 0.1, 0.08, 0.0], G[1] if k % 2 else L[1], colour_under=L[0],
                normal_hint=Vector((0, -1, 0)))
    return C.build_object(m, "observatorio-aves")


# --------------------------------------------------------------------------- Cachoeira Grande wall

DEADZIK = C.CACHE / "downloads-v2" / "sketchfab" / "rocks-formation-deadzik" / "rocks-formation-deadzik.glb"
LIP = 20.0

# (rock 1..5, target tris, height u, yaw deg, tilt about X deg, (x, y, z of the base centre))
# Rock 1 stacked slabs, 2 rounded boulder, 3 stack with an arch, 4 table rock, 5 three pillars.
# The fall pours off the front edge of the table rock's flat top (a resistant caprock), over a
# recessed stack behind the falling water; the flanks stand in front and frame the notch.
WALL = [
    (5, 140, 22.0, 0, 0, (0.0, 19.0, 0.0)),       # back mass: closes every gap behind the notch
    (4, 120, 7.2, 0, 16, (0.0, 4.6, 14.25)),      # caprock leaning out: its flat top is an overhanging lip
    (1, 130, 12.0, 30, 0, (0.0, 10.5, 0.0)),      # recessed stack behind the falling water
    (5, 170, 18.0, 20, 0, (-11.5, 5.0, 0.0)),     # left flank: tall pillars
    (3, 120, 8.0, 35, 0, (-11.5, 7.5, 16.0)),     # left flank cap
    (2, 170, 15.0, 160, 0, (13.0, 6.0, 0.0)),     # right flank: big boulder
    (1, 130, 10.0, 90, 0, (12.5, 8.5, 13.0)),     # right flank cap
    (4, 70, 4.0, 40, 0, (-6.6, -5.0, 0.0)),       # outcrop at the pool, left
    (2, 70, 3.4, 220, 0, (7.0, -5.6, 0.0)),       # outcrop at the pool, right
]


def _load_deadzik():
    """The five formations, welded and normalised: height 1, base centred at the origin.
    Returns {index: (bmesh-free list of triangles as Vector triples, source tris)}."""
    import bmesh

    objs = C.import_glb(DEADZIK)
    bpy.context.view_layer.update()
    out = {}
    for o in objs:
        if o.type != "MESH":
            continue
        idx = int(o.name.split("_")[0].replace("MRock", ""))
        me = o.data.copy()
        me.transform(o.matrix_world)
        bm = bmesh.new()
        bm.from_mesh(me)
        lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
        hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
        s = 1.0 / (hi.z - lo.z)
        base = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        for v in bm.verts:
            v.co = (v.co - base) * s
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.004)
        bm.to_mesh(me)
        bm.free()
        for layer in list(me.uv_layers):
            me.uv_layers.remove(layer)
        out[idx] = me
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return out


def _decimated_tris(me, target: int) -> list:
    ob = bpy.data.objects.new("tmp-rock", me)
    bpy.context.scene.collection.objects.link(ob)
    src = sum(len(p.vertices) - 2 for p in me.polygons)
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.ratio = min(1.0, target / src)
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    em = ev.to_mesh()
    tris = []
    for p in em.polygons:
        vs = [em.vertices[i].co.copy() for i in p.vertices]
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    return tris


def _rock_colour(n: Vector, c: Vector, salt: int) -> str:
    wet = abs(c.x) < 4.5 and c.z < LIP + 0.5 and c.y < 12.0  # behind and beside the falling water
    if n.z > 0.55:  # moss on the tops and ledges
        if c.z < 1.5 or (wet and c.z < LIP - 0.5):
            return R[1]
        return (G[1], G[2], L[1])[salt % 3]
    if n.z > 0.25:  # lit ledges
        return R[1] if wet else (R[3] if salt % 3 else R[2])
    if n.z < -0.35:
        return R[0]
    if c.z < 2.2 or wet:  # the wet band at the pool and the rock behind the water
        return R[0] if salt % 2 else R[1]
    if c.z < 10.0:
        return R[1] if salt % 3 else R[2]
    return R[2] if salt % 3 else R[1]


def build_wall():
    rocks = _load_deadzik()
    m = C.Mesh("cachoeira-grande-paredao")
    used = {}
    for i, (idx, target, height, yaw, tilt, pos) in enumerate(WALL):
        key = (idx, target)
        if key not in used:
            used[key] = _decimated_tris(rocks[idx].copy(), target)
        mat = (Matrix.Translation(pos) @ Matrix.Rotation(math.radians(yaw), 4, "Z")
               @ Matrix.Rotation(math.radians(tilt), 4, "X") @ Matrix.Scale(height, 4))
        for j, tri in enumerate(used[key]):
            pts = [mat @ v for v in tri]
            nrm = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            if nrm.length < 1e-9:
                continue
            nrm.normalize()
            c = sum(pts, Vector()) / 3
            m.add(pts, _rock_colour(nrm, c, (j * 7 + i * 3) % 11))
    for me in rocks.values():
        bpy.data.meshes.remove(me)
    # Nothing below the pool surface (bake.py's AO plane is at z = 0).
    lo = min(v.z for v in m.verts)
    if lo < 0:
        for k, v in enumerate(m.verts):
            if v.z < 0:
                m.verts[k] = Vector((v.x, v.y, 0.0))
    ob = C.build_object(m, "cachoeira-grande-paredao")
    lip_y, base_y = _lip(m)
    C.empty("queda-topo", (0, lip_y, LIP), parent=ob)
    C.empty("queda-base", (0, base_y, 0.0), parent=ob)
    return ob


def _lip(m: C.Mesh) -> tuple[float, float]:
    """The lip: walking along x = 0 from the front (Blender -Y), the first point whose top is
    within 1.2 u of LIP is the caprock's front edge; the sheet falls vertically from just in
    front of it. Checks that no rock in the notch below pokes through that plane."""
    from mathutils.bvhtree import BVHTree

    bvh = BVHTree.FromPolygons([tuple(v) for v in m.verts], [f for f in m.faces])
    lip_y, lip_z = None, None
    y = -12.0
    while y < 15.0:
        hit = bvh.ray_cast(Vector((0, y, 60)), Vector((0, 0, -1)), 200.0)[0]
        if hit is not None and hit.z >= LIP - 1.2:
            lip_y, lip_z = y, hit.z
            break
        y += 0.05
    sheet_y = lip_y - 0.25

    def front_y(x, z):
        hit = bvh.ray_cast(Vector((x, -60, z)), Vector((0, 1, 0)), 200.0)
        return hit[0].y if hit[0] is not None else 99.0

    samples = [(front_y(x, z), x, z) for x in (-2.5, 0.0, 2.5) for z in [0.5 + 1.0 * k for k in range(int(lip_z) - 1)]]
    below, bx, bz = min(samples)
    print("[wall] front of the notch by height: " + ", ".join(f"z{z:.0f}:{y:.1f}" for y, x, z in samples if x == 0.0))
    print(f"[wall] lip front edge y={lip_y:.2f}, top z={lip_z:.2f}; sheet plane y={sheet_y:.2f}; nearest rock "
          f"in the notch below y={below:.2f} ({'behind' if below > sheet_y else 'POKES THROUGH'})")
    return sheet_y, sheet_y


def preview_wall(glb: Path, png: Path) -> Path:
    """The wall with a placeholder 20 u water sheet and pool (preview only, not exported),
    next to the avatar block, from the front."""
    C.reset_scene()
    C.setup_cycles(96)
    C.art_light(sun_azimuth_deg=-30)
    objs = C.import_glb(glb)
    C.lambertise(objs)
    bpy.context.view_layer.update()
    tops = {o.name.split(".")[0]: o.matrix_world.translation.copy() for o in objs if o.type == "EMPTY"}
    t, b = tops.get("queda-topo", Vector((0, 5, LIP))), tops.get("queda-base", Vector((0, 3, 0)))
    sheet = C.Mesh("agua")
    sheet.add([(-3.5, b.y, 0.0), (3.5, b.y, 0.0), (3.5, t.y, t.z), (-3.5, t.y, t.z)], A[2])
    sheet.add([(-9, -9, 0.05), (9, -9, 0.05), (9, b.y + 0.5, 0.05), (-9, b.y + 0.5, 0.05)], A[1])
    C.build_object(sheet, "agua-preview", material=C.diffuse_material("agua", use_attr=True))
    props = C.measuring_props(-17.0, -7.0, rod_height=4)
    C.ground(size=400)
    C.frame_camera(objs + props, azimuth_deg=-18.0, elevation_deg=8.0, lens=40.0, res=(1400, 1000), margin=0.05)
    return C.render(png, 96)


if __name__ == "__main__":
    flags = C.argv_flags()
    only = next((f.split("=", 1)[1] for f in flags if f.startswith("only=")), None)
    items = [
        ("torre-observacao", build_tower, 1500, "deck 12.0 u, apex 18.1 u, 5.2 u footprint",
         {"elevation_deg": 10.0, "res": (900, 1200), "azimuth_deg": -30.0}),
        ("observatorio-aves", build_hide, 1500, "5 x 3.4 u hide, floor 0.9 u, slot at floor +2.0..2.7 u",
         {"elevation_deg": 14.0, "res": (1100, 900), "azimuth_deg": -30.0}),
    ]
    for name, build, budget, target, kw in items:
        if only in (None, name):
            C.run(build, name=name, budget=budget, target=target, preview_kw=kw)
    if only in (None, "cachoeira-grande-paredao"):
        C.run(build_wall, name="cachoeira-grande-paredao", budget=1500,
              target="lip 20 u above the pool, flanks to about 24 u", preview=preview_wall)
