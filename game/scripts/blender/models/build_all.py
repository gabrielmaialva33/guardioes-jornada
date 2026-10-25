"""
Rebuild every custom model, its preview and the comparison sheets, from scratch.

    python3 game/scripts/blender/models/build_all.py [--no-render]

Each generator also runs on its own (see its docstring). Outputs go to $CUSTOM_RAW_DIR
(default ~/.cache/agents/2026-10-25-trilha-secreta/custom-raw); BLENDER overrides the
Blender binary (default /usr/sbin/blender, 5.2).
"""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BLENDER = os.environ.get("BLENDER", "/usr/sbin/blender")
GENERATORS = ["araucaria", "jequitiba", "jucara", "embauba", "ipe", "xaxim", "bromelia", "armadilhas",
              "bico_tucano", "rosetas_onca", "juba_mico", "placas", "avatar_hair", "story_map"]


def run(script: str, extra: list[str]) -> None:
    cmd = [BLENDER, "-b", "--factory-startup", "-P", str(HERE / f"{script}.py")]
    if extra:
        cmd += ["--", *extra]
    out = subprocess.run(cmd, capture_output=True, text=True)
    for line in out.stdout.splitlines():
        if line.startswith(("[gate]", "[placa]", "[bico]")):
            print(line)
    if out.returncode != 0 or "Traceback" in out.stderr + out.stdout:
        print(out.stdout[-3000:], out.stderr[-3000:], file=sys.stderr)
        raise SystemExit(f"{script}.py failed")


if __name__ == "__main__":
    flags = [a for a in sys.argv[1:] if a == "--no-render"]
    for g in GENERATORS:
        run(g, flags)
    if not flags:
        run("sheet", [])
