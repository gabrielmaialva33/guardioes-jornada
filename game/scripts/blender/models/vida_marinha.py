"""
Coast animals for Praia e Costão (game/PARK.md section 5.1: P2 "Poças de maré", P3 "Tartaruga
no costão"; inventory p22 section 7, priority 6).

Run: /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/vida_marinha.py [-- --no-render]

Files (in $CUSTOM_RAW_DIR; bake.py prefixes them with custom-):
- tartaruga-verde.glb: a juvenile green turtle in a simple swim pose (front flippers spread
  and swept back mid-stroke, rear flippers trailing), 1.75 u long. <= 400 tris. Rigid named
  nodes like the Cube Pets (no skinning): the root `tartaruga-verde` is the shell (carapace and
  plastron), with children `head`, `flipper-front-left`, `flipper-front-right`,
  `flipper-back-left`, `flipper-back-right`, each pivot at its joint, so a swim loop can rotate
  them. The animal faces glTF +z; its left is +x, as in the Cube Pets.
- tartaruga-verde-linha.glb: the same turtle tangled in fishing line (P3: "call the rescue
  team, never touch it"): loops around the left front flipper (in that node) and the neck (in
  `head`), and a trailing strand with a cork float on the shell. <= 400 tris.
- ourico-do-mar.glb, estrela-do-mar.glb, anemona.glb: tide-pool animals, <= 60 tris each,
  vertex colour.

Scale: the turtle follows the animals' x1.5 (a 50-60 cm juvenile carapace is about 1.6-1.9 u).
The tide-pool animals would be 0.15-0.4 u at x1.5, so they are drawn at about x2-3 (urchin
0.55 u across with its spines, starfish 0.6 u, anemone 0.55 u across its tentacles), like the seeds, so a child can
find them in a pool.

Biology and colours (ART.md section 2: animal colours may leave the ramps, lightness 12-90%):
- Green turtle (Chelonia mydas): juveniles feed on algae along the rocky coast of São Paulo
  (PARK.md P3). Carapace olive-brown with radiating streaks, pale yellowish plastron, head and
  flippers with pale-edged scales; the name comes from the green fat, not the shell. Projeto
  TAMAR, https://www.tamar.org.br (tartaruga-verde). -> shell in the soil/wood ramps, plastron
  wood[3], skin rock[1]/rock[2] with rock[3] leading edges, eyes leaf[0]. Fishing line in
  water[2] (blue nylon), float wood[3] (cork).
- Ouriço-preto (Echinometra lucunter): the common urchin of the shallow rocky shore of south
  and south-east Brazil (UFSC, https://repositorio.ufsc.br/handle/123456789/241054), dark, hence
  "ouriço-preto/ouriço-negro" (IFSC). Species colours: spines #2b2230, test #3d2c3e (dark
  violet-black, lightness 15% and 21%).
- Estrela-do-mar (Echinaster brasiliensis): a fiery orange sea star common on Brazil's southern
  rocky shores (CEBIMar-USP, Migotto; Science Friday 2014,
  https://www.sciencefriday.com/articles/picture-of-the-week-growing-starfish); the genus is
  listed as Vulnerable in Brazil, a good "look, don't take" lesson. Species colours: #cf6a33 body,
  #a8522a sides, #e8935a tubercles.
- Anêmona (Bunodosoma caissarum): endemic to Brazil, collected on the São Paulo coast (São
  Vicente; Marine Drugs 2023, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10058367/). Its colours
  are simplified to a brown-olive column with paler wart rows (soil ramp) and a crown of pale
  green tentacles spreading out (leaf[3], grass[3]). TODO-SOURCE: check the colours against a field photo before its Guia da
  Mata entry ships.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as C  # noqa: E402
import _props as P  # noqa: E402
from _props import A, G, L, R, S, W  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

URCHIN_SPINE = "#2b2230"
URCHIN_TEST = "#3d2c3e"
STAR = "#cf6a33"
STAR_SIDE = "#a8522a"
STAR_KNOB = "#e8935a"
LINE = A[2]
CORK = W[3]

# --------------------------------------------------------------------------- turtle

SHELL_N = 12
RIM = (0.54, 0.68)  # carapace half-width (x) and half-length (y)


def _ellipse(sx, sy, z, n=SHELL_N, yoff=0.0):
    return [Vector((math.sin(2 * math.pi * k / n) * sx, -math.cos(2 * math.pi * k / n) * sy + yoff, z))
            for k in range(n)]


def shell(m: C.Mesh) -> None:
    rx, ry = RIM
    plast = _ellipse(rx * 0.78, ry * 0.86, 0.08)
    skirt = _ellipse(rx * 1.04, ry * 1.04, 0.15)
    rim = _ellipse(rx, ry, 0.2)
    mid = _ellipse(rx * 0.8, ry * 0.82, 0.38)
    top = _ellipse(rx * 0.42, ry * 0.5, 0.5, yoff=0.03)
    inside = Vector((0, 0, 0.28))
    n = SHELL_N
    for k in range(n):
        k1 = (k + 1) % n
        m.add_out([plast[k], plast[k1], skirt[k1], skirt[k]], W[3] if k % 2 else W[2], inside)
        m.add_out([skirt[k], skirt[k1], rim[k1], rim[k]], S[0] if k % 2 else S[1], inside)
        m.add_out([rim[k], rim[k1], mid[k1], mid[k]], S[1] if k % 2 else S[2], inside)
        m.add_out([mid[k], mid[k1], top[k1], top[k]], W[1] if k % 2 else S[2], inside)
    m.add(top, W[1])  # vertebral scutes (top cap, facing up)
    m.add(list(reversed(plast)), W[3])  # plastron


def flipper(m: C.Mesh, root: Vector, tip: Vector, chord0: float, chord1: float, thick: float,
            sweep: Vector, stations: int = 3) -> None:
    """A flattened paddle from root to tip: diamond sections (leading edge, top, trailing edge,
    bottom). `sweep` is the leading-edge direction at the root (the chord axis)."""
    axis = tip - root
    up = axis.cross(sweep).normalized()
    if up.z < 0:
        up = -up
    rings = []
    for i in range(stations + 1):
        t = i / stations
        c = root + axis * t
        ch = chord0 + (chord1 - chord0) * t
        th = thick * (1 - 0.6 * t)
        lead = sweep.normalized() * (ch * 0.45)
        rings.append([c + lead, c + up * th, c - lead * 1.2, c - up * th])
    centre = root + axis * 0.5
    cols = [R[3], R[1], R[2], R[2]]  # leading-top, trailing-top, trailing-bottom, leading-bottom
    for i in range(stations):
        a, b = rings[i], rings[i + 1]
        mid = root + axis * ((i + 0.5) / stations)
        for k in range(4):
            k1 = (k + 1) % 4
            m.add_out([a[k], a[k1], b[k1], b[k]], cols[k], mid)
    end = tip + axis.normalized() * 0.05
    for k in range(4):
        m.add_out([rings[-1][k], rings[-1][(k + 1) % 4], end], R[1], tip)
    m.add_out(list(rings[0]), R[2], centre)


HEAD_PIVOT = Vector((0, -0.62, 0.27))
FRONT_PIVOT = Vector((0.42, -0.36, 0.22))
BACK_PIVOT = Vector((0.33, 0.5, 0.2))


def head(m: C.Mesh) -> None:
    neck = HEAD_PIVOT + Vector((0, 0.08, 0))
    snout = HEAD_PIVOT + Vector((0, -0.36, 0.0))
    m.tube([neck, HEAD_PIVOT + Vector((0, -0.2, 0.01)), snout], [0.13, 0.15, 0.09], 6, R[1], cap_end=True,
           colours=[R[1], R[1], R[3]], twist=math.pi / 6)
    # Eyes.
    for sx in (-1, 1):
        e = snout + Vector((sx * 0.118, 0.1, 0.035))
        pts = [e + Vector((0, -0.035, -0.03)), e + Vector((0, 0.035, -0.03)), e + Vector((0, 0.035, 0.03)),
               e + Vector((0, -0.035, 0.03))]
        m.add(pts if sx > 0 else pts[::-1], L[0])


def front_flipper(m: C.Mesh, sx: int) -> None:
    root = Vector((sx * FRONT_PIVOT.x, FRONT_PIVOT.y, FRONT_PIVOT.z))
    tip = root + Vector((sx * 0.72, 0.42, -0.1))  # spread and swept back, mid-stroke
    flipper(m, root, tip, 0.44, 0.22, 0.065, Vector((0, -1, 0.05)))


def back_flipper(m: C.Mesh, sx: int) -> None:
    root = Vector((sx * BACK_PIVOT.x, BACK_PIVOT.y, BACK_PIVOT.z))
    tip = root + Vector((sx * 0.22, 0.32, -0.05))
    flipper(m, root, tip, 0.3, 0.2, 0.045, Vector((sx * 0.3, -1, 0)), stations=2)


def line_loop(m: C.Mesh, centre: Vector, axis: Vector, r: float, n: int = 6, tilt: float = 0.0) -> None:
    """A loop of fishing line around `axis` at `centre` (a 3-sided tube)."""
    rot = P.basis(axis)
    pts = []
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        p = Vector((math.cos(a) * r, math.sin(a) * tilt, math.sin(a) * r))
        pts.append(centre + rot @ Vector((p.x, p.y, p.z)))
    m.tube(pts, [0.016] * (n + 1), 3, LINE, cap_end=False)


def build_turtle(tangled: bool):
    def build():
        name = "tartaruga-verde-linha" if tangled else "tartaruga-verde"
        parts = {"body": C.Mesh(name), "head": C.Mesh("head")}
        shell(parts["body"])
        head(parts["head"])
        for sx, side in ((1, "left"), (-1, "right")):
            parts[f"flipper-front-{side}"] = C.Mesh(f"flipper-front-{side}")
            front_flipper(parts[f"flipper-front-{side}"], sx)
            parts[f"flipper-back-{side}"] = C.Mesh(f"flipper-back-{side}")
            back_flipper(parts[f"flipper-back-{side}"], sx)
        if tangled:
            fl = parts["flipper-front-left"]
            root = Vector((FRONT_PIVOT.x, FRONT_PIVOT.y, FRONT_PIVOT.z))
            axis = Vector((0.72, 0.42, -0.1))
            line_loop(fl, root + axis * 0.32, axis, 0.11, tilt=0.05)
            line_loop(fl, root + axis * 0.5, axis, 0.09, tilt=-0.06)
            line_loop(parts["head"], HEAD_PIVOT + Vector((0, -0.08, 0)), Vector((0, -1, -0.08)), 0.17, tilt=0.06)
            # Trailing strand over the shell to a cork float.
            b = parts["body"]
            strand = [Vector((0.45, -0.3, 0.3)), Vector((0.3, -0.05, 0.47)), Vector((0.12, 0.25, 0.5)),
                      Vector((0.2, 0.62, 0.4)), Vector((0.32, 0.95, 0.24))]
            b.tube(strand, [0.016] * len(strand), 3, LINE, cap_end=False)
            b.box(strand[-1] + Vector((0.0, 0.08, -0.02)), (0.12, 0.16, 0.12), CORK, colours={"top": CORK})
        # Rest the lowest point on z = 0 (bake.py's ground plane), keeping the pivots consistent.
        lo = min(v.z for msh in parts.values() for v in msh.verts)
        shift = Matrix.Translation((0, 0, -lo))
        for msh in parts.values():
            msh.transformed(shift)
        dz = Vector((0, 0, -lo))
        root = C.build_object(parts["body"], name, pivot=(0, 0, 0))
        C.build_object(parts["head"], "head", parent=root, pivot=HEAD_PIVOT + dz)
        for sx, side in ((1, "left"), (-1, "right")):
            C.build_object(parts[f"flipper-front-{side}"], f"flipper-front-{side}", parent=root,
                           pivot=Vector((sx * FRONT_PIVOT.x, FRONT_PIVOT.y, FRONT_PIVOT.z)) + dz)
            C.build_object(parts[f"flipper-back-{side}"], f"flipper-back-{side}", parent=root,
                           pivot=Vector((sx * BACK_PIVOT.x, BACK_PIVOT.y, BACK_PIVOT.z)) + dz)
        return root

    return build


# --------------------------------------------------------------------------- tide pools


def build_urchin():
    m = C.Mesh("ourico-do-mar")
    n = 6
    base = [Vector((math.cos(2 * math.pi * k / n) * 0.15, math.sin(2 * math.pi * k / n) * 0.125, 0.0)) for k in range(n)]
    top = [Vector((math.cos(2 * math.pi * k / n + 0.5) * 0.085, math.sin(2 * math.pi * k / n + 0.5) * 0.07, 0.13))
           for k in range(n)]
    ctr = Vector((0, 0, 0.06))
    for k in range(n):
        k1 = (k + 1) % n
        m.add_out([base[k], base[k1], top[k]], URCHIN_TEST, ctr)
        m.add_out([base[k1], top[k1], top[k]], URCHIN_TEST, ctr)
    m.add(top, URCHIN_TEST)
    # Spines: 14 three-sided spikes radiating from the test (golden-angle spread, upper half).
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(14):
        t = (i + 0.5) / 14
        z = 0.95 - 0.85 * t
        rr = math.sqrt(max(0.0, 1 - z * z))
        a = golden * i
        d = Vector((math.cos(a) * rr * 1.1, math.sin(a) * rr, z * 0.8 + 0.15)).normalized()
        c = Vector((d.x * 0.12, d.y * 0.1, 0.06 + d.z * 0.06))
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(d).normalized()
        r = 0.022
        tri = [c + side * r, c + up * r - side * r * 0.5, c - up * r - side * r * 0.5]
        tip = c + d * (0.17 + 0.03 * (i % 3))
        for k in range(3):
            m.add_out([tri[k], tri[(k + 1) % 3], tip], URCHIN_SPINE, c - d * 0.02)
    lo = min(v.z for v in m.verts)
    m.transformed(Matrix.Translation((0, 0, -lo)))
    return C.build_object(m, "ourico-do-mar")


def build_star():
    m = C.Mesh("estrela-do-mar")
    R_TIP, R_VAL, R_MID = 0.31, 0.1, 0.17
    centre = Vector((0, 0, 0.085))
    tips, vals, mids = [], [], []
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 2
        bend = 0.12 * math.sin(3 * k)  # arms not perfectly straight
        tips.append(Vector((math.cos(a + bend) * R_TIP, math.sin(a + bend) * R_TIP, 0.02)))
        mids.append(Vector((math.cos(a + bend * 0.5) * R_MID, math.sin(a + bend * 0.5) * R_MID, 0.06)))
        av = a + math.pi / 5
        vals.append(Vector((math.cos(av) * R_VAL, math.sin(av) * R_VAL, 0.03)))
    inside = Vector((0, 0, 0.0))
    for k in range(5):
        vp = vals[k - 1]  # valley before arm k
        vn = vals[k]
        m.add_out([centre, vp, mids[k]], STAR, Vector((0, 0, -1)))
        m.add_out([centre, mids[k], vn], STAR, Vector((0, 0, -1)))
        m.add_out([vp, tips[k], mids[k]], STAR, Vector((0, 0, -1)))
        m.add_out([mids[k], tips[k], vn], STAR, Vector((0, 0, -1)))
    outline = []
    for k in range(5):
        outline += [vals[k - 1], tips[k]]
    for i in range(len(outline)):
        a, b = outline[i], outline[(i + 1) % len(outline)]
        m.add_out([a, b, Vector((b.x, b.y, 0.0)), Vector((a.x, a.y, 0.0))], STAR_SIDE, inside)
    # One tubercle knob on each arm's ridge.
    for k in range(5):
        c = centre.lerp(mids[k], 0.75) + Vector((0, 0, 0.0))
        d = (mids[k] - centre).normalized()
        side = d.cross(Vector((0, 0, 1))).normalized()
        tri = [c + d * 0.03, c + side * 0.025 - d * 0.015, c - side * 0.025 - d * 0.015]
        tip = c + Vector((0, 0, 0.035))
        for j in range(3):
            m.add_out([tri[j], tri[(j + 1) % 3], tip], STAR_KNOB, c - Vector((0, 0, 0.03)))
    return C.build_object(m, "estrela-do-mar")


def build_anemone():
    m = C.Mesh("anemona")
    n = 7

    def ring(r, z, off=0.0):
        return [Vector((math.cos(2 * math.pi * k / n + off) * r, math.sin(2 * math.pi * k / n + off) * r, z)) for k in range(n)]

    base, top = ring(0.17, 0.0), ring(0.16, 0.12)
    ctr = Vector((0, 0, 0.08))
    for k in range(n):
        k1 = (k + 1) % n
        m.add_out([base[k], base[k1], top[k1], top[k]], S[2] if k % 2 else S[1], ctr)  # wart rows
    m.add(ring(0.16, 0.12), L[0])  # oral disc
    # Outer tentacles: seven three-sided cones curving out; inner ring of five shorter ones.
    for k in range(n):
        a = 2 * math.pi * (k + 0.5) / n
        d = Vector((math.cos(a), math.sin(a), 0))
        root = Vector((0, 0, 0.12)) + d * 0.12
        tip = root + d * 0.17 + Vector((0, 0, 0.07))
        m.prism(root, tip, 0.032, 0.0, 3, L[3] if k % 2 else G[3], twist=a)
    for k in range(5):
        a = 2 * math.pi * k / 5
        d = Vector((math.cos(a), math.sin(a), 0))
        root = Vector((0, 0, 0.12)) + d * 0.06
        tip = root + d * 0.1 + Vector((0, 0, 0.1))
        m.prism(root, tip, 0.026, 0.0, 3, G[3], twist=a)
    return C.build_object(m, "anemona")


if __name__ == "__main__":
    turtle_kw = {"elevation_deg": 20.0, "closeup": True, "res": (900, 900), "azimuth_deg": -35.0}
    small = {"elevation_deg": 30.0, "closeup": True, "res": (900, 900)}
    P.run_all([
        ("tartaruga-verde", build_turtle(False), 400, "1.75 u juvenile green turtle (animals x1.5)", turtle_kw),
        ("tartaruga-verde-linha", build_turtle(True), 400, "the same turtle tangled in fishing line", turtle_kw),
        ("ourico-do-mar", build_urchin, 60, "0.55 u urchin with spines (about x3)", small),
        ("estrela-do-mar", build_star, 60, "0.6 u sea star (about x2.5)", small),
        ("anemona", build_anemone, 60, "0.55 u anemone across its tentacles (about x3)", small),
    ])
