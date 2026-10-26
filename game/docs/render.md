# Secret Trail: render

How the game draws the forest at 30 FPS on an entry Android phone: quality tiers and the DPR governor, per-frame accounting, fog and LOD, instance pools, shadows, the shared Lambert look and grade, and the map's visual helpers. Art intent lives in `ART.md` (§4 budgets, §5 materials and light, §6 textures, §10 tiers); this file explains the code that carries it out and how to check a change.

Code: `src/render/` (engine-agnostic, imported through `src/render/index.ts`) and the map visuals in `src/world-runtime/`. The scene that wires them is `src/scene/Graybox.svelte`. History: P1 built the budget layer, P7 the version 2 look and the far field, P17 wave 2 (ground atlas, shores, cliff, leaf coverage), P32 the look pass (grade, ground field, cover, water). Where a phase report and the code disagree, the code below wins.

## 1. Files

| File                          | What it holds                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `render/quality.ts`           | `Quality`, `QUALITY` presets, `readCapabilities`/`probeCapabilities`, `pickQuality`, `DprGovernor`, `dprLimit`, `watchContextLoss` |
| `render/budget.ts`            | `BUDGET` gates, `FrameBudget`, `debugSnapshot()`, `collectTextures`/`textureBytes`/`shadowMapBytes`                                |
| `render/blocks.ts`            | `BlockGrid`: 40 u blocks, content bounds, frustum and distance test, `grid.update(camera)`                                         |
| `render/instancing.ts`        | `InstancePool`, `PoolSet`, `createPoolsFromScene`, `extractParts`/`mergePieces`, `addPlacements`                                   |
| `render/fog-lod.ts`           | `fogSettings`/`applyFog` from `VIEW` and `LIGHT`, LOD bands, `lodRank`                                                             |
| `render/shadows.ts`           | `SHADOW_TIERS`, `ShadowRig`, `BlobShadows`, `createHemisphere`, `SUN_AZIMUTH_DEG`, `LIGHT_INTENSITY`                               |
| `render/materials.ts`         | `houseMaterial` (GLTF material to the Lambert family), `preparePaletteMap`                                                         |
| `render/stylized.ts`          | `stylize()`, `patchStylizedShader`, `patchTreeVisibility`, shared `lighting` uniforms, `visualStep()`                              |
| `render/look.ts`              | `LOOK`, `LOOK_GLSL` (ACES fit + grade), `patchLook`, `gradeColor` (CPU reference)                                                  |
| `render/leaf-coverage.ts`     | Alpha-cut leaf edges with filtered coverage; volume normals on back faces                                                          |
| `render/canopy-visibility.ts` | `CanopyVisibility`: fades crowns and trunks between camera and avatar                                                              |
| `world-runtime/visual.ts`     | `createMapVisual()`: composes every map visual below, `prepareFrame`, `dispose`                                                    |

Palette, `LIGHT` and `VIEW` live in `src/style/palette.ts`; `SharedModelTextures` (atlas sharing and caps) in `src/scene/shared-textures.ts`.

## 2. Frame order

Threlte stages in `scene/Graybox.svelte`, every frame while the game is ready, visible and has a context:

1. **Budget stage (before main):** `budget.beginFrame(now)` closes the previous frame across all passes and resets `renderer.info`; `governor.sample(delta)` and `dpr.set(governor.dpr)` when it changes. After 3 saturated windows at the lowest DPR the tier drops one step (high → medium → low, never back up) and `compileAsync` runs again.
2. **Main stage:** input, controller, camera, animation, life, sound, story; `shadows.markMoved()` when the avatar or an actor moved or changed pose.
3. **Cull stage (after main, before render):** sun spots uniform (0 under reduced motion), `lighting.uGameEye`, `visual.prepareFrame(camera, time, quality, night)` (cover, waterfall spray, impostor range, far field, near-chunk visibility, atmosphere), `grid.update(camera)`, `shadows.blobs.sync()`, the park's eye and streamed assets, then `shadows.update(player)`.
4. **Render.**
5. **HUD stage (after render):** photo capture if pending, golden-frame readiness, HUD state throttled to every 250 ms.

The comment at the top of `render/index.ts` still lists the P1 version of this order; the steps it names are the same.

## 3. Tiers, capabilities and DPR

`main.ts` creates `WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: golden })` and calls `pickQuality(readCapabilities(renderer.getContext(), …))` on the game's own context, so a 3 GB phone never holds a second probe context. `canRender: false` (no WebGL2, or SwiftShader/llvmpipe) throws `game-webgl-unavailable`, except in builds made with `GAME_ALLOW_SOFTWARE_TEST=1` (`__PACK_SOFTWARE_TEST__`), which acceptance and CI use; the default build forces it off.

`pickQuality` returns low for Save-Data, any weak GPU (Mali-G31…G76, PowerVR/IMG, Adreno ≤ 61x, GE8xxx), `deviceMemory ≤ 4` on a phone or non-desktop GPU, ≤ 4 cores, a masked name on a phone, and every phone unless `mobileMedium` is set and the GPU is strong. High needs a desktop GPU with ≥ 8 GB and ≥ 8 cores; other desktops get medium. Both call sites pass `mobileMedium: false` (`main.ts`, `Graybox.svelte`): every phone is low until the Galaxy A57 is measured.

| Tier   | `dprStart` | `dprMax` | `maxPixels` | Shadow map          | View (fog near / far) | Detail terrain / trees |
| ------ | ---------: | -------: | ----------: | ------------------- | --------------------- | ---------------------- |
| low    |          1 |        1 |      0.5 MP | none, blobs for all | 75 / 140 u            | 56 / 48 u              |
| medium |          1 |     1.25 |      1.1 MP | 1024, ±18 u, actors | 105 / 180 u           | 72 / 64 u              |
| high   |       1.25 |      1.5 |      2.4 MP | 2048, ±30 u, all    | 155 / 260 u           | 96 / 80 u              |

Sources: `QUALITY` in `render/quality.ts`, `SHADOW_TIERS` in `render/shadows.ts`, `VIEW` in `style/palette.ts`, `detailDistances` in `world-runtime/far-field.ts`.

**DPR governor** (`DprGovernor`): ladder 0.75, 0.85, 1, 1.25, 1.5; one decision per 45-frame window on its p75. Two slow windows in a row (p75 > 36.7 ms) step down, four fast ones (p75 < 20 ms) step up, anything between resets both streaks, one window is ignored after a change, and the second drop from the same step closes the ceiling below it for the session. Intervals ≥ 1 s (hidden tab) are ignored. `dprLimit(cssW, cssH, devicePixelRatio, maxPixels)` caps by screen and pixel count; call `setLimit` on resize or rotation and re-apply `dpr.set`, because Threlte's derived DPR overwrites the governor's choice. It is allocation-free per frame.

**Context loss** (`watchContextLoss`): `lost` pauses time and input and never touches GL; `restored` calls `shadows.invalidate()`, `governor.reset()`, `budget.reset()` and resumes (three re-uploads CPU-side buffers itself); two losses within 3 minutes call `failed`, which ends the instance through the bridge.

## 4. Budgets and accounting

`BUDGET` (`render/budget.ts`): 200 draws per frame across all passes (hard), 150 comfortable, p95 frame interval 33.3 ms, 200,000 triangles, 4 MiB of texture memory. ART.md §4 states the same A07 gates. PARK.md §8 applies them to every pose of every zone; WORLD.md §7 adds "no hitch over 50 ms" for F1.

- three resets `renderer.info` on every `render()` call, so a frame with a shadow pass would report only its last pass. `FrameBudget` turns `autoReset` off and resets once per frame in `beginFrame`. Its window is 120 frames; `stats()` sorts a copy, so call it a few times a second.
- `debugSnapshot()` returns `fps, frameP95Ms, drawCalls, triangles, dpr, quality, programs, geometries, textures`; the scene merges it into `globalThis.__gameDebug` under `?debug`, which the golden captures and `map-measure.ts` read.
- Texture bytes include mips (×4/3) and data textures; render targets are counted apart. A directional shadow map in three r186 is an RGBA8 target plus 32-bit depth: 8 MiB at 1024, 32 MiB at 2048 (`shadowMapBytes`). The map's own textures (ground atlas, data fields) are reported through `SceneVisual.textures`.
- The pool draw count does not grow with instances: one pool is one draw per pass. P1's estimate of ~60 draws on low predates the version 2 look and is superseded.

Measured on Chrome with an RTX 4090, mobile viewport 915×412, low tier, CPU throttled 4× (not a phone):

| Phase                             | Worst draws | Worst triangles |     p95 |    Textures |
| --------------------------------- | ----------: | --------------: | ------: | ----------: |
| P17, live, five poses             |         133 |         125,852 | 17.4 ms |    3.93 MiB |
| P32, frozen golden set (11 poses) |         141 |         164,791 |     n/a | 3,806,553 B |
| P32, live world (44 animals)      |         132 |         159,208 | 17.5 ms | 4,130,393 B |

The draw reserve under 150 is small: streaming must replace near detail, not add scenes on top of it. High is not held to the low gates (P32: 162 draws at P11, 255,982 triangles at P5). The A07 measurement is still pending; no desktop number replaces it.

## 5. Fog, view distance and LOD

- `fogSettings(quality, variant)` takes the colour from `LIGHT[variant].horizon` and distances from `VIEW`; night pulls the end in to 0.8× (`NIGHT_FOG_END`) and keeps the start at least 10 u before it. `applyFog` reuses the scene's `Fog` (changing it never recompiles), sets `camera.far` to the fog end and a Color background to the fog colour.
- Near detail stops before the fog: terrain chunks past `detailDistances(q).terrain` are hidden in `prepareFrame`, and detailed trees fade to impostors around `detailDistances(q).trees` (a 12 u dithered band, `uTreeRange ± 6`). The far field and impostors fill the rest out to `VIEW.far`.
- Block LOD (`lodProfiles`), camera to the nearest point of a block's content: trees keep all up to fog near, ½ to the middle of the fog, ¼ to its end; rocks all, then ½; cover all to half the fog start, ½ to the fog start, none beyond; gameplay objects are never thinned. `lodRank` is the 8-bit bit reversal of the slot, so a quarter is always nested inside the half and trees thin out instead of swapping.
- Stale comment: the header of `render/fog-lod.ts` still says low fog is 30/70 u; P7's far field moved `VIEW` to the values in §3.

## 6. Instance pools

- One `InstancedMesh` per (GLTF node, material) with a fixed capacity and stable ids. Child meshes that share a material are merged; quantized kit positions are de-quantized and the node's own offset kept. A white `color` attribute is always added, so every house material shares one program family. `BatchedMesh` is avoided: without `WEBGL_multi_draw` it falls back to one draw per geometry.
- Culling is per 40 u block (`BLOCK_SIZE`, also in `survival/types.ts`). When a block's keep share changes, the pool packs the kept instances of visible blocks at the front of its buffer, block by block, and sets `count`; a move inside a drawn block is written in place. Nothing in the per-frame path allocates. Pool meshes set `frustumCulled = false` and keep their own bounds.
- `addPlacements` feeds the generator's typed arrays (kind, x, y, z, scale, yawC, yawS) in block order; `scaleFor` gives each kind its base scale.
- Instance colour tints the whole mesh, trunk included. Partial species colour belongs in the model's vertex colours or atlas (ART.md §5).
- `SharedModelTextures` shares the named `foliage-atlas`, `trees-atlas` and `decor-atlas` within one model batch and caps them in memory: `foliage-atlas` 256, `trees-atlas` 448 (`world-runtime/placements.ts`). P32 cut the trees atlas from 512 to 448 to get the 44-animal world back under 4 MiB (−327,680 B); the PNGs are unchanged.
- Gotchas: block bounds only grow (after large edits call `grid.clearBounds()` and `refreshBounds()` on each pool); P1's bench repacked on about 37 % of frames, each a buffer upload of at most capacity × 64 B, which may stall on Mali drivers.

## 7. Shadows and light

- **Low:** no shadow map. One instanced blob quad (one draw) under the avatar, animals and pickups, tinted with `LIGHT[variant].hemisphereGround` at opacity 0.5; a blob shrinks as its owner rises. Static assets carry baked AO and the sky gradient in vertex colours, and the canopy shade map darkens the floor.
- **Medium/high:** a texel-snapped map that follows the player. `renderer.shadowMap.autoUpdate = false`; `update()` re-renders only when the light moved a texel, `markMoved()` was called, or after `invalidate()`. Standing still renders no shadow frames. `interval` is 1 on both map tiers because players judge jumps by the avatar's shadow; `ShadowRigOptions.interval` is the thermal knob. Dropping to low disposes the map.
- **Sun and sky (P32):** sun `#ffe2b5` at 35°, azimuth 245° (west-south-west); hemisphere sky `#cfe8ff`, ground `#6f8f45`; intensities hemisphere 1 / sun 1.6 by day, 0.6 / 0.45 at night. The canopy bake and cast shadows use the same azimuth. Keep `<Canvas shadows={false}>`: the rig owns `shadowMap`.

## 8. The look: one Lambert family, one grade

- **Materials.** `houseMaterial` turns every GLTF material into `MeshLambertMaterial` with vertex colours, keeping map, side and alpha settings; maps over 64 px get linear filtering and mipmaps, smaller ones stay nearest (palette). `stylize()` then chains its patch onto `onBeforeCompile` and extends `customProgramCacheKey` with `guardioes-lambert-v2:<vegetation>:<cover>:<terrain>:<canopy>`. Vegetation keeps smooth (volume) normals; everything else is flat shaded.
- **What the patch does:** a soft sun ramp (`smoothstep(-0.15, 0.55, N·L)`), hemisphere-tinted indirect light, the baked canopy shade map with moving sun spots on shade receivers, an optional rim for characters (0.09), a cool tint on the unlit share of each pixel, height mist above `uMistBase` on top of linear fog, and on terrain a wet band and foam line from the per-vertex `shore` attribute. `cover` forces up-facing normals.
- **Grade (`render/look.ts`).** One ACES fit plus a lift/gamma/gain grade (exposure 1, saturation 1.16, gamma 0.97, channel gain 1.045/1.015/0.96, night ×0.72, clamp 0.985), applied once per shader by replacing `tonemapping_fragment`. The canvas stays `NoToneMapping` (Threlte's AgX default desaturates the palette), and sky, fog colour, far haze and impostors use the same `lookGrade`, so there is exactly one grade per pixel and no post pass. `gradeColor` is the CPU reference.
- **Leaves.** Tree GLBs keep their authored cut-out (alphaTest 0.5). `patchLeafCoverage` replaces the hard alpha test with filtered coverage and a stable ordered threshold, and keeps the crown's volume normal on back faces (a flipped card normal made dark bands). `world-runtime/tree-depth.ts` builds the matching depth material (same map, wind and visibility).
- **Canopy visibility.** `CanopyVisibility` tests the camera-to-head segment against each crown ellipsoid and its trunk cylinder (visibility only, never collision) and fades the whole tree over 0.15 s (instant under reduced motion) through the `instanceFade` attribute. The fade is a 4×4 ordered dither with `discard`, which keeps depth writes, single-pass instancing and opaque sorting.
- **`visualStep()` and `?golden&look=0..4`.** Each level switches on one layer, for golden comparisons: 0 plain materials (also forced by `?e2e`), 1 stylized Lambert and the ground atlas, 2 continuous terrain and trail ribbons, 3 canopy shade, 4 height fog and atmosphere. It only reads `look` in DEV builds with `?golden`; shipped builds always use 4. Under `?estudo`, `look=raw|painted` is a different switch (see `study/gate.ts`).

## 9. Map visuals (`createMapVisual`)

| Helper                                      | What it draws                                                                                                      | Cost and notes                                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `terrain.ts`, `materials.ts`, `surfaces.ts` | Terrain per 40 u block, colour from continuous height, slope and noise fields; world-space UVs on one ground atlas | Atlas held at 128² in memory (87,382 B with mips), shared by ground and trails; cliffs use a dominant-plane projection with strata and moss                                                                                    |
| `ground-field.ts`                           | R8 128² signed distance to trail edges, −2..6 u at 1.25 u texels                                                   | 16,384 B; soft trail edges and leaf-litter band                                                                                                                                                                                |
| `paths.ts`                                  | All trails in one ribbon                                                                                           | Clipped per 1 u cell and along the terrain's own diagonal, 0.035 u offset (P17: 21,690 triangles)                                                                                                                              |
| `shore.ts`, `flow.ts`                       | River and pool as one water surface; waterfall cells                                                               | Signed shore distance, wet band about 1.15 u, shallow-to-deep colour, foam                                                                                                                                                     |
| `waterfall-foam.ts`                         | Spray at the waterfall foot                                                                                        | 24 instanced quads, no texture; follows reduced motion                                                                                                                                                                         |
| `canopy.ts`                                 | Crown shade bake along the sun azimuth                                                                             | R8, up to 320²                                                                                                                                                                                                                 |
| `cliff.ts`, `asset-plan.ts`                 | Outcrops, roots and strata merged into the terrain batches; cliff decor and bromélias                              | No extra draw per piece; obby supports stay clear                                                                                                                                                                              |
| `ground-cover.ts`                           | Grass and flower tufts near the camera                                                                             | One opaque instanced draw, 8 blades + 6 petals per tuft, 2 u cells within about 18 u, capacity 800/1200/1600; refills only when the camera crosses a cell; shared wind; no shadow pass; excluded from water, bridges and decks |
| `atmosphere.ts`, `boundary.ts`              | Sky dome, sun and halo, clouds, serra silhouettes, sea to the west, exterior apron                                 | Fog-free, palette-premixed; the sea sits at the absolute water level (P7 fixed a camera-relative sea that covered the lowland)                                                                                                 |
| `far-field.ts`                              | Whole map on a 4 u grid plus apron rings                                                                           | One draw (P7: 4,480 triangles); depth clamped to the far plane instead of clipped; haze keeps land contrast                                                                                                                    |
| `tree-impostors.ts`                         | One billboard per tree beyond the detail band                                                                      | One draw, 2 triangles per tree; atlas painted on a CPU canvas from the real GLB triangles, 5 columns of 64×128 tiles (320×256 for 10 species)                                                                                  |
| `overlook.ts`                               | Legacy mirante deck                                                                                                | Skipped when `level.act1.decks` has `mirante-deck`: the mechanics module owns the deck                                                                                                                                         |

`createMapVisual(world, level, pads, storyProps, { streaming })`: under streaming, chunks come from `world-runtime/streaming/` (see `docs/world-gen.md`), so the far field, ribbons, water surface, per-block terrain and waterfall spray are skipped here and `prepareFrame` drives the streamed far-terrain uniforms instead. Under `?e2e` (`scene/testing.ts`) the far field, cover and spray are skipped.

## 10. Shader patches and program cache keys

Every patch is a string replace on a three chunk inside `onBeforeCompile`, keyed by `customProgramCacheKey`. Rules:

- Chain: call the previous `onBeforeCompile` and extend the previous key. A patch that overwrites them drops whatever was there before (wind, look).
- A new or changed key means a new program: a compile hitch on the phone and possibly pixel diffs. Run the golden frames after touching any key, and `renderer.compileAsync(scene, camera)` runs before the game is shown and after a tier change.
- `String.replace` silently does nothing if three renames a chunk; `life/wind.ts` throws instead, which is the safer pattern.

| Site                                     | Key suffix                          | Style                          |
| ---------------------------------------- | ----------------------------------- | ------------------------------ |
| `render/stylized.ts` `stylize`           | `guardioes-lambert-v2:…`            | Eager key capture, chained     |
| `world-runtime/materials.ts`             | `surface-v2:<kind>`                 | Chained                        |
| `world-runtime/ground-cover.ts`          | `opaque-cover-p32`                  | Chained                        |
| `world-runtime/far-field.ts`             | `far-reserve-v1`                    | Chained                        |
| `world-runtime/streaming/far-terrain.ts` | `stream-far-v1`                     | Chained                        |
| `world-runtime/flow.ts`                  | `waterfall-cell-v1`                 | Chained                        |
| `world-runtime/atmosphere.ts`            | `look-p32`                          | Chained                        |
| `world-runtime/tree-depth.ts`            | `canopy-depth-v1`                   | Chained                        |
| `life/wind.ts` `applyWind`               | `life-wind:<sample>`                | Lazy key (`key.call`), chained |
| `life/pets.ts`                           | `life-pet`                          | Lazy key, chained              |
| `life/particles.ts`                      | `life-particles`                    | Overwrites                     |
| `animation/animals/flock-mesh.ts`        | `WING_FLAP_CACHE_KEY`               | Overwrites                     |
| `study/stylize.ts`                       | `study-contour`, `study-outline-v2` | DEV only                       |

A shared `chainShaderPatch` helper is planned (see `ROADMAP.md`); until then, copy the chained style.

## 11. How to check a render change

- **Unit tests:** `./node_modules/.bin/vitest run --config game/vite.config.ts src/render src/world-runtime`. No WebGL is needed; budget, governor, shadows, pools, grade, cover exclusion and memory have tests.
- **Golden frames** (`game/golden/README.md`): with `pnpm game:dev` on 5196, `node game/golden/capture.ts --set <name>`, `compare.ts --set <name>` (gate 0.5 % of pixels), `sheet.ts --after <name>`. Freeze one source tree and asset hash for before and after, or concurrent lanes pollute the diff. Never `--approve` a baseline without the owner. Use `?golden&look=0..4` to isolate one layer.
- **GPU fixtures:** `node game/golden/look-acceptance.ts` checks the grade on the GPU against `gradeColor` (12 day/night samples, ≤ 2 bytes; P32 measured 1); its default URL is port 5198, so set `GAME_MEASURE_URL=http://127.0.0.1:5196/`. `node game/golden/dither-acceptance.ts` checks the detail/impostor midpoint (8 + 8 pixels, no holes or overlap), canopy hide/restore (16/16), leaf front equal to back (±1) and zero pixels from fully transparent texels, then a `?negative=1` run that must show 8 holes and 8 overlaps.
- **Frame gates:** `node game/map-measure.ts` (mobile viewport 915×412, `deviceMemory` and cores 4, low tier, real poses, 20 re-entries) writes counters per pose; for p95 the phases used Chrome `--use-angle=gl` with CDP `Emulation.setCPUThrottlingRate({ rate: 4 })`. The `?debug` overlay shows the same counters live.
- **Pack:** `pnpm test:game-pack` (A/B/C, offline, 20 + 20 mount cycles with no leaked contexts, rAF or listeners).
- **Device:** the step closes only with ART.md §4's gates on the Galaxy A07.

## 12. Open issues

- **A07 (low):** 30 FPS and p95 ≤ 33.3 ms over the route plus 10–15 min of thermal soak; confirm its renderer string is in the weak list; watch `governor.saturated`; its panel may be 90 Hz, which `fastFactor` does not assume.
- **A57 (medium):** decide `mobileMedium` (a 1024 map with actor casters, 8 MiB of shadow targets).
- **Leaves on low:** ART.md §5 asks for opaque leaves without alpha test on low, but the tree GLBs are cut-out on every tier; the A/B on the A07 decides.
- **MSAA** is off (`antialias: false`); an A/B on the A07 decides.
- **Shader compile:** check `KHR_parallel_shader_compile` on Mali-G52/G57 and measure `compileAsync`.
- **Repack uploads on Mali:** double-buffer or rate-limit if profiling shows stalls.
- **Governor thresholds** (36.7 ms / 20 ms / 45 frames) were tuned on a desktop; tune them on phone traces. Tune context-loss `maxLosses`/`windowMs` the same way.
- **High tier shadow pass** draws every main-view flora instance, beyond the ±30 u box; add a shadow-specific pack only if high ever reaches phones.
- **Draw reserve:** the live low peak is about 9 draws under 150; zones and streaming must stay inside it.
- **Debt:** unify the shader patch styles (§10); fix the stale fog comment (§5); the P16 study soil is DEV-only and not wired.
