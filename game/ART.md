# Secret Trail: art direction

Every model, texture, animation and effect in the game follows this file. The goal is one world: the same forest as the app's diorama, seen in daylight and up close, with the readability kids know from Roblox. When something here conflicts with a single asset, the asset changes.

The values in code live in `src/style/palette.ts` and `src/style/motion.ts`; this file explains them.

## 1. Look

- Low poly and blocky: chunky shapes, flat shading, no bevels, no realistic detail. Silhouettes must read from 20 m on a 6" phone.
- Readability over realism, but never false biology: the right colours, proportions and behaviour of each species, simplified.
- Daylight by default; night (survival mode) is a lighting and fog change, never new materials.

### Avatar

The default avatar is Roblox-classic: Kenney's 6-block character with one flat colour per part (skin, hair, shirt, pants) and a simple face decal, composited at runtime into its 64×64 skin from the regions in `src/assets/skins/avatar-regions.json`. Kids pick colours or one of 18 presets with diverse, realistic skin tones. Kenney's 18 pixel-art skins remain as extra options in the chooser. Clothes may use ramp and accent colours, never gold.

### Forest

The trees are the custom Atlantic Forest species (araucária, jequitibá, juçara, embaúba, ipês, xaxim). Kenney's Nature Kit supplies only bushes, rocks, logs, stumps, grass, flowers and props. No coconut palms or other species that do not belong in the Mata Atlântica.

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

- Saturation between 25% and 70%; nothing pure black or pure white. The darkest object colour is `#1e4d36`-level (HSL lightness ≥ 12%). Only the night sky and the night ambient light may go darker, down to the app's own night tokens (`--sky-top` `#0d2318`, lightness ≥ 8%), so the game's night matches the diorama's.
- Gold is reserved for things the player should touch or reach. Nothing decorative is gold.
- Animal palettes (`src/assets/skins/palette-*.png`) are the species' real colours, simplified, and are allowed outside the ramps, but their lightness must stay inside the world's range so they neither glow nor disappear.
- Danger and warnings use the app's `--danger` family only in UI, never painted on the world.

## 3. Scale

One unit is about 0.47 m: the avatar is 3.0 u tall (1 stud = 0.6 u, as in `src/engine/constants.ts`). Animals and props are drawn larger than life by a fixed factor per category, so they read on a phone; the factor never changes within a category.

| Category | Factor                                                                          | Examples (height or length)                                                           |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Avatar   | 1                                                                               | 3.0 u                                                                                 |
| Animals  | ×1.5                                                                            | mico 0.9 u, bugio 1.4 u, muriqui 1.7 u, preguiça 1.4 u, onça 3.0 u long, tucano 0.9 u |
| Trees    | ×0.6 (kept below real height so the canopy stays in frame)                      | understorey 6–8 u, canopy 10–14 u, emergent (jequitibá) 18 u                          |
| Props    | ×1.5                                                                            | bottle 0.5 u, can 0.3 u, trap 1.0 u, sign 2.2 u                                       |
| Obby     | grid of 1 u, platform tops 2×2 or 3×3 u, gaps from the jump table in the engine |                                                                                       |

Kenney's Nature Kit is modelled at about 1/9 of these tree heights. Scale it uniformly (never stretch one axis) and judge the result in the lineup, next to the custom trees.

## 4. Geometry budgets

| Kind                     | Triangles          | Notes                                                                                 |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------- |
| Avatar                   | 72 (Kenney Blocky) | 6 rigid nodes, names fixed in `src/animation/joints.ts`                               |
| Animal                   | ≤ 1,000            | rigid named nodes, no skinning; the onça may go to 1,200 for its rosettes             |
| Tree                     | ≤ 400              | one merged mesh per species, instanced; a Kenney original up to 5% over is kept as is |
| Prop                     | ≤ 200              |                                                                                       |
| Landmark (cabin, bridge) | ≤ 1,500            |                                                                                       |

## 5. Materials and light

- One material family: `MeshLambertMaterial`, flat shading, vertex colours multiplied by a palette texture. No PBR, no specular, no normal maps.
- Static assets carry baked light in their vertex colours: ambient occlusion plus a sky-to-ground gradient, baked in Blender (`scripts/blender/`). This is the diorama's technique, and it keeps the low tier grounded without a shadow map.
- Scene light: one hemisphere light (sky `#cfe8f2`, ground `#3f6b48`) and one sun (`#fff1d0`, 45° elevation). Fog uses the horizon colour and follows the view distance, not the camera's zoom distance: on the low tier it starts at 30 u and is opaque at 70 u, which is also the camera's far plane (`VIEW` in `src/style/palette.ts`). Gameplay objects must sit inside the clear range.
- Characters and animals use the same material family; on the low tier they get a blob shadow, on higher tiers a real one.
- Per-instance colour tints a whole instance, trunk included. Species colour that only affects part of a model (a flowering canopy, for example) belongs in the model's own vertex colours or palette, not in instance tints.

## 6. Textures

- Only palette textures: at most 64×64, sRGB, `NearestFilter`, no mipmaps. Skins at most 128×128 WebP.
- No photographic or noisy textures, no text in textures except signs, and no real institutions' logos.
- Budget: under 4 MB of asset texture memory in a level. Render targets are counted separately: shadow maps cost 8 MiB at 1024 and 32 MiB at 2048, which is why only medium and high tiers have them.

## 7. Motion

The numbers are in `src/style/motion.ts`.

- Avatar: Roblox's default timings (see `src/animation/animate-timings.ts`). Nothing in the game moves the avatar faster or snappier than Roblox does.
- Secondary motion (tails, heads, antennas, leaves): critically damped or lightly underdamped springs from one family: 3–6 Hz, damping 0.6 for appendages, 1.0 for bodies.
- Gait cadence comes from distance travelled, never from input or time alone.
- Squash and stretch at most 15%; anticipation short (≤ 80 ms); no camera shake beyond a 0.05 u impulse on landings from high falls.
- Feedback and UI: 120 ms (tap), 200 ms (state change), 320 ms (reward), with the app's easing tokens.
- Reduced motion: squash, lean, bob, shake and idle sway go to zero; essential transitions shorten to 120 ms.

## 8. Effects

- Particles use palette colours and square or quad shapes in keeping with the blocky look; one pooled system, at most 200 live particles.
- Additive glow only for fireflies at night and for the collect pop.

## 9. Quality gate for every asset or animation

Before it is wired into a level, every new or changed asset:

1. Appears in the lineup render (`scripts/blender/lineup.py`) next to the avatar and a scale bar, in the standard light.
2. Passes the palette audit: every colour within the ramps, or listed as an allowed species colour.
3. Stays within its triangle and texture budget.
4. Animations get a short turntable or GIF review; biology-specific motion cites its source.
