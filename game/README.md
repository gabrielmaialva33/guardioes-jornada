# Secret Trail: the game

The Trilha Secreta is a 3D kids' game hidden inside the Guardiões da Mata Atlântica app. It plays like Roblox: a blocky avatar, obbies, a story map with missions (the Reserva da Iara), a park of zones around it (the Parque da Iara), living Atlantic Forest fauna and a field guide, the Guia da Mata. This file is the map of `game/`: how it boots, where things live, the rules every change follows and where the deeper docs are. Plans and open items are in `ROADMAP.md`.

## 1. What the game is

- **An independent pack.** `game/` builds into its own content-addressed pack, outside the app's bundle and service-worker install. The app's `/secret-trail` route (`src/routes/secret-trail/+page.svelte`, with `src/lib/data/game-pack.ts` and `game-pack-cache.ts`) checks, downloads and caches the pack, then imports its entry and calls `mountGame`. The only contract between them is the plain-data ABI in `abi.ts` and `protocol.ts` (`GAME_ABI = 1`). See `docs/pack.md`.
- **Offline after the first entry.** Once downloaded, the pack opens with no network. The game never calls Supabase, sends no telemetry and asks for no personal data; it saves per device (`src/data/local-save.ts`).
- **Target device.** Entry-level Android phones with 3–4 GB of RAM (Mali-G52/G57, Adreno 610); the Galaxy A07 is the measuring device. The low quality tier must hold 30 FPS there (§9).
- **Stack.** three 0.186.1, Svelte 5 (runes), `@threlte/core` 8.6.1, `three-mesh-bvh` 0.9.16, Vite 8, Vitest 5, Playwright. The game's own dependencies are in `game/package.json`.
- **Language.** Code, comments and docs in English; everything the player sees or hears in Brazilian Portuguese.

## 2. Commands

From the repository root:

```sh
pnpm game:dev          # game alone on http://localhost:5196 (dev.ts; the Green Hell study is on by default here)
pnpm build:game        # node game/build.ts: Vite build into game/.build, then the pack into build/game-packs/
pnpm build             # the app, then the game pack
pnpm test              # Vitest, app + game (maxWorkers 2)
./node_modules/.bin/vitest run --config game/vite.config.ts game/src/<folder>   # one folder
pnpm check             # svelte-check of the app, the service worker and the game
pnpm lint              # biome check + prettier --check on .svelte
pnpm test:e2e          # Playwright against the production build (tests/*.test.ts)
pnpm test:game-pack    # node game/acceptance.ts: production A/B/C pack acceptance (§8)
```

Golden frames and sheets (`golden/README.md`): `node game/golden/{capture,compare,sheet,avatar-sheet,loading-sheet,look-acceptance,dither-acceptance}.ts`.

Local harnesses: `node game/map-measure.ts`, `node game/controls-acceptance.ts`, `node game/avatar-wiring-acceptance.ts`.

Assets and generators (`scripts/`):

| Script                                    | What it does                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `scripts/assets.mjs`                      | Idempotent Kenney/custom asset pipeline into `src/assets/` (reads `KENNEY_RAW_DIR`, `CUSTOM_RAW_DIR`)               |
| `scripts/audit.mjs`                       | Palette and budget audit of the shipped models                                                                      |
| `scripts/blender/`                        | Headless Blender builders (`models/*.py`, `build_all.py`), `lineup.py`, `bake.py`, `recolor.py`, the foliage atlas  |
| `scripts/split-hair.mjs`                  | Hair contract v3: splits the dangling hair parts of `avatar-hair.glb` into child nodes                              |
| `scripts/quantize_png.py`                 | 256-colour palette PNGs for the painted atlases                                                                     |
| `scripts/world-gen/park-edges-table.ts`   | Regenerates `src/world-gen/park-edges.ts` (env `ROOT`, `OUT`); run Biome format on the output (`docs/world-gen.md`) |
| `scripts/life-crowns.mjs`                 | Prints the crown measures behind `life/homes.ts` `CROWNS` (env `TREES_DIR`, `SPECIES`; `docs/life.md`)              |
| `scripts/measure-glb.mjs`                 | Prints the rig measures behind `animation/animals/rigs.ts` (`[repo]`, env `MODELS`; `docs/animation.md`)            |
| `docs/level-plan.py`, `docs/park-plan.py` | Top-down plans of the Reserva and the park (`python3 game/docs/park-plan.py game/docs/park-plan.png`)               |

## 3. Boot, load and loop

**Boot.**

1. The launcher (`src/routes/secret-trail/+page.svelte`) checks the published pack, downloads and caches it, then imports `entry.js` and calls `mountGame(element, bridge)`.
2. `entry.js` is `src/ui/loading/entry.ts` (the Vite build's only input, P11). It mounts `LoadingScreen` at once, then `import('../../main.ts')`, the game chunk. A failure from here on is shown on the screen: "Tentar de novo" (remount) and "Sair" (`bridge.exit`), or only "Voltar" on a device that cannot draw 3D. Golden runs skip the screen.
3. `src/main.ts` `mountGame` mounts `Root.svelte` and hands it `createRenderer`: one `WebGLRenderer` (no antialias, `low-power`), a quality pick (`pickQuality(readCapabilities(...))`), the loop paused on `visibilitychange`/`pagehide`, and an awaitable, idempotent dispose. A device that cannot draw 3D throws `game-webgl-unavailable` (allowed in software-test builds).
4. `src/dev.ts` mounts the same loader on the dev page, with a fake bridge.

**Session (`Root.svelte`).**

- Picks the world: `buildStoryWorld()` (`level/build.ts`) by default; `?world=survival` (legacy generator); `?graybox` (the old fixture); the golden lineup. The `?zone=<id>` path (`world-runtime/streaming/zone-loader.ts`) is waiting for P36.
- Builds the map environment (`world-runtime/environment.ts` `createMapEnvironment`), the `StoryGame`, the `PlayerController`, the input model, the audio engine and `Soundscape`.
- Owns the HUD: top bar, touch controls, the story panel, the avatar editor (`ui/avatar-editor/AvatarEditor.svelte`, P12), the settings panel (sound and controls), the photo mode and the Guia (`ui/guia/GuidePanel.svelte` over `guia/` `GuideService`, P24/P29), the rotate prompt and the `?debug` overlay. Opening any panel pauses the scene and releases held input.

**Load (`scene/Graybox.svelte`, the real game scene despite its name).** Five loads run in parallel and report to the loading bar with their weights: story props 2, avatar 1, essential sounds 1, life 2, placements 3. Then `renderer.compileAsync` (weight 2), `ready = true`, `loading.ready()`, and the nature sounds start.

**Loop.** Threlte stages, in order:

1. **budget** (before main): closes the previous frame's counts, DPR governor.
2. **main**: `input.sample` → `controller.update` (fixed 60 Hz ticks) → camera → park photo and traversal → canopy fade → life → avatar animation → shadows `markMoved` → frame events (fall, respawn, checkpoint) → sound → story visit and action → story props → present.
3. **cull**: lighting, `grid.update`, shadows.
4. **render**.
5. **HUD**: throttled to 250 ms.

## 4. Module map

All paths are under `game/src/`. Folders marked WIP are in flight on 26/10/2026.

| Folder                             | Responsibility                                                                                                                                                                  | Doc                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `main.ts`, `Root.svelte`, `dev.ts` | Mount and dispose (ABI), session and HUD composition, dev page                                                                                                                  | §3                              |
| `ui/loading/`                      | The pack entry (`entry.ts`), `LoadingScreen`, progress model, loading facts                                                                                                     | `docs/pack.md`                  |
| `ui/avatar-editor/`                | Roblox-style avatar editor with a live 3D preview; pure logic in `editor.ts`; `preview.html`                                                                                    | `docs/avatar.md`                |
| `ui/guia/`                         | The Guia da Mata panel and species art; `preview.html`                                                                                                                          | `docs/content.md`               |
| `guia/`                            | Guia model: `SpeciesRegistry`, `species.ts` (sourced facts), discoveries, `GuideService` persistence, IndexedDB thumbnails; wiring contract in `guia/WIRING.md`                 | `docs/content.md`               |
| `engine/`                          | Fixed-step kinematic capsule on a static BVH, jump and camera rules, input, checkpoints, compound collision; Roblox-calibrated constants                                        | `docs/engine.md`                |
| `mechanics/`                       | Park mechanics as pure state machines: ladder, zipline, suspension bridge, canoe, photo camera, camera trap, boardwalks; `ParkRuntime`; the Guia bridge; `preview.html` fixture | `docs/engine.md`                |
| `animation/`                       | Avatar rig, Animate-style state machine, poses and gestures, procedural layers, hair sway                                                                                       | `docs/animation.md`             |
| `animation/animals/`               | Procedural fauna: species table, gaits, behaviours, LOD, flocks, rig measures                                                                                                   | `docs/animation.md`             |
| `life/`                            | The living world: animal homes and routes, flocks, wind, leaves and pollen, Iara's NPC life, pets; `preview.html`, `lineup.html`                                                | `docs/life.md`                  |
| `audio/`                           | WebAudio engine with buses, sound bank, `Soundscape`, story cues, surfaces, zone beds, synth placeholders                                                                       | `docs/audio.md`                 |
| `render/`                          | Quality tiers and DPR governor, `BUDGET` accounting, instancing pools, fog LOD, shadows, the stylized material patch and the look transform                                     | `docs/render.md`                |
| `world-runtime/`                   | The story map as three.js: terrain, surfaces, water, cliffs, canopy, atmosphere, far field, impostors, ground cover, paths, GLB placements, collision, avatar ground context    | `docs/render.md`                |
| `world-runtime/streaming/` (WIP)   | Chunk streaming (P34, P37): 40 u chunks in a ring around the player, Worker builds, per-chunk water, shore and trails, `?zone=` loader; P36 integrates it                       | `docs/world-gen.md`             |
| `level/`                           | The Reserva da Iara as pure data (`buildStoryWorld`): relief, river, obbies, Act 1, story data, vegetation, portals                                                             | `LEVEL.md`                      |
| `level/zones/`                     | The park's zones (P20): spec, seam stitching, `buildZone(id)`; content for Vale, Copa, Praia and Manguezal                                                                      | `PARK.md`, `docs/world-gen.md`  |
| `world-gen/`                       | The endless world (F0): macro relief, lattice rivers, biomes, blue-noise scatter, `generateChunk`, Worker host/client, park boundary stitching                                  | `WORLD.md`, `docs/world-gen.md` |
| `survival/`                        | The shared world shape (`types.ts` `SurvivalWorld`), noise, random, Poisson, checksums, `heightAt`; plus the legacy survival generator and save                                 | §6, `ROADMAP.md`                |
| `missions/`                        | `StoryGame` (missions 0–8, save, actions), mission text (`content.ts`), Act 1, story props, `StoryPanel`                                                                        | `docs/content.md`               |
| `scene/`                           | The game scene (`Graybox.svelte`), avatar loading and wiring, golden and e2e flags, HUD pieces, settings, controls; legacy graybox fixture and lineup                           | §3                              |
| `avatar/`                          | Avatar catalogue (presets, Kenney skins), skin atlas compositing, hair styles                                                                                                   | `docs/avatar.md`                |
| `data/`                            | The per-device save (`local-save.ts`)                                                                                                                                           | `docs/pack.md`                  |
| `style/`                           | Palette and motion tokens                                                                                                                                                       | `ART.md`                        |
| `assets/`                          | Shipped GLBs, skins, atlases and audio; `shared-images.ts` maps shared texture files                                                                                            | `CREDITS.md`                    |
| `study/` (DEV only)                | Local-only Green Hell study mode, tree-shaken out of every build                                                                                                                | §10                             |

At the `game/` root: the ABI (`abi.ts`, `protocol.ts`), the pack builder (`build.ts`, `pack-build.ts`, `dev-pack.ts`), the harnesses (`acceptance.ts`, `map-measure.ts`, `controls-acceptance.ts`, `avatar-wiring-acceptance.ts`, `story-driver.ts`), the study dev middleware (`study-dev.ts`) and `golden/`.

## 5. Contracts

| Contract                                                  | Where                                    | Notes                                                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GameBridge`, `GameModule`, `GameDispose`, `GameManifest` | `abi.ts`, `protocol.ts`                  | `mountGame(element, bridge)` returns a dispose at once; `bridge.exit()`, `bridge.earnBadge()`. Manifests are decoded as untrusted data |
| `SurvivalWorld` (the world shape) and `StoryLevel`        | `survival/types.ts`, `level/types.ts`    | Every map (Reserva, zones, generated chunks) uses the same `SurvivalWorld`; the audit plans to rename it `World`                       |
| `ZoneBuild`, `ZoneLevel`                                  | `level/zones/zone.ts`                    | One zone, zone-local, with its world offset                                                                                            |
| `StreamChunk`                                             | `world-runtime/streaming/types.ts`       | One streamed 40 u chunk                                                                                                                |
| `SceneEnvironment`, `SceneVisual`                         | `scene/environment.ts`                   | What the scene needs from a map: collision, checkpoints, visuals, placements, story, park                                              |
| `PlayerController`                                        | `engine/controller.ts`                   | Input → fixed ticks → camera, once per rendered frame                                                                                  |
| `ParkRuntime`                                             | `mechanics/park-runtime.ts`              | Traversal modes, contextual actions, photo camera and the combined collision                                                           |
| `StoryGame`, `StorySave`                                  | `missions/story.ts`                      | Mission state; the save is validated and versioned                                                                                     |
| `LivingWorld`                                             | `life/living-world.ts`                   | The life layer the scene updates per frame                                                                                             |
| `GameAudio`, `Soundscape`                                 | `audio/engine.ts`, `audio/soundscape.ts` |                                                                                                                                        |
| `GuideService`, `GuideSaveAdapter`                        | `guia/persistence.ts`, `guia/WIRING.md`  | Owns only the `guia` section of the save                                                                                               |
| `__gameDebug` (`GameDebug`), `HudState`                   | `scene/types.ts`, `render/budget.ts`     | Set under `?debug`; read by e2e, acceptance, map-measure and golden                                                                    |

## 6. Rules

- **Determinism.** World generation (`survival/`, `level/`, `level/zones/`, `world-gen/`) uses only operations ECMA-262 defines exactly: `Math.imul/sqrt/abs/min/max`, no `**`, no `Math.random`, no clocks, `Intl`, `toLocale*` or `crypto` (rules in `survival/random.ts`). The `determinism.test.ts` scanners in those folders enforce it, and golden checksums pin the output (`GOLDEN_LEVEL`, the world-gen and zone goldens). When moving generator code, keep it byte-identical.
- **V8 hot paths.** Nothing allocates per frame in steady state; numbers go through fields, not arguments of non-inlined functions; class number fields start as numbers; `Math.sqrt` over `Math.hypot`. The full list, with the measurements behind it, is `docs/animation.md` §12. Allocation tests assert it.
- **Reduced motion.** `prefers-reduced-motion` and the game's own setting turn off camera auto-moves, squash, sway, spray and other secondary motion; every new effect needs a reduced-motion path.
- **Offline.** Nothing in the game fetches from outside the pack; the save is per device and survives pack updates (older packs keep sections they do not understand).
- **pt-BR for players.** Every visible or audible string is Brazilian Portuguese; ids, code and comments are English. Content rules (sources, safety, the RJ setting) are in `docs/content.md`.
- **Art and licences.** `ART.md` governs every asset, animation and visual change; §10 below governs where assets may come from.

## 7. Debug URL parameters

| Parameter                                                                                                                                        | Where                                                         | Gate                 | Used by                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| `?debug`                                                                                                                                         | `scene/Graybox.svelte` (`__gameDebug`), `Root.svelte` overlay | none                 | e2e, acceptance, map-measure, controls-acceptance, golden |
| `?debug&pose=` `spawn`, `ledges`, `edge`, `stones`, `mirante`, `bridge`; with Act 1 `birds`, `deck`, `treehouse`; DEV-only `stone-top`, `wading` | `world-runtime/environment.ts` `debugPoses`, `Root.svelte`    | `pose` needs `debug` | golden poses, `tests/story-missions.test.ts`              |
| `?graybox`                                                                                                                                       | `Root.svelte`                                                 | none                 | `acceptance.ts` (obby, summit, badge)                     |
| `?world=survival`                                                                                                                                | `Root.svelte`                                                 | none                 | nothing (legacy mode)                                     |
| `?zone=<id>` (`reserva`, `vale`, `copa`, `praia`, `manguezal`)                                                                                   | `world-runtime/streaming/zone-loader.ts` `zoneParam`          | not wired yet (P36)  | zone testing (`PARK.md` §8)                               |
| `?e2e`: no life, empty pools, low tier, look step 0                                                                                              | `scene/testing.ts`                                            | DEV or software-test | `tests/story-missions.test.ts`                            |
| `?golden` with `t`, `seed`, `tier`, `cam`, `avatar`, `time=night`, `scene=lineup`, `life=companion\|butterflies`                                 | `scene/golden.ts`                                             | DEV or software-test | `golden/capture.ts`                                       |
| `?golden&look=0..4`: technique steps of the stylized look                                                                                        | `render/stylized.ts` `visualStep`                             | DEV only             | golden comparisons                                        |
| `?estudo=off\|greenhell`, `&look=raw\|painted`, `&hora=entardecer\|noite`, `&tempo=chuva\|chuva-forte`, `&som=nosso\|ambos`                      | `study/gate.ts`, `study/audio.ts`                             | DEV only             | the Green Hell study                                      |
| `src/life/preview.html`: `shot`, `quality`, `manual`, `trees=0`, `reduced`, `cam`, `track`, `dist`, `lift`, `angle`                              | `life/preview.ts`                                             | dev page             | life captures                                             |
| `src/life/lineup.html`: `part=small`, `strip=<species>`                                                                                          | `life/lineup.ts`                                              | dev page             | fauna lineups                                             |
| `src/mechanics/preview.html`: `manual&shot=ladder\|zipline\|photo\|bridge\|canoe\|trap\|boardwalk`, `reduced`                                    | `mechanics/preview.ts`                                        | dev page             | mechanics captures                                        |
| `golden/dither-fixture.html?negative`, `golden/avatar-sheet` page `?reduced`                                                                     | `golden/`                                                     | tool pages           | `dither-acceptance`, `avatar-sheet`                       |

`look` means two things: `0..4` under `?golden` and `raw|painted` under the study. `?debug`, `?graybox` and `?world=survival` ship ungated in the public pack today (`ROADMAP.md`, known debt).

## 8. Tests and tooling

- **Unit tests.** Vitest, next to the code (`*.test.ts`), about 760 in the game; Node-only (no GPU). Run large suites with a worker cap inside a memory-capped scope on the workstation.
- **End to end.** Playwright in `tests/`: `secret-trail.test.ts` (launcher and pack), `story-missions.test.ts` and `park-wiring.test.ts` (driven through the real controller by `story-driver.ts`, never teleporting), plus the app's `journey.test.ts`. They run against `pnpm build && pnpm preview` unless `E2E_BASE_URL` is set.
- **Acceptance A/B/C** (`acceptance.ts`, `pnpm test:game-pack`): builds three snapshot packs (A, B, C) with `GAME_ALLOW_SOFTWARE_TEST=1` on its own server, deploys none, and proves: zero game bytes at install; the update notice and an atomic switch to the new pack; an old pack still opening offline; 20 enter/exit cycles and 20 story/life cycles back to baseline; one audio codec per device. Details in `docs/pack.md` §12. Env: `GAME_ACCEPTANCE_DIR`, `GAME_ACCEPTANCE_PORT`, `GAME_ACCEPTANCE_CDP_PORT`, `PLAYWRIGHT_CHANNEL`, `GAME_TEST_ANGLE`.
- **Golden frames** (`golden/README.md`): fixed poses (`golden/poses.json`) captured at 960×432 with a fixed seed and clock, compared against the approved baseline (gate 0.5 % of pixels), reviewed as before/after/reference sheets, approved with `compare.ts --approve` (older baselines go to `history/`). Output lives in `~/.cache/guardioes-golden/` (`GUARDIOES_GOLDEN_DIR`).
- **Lineups.** The Blender lineup (`scripts/blender/lineup.py`, ART.md §9), the WebGL fauna lineup (`src/life/lineup.html`) and the golden `scene=lineup` pose.
- **Contact sheets.** `golden/avatar-sheet.ts` (avatar states and gestures), `golden/loading-sheet.ts` (loading screen on three layouts), `scripts/blender/models/*sheet.py` (props and coast models), `golden/sheet.ts` (golden review).
- **Measurement harnesses.** `map-measure.ts` (map smoke and per-pose counters), `controls-acceptance.ts` (touch controls), `avatar-wiring-acceptance.ts` (postures, gestures, hair, ground probes), `golden/look-acceptance.ts` (look transform), `golden/dither-acceptance.ts`. They write to the directory in `GAME_MEASURE_DIR`, `GAME_CONTROLS_DIR`, `GAME_AVATAR_DIR` or `GAME_DITHER_OUTPUT` and read the server from `GAME_MEASURE_URL`. Their defaults still point at the 25/10 scratch folder; moving them to `game/.out/` is Wave 0 work (`ROADMAP.md`).

## 9. Performance gates

- **Frame gates on the low tier** (`render/budget.ts` `BUDGET`, ART.md §4): 30 FPS with p95 frame ≤ 33.3 ms; ≤ 150 draw calls comfortable, 200 hard, counting every pass; ≤ 200k visible triangles; ≤ 4 MiB of textures. `PARK.md` §8 applies them to every pose of every zone.
- **Quality presets** (`render/quality.ts` `QUALITY`): low DPR 1 (max 0.5 MP), no shadow map, blob shadows; medium DPR 1–1.25 (1.1 MP), 1024 shadow map; high DPR 1.25–1.5 (2.4 MP), 2048 shadow map. The DPR governor steps through 0.75, 0.85, 1, 1.25, 1.5 and drops a tier when saturated. Medium on mid-range phones (`mobileMedium`) is off.
- **The F1 streaming gate** (`WORLD.md` §7, the F1 plan): on the A07, 30 FPS and p95 ≤ 33 ms walking across chunk borders, no hitch over 50 ms; on the low tier ≤ 140 draws, ≤ 180k triangles and ≤ 120 MB of JS heap after walking 1 km east and back. Until the A07 is plugged in, measure with a 4× CPU-throttled desktop run.
- **How to measure.** The `?debug` overlay (FPS, p95, draws, triangles, DPR, tier, geometries, textures, programs), `map-measure.ts` per pose, `golden/capture.ts --clock real` for real fps and p95. Desktop numbers are projections; every gate closes only on the A07.

## 10. Assets and licence tiers

The repository is public and every green push to `main` deploys, so every asset has a tier (`ART.md` §12):

- **T1, CC0 or CC BY:** repository, pack and site. CC BY is credited in `CREDITS.md`.
- **T2, non-commercial (CC BY-NC, NC-SA):** allowed in this non-commercial project, credited in `CREDITS.md`, share-alike terms noted.
- **T3, no redistribution** (Quaternius QAL, Mixamo raw files, Sketchfab Standard and similar): never in the repository, the pack or the site. They stay in the git-ignored `tmp/` on the owner's machine, as local references only.
- **Local study only** (assets extracted from games the owner owns, such as `tmp/greenhell-port/`), stricter than T3:
  - only the dev server serves them, under `/__estudo/` (`study-dev.ts`);
  - code reaches them only behind `import.meta.env.DEV` plus the study gate (`study/gate.ts`), through a dynamic import, so builds tree-shake it all;
  - no file, derived file or per-asset metadata enters the repository (`study/catalog.ts` keeps keys, names, heights and clip names only);
  - only measurements reach the real game (gait timings, sound layering, plant density), never the assets (`PARK.md` §10).
- Never download from 3dassets.dev or gobkit.com: they carry prompt-injection text aimed at AI agents.
- Raw inputs (Kenney archives, custom sources, downloads, references) never go into the repository; scripts read them through environment variables (`KENNEY_RAW_DIR`, `CUSTOM_RAW_DIR`).

## 11. Lanes and the WIP protocol

Several agents edit `game/` at once, and an auto-commit publishes the working tree to `main`, where every green push deploys. So:

- **One lane per folder.** Each agent owns its folders for the task (`PARK.md` §9 and the organization plan name them: the runtime lane in `Root.svelte`, `scene/`, `world-runtime/` and the root harnesses; the data lane in `level/`, `world-gen/`, `audio/`, `animation/`, `golden/` and `scripts/`; the engine lane in `engine/` and `mechanics/`; the coordinator in the docs, `life/`, content review and root config). A change outside your lane goes to its owner as a patch they apply after `git apply --check`.
- **Every save compiles.** The auto-commit can publish any moment of the tree. Build multi-file changes in a scratch copy of the live tree (your lane overlaid on a fresh snapshot), run the checks there, then land them atomically with one `rsync --delay-updates` after checking the live files have not changed since the snapshot. Never leave a half-applied edit on disk.
- **Before landing:** `./node_modules/.bin/biome check --write <files>` (not `pnpm format`, which does not sort imports), Prettier on `.svelte`, svelte-check with `game/tsconfig.json`, and the tests of the folders you touched.
- **No manual commits or pushes**, unless the owner asks. Signal completion with a `.done` marker in the session's scratch folder; lanes that depend on you wait for it.
- **Parallel runs use private ports** (dev servers other than 5196, `GAME_ACCEPTANCE_PORT`, `GAME_ACCEPTANCE_CDP_PORT`) so they never attach to another agent's browser.
- **Scratch** goes in `~/.cache/agents/<date>-<topic>/`; nothing the repo needs may live only there.

## 12. Docs index

| Doc                                     | What it covers                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `README.md`                             | This map                                                                                |
| `ROADMAP.md`                            | Done, in flight, next, owner decisions, known debt                                      |
| `ART.md`                                | Art direction: look, palette, scale, budgets, materials, motion, tiers, sound, licences |
| `LEVEL.md`                              | The story map, the Reserva da Iara                                                      |
| `PARK.md`                               | The park and its zones, mechanics, Guia v1, budgets, build order                        |
| `WORLD.md`                              | The endless Atlantic Forest: geography, architecture, districts, phases F0–F5           |
| `CREDITS.md`                            | Bill of materials and attributions                                                      |
| `golden/README.md`                      | Golden frames                                                                           |
| `src/guia/WIRING.md`                    | Guia integration contract                                                               |
| `docs/pack.md`                          | Pack, launcher, ABI, loading, updates, offline                                          |
| `docs/engine.md`                        | Character, camera, input, controls, park mechanics                                      |
| `docs/render.md`                        | Render pipeline, budgets, quality tiers, look                                           |
| `docs/world-gen.md`                     | Endless-world generation, park zones and stitching, streaming                           |
| `docs/animation.md`                     | Avatar and fauna animation, LOD, V8 hot-path rules                                      |
| `docs/life.md`                          | The living world                                                                        |
| `docs/audio.md`                         | Audio engine, soundscape, assets and codecs                                             |
| `docs/avatar.md`                        | Avatar regions contract, customization, the editor                                      |
| `docs/content.md`                       | Story, missions, the Guia's species and facts, sources policy, the RJ setting           |
| `docs/level-plan.*`, `docs/park-plan.*` | Generated top-down plans                                                                |
