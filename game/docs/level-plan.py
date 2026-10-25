"""Top-down plan of the Reserva da Iara (game/LEVEL.md). Run: python3 game/docs/level-plan.py game/docs/level-plan.svg
Units are game units (H = 3 u);
x grows east (serra), z grows south. The data here is the source for LEVEL.md."""
import json, math, sys

P = 4  # px per unit
M = 40  # margin px
W = 160

RIVER = [(132, 30), (118, 42), (104, 58), (94, 76), (84, 94), (70, 112), (56, 128), (40, 144), (28, 160)]
POOL = (94, 76, 10)  # stones pool: centre and half-width
FOREST = [
    [(4, 4), (60, 4), (96, 6), (110, 20), (104, 34), (80, 38), (62, 44), (40, 40), (20, 44), (6, 36)],   # north
    [(4, 52), (30, 50), (44, 58), (46, 70), (26, 76), (20, 100), (34, 108), (24, 132), (6, 150), (4, 100)],  # west, around base
    [(76, 46), (96, 44), (100, 56), (88, 70), (76, 62)],  # north bank strip
    [(78, 106), (90, 98), (100, 100), (96, 128), (86, 150), (70, 152), (66, 136)],  # south-west of the clareira
    [(128, 110), (150, 104), (158, 120), (158, 158), (118, 158), (126, 134)],  # south-east, onça
    [(116, 24), (150, 8), (158, 30), (150, 40), (130, 40)],  # serra north
]
PASTURE = [(44, 46), (76, 44), (78, 58), (46, 60)]  # the gap the corridor closes
PLATEAU = [(128, 40), (158, 40), (158, 100), (130, 100), (126, 70)]
CLAREIRA = (112, 118, 14)
PATHS = {
    "trilha": [(36, 86), (42, 70), (46, 58), (52, 50), (62, 40), (78, 30), (92, 26)],
    "margem": [(92, 26), (96, 40), (90, 56), (86, 68)],
    "leste": [(104, 84), (108, 100), (112, 112)],
    "armadilhas": [(112, 118), (124, 104), (122, 98), (126, 120), (142, 128), (120, 140), (96, 140), (104, 124)],
    "ponte": [(34, 92), (38, 112), (48, 124), (64, 132), (82, 128), (100, 120)],
}
STONES_FROM, STONES_TO = (86, 70), (103, 82)
BRIDGE = ((50, 124), (62, 134))
LEDGES = [(121, 97, 7.5), (122.5, 93.4, 9.0), (124.5, 89.8, 10.5), (126.2, 86.0, 12.0), (127.4, 82.0, 13.5), (128.6, 78.0, 15.0)]

PLACES = [
    ("spawn", 34, 92, "Início"),
    ("iara", 38, 80, "Iara"),
    ("viveiro", 27, 79, "Viveiro"),
    ("ipe", 30, 70, "Ipê-amarelo"),
    ("mico", 60, 38, "Micos"),
    ("bugio", 18, 20, "Bugios"),
    ("muriqui", 108, 32, "Muriquis"),
    ("rocha", 100, 24, "Pedra de observação"),
    ("madeireiro", 114, 14, "Corte ilegal"),
    ("preguica", 128, 124, "Preguiça"),
    ("tucano", 138, 58, "Tucanos"),
    ("onca", 146, 148, "Onça"),
    ("jequitiba", 146, 62, "Jequitibá (marco)"),
]
MISSIONS = [
    (1, 52, 50, "Sementes de juçara"),
    (2, 100, 24, "Olho no corte ilegal"),
    (3, 94, 76, "Pedras do rio"),
    (4, 112, 118, "Mudas na clareira"),
    (5, 124, 104, "Armadilhas"),
    (6, 128, 78, "Mirante"),
]
CHECKPOINTS = [(34, 92), (55, 52), (84, 67), (106, 85), (104, 112), (124.5, 89.8), (134, 72)]
TRAPS = [(124, 104), (142, 128), (96, 140)]
FRUITS = [(44, 66), (40, 50), (58, 34), (72, 30), (48, 42)]
TRASH = [(40, 76), (44, 62), (66, 38), (88, 30), (92, 52), (108, 96), (118, 130), (100, 140), (60, 130), (40, 110)]

def px(x, z):
    return M + x * P, M + z * P

def poly(points, **attrs):
    d = " ".join(f"{px(x, z)[0]:.1f},{px(x, z)[1]:.1f}" for x, z in points)
    a = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<polygon points="{d}" {a}/>'

def line(points, **attrs):
    d = " ".join(f"{px(x, z)[0]:.1f},{px(x, z)[1]:.1f}" for x, z in points)
    a = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<polyline points="{d}" fill="none" {a}/>'

def text(x, z, s, size=13, dx=0, dy=0, anchor="start", weight=600, fill="#1e2a22"):
    X, Y = px(x, z)
    return (f'<text x="{X + dx:.1f}" y="{Y + dy:.1f}" font-size="{size}" font-weight="{weight}" '
            f'text-anchor="{anchor}" fill="{fill}" paint-order="stroke" stroke="#f4f4ef" stroke-width="3">{s}</text>')

def length(points):
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))

out = []
size = W * P + 2 * M
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{size + 300}" height="{size}" font-family="Atkinson Hyperlegible Next, sans-serif">')
out.append(f'<rect width="{size + 300}" height="{size}" fill="#f4f6ee"/>')
out.append(f'<rect x="{M}" y="{M}" width="{W * P}" height="{W * P}" fill="#86bf7c"/>')
# restinga strip on the west edge
out.append(f'<rect x="{M}" y="{M}" width="{10 * P}" height="{W * P}" fill="#d9c9a0"/>')
for f in FOREST:
    out.append(poly(f, fill="#3f7d4f", stroke="#2f5e3c", stroke_width=2))
out.append(poly(PASTURE, fill="#c9b27a", stroke="#a8805c", stroke_width=2, stroke_dasharray="6 4"))
out.append(poly(PLATEAU, fill="#b3bdb5", stroke="#6f7d74", stroke_width=3))
for k in range(1, 4):  # contour hints
    shrink = [(x + (140 - x) * k * 0.18, z + (70 - z) * k * 0.18) for x, z in PLATEAU]
    out.append(poly(shrink, fill="none", stroke="#8e9b92", stroke_width=1.5))
cx, cz, r = CLAREIRA
X, Y = px(cx, cz)
out.append(f'<circle cx="{X}" cy="{Y}" r="{r * P}" fill="#b08f70" stroke="#8f6e52" stroke-width="2"/>')
for i in range(6):
    a = i / 6 * 2 * math.pi
    X, Y = px(cx + 7 * math.cos(a), cz + 7 * math.sin(a))
    out.append(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="5" fill="#5fa36a" stroke="#2f5e3c"/>')
# river
out.append(line(RIVER, stroke="#3e9ccf", stroke_width=9 * P, stroke_linecap="round", stroke_linejoin="round"))
X, Y = px(POOL[0], POOL[1])
out.append(f'<ellipse cx="{X}" cy="{Y}" rx="{POOL[2] * P + 6}" ry="{POOL[2] * P - 6}" transform="rotate(35 {X} {Y})" fill="#3e9ccf"/>')
out.append(line(RIVER, stroke="#73cbf0", stroke_width=2, stroke_dasharray="10 12"))
# paths
for name, pts in PATHS.items():
    out.append(line(pts, stroke="#8f6e52", stroke_width=4 * P * 0.6, stroke_linecap="round", stroke_linejoin="round", opacity=0.85))
# bridge and stones
out.append(line(list(BRIDGE), stroke="#5e4330", stroke_width=14, stroke_linecap="butt"))
out.append(line(list(BRIDGE), stroke="#c9a27a", stroke_width=8, stroke_dasharray="3 3"))
n = 7
for i in range(n):
    t = (i + 1) / (n + 1)
    x = STONES_FROM[0] + (STONES_TO[0] - STONES_FROM[0]) * t + (1.6 if i % 2 else -1.6)
    z = STONES_FROM[1] + (STONES_TO[1] - STONES_FROM[1]) * t
    X, Y = px(x, z)
    out.append(f'<circle cx="{X:.1f}" cy="{Y:.1f}" r="{1.3 * P:.1f}" fill="#b3bdb5" stroke="#4f5c55" stroke-width="1.5"/>')
for x, z, y in LEDGES:
    X, Y = px(x, z)
    out.append(f'<rect x="{X - 6:.1f}" y="{Y - 5:.1f}" width="12" height="10" fill="#a8805c" stroke="#5e4330"/>')
# places
for key, x, z, label in PLACES:
    X, Y = px(x, z)
    if key == "spawn":
        out.append(f'<polygon points="{X},{Y - 10} {X - 8},{Y + 7} {X + 8},{Y + 7}" fill="#1e4d36" transform="rotate(35 {X} {Y})"/>')
        out.append(text(x, z, label, dx=12, dy=16))
    elif key == "jequitiba":
        out.append(f'<circle cx="{X}" cy="{Y}" r="12" fill="#1e4d36" stroke="#f4f4ef" stroke-width="2"/>')
        out.append(text(x, z, label, dy=30, anchor="middle"))
    elif key == "ipe":
        out.append(f'<circle cx="{X}" cy="{Y}" r="9" fill="#f2c94c" stroke="#5e4330"/>')
        out.append(text(x, z, label, dx=12, dy=-6, size=12))
    else:
        out.append(f'<circle cx="{X}" cy="{Y}" r="4" fill="#1e2a22"/>')
        left = key in ("viveiro",)
        out.append(text(x, z, label, dx=-7 if left else 7, dy=-6, size=12, weight=500, anchor="end" if left else "start"))
for x, z in TRAPS:
    X, Y = px(x, z)
    out.append(f'<path d="M{X - 6},{Y - 6} L{X + 6},{Y + 6} M{X + 6},{Y - 6} L{X - 6},{Y + 6}" stroke="#5a2e2e" stroke-width="3"/>')
for x, z in FRUITS:
    X, Y = px(x, z)
    out.append(f'<circle cx="{X}" cy="{Y}" r="4.5" fill="#4b2a4f" stroke="#f4f4ef" stroke-width="1.5"/>')
for x, z in TRASH:
    X, Y = px(x, z)
    out.append(f'<rect x="{X - 3.5}" y="{Y - 3.5}" width="7" height="7" fill="#e9f4e4" stroke="#4f5c55" stroke-width="1.5"/>')
for i, (x, z) in enumerate(CHECKPOINTS):
    X, Y = px(x, z)
    out.append(f'<path d="M{X},{Y} L{X},{Y - 16} L{X + 10},{Y - 12} L{X},{Y - 8}" fill="#73cbf0" stroke="#1e2a22" stroke-width="1.5"/>')
for nmb, x, z, label in MISSIONS:
    X, Y = px(x, z)
    out.append(f'<circle cx="{X}" cy="{Y}" r="13" fill="#ffd166" stroke="#5e4330" stroke-width="2"/>')
    out.append(f'<text x="{X}" y="{Y + 5}" font-size="15" font-weight="800" text-anchor="middle" fill="#412805">{nmb}</text>')
# grid of 40 u blocks
for k in range(5):
    a = M + k * 40 * P
    out.append(f'<line x1="{a}" y1="{M}" x2="{a}" y2="{M + W * P}" stroke="#1e2a22" stroke-opacity="0.18"/>')
    out.append(f'<line x1="{M}" y1="{a}" x2="{M + W * P}" y2="{a}" stroke="#1e2a22" stroke-opacity="0.18"/>')
    out.append(f'<text x="{a}" y="{M - 10}" font-size="11" text-anchor="middle" fill="#4f5c55">{k * 40}</text>')
    out.append(f'<text x="{M - 8}" y="{a + 4}" font-size="11" text-anchor="end" fill="#4f5c55">{k * 40}</text>')
out.append(text(150, 96, "Mirante (y 15)", size=13, anchor="end"))
out.append(text(112, 134, "Clareira", size=13, anchor="middle"))
out.append(text(60, 54, "Pasto: corredor", size=12, anchor="middle", weight=500))
out.append(text(56, 140, "Ponte", size=12, weight=500))
out.append(text(5, 100, "Restinga", size=12, weight=500, anchor="middle", dx=0))
out.append(text(120, 152, "Serra →", size=12, weight=500))
# legend
lx = size + 10
items = [
    ("#ffd166", "Missões 1–6 (ordem sugerida)"),
    ("#73cbf0", "Checkpoints"),
    ("#4b2a4f", "Frutos de juçara (5)"),
    ("#e9f4e4", "Lixo (10, opcional)"),
    ("#5a2e2e", "Armadilhas (3)"),
    ("#b3bdb5", "Pedras do rio (obby 1)"),
    ("#a8805c", "Degraus do mirante (obby 2)"),
    ("#8f6e52", "Trilhas"),
    ("#3f7d4f", "Mata"),
    ("#c9b27a", "Pasto (vira corredor)"),
]
out.append(f'<text x="{lx}" y="{M + 6}" font-size="18" font-weight="800" fill="#1e2a22">Reserva da Iara</text>')
out.append(f'<text x="{lx}" y="{M + 28}" font-size="12" fill="#4f5c55">160 × 160 u (≈ 75 × 75 m) · blocos de 40 u</text>')
for i, (c, label) in enumerate(items):
    y = M + 60 + i * 26
    out.append(f'<rect x="{lx}" y="{y - 12}" width="16" height="16" fill="{c}" stroke="#1e2a22" stroke-width="1"/>')
    out.append(f'<text x="{lx + 24}" y="{y + 1}" font-size="13" fill="#1e2a22">{label}</text>')
route = PATHS["trilha"] + PATHS["margem"]
stats = {
    "trilha_plus_margem_u": round(length(route), 1),
    "ponte_route_u": round(length(PATHS["ponte"]), 1),
    "armadilhas_loop_u": round(length(PATHS["armadilhas"]), 1),
}
stats["main_route_seconds_walk"] = round((stats["trilha_plus_margem_u"] + 25 + length(PATHS["leste"]) + stats["armadilhas_loop_u"] + 40) / 9.6, 1)
y0 = M + 60 + len(items) * 26 + 20
for i, (k, v) in enumerate(stats.items()):
    out.append(f'<text x="{lx}" y="{y0 + i * 18}" font-size="11" fill="#4f5c55">{k}: {v}</text>')
out.append("</svg>")
open(sys.argv[1], "w").write("\n".join(out))
print(json.dumps(stats))
