"""Top-down plan of the hand-made park: the Reserva da Iara plus the four zones around it (game/LEVEL.md, part 2).
Run: python3 game/docs/park-plan.py game/docs/park-plan.png
Units are game units (avatar 3 u, 1 u ~ 0.47 m); x grows east (serra), z grows south, as in level-plan.py.
The coordinates here are the source for the zone sections of LEVEL.md."""
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Polygon, Rectangle

# Zones: name, rectangle (x0, z0, x1, z1), fill, act.
ZONES = [
    ("Reserva da Iara", (0, 0, 160, 160), "#cfe3c4", "Ato 1"),
    ("Vale das Cachoeiras", (160, 0, 320, 160), "#b9d6b4", "Ato 2"),
    ("Copa das Árvores", (160, -160, 320, 0), "#a9cba6", "Ato 2"),
    ("Praia e Costão", (-40, -160, 160, 0), "#e9e0c4", "Ato 3"),
    ("Manguezal", (-40, 160, 160, 320), "#c9d9c0", "Ato 3"),
]
SEA = [(-40, -160), (-6, -160), (-2, -120), (-14, -96), (-34, -88), (-12, -76), (-4, -40), (0, 0), (0, 160),
       (-6, 200), (-26, 236), (-10, 262), (-6, 320), (-40, 320)]
COSTAO = [(-14, -96), (-36, -90), (-34, -84), (-12, -78)]
RIVER = [(300, 20), (272, 30), (256, 38), (238, 46), (210, 42), (180, 34), (132, 30), (118, 42), (104, 58), (94, 76),
         (84, 94), (70, 112), (56, 128), (40, 144), (28, 160), (18, 190), (6, 214), (-8, 232), (-26, 240)]
MANGUE = [(-30, 196), (40, 186), (70, 214), (60, 270), (20, 300), (-26, 290), (-34, 250)]
RESTINGA = [(-4, -150), (40, -150), (40, -10), (0, -6), (-4, -40)]
PLATEAU = [(128, 40), (158, 40), (158, 100), (130, 100), (126, 70)]
CAUSEWAY = [(158, 66), (200, 66), (200, 74), (158, 74)]
TRAILS = {
    "Reserva": [[(36, 86), (42, 70), (46, 58), (52, 50), (62, 40), (78, 30), (92, 26)],
                [(34, 92), (38, 112), (48, 124), (64, 132), (82, 128), (100, 120)],
                [(104, 84), (108, 100), (112, 112)], [(134, 72), (158, 70)]],
    "Vale": [[(158, 70), (200, 70), (222, 64), (236, 58)], [(205, 60), (205, 52)], [(205, 36), (212, 22), (220, 10)],
             [(240, 56), (256, 46), (270, 34), (296, 22)]],
    "Copa": [[(220, 10), (225, -30)], [(210, -110), (225, -40)]],
    "Praia": [[(70, 4), (60, -30), (30, -60), (6, -80), (-12, -88)], [(4, -20), (2, -140)]],
    "Mangue": [[(48, 132), (40, 160), (34, 186), (24, 206)], [(24, 206), (2, 222)], [(16, 256), (40, 262), (52, 280)]],
}
WALKWAY = (240, -70, 32)  # canopy boardwalk loop: centre and radius (~200 u)
BOARDWALK = (18, 246, 26)  # mangrove boardwalk loop
BRIDGE = [(205, 52), (205, 36)]  # suspension bridge over the gorge, 16 u
PORTALS = [(160, 70, "Portal leste\n(após missão 6)"), (70, 0, "Portal norte"), (40, 160, "Portal sul"),
           (222, 0, "Subida às copas")]
# (x, z, label, kind) kinds: m mission, s secret, l landmark, n npc, x new mechanic
MARKS = [
    # Reserva, part A
    (40, 74, "Casa na árvore da Iara", "x"), (129, 84, "Tirolesa: mirante → base", "x"), (132, 26, "Gruta atrás da cachoeira", "s"),
    (60, 24, "Folha dourada na copa", "s"), (112, 106, "Bióloga Ana", "n"), (96, 30, "Observador de aves", "n"),
    # Vale das Cachoeiras
    (250, 42, "Cachoeira Grande (som antes da vista)", "l"), (238, 52, "Poço: lixo dos visitantes", "m"),
    (205, 44, "Ponte pênsil (balança)", "x"), (216, 12, "Muriquis: armadilha fotográfica", "m"),
    (264, 34, "Pedras ao lado da queda", "m"), (300, 20, "Nascente: plantar mata ciliar", "m"),
    # Copa das Árvores
    (240, -70, "Passarela nas copas (4 u)", "x"), (272, -100, "Torre (12 u): revela o mapa", "l"),
    (210, -110, "Vovó Jequitibá: sementes", "m"), (256, -44, "Fotos de 5 bichos do alto", "m"),
    # Praia e Costão
    (-2, -60, "Limpeza da praia", "m"), (-22, -86, "Costão: tartaruga-verde", "m"), (-8, -74, "Poças de maré", "m"),
    (24, -120, "Restinga: trilha suspensa", "m"),
    # Manguezal
    (18, 246, "Passarela do mangue", "x"), (2, 226, "Travessia de canoa", "x"), (-14, 280, "Plantar propágulos", "m"),
    (52, 282, "Esconderijo dos guarás", "m"), (36, 212, "Caranguejo-uçá (defeso)", "m"),
]
COLORS = {"m": "#d4a017", "s": "#8a5cc2", "l": "#1e4d36", "n": "#c2185b", "x": "#d9480f"}
LEGEND = {"m": "missão", "s": "segredo", "l": "marco visível", "n": "personagem", "x": "mecânica nova"}


def main(out: str) -> None:
    fig, ax = plt.subplots(figsize=(13, 15), dpi=110)
    ax.set_facecolor("#dfe5dc")  # beyond the zones: the generated, endless world
    for name, (x0, z0, x1, z1), fill, act in ZONES:
        ax.add_patch(Rectangle((x0, z0), x1 - x0, z1 - z0, facecolor=fill, edgecolor="#2d4a3a", lw=1.6, zorder=1))
        ax.text(x0 + 4, z0 + 9, f"{name}\n{act}", fontsize=11, weight="bold", color="#1e3a2c", va="top", zorder=6)
    ax.add_patch(Polygon(RESTINGA, facecolor="#efe6c8", edgecolor="none", zorder=2))
    ax.add_patch(Polygon(MANGUE, facecolor="#8fb39a", edgecolor="#4f7a5f", lw=0.8, zorder=2))
    ax.add_patch(Polygon(SEA, facecolor="#7fb6d6", edgecolor="#4f8fb4", lw=1.2, zorder=3))
    ax.add_patch(Polygon(COSTAO, facecolor="#8e9b92", edgecolor="#4f5c55", zorder=4))
    ax.add_patch(Polygon(PLATEAU, facecolor="#b3bdb5", edgecolor="#6f7d74", zorder=2))
    ax.add_patch(Polygon(CAUSEWAY, facecolor="#b3bdb5", edgecolor="#6f7d74", zorder=2))
    xs, zs = zip(*RIVER)
    ax.plot(xs, zs, color="#3e9ccf", lw=7, solid_capstyle="round", zorder=3)
    for paths in TRAILS.values():
        for path in paths:
            px, pz = zip(*path)
            ax.plot(px, pz, color="#8f6e52", lw=2.4, ls=(0, (4, 2)), zorder=4)
    for cx, cz, r in (WALKWAY, BOARDWALK):
        ax.add_patch(Circle((cx, cz), r, fill=False, edgecolor="#a8805c", lw=4, zorder=4))
    bx, bz = zip(*BRIDGE)
    ax.plot(bx, bz, color="#5e4330", lw=4, zorder=5)
    for x, z, label in PORTALS:
        ax.plot(x, z, marker="D", ms=11, color="#ffd166", mec="#5e4330", mew=1.5, zorder=7)
        ax.annotate(label, (x, z), (6, -14), textcoords="offset points", fontsize=8.5, color="#5e4330", zorder=7)
    for x, z, label, kind in MARKS:
        ax.plot(x, z, marker="o", ms=7, color=COLORS[kind], mec="white", mew=1, zorder=8)
        ax.annotate(label, (x, z), (6, 4), textcoords="offset points", fontsize=7.6, color="#1b1b1b", zorder=8)
    for kind, label in LEGEND.items():
        ax.plot([], [], marker="o", ls="", ms=8, color=COLORS[kind], label=label)
    ax.plot([], [], marker="D", ls="", ms=9, color="#ffd166", mec="#5e4330", label="portal / passagem")
    ax.text(240, 240, "mundo gerado\n(infinito, fases F1–F5)", ha="center", fontsize=11, color="#6f7d74", style="italic")
    ax.text(240, -150, "mundo gerado ↑", ha="center", fontsize=9, color="#6f7d74", style="italic", zorder=6)
    ax.legend(loc="lower right", fontsize=9, framealpha=0.92)
    ax.set_xlim(-44, 324)
    ax.set_ylim(324, -164)  # z grows south: north at the top
    ax.set_aspect("equal")
    ax.set_title("Parque da Iara: a Reserva (Ato 1) e as quatro zonas novas (Atos 2 e 3)\n"
                 "unidades do jogo (1 u ≈ 0,47 m) · norte para cima · serra a leste, mar a oeste", fontsize=12)
    ax.grid(color="white", alpha=0.25, lw=0.5)
    fig.tight_layout()
    fig.savefig(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "park-plan.png")
