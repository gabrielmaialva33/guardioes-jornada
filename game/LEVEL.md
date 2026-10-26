# Secret Trail: the story map ("Reserva da Iara")

The one hand-made map of the game. Survival mode keeps its own generated maps; this one is authored, so every child plays the same reserve. Art follows `ART.md`; the scale and the jump numbers come from `src/engine/constants.ts`. The plan image is `docs/level-plan.svg` (generated from the same coordinates as this file).

## 1. Principles

- **Roblox-shaped:** a hub (Iara's base), trails out to the missions, two obbies, collectibles, checkpoints everywhere. A child who never reads a line can still explore, jump and climb.
- **Every mission is a real conservation action, done safely:** plant, observe from a distance, call an adult or the right authority. Nobody confronts anyone and nobody touches a trap. The texts are the corrected ones in the content report (`conteudo-jogo.md`).
- **Navigation by landmarks, not by a minimap:** the jequitibá on the mirante (east), the ipê-amarelo at the base (west) and the river between them. The yellow arrow at the avatar's feet points to the current mission.
- **Nothing blocks progress:** the stones have a bridge alternative, falls only send the child back to the last checkpoint, and every mission can be done in any order after the first.

## 2. Data: the same `World` shape as survival

Author the map as data with the shape of `SurvivalWorld` (`src/survival/types.ts`): `heights`, `zones`, `flags`, `river`, `crossings`, `base`, `pois`, `threats`, `corridor`, `animals`, `trees`/`rocks`/`decorations` placements sorted by block, and collision `blocks`. The renderer, collision and animal wiring are then written once and serve both modes.

- Story-only data lives in a separate `StoryLevel`: missions, dialogue keys, checkpoints, obby pieces, collectibles and trigger zones.
- The build is deterministic from the control points in this file, with a golden checksum test as in survival. No `Math.random`.
- Same grid: 160 × 160 u, 1 u height grid (161²), 40 u blocks (4 × 4), x grows east towards the serra, z grows south.

## 3. Geography

| Area              | Where (x, z)                                                | Height (y)           | Notes                                                                         |
| ----------------- | ----------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| Restinga          | x < 10                                                      | 0.5                  | Sandy strip on the west edge, low bushes, map edge                            |
| Baixada           | x 10–110                                                    | 1–4, gentle noise ±1 | Most of the map: forest fragments, pasture, trails                            |
| Encosta           | x 110–126                                                   | 3 → 6                | Rises towards the plateau                                                     |
| Mirante (plateau) | polygon (128, 40) (158, 40) (158, 100) (130, 100) (126, 70) | 15, flat top         | West face is a cliff (> 50°, not walkable) except the ledges                  |
| Serra edge        | x > 150 outside the plateau, z < 40                         | 10–18                | Steep forest: the east boundary                                               |
| Map edges         | all sides                                                   |                      | Rising ground plus dense trees, then an invisible wall at 1 u inside the edge |

Forest fragments, the pasture and the clareira are the polygons in `docs/level-plan.py` (the plan's generator). Forest means `FLAG.forest`. The pasture between the west and north fragments is the corridor (`FLAG.corridor`), and the clareira is `FLAG.cleared`.

## 4. River

- Polyline from the serra to the sea: (132, 30), (118, 42), (104, 58), (94, 76), (84, 94), (70, 112), (56, 128), (40, 144), (28, 160).
- Half-width 4.5 u. At the stones it widens into a pool of half-width 10 u, centred on (94, 76).
- Surface from y 3.0 at (118, 42) down to −0.5 at the south edge. A small waterfall drops from the plateau's north corner at (132, 30).
- **The gorge (STORY_VERSION 3):** the park's river (`zones/spec.ts` `PARK_RIVER`) comes from the Vale through a gorge cut into the serra, from the Reserva's east edge at (160, 32.3) to the waterfall's lip at (133, 30.1) and on to (132, 30). Water 9.4 → 9.0, matching `PARK_RIVER`'s stations at x 160 and x 133; a flat bed 1 u under it, cliff walls of serra on both sides. It is 7 u across (`GORGE.north`/`GORGE.south`): 3.5 either side of the line at the edge, as `PARK_RIVER`, widening to 2 north (the grotto niche's wall) and 5.5 south at the lip. So no full-speed jump (5.2 u flat) crosses it; a test checks every reachable cell against every walkable cell across it, with half a cell of footing on each side. It is `FLAG.river`, never walkable, and decorative: no path goes up or down it. The waterfall now falls 5.6 u, from the gorge's water (9.0) to the river's head (3.4), into a plunge pool at x 121–133, z 21–29.
- The gorge cuts off the north part of the serra (about 770 cells) that the reach graph used to reach from the plateau after the ledges. Nothing is placed there, and no jump reaches it (nor the grotto niche from the rim above it).
- Depth 1.6 u: not wadeable. Falling into it is a splash, then a respawn at the last checkpoint. There is no swimming in this version.

## 5. Places

| Key                  | (x, z)                                      | What                                                               |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Spawn                | (34, 92), facing north-east                 | Checkpoint 0. First view: Iara, the ipê-amarelo and the trail sign |
| Iara                 | (38, 80)                                    | Park ranger NPC, the hub: gives and closes missions                |
| Viveiro              | (27, 79)                                    | Seedling nursery; the six seedlings for mission 4 come from here   |
| Ipê-amarelo          | (30, 70)                                    | Base landmark: the only yellow canopy on the map                   |
| Trail sign           | (42, 88)                                    | Neutral sign: "Trilha da Reserva", no institution's logo           |
| Pasture / corridor   | polygon (44, 46) (76, 44) (78, 58) (46, 60) | Mission 1 planting cells in a line across it                       |
| Observation rock     | (100, 24), boulder about 4 u tall           | Mission 2: hide behind it                                          |
| Illegal cutting      | (114, 14), next to a jequitibá-rosa         | Mission 2: observed from the rock, never approached                |
| Stones               | from (86, 70) to (103, 82)                  | Obby 1, mission 3                                                  |
| Bridge               | (50, 124) to (62, 134)                      | The long way across; always open                                   |
| Clareira             | centre (112, 118), radius 14                | Mission 4: six planting spots on a ring of radius 7                |
| Traps                | (124, 104), (142, 128), (96, 140)           | Mission 5                                                          |
| Mirante ledges       | from (121, 97) to (128.6, 78)               | Obby 2, mission 6                                                  |
| Jequitibá (landmark) | (146, 62) on the plateau, 18 u tall         | Visible from the whole map (section 9)                             |

Act 1 places (STORY_VERSION 3, PARK.md §3; full data in section 14):

| Key            | (x, z)                                            | What                                                                      |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| Casa na árvore | jequitibá at (44.5, 74), deck 6 u up              | Mission 0. Moved 4.5 u east of PARK.md's (40, 74), which is on the trilha |
| Tirolesa       | mirante deck (129, 84, y 15) → base (46, 84, y 4) | Straight cable along z 84, opened by mission 6                            |
| Gruta          | niche x 133–136, z 23–27, behind the waterfall    | 3 stones across the plunge pool; gold leaf and Iara's note                |
| Folha da copa  | (60, 24), 9 u up                                  | 5 branches from (44, 39); gold leaf                                       |
| Bióloga Ana    | (112, 106)                                        | Mission 7, faces the clareira                                             |
| Seu Zé         | (96, 30)                                          | Mission 8, the birdwatcher                                                |

## 6. Trails

Soil paths 4 u wide, with `soil` ramp vertex colours and no colliders:

- **trilha** (spawn → north → stones): (36, 86) (42, 70) (46, 58) (52, 50) (62, 40) (78, 30) (92, 26), then along the bank (96, 40) (90, 56) (86, 68).
- **leste** (stones → clareira): (104, 84) (108, 100) (112, 112).
- **armadilhas** (clareira loop): (112, 118) (124, 104) (122, 98) (126, 120) (142, 128) (120, 140) (96, 140) (104, 124).
- **ponte** (base → bridge → clareira): (34, 92) (38, 112) (48, 124) (64, 132) (82, 128) (100, 120).
- **mirante-leste** (mirante top → east portal): (134, 72) (146, 71) (156, 70) (160, 70).
- **trilha-praia** (north portal): (70, 35) (70, 18) (70, 0).
- **trilha-mangue** (south portal): (64, 132) (52, 145) (44, 152) (42, 156) (41, 160).
- **Trail marks:** about every 20 u along every trail (`TRAIL_MARKS`), 23 in all. Each is on the trunk of a tree within 6 u of the centre line, otherwise on a post 0.6 u off the trail's edge. Where the trail doubles back, the post goes on the other side, or up to 3 u further out. Each mark faces the trail.

Walking time on the main loop is about 40 s without stops. Missions, collectibles and the two obbies make a first playthrough 8 to 12 minutes.

## 7. Obbies

The gaps are fractions of `jumpReach(rise)` (`src/engine/graybox.ts`). A full-speed jump covers 5.2 u on the flat and 4.7 u up a 1.5 u rise. The level test asserts every gap against `jumpReach`, like the graybox obby test.

**Obby 1: river stones (mission 3).**

- 7 stones, top radius 1.3 u (2.6 u across), tops 0.6 u above the water. Rises between stones stay within ±0.3 u.
- 8 gaps as fractions of the flat reach: 0.45, 0.5, 0.55, 0.6, 0.55, 0.6, 0.65, 0.5, which is 2.3 to 3.4 u.
- The line zigzags about ±1.6 u, so the camera keeps showing the next stone.
- Checkpoints on both banks: (84, 67) and (106, 85).
- Collectible: one gold leaf on stone 4.

**Obby 2: the mirante ledges (mission 6).**

- 6 ledges of rock, root and log, 2.5 × 2.5 u tops, at y 7.5, 9.0, 10.5, 12.0, 13.5 and 15.0. The take-off from the encosta is at y 6.
- Rise 1.5 u per jump. Gaps 0.45 to 0.6 of `jumpReach(1.5)`, which is 2.1 to 2.8 u.
- A fall lands on the ledge below or on the encosta, never in the river.
- Checkpoint on ledge 3 at (124.5, 89.8), and the last checkpoint on the top at (134, 72).

**Obby 3: the grotto stones (Act 1).**

- 3 stones, radius 1 u, tops 0.6 u above the plunge pool's water (y 4.03). They run due east from a pad on the west bank at (119.3, 25) to the niche's floor at (133.6, 25, y 4.4).
- 4 gaps of 0.3, 0.35, 0.35 and 0.3 of the flat reach. The last one rises to the floor.
- Only these stones reach the niche: the reach test checks this both with and without them.

**Obby 4: the canopy branches (Act 1).**

- 5 branch platforms, radius 1 u, each 1.8 u above the one before. They climb from the take-off at (44.1, 38.9, y 1.47) to the gold leaf at (60, 24, y 10.47), 9 u up.
- 5 gaps of 0.45, 0.5, 0.55, 0.5 and 0.45 of the flat reach, each measured within `jumpReach(1.8)`.
- A jequitibá's crown stands 2.2 u beyond the last branch. No other trunk stands within 2 u of the line.

## 8. Missions

The yellow arrow points to the next one. Mission 1 comes first (it introduces planting and the mico companion); the rest can be done in any order. The text keys are those of `conteudo-jogo.md`, sections 2 and 4.

| #                                                                                                                                                 | Name (pt-BR)         | Goal                                                                | Teaches                                                | Done when                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1                                                                                                                                                 | Sementes de juçara   | Pick 5 juçara fruits by the trail and plant them in the pasture gap | Ecological corridors reconnect forest fragments (AMLD) | 5 planting cells filled. The micos cross the corridor through the canopy and one follows the child (never fed by hand: `MICO_FEED`) |
| 2                                                                                                                                                 | Olho no corte ilegal | Reach the observation rock and call Iara on the radio               | Keep a safe distance; call the authorities             | Choice in `LOGGER_DIALOG`. Inside 12 u of the cutting, Iara says on the radio to go back behind the rock, and the mission waits     |
| 3                                                                                                                                                 | Pedras do rio        | Cross on the stones                                                 | Platforming; the bridge is the safe way                | Reached the east bank checkpoint by the stones or the bridge. Stones give the gold leaf                                             |
| 4                                                                                                                                                 | Mudas na clareira    | Plant the 6 nursery seedlings in the clareira                       | Restoration with native species                        | 6 spots planted; the seedlings grow one step at once (no waiting)                                                                   |
| 5                                                                                                                                                 | Armadilhas           | Find 3 traps, mark each one and call the wildlife inspector         | Never touch a trap; mark it and call an adult          | 3 traps marked (`TRAP_FACT`, Lei 9.605/1998, art. 29)                                                                               |
| 6                                                                                                                                                 | Mirante              | Climb to the top after missions 1–5                                 | Reward: the whole reserve in view                      | Top reached: Iara's closing line, badge `earnBadge()` (Sentinela da Trilha Secreta)                                                 |
| Act 1 adds three missions (PARK.md §3). They live in `level.act1.missions`, not `level.missions`, because `missions/story.ts` only knows ids 1–6: |

| #   | Name (pt-BR)            | Requires | Done when                                                                                          |
| --- | ----------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| 0   | Suba e veja a Reserva   | —        | On the treehouse deck (trigger `casa-na-arvore`). Mission 1 now requires it (`act1.firstRequires`) |
| 7   | Sementes para o viveiro | 1        | The 6 fallen seeds, 3 species × 2, collected round the clareira for Ana                            |
| 8   | Fotografe 3 aves        | 1        | Tucano, saíra and sabiá photographed within 25 u of Seu Zé                                         |

The species facts are `TODO-SOURCE:*` keys in `ACT1_TEXT`, waiting for their source.

- **Collectibles:** 10 pieces of trash along the trails (optional, counter in the HUD) and the gold leaves (one on stone 4, one per mission). Gold is only on things to touch.
- **Fire** is not on the story map. It belongs to survival and its night mode, where the rule is: move away and call an adult or the Bombeiros (193).

## 9. Visibility, light and budgets

- **Draw and triangle budget:** the survival map renders 2,765 instances at 14 flora draws and at most 92,810 triangles per pass on the low tier (`p1-render.md`). This map stays under the same counts:
  - at most 1,600 trees, rocks and decorations in total;
  - forest density from Poisson spacing of 5 u in forest polygons and 9 u elsewhere.
- **Landmark beyond the fog:** on the low tier the fog is opaque at 70 u, and the map's diagonal is 226 u. The jequitibá and the ipê-amarelo are therefore drawn as fog-free silhouettes in the horizon colour, so they stay visible as orientation points. They are 2 extra draws.
- **Light:** daylight from `LIGHT.daylight`. The plateau's west cliff faces the afternoon sun, so the ledges read clearly.

## 10. Animals

The behaviour and constraints are in `src/animation/animals/` (report `p3-animals.md`):

| Animal     | Home (x, z)                            | Notes                                                                                                                                                                                             |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Micos      | (60, 38), canopy of the north fragment | After mission 1, one follows the child. It needs `heightAt` for the ground and never freezes                                                                                                      |
| Bugios     | (18, 20)                               | Resting and howling in the canopy; the howl is the north-west's sound landmark                                                                                                                    |
| Muriquis   | (108, 32)                              | Brachiation needs branch handholds 1.0–1.25 u apart, never more than 1.33 u (`MURIQUI_HOLDS` in `src/animation/animals`). A row of canopy trees near the cutting shows what logging would cut off |
| Preguiça   | (128, 124), in an embaúba              | Sloths favour embaúbas                                                                                                                                                                            |
| Tucanos    | (138, 58), araucárias on the plateau   | Seen at the mission 6 finale                                                                                                                                                                      |
| Onça       | (146, 148), south-east forest          | Walks away when the child comes within 15 u; seen from the mirante and the trap loop                                                                                                              |
| Borboletas | the clareira, once planted             | One flock, one draw                                                                                                                                                                               |

## 11. Assets this map needs

Beyond what is in the lineup today, each item passes the quality gate in `ART.md` section 9:

- **Iara:** the Blocky avatar rig with a ranger palette (uniform shirt and cap). She uses the same 6 nodes and animations as the player.
- **Base:** viveiro (shelves with seedlings), a trail sign without logos, a radio.
- **Mission props:**
  - juçara fruit bunch and a seedling, in 3 growth steps;
  - snare trap and the marker flag;
  - the 3 trash kinds (bottle, can, bag);
  - the observation boulder, an axe-free tree stump with a cut mark, and the illegal-cutting set (a person in the Blocky rig, a pickup out of sight).
- **Obbies:** river stones (3 variants), ledges (rock, root, log), the wooden bridge.
- **Landmarks:** the tall jequitibá variant (18 u) and its silhouette version.

## 12. Build order and gates

1. **Map graybox:**
   - terrain mesh from the heights, the river, colliders, paths drawn as vertex colour;
   - grey boxes for every place and prop;
   - the two obbies at their final measures;
   - checkpoints and the arrow.

   Play it on the A57 (feel, distances, camera on the ledges) and measure it on the A07 before any art.
2. **Missions:** the `StoryLevel` state machine, Iara's dialogue, the radio, planting, marking, the per-device save (`gameSave`), and `earnBadge()` at the end.
3. **Art pass:** the vegetation placements, the assets from section 11, animals in their homes, and the silhouettes.
4. **Close:** measure on the A07 (30 FPS, p95 ≤ 33 ms, ≤ 200 draws, plus a 10–15 min thermal run), offline after deploys, reduced motion, and e2e through all 6 missions.

## 13. Portals (F1 Part 1 and STORY_VERSION 3)

`level.portals` lists three openings in the fence. Mission 6 (`requires: 'mirante'`) opens each one; the runtime gates them. `level.portal` is the east one, `portals[0]`, kept for the zone adapter. Each portal has `{ id, side, requires, mission, gap: { at, from, to, y }, posts, sign, gate, inside, outside, trail }`. `inside` is where "voltar" lands, facing into the Reserva.

| Portal | Side  | Gap                    | Sign              | Trail         | Notes                                                                                                                                                             |
| ------ | ----- | ---------------------- | ----------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| leste  | east  | x 160, z 66–74, y 15   | Rumo à serra      | mirante-leste | The causeway. The plateau's top is carried across the edge strip with cliff flanks, so it is reachable only over the ledges (F1 Part 1, `p9-world-gen-f0.md` §10) |
| norte  | north | z 0, x 66–74, y 5.06   | Rumo à praia      | trilha-praia  | The `reserva-praia` seam's crossing                                                                                                                               |
| sul    | south | z 160, x 36–44, y 3.75 | Rumo ao manguezal | trilha-mangue | The `reserva-manguezal` seam's crossing                                                                                                                           |

The fence opens only in the gap's two edge rows. Every open cell is reachable on foot, and no collider stands within the opening. The north and south openings sit on low ground, so they are reachable before mission 6: only the runtime's `requires` gate keeps them shut.

## 14. Act 1 data (`level.act1`)

All of it is data. Codex's runtime draws it, gives it collision and wires the mechanics (the ladder and the zipline are in `src/mechanics/`):

- **`treehouse`:** the tree, `deck` (5 × 5 u at ground + 6 = y 7.95, rails 1.1 u on every side except a 1.2 u gap at the ladder's top) and `ladder` (bottom (44.5, 76.9) on the ground, top (44.5, 76) at the deck, `yaw` facing north, towards the tree).
- **`decks`:**
  - `casa-na-arvore`;
  - `mirante-deck` (x 128–134, z 81.5–86.5, top y 15, rails N/S/E, a 2 u opening in the W rail at z 84): the zipline's start station;
  - `tirolesa-base` (x 44–48, z 82.5–85.5, y 4): the end station, 2.2 u above the ground there.
- **`zipline`:**
  - start feet (129, 15, 84), end feet (46, 4, 84), cable 3.6 u above the feet, length 83.7, drop 11;
  - brake over the last 6 u, top speed 11;
  - opened by mission 6;
  - no tree, rock or ground cover within 2 u of the cable's line (tested);
  - leaving the deck, the feet dip about 0.13 u under the plateau's lip (tested ≤ 0.2 u), over its last 2 u; past it they stay more than 1 u over the ground;
  - mission 6's ledge 4 lies 0.65 u off the line, but the feet pass 2.4 u over its top.
- **`gorge`:** the gorge's water as a `Stream` (points with the surface and the banks' distances north and south of the line, and the bed's depth).
- **`grotto`:** the niche (with its floor y), the plunge pool, the stones' obby, the gold leaf `folha-gruta` and Iara's note (`GRUTA_BILHETE`).
- **`canopy`:** the branches' obby, the gold leaf `folha-copa` on `galho-5` and the crown tree.
- **`npcs`:** Ana and Zé, each with its own mission.
- **`seeds`:** `semente-1..6`, 3 species × 2, 14–20 u from the clareira's centre, off the trails.
- **`birds`:** `ave-tucano`, `ave-saira` and `ave-sabia`, perched above the ground.
- **`marks`:** the trail marks (section 6).
- **`missions`**, **`firstRequires`**, **`triggers`** and **`text`:** section 8. The texts are in pt-BR; the facts are `TODO-SOURCE`.

The trees are planted from per-pass point streams, and each candidate draws its numbers from its own cell. A spot kept clear (a lane, the cable) therefore no longer reshuffles the species and sizes of the rest of the forest.
