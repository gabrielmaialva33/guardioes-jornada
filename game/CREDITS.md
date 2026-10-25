# Credits & Bill of Materials — Secret Trail 3D Assets

All 3D models, character skins, and color palettes in `src/assets/` are derived exclusively from **Kenney** asset packs released under the **Creative Commons Zero (CC0 1.0 Universal — Public Domain)** license.

- **Author:** Kenney Vleugels (https://www.kenney.nl)
- **License:** CC0 1.0 Universal (http://creativecommons.org/publicdomain/zero/1.0/)
- **Pipeline script:** `game/scripts/assets.mjs` (`@gltf-transform/cli@4.5.1` + `gltfpack@1.3.0 -cc -kn -vtf`)

---

## Source Packs (Verified from Official `kenney.nl` Archives & `License.txt`)

| Pack Name             | Version | Creation Date (`License.txt`) | License | Official Page URL                          | Used For                                                                                                                                 |
| --------------------- | ------- | ----------------------------- | ------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocky Characters** | `2.0`   | `10-06-2025 11:19`            | CC0 1.0 | https://kenney.nl/assets/blocky-characters | `models/avatar.glb` (`character-a` rig, 6 rigid nodes) and `skins/skin-{a..r}.webp` (18 skins)                                           |
| **Cube Pets**         | `2.0`   | `26-03-2026 11:16`            | CC0 1.0 | https://kenney.nl/assets/cube-pets         | `models/{monkey,tiger,parrot,koala}.glb`, `skins/palette-pets.png`, and 7 Atlantic Forest species palettes (`skins/palette-*.png`)       |
| **Nature Kit**        | `2.1`   | `29-04-2020 01:02`            | CC0 1.0 | https://kenney.nl/assets/nature-kit        | `models/kit-flora.glb` (18 merged flora/terrain props: trees, palms, bushes, rocks, logs, grass, seedlings, sign)                        |
| **Platformer Kit**    | `4.1`   | `02-04-2026 11:29`            | CC0 1.0 | https://kenney.nl/assets/platformer-kit    | `models/kit-props.glb` (`platform`, `platform-ramp`, `platform-fortified`, `block-grass`, `block-grass-large`, `flag`, `coin-gold`)      |
| **Food Kit**          | `2.0`   | `26-06-2024 01:23`            | CC0 1.0 | https://kenney.nl/assets/food-kit          | `models/kit-props.glb` (`soda-bottle`, `soda-can`, `soda-can-crushed`, `bag`)                                                            |
| **Holiday Kit**       | `2.0`   | `11-12-2024 14:31`            | CC0 1.0 | https://kenney.nl/assets/holiday-kit       | `models/kit-props.glb` (`cabin-wall`, `cabin-doorway`, `cabin-window-a`, `cabin-corner`, `cabin-roof`, `cabin-roof-point`, `floor-wood`) |

---

## Bill of Materials (BOM)

| File                                                | Triangles |  Vertices |     Raw Bytes |   Gzip (`-9`) | Brotli (`-q 11`) | Notes                                                                                      |
| --------------------------------------------------- | --------: | --------: | ------------: | ------------: | ---------------: | ------------------------------------------------------------------------------------------ |
| `src/assets/models/avatar.glb`                      |        72 |       143 |       7,100 B |       2,326 B |          1,952 B | 6 rigid nodes (`leg-left`, `leg-right`, `torso`, `arm-left`, `arm-right`, `head`), 0 clips |
| `src/assets/models/kit-flora.glb`                   |     2,507 |     4,498 |      46,008 B |      26,489 B |         24,286 B | 18 named flora nodes, 1 shared palette material (`64×4`, `NEAREST`)                        |
| `src/assets/models/kit-props.glb`                   |     1,978 |     2,642 |      39,500 B |      20,292 B |         18,509 B | 18 named obby/trash/cabin nodes, 3 kit palettes (`64×64`, `NEAREST`)                       |
| `src/assets/models/koala.glb`                       |       594 |       464 |      18,388 B |       6,840 B |          6,132 B | Recolor base for sloth; 5 rigid nodes + 5 clips (`idle,walk,run,eat,gesture-positive`)     |
| `src/assets/models/monkey.glb`                      |       918 |       638 |      21,932 B |       9,173 B |          8,376 B | Recolor base for golden lion tamarin, howler & muriqui; 6 rigid nodes + 5 clips            |
| `src/assets/models/parrot.glb`                      |       530 |       434 |      20,480 B |       8,018 B |          7,171 B | Base for green-billed toucan & birds; 7 rigid nodes + 5 clips                              |
| `src/assets/models/tiger.glb`                       |       951 |       720 |      22,744 B |       9,751 B |          8,854 B | Recolor base for jaguar; 6 rigid nodes + 5 clips                                           |
| `src/assets/skins/palette-bugio-ruivo.png`          |         — |         — |         369 B |         392 B |            373 B | `64×64` `NEAREST` PNG-8 for _Alouatta guariba clamitans_ (adult male) on `monkey.glb`      |
| `src/assets/skins/palette-mico-leao-dourado.png`    |         — |         — |         374 B |         397 B |            378 B | `64×64` `NEAREST` PNG-8 for _Leontopithecus rosalia_ on `monkey.glb`                       |
| `src/assets/skins/palette-muriqui.png`              |         — |         — |         374 B |         397 B |            378 B | `64×64` `NEAREST` PNG-8 for _Brachyteles arachnoides_ on `monkey.glb`                      |
| `src/assets/skins/palette-onca-melanica.png`        |         — |         — |         356 B |         374 B |            355 B | `64×64` `NEAREST` PNG-8 for melanistic _Panthera onca_ on `tiger.glb`                      |
| `src/assets/skins/palette-onca-pintada.png`         |         — |         — |         356 B |         379 B |            360 B | `64×64` `NEAREST` PNG-8 for _Panthera onca_ on `tiger.glb`                                 |
| `src/assets/skins/palette-pets.png`                 |         — |         — |       1,194 B |       1,217 B |          1,198 B | `64×64` `NEAREST` PNG-8 base colormap for Cube Pets                                        |
| `src/assets/skins/palette-preguica-de-coleira.png`  |         — |         — |         331 B |         354 B |            335 B | `64×64` `NEAREST` PNG-8 for _Bradypus torquatus_ on `koala.glb`                            |
| `src/assets/skins/palette-tucano-de-bico-verde.png` |         — |         — |         571 B |         594 B |            575 B | `64×64` `NEAREST` PNG-8 for _Ramphastos dicolorus_ on `parrot.glb`                         |
| `src/assets/skins/skin-a.webp`                      |         — |         — |       2,816 B |       2,839 B |          2,817 B | Default avatar skin (`256×256` `NEAREST` lossless WebP)                                    |
| `src/assets/skins/skin-b.webp`                      |         — |         — |       2,080 B |       2,101 B |          2,063 B | Optional skin B (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-c.webp`                      |         — |         — |       1,710 B |       1,726 B |          1,679 B | Optional skin C (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-d.webp`                      |         — |         — |       1,664 B |       1,687 B |          1,668 B | Optional skin D (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-e.webp`                      |         — |         — |       2,034 B |       2,032 B |          1,992 B | Optional skin E (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-f.webp`                      |         — |         — |       2,204 B |       2,218 B |          2,164 B | Optional skin F (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-g.webp`                      |         — |         — |       2,214 B |       2,237 B |          2,218 B | Optional skin G (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-h.webp`                      |         — |         — |       2,162 B |       2,185 B |          2,166 B | Optional skin H (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-i.webp`                      |         — |         — |       1,864 B |       1,881 B |          1,830 B | Optional skin I (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-j.webp`                      |         — |         — |       2,378 B |       2,401 B |          2,376 B | Optional skin J (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-k.webp`                      |         — |         — |       2,438 B |       2,461 B |          2,436 B | Optional skin K (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-l.webp`                      |         — |         — |       2,980 B |       3,003 B |          2,984 B | Optional skin L (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-m.webp`                      |         — |         — |       2,760 B |       2,783 B |          2,764 B | Optional skin M (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-n.webp`                      |         — |         — |       2,124 B |       2,147 B |          2,128 B | Optional skin N (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-o.webp`                      |         — |         — |       2,990 B |       3,013 B |          2,994 B | Optional skin O (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-p.webp`                      |         — |         — |       2,326 B |       2,349 B |          2,326 B | Optional skin P (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-q.webp`                      |         — |         — |       2,114 B |       2,137 B |          2,100 B | Optional skin Q (`256×256` lossless WebP)                                                  |
| `src/assets/skins/skin-r.webp`                      |         — |         — |       1,842 B |       1,865 B |          1,846 B | Optional skin R (`256×256` lossless WebP)                                                  |
| **Subtotal: Models + All 8 Palettes + `skin-a`**    | **7,550** | **9,539** | **182,893 B** |  **89,832 B** |     **82,049 B** | Initial pack payload (without the 17 on-demand skins)                                      |
| **TOTAL (All 33 Files)**                            | **7,550** | **9,539** | **220,777 B** | **128,058 B** |    **119,783 B** | Complete asset directory (`215.6 KiB` raw / `117.0 KiB` br)                                |
