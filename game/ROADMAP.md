# Secret Trail: roadmap

Where the game stands, what is moving, what comes next and what waits for the owner. Snapshot of 26/10/2026, about 05:00 (-03). Update it when a phase lands or a decision is made: move the item, don't append a history. How the game is built is in `README.md`; the design is in `ART.md`, `LEVEL.md`, `PARK.md` and `WORLD.md`.

**Git state.** The auto-commit last published `ed210f4` at 01:59 on 26/10. Most work from P16 on (P16, P17, P21, P23–P37) is live in the working tree but not committed: about 270 changed or new paths before this docs pass. It has not been through CI.

## 1. Done

Before P10: P1 (independent pack, launcher, render budget, graybox), P2 (engine), P3 (avatar and fauna animation), P5 (story map data, runtime, missions), P6 (audio engine, assets, wiring, one codec per device, golden-frame tooling), P7 (controls and camera v2, render v2 wave 1, survival generator), P8 (native trees and decoration, the living world), P9 (world-gen F0, muriqui row) and the F1 east portal's level part.

| Phase | What landed                                                                                                                                                   | Committed |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| P10   | Avatar animation v2: contextual locomotion (slope, narrow, water), gestures, hair sway, look target, avatar contact sheet                                     | yes       |
| P10b  | Avatar polish (pickup lunge and more) and hair contract v3: dangling hair parts as child nodes (`scripts/split-hair.mjs`)                                     | yes       |
| P11   | Loading screen: the pack split into a small loader entry (`ui/loading/entry.ts`) and the game chunk; then wired into `main.ts`, Root, the scene and `dev.ts`  | yes       |
| P12   | Roblox-style avatar editor with a live 3D preview (`ui/avatar-editor/`), wired into Root with draft/apply/cancel; sound and controls moved to `SettingsPanel` | yes       |
| P13   | Contextual avatar animation in the runtime: ground context and down-probe, look targets, gestures from story events, hair dangles                             | partly    |
| P14   | Green Hell study mode, local only: dev middleware, gate, curation, fauna, house-look stylizer                                                                 | yes       |
| P15   | Study sound and what it teaches the soundscape                                                                                                                | yes       |
| P16   | Study vegetation on the real game route (DEV only)                                                                                                            | no        |
| P17   | Render wave 2: world-scale ground and trail texture, cliff strata and moss, one river and pool surface with a wet band, trunk fade                            | no        |
| P18   | Organization audit of `game/` (dead code, structure, docs, health, the wave plan)                                                                             | report    |
| P19   | Park mechanics as pure state machines with a fixture: ladder, zipline, suspension bridge, canoe, photo camera, camera trap, boardwalks (`mechanics/`)         | yes       |
| P20   | Zone framework: `level/zones/` (spec, seams, `buildZone`) and multi-zone park stitching in `world-gen/`                                                       | yes       |
| P21   | Reserva v2: Act 1, the north and south portals, the gorge                                                                                                     | no        |
| P22   | Inventory of the assets we already hold, by zone and mechanic                                                                                                 | report    |
| P23   | Bichos da Mata: 17 new species in the Cube Pets style, homes in `life/`                                                                                       | no        |
| P24   | Guia da Mata v1: species registry, discoveries, persistence, thumbnails, panel, mechanics bridge (`guia/`, `ui/guia/`)                                        | no        |
| P25   | Vale das Cachoeiras zone content                                                                                                                              | no        |
| P26   | 23 park props built, packed and audited (`custom-*.glb`)                                                                                                      | no        |
| P27   | Guia facts checked and sourced: every `TODO-SOURCE` field in `guia/species.ts` filled                                                                         | no        |
| P28   | Avatar poses for the mechanics: `hang`, `row`, ladder `climb`                                                                                                 | no        |
| P30   | Manguezal zone content                                                                                                                                        | no        |
| P31   | Copa das Árvores zone content                                                                                                                                 | no        |
| P32   | Look pass: shared ACES grade, warm sun and blue-violet shade, ground field, ground cover, water and waterfall foam, cliff and atmosphere                      | no        |
| P33   | Praia e Costão zone content                                                                                                                                   | no        |
| P34   | Streaming core: 40 u chunks in a ring around the player, Worker builds, no leaks over a 2 km walk, 0 bytes per idle frame                                     | no        |
| P35   | Coast models (restinga plants, crabs, tide-pool fish, seabirds) and soundscape v2 with zone beds                                                              | no        |
| P37   | Per-chunk water, shore, trails and waterfalls for streamed chunks                                                                                             | no        |

## 2. In flight

- **P29: mechanics, Guia and Reserva Act 1 wiring.** Its 23 files went live after P32 (done marker), uncommitted. Root opens `GuideService` over the save and hands `GuideMechanicsBridge` to `ParkRuntime`; the HUD has the photo camera and the Guia; the zipline and the treehouse ladder run in the Reserva. Still open:
  - mission discoveries: there is no mission → species mapping yet, so missions record nothing in the Guia;
  - camera traps: `collectTrap` exists and is tested, but nothing in the game calls it (`StoryGame.onMissionComplete` is the hook);
  - the canoe, the suspension bridge and the traps have no placements until the zones load;
  - the ipê seed reuses the jequitibá seed model.
- **P36: streaming integration.** Landed in `world-runtime/streaming/` between 04:42 and 04:59 with tests: `createStreamingRuntime`, navigation, the placement route, far terrain; the engine takes a structural `CollisionQuery`. Not yet:
  - Root zone selection, `?zone=` and the streamed environment (the game still loads only `buildStoryWorld()`);
  - the ring gate before physics, readiness and relocation (load the destination's collision before "voltar para a base");
  - camera, respawn, base, compass, beacon and light;
  - validation: Worker files hashed in the pack, A/B/C with 20+20 cycles, the low tier at 4× CPU across chunk borders, the 1 km heap, the portal and Vale goldens;
  - Biome formatting of `runtime.ts` and `far-terrain.ts`.
- **Organization wave 0** (this pass is item 0.6): root `format`/`lint:fix` scripts and `game/.out` in `.gitignore` (0.1), the CI split (0.2), scratch paths repointed to env vars and repo or tmpdir defaults (0.3–0.4), the generators copied to `game/scripts/` (0.3, 0.5: done), the docs (0.6: done), the comment and doc references listed in the P38 report, and a pointer to `game/README.md` in the root `AGENTS.md`.

## 3. Next

### 3.1 Zones playable

The four zones exist as data (P25, P30, P31, P33) and stream as chunks (P34, P37), but no player can reach them yet. To get there:

1. Finish P36 (above).
2. Mount each zone's story (missions, landmarks, mechanics, with the zone offset) when its first chunk renders and unmount it when its last leaves. `StoryGame` plays only the Reserva's missions 0–8: it needs a type wide enough for `ZoneLevel`, mission ids namespaced per zone, and a wider `Portal`.
3. Prop colliders through `RingOptions.props`; a per-zone ground trail field (`uGroundPaths`); `paths.ts` must stop assuming a square world.
4. Zone sound: the P35 beds play nowhere, because nothing builds a `Soundscape` with a `zone`. `audio/surface.ts` reads heights on the Reserva's 161-point grid, wrong on Praia and Manguezal (201 points).
5. Per zone: golden poses, the e2e of its missions, acceptance, and the low-tier frame gates. Zones ship one at a time: Vale, then Manguezal, Copa and Praia (`PARK.md` §9).

### 3.2 The A07 device gate

Nothing has been measured on the Galaxy A07 yet; every gate so far is a desktop projection. One session should cover:

- 30 FPS and p95 ≤ 33.3 ms on the story route and across chunk borders, a 10–15 min thermal soak, `governor.saturated`, whether the renderer string is on the weak list, 90/120 Hz panels;
- `compileAsync` and `KHR_parallel_shader_compile` on Mali, texture upload stalls, BVH and shapecast cost, the life layer;
- MSAA and alpha-test A/Bs on the low tier (ART.md §5 says no alpha test; the tree GLBs are cut-out on every tier);
- touch feel: per-CSS-px sensitivities, the 20 px stick travel, pinch with a thumb on the stick, `pointercancel`, FOV;
- the download, the loading screen, two live contexts while the avatar editor is open, fullscreen and landscape lock in the installed PWA;
- the A57 and the `mobileMedium` decision (a 1024 shadow map with actor casters costs 8 MiB of shadow targets).

### 3.3 Guia v1 polish

- Species the world shows but the Guia lacks, so photographing them records nothing: the anta calf, the Praia homes (caranguejo-de-pedra, atobá, gaivota), the Manguezal's garça-branca, the tide-pool creatures and the restinga plants.
- Mission discoveries and camera traps (P29 above).
- Before release: coordinator sign-off on every fact, and the re-checks listed in `docs/content.md` §9 (SALVE categories, assessment dates, two sources, the veado-mateiro name).
- The colhereiro colours in `species.ts` follow P27's pick; align them with the animal palette.
- Sounds for the mechanics and the Guia (they are silent today).

### 3.4 The "pegada Pokémon" loop

The owner wants the game to feel like Pokémon: discover species, chase rare ones, explore districts. What exists:

- 23 species in `guia/species.ts`, each with `rarity` (4 comum, 8 incomum, 7 raro, 4 lendário), `zones` and `times`;
- per-device discoveries with origins (photo, mission, trap) and first-seen dates;
- a collection panel where undiscovered species are silhouettes ("A descobrir") with their rarity, and discovered ones show the player's own photo.

What is missing:

- rarity drives nothing yet: no spawn odds, no time-of-day appearances, no "rare sighting" moments;
- three rarity vocabularies with no mapping: the Guia's `comum…lendario`, the zone homes' `common…legendary` (`level/zones/content.ts`) and the legacy survival album;
- districts exist only as design (`WORLD.md` §4) and arrive with F3;
- rewards for completing a zone's page or a rarity tier;
- the decision on time of day: P36's `lightAt` adds a 24-minute day/dusk/night cycle, which would also gate dusk and night species (§4).

### 3.5 Organization waves 1–3

From the audit's plan, once the WIP above lands: delete dead code (`scene/Placeholder.svelte`, `scene/AvatarChooser.svelte`, `audio/index.ts`, `survival/index.ts`, unused exports); split `render/instancing.ts`; move the shared world shape and math from `survival/` into `src/world/`; rename `Graybox.svelte` to `GameScene.svelte` and split Root and the scene; `engine/jump.ts`; `boot/flags.ts` with per-flag gating; gate the fixtures and `?world=survival` out of the public pack; then the deduplication in Known debt (§5). Each step lands atomically and passes the checks and golden frames. P11's wiring step (1.1) is already done.

### 3.6 Later: the endless world (`WORLD.md` §7)

The park scope (`PARK.md`) replaced F1's single east strip; F0 is done and the streaming core covers F1's runtime. Then:

- **F2:** open the park's outer edges (all closed today), river pins, bridges and fords, generated trails with signs. Gate: reachability over thousands of points, no step steeper than `WALK_SLOPE` in the band.
- **F3:** districts, missions, rarity, the curated ring, saving per chunk, a journal and map. Gate: a play test with kids.
- **F4:** coast and plateau biomes with their species. Gate: the ART.md §9 audit and a biologist's review.
- **F5:** truly endless terrain with geomipmapping and morph, WFC set pieces, basin rivers. Gate: a 30-minute thermal run on the A07.

### 3.7 Later: smaller follow-ups

- **Animation:** swim states are built but never set by the engine; foot IK, an arm-override layer for held items, the `laugh` emote and dances; the coast models' glTF clips play nowhere (no `AnimationMixer`); dusk and night light for nocturnal species.
- **Fauna:** the muriqui pull-up onto a branch; companion pathfinding; the mico's bound slides its feet at 9–12 u/s; juçara crowns hide the muriquis (a palm-free band around `MURIQUI_ROW` changes `GOLDEN_WORLD`).
- **Audio:** the P15 proposals (longer beds, call layers, frogs, wind at the mirante, rates by hour and weather, dusk and night beds, a passing shower); captions, a calm mode and a quieter classroom default; ducking on `radio-call`. The audio pipeline (recipes and DSP scripts) and its raw sources live only in scratch and must move to `game/scripts/audio/` and an archive before scratch is cleaned.
- **Pack:** old complete packs are never evicted; the launcher card says "Abrindo a clareira…" until `entry.js` runs.
- **Tooling:** the world-gen browser benches, the cross-engine golden page and the overview renderers live only in scratch; WebKit has never run the goldens.

## 4. Owner decisions pending

1. **Survival mode.** `?world=survival` still mounts the legacy "5 Dias de Guardião" generator. It is ungated, no test or tool uses it, and its strings ship in the public pack; `survival/generate.ts`, `survival/save.ts` and an 11 s reachability test exist only for it, while `LEVEL.md` and `ART.md` still describe it (with night) as live. Choose: delete it, keep it as a DEV-only fixture, or revive it as a mode (then also decide the seed-of-the-day boundary, UTC day today, and its biologist review). Until then the plan gates it to DEV and software-test builds.
2. **Asset reuse — decided 26/10/2026.** The owner authorized direct reuse and adaptation by default, including Green Hell, Sons of the Forest and future collections (`ART.md` §12; current collection in `PARK.md` §10), superseding blanket reference-only, no-metadata and T1-only rules. Purging the old catalog solely to enforce that superseded rule is no longer planned; no history rewrite is requested. Follow-up: select and optimize assets, preserve provenance, and implement game-pack loading and offline validation. The current study runtime remains DEV-only until that integration is implemented.
3. **Auto-commit gating.** The auto-commit publishes the working tree to `main` every 15–30 minutes, WIP included, and every green push deploys; 7 of the last 10 CI failures were lint on unformatted WIP. It is stalled now: nothing since 01:59, about 270 paths waiting, none of them through CI. Decide whether it resumes as is, runs `biome check --write` and the checks before each commit (a hook manager such as lefthook needs your approval), pauses during moves, or gives way to branches and PRs. Fix `pnpm format` either way: it runs `biome format`, which does not sort imports, while `pnpm lint` checks them.
4. **The CI split.** CI is one sequential job of about 7 minutes (lint 2 s, check 12 s, unit 26 s, Playwright install 16 s, e2e 138 s, game pack 206 s), so the first red step hides the rest; 10 of the last 19 runs failed. The proposal: `static` (lint + check), `unit`, `e2e` and `game-pack` jobs with deploy needing all four; one retry (or a nightly job) for the story-missions e2e, which flakes under SwiftShader; 30 survival-reachability seeds by default and 300 with `FULL=1`; allocation tests in their own `perf` project.

Also open, smaller:

- **Time of day:** P36's 24-minute day/dusk/night cycle against ART.md §1 (daylight by default, night only in survival).
- **Engine feel:** `MAX_SLOPE` 50° (Roblox 89°), camera maximum distance 40 studs, FOV 70 or 55, I/O zoom rate.
- **Render:** `mobileMedium` on mid-range phones (with the A57).
- **Audio:** music; a real golden lion tamarin recording (only BY-NC exists); dropping the AAC fallback; a listening session for steps, the muriqui and the chainsaw.
- **Content:** the veado-mateiro's scientific name in RJ; the biologist review of species, behaviours and the zone mixes.
- **World (`WORLD.md` §8):** tide and fog; time-of-day events; how to tell the Tijuca history; the trail mark.

## 5. Known debt

Checked against the code on 26/10; most of it is the audit's §1 and §2.3, with what changed since.

**Dead or legacy code**

- No importers: `scene/Placeholder.svelte`, `scene/AvatarChooser.svelte` (replaced by the editor), `audio/index.ts`, `survival/index.ts`.
- Test-only: `level/index.ts` and `level/plan-svg.ts` (keep `plan-svg` as a tool); `survival/save.ts` (until the survival decision).
- Ungated in the public pack: `?debug` (kept on purpose for e2e and measurement), `?graybox` and the graybox fixture (`engine/graybox.ts`, `scene/forest-layout.ts`, `scene/forest.ts`, `scene/graybox-visual.ts`; acceptance needs it, so move and gate it, never delete it), `?world=survival`, and `scene/lineup.ts`.
- `jumpReach`, `KILL_Y` and the ramp constants live in `engine/graybox.ts` but are not fixture code: `level/` and now the zones (`vale`, `manguezal`, `kit`) import them. Move them to `engine/jump.ts`.
- `life/preview.ts` and the other dev pages have no importers by design; `life/preview.ts` still names `src/main.ts` as the build input.
- Unused exports: `animals/muriqui.amplitudeOf`, `animals/damped-spring.SpringPresetId`, `life/wind.windTime`. Test-only exports: `animation/rig.restoreRig`, `engine/constants.JUMP_AIRTIME` and others; keep them where the test is the spec.
- Scratch paths in code, docs and tool defaults: the list with suggested replacements is in the P38 report (organization wave 0).

**Structure**

- `scene/Graybox.svelte` (689 lines) is the real game scene; `Root.svelte` (820 lines) mixes world selection, HUD, panels, story glue and CSS; `scene/` mixes fixtures, UI, runtime flags, asset loading and contracts; `render/stylized.ts` imports `scene/testing.ts`.
- `survival/types.ts` is the shared world shape for every folder; `survival/noise`, `random`, `poisson`, `checksum` and `generate.ts` helpers are shared too.
- Big files with clear seams: `render/instancing.ts`, `level/build.ts`.
- `animation/avatar-context.test.ts` shares its name with `world-runtime/avatar-context.ts`.

**Duplicated concerns**

- Shader patching in three styles; `life/particles.ts` and `animation/animals/flock-mesh.ts` overwrite `onBeforeCompile` instead of chaining it. Unifying it changes program cache keys (run the golden frames).
- Three ground-height interpolators (`survival/terrain.ts` `heightAt`, `life/ground.ts`, `world-runtime/paths.ts`).
- Four closed-form springs (`animation/spring.ts`, `animals/damped-spring.ts`, `engine/camera.ts`, `ui/loading/loading.ts`).
- `TRUNK_RADIUS` in `survival/generate.ts`, `world-gen/chunk.ts`, `level/zones/kit.ts` and `manguezal.ts`; `clamp` in eight modules (keep `survival/noise`'s for determinism).
- `scene/materials.ts` against `render/materials.ts`.
- Runtime flags read in many places with inconsistent gates (`golden` and `testing` by DEV or software-test, `visualStep` by DEV only, `debug`, `pose`, `graybox`, `world` not at all; `look` with two meanings). They belong in one `boot/flags.ts`.
- The determinism scanner copied in `survival/`, `level/`, `level/zones/` and `world-gen/`; the Node GLB loader copied in the animals and life test helpers.
- `pickQuality` runs twice (`main.ts` and `Graybox.svelte`); the reduced-motion `matchMedia` is created separately in `Graybox.svelte`, `scene/controls.ts`, `missions/props.ts` and `AvatarEditor.svelte`.

**Health**

- About 760 game unit tests in 13 s locally; the slowest is `survival/reachability.test.ts` (300 seeds, 11.3 s) for a legacy mode.
- Flaky candidates: allocation assertions on V8 counters (`animation/avatar-context.test.ts`, `world-runtime/down-probe.test.ts`, `world-runtime/avatar-context.test.ts`, the instancing allocation test) and the story-missions e2e under SwiftShader.
- Markdown and Python are not linted; the flock shader compile test skips in CI (no `glslangValidator`).
- Stale docs: `golden/README.md` ("Runtime hook to add", "avatar chooser", the scratch reference path); `ART.md` §3 (only the 6 original animal heights), §5 (light values, no alpha test on low) and §11 (6 buses, real recordings, sizes, background download); `LEVEL.md` §8 (`TODO-SOURCE` keys) and §10 (6 species); `WORLD.md` §3 and §7 (Reserva-only stitching, the F1 strip); `PARK.md` §7 (`time` is `times[]`) and §8 (`?zone=` does not need `?debug`).
