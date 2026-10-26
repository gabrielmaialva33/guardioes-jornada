"""
Pack the P26 park props exactly as scripts/assets.mjs step 6 packs custom-raw (bake.py
--custom-only): recolor.recolor_custom_glb, then bake.bake_static_glb (Cycles AO + sky-to-ground
gradient in COLOR_0, then gltfpack@1.3.0 -cc -kn -vtf). The difference is the destination: a
staging folder, so nothing reaches game/src/assets/models/ before it passes the audit
(build_props.py copies it afterwards).

Run inside Blender (build_props.py does it):

    BAKE_REPORT_PATH=<stage>/bake-deltas.json \\
    /usr/sbin/blender -b --factory-startup -P game/scripts/blender/models/pack_props.py -- <raw dir> <stage dir> [name ...]
"""

import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import bake  # noqa: E402
import recolor  # noqa: E402

PROPS = [
    "passarela-deck", "passarela-deck-livre", "passarela-guarda", "passarela-mirante", "passarela-escada",
    "marco-trilha", "marco-trilha-tronco", "casa-iara",
    "semente-paubrasil", "semente-jequitiba", "propagulo-mangue", "propagulo-mangue-plantado",
    "armadilha-fotografica", "polia-tirolesa", "binoculos",
    "tartaruga-verde", "tartaruga-verde-linha", "ourico-do-mar", "estrela-do-mar", "anemona",
    "torre-observacao", "observatorio-aves", "cachoeira-grande-paredao",
]


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:]
    raw, stage = Path(argv[0]), Path(argv[1])
    names = argv[2:] or PROPS
    stage.mkdir(parents=True, exist_ok=True)
    cmap = recolor.load_color_map()
    deltas = []
    for name in names:
        src = raw / f"{name}.glb"
        out = stage / f"custom-{name}.glb"
        with tempfile.TemporaryDirectory() as tmp:
            recolored = Path(tmp) / out.name
            recolor.recolor_custom_glb(src, recolored, cmap)
            d = bake.bake_static_glb(recolored, out)
        deltas.append(d)
        print(f"[pack] {out.name}: raw {d['preRawBytes']} B -> baked {d['postRawBytes']} B "
              f"(gz {d['postGzipBytes']} B) on {d['gpu']}")
    report = Path(os.environ.get("BAKE_REPORT_PATH", str(stage / "bake-deltas.json")))
    import json

    report.write_text(json.dumps(deltas, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
