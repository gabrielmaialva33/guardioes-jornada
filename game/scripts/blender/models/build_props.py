"""
Rebuild the P26 park props from scratch: generators -> pack (bake.py + gltfpack) into a staging
folder -> the repository's audit.mjs on the staged files only -> the contact sheet.

    python3 game/scripts/blender/models/build_props.py [--no-render] [--install]

- Raw GLBs, previews and .audit.json go to $CUSTOM_RAW_DIR (default custom-raw, like every
  custom model), the packed files to $PROPS_STAGE_DIR (default
  ~/.cache/agents/2026-10-26-props/packed).
- The audit runs audit.mjs unchanged on a copy of the tree that holds only the staged files
  (its report lands in <stage>/audit/auditoria-cor.md). It fails on any lightness violation.
  Its triangle column uses audit.mjs's name-based categories, which know these props' kinds
  (turtles 400, casa 800, assemblies 1500, lookout 300); the generators assert the same budgets
  (_common.write_audit).
- The turtles get their "swim" clip (_clips.turtle_swim) after the pack.
- --install copies the staged custom-*.glb into game/src/assets/models/ after a passing audit.
- The sheet goes to ~/.cache/guardioes-golden/sheets/props/ (skipped with --no-render).
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

GAME = HERE.parents[2]
BLENDER = os.environ.get("BLENDER", "/usr/sbin/blender")
CACHE = Path.home() / ".cache" / "agents"
RAW = Path(os.environ.get("CUSTOM_RAW_DIR", str(CACHE / "2026-10-25-trilha-secreta" / "custom-raw")))
STAGE = Path(os.environ.get("PROPS_STAGE_DIR", str(CACHE / "2026-10-26-props" / "packed")))
SHEET = Path(os.environ.get("GUARDIOES_GOLDEN_DIR", str(Path.home() / ".cache" / "guardioes-golden"))) / "sheets" / "props"
GENERATORS = ["passarela", "marco_trilha", "casa_iara", "sementes", "equipamentos", "vida_marinha", "marcos_paisagem"]


def blender(script: str, args: list[str], env: dict | None = None) -> str:
    cmd = [BLENDER, "-b", "--factory-startup", "-P", str(HERE / script)]
    if args:
        cmd += ["--", *args]
    out = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "CUSTOM_RAW_DIR": str(RAW), **(env or {})})
    for line in out.stdout.splitlines():
        if line.startswith(("[gate]", "[pack]", "[wall]", "[sheet]")):
            print(line[:240])
    if out.returncode != 0 or "Traceback" in out.stderr + out.stdout:
        print(out.stdout[-3000:], out.stderr[-3000:], file=sys.stderr)
        raise SystemExit(f"{script} failed")
    return out.stdout


def staged_audit() -> None:
    tree = STAGE / "audit"
    shutil.rmtree(tree, ignore_errors=True)
    (tree / "game" / "scripts" / "blender").mkdir(parents=True)
    (tree / "game" / "src" / "assets" / "models").mkdir(parents=True)
    for f in ("audit.mjs", "color-map.json"):
        shutil.copy(GAME / "scripts" / "blender" / f, tree / "game" / "scripts" / "blender" / f)
    for glb in STAGE.glob("custom-*.glb"):
        shutil.copy(glb, tree / "game" / "src" / "assets" / "models" / glb.name)
    (tree / "game" / "src" / "assets" / "skins").symlink_to(GAME / "src" / "assets" / "skins")
    out = subprocess.run(["node", str(tree / "game" / "scripts" / "blender" / "audit.mjs")], capture_output=True,
                         text=True, env={**os.environ, "LINEUP_OUT_DIR": str(tree)}, check=True)
    print(out.stdout.strip())
    m = re.search(r"out-of-bounds=(\d+)", out.stdout)
    if not m or int(m.group(1)) != 0:
        raise SystemExit("audit.mjs found colours outside the lightness bounds")


def compose_sheet() -> None:
    """props-sheet.png: a title bar, the full lineup and the detail row, stacked (ImageMagick 7)."""
    bold, regular = "/usr/share/fonts/noto/NotoSans-Bold.ttf", "/usr/share/fonts/noto/NotoSans-Regular.ttf"

    def bar(path, h, colour, lines):
        cmd = ["magick", "-size", f"4800x{h}", f"xc:{colour}"]
        for font, size, fill, y, text in lines:
            cmd += ["-font", font, "-pointsize", str(size), "-fill", fill, "-annotate", f"+40+{y}", text]
        subprocess.run([*cmd, str(path)], check=True)

    head, cap1, cap2, crop = (SHEET / n for n in ("head.png", "cap1.png", "cap2.png", "detail-crop.png"))
    bar(head, 150, "#1e4d36", [
        (bold, 60, "#e9f4e4", 80, "P26 · props do parque (Guardiões da Mata Atlântica) · lineup na mesma escala e luz"),
        (regular, 38, "#b6e6f7", 132, "Arquivos empacotados (bake AO + gltfpack) ao lado do avatar 3 u, da placa "
         "custom-placa-trilha-da-reserva 2.2 u e do custom-ipe-amarelo 10.5 u · luz de lineup.py · água e tocos são só "
         "contexto de preview")])
    bar(cap1, 70, "#2d6a4f", [(bold, 40, "#e9f4e4", 50, "Linha 1 · tudo na mesma escala: referências, casa-iara, "
                                "torre-observacao, observatorio-aves, passarela montada, cachoeira-grande-paredao")])
    bar(cap2, 70, "#2d6a4f", [(bold, 40, "#e9f4e4", 50, "Linha 2 · mesmos modelos e luz, câmera mais perto: marcos de "
                                "trilha, sementes, propágulos, armadilha fotográfica, polia, binóculos, tartarugas, "
                                "ouriço, estrela-do-mar, anêmona")])
    subprocess.run(["magick", str(SHEET / "props-detail.png"), "-crop", "4800x1120+0+40", "+repage", str(crop)], check=True)
    subprocess.run(["magick", str(head), str(cap1), str(SHEET / "props-lineup.png"), str(cap2), str(crop), "-append",
                    str(SHEET / "props-sheet.png")], check=True)
    for f in (head, cap1, cap2, crop):
        f.unlink()


if __name__ == "__main__":
    flags = [a for a in sys.argv[1:] if a == "--no-render"]
    for g in GENERATORS:
        blender(f"{g}.py", flags)
    STAGE.mkdir(parents=True, exist_ok=True)
    blender("pack_props.py", [str(RAW), str(STAGE)], env={"BAKE_REPORT_PATH": str(STAGE / "bake-deltas.json")})
    for turtle in ("tartaruga-verde", "tartaruga-verde-linha"):
        print(f"[clips] custom-{turtle}.glb", Q.add_clips(STAGE / f"custom-{turtle}.glb", Q.turtle_swim()))
    staged_audit()
    if "--no-render" not in sys.argv:
        blender("props_sheet.py", [str(STAGE), str(SHEET)])
        compose_sheet()
    if "--install" in sys.argv:
        for glb in sorted(STAGE.glob("custom-*.glb")):
            shutil.copy(glb, GAME / "src" / "assets" / "models" / glb.name)
            print(f"[install] {glb.name}")
