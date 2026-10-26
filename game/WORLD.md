# Secret Trail: the endless Atlantic Forest

The game starts in the hand-made Reserva da Iara (`LEVEL.md`) and continues as an endless, procedurally generated Mata Atlântica. The procedural world is generated on the phone, with zero download, and works offline. Art follows `ART.md`.

The research behind it is in `~/.cache/agents/2026-10-25-trilha-secreta/pesquisa-qualidade/`:

- `f-mundo-infinito.md`: architecture, algorithms, the prototype in `scratch-f/proto/` and the phases;
- `e-parques.md`: 15 real parks, trail patterns, biome rules and set pieces; its board `parques/board.png` is for internal study only.

## 1. Geography

- **West:** the sea closes the world. Wading to −0.7 u, then a soft respawn; islands appear as silhouettes.
- **East:** always climbing. The order is encosta, serra, campos on the crest, then the araucária plateau, which goes on without end.
- **North and south:** endless along the coast. The coast-to-serra distance alternates, through low-frequency noise, between:
  - _costões_, where the serra meets the sea at about 130 u, as it does next to the Reserva;
  - wide _baixadas_ of about 600 u, with big rivers and mangroves.

Biomes follow the real altitudinal and coastal order of the Floresta Ombrófila Densa, with stylized heights. They blend over 20–40 u with weights, never with hard borders:

| Biome                      | Rule                        | Flora                              | Fauna and play                                           |
| -------------------------- | --------------------------- | ---------------------------------- | -------------------------------------------------------- |
| Praia, restinga            | near the coast              | jerivá, bromélias, beach grass     | trash brought by the sea                                 |
| Manguezal                  | coast and river mouths, low | mangue-vermelho                    | crabs, herons; trash in the mangrove                     |
| Baixada                    | h < 8 u                     | juçara, embaúba, ipês, pau-brasil  | high human pressure: pasture, traps, planting, corridors |
| Submontana                 | 8–24 u                      | juçara, xaxim, embaúba, jequitibá  | micos, bugios; first waterfalls                          |
| Montana                    | 24–44 u                     | jequitibá, xaxim, juçara           | muriquis, rare onça; bigger waterfalls, lookouts         |
| Alto-montana               | > 44 u, sheltered           | twisted low trees, moss, bromélias | local fog                                                |
| Campo de altitude          | > 44 u, exposed crest       | grasses and flowers                | the widest views                                         |
| Planalto (Ombrófila Mista) | past the crest              | araucária                          | gralha-azul, pinhão; rivers flow inland                  |

## 2. Architecture

The full design is in sections 4.1–4.15 of `f-mundo-infinito.md`.

- **Chunks:** 40 u, the same as the runtime's blocks today. The Reserva occupies chunks (0..3, 0..3).
- **Rings:**
  - render 5×5 on low and 7×7 on high;
  - data 7×7 to 9×9;
  - collision 3×3, one BVH per chunk;
  - unloading keeps one ring of slack.

  Behind them, the far field (`ART.md` §5) keeps the horizon alive: coarse terrain and tree impostors.
- **Generation:** a Web Worker generates each chunk as a pure function of position and seed. It reuses the `game/src/survival` code and its data shapes, and returns typed arrays as transferables. The prototype took 0.8 ms per chunk on desktop; it must be measured on the A07.
- **Determinism:** integer and allowed-math rules as in survival. Chunk borders must be bit-identical, and the result must not depend on generation order; both are tested.
- **Layers:**
  - macro relief calibrated on the Reserva's profile, with domain-warped and ridged detail;
  - rivers on a directed lattice (Scheidegger), continuous across chunks by construction, with basins later;
  - a connected trail network, so every mission is reachable;
  - Poisson scattering that is seamless across chunks.
- **Saving:** deltas per chunk in IndexedDB, with stable ids and two generator versions (structure and detail).

## 3. Stitching the Reserva

The recipe is in section 4.5 of `f-mundo-infinito.md`.

- **Open borders:** open the Reserva (`edgeRise = 0`) and blend through a 40 u band that only extends the smoothed border. The serra cliffs and the plateau must not leak out; today they would make 10.5 u steps on the north side.
- **Portals:** north from the trilha, east from the mirante towards the serra, south from the ponte trail, west from the restinga to the beach.
- **River:** the Reserva's river becomes part of the network. The waterfall at (132, 30) is fed from the serra, and the mouth at (28, 160) reaches the sea.
- **Home beacon:** a light on the base's radio mast, plus the jequitibá and ipê silhouettes, so the child always knows where home is.

## 4. Districts, missions and pacing

**Districts** are cells of 320 u, about 1–3 minutes of exploring. Each one gets:

- a theme from its biome, for example "Vale das cachoeiras", "Pasto em recuperação", "Mata dos muriquis", "Costão", "Manguezal", "Campos da crista" or "Araucárias";
- a quota of 1 landmark, 2–4 missions, 4–8 discoveries and 1–3 trash spots;
- a rarity draw:
  - common: trash, tracks, flowering bromélias;
  - uncommon: traps, planting, small lookouts, bridges;
  - rare: a big waterfall with a stone obby, a mother tree, a muriqui group, a spring;
  - legendary: the onça seen from a lookout, a jacutinga.

**Missions** are templates built on the verbs that already exist: plant, observe from a distance, call by radio, mark, collect trash. Examples:

- trash in the river;
- a trap: follow the tracks, mark it and call the inspector, never touch it;
- seedlings in a pasture;
- a census: place a trail camera and come back later;
- a lookout climb, where the ledges come from `jumpReach`.

Iara gives every mission by radio.

**Pacing:**

- At most ~300 u (about 30 s) along any trail without something notable.
- A landmark visible above the fog within ~400 u.
- Tension (a climb, a crossing, a trap) alternates with rest (a clearing, a pool, a lookout).
- Minimum spacing between set pieces of the same kind:
  - traps 120 u;
  - planting 250 u;
  - lookouts 400 u;
  - waterfalls 200 u;
  - smoke 600 u, and only seen from far away.

**Curated ring:** the 8 districts around the Reserva use a fixed deck. Within about 2 minutes of leaving the Reserva, every child finds a waterfall, a lookout, a trap, a planting site and a rare sighting.

## 5. Set pieces from real parks

The sources and measurements are in sections 1 and 4 of `e-parques.md`.

| Set piece                           | Inspired by                                                                                                             | In the game                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trail marks                         | Tijuca and the ICMBio standard: yellow/black footprints. Losses fell from 100+ to under 5 a year                        | Yellow/black mico-paw marks every ~20 u on every trail. If none has been seen for a while, Iara says on the radio to turn back                      |
| Suspended walkway                   | Serra dos Órgãos: 1.3 km loop, up to 8 m above ground                                                                   | Canopy boardwalk loop 3–4 u high, about 200 u long, with lookouts over the canopy                                                                   |
| Stair with chains to a 360° lookout | Pico da Tijuca: 117 steps cut in rock                                                                                   | Ledge or stair obby ending at a summit lookout that reveals the district map                                                                        |
| Suspension bridge                   | Tijuca: 27 m long, 4 people at a time, "don't swing it"                                                                 | 13 u rope bridge over a gorge, swaying a little; an obby variant                                                                                    |
| Waterfall heard before it is seen   | Iguaçu: the sound and the spray build along 1.5 km of viewpoints                                                        | The waterfall audio grows along the trail, spray particles near it, and a final walkway over the pool                                               |
| Canyon edge with araucárias         | Aparados da Serra / Itaimbezinho: a ~700 m deep canyon right next to flat grassland                                     | A sudden canyon at the edge of a campo with araucárias, a safety cable and a natural grandstand. The fog ("viração") rolls in as a visibility event |
| Cave with a skylight                | PETAR and Intervales: a guide kiosk with helmet and lamp, a waterfall entrance, a skylight that "lights up" around 1 pm | Cave set piece entered past a guide kiosk, with a light shaft that appears at one time of day                                                       |
| Wildlife corridor                   | Poço das Antas: animals crossed the planted overpass in order, tamarins last once the canopy closed                     | After planting a corridor, animals arrive in the real order over the next visits                                                                    |
| Mangrove boardwalk                  | Ilha do Cardoso and Superagui: a 600 m loop crossing the river; a beach passable only at low tide                       | Boardwalk loop over the mangrove; the tide comes later, as an option                                                                                |
| Two-level world                     | Itatiaia: lowland pools below, balanced boulders on the high campos                                                     | A district type with a lower forest and an upper plateau joined by a climb                                                                          |
| Mountain to the sea                 | Picinguaba: an old mill, forest, a river pool, restinga, mangrove and a rowboat crossing on one trail                   | A coastal district whose trail runs from the serra down to the sea                                                                                  |
| Named giant trees, tower, nursery   | Reserva Natural Vale: trails to named giant trees, a 25 m canopy tower, 2.5 million seedlings a year                    | Mother trees with names, a 12 u canopy tower lookout, nurseries as planting hubs                                                                    |

## 6. Navigation and safety for kids

- **Wayfinding:** trail marks, the home beacon, Iara's arrow and compass, and the lookouts that reveal the district.
- **Getting home:** a "voltar para a base" option (fast travel to the base and to discovered lookouts).
- **MVP range:** in the MVP, the radio's range limits how far the world opens. It grows with badges.
- **Motion sickness:** camera rules from `roblox-gameplay.md`; no forced camera motion.
- **Real-world safety:** every rule is the real one, as on the story map. Never approach fire or a trap, keep your distance from illegal activity, and call an adult or the authorities.

## 7. Phases

| Phase | Delivers                                                                                                                                                                                                               | Gate                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| F0    | `game/src/world-gen/`, pure and Worker-safe: the calibrated macro, lattice rivers, seamless scattering and `generateChunk` in the survival shapes. Tests for bit-identical borders, order independence and determinism | All checks green; ms per chunk measured                                                   |
| F1    | MVP "rumo à serra": only the east portal opens, into a ~3-district-wide strip. Chunk streaming, the 3×3 collision ring, the far field, the home beacon, the compass and "voltar para a base"                           | A07: 30 FPS, p95 ≤ 33 ms walking across chunk borders; no hitch over 50 ms                |
| F2    | All four portals, the river pins, bridges and fords, the trail network with signs                                                                                                                                      | Reachability test over thousands of points; no step steeper than `WALK_SLOPE` in the band |
| F3    | Districts, missions, rarity, the curated ring, saving per chunk, a journal/map                                                                                                                                         | Play test with kids: time until "I'm lost", missions completed, return to base            |
| F4    | Coast (beach, restinga, mangrove) and plateau (araucárias, campos) biomes, with their species                                                                                                                          | `ART.md` §9 audit and a biologist's review                                                |
| F5    | Truly endless, geomipmapping with morph, WFC set pieces, basin rivers                                                                                                                                                  | 30-minute thermal run on the A07                                                          |

## 8. Owner decisions

- Tide and fog: story map, procedural only, or neither.
- Time-of-day events such as the cave skylight.
- How to present the Tijuca history: its forest was replanted by enslaved people.
- The trail mark: a mico paw in the national yellow/black style, without any institution's logo.
