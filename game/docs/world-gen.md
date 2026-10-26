# Secret Trail: world generation and streaming

The world past the Reserva has three layers. `src/world-gen/` generates the endless Mata Atlântica as pure data, one 40 u chunk at a time. `src/level/zones/` builds the hand-made park (the Reserva plus four zones) as data in the same shapes. `src/world-runtime/streaming/` loads both around the player by chunks, through two Workers.

The design and phases are in `WORLD.md`, the park's layout in `PARK.md` (its coordinates in `docs/park-plan.py`) and the Reserva in `LEVEL.md`. This file keeps the contracts, numbers and gotchas, and how to regenerate and verify things.

## 1. Status (26/10/2026)

- **Done, as data and tests:**
  - F0, the generator (P9), and the F1 prep: the chunk apron, `farHeights` and the first stitch band.
  - F1 part 1, the east portal on the level side: a causeway at y 15, z 66–74, gated by mission 6 (`level.portal`).
  - P20, the zone framework and the generated world's stitch to the park.
  - P21, the Reserva v2: the north and south portals and the gorge.
  - Zone content: P25 (Vale), P30 (Manguezal), P31 (Copa) and P33 (Praia).
  - P34, the streaming core, and P37, per-chunk water, shore, trails and waterfalls.
- **In flight: P36, the integration.** `streaming/runtime.ts` (`createStreamingRuntime`: both Workers, the ring and the mesh pools), `navigation.ts`, `placement-route.ts` and `far-terrain.ts` exist with tests. Root and the game scene don't call them yet, and nothing reads `?zone=` yet.
- **Today** the game runs the Reserva alone, through `buildStoryWorld()` and the whole-map runtime; the pack doesn't reach the generator or the zone builders.
- **Superseded:** F1 part 2 as first planned (a generated strip east of the Reserva). The approved park (`PARK.md`) comes first, and the park's outer edges stay closed (a soft wall) until F2.

## 2. Coordinates, chunks, seeds and versions

x grows east (the serra) and z grows south. Chunk (cx, cz) spans [40·cx, 40·cx + 40] × [40·cz, 40·cz + 40]. `CHUNK_SIZE` is 40, survival's `BLOCK_SIZE`. A chunk has 41 × 41 height samples 1 u apart, and its last row and column are the neighbour's first.

The park is 88 chunks (`level/zones/spec.ts` `PARK_ZONES`):

| Zone        | Chunks          | World (x, z)       | Act |
| ----------- | --------------- | ------------------ | --- |
| `reserva`   | (0..3, 0..3)    | 0..160, 0..160     | 1   |
| `vale`      | (4..7, 0..3)    | 160..320, 0..160   | 2   |
| `copa`      | (4..7, −4..−1)  | 160..320, −160..0  | 2   |
| `praia`     | (−1..3, −4..−1) | −40..160, −160..0  | 3   |
| `manguezal` | (−1..3, 4..7)   | −40..160, 160..320 | 3   |
- **Seeds:** `WORLD_SEED = subSeed(STORY_SEED, 20)` (1499388684) is the one "Mundo da Mata" every child shares. Each generator layer has its own sub-seed (k 21..34, clear of survival's 1–14), and the zones use `PARK_SEED` (= `STORY_SEED`). `world-gen/constants.ts` and `level/zones/spec.ts` copy `STORY_SEED` so neither Worker imports the level; `reserve.test.ts` and `zones.test.ts` check the copies.
- **Versions:** `MACRO_VERSION` (relief, rivers, zones, the ids saves will reference) and `DETAIL_VERSION` (vegetation, rocks, decorations) are both 1. `ZONE_VERSION` is 2, and the Reserva's `STORY_VERSION` (`level/layout.ts`) is 3.
- **Range:** `chunkId` packs ±32,767 chunks into one integer below 2³², so the ring never builds a string per frame. Float32 keeps about 1 cm at |x| ≈ 10⁵, so meshes are chunk-local.

## 3. Determinism rules

These hold for every data file in `world-gen/` and `level/zones/` (survival's rules, `survival/random.ts`). Each folder's `determinism.test.ts` scans the comment-stripped sources.

- **Arithmetic:** only `+ − × ÷ %`, comparisons, bit operations and `Math.imul`, `sqrt`, `abs`, `min`, `max`. Every other `Math.*` is banned, `floor` included (use `survival/noise.ts` `floor`), and so are `**`, the clock, `Intl`, `toLocale*` and `crypto`. The one exemption is `world-gen/worker.ts`, for `performance` only. V8 changed its libm in 2026, so `Math.sin` and friends can differ between Chrome versions.
- **Gotchas:** `Math.SQRT1_2` trips the scan, so the scatter uses `Math.sqrt(0.5)` (correctly rounded). The Manguezal's round boardwalk uses exact cos/sin literals.
- **Randomness by position:** every random decision is a hash of an integer cell, a layer and the seed (`world-gen/hash.ts` `cellHash`). A sequential `Rng` lives only inside one object, seeded from that object's hash; never walk an `Rng` across a chunk. P21 applied the same rule to the Reserva's planting (one stream per pass, `subSeed(seed, 3 + cell)` per candidate), so a new keep-out no longer reshuffles the whole forest.
- **Indexes from world coordinates**, never through `x − x0`, which rounds differently per rectangle (a P9 bug). Decide in float64 or integers; use Float32 only for output. Sorts are total, with ties broken by index.
- **Imports:** world-gen sources import only `survival/` and `level/zones/spec.ts` (no three.js, Svelte or DOM). In `level/zones/`, the test's `PURE` list stays free of three.js and the level builder; only `reserva.ts` and `park.ts` pull in `level/build.ts`.

## 4. The generator (`src/world-gen/`)

```ts
generateChunk(cx, cz, seed = WORLD_SEED): WorldChunk        // pure; any order, any Worker
generateArea(x0, z0, width, depth, seed, options?): Area     // the same per-vertex bits over any rectangle
heightWithApron(chunk, i, j)                                 // i, j in −1..41
farHeights(x0, z0, cells, step, seed?, detail = false)       // (cells + 1)² heights for a horizon ring
```

- **`WorldChunk`:** typed arrays, each on its own buffer, so `chunkTransferables(chunk)` posts it with zero copies. `heights`, `zones`, `flags` and `biome` are 41². `biomeWeights` is 10 bytes per vertex summing to 255 (16.8 KB, half the chunk). Rivers are segments with stride 8 (`ax, az, aWater, bx, bz, bWater, halfWidth, depth`) plus link ids and flags (`deep` 1, `fall` 2, piece index in bits 2–3). Placements are survival `Placements` in world coordinates with `block` 0; `collision` is a survival `CollisionBlock`; `checksum` covers everything but the apron.
- **Macro relief** (`macro.ts`): within z −40..200 the coast is at x 0 and the serra foot at x 132, and `macroHeight` equals `level/build.ts` `shapeRelief` with its noise at 0 (restinga 0.5 to x 10, baixada 1.6 → 2.8, encosta 3 → 6 over x 110–126, 7.5 at x 132). East of the foot, `serraRise(s)` gives about 10 at s 4, 18 at s 28 (x 160), 24 at s 60, 44 at about s 170, the crest's 52 at `CREST_S` 240, and the planalto's 44 from `PLANALTO_S` 300 on (tested to x 200,000). Along z the coast-to-foot distance alternates between `COSTAO_FOOT` 132 and `BAIXADA_FOOT` 600 in cells of about 1.8 km, and the coast meanders ±40 u. The domain warp (25 u at 0.006/u, on an 8 u `CoarseField`), the morros and the meanders are 0 in the stitch band and grow to full over 300 u, so the calibration holds wherever the park meets the world.
- **Rivers** (`rivers.ts`): a Scheidegger lattice with one node per 80 u cell (origin −40), each draining into one of its three west neighbours by hash. Accumulation is bounded by the crest; water is the lowest of the node's own target and every upstream water − 0.01, so it always falls. A stream needs accumulation 2 (1 in the serra past s 20) and is 0.35 deep and wadeable; from 5 it is a deep river (1.4, not wadeable). Banks rise 0.6/u, carved fully within 18 u and faded out by 30 u, as a minimum over segments (so any superset of segments gives the same bits). A link dropping over 4 u at more than 15 % is flagged `fall`. The park and its 40 u band hold no node: generated rivers detour round it, and the park river belongs to the zones (§6).
- **Biomes** (`biomes.ts`): 10 biomes in 7 ranks (sea; beach, restinga, mangue; baixada; submontana; montana; alto-montana, campo; planalto). The ladder reads only the coast distance and the distance s past the foot, cutting where the macro crosses 8, 24 and 44 u (s −2, 60, 175), with the planalto from s 300. Consecutive ranks are complementary smoothsteps 20–30 u wide, so the order along any west-to-east line is guaranteed. `BIOME_ZONE` maps each biome to a survival `ZONE`, so the runtime's tints apply. Species tables await the biologist (F4).
- **Scatter** (`scatter.ts`): hash-priority blue noise, one candidate per r/√2 cell, kept when no candidate within r has a higher priority: about 52 % of Bridson's density, and the union of chunk scatters equals the whole area's. Trees and rocks share one layer at r 3.8; decorations use r 2.2 and keep 1 u off it. Each point draws its biome from its vertex's weights, so biomes interpenetrate across a blend. `survival/poisson.ts` (Bridson) is only for sets inside one object: it breaks the spacing at chunk borders.
- **Hand-made chunks:** `isHandMade` is true for all 88 park chunks; `generateChunk` returns them with `handMade: true`, `grid: 0` and empty arrays.
- **Apron:** 168 heights one unit outside the grid: the north row (z0 − 1), then the south row (z0 + 41), each x0 − 1..x0 + 41, then the west column (x0 − 1) and the east column (x0 + 41), each z0..z0 + 40. They equal the neighbours' heights bit for bit, so normals need no neighbour. **Gotcha:** inside a park zone the apron holds the stitched generated ground, not the zone's; use the zone's data across the park's edge.
- **Stitch to the park** (`park.ts`, `park-stitch.ts`, `park-edges.ts`): `PARK_BOUNDARY` is 12 edges, 1,760 u, derived from the zone rectangles. Every generated vertex within `STITCH_BAND` (40 u) blends towards the zones' edge heights: the profile box-filtered ±8 u plus the edge's own detail fading out within 8 u, edges combined by inverse squared distance, weight w = 1 − smoothstep(0, 40, d), exact on the boundary. There is no slope limit, because the outer edges have no crossing before F2, so the blend stays a pure per-vertex function.
- **Worker and client:** page to Worker `want`, `cancel`, `focus` (nearest first, optional `dropBeyond`); Worker to page `chunk`, `dropped`, `error`. The host runs one job per MessageChannel turn (no 4 ms timer clamp), so cancels are seen between jobs. `WorldGenClient` keeps an LRU capped by bytes (default 16 MiB, about 490 chunks); a chunk that outruns its cancel is still cached, and cancelled requests reject with `ChunkCancelled`. The page imports only `client.ts` and `protocol.ts`, never `index.ts`, so the generator stays out of the main bundle; Vite emits `worker.ts` through `new URL(..., import.meta.url)`.

| Measure (P9, P20; i9-13900K)    | Value                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| ms per chunk                    | Node median about 0.6; Chrome 156 Worker median 0.6–0.7, p95 1.0–1.4; first chunk 10.6 ms (20.5 ms with Worker creation)  |
| A07 projection (×4.57 to ×17.6) | median 2.7–12.3 ms, p95 4.6–24.6 ms: the gate (median ≤ 15, p95 ≤ 40) is projected to pass, not yet measured on the phone |
| Bytes per chunk                 | about 34.5 KB median; `biomeWeights` as top 2 biomes + a blend byte would give about 24 KB                                |
| Worker bundle                   | 15.0 KB gzip                                                                                                              |

## 5. Goldens and the version policy

- `world-gen/golden.test.ts` pins 12 chunks × 3 seeds (`WORLD_SEED`, 1, `0xdeadbeef`): the park's band, the serra, a wide baixada, the crest, the planalto and far away. Node 26, Chrome 156 and Firefox 157 agree (P20); WebKit has never been run.
- `level/zones/golden.test.ts` pins `[world, level]` per zone; the Reserva's pair is `level/build.test.ts`'s `GOLDEN_WORLD` and `GOLDEN_LEVEL`.
- **Policy:** `MACRO_VERSION` and `DETAIL_VERSION` stay 1 until saves exist (F3), so re-pin without a bump; after that, bump the version that covers the change (saves will reference macro ids, so a detail bump invalidates nothing). `ZONE_VERSION` 2 is the unshipped zone-content wave: zones re-pin without a bump until they ship. Fact and source text changes move only the level halves. A Reserva change bumps `STORY_VERSION`; device saves are keyed by version and checksum, so a saved checkpoint restarts once.
- **Coupling:** the Vale's world checksum follows the Reserva's east edge, the Copa reads the Vale and the Praia, and the Praia and the Manguezal read the Reserva. A Reserva edge change re-pins those zones; an outer-edge change needs the edge table (§7).

## 6. The park as zones (`src/level/zones/`)

- **API:** `buildZone(id)` returns `{ id, spec, offsetX, offsetZ, width, depth, world, level }`: `world` is a `SurvivalWorld` in zone-local coordinates ((0, 0) is the zone's north-west corner), and `level` a `ZoneLevel` (`StoryLevel` with wider keys, plus `arrival` and `content`). `buildPark()` is memoized, `buildParkFresh()` builds anew, `buildOne(id, built)` builds one zone from those before it, and `zoneHeight(zone, x, z)` reads world coordinates.
- **Wide zones:** `world.grid` is the row stride (width + 1). The Praia and the Manguezal are 200 × 160, so take the rows from `heights.length / grid` (or `depth + 1`), never from `grid`. `paths.ts` `pathRibbon` and `terrainHeight` assume a square and read NaN past the last row; `streaming/square.ts` `squareWorld` pads.
- **Mission ids** count from 1 within each zone: namespace them (for example `vale:1`). The Reserva (`reserva.ts`) wraps `buildStoryWorld()` unchanged, so its checksums are the level's own.
- **Build order:** `reserva → vale → praia → manguezal → copa` (`BUILD_ORDER`). A zone reads only the zones its seams name (`streaming/zone-cut.ts` `zoneClosure`: the Copa needs the Reserva, the Vale and the Praia), and any order gives the same park (tested).
- **Pipeline:** a smooth skeleton (`skeleton.ts`: the Vale floor 20 → 30 with the ridge carrying the causeway in, the Cachoeira Grande's wall at x 246–252 and the upper valley 50 → 60; the Copa floor 30–40; the Praia and the Manguezal from world-gen's coast profile, measured from `park-plan.py`'s coast line), then the seam bands (`band.ts`), the river carve (`river.ts`), the zone's own shaping, and its content: trails and marks, mechanics specs, missions, homes and vegetation. `kit.ts` holds the shared helpers; its square-only helpers don't fit the 200 × 160 zones, its `Rect` ones do.

| Seam (`SEAMS`)      | Edge             | Crossing                                    |
| ------------------- | ---------------- | ------------------------------------------- |
| Reserva → Vale      | x 160, z 0..160  | z 66–74 (the F1 east portal)                |
| Reserva → Praia     | z 0, x 0..160    | x 66–74                                     |
| Reserva → Manguezal | z 160, x 0..160  | x 36–44                                     |
| Vale → Copa         | z 0, x 160..320  | x 218–226                                   |
| Praia → Copa        | x 160, z −160..0 | none (stitched anyway, so no step anywhere) |
- **Seam recipe:** the fixed zone keeps its heights; the other zone's band blends towards them within `BAND` 40 u, with the same target and weights as the outer stitch (the box filter is skipped inside crossings), and seam vertices are exact. Every band vertex ends within 0.89 u of its four neighbours and 1.25 u diagonally (`BAND_SLOPE`, just under `WALK_SLOPE` 0.9), enforced by exact max-plus and min-plus envelopes. P20 replaced F1's FIFO clamp, which never settled the Copa against the Vale's 50–60 terrace. Seam vertices constrain the limit only inside crossings; elsewhere the seam is a closed edge. A crossing is 8 u wide (`CROSSING_HALF` 4), and every entry (`ENTRIES`) requires mission `mirante` (the Reserva's mission 6).
- **Park river** (`PARK_RIVER`), water only falling: the spring at (300, 20) at 59; the Cachoeira Grande 50 → 30 into its pool; a 5 u cascade into the gorge under the bridge; rapids to 9.4 at the Reserva's edge; the gorge P21 cut across the Reserva's massif; the small waterfall at (132, 30); the Reserva's own river (`level/build.ts`'s surface rule); then sea level through the mangrove to the mouth at (−26, 240). `river.ts` carves it with the Reserva's cross-section (flat bed, banks 0.8/u, stopping 4 u above the water). A station can steepen its banks (`bankSlope`, the gorge), and a fall's `face` splits the carve so the plunge pool never notches the cliff.
- **Content contract** (`content.ts`): missions, triggers (`lookout`, `bridge`, `camera-trap`, `walkway`, `fragile`, `radio`), landmarks, mechanics specs (types from `src/mechanics/`), homes, basins and texts with sources. Each zone stays at or under 1,600 placements (`MAX_INSTANCES`), like the Reserva, and its two-vertex edge band is a rail except at its openings.
- **Cost:** the whole park builds in about 85 ms warm in Node and 145–250 ms on a browser main thread. In the stream Worker a zone build plus cut takes 60–169 ms at 4× CPU throttle, once per zone.

## 7. Regenerating the park edge table

`world-gen/park-edges.ts` embeds the zones' heights along `PARK_BOUNDARY`, because the generator's Worker must not import the zone builders. When a zone's outer edge moves, `park-stitch.test.ts` fails with "a zone changed". Then:

1. Run `node game/scripts/world-gen/park-edges-table.ts`. `ROOT` (the repo root) defaults to the script's location, and `OUT` to `game/src/world-gen/park-edges.ts`.
2. Run `./node_modules/.bin/biome format --write game/src/world-gen/park-edges.ts`; the committed file is in Biome's layout, one value per line.
3. Re-run the world-gen tests and re-pin the golden chunks in the park's band that moved. The file's header lists the zone checksums it was built from.

## 8. The streaming core (`src/world-runtime/streaming/`)

- **Sources:** `StreamChunk` is one shape for both sources; its `story` points at the zone's own `ZoneLevel`, never copied. `GeneratedSource` wraps `WorldGenClient` with no copy and returns `null` for park chunks. `ZoneSource` asks the stream Worker for a zone's cut the first time a chunk of it is wanted, keeps unheld cuts within `keepBytes` (2 MiB), and with `only` is a zone-only map (void around, rails on its outer edges). `ParkSource` routes by `zoneOfChunk`.
- **Workers:** world-gen's, and the stream Worker (zone builds and cuts; terrain, water and collision builds; trail ribbons). Both run one job per turn, and each has an inline fallback (`createInlineStreamPort`, and `runtime.ts`'s inline generator).
- **Ring** (`StreamingRing`): Chebyshev radii around the focus chunk: render 2 (5 × 5) on low and medium and 3 (7 × 7) on high, data one more, collision 1 (3 × 3), each with one ring of slack. Requests go out on a chunk crossing, by distance, with chunks ahead up to 50 % nearer (`facing` 0.5). Resident data stays under 8 MiB by default (slack first); a request that fails 3 times is held as void. Main-thread steps (release, collider, collision build, mesh, surface, place, build) run within `budgetMs` (4 by default, 3 in P36's runtime) by per-kind running estimates, and the first step of a frame always runs. A terrain build waits until all 8 neighbours have data. Frames without a crossing allocate nothing.
- **Caller contract:** call `ring.update(x, z, facingX, facingZ)` once per frame, **before** the character's physics step. Hold the player until `ring.ready()` (about 340 ms cold in Chrome), and after a teleport call `ring.relocate()` and wait again. If the player's chunk ever lacks a collider in play, it is built on the main thread at once (`stats.emergencies`). The engine takes a structural `CollisionQuery` (`engine/world.ts`), which `ring.collision` satisfies.
- **Terrain:** `world-runtime/terrain.ts` `terrainChunk`'s vertex format and index, chunk-local, with the mesh at (x0, 0, z0). Normals read a `FieldWindow` (the chunk plus a 3 u margin from its loaded neighbours); a sample on a shared edge always belongs to the east or south chunk, so vertices are bit-identical across every seam kind. Colour goes through the `TerrainTint` plug; the default `windowTint` mirrors `terrain.ts` `terrainTint`.
- **Water** (P37): one signed field per chunk feeds both the terrain's `shore` attribute and the water mesh, so the wet band and the foam always agree. Its bodies are the river segments of the chunk's 3 × 3, the zones' pools and basins (keyed zone × 1000 + n, deduplicated and sorted so both sides of an edge blend alike), and the sea: the level set over `ZONE.sea` below `waterLevel`, with land held at φ ≥ 0.3 so a carved bed below sea level never floods. Past 32 u from water the field holds "no water" and the shore attribute (−10000, 10000). The mesh uses `shore.ts` `waterSurface`'s format, keeps cells within 0.6 u of water, leaves cells over a drop of more than 1.5 u to the waterfall model, and merges deep level sea into rectangles (2 triangles per chunk of open sea instead of 3,200).
- **Trails:** `paths.ts` `pathRibbon` runs once per zone in the Worker, is split by triangle centroid and goes out with each chunk's terrain build; the Worker keeps the splits of the last 2 zones (ribbons inside the cuts had grown them to 9.7 MB).
- **Waterfalls:** from `'waterfall'` landmarks (lip and drop), flowing along the zone river downstream of the lip. The model is a scenery placement scaled by height / `WATERFALL_MODEL_DROP`, and the spray is `createWaterfallSpray`; call `ring.updateWaterfalls(camera)` per frame. Unlike the whole-map path, the Reserva's fall faces −49° (from the data, not asset-plan's −90°) and its foot sits at 3.43, not 3.
- **Collision:** `collisionData` builds one serialized BVH per chunk in the Worker (ground at 1 u, 8-sided trunk and boulder cylinders, log boxes, decks, props; no edge rails). It matches `buildMapCollision` to 1e-4.
- **Placements:** `ToroidalBlockGrid` gives slot (cx mod S) + (cz mod S)·S with S = 2·(render + 1) + 1 (7 low, 9 high), so pools keep their per-block culling and LOD. `ChunkPlacements` adds and removes a chunk's instances as a whole, with stable ids across a release and an immediate re-acquire. `PlacementRoute` maps families and kinds to pools; its optional `scenery`, `added` and `removed` hooks serve waterfalls, crowns and fades. Size pools with `ringCapacity(kinds, radius)` from `PER_CHUNK_MAX` and `WINDOW_MAX`, measured over 1,698 chunks (busiest chunk 152 placements, median 114).
- **`?zone=<id>`** (`zone-loader.ts`): `zoneParam` reads it; `loadZoneMap` hands a zone to the whole-map runtime in Root's `mapData` shape (wide zones padded to a square, with a rail); `zoneOnlySource` with `zoneSpawn` streams it alone. Root doesn't read it yet (P36).

| Measure (P34, P37; Chrome 156, real Workers, 4× CPU throttle) | Value                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Main thread per walking frame                                 | worst 2.1–2.8 ms against the 4 ms budget, 0 frames over 4 ms; load frames 4–7 ms before the estimates warm up |
| 2 km walk east and back (`ring.test.ts`)                      | no leaked chunk, mesh, collider, instance, water mesh, ribbon or waterfall                                    |
| JS heap after GC                                              | flat at about 32–35 MB once the generator cache fills                                                         |
| Worker chunk build (terrain, water, collision)                | usually 0.7–1 ms; 33–35 ms for a zone's first chunk, which splits its ribbon                                  |
| Stream Worker size                                            | 167 KB gzip by esbuild, mostly three.js via three-mesh-bvh; the real Rollup size is still to check            |

Device gates still to measure on the A07: F1's ≤ 140 draws, ≤ 180k triangles and ≤ 120 MB heap after 1 km east and back with no hitch over 50 ms, and `PARK.md` §8's low-tier gates at every pose of every zone.

## 9. Tripwires and verification

- **world-gen tests:** `borders` (shared edges and aprons bit-identical), `order` (any generation order), `scatter` (union = whole), `rivers`, `biomes`, `macro` (the calibration), `reserve` (park chunks empty), `park-stitch` (the edge table is current), `golden`, `determinism`, `client`.
- **level/zones tests:** `zones` (layout, river, exact seams, walkable crossings, bands within limits, any build order), one file per zone (reachability by BFS with obby links, missions, budget), `golden`, `determinism`.
- **Streaming tripwires** (`sync.test.ts` and the files it names) fail when the whole-map runtime changes and the streamed copy doesn't: `windowTint` against `terrainTint` bit for bit on 6,724 Reserva vertices; `water.test.ts` against `shore.ts` `waterField` and `waterSurface`; `trails.test.ts` against `pathRibbon`; `terrain-mesh.test.ts` against `terrainChunk`. The cleaner fix is a `terrainTint` that reads a sampler, passed to `createStreamHost({ tint })`.
- **Run:** `./node_modules/.bin/vitest run --config game/vite.config.ts game/src/world-gen game/src/level game/src/world-runtime/streaming`, with capped workers.
- **Not in the repo yet:** the cross-engine golden page (Chrome and Firefox), the browser benches and the overview map renderers used in P9–P37.

## 10. Open items and known debt

- **F2:** open the outer edges (crossings, and a slope limit on the outer stitch), fords, bridges and generated trails. The generated world has no pools, basins, waterfalls or trails yet.
- **Rivers:** links are 4-piece polylines and water is per segment; no planalto network (F4), no basins (F5).
- **Biomes:** the ladder ignores relief detail; far from the park the warp stretches the blends by up to about ±40 %; alto-montana and campo borrow xaxim, juçara and araucária until their species exist.
- **Runtime types:** a wider `Portal` type would let zones use `portal` instead of `arrival`, and `StoryGame` needs a widened type for `ZoneLevel`.
- **Trail litter:** the ground's off-ribbon litter (`uGroundPaths`, one 128² field per world) doesn't reach streamed zones yet.
- **Edge cases:** two zone pools within reach of one edge could disagree (none today); Copa crowns along the lookouts' sight lines are not modelled.
- **Debt:** `chunk.ts` copies `TRUNK_RADIUS` from `survival/generate.ts`, and the determinism scanner is copied in `survival/`, `level/` and `world-gen/`.
- **Saves per chunk** (F3) have not started.
