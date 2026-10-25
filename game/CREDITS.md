# Credits & Bill of Materials — Secret Trail 3D Assets

All 3D models, character skins, and color palettes in `src/assets/` are derived exclusively from **Kenney** asset packs released under the **Creative Commons Zero (CC0 1.0 Universal — Public Domain)** license.

- **Author:** Kenney Vleugels (https://www.kenney.nl)
- **License:** CC0 1.0 Universal (http://creativecommons.org/publicdomain/zero/1.0/)
- **Pipeline script:** `game/scripts/assets.mjs` (`@gltf-transform/cli@4.5.1` + `gltfpack@1.3.0 -cc -kn`)

---

## Source Packs (Verified from Official `kenney.nl` Archives & `License.txt`)

| Pack Name | Version | Creation Date (`License.txt`) | License | Official Page URL | Used For |
|---|---|---|---|---|---|
| **Blocky Characters** | `2.0` | `10-06-2025 11:19` | CC0 1.0 | https://kenney.nl/assets/blocky-characters | `models/avatar.glb` (`character-a` rig, 6 rigid nodes) and `skins/skin-{a..r}.webp` (18 skins) |
| **Cube Pets** | `2.0` | `26-03-2026 11:16` | CC0 1.0 | https://kenney.nl/assets/cube-pets | `models/{monkey,tiger,parrot,koala}.glb` and `skins/palette-pets.png` (bases for Atlantic Forest fauna) |
| **Nature Kit** | `2.1` | `29-04-2020 01:02` | CC0 1.0 | https://kenney.nl/assets/nature-kit | `models/kit-flora.glb` (18 merged flora/terrain props: trees, palms, bushes, rocks, logs, grass, seedlings, sign) |
| **Platformer Kit** | `4.1` | `02-04-2026 11:29` | CC0 1.0 | https://kenney.nl/assets/platformer-kit | `models/kit-props.glb` (`platform`, `platform-ramp`, `platform-fortified`, `block-grass`, `block-grass-large`, `flag`, `coin-gold`) |
| **Food Kit** | `2.0` | `26-06-2024 01:23` | CC0 1.0 | https://kenney.nl/assets/food-kit | `models/kit-props.glb` (`soda-bottle`, `soda-can`, `soda-can-crushed`, `bag`) |
| **Holiday Kit** | `2.0` | `11-12-2024 14:31` | CC0 1.0 | https://kenney.nl/assets/holiday-kit | `models/kit-props.glb` (`cabin-wall`, `cabin-doorway`, `cabin-window-a`, `cabin-corner`, `cabin-roof`, `cabin-roof-point`, `floor-wood`) |

---

## Bill of Materials (BOM)

| File | Triangles | Vertices | Raw Bytes | Gzip (`-9`) | Brotli (`-q 11`) | Notes |
|---|---:|---:|---:|---:|---:|---|
| `src/assets/models/avatar.glb` | 72 | 143 | 7,332 B | 2,427 B | 2,043 B | 6 rigid nodes (`leg-left`, `leg-right`, `torso`, `arm-left`, `arm-right`, `head`), 0 clips |
| `src/assets/models/kit-flora.glb` | 2,507 | 4,498 | 46,252 B | 26,524 B | 24,515 B | 18 named flora nodes, 1 shared palette material (`64×4`, `NEAREST`) |
| `src/assets/models/kit-props.glb` | 1,978 | 2,642 | 40,436 B | 20,813 B | 18,939 B | 18 named obby/trash/cabin nodes, 3 kit palettes (`64×64`, `NEAREST`) |
| `src/assets/models/koala.glb` | 594 | 464 | 18,624 B | 6,960 B | 6,232 B | Recolor base for sloth; 5 rigid nodes + 5 clips (`idle,walk,run,eat,gesture-positive`) |
| `src/assets/models/monkey.glb` | 918 | 638 | 22,168 B | 9,285 B | 8,461 B | Recolor base for golden lion tamarin, howler & muriqui; 6 rigid nodes + 5 clips |
| `src/assets/models/parrot.glb` | 530 | 434 | 21,060 B | 8,333 B | 7,462 B | Base for green-billed toucan & birds; 7 rigid nodes + 5 clips |
| `src/assets/models/tiger.glb` | 951 | 720 | 22,920 B | 9,771 B | 8,913 B | Recolor base for jaguar; 6 rigid nodes + 5 clips |
| `src/assets/skins/palette-pets.png` | — | — | 1,194 B | 1,217 B | 1,198 B | `64×64` `NEAREST` PNG-8 base colormap for Cube Pets |
| `src/assets/skins/skin-a.webp` | — | — | 2,816 B | 2,839 B | 2,817 B | Default avatar skin (`256×256` `NEAREST` lossless WebP) |
| `src/assets/skins/skin-b.webp` | — | — | 2,080 B | 2,101 B | 2,063 B | Optional skin B (`256×256` lossless WebP) |
| `src/assets/skins/skin-c.webp` | — | — | 1,710 B | 1,726 B | 1,679 B | Optional skin C (`256×256` lossless WebP) |
| `src/assets/skins/skin-d.webp` | — | — | 1,664 B | 1,687 B | 1,668 B | Optional skin D (`256×256` lossless WebP) |
| `src/assets/skins/skin-e.webp` | — | — | 2,034 B | 2,032 B | 1,992 B | Optional skin E (`256×256` lossless WebP) |
| `src/assets/skins/skin-f.webp` | — | — | 2,204 B | 2,218 B | 2,164 B | Optional skin F (`256×256` lossless WebP) |
| `src/assets/skins/skin-g.webp` | — | — | 2,214 B | 2,237 B | 2,218 B | Optional skin G (`256×256` lossless WebP) |
| `src/assets/skins/skin-h.webp` | — | — | 2,162 B | 2,185 B | 2,166 B | Optional skin H (`256×256` lossless WebP) |
| `src/assets/skins/skin-i.webp` | — | — | 1,864 B | 1,881 B | 1,830 B | Optional skin I (`256×256` lossless WebP) |
| `src/assets/skins/skin-j.webp` | — | — | 2,378 B | 2,401 B | 2,376 B | Optional skin J (`256×256` lossless WebP) |
| `src/assets/skins/skin-k.webp` | — | — | 2,438 B | 2,461 B | 2,436 B | Optional skin K (`256×256` lossless WebP) |
| `src/assets/skins/skin-l.webp` | — | — | 2,980 B | 3,003 B | 2,984 B | Optional skin L (`256×256` lossless WebP) |
| `src/assets/skins/skin-m.webp` | — | — | 2,760 B | 2,783 B | 2,764 B | Optional skin M (`256×256` lossless WebP) |
| `src/assets/skins/skin-n.webp` | — | — | 2,124 B | 2,147 B | 2,128 B | Optional skin N (`256×256` lossless WebP) |
| `src/assets/skins/skin-o.webp` | — | — | 2,990 B | 3,013 B | 2,994 B | Optional skin O (`256×256` lossless WebP) |
| `src/assets/skins/skin-p.webp` | — | — | 2,326 B | 2,349 B | 2,326 B | Optional skin P (`256×256` lossless WebP) |
| `src/assets/skins/skin-q.webp` | — | — | 2,114 B | 2,137 B | 2,100 B | Optional skin Q (`256×256` lossless WebP) |
| `src/assets/skins/skin-r.webp` | — | — | 1,842 B | 1,865 B | 1,846 B | Optional skin R (`256×256` lossless WebP) |
| **Subtotal: Models + Default Skin (`skin-a`)** | **7,550** | **9,539** | **182,802 B** | **88,169 B** | **80,580 B** | Initial pack payload (without the 17 on-demand skins) |
| **TOTAL (All 26 Files)** | **7,550** | **9,539** | **220,686 B** | **126,395 B** | **118,314 B** | Complete asset directory (`215.5 KiB` raw / `115.5 KiB` br) |
