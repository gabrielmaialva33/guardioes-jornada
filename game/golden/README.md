# Golden frames

The visual regression gate of ART.md §9 and a-visual.md §6: the same ten poses captured after every visual
change, compared against the last approved baseline, measured, and laid next to their references.

| File              | What it does                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `poses.json`      | The poses: id, what each one covers, how the runtime reaches it, camera/avatar targets, references                |
| `capture.ts`      | Playwright with the system Chrome: one PNG, one sky mask and one JSON of `__gameDebug` counters per pose and tier |
| `compare.ts`      | Changed pixels against the baseline (gate 0.5%), diff images, metric deltas; `--approve` promotes a set           |
| `sheet.ts`        | Per pose: `before \| after \| ref 1 \| ref 2`, plus one page per configuration                                    |
| `lib.ts`          | Shared paths, argument parsing, ImageMagick calls and the image metrics                                           |
| `avatar-sheet.ts` | Contact sheet of the avatar's contexts and gestures (P10), 4 phases each, real `avatar.glb` in Chrome; no server  |
| `loading-sheet.ts` | Loading screen (P11) at 0/40/90 % on phone portrait, landscape and desktop, error states, reduced motion, layout checks; no server |

No npm dependency beyond `@playwright/test` and `vite` (already in the repo); images go through the system `magick` (7.x).
Playwright's bundled browsers are not needed: the scripts launch `channel: 'chrome'`.

## Commands

From the repo root, with `pnpm game:dev` running on 5196 (or pass `--serve <port>` to start a private server).

```sh
node game/golden/capture.ts --set after                 # every capturable pose, tiers low and high, real GPU
node game/golden/compare.ts --set after                 # vs baseline; exit 1 when a pose changed > 0.5%
node game/golden/sheet.ts --after after                 # before | after | references
node game/golden/compare.ts --approve after             # after becomes the baseline (old one goes to history/)
node game/golden/avatar-sheet.ts                        # sheets/avatar/avatar-p10.png (needs no dev server)
node game/golden/loading-sheet.ts                       # sheets/loading/*.png + checks.json (needs no dev server)
```

Useful options:

- `capture.ts --tiers low,medium,high --poses P1,P4` narrows the run;
- `--mode swiftshader --serve 5197` uses software rendering (the private server sets `GAME_ALLOW_SOFTWARE_TEST=1`; the
  game refuses software GPUs otherwise);
- `--clock real` uses the wall clock (2.5 s settle, real fps/p95, not deterministic);
- `--angle gl` picks the ANGLE backend in gpu mode;
- `compare.ts --threshold 0.5 --fuzz 2% --baseline <set>`.

A full run of the five capturable poses on two tiers takes about 16 s. Sheets take about 12 s.

## Where things go

Nothing is written into the repo: the references are copyrighted and frames are large. The root is
`~/.cache/guardioes-golden/` (`GUARDIOES_GOLDEN_DIR` overrides it; its `.keep` stops the scratch GC):

```
<set>/<tier>-<mode>/<pose>.png        frame, 960×432
<set>/<tier>-<mode>/<pose>.mask.png   same frame over a magenta page: magenta = nothing drawn
<set>/<tier>-<mode>/<pose>.json       __gameDebug counters, metrics, tier picked, errors
<set>/<tier>-<mode>/run.json          browser version, captured and skipped poses
baseline/                             last approved set (+ approved.json); history/ keeps older ones
diffs/<set>/<config>/<pose>.png       ImageMagick diff images
reports/<set>-vs-<baseline>.{md,json}
sheets/<set>/<pose>-<config>.png, all-<config>.png
```

References are read from `~/.cache/agents/2026-10-25-trilha-secreta/pesquisa-qualidade/referencias/`.

## What is measured

- **Changed %**: pixels where any RGB channel moved by more than the fuzz (2% of 255), over 960×432. Counted in Node:
  `magick compare -metric AE` still draws the diff image and its figure goes into the JSON as `magickAE`, but
  ImageMagick 7.1.2 under-counts on RGB frames (a 61×41 red patch, 2501 px, reads as 1321.7), so it does not gate.
- **Dark %**: HSL lightness < 12% (ART.md: nothing darker than `#1e4d36`, except the night sky).
- **Saturation**: mean HSL saturation of the frame and of each third (top, middle, bottom).
- **Sky % and sky σ**: the share of the frame the canvas left transparent (the CSS sky) and the luma standard deviation
  there; a flat sky has σ ≈ 0.
- **Void↓ %**: share of the lower half with nothing drawn: holes, or the world's edge. The gate of P4.
- **Counters**: draw calls, triangles, programs, geometries, textures, DPR, picked tier. Under the fake clock `fps` and
  `frameP95Ms` are not real; use `--clock real` or `game/map-measure.ts` for frame time.

## Determinism today, without touching the runtime

- **Clock**: Playwright's fake clock (`page.clock`) owns `Date`, `performance.now`, timers and rAF. It is paused before
  the page loads, stepped in 16 ms frames until `__gameDebug().ready`, then advanced exactly `settleMs` (2.5 s).
- **Randomness**: `Math.random` is a seeded mulberry32 (`seed` in poses.json) installed before any script.
- **Tier**: the game's own `pickQuality`, steered by device emulation (no override exists yet):

  | Tier   | Emulation                                        | Expected pick        |
  | ------ | ------------------------------------------------ | -------------------- |
  | low    | mobile + touch, `deviceMemory` 4, 4 cores        | `low` (`low-memory`) |
  | medium | desktop, `deviceMemory` 4, 8 cores               | `medium`             |
  | high   | desktop, `deviceMemory` 8, 16 cores, desktop GPU | `high`               |

  The JSON records `tierPicked`/`tierReason`; capture warns when the pick differs from the request.
- **HUD**: an injected style hides every child of `[data-game-root]` except `.world`, so the CSS sky stays.

Two captures in a row compare at 0.000% on all ten frames, even with `--fuzz 0`. Baselines are per renderer: the same
pose on SwiftShader differs from the RTX 4090 by 0.02–0.11% at fuzz 2% (7–9% at fuzz 0), so compare a set only
against a baseline taken in the same `<tier>-<mode>`.

## Poses

| Id  | Pose                            | Status        | How                                                    |
| --- | ------------------------------- | ------------- | ------------------------------------------------------ |
| P1  | Início da trilha                | exists        | `?debug&pose=spawn`                                    |
| P2  | Clareira com forração           | needs-runtime | free camera at the mission 4 clearing                  |
| P3  | Travessia do rio, do alto       | approx        | `pose=bridge` until a camera can frame it from 12 u up |
| P4  | Borda do mapa olhando para fora | exists        | `pose=edge`                                            |
| P5  | Sob o dossel olhando para cima  | needs-runtime | free camera pitched ~60° up                            |
| P6  | Avatar de perto, fundo verde    | needs-runtime | free camera + avatar placement, fov 50                 |
| P7  | Margem de perto                 | approx        | `pose=stones` until a camera can sit on the waterline  |
| P8  | Obby na floresta                | needs-runtime | avatar behind the take-off pad, camera on the ledges   |
| P9  | Início da trilha à noite        | needs-runtime | P1 with a night light rig                              |
| P10 | Lineup                          | needs-runtime | a WebGL lineup page                                    |
| X1  | Topo do mirante (extra)         | exists        | `pose=mirante`                                         |

`needs-runtime` poses still get a sheet row (placeholder tiles next to their references) so their targets stay
visible. When the runtime gains the hook below, flip their status in poses.json and give capture.ts the URL.

## Runtime hook to add: `?golden=1`

Owned by the runtime (Root.svelte / scene / world-runtime), not by this folder. With `golden` in the query string,
alongside the existing `debug` and `pose`:

1. **Fixed clock**: the game loop uses a fixed step (1/60 s) from t = 0 and freezes at `t=<seconds>` (default 10) so
   wind, water, particles and animation are in the same phase in every capture. Then capture.ts no longer needs the
   fake clock and fps/p95 become real again.
2. **Fixed seed**: every random source (scatter, particles, idle animation offsets) seeded from `seed=<n>`.
3. **No adaptation**: DPR governor off, no tier downgrade, DPR fixed at 1.
4. **Forced tier**: `tier=low|medium|high` overrides `pickQuality` (keep the emulation as the default).
5. **Clean frame**: HUD, story panel, dialogue, avatar chooser, rotate prompt and debug output hidden; no intro or
   camera transition.
6. **Free camera**: `cam=x,y,z,tx,ty,tz[,fov]` places the camera directly (position, look-at, vertical fov), bypassing
   the chase camera and its pitch limit. `avatar=x,z,yaw` places the avatar (y from the ground). poses.json already has
   both for every pose.
7. **Time of day**: `time=day|night` (P9).
8. **Lineup**: `scene=lineup`: the assets in a row next to the avatar and a scale bar, standard light (P10).
9. **Ready signal**: `__gameDebug().goldenReady === true` once assets, shaders and shadows are in place and the frozen
   frame has been drawn; `preserveDrawingBuffer: true` only in this mode, so the canvas can be read directly.
10. **P6 metric**: optionally expose the avatar's screen-space outline (or a mask render) so the ring ΔE against the
    background can be measured.

Example once it exists:
`http://localhost:5196/?debug&golden=1&tier=high&t=10&cam=100,7.5,108,112,3.3,118,70&avatar=104,111,0.876`.

## Runtime hook (wave 1)

The hook above is now implemented in dev and acceptance builds. Public production builds ignore `golden`.
`capture.ts` defaults to `--clock runtime`: all eleven poses (including the extra mirante) use free camera,
night and lineup, wait for `goldenReady`, and capture frozen visual time with real rAF measurements. It passes
`tier`, `seed`, `t`, `cam`, `avatar`, `time` and `scene` to the runtime. `--clock fake|real` keeps the original
five-pose path for historical comparisons. Never compare a free-camera river frame to its old chase-camera
approximation as a visual regression.

For technique comparisons on identical assets, dev golden URLs also accept `look=0|1|2|3|4`: original Lambert,
stylized light/normals, continuous terrain/shore, canopy shade/sun spots, then sky/height fog/horizon. Public packs
always enable the full look. For example:

```sh
node game/golden/capture.ts --set wave1-light --url 'http://localhost:5196/?look=1'
node game/golden/sheet.ts --before wave1-before --after wave1-light
```

The mask hook hides only the rendered sky/serra/sea, preserving opaque world geometry. A sky-heavy upward pose
naturally has a high `Void↓ %`; P4 is the meaningful world-edge gate. Baselines need owner review; do not run
`--approve` automatically after a deliberate art change.

Captures isolate the page from Vite's HMR WebSocket. `--assets <directory>` serves a frozen local snapshot of
binary assets instead of files another agent may be exporting. Every frame records that snapshot's SHA-256
`assetHash`; technique comparisons must use the same one. The default snapshot is the live assets directory,
read once when the command starts. `--append --poses P6,P9` replaces selected frames without deleting the other
poses in the set. This also allows correcting a framing fixture and regenerating its comparisons.
