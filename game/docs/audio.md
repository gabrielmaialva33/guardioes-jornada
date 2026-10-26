# Secret Trail: audio

The game's sound is one small engine on native WebAudio (`src/audio/`), with no audio library. Every sound id has a T1 recording (CC0 or CC BY) and a procedural placeholder that plays until the recording is decoded, or forever if it fails. A per-game `Soundscape` wires the engine to the controller, the animator, the story and the map.

History: the audio research (pesquisa C, 25/10/2026) chose the sources, codecs and budget; P6 built the engine, the first recordings, the wiring and the one-codec-per-device pack; P15 measured the Green Hell study mix (local only) and restaged our gains from it; P35 added the park zones' beds (soundscape v2). ART.md §11 holds the art rules; `CREDITS.md` § Áudio holds every attribution and the bill of materials.

## 1. Files

| Path                                  | Role                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/audio/bank.ts`                   | Sound ids, buses, categories, surfaces, the `SOUNDS` table (bus, category, files, gain, jitter, priority, loop points, spatial), `codecOrder`, `variantUrls` |
| `src/audio/engine.ts`                 | `createGameAudio(options)`: the `GameAudio` contract (graph, lifecycle, voices, loading, listener, footsteps, ducking, extra buffers)                        |
| `src/audio/synth.ts`                  | Procedural placeholders (`renderPlaceholder`, `SYNTH_RATE` 22,050 Hz, `SYNTH_VARIANTS`, `SYNTH_LOOPS`, `SYNTH_TRIM_DB`)                                      |
| `src/audio/soundscape.ts`             | `Soundscape`: one per mounted game, owns its `GameAudio`; player, mission, ambience, animal and zone sounds; `nearestRiverPoint`                             |
| `src/audio/story-cues.ts`             | Mission sounds from two snapshots of the story's counters                                                                                                    |
| `src/audio/surface.ts`                | The ground under the feet, for footsteps                                                                                                                     |
| `src/audio/zone-sounds.ts`            | The beds of each park zone (P35)                                                                                                                             |
| `src/audio/SoundSettings.svelte`      | The **Som** panel (pt-BR UI)                                                                                                                                 |
| `src/audio/index.ts`                  | A re-export barrel; nothing imports it today (callers import `bank.ts` and `engine.ts`), see §13                                                             |
| `src/audio/fake-audio.test-helper.ts` | A minimal fake AudioContext, nodes, params and page, for the tests only                                                                                      |
| `src/assets/audio/`                   | The recordings: `<id>-<n>.webm` (Opus) and `<id>-<n>.m4a` (AAC) per variant                                                                                  |
| `src/study/audio.ts`                  | DEV-only Green Hell study sound (§11)                                                                                                                        |
| `protocol.ts`                         | `AudioCodec`, `AUDIO_CODEC_TYPES`, `audioCodecOrder`, `chooseAudioCodec`, `requiredFiles` (shared by the launcher and the game)                              |

## 2. Graph, buses and mix

- **Graph:** voice source → voice gain → [equal-power `PannerNode`] → bus duck gain → bus volume gain → parent bus → … → master duck → master volume → limiter → destination.
- **Buses** (`BUSES`, `BUS_PARENT`): `master`; `music`, `ambience`, `sfx`, `ui` under master; `animals` under `ambience`. The "Natureza" slider moves ambience and animals together, and ducking ambience ducks the animals too. The music bus exists but no music ships (owner decision).
- **Volume:** a bus gain is slider² × (muted ? 0 : 1), ramped with τ 15 ms. `DEFAULT_SETTINGS`: master 1, music 0.7, ambience 0.8, animals 1, sfx 0.9, ui 0.8. `mute(muted)` without a bus mutes master.
- **Limiter:** `DynamicsCompressorNode` at −6 dB threshold, 6 dB knee, 12:1, attack 3 ms, release 250 ms, so 16 summed voices do not clip on phone speakers.
- **Ducking:** `duck({ amount = 0.35, buses = ['music', 'ambience'], attack = 0.15, release = 0.6 })` returns an idempotent release; overlapping ducks take the deepest. The Soundscape ducks while any story dialogue is open.
- **Staging (P15):** beds sit near −31 LUFS after their bank gain (`forest-day` 0.36, `river` 0.4) and animal calls 7–10 dB over them. Before P15 the bed was 8 dB louder and the calls blurred into it. Textures (the zone beds) sit at bed level.

## 3. The bank

`SoundDef` fields: `bus`, `category`, `files` (recorded variants, each a URL per codec), `gain` (the mix, not a level fix: the files are already normalised), `pitchJitter` (± semitones), `gainJitter` (± dB), `priority` (voice stealing), `loop: { start, end }` (seconds), `spatial: { ref, rolloff, max }` (inverse distance; one-shots beyond `max` never start).

- **Categories:** `essential` (preloaded behind the loading screen), `nature` (decoded after the first frame), `music` (empty).
- **Priorities:** animals 2 (howler 3), steps 4, jump/land/splash 5, `ui-tap` 6, `collect` and `radio-call` 7, `checkpoint`/`mission-complete`/`badge` 8, beds and the chainsaw 9.
- **Files:** `recordedFiles(id, count)` reads the variants that exist from `import.meta.glob('../assets/audio/*.{webm,m4a}')`; a missing file just drops out, and an id without files plays its placeholder.

| Ids                                                                                              | Bus, category    |    Variants | Spatial (ref / rolloff / max)   | Notes                                                   |
| ------------------------------------------------------------------------------------------------ | ---------------- | ----------: | ------------------------------- | ------------------------------------------------------- |
| `step-soil`, `-grass`, `-leaves`, `-rock`, `-wood`, `-water`                                     | sfx, essential   | 4 (grass 3) | 2 / 1.5 / 25                    | Gains 0.55–1 even the surfaces out; ±1.5 st, ±2.5 dB    |
| `jump`, `land`, `splash`                                                                         | sfx, essential   |     3, 4, 3 | splash 3 / 1.2 / 40             |                                                         |
| `collect`, `checkpoint`, `mission-complete`, `badge`                                             | sfx, essential   |  2, 1, 1, 1 | –                               | The collect combo pitch is the caller's `rate`          |
| `ui-tap`, `radio-call`                                                                           | ui, essential    |        1, 1 | –                               |                                                         |
| `forest-day`                                                                                     | ambience, nature |           1 | –                               | 24 s loop                                               |
| `river`                                                                                          | ambience, nature |           1 | 3 / 1.2 / 35                    | 4.85 s loop; the emitter follows the nearest bank point |
| `waterfall`                                                                                      | ambience, nature |           1 | 6 / 1.2 / 70                    | 15 s loop, at the `waterfall` landmark                  |
| `chainsaw`                                                                                       | sfx, nature      |           1 | 20 / 1 / 200                    | 9 s loop, mission 2's illegal cutting                   |
| `howler`                                                                                         | animals, nature  |           2 | 15 / 1 / 250                    | The landmark call                                       |
| `muriqui`, `toucan`, `tamarin`                                                                   | animals, nature  |      2 each | 4 / 1.5 / 70 (`ANIMAL_SPATIAL`) | ±0.7 st keeps the species recognisable                  |
| `waterfall-far`, `canopy-birds`, `surf-rocks`, `surf-beach`, `mangrove-water`, `mangrove-clicks` | ambience, nature |      1 each | per bed (`bed()` in `bank.ts`)  | P35 zone beds                                           |

The tamarin recording is the black lion tamarin (same genus): no clean T1 recording of the golden lion tamarin exists.

## 4. Engine behaviour (`engine.ts`)

- **Lifecycle:** the context is created at once, suspended. The first `pointerdown`/`touchend`/`keydown`/`mousedown` calls `unlock()`, which resumes and starts a one-sample silent buffer synchronously inside the gesture (iOS). The gesture listeners stay, so a context the OS interrupted (an iOS call) comes back on the next tap. Hidden page or `pagehide` suspends; visible or `pageshow` resumes. `dispose()` aborts listeners and loads, stops and disconnects every voice and closes the context; it is idempotent.
- **One-shots are dropped** unless the page is unlocked, visible and the context is `running`; a suspended context would otherwise queue them and play a burst on resume. Loops may start any time and are heard once the context runs.
- **Voices:** at most `MAX_VOICES` = 16, loops included. When full, a new sound steals a voice already fading out first, then the lowest priority (oldest first), only if that priority is not above its own; otherwise the new sound is dropped. Stolen voices fade over 20 ms.
- **Spatial:** only ids with `spatial` and a given position. `panningModel 'equalpower'` (a test asserts no HRTF panner exists: HRTF convolves per source and is wasted on phones), `distanceModel 'inverse'`. `setListener(camera)` reads `matrixWorld.elements` (position column 3, forward −column 2, up column 1) and allocates nothing.
- **Footsteps:** `footstep(surface, { foot, intensity, x?, y?, z? })` plays `STEP_SOUND[surface]` at gain 0.55 + 0.45 × intensity (clamped 0–1.5); the right foot plays at rate 0.97. The player's own steps closer than 70 ms merge (a guard at the gait phase wrap); positioned (animal) steps do not.
- **Loading:** `preload(category, signal)` first renders the category's placeholders (the loading screen pays the render), then fetches and decodes each variant in codec order; a failed codec tries the next, and when all fail `onLoadError(id, error)` fires and the placeholder stays. Aborted loads resume on the next call.
- **Extra sounds (P15):** `decode(url)`, `playBuffer(buffer, sound, at)` and `loopBuffer(...)` play buffers outside the bank on the same buses, voice pool and culling, with voice id `'extra'` and no placeholder. Only the study uses them today.
- **Placeholders (`synth.ts`):** rendered in plain JS (oscillators, RBJ biquads, filtered noise), mono at 22,050 Hz, deterministic per (id, variant) through a seeded mulberry32. Loops cross-fade their tail into their head. Peaks are normalised to 0.8, then `SYNTH_TRIM_DB` cuts each one to within about 1.5 dB of its recording, so a failed load does not jump out of the mix (they were up to 13.5 dB louder before P6's trim). Adding an id to `SOUNDS` makes the compiler ask for its recipe and trim (`Record<SoundId, …>`).

## 5. The Soundscape (`soundscape.ts`)

Wiring today: `Root.svelte` creates it with `createGameAudio({ settings: gameSave.audio(), onSettingsChange })`, unlocks at once when the "Entrar na trilha" tap is still a live `navigator.userActivation`, calls `syncStory()` on every story refresh and `uiTap()` from a delegated click listener (every button but jump and the contextual action), and disposes it on destroy. `scene/Graybox.svelte` runs `preloadEssential(signal)` inside the loading `Promise.all`, `startNature(signal)` after `ready`, and `update(delta, camera, frame, animator.footstep, runWeight)` once per frame after the animator; `__gameDebug().audio` reports state, voices and timing.

- **Player:** footsteps on the animator's foot contacts with intensity 0.85 + 0.45 × runWeight; `jump`; `land` when the landing speed is at least 0.25 × `JUMP_SPEED`, with gain min(1.3, 0.35 + 0.65 × impact) plus a step on the surface (a water landing is a water step only); `checkpoint`; `splash` only for a `fell` event over the river or the pool.
- **Missions (`story-cues.ts`):** `StoryGame` stays pure and bumps a revision; the cues come from diffing counters. Fruit, trash, gold leaf or seedlings taken → `collect`, one semitone up per pick-up within 2 s, up to +7; planting → `land` at rate 0.85, gain 0.8; a flagged trap → `collect` at rate 0.75; the `logger`/`logger-reply` radio dialogues or a report → `radio-call`; a mission done → `mission-complete` alone; the last one → `badge` alone instead. A restart (counters going down) is silent.
- **Ambience:** beds start only once `nature` is decoded, because `loop()` picks its buffer once and an early loop would keep its placeholder. Forest bed (fade-in 3 s), the river emitter moved each frame to the nearest centre-line point (water level interpolated), the waterfall at its landmark, and the chainsaw at the `cutting` landmark (+1.5 u) while mission 2 is not done (it stops with a 2 s fade and returns after a restart).
- **Animals:** `CALLS` per home in `world.animals`: bugio → `howler` every 40–90 s within 250 u (the whole map), muriqui 25–60 s within 60 u, tucano 20–60 s within 40 u, mico → `tamarin` 15–40 s within 25 u; each call comes from ±3 u around the home at canopy height, and the first within 12 s. The living world also fires `onHowl` (`life/fauna.ts` `HowlEvent`, a seeded 45–100 s chorus clock), which the scene plays as `howler` at the bugios.
- **Zones (`zone-sounds.ts`, P35):** `SoundscapeMap` is either the Reserva `{ world, level }` or a park zone `{ world, level: ZoneLevel, zone }` in the zone's local frame. Reserva: the default. Vale: the default plus `waterfall-far` at the waterfall landmark. Copa: no river; `canopy-birds` at gain 0.35 near the ground rising to 1 from 6 u above 3 u (the walkway), ramped only when it moves by more than 0.02. Praia: forest bed at 0.5, no river, `surf-rocks` and `surf-beach` each following the nearest point of its stretch of waterline (costão = ground more than 1.7 u over the water within 4 cells). Manguezal: no forest bed, no river, `mangrove-water` everywhere and `mangrove-clicks` at the nearest crab bank. A test caps every zone at 6 loops. The colhereiros' dusk has no sound: no usable CC0/CC BY recording of _Platalea ajaja_ was found.
- **Cost:** `update` allocates nothing on quiet frames. Measured in P6: 0.05–0.06 ms mean per frame in headless Chrome at the low tier, 57–71 ns in a Node microbenchmark with 0 GC events in 2 M quiet frames; 16 looping voices rendered offline cost about 0.75 % of one core. Not measured on an A07 or A57 yet.

## 6. Surfaces (`surface.ts`)

Checked on foot contacts only, in this order: shallow water (`riverSurfaceAt` and feet below the surface + 5 cm) → `water`; feet more than 0.3 u over the terrain on an obby piece (stone or a rock ledge → `rock`, root or log → `wood`), a crossing or base cell (→ `wood`), or anything else above the water (→ `rock`); a trail or base → `soil`; the forest flag → `leaves`; restinga, beach, mangrove or riverbank → `soil`; otherwise `grass`. Without a map (the graybox fixture) the floor is grass and the platforms wood.

## 7. Files, codecs and the pack

- **Naming:** mono `<id>-<n>.webm` (Opus) plus `<id>-<n>.m4a` (AAC-LC) per variant, both from the same cut. Today: 29 ids, 58 variants, 116 files.
- **One codec per device (P6):** `pack-build.ts` tags `.webm`/`.m4a` files with `codec` in the manifest; untagged files are always required. The launcher (`src/lib/data/game-pack.ts`) and the bank ask the same browser `audioCodecOrder` (every `probably` before any `maybe`, Opus before AAC), so the device downloads and plays only `chooseAudioCodec`'s choice; `null` downloads no audio and keeps the placeholders. A pack marker without `audioCodec` (an old pack) still needs every file.
- **Fallback kept on purpose:** if the chosen file fails to decode, the engine still tries the other codec. Offline that fails fast and the placeholder plays; it rescues a browser that gains Opus after the download.
- **Budget** (`CREDITS.md` BOM): essential 40 variants, 89,578 B Opus / 172,314 B AAC; nature 18 variants, 539,769 B / 849,885 B; total 629,347 B (614.6 KiB) Opus and 1,022,199 B (998.2 KiB) AAC. The research budget was about 145 KB essential and 550 KB nature. Audio is already compressed: the pack generates no `.gz`/`.br` for it.
- **Seamless loops:** Chrome decodes Opus in WebM 24 samples short (the encoder pre-skip); M4A decodes exact. Each loop file therefore carries 2,400 samples (50 ms at 48 kHz) of its own head after the end, and `loop.end` in the bank is the real loop length, not the file length. Never set `loop.end` from the file's duration.

## 8. Loudness and the asset pipeline

- **Targets (per mix group):** effects about −16 LUFS (max short-term, 3 s window), UI and animals −20, beds −24 integrated; true peak under −1 dBTP after decoding. Each sound takes the group target or the lowest value all its variants reach, so variants stay level; a lookahead limiter may take at most 6 dB, to a −1.5 dBTP ceiling before encoding. Short transients (grass, wood, splash, collect, ui-tap) stay under target rather than be squashed, and the bank gains even out the rest.
- **Encoding:** 48 kHz mono; Opus `libopus -vbr on -application audio`, bitexact, no metadata (effects, UI and animals 32 kbps, beds 40–48 kbps, the P35 zone beds lower to stay in budget); AAC 48–64 kbps with `+faststart`.
- **Processing:** cut, mono, optional high-pass (and low-pass for distant beds), raised-cosine fades, loudness by a numpy BS.1770-4 implementation (validated against ffmpeg `ebur128`), true peak by 4× oversampled FFT, loops folded tail onto head with an equal-power crossfade (forest 1.5 s, waterfall and chainsaw 1 s, river 0.5 s).
- **Where it lives:** the Python pipeline (wave 1 recipes, the P35 zone-bed recipes, the DSP helpers, run through `uv run --no-project --with numpy --with scipy`) and the original downloads are **not in the repo yet**; only the encoded files are. Until it is moved under `game/scripts/`, re-encoding a sound means re-cutting it from the source and span listed in `CREDITS.md` with the settings above.
- **Adding a sound:** select a recording under `ART.md` §12 and record its source and known terms; cut and encode both codecs; drop the files into `src/assets/audio/`; add the id to `SOUNDS` (and a recipe, `SYNTH_VARIANTS` entry and trim in `synth.ts`); add the attribution row and update the BOM in `CREDITS.md`. `bank.test.ts` fails on a variant without both codecs, on an unused file in the folder, and on loop points on a non-loop.

## 9. Sources and licences

Audio follows the general reuse policy in `ART.md` §12. CC0/CC BY sources are useful defaults, not the only eligible sources. Extracted recordings and other collections can be selected and adapted without a separate project-policy exception.

- Keep per-file provenance, known terms, modifications and credits in `CREDITS.md`; preserve existing verified attributions.
- Record attribution, non-commercial, share-alike, no-derivatives and redistribution conditions where applicable. Unknown terms stay unknown; project authorization does not change a source's licence.
- Evaluate the actual recording and its terms instead of applying the former blanket source blacklist or T1-only rule. Keep bulk downloads outside the tracked asset set by default; selected pipeline inputs may be retained for reproducibility.
- The security exclusion for 3dassets.dev and gobkit.com in `ART.md` §12 still applies.

## 10. Settings and save

The top bar has a **Som** button (mutes master, `aria-pressed`, "Ligar o som" / "Desligar o som"). The **Som** panel (`SoundSettings.svelte`, rendered in the customization screen next to the control settings) has a toggle and four 0–100 sliders in steps of 5: **Volume geral** (master), **Música**, **Natureza** (ambience, animals included) and **Efeitos** (sfx). Changes apply at once and save to `gameSave.audio` (`data/local-save.ts`, `AUDIO_BUSES`) 400 ms after the last change and on exit; the decoder keeps only known buses, clamps volumes to 0–1 and accepts booleans only.

## 11. Study mode audio (DEV only, P15)

The owner has authorized direct reuse of selected recordings (`PARK.md` §10). This section describes the current DEV implementation and its isolation checks; it does not prohibit integrating those recordings into the game audio pipeline. Production pack loading remains to be implemented.

`src/study/audio.ts` plays the local Green Hell extraction's ambience and animal calls over or instead of our mix, to compare by ear. It is reached only through `if (import.meta.env.DEV) void import('../study/audio.ts')` in `Soundscape.startNature`, then `studyEnabled()` (`study/gate.ts`): on by default on the dev server, off with `?estudo=off` and in automated runs (`?golden`, `?e2e`, software-test builds, WebDriver, Vitest), forced with `?estudo=greenhell`. URL: `&hora=dia|entardecer|noite` (no dusk material exists, so dusk blends day and night), `&tempo=chuva|chuva-forte`, `&som=ambos` (theirs over ours) or `&som=nosso` (ours only); by default theirs plays and our forest bed, river and waterfall stop to free voices. Files come at runtime from the dev middleware's catalog; the module holds curation only (group ids, clip-name variants, intervals, ranges, gains), never a path. At most 4 study one-shots at once, inside the shared 16 voices.

Leak check after any change near it (must print 0 three times):

```sh
pnpm exec vite build --config game/vite.config.ts --mode production --outDir "$OUT" --emptyOutDir
grep -rli 'greenhell\|__estudo' "$OUT" | wc -l
fd -i 'study|estudo|greenhell' "$OUT" | wc -l
grep -rlio 'estudo\|studyaudio\|studyEnabled' "$OUT" | wc -l
```

## 12. Verification

- **Unit tests:** `./node_modules/.bin/vitest run --config game/vite.config.ts game/src/audio` (bank, synth, engine, soundscape, story-cues, surface, zone-sounds) and `game/src/study` for the study runtime. `bank.ts` uses `import.meta.glob`, so it only loads under Vite or Vitest, never in plain Node.
- **Engine tests cover:** the lifecycle (locked until a gesture, re-unlock after an interruption, suspend on hidden or pagehide), dispose leaving nothing live, the voice cap and stealing, exact jitter bounds, equal-power panning and culling, footstep merge, loop points, bus volume² and ducking, codec fallback and placeholders on failure.
- **Pack acceptance** (`pnpm test:game-pack`) checks that a Chrome device's pack holds only `.webm`, that no `.m4a` is ever requested, and that the launcher's announced size matches the chosen codec.
- **By ear:** the soil steps' level and spread, the muriqui (its source has clipped samples), the chainsaw's distance and the relative step levels still need the owner's listening session on a phone.

## 13. Gotchas

- A bed started before `nature` is decoded keeps its placeholder forever (`loop()` picks the buffer once).
- `surface.ts` takes the terrain height from `survival/terrain.ts` `heightAt`, which assumes the Reserva's 161-point grid; the Praia and Manguezal worlds use a 201-point grid, so steps there may sample the wrong height. `zone-sounds.ts` `groundAt` reads the world's own grid and is the model for a fix.
- P15 fixed a browser-started context (autoplay allowed): the first gesture now unlocks when `!#unlocked || state !== 'running'`, otherwise every one-shot was dropped for the session.
- `index.ts` repeats this wiring as a comment and has no importers; delete it or make it the only import path (organization audit, wave 1).
- The `Category` comment in `bank.ts` still quotes the wave-1 sizes (about 90 KB essential, 380 KB nature); `CREDITS.md` has the current BOM.

## 14. Open items

- **Zone beds are not wired:** `Root.svelte` passes the Reserva's `mapData` with no `zone`, so the P35 beds play nowhere in the running game yet. Park streaming (P36) must pass `{ world, level, zone }` per zone, in its local frame.
- **Mechanics are silent:** the P29 mechanics (zipline, climbing, photo) and the Guia play no sounds.
- **P15 soundscape proposals not done:** longer beds (≥ 60 s, or two co-prime mono loops), a 30 s river, a sprinkle layer of short calls at bed level (≤ 4, priority 1), a water-proximity frog layer, height wind at the mirante, per-species call rates by hour and weather with a group alarm, night and dusk beds once the game has a time of day, and a passing shower.
- **Research items not done:** sound captions with a direction arrow (radio, chainsaw, howler), a calm mode and a quieter classroom default, an automatic duck on `radio-call`, essential sprites (36+ small requests today), and swim and climb sounds.
- **Owner decisions:** music (none, CC BY bossa, or our own render), a real golden lion tamarin recording (only BY-NC exists), the colhereiro's dusk, dropping the AAC fallback once the oldest target iPhone decodes Opus in WebM, and moving the audio pipeline and raw sources out of scratch.
