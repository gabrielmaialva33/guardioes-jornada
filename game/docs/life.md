# Secret Trail: the living world (`src/life/`)

The life layer makes the story map alive: animals at their homes, two flocks, falling leaves and pollen, the shared wind field of `ART.md` §7, and Iara's NPC life. It is one `Group` the scene adds once, with no renderer and no loop of its own: the game calls `update()` once per frame, and `update()` allocates nothing.

History: P8 built the layer and its wiring recipe, then wired it into the runtime; P9 lowered the muriqui handhold row; P23 grew the population from 13 animals of 6 species to 44 animals of 23 species and moved the animals into pooled draws. The animal behaviours themselves (gaits, LOD, the species table) belong to `src/animation/animals/` and are described in `docs/animation.md`.

## 1. Files

| File                                                   | Content                                                                                                                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                             | The public API. Import from here.                                                                                                                                                                   |
| `create.ts`                                            | `createLivingWorld(options)`: plans, loads through the injected `loadGlb`, bakes, returns the layer. `loadPaletteTexture` decodes like GLTFLoader (no flip, no premultiply, nearest-filtered sRGB). |
| `living-world.ts`                                      | `LivingWorldRuntime` and the contract types (section 2).                                                                                                                                            |
| `homes.ts`                                             | The pure plan from `world` + `level` + seed: routes, perches, the onça loop, flock boxes, the canopy grid, `CROWNS`, `POPULATION`, `RESERVA_HOMES`, `LIFE_SEED`.                                    |
| `fauna.ts`                                             | Animals at run time: LOD, the tier cap (`LIFE_TIERS`), the companion, onça perception, howls, blob shadows.                                                                                         |
| `pets.ts`                                              | Bakes each animal GLB plus its attachment into one rigidly skinned geometry, and builds the pooled `SkinnedMesh`es and the palette atlas.                                                           |
| `flocks.ts`, `particles.ts`                            | Butterflies and saíras; the pooled leaf and pollen system.                                                                                                                                          |
| `wind.ts`                                              | The shared wind field: CPU sampler, GLSL chunk, `applyWind`.                                                                                                                                        |
| `iara.ts`                                              | `IaraLife`, Iara's idle, look and talk layer.                                                                                                                                                       |
| `ground.ts`, `rng.ts`, `tagged.ts`                     | Field-based height sampler, seeded mulberry32 (`LifeRng`, `subSeed`), tagged frame times: the zero-allocation helpers.                                                                              |
| `assets.ts`                                            | `?url` imports of the GLBs and palettes (`LIFE_ASSETS`).                                                                                                                                            |
| `preview.html`/`preview.ts`, `lineup.html`/`lineup.ts` | Dev-only pages (section 10).                                                                                                                                                                        |
| `*.test.ts`, `fixtures.test-helper.ts`                 | Unit tests; the helper loads GLBs in Node.                                                                                                                                                          |

## 2. Contract

`createLivingWorld(options): Promise<LivingWorld>` takes `world`, `level?` (omit on survival maps), `quality`, `loadGlb(url, signal)`, `signal`, and optionally `seed`, `loadTexture`, `releaseGlb`, `onHowl`, `blobs` and `assets`. `loadGlb` hands over ownership: the default `releaseGlb` disposes each GLB after baking. Pass a no-op `releaseGlb` if the loader ever returns shared cached scenes.

`LivingWorld`:

- `object3d`: the layer's `Group`. Its `matrixAutoUpdate` is false; never move it.
- `actors`: stable read-only views of live animals (`id`, `position`, `eyeHeight`, `companion`, `active`). No scene-graph traversal per frame.
- `update(frame: LifeFrame)`: reuse one `LifeFrame`: `dt` (clamped to 0.25 s), `camera` (pose already applied), `playerPosition`, `playerVelocity` (live references are fine), `time` (the visual clock; drives the wind, frozen in golden captures), `reducedMotion`, and optionally `light` (day, dusk, night), `playerGrounded`, `playerJumped`.
- `onStory(state)`: call after every story revision; idempotent. `StoryGame` already satisfies `LifeStoryState` (`completed(id)`, `progress(id)`).
- `setQuality(quality)`, `howl()` (forces a bugio chorus), `debug()`, `dispose()`.

`debug()` reports animals, animated/cap, near/far/frozen/visible, the companion, the onça's state and distance, howls, particles, butterflies, birds, estimated draws and triangles, and the `update()` CPU cost. The first `debug()` call switches the CPU timer on, because `performance.now()` allocates.

`onHowl` receives one `HowlEvent` (`x`, `y`, `z`, `chorus`, `index`) reused between calls: copy what you keep.

## 3. Wiring in the game

- **Create.** `createMapEnvironment` (`src/world-runtime/environment.ts`) exposes `loadLife(quality, signal, blobs, onHowl)`. It is `undefined` under the `?e2e` testing profile, so e2e runs have no life.
- **Load.** `scene/Graybox.svelte` calls `loadLife` before the scene declares `ready`, passing the shadow rig's blobs. On resolve it adds `object3d`, forwards the story, and hands the layer to `environment.park.setLife` (photo subjects, see `docs/engine.md`) and `avatarWiring.setLife` (look-at candidates). If the signal aborted, the layer is disposed instead.
- **Update.** In the main task, after `placeObject`/`applyCameraPose`; `onStory` when `story.revision` changes; `setQuality` on a tier change; `dispose()` on exit.
- **Howls.** The callback plays `sound.audio.play('howler', { x, y, z, gain })`, gain 1.1 for a chorus: spatial sound on the existing audio engine.
- **Wind.** `world-runtime/placements.ts` applies `applyWind` to the tree pools' materials, `world-runtime/ground-cover.ts` to the ground cover (amplitude 0.12, 0.05–0.8 u, per vertex), and `world-runtime/tree-depth.ts` to the trees' depth material, so shadows share the colour pass's sway.
- **Iara.** `missions/props.ts` drives her through `IaraLife` on top of the `AvatarAnimator` pose; the reduced-motion `matchMedia` is created once, not per frame.
- **Golden frames.** The layer is seeded (`LIFE_SEED = 20261025`, or `seed`), so goldens repeat. `?golden&life=companion|butterflies` sets progress fixtures inside the golden hook only (DEV or software-test builds); they never write saves.

## 4. Who lives where

The first six species (P8):

| Who                     | Home                                                                                                 | Behaviour                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4 micos-leões-dourados  | Branch tops on the rims of the three nearest crowns to (60, 38)                                      | Wander in bursts. **After mission 1** one becomes the companion: it climbs down over 1.4 s (`DESCENT`), follows the child on the ground and hops when the child jumps. A story restart sends it back to the canopy. |
| 3 bugios-ruivos         | Crown rims of an ipê-rosa at (17.4, 11.5) and an embaúba to the north-west                           | Walk slowly, rest, feed-hang and howl; a chorus every 45–100 s, whose clock runs even while they are frozen.                                                                                                        |
| 2 muriquis              | `level.handholds`, plus a second row 1.6 u beside it                                                 | Brachiate, tail-hang and rest; the two never share holds.                                                                                                                                                           |
| 1 preguiça-de-coleira   | Under a low branch of the embaúba at (127, 126.5)                                                    | Hangs and moves one limb at a time.                                                                                                                                                                                 |
| 2 tucanos-de-bico-verde | Four perches on the two plateau araucárias, (138, 58) and (155.5, 67.8)                              | Perch, hop, roost, fly between the trees. **At the mission 6 finale** both fly across; a finished save that loads does not replay it.                                                                               |
| 1 onça-pintada          | A closed trail of about 33 points around (146, 148), on dry, walkable, gentle ground clear of trunks | Walks, sits and lies; watches a child calmly from 30 u. Inside 15 u it walks away along its trail and never steps toward the child.                                                                                 |

P23 added 17 species through `RESERVA_HOMES`, placed in the Reserva until the park zones host them (`PARK.md` §4–§5). Each home has a kind: `bank` (capivaras, anta with calf on the river arc), `wade` (colhereiros at the restinga edge by the river mouth), `floor` (cateto band, veado-mateiro, cachorro-do-mato, onça-parda, tapitis, jaguatirica, jabuti, sapos), `trail` (the tatu on the bridge trail), `burrows` (caranguejos-uçá on the mud by the mouth), `canopy` (saíras-sete-cores), `lawn` (sabiá-laranjeira) and `palms` (jacutinga). River positions are arc fractions: 0 at the waterfall (132, 30), 1 at the mouth (28, 160). Swimmers float with 55–62 % of their height under the waterline. `POPULATION` holds the counts: 44 animals in all.

**Story reactions.** Butterflies start at 3 and gain 2 per seedling planted in mission 4, up to 15. Once the mission 1 corridor is planted, the saíra flock's box stretches across it. Mission 1 makes the companion; mission 6 triggers the toucan fly-past.

**The onça's distance.** The fauna module's personal space is 15 studs (9 u); `LEVEL.md`'s 15 u is met by showing the onça the child's position scaled by 9/15 toward itself. After its 0.8 s notice its own steps never close the gap.

## 5. Homes, crowns and the plan

- `planLife(world, level, seed)` is pure and deterministic: the same seed replays identical animals, bones, particles and flocks.
- Arboreal routes run on the crown rims (0.55–0.95 of the radius), because the crowns are closed volumes; tree dwellers must stay inside a real modelled crown, between its base and its top (`homes.test.ts`).
- **`CROWNS`** (`homes.ts`) gives each tree species `base` (where the leaf mass starts), `top`, `radius` and `model`, in model units; the placement scale multiplies them. The seven staging-v2 trees (ipê-amarelo, ipê-rosa, pau-brasil, jequitibá, jerivá, juçara, mangue-vermelho) were measured on their lod0 node: the foliage is the geometry whose UVs fall in the atlas' leaf and frond cells, `base` its 5th height percentile, `top` the tree's height, `radius` the 95th percentile of the distance from the trunk axis. Araucária, embaúba and xaxim keep their `custom-*.glb` measures. Every species is `model: true` now; the P8 wiring note about three species still being `false` is superseded.
- **Regenerate the crown numbers** with `node game/scripts/life-crowns.mjs` (`TREES_DIR`, default `game/src/assets/models/trees/`; `SPECIES` to narrow). It prints the figures; copy them into `CROWNS` by hand. The packed repo GLBs weld vertices, so percentiles move slightly against the raw staging GLBs `CROWNS` was measured on; heights and maxima match.
- **The muriqui row** (`MURIQUI_HANDHOLDS` in `level/layout.ts`) sits 8 u above the ground since P9, under the juçara fronds; at 10 u it ran through them. That changed `GOLDEN_LEVEL` but not `GOLDEN_WORLD`. Life reads `level.handholds` from `buildStoryWorld`, so nothing in `life/` changed.

## 6. How the animals are drawn

- `pets.ts` bakes each GLB (the Cube Pets bases and the P23 models) plus its attachment (the mico's mane, the toucan's bill, the onça's rosettes) into one geometry with **rigid skinning**: every vertex follows exactly one node of the original rig. Bones keep the GLB names and rest transforms, so `bindAnimal`/`placeAnimal` from `src/animation/animals/` drive each copy unchanged.
- Animals are drawn in **at most four pools**, one per map quadrant of their homes: one `SkinnedMesh` and one draw each. Every species' palette sits in one atlas (`paletteAtlas`), so one material serves all; attachments carry vertex colours and a per-vertex `lifeMap` weight turns the palette off for them. A pool's bounding sphere follows its animals every frame, so a pool out of view costs no draw.
- Material: the house Lambert family (stylize, with the character rim of `ART.md` §5). There is no back-face outline: it would be a second draw per pool.
- Shadows: no shadow maps. Up to `BLOB_LIMIT = 16` blob shadows from the shadow rig's shared slots, for ground animals of at least 0.5 u, the companion and the onça first, then by size. Tree animals get none; a blob 10 u below them reads wrong.

## 7. Budgets and the allocation rules

- **Gates** (`living-world.test.ts`): the layer within **7 draws** (≤ 4 pools + 2 flocks + 1 particle system) and **40k triangles**; the pooled animal geometry under 36k triangles. P8's original gates (≤ 20 draws, one per animal, ≤ 25k triangles) are superseded.
- **Animated cap** (`LIFE_TIERS`): low 10, medium 14, high 20 animals animated per frame, nearest first; out of view an animal freezes and its pose stays bit-identical; near animals update every frame, far ones every 3rd. Over-cap animals freeze in place rather than vanish.
- **Particles**: live leaves and pollen capped at 80 on low and 150 elsewhere; with the ≤ 15 butterflies that stays inside `ART.md` §8's 120 / 200.
- **CPU** (P8, Node on a desktop i9 with 13 animals): `update()` 0.009–0.033 ms per frame. The P8 projection to a Cortex-A55 at ×25 was 0.23–0.83 ms, inside the 1 ms budget; P23 sized the larger caps at about 10 µs per animal per frame on a phone. Phone numbers remain projections until the A07 run.
- **Allocation.** The layer's own code allocates about 16 B per frame; the residuals are in `src/animation/animals`. The rules that got it there, which every change must keep:
  - frame times go through `DT_TAGGED` (`tagged.ts`), so number-taking calls such as `Animal.frame` and `Flock.update` do not box a heap number;
  - ground heights through `GroundSampler` fields (set `x`, `z`, call `sample()`, read `y`), never number arguments and return values;
  - distances as whole units (Smi), uniforms as `FloatUniform` instances rather than `{ value }`;
  - frustum tests on a plane array (three's `Frustum.setFromProjectionMatrix` boxed 24 numbers per frame);
  - wind and RNG results in fields, not return values.

## 8. Wind

- `WIND`: the sea breeze direction on the ground plane, gusts up to 1.1 u/s (leaves, pollen and butterflies drift with it), `grassSway` 0.15 u and `canopySway` 0.1 u. The field repeats exactly every 600 s.
- CPU: `windAt` and `WindSample.read()`. GPU: `applyWind(material, { amplitude, from, to, sample: 'origin' | 'vertex' })`, where `from`/`to` are local model heights (the mask starts at the crown base, so trunks stay still) and the amplitude is in world units. `CROWNS[kind].base/top` feed it for trees.
- `applyWind` chains `onBeforeCompile`, extends `customProgramCacheKey` and marks `material.userData.lifeWind`, so it works before or after `stylize`/`houseMaterial`; check the flag before applying twice. `WIND_HEADER` and `windVertex()` are exported for hand-patched shaders. `life.update()` refreshes the shared `windUniforms`.

## 9. Particles, flocks and Iara

- **Leaves and pollen** (`PARTICLES`): a pool of 150; 7 leaf and 8 pollen spawn attempts per second within 13 u of the player, dropped beyond 22 u. Leaves fall only from crowns (the canopy grid, 2 u cells), tumble at 0.45–0.85 u/s, lie flat for 1.4 s, then fade. Pollen floats over cleared ground with no crown above.
- **Flocks** (`flocks.ts`): butterflies over the clareira, 0.5–3 u above the ground, drifting downwind; 7 saíras over the micos' fragment.
- **Iara** (`IARA`): every few seconds she varies her idle (looks around, checks the radio, points down the trail). Inside 8 u she turns to face the child and looks at them; beyond 10 u, after 3 s, she returns to her post. Her hands beat while her dialogue is open. Everything adds onto the animator's pose, so the wave emote still plays alone.

## 10. Reduced motion

`ART.md` §7 applies: wind strength goes to 0; no leaf or pollen spawns and the live ones fade out in 120 ms; flocks hold still; animals take the fauna module's reduced layers; Iara stops her idle variations and talk beats but still turns to face the child.

## 11. Dev pages and verification

```sh
./node_modules/.bin/vitest run --config game/vite.config.ts game/src/life
./node_modules/.bin/vite --config game/vite.config.ts --port 5191
```

- **Preview** (`/src/life/preview.html`): the real map, terrain and tree pools, the layer with blob shadows and an `IaraLife`-driven Iara, with a counters HUD. Parameters: `shot=<name>` (default `micos`), `quality=low|medium|high`, `manual` (no loop; drive `window.__life` with `shot`, `step`, `measure`, `debug` for deterministic captures), `trees=0` (x-ray: tree pools hidden), `reduced`, `cam=x,y,z,tx,ty,tz` (camera and target), `track=<plan key>` with `dist`, `lift`, `angle` for close-ups.
- **Lineup** (`/src/life/lineup.html`): every species beside the avatar and a 3 u scale bar, orthographic, in the game's light. `part=small` frames the small species four times larger; `strip=<species>` shows its walk and run in four phases each; `side=shade`, `w`, `h`. `window.__lineup.ready` turns true once drawn.
- Neither page ships: the pack's entry is `src/ui/loading/entry.ts`.
- **What the tests cover:** spawns on valid ground and inside crowns; the companion (wild before mission 1, climbs down, stays within 4 u of a walking child, back to the canopy on restart); the onça leaving; LOD, freezing and the cap; the particle caps even at 5,000 spawns/s; dispose (every geometry, material and texture disposed, no `abort` listeners left, GLBs released after baking and on an abort mid-load); determinism per seed; shader compilation through `glslangValidator` with negative controls (an anchor rename in three throws); Iara.

## 12. Open issues

- **Canopy hides animals.** The north fragment is dense with juçara crowns at 4–8 u; bugios on crown rims are half hidden. If the golden sheet still shows palms between the eye and the muriqui row, the next step is keeping juçara and jerivá out of a ~6 u band around `MURIQUI_ROW` in `level/build.ts`, which moves trees and changes `GOLDEN_WORLD`.
- **Fauna module notes:** `MicoBehaviour` ignores `start` and places only x and z until its first update, so the layer passes the route start as x, y, z.
- **A07 measurement** of the whole layer is pending; desktop and SwiftShader runs do not replace it.
- **Debt:** `GroundSampler` duplicates `survival/terrain.ts` `heightAt` (kept field-based for the V8 rule) pending one `world/ground.ts`; `particles.ts` overwrites `onBeforeCompile` instead of chaining it; `fixtures.test-helper.ts` duplicates the animals' Node GLB loader; `preview.ts`'s header still names `src/main.ts` as the build input.
