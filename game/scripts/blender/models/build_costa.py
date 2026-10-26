"""
Rebuild the P35 coast models: the restinga plants (props pipeline), the coast animals (Cube
Pets pipeline) and the turtles' swim clip, then audit them and draw the lineup sheet.

    python3 game/scripts/blender/models/build_costa.py [--no-render] [--install]

- restinga.py -> pack_props.py (bake AO + gltfpack, as every custom-* prop) into
  $COSTA_STAGE_DIR (default ~/.cache/agents/2026-10-26-p35/packed): custom-cacto-da-restinga,
  custom-pitangueira.
- The packed turtles (game/src/assets/models/custom-tartaruga-verde*.glb) are copied to the
  stage and get their "swim" clip (_clips.turtle_swim); build_props.py adds it on its own runs.
- bichos_costa.py writes caranguejo-de-pedra, sargentinho, atoba and gaivotao (with their clips)
  straight into game/src/assets/models/, and their palettes into skins/, as bichos_mata.py does;
  they are copied to the stage for the audit and the sheet.
- audit.mjs runs unchanged on a copy of the tree holding only the staged files; it fails on any
  lightness violation or triangle budget over its limit.
- --install copies the staged custom-*.glb into game/src/assets/models/ after a passing audit.
- The sheet goes to ~/.cache/guardioes-golden/sheets/costa/ (skipped with --no-render).
BLENDER overrides the Blender binary (default /usr/sbin/blender).
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _clips as Q  # noqa: E402
from build_props import BLENDER, CACHE, RAW  # noqa: E402

GAME = HERE.parents[2]
MODELS = GAME / "src" / "assets" / "models"
STAGE = Path(os.environ.get("COSTA_STAGE_DIR", str(CACHE / "2026-10-26-p35" / "packed")))
SHEET = Path(os.environ.get("GUARDIOES_GOLDEN_DIR", str(Path.home() / ".cache" / "guardioes-golden"))) / "sheets" / "costa"
PLANTS = ["cacto-da-restinga", "pitangueira"]
TURTLES = ["tartaruga-verde", "tartaruga-verde-linha"]
ANIMALS = ["caranguejo-de-pedra", "sargentinho", "atoba", "gaivotao"]


def blender(script: str, args: list[str], env: dict | None = None) -> None:
    cmd = [BLENDER, "-b", "--factory-startup", "-P", str(HERE / script)]
    if args:
        cmd += ["--", *args]
    out = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "CUSTOM_RAW_DIR": str(RAW), **(env or {})})
    for line in out.stdout.splitlines():
        if line.startswith(("[gate]", "[pack]", "[sheet]")):
            print(line[:240])
    if out.returncode != 0 or "Traceback" in out.stderr + out.stdout:
        print(out.stdout[-3000:], out.stderr[-3000:], file=sys.stderr)
        raise SystemExit(f"{script} failed")


def staged_audit() -> None:
    tree = STAGE / "audit"
    shutil.rmtree(tree, ignore_errors=True)
    (tree / "game" / "scripts" / "blender").mkdir(parents=True)
    (tree / "game" / "src" / "assets" / "models").mkdir(parents=True)
    for f in ("audit.mjs", "color-map.json"):
        shutil.copy(GAME / "scripts" / "blender" / f, tree / "game" / "scripts" / "blender" / f)
    for glb in STAGE.glob("*.glb"):
        shutil.copy(glb, tree / "game" / "src" / "assets" / "models" / glb.name)
    (tree / "game" / "src" / "assets" / "skins").symlink_to(GAME / "src" / "assets" / "skins")
    out = subprocess.run(["node", str(tree / "game" / "scripts" / "blender" / "audit.mjs")], capture_output=True,
                         text=True, env={**os.environ, "LINEUP_OUT_DIR": str(tree)}, check=True)
    print(out.stdout.strip())
    m = re.search(r"out-of-bounds=(\d+)", out.stdout)
    if not m or int(m.group(1)) != 0:
        raise SystemExit("audit.mjs found colours outside the lightness bounds")
    over = re.search(r"budget-violations=(\d+)", out.stdout)
    if over and int(over.group(1)) != 0:
        raise SystemExit("audit.mjs found models over their triangle budget")


def compose_sheet() -> None:
    """costa-sheet.png: a title bar, the lineup and the detail row, stacked (ImageMagick 7)."""
    bold, regular = "/usr/share/fonts/noto/NotoSans-Bold.ttf", "/usr/share/fonts/noto/NotoSans-Regular.ttf"
    head, detail = SHEET / "head.png", SHEET / "detail-wide.png"
    subprocess.run(["magick", "-size", "3600x150", "xc:#1e4d36",
                    "-font", bold, "-pointsize", "54", "-fill", "#e9f4e4", "-annotate", "+40+76",
                    "P35 · costa: restinga, costão e aves marinhas (Guardiões da Mata Atlântica)",
                    "-font", regular, "-pointsize", "34", "-fill", "#b6e6f7", "-annotate", "+40+128",
                    "Arquivos empacotados, mesma escala e luz, ao lado do avatar 3 u · bichos nas alturas propostas "
                    "(guará e uçá do P23 como referência) · areia e poça são só contexto", str(head)], check=True)
    subprocess.run(["magick", str(SHEET / "costa-detail.png"), "-background", "#3f7d4f", "-gravity", "center",
                    "-extent", "3600x1100", str(detail)], check=True)
    subprocess.run(["magick", str(head), str(SHEET / "costa-lineup.png"), str(detail), "-append", "+repage",
                    str(SHEET / "costa-sheet.png")], check=True)
    for f in (head, detail):
        f.unlink()


if __name__ == "__main__":
    flags = [a for a in sys.argv[1:] if a == "--no-render"]
    STAGE.mkdir(parents=True, exist_ok=True)
    blender("restinga.py", flags)
    blender("pack_props.py", [str(RAW), str(STAGE), *PLANTS], env={"BAKE_REPORT_PATH": str(STAGE / "bake-deltas.json")})
    for turtle in TURTLES:
        shutil.copy(MODELS / f"custom-{turtle}.glb", STAGE / f"custom-{turtle}.glb")
        print(f"[clips] custom-{turtle}.glb", Q.add_clips(STAGE / f"custom-{turtle}.glb", Q.turtle_swim()))
    blender("bichos_costa.py", ANIMALS)
    for name in ANIMALS:
        shutil.copy(MODELS / f"{name}.glb", STAGE / f"{name}.glb")
    staged_audit()
    if "--no-render" not in sys.argv:
        blender("costa_sheet.py", [str(STAGE), str(SHEET)])
        compose_sheet()
    if "--install" in sys.argv:
        for glb in sorted(STAGE.glob("custom-*.glb")):
            shutil.copy(glb, MODELS / glb.name)
            print(f"[install] {glb.name}")
