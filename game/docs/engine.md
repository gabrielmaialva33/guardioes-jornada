# Secret Trail: engine (character, camera, input, park mechanics)

The engine is what a child feels: a capsule that moves like a Roblox Humanoid, an orbit camera that behaves like Roblox's Classic and Follow cameras, and touch and desktop input with the Roblox layout. It lives in `src/engine/`, which is plain TypeScript with no Svelte, no Threlte and no DOM in its core. The park traversal mechanics (ladder, zipline, canoe, suspension bridge, boardwalk lookouts, photo camera, camera trap) live in `src/mechanics/` and plug into the engine through one optional driver.

History: P2 built the engine (character, camera, input, checkpoints), P7 reworked the controls and the camera for touch, P19 built the park mechanics as pure state machines with a dev preview, and P29 wired them into the Reserva's Act 1. Code wins over this file; the constants carry their own source tags.

## 1. Files

| File                           | What it owns                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/constants.ts`      | The single scale source: `STUD`, speeds, gravity, jump, capsule, step, slope, timestep, every camera value, sensitivities and the touch layout. Each value is tagged [PM] Roblox PlayerModule v0.744, [SP] StarterPlayer/Workspace defaults, [plano], [POC] or [engine]. |
| `src/engine/world.ts`          | `CollisionQuery` (structural: `shapecast`, `raycast`, optional `dispose`) and `CollisionWorld`, one static BVH (`three-mesh-bvh` 0.9.16) built from `ColliderSource`s or `CollisionWorld.fromObject(root)`.                                                              |
| `src/engine/compound-world.ts` | `CompoundWorld`: a static BVH plus caller-owned child queries (moving decks, gates).                                                                                                                                                                                     |
| `src/engine/character.ts`      | `Character` (kinematic capsule), `placeObject`, `cameraRelativeMove`, `CHARACTER_DEFAULTS`, `Character.constrain` for traversal drivers.                                                                                                                                 |
| `src/engine/timestep.ts`       | `FixedTimestep(hz = 60, maxSteps = 4)`: `advance`, `alpha`, `reset`, `dropped`.                                                                                                                                                                                          |
| `src/engine/camera.ts`         | `OrbitCamera` (`mode: 'classic' \| 'follow'`), `stepZoom`, `springStep`, `touchPitchScale`, `applyCameraPose`, `DEFAULT_LENS`.                                                                                                                                           |
| `src/engine/input.ts`          | `InputModel` (pure state), `attachInput(element, model, options) → detach`, `touchLayout`, `thumbstickVector`, `wheelNotches`.                                                                                                                                           |
| `src/engine/checkpoints.ts`    | `CheckpointTracker`: AABB checkpoint triggers, the kill plane and the respawn delay.                                                                                                                                                                                     |
| `src/engine/traversal.ts`      | `TraversalDriver`, the optional fixed-step hook the mechanics implement.                                                                                                                                                                                                 |
| `src/engine/controller.ts`     | `PlayerController`: one player's frame in a fixed order (section 3).                                                                                                                                                                                                     |
| `src/engine/graybox.ts`        | The graybox test level (`createGraybox`, `proxyGeometry`, `buildCollisionWorld`) plus `jumpReach`, `KILL_Y` and the ramp constants that `level/` also uses.                                                                                                              |
| `src/mechanics/*`              | The park mechanics, their meshes, `ParkTraversal`, `ParkRuntime`, park props and the Guia bridge (sections 9–10).                                                                                                                                                        |

`world.ts`, `character.ts` and `camera.ts` are adapted from `@pmndrs/viverse` 0.2.29 (MIT, Copyright 2024 Bela Bohlender); the notice stays in each header.

## 2. Scale and the Roblox constants

The avatar is 3 u tall and Roblox's classic avatar is 5 studs, so `STUD = 0.6` u. Every Roblox default is written in studs and converted.

| Value                           | Here                                                                                  | Roblox source                                       |
| ------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Walk speed                      | 9.6 u/s                                                                               | WalkSpeed 16 studs/s                                |
| Gravity                         | 117.72 u/s²                                                                           | Workspace.Gravity 196.2 studs/s²                    |
| Jump height / impulse / airtime | 4.32 u / ≈ 31.89 u/s / ≈ 0.542 s                                                      | JumpHeight 7.2 studs                                |
| Coyote time / jump buffer       | 0.08 s (consumed by the jump) / 0.1 s                                                 | plano v2 (viverse used 0.2 s, not consumable)       |
| Capsule                         | radius 0.5 u, height 3 u                                                              | POC radius                                          |
| Step height / max slope         | 0.4 u / 50°                                                                           | engine choice; Roblox allows 89°                    |
| Terminal fall speed             | 100 u/s                                                                               | engine (bounds collision substeps)                  |
| Facing turn rate                | `damp(20, dt)`                                                                        | AutoRotate ≈ damp(18..22)                           |
| Respawn delay                   | 0.25 s                                                                                | plano (0.2–0.3 s)                                   |
| Physics                         | 60 Hz, at most 4 ticks per frame                                                      | engine                                              |
| Camera pivot                    | 4.5 studs = 2.7 u above the feet                                                      | R6 root + HEAD_OFFSET                               |
| Zoom                            | default 12.5 studs (7.5 u), min 0.5 studs, max **40 studs (24 u)**                    | ZOOM_DEFAULT; Studio's max is 128 studs             |
| First person                    | goal < 1 stud, held at 0.5 stud                                                       | FIRST_PERSON_DISTANCE_THRESHOLD                     |
| Avatar fade                     | from 1.25 studs to 0.5 studs, ≤ 2.8 per second                                        | TransparencyController (2026 formula)               |
| Shift-lock offset               | 1.75 studs = 1.05 u                                                                   | CAMERA_OFFSET_DEFAULT                               |
| Pitch                           | −80° to +80°, start −15°                                                              | MIN_Y, MAX_Y, INITIAL_CAMERA_ANGLE                  |
| FOV                             | 70° (POC used 55°; decided on the device)                                             | Camera.FieldOfView                                  |
| Mouse look                      | (1, 0.77) × 0.5° per CSS px                                                           | ROTATION_SPEED_MOUSE                                |
| Touch look                      | (1, 0.66) × 1° per CSS px, pitch slowed to 25 % at the poles                          | ROTATION_SPEED_TOUCH, adjustTouchPitchSensitivity   |
| Zoom input                      | pinch 0.04 per px of diameter; wheel 1 per notch (100 px of deltaY); I/O 6 per second | ZOOM_SPEED_TOUCH, ZOOM_SPEED_MOUSE, ZOOM_SPEED_KEYS |

The camera's maximum distance was 128 studs in P2; it is 40 studs now, because the far view drew most of the forest and broke the 200-draw budget on the entry phones. The header comment of `src/engine/camera.ts` still says 128 studs; the constant wins.

## 3. Frame order and the fixed clock

`PlayerController.update(frameSeconds, input, lens)` runs once per rendered frame, in this order:

1. The traversal driver captures this frame's input (`capture`), so an action or jump pressed on a frame without a tick is not lost.
2. Input turns the camera: shift-lock flag, mouse and touch look, zoom. A jump press goes to the character's buffer.
3. The move is made camera-relative; in shift-lock and first person the body faces the camera yaw.
4. `FixedTimestep.advance` runs 0–4 ticks at 60 Hz. Each tick asks the driver first (`traversal.step` returns true when it moved the character itself), otherwise `Character.step`; then the checkpoint tracker. A `respawn` event teleports at once with the camera behind.
5. The pose is interpolated by `alpha`; the camera follows it with no positional lag (Roblox Classic), lifted by `traversal.cameraLift` and snapped behind `traversal.cameraBehind` when a driver asks.

The scene then copies `frame.position` and `frame.yaw` to the avatar with `placeObject` (it handles a parented, rotated or scaled avatar) and `frame.pose` to the three camera with `applyCameraPose` (the camera must sit directly in the scene). `PlayerFrame` also carries `grounded`, `speed` (actual planar speed, for the walk/run blend), `jumped`, `landed`, `landingSpeed` and the checkpoint `events` of the frame, oldest first.

Rules:

- **One clock.** Only `FixedTimestep` advances time. Character substeps are spatial (≤ r/2 each, ≤ 8 per move), never a catch-up loop. Never add a second accumulator, in the engine or in a mechanic.
- **Resume.** After a hidden page or a modal, call `controller.resume()`: the next frame replays 0 ticks (4 at most without it). `attachInput` already releases input on `hidden` and `blur`.
- **Determinism.** The same input path gives bit-identical positions at 30, 60, 90, 120 and 144 Hz frame rates and with 200 ms hitches (`controller.test.ts`).

## 4. Character physics

- **Grounded versus canJump.** `grounded` is contact now; `canJump` is grounded or unspent coyote time. One impulse per contact: a held jump re-jumps only after a new landing (Roblox bunny hop).
- **Windows in ticks at 60 Hz.** A coyote jump is accepted in airborne ticks 1–4; the buffer accepts a press up to 5 ticks before the landing tick (6 ticks is the excluded boundary).
- **Integration.** Exact constant-gravity integration (`y += v·dt − ½g·dt²`), no damping, instant acceleration and stop, full air control.
- **Contacts.** Walkable contacts resolve vertically and steep ones horizontally, with exact separation, so a resolved pose resolves to itself: no drift standing 10 s on flat ground, a 30° ramp, a log or a ledge edge. Velocity into each contact normal is removed, so a ceiling cancels the rise and steep slopes slide.
- **Ground snap and steps.** Probe down by the step height; a step-up attempt raises, moves and lowers, accepted only if the rise is ≤ 0.4 u and it went further.

Defects found in the upstream code and fixed here (keep these when touching `character.ts`):

1. **Coplanar seams shoved the capsule sideways.** Per-triangle pushes in BVH order read a ramp's diagonal edge as a wall. Fix: resolve the deepest contact first and re-query.
2. **Edge contacts were classified by penetration depth.** Fix: judge an edge or vertex by the normal where the capsule first touched it along the substep motion; faces keep their face normal.
3. **The step rise was measured at the feet.** A box's rounded top edge let a 0.45 u box pass a 0.4 u check. Fix: measure between support points.
4. **`ExtendedTriangle.closestPointToSegment` misses a segment that pierces a triangle.** Substeps of ≤ r/2 from a resolved pose make piercing impossible; a fallback through the face normal remains.

Known limitations:

- Wedged between two steep slopes the character stays airborne and cannot jump (Roblox behaves alike). Avoid V-shaped steep proxies in levels.
- Collider vertices are float32: keep collision geometry within a few hundred units of the origin.
- Static BVH only: no dynamic bodies. Moving decks go through `CompoundWorld` children (section 8).

## 5. Measured jump and reach

| Tick rate | Apex                                     | Airtime                   | Target           |
| --------- | ---------------------------------------- | ------------------------- | ---------------- |
| 60 Hz     | 4.3189 u (exact apex 4.32 between ticks) | lands in tick 33 (0.55 s) | 4.32 u, 0.5418 s |
| 120 Hz    | 4.3190 u                                 | 0.5417 s                  |                  |
| 240 Hz    | 4.3200 u                                 | 0.5417 s                  |                  |
- Jump reach at walk speed: 5.20 u to the same height, 4.88 u to a platform 1 u higher. `jumpReach(rise)` in `src/engine/graybox.ts` computes it; level obbies size their gaps from it (graybox gaps are 50 %, 65 % and 80 % of reach: 2.60 / 3.17 / 3.90 u).
- The kill plane of the graybox is `KILL_Y = −20`.
- Cost on a desktop: about 3 µs per tick (character plus 5 camera rays) on the 248-triangle graybox. This is not a phone number.

## 6. Camera

- **Classic and Follow.** Desktop uses Classic; touch uses Follow, which keeps the previous world camera and auto-corrects behind the body only after 2 s without a pan (`TIME_BEFORE_AUTO_ROTATE` in the Roblox PlayerModule). `Root.svelte` picks the mode from `matchMedia('(pointer: coarse)')`; `__gameDebug().cameraMode` reports it.
- **Zoom.** Hyperbolic `stepZoom` with curvature 0.5 (each in-step exactly undoes the out-step), followed by a critically damped 4.5 Hz spring.
- **Collision (popper).** Five rays, from the near-plane centre and its four corners. A hit caps the spring at once (snaps in) and the camera springs back out once clear; the distance is clamped ≥ 0. Zoom goals at or below 1 stud skip collision.
- **Shift-lock and first person.** Both return `bodyYaw` so the body faces the camera. The shoulder offset is shortened by a ray when a wall is at the right shoulder (1.05 u down to 0.4 u in the test).
- **Canopies.** Canopies are not colliders, so the camera ignores them. Instead `src/render/canopy-visibility.ts` tests upper-crown ellipsoids (and a trunk cylinder) against the head-to-camera segment and fades the selected crowns in 150 ms, at once with reduced motion; a crown the camera wants to enter also limits the popper distance. The fade is an opaque dither in `src/render/stylized.ts`, with no transparent pass and no extra draw. Gotcha: three defines `USE_INSTANCING` only in the vertex shader, so a fragment-side guard on it silently disabled the fade; `golden/dither-acceptance.ts` proves the fade in real WebGL. Golden frames keep trees opaque.

## 7. Input and touch controls

- **Roles per pointer.** Every pointer keeps the role it got on `pointerdown` (stick, look, pinch, button), keyed by `pointerId`, so stick, look and jump work at once and a look drag sliding over the jump button never jumps. A second finger in the stick zone goes to the camera; a pinch does not rotate.
- **Desktop.** WASD and arrows move (A/D strafe relative to the camera), Space jumps (edge, hold and repeat are distinct), E is the action, Shift toggles shift-lock, I/O zoom. Only a right-drag orbits; the left button stays free for UI. Pointer lock is requested only from a `pointerdown` or a Shift keydown (user activation); Chrome refuses a re-lock for about 1 s after Esc, and Firefox rejects `unadjustedMovement`, so it falls back to a plain lock.
- **Touch layout** (`touchLayout`, CSS px). Dynamic thumbstick zone: landscape 40 % wide × bottom 2/3, portrait full width × bottom 40 %. Shorter side up to 500 px: knob 45, ring 20, outer ring 74, dead zone 2, full speed at 20 px; above 500 px: 90 / 40 / 148 / 4 / 40. Jump button 70 px at right 25 / bottom 20, or 120 px at 50 / 90. Safe-area insets are added. **Left-handed** mirrors the stick zone and the jump button; **Larger buttons** forces the big layout.
- **HUD buttons.** Elements inside the input wrapper with `data-game-button="jump" | "action" | "shiftLock" | "emote"`. The wrapper needs `touch-action: none; user-select: none; -webkit-touch-callout: none`. Keys are read from `window` while attached, so give HUD buttons `tabindex="-1"` or route their keyboard activation through `InputModel.tapButton(role)`, or a focused button also receives Space.
- **Touch UI.** `src/scene/TouchControls.svelte` draws the stick (white, translucent, dark outline, a ghost hint until the first move), the jump button (pressed state at scale 0.92) and the contextual action button (76 px, 88 px on the big layout), shown only when an action is available. `src/scene/controls.ts` `actionControl()` maps a story action to its pt-BR label and icon (Pegar, Plantar, Rádio, Marcar, Falar, Carinho, Observar, Fotografar, Tirolesa).
- **Persistence.** `src/data/local-save.ts` keeps `controls: { version: 1, leftHanded, largeButtons, hintsSeen }`, preserving the other sections and refusing to overwrite a future version. `src/scene/ControlSettings.svelte` exposes the two toggles.

## 8. Collision worlds

- **`CollisionQuery` is structural.** `Character`, `OrbitCamera` and `PlayerController` take any object with `shapecast(bounds, visit)` and `raycast(ray, far)`. The streaming runtime satisfies it without a nominal BVH (`src/world-runtime/streaming/engine-query.test.ts` runs the real character and camera against such a query).
- **`CollisionWorld`.** One static BVH over simplified proxies (ground, boxes, ramps, logs, platforms). Visual meshes are not colliders; leaves and decoration stay out. Hidden and skinned meshes are skipped by `fromObject`. Raycasts return world distances and hit both faces.
- **`CompoundWorld(sources, children)`.** The static sources are copied once at construction; each child is queried after the base. `dispose()` does not dispose children: the caller owns them. `src/mechanics/park-runtime.ts` adds `GateWorld` (a child that answers nothing while `enabled` is false) and `OwnedWorld` (a compound that does dispose its children).
- **Never refit per tick.** The suspension bridge's BVH holds the full ±0.25 u sway envelope from construction; only its live vertices move. A per-tick refit would allocate typed-array views.

## 9. Park mechanics (`src/mechanics/`)

Import from `src/mechanics/index.ts`. Positions are `{x, y, z}` in game units. Specs are stable data; instances and their buffers are reused. Call `step` only from the existing fixed tick.

| API                                 | Contract                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Ladder(spec)`                      | `{id, base, top, exit, radius, rungSpacing?}`. Enter by the ladder volume (±0.4 u of its height); climbs at 0.5 × walk speed; a jump detaches; `exit` is where the feet land on the deck. A 0.4 s cooldown stops an immediate re-grab. Rung spacing defaults to 0.45 u and also drives the climb cadence.                                        |
| `Zipline(spec)`                     | `{id, start, end}` are the rider's **feet** at the stations, not the cable (the visual cable sits 3 u higher). `start(unlocked)`; projected gravity, quadratic drag, ≤ 11 u/s, braking on the last 6 u, exact dismount at `end`. Jump is ignored. Uphill or degenerate segments are rejected.                                                    |
| `Canoe(spec)`                       | `{id, channel, halfWidth, landings, currentSpeed?}`; the channel is an XZ polyline at water height, 1 u of the half-width is reserved for the hull. Paddling up to 4 u/s plus a current (default 0.35 u/s, clamped to 0.8). `leave()` works only within 2.5 u of a landing.                                                                      |
| `SuspensionBridge(spec)`            | `{id, start, end, width, planks}` (2–256 planks). A damped spring per plank, load from the walker's position and speed, amplitude ≤ 0.25 u; reduced motion zeroes it on the next tick. `heightAt(x, z)` matches the mesh.                                                                                                                        |
| `Boardwalk(spec)`                   | Segments with lookouts `{id, position, camera, target}`.`action` within 2 u frames the lookout for 3 s with a 0.3 s blend (a cut with reduced motion); `cancel()` on movement, pause or zone change.                                                                                                                                             |
| `PhotoCamera(subjects)`             | Stable subjects `{id, species, position, enabled?}`, positions updated in place. Valid when ≤ 25 u, in front of the camera, inside NDC ±0.4 on both axes (the central 40 %), and not occluded (one ray per eligible subject). `action()` enters framing; the next valid action saves every valid subject (`saved[0..savedCount)`, `revision++`). |
| `PhotoProjection(world)`            | three adapter: `evaluate(photo, perspectiveCamera)`. The collision world must exclude the subjects themselves; the ray stops 0.05 u short of the target.                                                                                                                                                                                         |
| `CameraTrap(species, ownerMission)` | `place(serial)` → pending; resolves only on a **later** completion of **another** mission (a monotonic serial that survives reloads, never the mission number); `collect()` once.                                                                                                                                                                |
| `ParkTraversal(options)`            | The `TraversalDriver`: `ladders`, `ziplines`, `canoes`, `ziplineUnlocked(id)`, `beforeStep(dt, character)`.`mode` is walk, ladder, zipline or canoe. **Without an unlock callback the zipline stays locked.** `reset()` clears everything; `PlayerController.respawnAt` already calls it.                                                        |

`create*Mesh` helpers return `.root` and `.dispose()`; static meshes expose world-space `.colliders`. Only moving meshes need `.update()` (zipline, canoe, bridge, trap). Never move a mesh root after its colliders were generated; final positions come from the spec.

The contextual action button is shared: the host decides the priority (dialogue, photo, trap, lookout, traversal) and consumes the press once. `readTraversal(input, traversal)` in `src/mechanics/avatar.ts` fills the animator's `climbing`, `hanging`, `rowing`, `sitting`, ladder and canoe fields after `readCharacter`, with no allocation; the `climb`, `hang` and `row` poses are P28's (see `docs/animation.md`).

## 10. Wiring in the game (P29)

- **Act 1 view.** `withAct1(level)` in `src/missions/act1.ts` adds missions 0, 7 and 8, NPCs, triggers and obbies at run time without changing generator data or checksums.
- **`ParkRuntime(level, world, story, baseCollision)`** (`src/mechanics/park-runtime.ts`) is built by `createMapEnvironment` in `src/world-runtime/environment.ts` when the level has `act1`. It owns the ladder (P21's treehouse points), the zipline, the portal gates, the photo camera and the combined collision world. `Root.svelte` passes `environment.park.traversal` to `PlayerController`; `scene/Graybox.svelte` calls `readTraversal` every frame.
- **Zipline.** Feet from (129, 15, 84) to (46, 4, 84), unlocked by mission 6 (`act1.zipline.mission`). The departure cable dips 0.13 u under the plateau lip, so the runtime keeps the feet 0.03 u above the terrain. Before mission 6 the action reads "Conclua a missão do mirante para usar a tirolesa".
- **Decks.** Every item of `level.act1.decks` gets colliders: the treehouse, the mirante deck (x 128–134, z 81.5–86.5, y 15, rails with a 2 u opening centred on z 84) and the zipline base, which also gets steps down to the terrain (`parkBoxes`). `src/mechanics/park-runtime.test.ts` walks every floor and rail, the opening included.
- **Gates.** `ParkRuntime.gates` match `level.portals` in order; each collider stays on while `!story.completed(portal.mission)`. `sync()` re-reads the story only when `story.revision` changes.
- **Props.** `loadParkProps(park, signal)` loads the P26 GLBs (Iara's house, pulley, deck and rail pieces, trail markers, seeds) and converts them to `houseMaterial`.
- **Photo flow.** The camera evaluates authored birds and active life actors (`setLife`), only while framing. The shutter saves, the frame is copied right after the render, and `GuideMechanicsBridge` (`src/mechanics/guide-bridge.ts`) records the species and a thumbnail (JPEG ≤ 256 px, ≤ 60 KiB) through `GuideService`. The Guia pauses the simulation and releases input.
- **Back to base.** `input.releaseAll()` → `checkpoints.reset()` → `controller.respawnAt(environment.start)` → `controller.resume()` → focus the wrapper (`Root.svelte` `backToBase`). With streaming, the destination's collision must be loaded before that teleport.

## 11. Verify

```sh
./node_modules/.bin/vitest run --config game/vite.config.ts game/src/engine game/src/mechanics
./node_modules/.bin/biome check game/src/engine game/src/mechanics
node game/controls-acceptance.ts   # needs pnpm game:dev on :5196 (GAME_MEASURE_URL); writes to GAME_CONTROLS_DIR
```

- **Mechanics preview** (dev only, not in the pack): `http://localhost:5196/src/mechanics/preview.html`. `?manual&shot=ladder` (or `zipline`, `photo`, `bridge`, `canoe`, `trap`, `boardwalk`) gives deterministic captures through `window.__mechanics`; `?reduced` forces reduced motion.
- **Controls acceptance** runs mobile viewports 915×412, 412×915 and 360×800 with real CDP touch. It asserts Follow mode, the jump button rect, the ghost hint, the pressed state, seven top-bar targets ≥ 44 px, left-handed plus larger buttons after a reload, zero console errors, and a canopy fading at the mirante.
- **Measured.** The P19 fixture under SwiftShader with 4× CPU throttling stayed under 6 ms CPU p95 per mechanic; its rAF p95 reached 33.4 ms on the ladder and the boardwalk, so it does not pass the A07 gate on its own. The integrated P29 world on the low tier (Chrome/ANGLE, 1280×720): spawn 132 draws, mirante 148, deck 143, treehouse 106, all ≤ 150.

## 12. Open issues

**Needs the A07/A57 devices:** touch feel (Roblox sensitivities are per DIP, here per CSS px, and the 20 px stick travel is short on a 6.5" phone), pinch while the thumb is on the stick, `pointercancel` on rotation and system gestures, BVH build and shapecast cost with the real level on Mali/Adreno, 60 Hz physics on 90/120 Hz screens, and the FOV (70 versus 55).

**Owner decisions:** `MAX_SLOPE` 50° (Roblox 89°), the camera's maximum distance (now 40 studs), the capsule radius 0.5 u (the R6 torso half-width is 0.6), the I/O zoom rate (6 per second), and the FOV.

**Not wired yet:** the canoe, the swinging bridge and the camera trap have tested APIs and preview fixtures but no placements: Act 1 has none, and no positions were invented. They wait for the zones (`PARK.md` §4–§5). `StoryGame.onMissionComplete` is the hook for the trap. The ipê seed reuses the jequitibá seed geometry until its own asset exists.

**Not built:** moving platforms, swimming, invisicam, dynamic bodies.

**Debt:**

- `jumpReach`, `KILL_Y` and the ramp constants live in `src/engine/graybox.ts`, the graybox fixture, but `level/build.ts` and the level tests import them; split them into `engine/jump.ts` before moving the fixture.
- Four closed-form springs: `engine/camera.ts` `springStep`, `animation/spring.ts`, `animation/animals/damped-spring.ts` and the loading screen's inline spring; one module should serve all.
- Some `src/engine` comments still cite scratch reports (`character.ts` header, `constants.ts` source tags); point them at this file.
