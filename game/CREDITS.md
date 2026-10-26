# Credits & Bill of Materials — Secret Trail 3D Assets

The 3D models, character skins, and color palettes in `src/assets/` come from three places:

- **Kenney packs** (CC0): the avatar, pets, kits, skins and palettes in the tables right below.
- **Repository scripts:** the `models/custom-*.glb` are modelled by the repository's own Blender scripts (`scripts/blender/models/`).
- **Edited downloads:** `models/decor/`, `models/trees/` and their atlases are edited in Blender from CC0 and CC BY 4.0 downloads, credited in [Decor and trees](#decor-and-trees-staging-v2) below.

- **Author:** Kenney Vleugels (https://www.kenney.nl)
- **License:** CC0 1.0 Universal (http://creativecommons.org/publicdomain/zero/1.0/)
- **Pipeline script:** `game/scripts/assets.mjs` (`@gltf-transform/cli@4.5.1` + `gltfpack@1.3.0 -cc -kn -vtf`)

---

## Source Packs (Verified from Official `kenney.nl` Archives & `License.txt`)

| Pack Name             | Version | Creation Date (`License.txt`) | License | Official Page URL                          | Used For                                                                                                                                                                                                                |
| --------------------- | ------- | ----------------------------- | ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocky Characters** | `2.0`   | `10-06-2025 11:19`            | CC0 1.0 | https://kenney.nl/assets/blocky-characters | `models/avatar.glb` (`character-a` rig, 6 rigid nodes) and `skins/skin-{a..r}.webp` (18 skins)                                                                                                                          |
| **Cube Pets**         | `2.0`   | `26-03-2026 11:16`            | CC0 1.0 | https://kenney.nl/assets/cube-pets         | `models/{monkey,tiger,parrot,koala}.glb`, `skins/palette-pets.png`, 7 Atlantic Forest species palettes (`skins/palette-*.png`), and the P23 species models and palettes ([Bichos da Mata](#bichos-da-mata-p23-species)) |
| **Nature Kit**        | `2.1`   | `29-04-2020 01:02`            | CC0 1.0 | https://kenney.nl/assets/nature-kit        | `models/kit-flora.glb` (18 merged flora/terrain props: trees, palms, bushes, rocks, logs, grass, seedlings, sign)                                                                                                       |
| **Platformer Kit**    | `4.1`   | `02-04-2026 11:29`            | CC0 1.0 | https://kenney.nl/assets/platformer-kit    | `models/kit-props.glb` (`platform`, `platform-ramp`, `platform-fortified`, `block-grass`, `block-grass-large`, `flag`, `coin-gold`)                                                                                     |
| **Food Kit**          | `2.0`   | `26-06-2024 01:23`            | CC0 1.0 | https://kenney.nl/assets/food-kit          | `models/kit-props.glb` (`soda-bottle`, `soda-can`, `soda-can-crushed`, `bag`)                                                                                                                                           |
| **Holiday Kit**       | `2.0`   | `11-12-2024 14:31`            | CC0 1.0 | https://kenney.nl/assets/holiday-kit       | `models/kit-props.glb` (`cabin-wall`, `cabin-doorway`, `cabin-window-a`, `cabin-corner`, `cabin-roof`, `cabin-roof-point`, `floor-wood`)                                                                                |

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

---

## Decor and trees (staging v2)

These files were edited in Blender in October 2026 from the downloads below:

- `src/assets/models/decor/*.glb`: understorey, rocks, shore and waterfall;
- `src/assets/models/trees/tree-*.glb`: the seven Atlantic Forest tree species;
- the atlases `src/assets/skins/decor-atlas.png`, `trees-atlas.png` and `ground-atlas.png`.

Licences were checked on 2026-10-25:

- **Sketchfab:** each download's embedded `asset.extras` (title, author, `CC-BY-4.0`) and its model page;
- **OpenGameArt:** the licence field on the page;
- **Kenney:** the pack's `License.txt`.

The original downloads and the build scripts are kept outside the repository; `scripts/assets.mjs --only=staging` packs them (gltfpack meshopt, atlases quantized to 256 colours).

**Modifications (all models):**

- re-meshed to the game's budgets (decimated, leaf cards resampled or flattened) with near and far LODs, and scaled to ART.md §3;
- UVs moved into a shared atlas, normals rebuilt, and a vertex-colour gradient added;
- textures downsampled, recoloured to the palette ramps of `src/style/palette.ts` and packed into the atlases.

The trees are also reshaped into their species:

- **ipê-amarelo and pau-brasil:** from the Ginkgo trees; the ipê's crown is widened and recoloured yellow, and the pau-brasil is mirrored with a red-brown bark;
- **jequitibá-rosa:** stretched into an emergent tree with an umbrella crown;
- **juçara:** slimmed, with purple fruit bunches added;
- **mangue-vermelho:** the trunk is shortened under a fuller crown;
- **jerivá:** the untextured queen palm is textured with the PSX pack's frond and bark.

### CC BY 4.0 attributions (required)

All under **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/), modified as described above.

| Files                                                                                                         | Attribution                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `models/trees/tree-ipe-amarelo.glb`, `skins/trees-atlas.png`                                                  | "Ginkgo Tree Autumn/Fall" by **PuzzledPapaya**, https://sketchfab.com/3d-models/b3313ffda86a46a8b16a83de1bdb155a                          |
| `models/trees/tree-pau-brasil.glb`, `tree-ipe-amarelo.glb` (bark), `skins/trees-atlas.png`                    | "Ginkgo Tree Spring/Summer" by **PuzzledPapaya**, https://sketchfab.com/3d-models/2aa9348064c243f8b1f67ba73707c45e                        |
| `models/trees/tree-ipe-rosa.glb`, `skins/trees-atlas.png`                                                     | "Stylized Tree" by **Voyage** (vrsns_voyage), https://sketchfab.com/3d-models/69e0951f356c4a21ac60cd17f8462ad5                            |
| `models/trees/tree-jequitiba-rosa.glb`, `skins/trees-atlas.png`                                               | "Stylized tree pack" by **W_illness**, https://sketchfab.com/3d-models/a1f40f1a9e6043a19881b00d318b6ed8                                   |
| `models/trees/tree-jeriva.glb`                                                                                | "Queen Palm Tree" by **neutralize**, https://sketchfab.com/3d-models/2128328672f6410f9a37a4e0e08c9f8f                                     |
| `models/trees/tree-palmeira-jucara.glb`, `tree-jeriva.glb` (textures), `skins/trees-atlas.png`                | "PSX Tropical Pack V1" by **PROJEKTSANSSTUDIOS**, https://sketchfab.com/3d-models/831f5ce303354977a6acb695571ac01b                        |
| `models/trees/tree-mangue-vermelho.glb`, `skins/trees-atlas.png`                                              | "Tall Mangrove Tree" by **Matt Bodner** (liphttam1), https://sketchfab.com/3d-models/b722ee2895e84fd3b02a467cd1ba1cbe                     |
| `models/decor/understorey-bush.glb`, `skins/decor-atlas.png`                                                  | "Stylized Bush" by **Daniel** (danielpetrov), https://sketchfab.com/3d-models/9d9ce79d3ae040619e96d5b22c7de1a6                            |
| `models/decor/understorey-taioba.glb`, `skins/decor-atlas.png`                                                | "Elephant Ear Bush" by **ehhhaaa**, https://sketchfab.com/3d-models/75882b72d1374270aeac76c96db2aa4e                                      |
| `models/decor/understorey-heliconia.glb`, `skins/decor-atlas.png`                                             | "Stylized broadleaf plant" by **€r!c** (ericdavis), https://sketchfab.com/3d-models/3bf353171e7e48b4a50861f908f05be7                      |
| `models/decor/understorey-flowers-{ground,tall}-{a,b}.glb`, `skins/decor-atlas.png`                           | "Stylized Flowers and Dandelions" by **Nadia du Preez** (Octoprobz), https://sketchfab.com/3d-models/bffdeb9b066c43ac9456d9899e37d509     |
| `models/decor/understorey-{fern,monstera}-{a,b}.glb`, `understorey-palm-a.glb`, `skins/decor-atlas.png`       | "Tropical Plants Pack M02P" by **MozzarellaARC**, https://sketchfab.com/3d-models/2f093afb792742438f0f7ba7eaab90f0                        |
| `models/decor/rock-polyone-{01..11}.glb`, `ground-shore-rocks-{a,b,c}.glb` (texture), `skins/decor-atlas.png` | "Free Pack - Rocks Stylized" by **PolyOne Studio** (polyone), https://sketchfab.com/3d-models/7c60b4d1b8ab4187965f30c5e0212fc0            |
| `models/decor/rock-deadzik-{1..5}.glb`, `skins/decor-atlas.png`                                               | "Stylized Rocks Formation Asset Pack" by **Gebus** (deadzik), https://sketchfab.com/3d-models/726e8563eb634c529410f4e00857bbb3            |
| `models/decor/rock-cliff-{a,b}.glb`, `skins/decor-atlas.png`                                                  | "Low poly Stylized Nature Pack" by **Satendra Saraswat** (satendra5286), https://sketchfab.com/3d-models/9c773e846c6e4448b26b2cdecb2b91bf |

### CC0 sources (no attribution required, credited anyway)

| Files                                                                                     | Source                                                                                                                               | Author      | Licence |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------- |
| `models/decor/ground-waterfall.glb`, `skins/decor-atlas.png`                              | "Toon waterfall", https://opengameart.org/content/toon-waterfall                                                                     | doodlebuilt | CC0 1.0 |
| `models/decor/ground-sand-{foliage,patch}.glb`, `ground-shore-rocks-{a,b,c}.glb`          | Kenney **Pirate Kit**, https://kenney.nl/assets/pirate-kit                                                                           | Kenney      | CC0 1.0 |
| `skins/decor-atlas.png` (moss, grass), `skins/ground-atlas.png`, moss on the rocks        | "Ancient civ in the jungle (200 seamless textures)", https://opengameart.org/content/ancient-civ-in-the-jungle-200-seamless-textures | DevEarley   | CC0 1.0 |
| `skins/decor-atlas.png` (sand), `skins/ground-atlas.png` (rock), sand on the shore pieces | "Big pack of hand-painted tiling textures", https://opengameart.org/content/big-pack-of-hand-painted-tiling-textures                 | Drummyfish  | CC0 1.0 |

### Park props built from downloaded pieces

Every other park prop (`custom-passarela-*`, `custom-marco-trilha*`, `custom-casa-iara`, the seeds and propagules, the field gear, the coast animals, `custom-torre-observacao`, `custom-observatorio-aves`) is modelled from primitives by the repository's scripts. One prop reuses a CC BY download, under **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/):

| Files                                        | Attribution                                                                                                                    | Modifications                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models/custom-cachoeira-grande-paredao.glb` | "Stylized Rocks Formation Asset Pack" by **Gebus** (deadzik), https://sketchfab.com/3d-models/726e8563eb634c529410f4e00857bbb3 | The five formations welded, decimated and scaled uniformly, nine copies assembled into the waterfall wall, textures dropped and faces recoloured to the rock ramp with moss tops in vertex colours (`scripts/blender/models/marcos_paisagem.py`, October 2026). Licence checked on 2026-10-25 (see above). |

### Bichos da Mata (P23 species)

Built by `scripts/blender/models/bichos_mata.py` (with `_pets_kit.py`) from the raw **Kenney Cube Pets 2.0** GLBs (CC0 1.0, https://kenney.nl/assets/cube-pets, `License.txt` checked), reshaped and re-coloured: each face samples one cell of its species' own 64×64 palette, generated by the same script from the species' real colours (sources in the script). The three custom models are modelled from bevelled blocks in the Cube Pets style and reuse the Cube Pets eye pieces (CC0). Packed with gltfpack 1.3.0 (`-cc -kn -vtf -vpf`). No other source; nothing from any game.

| Files (`models/`, `skins/`)                                                   | Base (Kenney Cube Pets, CC0)          | Changes                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `capivara.glb`, `palette-capivara.png`                                        | `animal-beaver.glb`                   | Tail, buck teeth, nose and ears removed; deep blunt square muzzle, tiny ears, longer body                                         |
| `anta.glb`, `palette-anta.png`, `palette-anta-filhote.png`                    | `animal-pig.glb`                      | Pig snout and ears removed; forward trunk, small white-rimmed ears, nape crest, tail stub, body 1.5× longer; striped calf palette |
| `cateto.glb`, `palette-cateto.png`                                            | `animal-hog.glb`                      | Tusks and back ridges removed; dorsal crest; the pale collar as its own region                                                    |
| `veado.glb`, `palette-veado-mateiro.png`                                      | `animal-deer.glb`                     | Branched antlers replaced by two spikes; short tail                                                                               |
| `cachorro-do-mato.glb`, `palette-cachorro-do-mato.png`                        | `animal-fox.glb`                      | Black dorsal stripe; re-coloured                                                                                                  |
| `onca-parda.glb`, `palette-onca-parda.png`                                    | `animal-lion.glb`                     | Mane removed, body 1.2× longer; re-coloured tawny with a dark tail tip                                                            |
| `tapiti.glb`, `palette-tapiti.png`                                            | `animal-bunny.glb`                    | Ears shortened to 62%, head tufts removed, a small tail                                                                           |
| `jaguatirica.glb`, `palette-jaguatirica.png`                                  | `animal-cat.glb`                      | Flat rosette, stripe and spot patches; banded tail palette                                                                        |
| `caranguejo.glb`, `palette-caranguejo-uca.png`                                | `animal-crab.glb`                     | Four extra walking legs; re-coloured blue-grey and orange                                                                         |
| `passaro.glb`, `palette-saira-sete-cores.png`, `palette-sabia-laranjeira.png` | `animal-chick.glb`                    | Head tufts removed, a tail added, plumage regions                                                                                 |
| `jacutinga.glb`, `palette-jacutinga.png`                                      | `animal-parrot.glb`                   | Hooked bill replaced by a cracid bill, dewlap added, white wing patch                                                             |
| `colhereiro.glb`, `palette-colhereiro.png`                                    | `animal-parrot.glb`                   | Colhereiro: crest removed, legs 3× longer and thinner, flat spoon-shaped bill, bare greenish-grey face, carmine shoulders         |
| `tatu.glb`, `palette-tatu-galinha.png`                                        | custom (eyes from `animal-chick.glb`) | Banded shell, long snout, ringed tail                                                                                             |
| `jabuti.glb`, `palette-jabuti-tinga.png`                                      | custom (eyes from `animal-chick.glb`) | Jabuti-tinga: stepped dome with scute centres, scaled head and legs                                                               |
| `sapo.glb`, `palette-sapo-cururu.png`                                         | custom (eyes from `animal-chick.glb`) | Squat warty body, parotoid glands, folded hind legs                                                                               |

### Costa (P35 species and restinga plants)

The coast species are built by `scripts/blender/models/bichos_costa.py` the same way as the custom P23 models: bevelled blocks in the Cube Pets style, the Cube Pets eye pieces (Kenney **Cube Pets 2.0**, `animal-chick.glb`, CC0 1.0), one 64×64 palette per species from its real colours (sources in the script), gltfpack 1.3.0 (`-cc -kn -vtf -vpf`). Their clips (`perch`, `glide`, `swim`) and the turtles' `swim` clip are node rotations written by `_clips.py`. The restinga plants are modelled from primitives by `restinga.py` and packed like every `custom-*` prop. No download; nothing from any game.

| Files (`models/`, `skins/`)                                  | Base                                  | Notes                                                                       |
| ------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------- |
| `caranguejo-de-pedra.glb`, `palette-caranguejo-de-pedra.png` | custom (eyes from `animal-chick.glb`) | Flat carapace with ridges, eye stalks, two claws, four splayed legs a side  |
| `sargentinho.glb`, `palette-sargentinho.png`                 | custom (eyes from `animal-chick.glb`) | Tide-pool fish with five dark bars, forked tail; `swim` clip                |
| `atoba.glb`, `palette-atoba-pardo.png`                       | custom (eyes from `animal-chick.glb`) | Atobá-pardo: brown back, white belly and underwing; `perch` and `glide`     |
| `gaivotao.glb`, `palette-gaivotao.png`                       | custom (eyes from `animal-chick.glb`) | Gaivotão: white body, black back and wings, red bill spot; `perch`, `glide` |
| `custom-cacto-da-restinga.glb`, `custom-pitangueira.glb`     | primitives (`restinga.py`)            | Creeping cactus clump with crimson fruit; pitanga shrub with red fruit      |

---

## Áudio

Sound files in `src/assets/audio/` (wave 1, October 2026; the dirt steps `step-soil` added in wave 1.1; the park zones' beds `waterfall-far`, `canopy-birds`, `surf-*` and `mangrove-*` added in wave 2, P35). Every file is a T1 source: **CC0** or **CC BY**, with no share-alike, no non-commercial and no music. Each sound is shipped as `<id>-<n>.webm` (Opus) plus `<id>-<n>.m4a` (AAC fallback); both files of a variant come from the same cut. Licences were checked on each source page on 2026-10-25 (and again on the same day for Freesound 813621; on 2026-10-26 for the wave 2 sources): Kenney `License.txt`, the Freesound "license text" link, the OpenGameArt licence field and the `license.txt` files inside that pack, and for iNaturalist the API `license_code` (`cc-by`) cross-checked with the GBIF mirror (`creativecommons.org/licenses/by/4.0/`). Original downloads are kept outside the repository.

**Modifications (all files):** cut to the listed span, mixed to mono, high-passed where noted, faded in and out, loudness-normalised, and encoded to Opus (WebM) and AAC (M4A) at 48 kHz. The targets were about −16 LUFS short-term for effects, −20 for UI and animals and −24 integrated for beds, with peaks under −1 dBTP and light peak limiting on some transients. Loops are folded onto themselves with an equal-power crossfade so they repeat without a seam, and each loop file carries 50 ms of its own start after the end so a decoder that trims a few samples still wraps cleanly. Freesound sources are the site's HQ Ogg previews of each sound. The wave 2 beds are cut from long field recordings, low-passed where noted to sound distant, and the mangrove clicks get up to 6 dB of limiting so single snaps do not jump out of the bed.

### CC BY attributions (required)

| Files                                | Attribution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audio/waterfall-1.{webm,m4a}`       | "A small waterfall in the rainforest" by **ricardoemfield** (Rio Catarina, Itapoá, SC), https://freesound.org/people/ricardoemfield/sounds/795998/, licensed under **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). Modified: cut 18.5–34.5 s, high-pass 40 Hz, looped with a 1 s crossfade, normalised, converted to Opus/AAC.                                                                                                                                                                                                                                                                       |
| `audio/waterfall-far-1.{webm,m4a}`   | "A small waterfall in the rainforest" by **ricardoemfield** (Rio Catarina, Itapoá, SC), https://freesound.org/people/ricardoemfield/sounds/795998/, licensed under **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). Modified: cut 40–53.5 s, high-pass 30 Hz and low-pass 500 Hz (the roar from across the valley), looped (12 s), normalised, converted to Opus/AAC.                                                                                                                                                                                                                                 |
| `audio/step-rock-{1..4}.{webm,m4a}`  | "Footsteps on different surfaces" (folder `gravel`, files 0, 3, 6, 7) by **congusbongus**, https://opengameart.org/content/footsteps-on-different-surfaces, licensed under **CC BY 3.0** (https://creativecommons.org/licenses/by/3.0/). Derived by its author from "Gravel Footsteps" by **Ali_6868** (https://freesound.org/people/Ali_6868/packs/21608/, CC0). Modified: trimmed, mono, normalised with peak limiting, converted to Opus/AAC.                                                                                                                                                                   |
| `audio/step-water-{1..4}.{webm,m4a}` | "Footsteps on different surfaces" (folder `water`, files 0, 1, 3, 4) by **congusbongus**, https://opengameart.org/content/footsteps-on-different-surfaces, licensed under **CC BY 3.0** (https://creativecommons.org/licenses/by/3.0/). Derived from "Water Footsteps" by **EminYILDIRIM** (https://freesound.org/people/EminYILDIRIM/sounds/608663/, **CC BY 4.0**) and "footstep-concrete.wav" by **swuing** (https://freesound.org/people/swuing/sounds/38873/, **CC BY 4.0** on its page; the pack notes list it as CC BY 3.0). Modified: trimmed, mono, normalised with peak limiting, converted to Opus/AAC. |
| `audio/howler-{1,2}.{webm,m4a}`      | Southern brown howler monkey (_Alouatta guariba clamitans_), recording "(c) **Bruno Luka de Souza Bambirra Silveira**, some rights reserved (CC BY)", iNaturalist observation 268999935, sound 1364419 (São Francisco de Paula, RS), https://www.inaturalist.org/observations/268999935, licensed under **CC BY 4.0**. Modified: cuts 16–22 s and 5–11 s, high-pass 90 Hz, normalised, converted to Opus/AAC.                                                                                                                                                                                                      |
| `audio/muriqui-{1,2}.{webm,m4a}`     | Southern muriqui (_Brachyteles arachnoides_), recording "(c) **João Vitor Oliveira de Souza**, some rights reserved (CC BY)", iNaturalist observation 127940964, sound 512031 (São Paulo), https://www.inaturalist.org/observations/127940964, licensed under **CC BY 4.0**. Modified: cuts 1.2–4.2 s and 4.2–7.2 s, high-pass 300 Hz, normalised, converted to Opus/AAC.                                                                                                                                                                                                                                          |
| `audio/toucan-1.{webm,m4a}`          | Green-billed toucan (_Ramphastos dicolorus_), recording "(c) **Jessica Souza**, some rights reserved (CC BY)", iNaturalist observation 366633160, sound 1989774 (Águas Mornas, SC), https://www.inaturalist.org/observations/366633160, licensed under **CC BY 4.0**. Modified: cut 30.4–32.4 s, high-pass 400 Hz, normalised, converted to Opus/AAC.                                                                                                                                                                                                                                                              |
| `audio/toucan-2.{webm,m4a}`          | Green-billed toucan (_Ramphastos dicolorus_), recording "(c) **Jessica Souza**, some rights reserved (CC BY)", iNaturalist observation 397545502, sound 2147704 (Águas Mornas, SC), https://www.inaturalist.org/observations/397545502, licensed under **CC BY 4.0**. Modified: cut 27.0–29.0 s, high-pass 400 Hz, normalised, converted to Opus/AAC.                                                                                                                                                                                                                                                              |
| `audio/tamarin-{1,2}.{webm,m4a}`     | Black lion tamarin (_Leontopithecus chrysopygus_), the stand-in for the golden lion tamarin, recording "(c) **Valentin Moser**, some rights reserved (CC BY)", iNaturalist observation 361733283, sound 1952361 (São Paulo), https://www.inaturalist.org/observations/361733283, licensed under **CC BY 4.0**. Modified: cuts 8.5–10.5 s and 10.5–12.5 s, high-pass 1.5 kHz, normalised, converted to Opus/AAC.                                                                                                                                                                                                    |

### CC0 sources (no attribution required, credited anyway)

| Files                      | Source                                                                                                                                                                                  | Author                   | Licence |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------- |
| `audio/step-grass-{1..3}`  | Kenney **Impact Sounds** (created 19-12-2019) `footstep_grass_000/003/004`, https://kenney.nl/assets/impact-sounds                                                                      | Kenney                   | CC0 1.0 |
| `audio/step-wood-{1..4}`   | Kenney **Impact Sounds** `footstep_wood_000/002/003/004`                                                                                                                                | Kenney                   | CC0 1.0 |
| `audio/land-{1..4}`        | Kenney **Impact Sounds** `impactSoft_medium_000/002/003/004`                                                                                                                            | Kenney                   | CC0 1.0 |
| `audio/jump-{1..3}`        | Kenney **Digital Audio** `phaseJump1/2/3`, https://kenney.nl/assets/digital-audio                                                                                                       | Kenney                   | CC0 1.0 |
| `audio/collect-{1,2}`      | Kenney **Interface Sounds** (created 11-02-2020) `pluck_001/002`, https://kenney.nl/assets/interface-sounds                                                                             | Kenney                   | CC0 1.0 |
| `audio/ui-tap-1`           | Kenney **Interface Sounds** `click_001`                                                                                                                                                 | Kenney                   | CC0 1.0 |
| `audio/checkpoint-1`       | Kenney **Interface Sounds** `confirmation_001`, followed by Kenney **Music Jingles** `jingles_PIZZI00` (from 0.22 s), https://kenney.nl/assets/music-jingles                            | Kenney                   | CC0 1.0 |
| `audio/mission-complete-1` | Kenney **Music Jingles** `jingles_STEEL07`                                                                                                                                              | Kenney                   | CC0 1.0 |
| `audio/badge-1`            | Kenney **Music Jingles** `jingles_PIZZI07`                                                                                                                                              | Kenney                   | CC0 1.0 |
| `audio/step-soil-{1..4}`   | "Footsteps - Dirt, Grass, Ground, Nature" (foley pit; steps at 0.7, 1.4, 2.2 and 2.9 s), https://freesound.org/people/SecureSubset/sounds/813621/                                       | SecureSubset             | CC0 1.0 |
| `audio/step-leaves-{1..4}` | "footsteps in leaves - variations" (steps at 57.3, 68.6, 69.3 and 70.8 s), https://freesound.org/people/iliana22/sounds/832023/                                                         | iliana22                 | CC0 1.0 |
| `audio/splash-{1..3}`      | "Water Splash in Lake 05" (splashes at 3.4, 5.8 and 7.8 s), https://freesound.org/people/vero.marengere/sounds/524524/                                                                  | vero.marengere           | CC0 1.0 |
| `audio/radio-call-1`       | "Walkie Talkie - Roger Beep", https://freesound.org/people/bruce965/sounds/321906/, followed by "Radio Sign Off / Squelch", https://freesound.org/people/JovianSounds/sounds/524205/    | bruce965; JovianSounds   | CC0 1.0 |
| `audio/forest-day-1`       | "ANMLBird_BR Serrinha do alambari calm atmosphere with turtledove and crickets" (Mata Atlântica, morning; 57.5–83 s, 24 s loop), https://freesound.org/people/MeliaRoger/sounds/586171/ | Melia Roger (MeliaRoger) | CC0 1.0 |
| `audio/river-1`            | "babbling_brook_loop.wav" (re-looped at 4.85 s), https://freesound.org/people/minian89/sounds/222752/                                                                                   | minian89                 | CC0 1.0 |
| `audio/chainsaw-1`         | "Distant Chainsaw 2" (0.5–10.5 s, 9 s loop), https://freesound.org/people/FunWithSound/sounds/390741/                                                                                   | FunWithSound             | CC0 1.0 |
| `audio/canopy-birds-1`     | "rainforest mata atlantica.wav" (156–173.5 s, 16 s loop; high-pass 300 Hz, low-pass 7 kHz), https://freesound.org/people/Fenodyrie/sounds/673163/                                       | Fenodyrie                | CC0 1.0 |
| `audio/surf-rocks-1`       | "waterfront rocky seashore waves close" (246–259.5 s, 12 s loop; high-pass 60 Hz), https://freesound.org/people/teatov/sounds/830368/                                                   | teatov                   | CC0 1.0 |
| `audio/surf-beach-1`       | "Waves On The Beach (Sand Wash)" (Gylly Beach; 644–657.5 s, 12 s loop; high-pass 50 Hz), https://freesound.org/people/ralph.whitehead/sounds/470648/                                    | ralph.whitehead          | CC0 1.0 |
| `audio/mangrove-water-1`   | "Gentle small waves lapping on shore" (82–95 s, 12 s loop; high-pass 80 Hz), https://freesound.org/people/Alex_hears_things/sounds/352356/                                              | Alex_hears_things        | CC0 1.0 |
| `audio/mangrove-clicks-1`  | "Aquatic sound of the mangrove" (hydrophone, Sian Ka'an; 43–53.8 s, 10 s loop; high-pass 400 Hz, limited), https://freesound.org/people/felix.blume/sounds/328307/                      | felix.blume              | CC0 1.0 |

Each file above is the pair `.webm` + `.m4a`.

### Audio bill of materials

| Group (loading)                                                                                   | Variants |    Duration |                 Opus WebM |                     AAC M4A | Loaded                |
| ------------------------------------------------------------------------------------------------- | -------: | ----------: | ------------------------: | --------------------------: | --------------------- |
| Essential: steps, jump, land, splash, collect, checkpoint, mission complete, badge, UI tap, radio |       40 |      15.9 s |       89,578 B (87.5 KiB) |       172,314 B (168.3 KiB) | with the game         |
| Nature: forest, river, waterfall, chainsaw, howler, muriqui, toucan, tamarin, the zone beds       |       18 |     152.8 s |     539,769 B (527.1 KiB) |       849,885 B (830.0 KiB) | after the first frame |
| **Total (116 files)**                                                                             |   **58** | **168.7 s** | **629,347 B (614.6 KiB)** | **1,022,199 B (998.2 KiB)** |                       |

A device downloads one codec only, into the offline game pack too: Opus everywhere it plays, AAC on old iPhones.
