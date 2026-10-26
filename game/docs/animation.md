# Secret Trail: animation

Every character in the game, the avatar, Iara and 23 animal species, is animated procedurally on rigid node rigs, in pure TypeScript under `src/animation/`. There are no glTF clips, no mixer and no skinning by deformation. Poses are data, cycles advance by the distance actually covered, and timings copy Roblox's default `Animate` script. This file is the distilled record of phases P3 (avatar and fauna), P10/P10b (contextual avatar layers, hair), P23 (17 new species) and P28 (traversal poses). Code wins over this file; numbers below were checked against it on 26/10/2026.

## 1. Decisions

- **Procedural on rigid nodes, not clips.** The Kenney Blocky avatar and the Cube Pets animals are rigid pieces under named nodes, like Roblox's R6/R15. Rotating ~7 nodes from code costs no asset bytes and no extra JS; a clip pipeline would add about 35 KB gz of three code (mixer, GLTF animation, SkeletonUtils) plus the clips. CPU is not the bottleneck below ~10 animated characters; draw calls are.
- **The "Roblox feel" is timing, not mocap.** Speed-proportional cadence, 0.2 s locomotion fades, a jump held 0.31 s with no anticipation, no landing clip. The numbers live in `src/animation/animate-timings.ts` (`ANIMATE`, R15 Animate from client v0.744).
- **Cycle phase comes from distance after collision**, never from stick input: pushing against a wall never moves the legs (Rosen's "surveyor wheel").
- **Animals are procedural because suitable clips do not exist.** No CC0 pack has a brachiating monkey, a hanging sloth or a perching toucan; the ones that come close forbid redistribution. Mixamo cannot go in a public repo. Nothing trained on AMASS/HumanML3D.
- **Truthful biology over spectacle.** Each species' states are constrained by sources cited in the code: the mico never hangs by its tail, the bugio never brachiates, the onça has no stalk, chase or attack state. Tests pin these.
- **Scale by height, never by length** (ART.md §3). Cube Pets are cube-shaped: sized by length the onça stood 3.26 u, taller than the 3.0 u avatar.
- **Exception, P35 coast models.** `atoba.glb`, `gaivotao.glb`, `sargentinho.glb` and the green turtles carry glTF node-rotation clips (`perch`, `glide`, `swim`). No runtime plays them yet (there is no `AnimationMixer` in `src/`), and they are not in `SPECIES`.

## 2. Files

| Path                                                        | Holds                                                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `animation/skeleton.ts`                                     | Generic `Layout` (`defineLayout`), `Pose` (a `Float64Array`, `JOINT_STRIDE` numbers per joint), `compileKey`, `mirrorKey`                                                                  |
| `animation/track.ts`                                        | `Track`: key poses sampled into a blend target (Catmull-Rom loops, eased one-shots); `Playhead` carries time and weight                                                                    |
| `animation/spring.ts`                                       | Critically damped `Spring` (exact for any dt, `kick`, field-driven `update()`)                                                                                                             |
| `animation/joints.ts`                                       | `AVATAR_JOINTS`, `AVATAR_LAYOUT`, `RigConfig`, `BLOCKY_RIG`, and the rotation sign conventions the keys rely on                                                                            |
| `animation/animate-timings.ts`                              | `ANIMATE`: every Roblox number used                                                                                                                                                        |
| `animation/avatar-poses.ts`                                 | Key poses and clips: idle variants, walk, run, jump, fall, climb, ladder climb, swim, sit, hang, row, emotes and gestures                                                                  |
| `animation/avatar-states.ts`                                | `AvatarStateMachine`: slots, crossfade weights, walk/run shares, emote rules; knows nothing about poses                                                                                    |
| `animation/avatar-animator.ts`                              | `AvatarAnimator`, `AvatarInput`, `readCharacter`; tuning tables `LAYERS`, `CONTEXT`, `GESTURE`                                                                                             |
| `animation/look-target.ts`                                  | `pickLookTarget`, `LOOK_PICK`                                                                                                                                                              |
| `animation/hair-sway.ts`                                    | `HairSway`, `HAIR_SWAY`, `HAIR_DANGLES`                                                                                                                                                    |
| `animation/rig.ts`                                          | The only avatar file importing three: `bindRig`, `applyToRig`, `restoreRig`                                                                                                                |
| `animation/animals/`                                        | Fauna: `species.ts`, `measures.ts`, `rigs.ts`, `postures.ts`, `animal-animator.ts`, one behaviour per family, `lod.ts`, flocks; `bind.ts` and `flock-mesh.ts` are the only three importers |
| `avatar/hair.ts`                                            | `HairAccessories`: the hair mesh on the head node and its dangling parts                                                                                                                   |
| `mechanics/avatar.ts`                                       | `readTraversal`: ladder, zipline and canoe state into `AvatarInput`                                                                                                                        |
| `life/iara.ts`                                              | `IaraLife`: Iara's idle variations, turn-to-face and talk beats, added onto an `AvatarAnimator` base pose                                                                                  |
| `scene/avatar-wiring.ts`, `world-runtime/avatar-context.ts` | Runtime feeds: story gestures, look candidates, surface, slope and edge probes                                                                                                             |

## 3. Avatar rig and pose format

- **Rig.** `avatar.glb` is Kenney Blocky Characters 2.0 `character-a` without its clips. Native height 2.7 (`BLOCKY_RIG.height`), feet at 0, facing +z, left side +x; the scene scales it to the 3.0 u `AVATAR_HEIGHT`. Hierarchy: `root` holds `leg-left`, `leg-right`, `torso`; `torso` holds `arm-left`, `arm-right`, `head`. Pivots: hips y 1, waist y 0.7, shoulders 1.1 above the waist, neck 1.2.
- **Signs** (`joints.ts`): x < 0 swings a limb forward, y > 0 turns left, z > 0 raises the left arm; the right side mirrors.
- **Pose.** Per joint, a YXZ Euler rotation (radians) and an offset as a fraction of the rig height, both relative to the node's rest transform, plus the root's `scaleY`/`scaleXZ` squash. `applyToRig` writes `quaternion = rest × euler`, `position = rest + offset × height`, `root.scale = rest × (xz, y, xz)`. Bones are `Object3D`s, so a rigid SkinnedMesh with the same names would work unchanged.
- **Binding.** `bindRig(model, layout, config)` also tries GLTFLoader-sanitized names; missing joints are skipped and listed in `rig.missing`; a missing root falls back to the model.

## 4. Avatar per frame

The scene (`scene/Graybox.svelte`, `animateAvatar`) runs, in this order, inside the frame task with nothing reactive involved:

1. `readCharacter(input, controller.character, dt)`, then `jumped`, `yaw`, `intent` (stick magnitude), `reducedMotion`, `talking` (Iara's dialogue open).
2. `environment.avatarGround.update(input, character)` fills `surface`, `slope` and `edgeAhead` (`world-runtime/avatar-context.ts`).
3. `readTraversal(input, park.traversal)` when the park is loaded.
4. `AvatarWiring.update(input, dt)`: queued story gestures and `pickLookTarget`.
5. `applyToRig(animator.update(dt, input), rig)`, then each visible hair dangle gets `rotation.set(hair.pitch, 0, hair.roll, 'YXZ')`.

Input contract (`AvatarInput`): `speed` is horizontal u/s after collision; `intent` (0..1) only cancels emotes; `verticalSpeed` also detects jumps from the upward impulse (coyote jumps); `airTime` drives ledge falls after `fallDelay` (default the 0.08 s `COYOTE_TIME`, an engine choice: Roblox enters freefall at once). `dt ≤ 0` or NaN counts as 0 and anything over 0.25 s (`MAX_DT`) is clamped; non-finite inputs count as 0. Call `animator.reset()` on respawn or teleport.

## 5. Avatar states

Slots, in order (`SLOTS`): `idle, walk, jump, fall, climb, swim, sit, emote, hang, row`. `hang` and `row` (P28) were appended so earlier indices did not move. On every change each slot moves linearly to its target over the new fade, so the weights always sum to 1.

| Transition   | Fade         | Rule                                                                                                                                                                                   |
| ------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| → idle       | 0.2 s        | Grounded, speed ≤ 0.75 studs/s                                                                                                                                                         |
| → walk/run   | 0.2 s        | Walk alone to 6.4 studs/s, linear crossfade to 12.8, run alone above; playback 1.25× at the default 16 studs/s. The walk/run shares freeze while stopping, so a run fades out as a run |
| → jump       | 0.1 s        | Pose held 0.31 s from the jump, even past the apex                                                                                                                                     |
| jump → fall  | 0.2 s        | Starts exactly 0.31 s after the jump; the leftover of the update counts, so timing is frame-rate independent (tested at 30, 60, 144 Hz)                                                |
| ledge → fall | 0.2 s        | Once `airTime ≥ fallDelay`                                                                                                                                                             |
| landing      | 0.2 s        | Straight to walk/run or idle; the squash spring is the landing                                                                                                                         |
| → climb      | 0.1 s        | Plays at speed / 5 by vertical distance; backwards going down                                                                                                                          |
| → swim       | 0.4 s        | Stroke vs tread water with 1.025 / 0.975 studs/s hysteresis; stroke at speed / 10                                                                                                      |
| → sit        | 0.5 s        |                                                                                                                                                                                        |
| → emote      | 0.1 s        | Only from idle, grounded and still; a request is dropped if the character moved first                                                                                                  |
| emote → idle | 0.15 s       | Non-looping emotes, timed exactly                                                                                                                                                      |
| emote cancel | 0.2 / 0.15 s | Movement, leaving the ground, sitting, climbing, swimming, or stick intent > 0.05 (beyond Roblox, which only cancels on movement; pass `intent = 0` for strict Roblox)                 |

Attachments (`hang`, `row`) take priority over fall and emotes and get no jump squash, run lean or balance sway. Idle has two variants weighted 9 : 1, re-rolled at each loop end over 0.15 s from a seeded mulberry32, so fidgets replay per seed.

## 6. Avatar poses and gestures

| Clip               | Driven by                                      | Notes                                                                                                                                                                   |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Walk               | distance, stride 4.27 studs (6.4 × period 2/3) | reach + passing, mirrored                                                                                                                                               |
| Run                | distance, stride 6.4 studs                     | torso leans 10°; 2.5 cycles/s at 16 studs/s                                                                                                                             |
| Jump / fall        | time                                           | arms at 160° (R6 "arms up"); fall flails over 0.7 s                                                                                                                     |
| Climb              | vertical distance, 5 studs per cycle           | generic hand-over-hand                                                                                                                                                  |
| Ladder climb (P28) | ladder distance                                | two rungs per cycle; one hand holds a rung's world height while the other reaches; `LadderSpec.rungSpacing` (0.45 u) and `rungOffset` (0.3 u) feed both mesh and pose   |
| Swim / swim idle   | distance, 12 studs per cycle / time            | body pitched 72° about its middle                                                                                                                                       |
| Sit                | —                                              | Kenney's own sit                                                                                                                                                        |
| Hang (P28)         | `ziplineSpeed`                                 | arms up on `HANG_GRIP`, shared with the zipline bar mesh; swing from the speed lag, capped at 0.12 rad; both palms stay on the bar (sheet check < 0.02 u)               |
| Row (P28)          | `canoeStroke` (rad), `canoeSpeed`              | built on `SIT`, mirrored by `paddleSide`; current alone never rows; canoe and avatar share a ≤ 0.035 u bob                                                              |
| Emotes             | time                                           | `EMOTE_IDS`: `wave`, `cheer`, `point`, plus the story gestures `pickup`, `talk`, `binoculars`, `pet`. Mission complete is `cheer`; `talk` loops while `talking` is true |
- **Gestures** (`animator.playGesture(id, point)`, P10/P10b): `pickup` is an R6 lunge (legs split ±38°, bow capped at `GESTURE.pickupBow` 40°, side lean up to 18°, a step toward the item up to 0.45 rig u), hand within 0.25 u of the item in tests; `pet` kneels and strokes for 2.3 s; `binoculars` scans for 3.6 s; `talk` beats every 1.2 s, alternating hands. Gestures return false while moving.
- **Look-at** (`pickLookTarget`, `LOOK_PICK`): Iara > animals > collectibles inside a 60° cone, ranges 10 / 14 / 6 u; the current target is kept to 1.3× range and +25° cone, and only a higher kind steals it. It returns one of the caller's candidate objects and allocates nothing.

## 7. Procedural layers

| Layer (`LAYERS`, `CONTEXT`)  | Full motion                                                                                                                                    | Reduced motion             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Lean                         | 3° at walk speed plus up to 10° from acceleration, capped at 14°; uphill lean (`slopeLean` 0.5) replaces it when larger, downhill bracing adds | 0                          |
| Bank                         | −yaw rate × speed × 0.004, capped at 8°                                                                                                        | 0                          |
| Squash                       | +10% take-off stretch, up to −14% landing squash (volume kept), torso dip and arm flare                                                        | 0, scale exactly 1         |
| Look-at                      | head ±60° yaw, ±30° pitch, 20% of the yaw to the torso; targets beyond the limit + 30° released                                                | halved                     |
| Breathing                    | 1.5° torso, 1.2° arms, 0.4% lift every 3.4 s, idle or seated                                                                                   | 0                          |
| Narrow footing               | arms out, stride × 0.7, a still wobble                                                                                                         | posture halved, wobble off |
| Wading (`surface = 'water'`) | slower cycle, high knees, trunk capped at 10° (`waterMaxLean`)                                                                                 | posture halved             |
| Teeter                       | `edgeAhead < 0.4` u and nearly still: windmill and lean back                                                                                   | posture halved, swing off  |

The style limits come from `src/style/motion.ts` (`SPRING`, `LIMITS`: squash ≤ 15%, anticipation ≤ 80 ms; `REDUCED_MOTION_DURATION` 0.12 s). Gestures still play under reduced motion.

## 8. Hair contract v3 (dangling parts)

The avatar-regions contract (skin regions, hair styles, colours) is in `docs/avatar.md`; this is the motion side.

- `avatar-hair.glb` has six top-level style nodes (`cap`, `hair-afro`, `hair-braids`, `hair-bun`, `hair-long`, `hair-ponytail`) sharing the head's origin. Version 3 adds child nodes with their origin at the pivot: `hair-ponytail-tail` `[0, 0.63, -0.5]`, `hair-braids-left`/`-right` `[±0.32, 0.78, -0.22]`, `hair-bun-knot` `[0, 0.9, -0.24]` (head-node units). The single source is `HAIR_DANGLES` in `hair-sway.ts`.
- `HairSway` is a pendulum per style driven by the head's acceleration; output `pitch` (> 0 swings the end back) and `roll` (> 0 to the left). Tuning `HAIR_SWAY`: `rabo` 1.8 Hz ζ 0.3 (±40°/±30°), `trancas` 2.2 Hz ζ 0.35, `coque` 4.5 Hz ζ 0.45 (±8°); `curto`, `longo`, `black-power` and `bone` have none. Reduced motion outputs 0.
- **Regenerate:** `node game/scripts/split-hair.mjs` cuts the packed GLB in place (bit-identical for unsplit styles, deterministic, idempotent; `--check` verifies). `scripts/blender/models/avatar_hair.py` runs it after gltfpack. The committed GLB predates that script's current shapes, so a Blender rebuild would change every style. `avatar/hair.test.ts` checks names, pivots against `HAIR_DANGLES` and ≤ 80 triangles per style including children.

## 9. Fauna

**Rigs** (`rigs.ts`): two 8-slot layouts, quadruped and bird (slots 0–3 shared: root, body, head, tail; birds have wings in 4–5 and legs in 6–7). 19 base models (`MODEL_IDS`): the Cube Pets `monkey`, `tiger`, `koala`, `parrot` and the P23 models. Every pet has a `head` node under `body` (neck pivot `(0, 0.625, 0.3125)`); the koala has no tail. `MODELS` holds native measures (height, silhouette `top`, `eyeY`, `bodyLength`, hips, tail pivot); the parrot's crest is removed in the asset pipeline, so its `top` is the head (1.431).

**Size, scale, tempo** (`species.ts`, `measures.ts`): `scale = size / MODELS[model].top`; `length = scale × bodyLength`; spring tempo = √(L_mico / L) with the mico (0.75 u body) as 1, so larger animals swing slower; the sloth keeps an extra ×0.4. The six P3 species are hand-tuned. The 17 P23 species are derived from `MEASURES` (real height, gait kinds, Froude numbers): game height = metres × 1.5 / 0.47, speed √(F g h), stride 2.3 h F^0.3, with h the drawn hip and g = 9.81 / 0.47 u/s² [Alexander & Jayes 1983]. Measured `speed`/`stride` overrides win. Retune P23 species only in `measures.ts`.

| Species                                                                                                                                            | Model                         | Height u   | Behaviour                      | Notes                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| mico-leão-dourado                                                                                                                                  | monkey                        | 0.90       | `MicoBehaviour`                | DS walk into a half-bound; companion keeps 3 studs, hops on player jumps, teleports beyond 30 u; never hangs                                           |
| muriqui                                                                                                                                            | monkey (arms ×2.4, legs ×1.4) | 1.70       | `MuriquiBehaviour`             | Brachiation pendulum, tail-hang feeding                                                                                                                |
| bugio-ruivo                                                                                                                                        | monkey                        | 1.40       | `BugioBehaviour`               | Slow walk, long rests, howl (`motion.howl` envelope), feed-hang only from feeding                                                                      |
| onça-pintada                                                                                                                                       | tiger                         | 2.20       | `OncaBehaviour`                | Calm states only; walks away within 9 u after 0.8 s, never toward the player                                                                           |
| preguiça-de-coleira                                                                                                                                | koala (front ×1.8, hind ×1.4) | 1.40       | `PreguicaBehaviour`            | Hangs under the branch, one limb at a time over 2.4–3.6 s                                                                                              |
| tucano-de-bico-verde                                                                                                                               | parrot                        | 0.90       | `TucanoBehaviour`              | Perch, hop, 6–10 beats at 6 Hz then a glide                                                                                                            |
| capivara, anta, anta-filhote, cateto, veado-mateiro, cachorro-do-mato, tapiti, caranguejo-uçá, tatu-galinha, jabuti-tinga, sapo-cururu, colhereiro | own models                    | 0.26–2.87  | `GroundBehaviour` (`GROUND`)   | idle, graze, move, rest, sit, alert, flee, hide, arrive; herds; swimming at the waterline; per-species reaction radii; activity by `AnimalWorld.light` |
| onça-parda, jaguatirica                                                                                                                            | own models                    | 2.07, 1.44 | `OncaBehaviour` (`FELIDS`)     | The onça's calm walk-away                                                                                                                              |
| saíra-sete-cores, sabiá-laranjeira, jacutinga                                                                                                      | `passaro`, `jacutinga`        | 0.29–1.21  | `TucanoBehaviour` (`PERCHERS`) | Adds `peck`, `sing` (song envelope in `motion.howl`), ground perches, shy flight                                                                       |

`SPECIES_ALIASES` maps the old `guara` id to `colhereiro`. The coast species of P35 are not in this table (§1).

**Muriqui handholds** (`MURIQUI_HOLDS`, scale-free in arm lengths; arm = 0.768 u): space them 1.0–1.25 u apart, never more than 1.33 u; 1.6 u is the mechanical limit. The pendulum runs in fixed 1/240 s steps with a 1.6 s period, about 0.83–0.85 s per hold. Past the limit the swing target is capped (`swingCap` 90°) and after `giveUp` (4) apexes the muriqui turns back. Level data reads the row from `level.handholds`.

**Animator** (`animal-animator.ts`): posture crossfade, gait by footfall timing (Hildebrand style: primates diagonal-sequence LH-RF-RH-LF, other mammals lateral LH-LF-RH-RF), key blend, layers (gait bob, wingbeat, feeding, howl, crouch), springs (look, tail, lean, bank, squash), root offset. Postures carry a pivot and an anchor so crossfades rotate about the support point instead of sliding. Look splits `bodyLook` to the body and the rest to the head node.

**Per-frame contract.** `animal.frame(dt, world, cameraDistance, visible)` returns true only when the animal updated; call `placeAnimal(animal, group, rig)` only then. `frame()` latches player jumps over skipped frames. Clone the GLB per animal (the rig binds node objects). Limb stretch is node `scale.y`, set once by `bindAnimal`. In the game, `life/` draws the animals as up to 4 skinned pools with one palette atlas (see `docs/life.md`); the life tiers cap animated-at-once animals at 10 / 14 / 20 (low / medium / high).

## 10. LOD contract (`animals/lod.ts`)

| Condition                 | Update                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| Within 12 u of the camera | every frame                                                        |
| Up to the 60 u cull       | every 3rd frame (`farInterval`), with the skipped time accumulated |
| Offscreen or beyond 60 u  | frozen; time is dropped, it resumes where it stopped               |
- The companion sets `keepAlive`: never frozen, far rate when offscreen. `slot` staggers far animals across frames; herd members share their leader's slot.
- **The rate never changes the result.** Behaviours substep at event times (≤ 1/30 s, `MAX_SUBSTEP`) and draw decisions only there, from an RNG stream separate from cosmetic draws; speed ramps and gait cycles are integrated exactly (Simpson over distance); the pendulum runs in fixed steps; springs are exact; a posture fade starts at the moment of the change inside a long step. `lod.test.ts` asserts the same state, joints within 1.5° (head 2.6°) and placement within 0.04 u after 9 s at every frame versus every 3rd frame, for all 23 species.
- For any future skinned character: set a generous bounding sphere once (centre at mid height, radius about 0.75 × height). three computes `SkinnedMesh.boundingSphere` once from the pose of that instant and never updates it.

## 11. Flocks

Butterflies and small birds (`flock.ts`, `wing-flap.ts`, `flock-mesh.ts`): CPU boids in `Float64Array`s (O(n²), n ≤ ~64, 1/60 s substeps, clamped to their box) and one `InstancedMesh` per flock with the wingbeat in a vertex-shader string patch (`patchWingFlap`, per-instance `aFlapPhase`, `customProgramCacheKey` set; throws if three renames a chunk). One draw call per flock, `castShadow` off, bounding sphere set once from the box. Butterflies beat at 8 Hz, small birds flap-bound at 12 Hz. `wing-flap.test.ts` also compiles the expanded program with `glslangValidator` as GLSL ES 3.00 when the binary exists (skipped in CI).

## 12. V8 hot-path rules

Measured in P3 and P10 with a fixed 256 MB nursery; they apply to every per-frame path in the game. Steady-state frames allocate 0 B in every avatar state (`avatar-context.test.ts` asserts < 4 B per update).

1. A fractional number passed to a function V8 does not inline is boxed (16 B per argument per call). Pass values through fields (`spring.target = x; spring.update()`), reuse a `Playhead`, read `dt` from fields.
2. Initialize number class fields with a number (`time = 0`). A declared-only field starts `undefined` under ES2022 semantics and every double stored into it allocates.
3. A float returned from a non-inlined helper is boxed: write `clamp`, `damp`, `wrapAngle` out on the per-frame path.
4. `Math.hypot` is not inlined and returns a boxed number: use `Math.sqrt(x*x + y*y)`.
5. A ternary between an imported binding and an imported object's property boxes every time: copy constants into instance fields.
6. Keep simulation state in `Float64Array`s, not `Float32Array`s; convert once on output.
7. Base-class methods shared by many subclasses see a megamorphic `this` and box every number through it: keep their numbers in one small single-class helper (`this.clock.h`).
8. Code that runs about once a second stays interpreted and boxes every intermediate: precompute, or move the math into a function that runs every step.
9. Benchmark from a function: a module-level loop gets OSR-compiled with everything inlined and boxes 10–50× more than the real frame callback.
10. Nothing reactive per frame: no `$state` in the frame task; mutate objects directly.

Costs (desktop, i9-13900K): avatar update + apply about 0.65 µs, about 2 µs with every P10 input and hair under a 4× CPU throttle; an animal `frame()` about 0.5 µs, about 0.9 µs with `placeAnimal`; a 32-agent flock about 5 µs. Residuals in mixed scenes: bugio walk about 5 B per frame, mico follow 0.3–23 B per frame depending on JIT history, cosmetic glance events about 50 B each.

## 13. Verify and regenerate

- **Tests:** `./node_modules/.bin/vitest run --config game/vite.config.ts src/animation src/avatar src/mechanics` (16 test files under `animation/`). They cover fades at 0 / 6.4 / 9.6 / 12.8 / 16 studs/s, the jump hold at 30 / 60 / 144 Hz, phase by distance, emote rules, reduced motion zeroing every layer, NaN/∞ inputs, footfall orders, the mico never hanging, the onça never approaching, follow without jitter, LOD equivalence, boids in bounds, the traversal poses, and the real GLB node trees.
- **Rig measures:** `node game/scripts/measure-glb.mjs [repo-root]` (env `MODELS=monkey,tiger,...`, default the four Cube Pets) prints feet, head top, body length and per-node boxes with three's `GLTFLoader` and `MeshoptDecoder` in Node (textures stripped). `rigs.ts` `MODELS` copies them by hand; `rig.test.ts` "MODELS holds the measures of the meshes" re-measures all 19 models within 1e-3, so a reshaped model fails until `MODELS` follows.
- **Avatar contact sheet:** `node game/golden/avatar-sheet.ts --out avatar-<tag>.png [--reduced]` renders one row per state or gesture, 4 phases each, with the real `avatar.glb` in system Chrome; output under `GUARDIOES_GOLDEN_DIR` (default `~/.cache/guardioes-golden`) in `sheets/avatar/`.
- **Animal lineup and gait strips:** with `pnpm game:dev`, open `/src/life/lineup.html` (`?part=small` for small species, `?strip=<species>` for a walk/run strip). Orthographic camera, game light and bake; nothing there ships.
- **Traversal preview:** `/src/mechanics/preview.html` (`?manual&shot=ladder|zipline|canoe`, `&reduced`).
- **Models:** `blender -b --factory-startup -P game/scripts/blender/models/bichos_mata.py [-- <model> ...]` rebuilds the P23 animals and palettes from raw Kenney GLBs (gltfpack `-cc -kn -vtf -vpf`); then run `node game/scripts/blender/audit.mjs` (≤ 1,000 triangles per animal, palette lightness).

## 14. Known limits

- The engine never sets `swimming`; `climbing` and `sitting` come only from the ladder and the canoe (`readTraversal`). Wading below the knee is the `water` surface layer.
- Not built: foot IK on slopes, an arm-override layer for held items, `laugh` and dance emotes.
- The muriqui cannot pull up onto a branch; its `rest` is a still hang.
- The mico companion has no obstacle avoidance or pathfinding; it walks straight to its slot.
- Stubby legs: the mico's bound caps legs at 50°, so feet slide at 9–12 u/s; limb stretch also stretches the palette texture.
- Several values are estimates without a species source (toucan wingbeat and flight speed, the 1.6 s muriqui period, sloth steps, small-bird wingbeats, non-cursorial P23 strides marked in `measures.ts`).
- The onça's tail runs the appendage preset slowed by its tempo, below ART.md §7's 3–6 Hz family (documented in `species.ts`).
- Small species are truthful at ×1.5 (crab and toad 0.26 u, saíra 0.29 u) and hard to see beyond a few metres.
