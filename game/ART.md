# Secret Trail: art direction

Every model, texture, animation, sound and effect in the game follows this file. The goal is one world: the same forest as the app's diorama, seen in daylight and up close, with the readability kids know from Roblox and the finish of a real game. When something here conflicts with a single asset, the asset changes.

The values in code live in `src/style/palette.ts` and `src/style/motion.ts`; this file explains them.

**Version 2 (25/10/2026).** Version 1 was faceted Lambert with flat palette colours, and it read as a prototype. Version 2 keeps the palette, scale and budgets, and adds the five things every reference game has:

- light that shows form;
- continuous ground colour;
- canopy shade;
- a horizon;
- designed water and sky.

The research behind it is in `~/.cache/agents/2026-10-25-trilha-secreta/pesquisa-qualidade/` (`a-visual.md`, `b-tecnologia.md`, `d-assets.md`, `c-audio.md`). The reference board, `referencias/board.png`, stays out of the repository because its images belong to their studios.

## 1. Look

- **Shapes:** chunky and stylized, with rounded or bevelled masses in the family of KayKit and Kenney Mini Forest. No realistic detail. Silhouettes must read from 20 m on a 6" phone.
- **Shading:**
  - Vegetation has soft, volume shading: canopies read as green clouds with a dark core and a lit rim.
  - Props, rocks, buildings, characters and animals keep flat shading.
- **Light:** a warm sun with a soft ramp; shadowed sides tinted green-blue by the sky, never grey.
- **Ground:**
  - continuous colour, with no visible grid;
  - clean-edged soil trails;
  - a wet band and a foam line at every waterline;
  - grass in the ground's colour, lighter at the tips, moving in the wind.
- **Forest floor:** dappled with canopy shade and moving sun spots.
- **Water:** a shallow-to-deep gradient, shore lines that breathe, flow streaks in the current.
- **Sky and horizon:**
  - a gradient dome with the sun and its halo, and painted clouds;
  - the Serra do Mar in 2–3 layers that fade into the haze, the sea to the west, valley mist;
  - the world never ends in void.
- **Characters:** a dark-palette outline (never black), a rim light and a crisp blob shadow. They read at 20 m.
- **Life:** falling leaves, pollen in the clearings, butterflies; fireflies at night.
- **Truthful biology:** readability over realism, but never false biology. The right colours, proportions and behaviour of each species, simplified.
- **Day and night:** a slow cycle of about 24 minutes (16 day, 2 dusk, 6 night), approved by the coordinator for the living world and the time-of-day species in the Guia da Mata.
  - Every session starts in daylight, and dusk is short.
  - Night is moonlit blue, never near-black: paths, interactables and the avatar stay legible on the low tier.
  - Night is a change of lighting, fog and sky only, never new materials.
  - Reduced motion keeps the cycle but never flickers.
  - Debug override: `?time=day|dusk|night`.

### Avatar

The default avatar is Roblox-classic: Kenney's 6-block character with one flat colour per part (skin, hair, shirt, pants) and a simple face decal, composited at runtime into its 64×64 skin from the regions in `src/assets/skins/avatar-regions.json`. Kids pick colours or one of 18 presets with diverse, realistic skin tones. Kenney's 18 pixel-art skins remain as extra options in the chooser. Clothes may use ramp and accent colours, never gold.

- **Clothes stand out from the forest:** shirts come from the water, wood, soil and rock ramps or the ipê accents. At most 2 of the 18 presets wear leaf or grass greens, which disappear against the trees.
- **Hair is an accessory, as in Roblox:** besides the painted short hair, small meshes attach to the head node and take the hair colour (long, ponytail, bun, black power, braids, and a cap that takes the shirt colour). Each is ≤ 80 triangles, so the presets vary in silhouette, not only in colour.

### Forest

- **Custom species:** the 10 Atlantic Forest trees (araucária, jequitibá, juçara, embaúba, ipê-amarelo, ipê-rosa, xaxim, pau-brasil, jerivá, mangue-vermelho) are our own models, because no kit has them. Pau-brasil, jerivá and mangue-vermelho have no model yet; they are the grey pillars on the map today. The trees keep their botanical silhouettes and are rebuilt in the version 2 style:
  - smooth canopy masses that shade as one volume, with 3-step gradients from cool shade to warm light;
  - a fringe of chunky leaves or flowers around a slightly shrunken canopy, which is what makes a canopy read as foliage. Fewer, bigger leaves suit the blocky avatars better than many small ones;
  - baked AO.
- **Animal markings:** jaguar rosettes and the tamarin's mane are drawn into the animal's small skin texture, not glued on as faceted pieces.
- **CC0 kits:**
  - KayKit Forest Nature Pack, Kenney Mini Forest, the nature subset of KayKit Medieval Hexagon and Kenney Survival Kit supply bushes, grass tufts, rocks, cliffs, water plants (taboa, aguapé, vitória-régia), stumps, dead trees and props;
  - generic kit trees may become secondary species after recolouring (pau-brasil, quaresmeira, cedro), judged in the lineup;
  - the comparison is in `~/.cache/agents/2026-10-25-trilha-secreta/kits-v2/`.
- **Other T1 sources** (see `d-assets.md`):
  - Kenney Pirate 2.1 for shore and sea pieces, never its coconut palms;
  - FabinhoSC's CC0 tropical plants and leaf cutouts on OpenGameArt, as a base for the foliage atlas;
  - polyone's stylized rocks (CC BY);
  - DevEarley and Drummyfish CC0 ground textures.

  Poly by Google models (CC BY 3.0) of jerivá, bromélia and Brazilian fauna are modelling references, not assets.
- **Excluded:** coconut palms, temperate conifers and any other species that does not belong in the Mata Atlântica.

## 2. Palette

All colours come from the ramps in `src/style/palette.ts`. They extend the app's own tokens (`src/app.css`: `--canopy`, `--canopy-light`, `--bark`, `--sun`, `--gold`, `--water`), brightened for daylight, so the game and the app's diorama are the same place.

| Ramp   | Use                                    | Shadow → light                                            |
| ------ | -------------------------------------- | --------------------------------------------------------- |
| leaf   | canopies, bushes, grass tips           | `#1e4d36` `#2d6a4f` `#4f9a6e` `#74c69d`                   |
| grass  | ground, clearings                      | `#2f5e3c` `#3f7d4f` `#5fa36a` `#86bf7c`                   |
| wood   | trunks, logs, cabin                    | `#5e4330` `#8a6448` `#a8805c` `#c9a27a`                   |
| soil   | paths, banks, nursery                  | `#5a4232` `#6b4f3a` `#8f6e52` `#b08f70`                   |
| rock   | rocks, river stones                    | `#4f5c55` `#6f7d74` `#8e9b92` `#b3bdb5`                   |
| water  | river, puddles                         | `#2f7fb0` `#3e9ccf` `#73cbf0` `#b6e6f7`                   |
| accent | collectibles, checkpoints, quest marks | gold `#ffd166`, ipê-amarelo `#f2c94c`, ipê-rosa `#ff9fb7` |

Rules:

- **Saturation and lightness:** saturation between 25% and 70%; nothing pure black or pure white. The darkest object colour is at the `#1e4d36` level (HSL lightness ≥ 12%). Only the night sky and the night ambient light may go darker, down to the app's own night tokens (`--sky-top` `#0d2318`, lightness ≥ 8%), so the game's night matches the diorama's.
- **Shadows:** shadows and ambient occlusion tint towards the hemisphere's sky and ground colours, never towards grey or black.
- **Outlines:** the darkest tone of the object's own ramp.
- **Gold:** reserved for things the player should touch or reach. Nothing decorative is gold, and that includes the sun's halo, which uses `LIGHT.sun`.
- **Animal palettes** (`src/assets/skins/palette-*.png`): the species' real colours, simplified. They may fall outside the ramps, but their lightness must stay inside the world's range so they neither glow nor disappear.
- **Danger and warnings:** the app's `--danger` family, only in UI, never painted on the world.

## 3. Scale

One unit is about 0.47 m: the avatar is 3.0 u tall (1 stud = 0.6 u, as in `src/engine/constants.ts`). Animals and props are drawn larger than life by a fixed factor per category, so they read on a phone; the factor never changes within a category.

| Category | Factor                                                                          | Examples (height or length)                                                                                             |
| -------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Avatar   | 1                                                                               | 3.0 u                                                                                                                   |
| Animals  | ×1.5                                                                            | heights: mico 0.9 u, bugio 1.4 u, muriqui 1.7 u, preguiça 1.4 u, onça 2.2 u (about 0.7 m at the shoulder), tucano 0.9 u |
| Trees    | ×0.6 (kept below real height so the canopy stays in frame)                      | understorey 6–8 u, canopy 10–14 u, emergent (jequitibá) 18 u                                                            |
| Props    | ×1.5                                                                            | bottle 0.5 u, can 0.3 u, trap 1.0 u, sign 2.2 u                                                                         |
| Obby     | grid of 1 u, platform tops 2×2 or 3×3 u, gaps from the jump table in the engine |                                                                                                                         |
- **Animals:** Cube Pets are cube-shaped, so animals are always scaled by height, never by length. A jaguar must stay well below the avatar's head.
- **Kits:** kit models come at their own scales; Kenney's Nature Kit, for example, is about 1/9 of these tree heights. Scale every kit model uniformly (never stretch one axis) and judge the result in the lineup, next to the custom trees.

## 4. Geometry budgets

| Kind                     | Triangles          | Notes                                                                                                                                    |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Avatar                   | 72 (Kenney Blocky) | 6 rigid nodes, names fixed in `src/animation/joints.ts`; hair accessories ≤ 80                                                           |
| Animal                   | ≤ 1,000            | Rigid named nodes, no skinning; the onça may go to 1,200 for its rosettes                                                                |
| Tree                     | ≤ 450              | One mesh per species, instanced, leaf fringe included. The emergent jequitibá may go to 700. A kit original up to 5% over is kept as is. |
| Ground cover piece       | ≤ 150              | Bushes, ferns, bromélias, flowers                                                                                                        |
| Grass                    | 1 tri per blade    | Generated on the device: 6–10 thousand blades within about 15 u on low, more on higher tiers (section 10)                                |
| Prop                     | ≤ 200              |                                                                                                                                          |
| Landmark (cabin, bridge) | ≤ 1,500            |                                                                                                                                          |

Frame gates on the A07 (low tier): 30 FPS, p95 ≤ 33 ms, ≤ 150 draws (200 is the hard limit), ≤ 200k triangles.

## 5. Materials and light

- **One material family on every tier:** `MeshLambertMaterial` with one shared lighting chunk (`onBeforeCompile`), on WebGL2 (`WebGLRenderer`). The chunk does three things:
  - a soft ramp on the sun term;
  - shadowed sides tinted by the hemisphere colours;
  - an optional rim term for characters.

  No PBR, no specular, no normal maps. WebGPU waits for the triggers in `b-tecnologia.md` §5: the A57 and the A10s cannot get it today.
- **Normals:**
  - flat on props, rocks, buildings, characters and animals;
  - volume (proxy or spherical) normals on canopies and "up" normals on ground cover and grass, baked in Blender.

  Faceted canopies and black-edged ground-cover triangles are the two most "prototype" defects, and these normals remove both.
- **Baked light:** static assets carry it in their vertex colours, as ambient occlusion plus a sky-to-ground gradient, baked in Blender (`scripts/blender/`). At load, the game also bakes the canopy's shade into a 2D map over the terrain. Moving sun spots then give the forest floor its dapple without a shadow map.
- **Terrain:** colour comes from smooth fields instead of one colour per cell. Every vertex is tinted by:
  - slope and height;
  - light noise;
  - the wet band and foam line at the river.

  Higher tiers add a small data texture for crisp edges, and triplanar shading on cliffs.
- **Scene light:**
  - one hemisphere light (sky `#cfe8f2`, ground `#3f6b48`) and one sun (`#fff1d0`, 45° elevation);
  - fog uses the horizon colour and follows the view distance, not the camera's zoom distance. The world must never look like it ends: a far field renders the whole map at low cost, so fog sits far out (target: low ~140 u, medium ~180 u, high ~260 u; values in `VIEW` in `src/style/palette.ts`, tuned by measurement). The far field has two parts:
    - a coarse terrain mesh of the whole map and its outer apron (about 4 u grid, one draw);
    - instanced tree impostors (one quad per tree, 1–2 draws) beyond the near LOD band, with a short crossfade.

    From the mirante, the story's finale, the whole reserve is in view. Gameplay objects still sit inside the detailed range.
  - the sky dome, the sun and the far silhouettes (serra, sea) are drawn outside the fog with pre-mixed colours, so the horizon never disappears.
- **Water:**
  - opaque on low, with depth stored in the river mesh: shallow-to-deep colour, animated shore lines, flow streaks;
  - alpha edges from medium up;
  - depth-based foam and refraction on high only.
- **Characters and animals:**
  - same material family, plus an outline drawn as a back-face shell in the darkest palette tone, and a rim light;
  - a crisp blob shadow on low, a real one on higher tiers.
- **Per-instance tint:** colour tints a whole instance, trunk included. Species colour that only affects part of a model (a flowering canopy, for example) belongs in the model's own vertex colours or atlas, not in instance tints.
- **Leaf fringes and grass, by tier:**
  - **Low:** opaque geometry only, with no alpha test. Leaves are small leaf-shaped polygons and grass is single-triangle blades. Alpha test breaks early depth rejection on Mali and PowerVR GPUs.
  - **Painted colour on every tier:** the low tier's opaque leaf polygons still take their colour from the painted foliage atlas (UV-mapped, no alpha), so canopies, ferns and leaf litter look hand-painted like the reference bushes. They never use flat per-face fills. The target render `~/.cache/agents/2026-10-25-trilha-secreta/alvo-v2/alvo-v2.png` shows why: next to the painted downloads, flat-filled canopies read as prototype.
  - **Medium and high:** cut-out leaf cards and grass clumps from one foliage atlas (section 10).

  The A07 decides by an A/B measurement before either version is approved.

## 6. Textures

- **Palette textures** for flat-shaded assets: at most 64×64, sRGB, `NearestFilter`, no mipmaps.
- **Gradient atlases** for vegetation and kit assets, in the style of KayKit: at most 256×256, sRGB, linear filter, mipmaps.
- **Foliage atlas** for the cut-out leaf cards and grass clumps of the medium and high tiers: one atlas of at most 512×512 with alpha, mipmaps and a linear filter. It is the first candidate for KTX2.
- **Ground atlas:** a stylized ground atlas of at most 256×256 (soil, leaf litter, sand, mud), repainted, never photographic.
- **Data textures:** noise, canopy shade, terrain data, leaf SDF and the cloud atlas, each at most 320×320, with a linear filter. They hold data, never photographs.
- **Skins:** at most 128×128 WebP.
- **Content:** no photographic or noisy colour textures, no text in textures except signs, and no real institutions' logos.
- **Budget:** under 4 MB of asset texture memory in a level, data textures included. Render targets are counted separately: shadow maps cost 8 MiB at 1024 and 32 MiB at 2048, which is why only medium and high tiers have them.
- **KTX2 (ETC1S):** only once real textures pass about 1–2 MB. Its transcoder stays out of `entry.js` and is cached by the service worker.

## 7. Motion

The numbers are in `src/style/motion.ts`.

- **Avatar:** Roblox's default timings (see `src/animation/animate-timings.ts`). Nothing in the game moves the avatar faster or snappier than Roblox does.
- **Secondary motion** (tails, heads, antennas, leaves): critically damped or lightly underdamped springs from one family, 3–6 Hz, with damping 0.6 for appendages and 1.0 for bodies.
- **Wind:** one shared field (direction plus slow gust noise) drives grass, canopies, falling leaves and water streaks, so everything moves together. Grass tips sway at most 0.15 u, canopy tops at most 0.1 u, and trunks stay still.
- **Gait cadence** comes from distance travelled, never from input or time alone.
- **Limits:** squash and stretch at most 15%; anticipation short (≤ 80 ms); no camera shake beyond a 0.05 u impulse on landings from high falls.
- **Feedback and UI:** 120 ms (tap), 200 ms (state change), 320 ms (reward), with the app's easing tokens.
- **Reduced motion:** squash, lean, bob, shake, idle sway and wind sway go to zero; essential transitions shorten to 120 ms.

## 8. Effects

- **Particles:** one pooled system with palette colours and square or quad shapes in keeping with the blocky look. At most 120 live particles on low and 200 elsewhere:
  - falling leaves;
  - pollen in clearings;
  - butterflies;
  - water splashes;
  - fireflies at night.
- **Additive glow** only for fireflies at night and for the collect pop.
- **Sun halo and light shafts:** alpha-blended, in the sun's colour.

## 9. Quality gate for every asset, animation or visual change

Before it is wired into a level, every new or changed asset:

1. **Lineup:** appears in the lineup render (`scripts/blender/lineup.py` and the WebGL lineup) next to the avatar and a scale bar, in the standard light.
2. **Palette:** passes the palette audit: every colour within the ramps, or listed as an allowed species colour.
3. **Budget:** stays within its triangle and texture budget.
4. **Animation:** gets a short turntable or GIF review; biology-specific motion cites its source.

Every render change also passes the golden frames:

- **Captures:** fixed camera poses captured in a deterministic mode (`?golden=1`), with a fixed seed and clock, a forced tier and a fixed 960×432 canvas. The poses cover the trail start, the clearing, the river crossing, the map edge, under the canopy, the avatar close up, the bank, the obby and night.
- **Review sheet:** each step produces a "before | after | reference" sheet per pose, which the owner approves.
- **Regression:** a pixel diff guards against unintended regressions.
- **Device gate:** the step closes only with the frame gates of section 4 measured on the A07.

## 10. Tiers

| Technique                      | Low (A07, A10s)                        | Medium                                        | High                          |
| ------------------------------ | -------------------------------------- | --------------------------------------------- | ----------------------------- |
| Stylized light chunk           | ✔                                      | ✔                                             | ✔                             |
| Volume normals on vegetation   | ✔                                      | ✔                                             | ✔                             |
| Continuous terrain             | per vertex + wet band                  | + data texture                                | + triplanar on cliffs         |
| Canopy shade map and sun spots | ✔                                      | ✔                                             | ✔ + shadow map for statics    |
| Sky, sun, clouds, height fog   | dome + sun + 6 clouds                  | + 12 clouds                                   | baked sky                     |
| World edge                     | apron + canopy carpet + serra rings    | same                                          | larger radius                 |
| Water                          | opaque, ramp and shore lines           | + alpha edges                                 | + depth foam and refraction   |
| Grass and wind                 | 6–10k opaque blades within ~15 u       | 15–20k, atlas clumps, bends around the player | 30–40k, two LOD bands         |
| Character readability          | outline + rim + blob shadow            | same                                          | + real shadow                 |
| Particles                      | ≤ 120                                  | ≤ 200                                         | ≤ 200 + light shafts          |
| Leaf fringe on canopies        | opaque leaf polygons                   | cut-out cards, 24–40 per lobe                 | 60–80 per lobe + translucency |
| Antialiasing and post          | MSAA only if the A/B on the A07 passes | MSAA + actor shadows                          | SMAA, bloom, GTAO (desktop)   |

If the A07 runs out of frame time, cut in this order:

1. grass density;
2. clouds;
3. shafts and particles;
4. the serra ring radius;
5. DPR, through the existing governor.

The A10s runs low with grass at 50% and without sun spots if its p95 needs it.

## 11. Sound

The game has one WebAudio engine (`src/audio/`) with buses for master, music, ambience, sound effects and UI. It handles:

- ducking under dialogue and the radio;
- a cap of about 16 voices and equal-power panning;
- footsteps driven by the gait phase and the surface;
- Opus files with an AAC fallback.

Until real recordings are in, every sound has a synthesized placeholder. The sound list, sources and budget are in `c-audio.md`.

- **Sources:** use the general reuse policy in §12. CC0/CC BY recordings remain useful defaults; other sources are considered with their actual terms recorded, rather than excluded by a blanket T1-only rule.
- **Recordings:** real recordings of the howler, muriqui and green-billed toucan come from iNaturalist (CC BY/CC0). The golden lion tamarin has only a non-commercial recording, so the T1 build uses the black lion tamarin of the same genus.
- **Size:** about 145 KB of essential effects go in the pack (Opus in WebM, mono). About 550 KB of ambience and animal calls download in the background after the game starts. An AAC fallback serves old iPhones only.

Sounds follow the same rules as the art:

- the real species where a recording exists;
- no sudden loud sounds;
- everything mutable and with its own volume.

## 12. Sources and licences

**Owner decision, 26/10/2026: reuse is the default.** Assets available to the owner may be imported, converted, adapted, animated, optimized and integrated into Guardiões. This covers models, rigs, clips, vegetation, scenery, textures, terrain, audio, derivatives and supporting metadata, including Green Hell, Sons of the Forest and future collections. Rebuilding an equivalent asset from scratch is optional. A new source name alone does not require another project-policy approval.

This is the canonical asset policy. It supersedes former blanket reference-only, no-files, no-metadata and T1-only rules. Choose assets for their usefulness, ecological fit and technical quality; do not reject an entire source merely because it previously carried a T2/T3 label or was used in a DEV study.

- **Source record:** keep the source, author or publisher, known licence/terms, modifications and credits. Record unknown terms as unknown; owner authorization is a project decision, not a third-party licence. Existing third-party terms are not changed by this document.
- **Selection and storage:** keep bulk extraction originals and downloads outside the tracked asset set by default. Selected assets, derivatives, reproducible source inputs and integration metadata may enter the project pipeline as needed; avoid copying an entire collection when only a subset is used.
- **Quality:** preserve species suitability, sourced educational facts, visual consistency, accessible paths, animation quality, performance budgets and offline operation. Use existing assets directly when they fit, and adapt them when useful.
- **Delivery:** document whether each selected asset currently loads locally, in the pack or on the site. DEV-only loaders describe current implementation, not a permanent policy restriction. Implement and validate pack integration before claiming that a local asset ships.
- **Existing licence labels:** T1 (CC0/CC BY), T2 (non-commercial) and T3 (source-specific or restricted terms) remain historical/source metadata where referenced. Record each asset's actual terms, including attribution, share-alike, modification or distribution conditions; the label alone is not a blanket project ban.

`PARK.md` §10 records the current Green Hell collection and its integration opportunities. The same reuse policy applies to Sons of the Forest if a collection is added; this does not assert that its files already exist here.

Never download from 3dassets.dev or gobkit.com: they contain prompt-injection text aimed at AI agents.
