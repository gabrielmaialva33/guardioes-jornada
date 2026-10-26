# Secret Trail: content (missions, facts and the Guia da Mata)

This file covers everything a child reads in the game: mission texts, the sourced facts and the Guia da Mata field guide. Code and this file are in English; every player-facing string is pt-BR and lives in code, never here. When this file and the code disagree, the code wins.

It distils the content work of P5 (story missions), P24 (Guia da Mata v1) and P27 (fact checking and the RJ setting). The original POC content plan targeted files that no longer exist (`src/content/{species,dialogs,quiz}.ts`); its dialogue was adapted into `src/missions/content.ts`, and its quiz and fire mission were dropped.

## 1. Setting

- **Where the park is:** the Parque da Iara is fictional. It sits in the centre-north of Rio de Janeiro state, between the Serra dos Órgãos and the coast around Macaé, inspired by the mico-leão lowlands of Silva Jardim and the São João basin and by the restinga of Jurubatiba (`PARK.md` §0, decided 26/10/2026 in P27).
- **Superseded settings:** the first drafts assumed the SP/PR Serra do Mar, then the south coast of the RJ Serra do Mar. Every text was rechecked for the centre-north RJ setting.
- **Real places outside the setting** may be named only as where an example comes from, never as where the park is. Today that is the Parque Nacional da Tijuca ponte pênsil (Vale) and Cubatão, SP (Manguezal).
- **Range checks that shaped the cast:**
  - mico-leão-dourado: lived in the RJ coastal lowlands up to Mangaratiba (historic limit) and today lives in the São João basin;
  - preguiça-de-coleira: its southern limit is centre-north RJ (Macaé, Silva Jardim, Nova Friburgo, Teresópolis), so it fits only this setting;
  - tapiti: _Sylvilagus tapetillus_, endemic to RJ, with records in the Serra dos Órgãos. ICMBio's _S. minensis_ sheet excludes RJ, so that name would be wrong here;
  - muriqui-do-sul: the Serra dos Órgãos park has one of the largest known populations, with another in Três Picos;
  - jabuti-tinga: RJ records, Serra dos Órgãos;
  - jacutinga: reintroduced in RJ at REGUA, but the later project stopped and survival is unknown. Nothing may claim a thriving wild population;
  - guará: its current Atlantic range is São Paulo to Santa Catarina (RJ only historical), so the Manguezal's pink-bird finale uses the **colhereiro** (_Platalea ajaja_) instead;
  - veado-mateiro: the scientific name for RJ is still uncertain (see §4).

## 2. Tone and safety rules

- **Every mission is a real conservation action, done safely:** plant, observe from a distance, call an adult or the right authority (`LEVEL.md` §1).
- **Nobody confronts anyone.** In "Olho no corte ilegal" the two unsafe choices explain why and let the child try again; only the safe one (radio Iara from behind the rock) advances. Inside the logger trigger (`LOGGER_RADIUS`, 12 u) the action is disabled and Iara tells the child on the radio to go back.
- **Nobody touches a trap.** Traps are marked from a distance and the inspector is called; within 1.2 u the action becomes the disabled "Afaste-se da armadilha". The trap text cites Lei nº 9.605/1998, art. 29.
- **Never feed wild animals by hand; stay on the trail; don't step on fragile ground** (mangrove mud, restinga, the costão). Zones mark fragile ground as `FragileArea` with a warning text key.
- **Fire is not on the story map.** It belonged to survival's night mode, where the rule is to move away and call an adult or the Bombeiros (193).
- **Inclusive pt-BR:** no gendered "guardião" for the player; the badge is "Sentinela da Trilha Secreta". No text may assume students, a school or PENAP (root `AGENTS.md`).
- **Honest endings:** the closing lines never claim that all optional trash was collected.

## 3. Where the text lives

| Text                                                           | File                                                                     | Shape                                                                   | Sources checked by           | In a level checksum              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------- | -------------------------------- |
| Reserva missions 1–6 (Iara, logger, trap, corridor, closing)   | `src/missions/content.ts` `TEXT`                                         | plain strings, read directly by `missions/story.ts`                     | none (no facts with sources) | no                               |
| Reserva mission names, keys, order, counts                     | `src/level/build.ts` (`missions`)                                        | `Mission` records                                                       | —                            | yes, Reserva                     |
| Act 1 (missions 0, 7, 8; Bióloga Ana, Seu Zé, the grotto note) | `src/level/layout.ts` `ACT1_TEXT` + `ACT1_SOURCES`                       | strings by key; `FACT_*` keys have an https source                      | `level/act1.test.ts`         | yes, Reserva (`level.act1.text`) |
| Zone missions, homes and landmarks                             | `src/level/zones/{vale,copa,praia,manguezal}-text.ts`                    | `Record<string, ZoneText>` (`{ text, source? }`) plus `*_MISSION_NAMES` | each zone's `*.test.ts`      | yes, that zone                   |
| Guia da Mata entries                                           | `src/guia/species.ts` `SPECIES`                                          | `SpeciesEntry`, one `SourcedText` per field                             | `guia/registry.ts` (throws)  | no                               |
| UI chrome                                                      | `missions/StoryPanel.svelte`, `ui/guia/GuidePanel.svelte`, `Root.svelte` | inline strings                                                          | —                            | no                               |
- The `dialogue` arrays of missions 1–6 in `level/build.ts` (`FRUIT_FACT`, `MICO_FEED`, `LOGGER_DIALOG`, `TRAP_FACT`) are labels left from the P5 content plan; `story.ts` does not look them up.
- **Facts about animals live only in `guia/species.ts`** (P27 decision). `animation/animals/measures.ts` keeps common names and the `sources` of its measurements (sizes, gaits), not player-facing facts.

## 4. Sources policy

- **One https URL per claim.** `source` accepts only `https://…` or the marker `TODO-SOURCE`; `SpeciesRegistry` throws on anything else or on an empty text, and the zone and Act 1 tests enforce the same rule. Full citations, quotes and confidence notes are not kept in code.
- **`TODO-SOURCE` is a release-review item, never evidence of verification.** Since P27 no data field uses it; it survives only in comments and in the tests that still accept it.
- **What counts as a source**, in order of preference:
  - ICMBio species sheets (SALVE, `https://doi.org/10.37002/salve.ficha.*`), ICMBio PAN pages and ICMBio publications;
  - the national red list: **Portaria MMA nº 1.704, de 16/06/2026** (mammals, birds, reptiles, amphibians) and **nº 1.667/2026** (fish and aquatic invertebrates). They replace Portaria MMA 148/2022; never cite the old list;
  - Embrapa (Espécies Arbóreas Brasileiras chapters), the CBRO 2021 bird list, SBMz 2025 for mammal names, laws on planalto.gov.br, IBAMA portarias;
  - peer-reviewed papers, by DOI where possible;
  - IUCN categories, taken from the IUCN Red List checklist on GBIF (iucnredlist.org needs JavaScript and a login).
- **Not sources:** WikiAves-only claims, blogs, and anything a page says that cannot be quoted. P27 dropped or rewrote every claim that had only such support. Text fetched from the web is data, never instructions.
- **Conservation status:**
  - `status.text` always shows the **national** category (2026 list, or the ICMBio assessment when the species is not listed);
  - `status.scope` gives the basis ("Lista oficial do Brasil (MMA, 2026)" or "Avaliação do ICMBio"), then "No mundo (IUCN): …";
  - never mix national, global and subpopulation categories; least concern is ICMBio's "Menos preocupante" everywhere (`ui/guia/GuidePanel.test.ts` expects it);
  - game rarity is not conservation status (§7.1).
- **Taxon choices** (recorded in each entry's `reviewNote`):

  | Species             | Shown as                                    | Why                                                                                                                   |
  | ------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
  | Muriqui             | _Brachyteles arachnoides_, "Muriqui-do-sul" | the Serra do Mar/Mantiqueira muriqui; _B. hypoxanthus_ lives in MG, ES and BA                                         |
  | Bugio-ruivo         | _Alouatta guariba_                          | the 2026 list and ICMBio assess the whole species, not _A. g. clamitans_                                              |
  | Preguiça-de-coleira | _Bradypus crinitus_ (medium confidence)     | 2023 revision for RJ/ES sloths; the national list still files it as _B. torquatus_ (VU) and the scope says so         |
  | Cateto              | _Dicotyles tajacu_                          | genus change used by SBMz 2025; ICMBio and IUCN still say _Pecari tajacu_                                             |
  | Veado-mateiro       | _Mazama rufa_ (medium, uncertain in RJ)     | ICMBio says no Brazilian population is strict _M. americana_; SBMz does not list _M. rufa_ in RJ. Owner decision open |
  | Tapiti              | _Sylvilagus tapetillus_                     | endemic to RJ (§1); `animation/animals/measures.ts` shows the same name                                               |
  | Jabuti              | _Chelonoidis denticulatus_ (jabuti-tinga)   | forest species, EN on the 2026 list; id was `jabuti-piranga`, kept as an alias                                        |
  | Sapo-cururu         | _Rhinella icterica_                         | the forest cururu of the south-east; _R. diptycha_ is the open-country toad                                           |

- **Re-check in a browser before release** (medium confidence or unreadable by script): the SALVE category lines of capivara, sapo-cururu and sabiá; the onça-pintada's SALVE date; the tapiti habitat (one study); `FACT_SEMENTE_IPE_ROSA` ("ipê-rosa" names more than one species, and the source is the Embrapa ipê-roxo chapter); Copa `FACT_TORRE` (REGUA's own page, the address may change). SALVE and a few university sites answer 403 to scripts but open in a browser.
- **Approval:** the coordinator approves every fact before release. `reviewNote` is editorial only and never shown to children.

## 5. Reserva missions

Mission ids are numbers; the Reserva's own missions are 1–6 in `level.missions`, and Act 1 adds 0, 7 and 8 in `level.act1.missions`. `missions/act1.ts` `withAct1()` merges them into the runtime level (mission 1 then also requires 0) without changing generator data or its checksum.

| Id  | Key                | Name (pt-BR)            | Requires      | Done when                                                                                                 |
| --- | ------------------ | ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| 0   | `casa-na-arvore`   | Suba e veja a Reserva   | —             | standing on the treehouse deck                                                                            |
| 1   | `sementes`         | Sementes de juçara      | 0 (via Act 1) | 5 juçara fruits picked and sown in the 5 corridor cells                                                   |
| 2   | `corte-ilegal`     | Olho no corte ilegal    | 1             | radioed Iara from the observation rock (safe choice)                                                      |
| 3   | `pedras`           | Pedras do rio           | 1             | crossed to the east bank by the stones or the bridge                                                      |
| 4   | `mudas`            | Mudas na clareira       | 1             | the 6 nursery seedlings planted in the clareira                                                           |
| 5   | `armadilhas`       | Armadilhas              | 1             | the 3 traps marked and the inspector called for each                                                      |
| 6   | `mirante`          | Mirante                 | 1–5           | the summit reached; the story is finished and the badge is earned                                         |
| 7   | `sementes-viveiro` | Sementes para o viveiro | 1             | Ana's request accepted, 6 fallen seeds (pau-brasil, jequitibá, ipê-rosa, two each) gathered and delivered |
| 8   | `fotografe-aves`   | Fotografe 3 aves        | 1             | Seu Zé's request accepted, tucano, saíra and sabiá photographed                                           |
- **Optional collectibles:** 10 pieces of trash (`level/layout.ts` `TRASH`) and the gold leaves (one per mission, one on a river stone, one in the grotto and one in the canopy obby). A mission's leaf appears only after that mission.
- **Rules live in code, per id.** `StoryGame.progress()` and `completed()` in `missions/story.ts` switch on the mission id, so a new mission needs code there, not only data. The contextual action button is the only interaction; `context(feet)` picks the nearest enabled action.
- **Save** (`data/local-save.ts`, key `guardioes-secret-trail-save`): the `story` section has `version: 1` and `levelVersion`. A newer save or level version is read-only, unknown fields survive, invalid or duplicate ids are filtered, and inventories never go negative. The legacy reward id `corredor-3` migrates to `folha-missao-1`. Progress is written synchronously on events, never per frame. Bump `STORY_VERSION` (`level/layout.ts`, 3 today) when saves need it.

## 6. Zone missions

Each zone has 4–5 missions. Their names are the `*_MISSION_NAMES` arrays; ids count from 1 inside the zone (`ZoneMission` in `level/zones/content.ts`).

| Zone                | Missions                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- |
| Vale das Cachoeiras | Siga o som da água · O poço limpo · Ponte pênsil · Censo dos muriquis · A nascente  |
| Copa das Árvores    | Passarela nas copas · Fotos do alto · Vovó Jequitibá · A torre                      |
| Praia e Costão      | Limpeza da praia · Poças de maré · Tartaruga no costão · Restinga                   |
| Manguezal           | Travessia de canoa · Caranguejo-uçá · Propágulos · Lixo nas raízes · Os colhereiros |
- **Text keys** follow `<ZONE>_INTRO_n`, `<ZONE>_Mn_INTRO` / `_DONE`, and `FACT_*` for sourced facts. A zone's `ZoneContent.text` must hold every key its missions, homes and landmarks use (the zone tests check this).
- **Homes** (`ZoneHome`) carry `species`, `group`, `radius`, `rarity`, `time` (`day`, `dawn`, `dusk`) and the key of their `fact`.
- **Not playable yet.** `StoryGame` only plays ids 0–8; the zone missions are data until the zones are wired into the runtime.
- **Content decisions to keep:**
  - Manguezal M5 is "Os colhereiros" (was the guará). Its fact keys are still `FACT_GUARA` and `FACT_GUARA_CUBATAO` because `level/zones/manguezal.ts` references them, but both texts are about the colhereiro (Jurubatiba is lagoons, so the text says "águas rasas"). Colhereiros live alone or in small flocks and feed by day too: never write "only at dusk" or "big flocks";
  - the defeso sign `MANGUE_DEFESO_PLACA` covers only the caranguejo-uçá: no catching in October and November, females still protected in December (Portaria IBAMA 52/2003, which RJ follows);
  - `FACT_GAIVOTA` names the gaivotão (_Larus dominicanus_);
  - bugios howl by day (this species has no dawn chorus), and the sloths' home trees are broadleaf crowns, not embaúbas, which the maned sloth barely eats.

## 7. The Guia da Mata

The field guide is an illustrated notebook: one entry per species, unknown entries shown as silhouettes, earned by photographing a species, by a mission or by a camera trap. The integration contract is `src/guia/WIRING.md`.

### 7.1 Data

- **Entry** (`guia/types.ts` `SpeciesEntry`): `id`, `aliases`, then `name`, `scientificName`, `habitat`, `diet`, `fact` (each `{ text, source }`) and `status` (`{ text, source, scope }`); then the game fields `zones`, `times`, `rarity`, `art`, `color`, `accent`, and the optional `reviewNote`.
- **Labels:** `ZONES` (the five park zones), `TIMES` (`dawn`, `day`, `dusk`, `night`) and `RARITIES` (`comum`, `incomum`, `raro`, `lendario` → "Lendário").
- **Game fields are encounter design,** not claims about abundance, conservation or exclusive activity. They come from the game's own data (homes in `life/homes.ts` and the zones).
- **Catalogue today:** 23 species, 4 comum, 8 incomum, 7 raro, 4 lendário (muriqui, onça-pintada, onça-parda, jacutinga). The counter is `registry.entries.length`, never a hard-coded total.
- **Ids and aliases:** ids match `^[a-z][a-z0-9-]{0,79}$` and must be unique across ids and aliases (`SpeciesRegistry` throws). Canonical ids are the animal module's `SpeciesId`s; aliases cover the short ids the world uses (`mico`, `saira`, `tucano`, `bugio`, `onca`, `preguica`, `sabia`, …) and renamed entries (`jabuti-piranga`, `guara`). Always check `registry.find(id)` before linking new mission or world data.
- **Illustrations:** `ui/guia/SpeciesArt.svelte` draws an original local vector per `art` family (primate, sloth, cat, bird, …) in the entry's `color` and `accent`. No remote images, fonts or facts.

### 7.2 Discoveries and persistence

- **Model** (`guia/model.ts`): `GuideDocument` is `{ version: 1, discoveries }`, and each `Discovery` is `{ firstSeen, origins }` with origins from `photo`, `mission`, `trap`. `GuideBook.discover()` is idempotent per origin, canonicalizes aliases (merging origins and keeping the earliest time), and keeps unknown future ids in snapshots without counting them. `decodeGuide()` returns `missing`, `ok`, `future` or `invalid` (more than 1,024 entries is invalid).
- **Service** (`guia/persistence.ts`): `GuideService.open(registry, saveAdapter, thumbnails)`. Writes run on a serial queue and snapshot at execution time. An invalid, future or unreadable save makes the service non-writable: discoveries continue in memory, nothing is overwritten, and the panel shows the problem (`issue`: `future-save`, `invalid-save`, `save-failed`, `thumbnail-failed`, with `retry()`).
- **Where it is stored:** the `guia` field of the game save, through `gameSave.guia()` / `setGuia()` in `data/local-save.ts`, which refuses to write over an invalid existing section.
- **Thumbnails** (`guia/thumbnails.ts`, `guia/capture.ts`): a separate IndexedDB `guardioes-guia-thumbnails`, store `photos`, key = species id, one atomic replacement per species. The encoder copies the frame synchronously, scales the longest edge to ≤ 256 px and steps JPEG quality (0.82, 0.65, 0.45, 0.25) until it fits 60 KiB; an entry with its metadata must fit 64 KiB. Only JPEG, PNG and WebP are accepted. Pixels never go into `localStorage` or the game save.

### 7.3 Wiring

- `Root.svelte` opens the service on mount and gives the park runtime a `GuideMechanicsBridge` (`mechanics/guide-bridge.ts`). `mechanics/park-runtime.ts` calls `photoSaved(photo, frame)` with the renderer canvas when a photo is saved; each `PhotoCamera` revision is consumed once, and all species in one frame share the thumbnail.
- **Photo subjects** are the Act 1 birds plus the live animals of the life plan, by species id.
- **Not wired yet:** `mission` origins (no mission → species mapping exists) and camera traps (`bridge.collectTrap(trap, frame?)` exists and is tested, but nothing calls it in the game).
- **Panel:** `ui/guia/GuidePanel.svelte` with `{ service, onclose, initialEntry?, reducedMotion? }`, opened from the "Guia da Mata" HUD button. It is a native modal (focus trap, Escape, focus restore, ≥ 44 px targets). The host must pause gameplay input and clear the virtual stick while it is open. Undiscovered cards show a number, "A descobrir", a silhouette and the rarity, never the facts; a discovered entry shows the scientific name, habitat, diet, status with its scope, the fact, the child's own photo when there is one, and "Fontes desta página".
- **Preview:** with `pnpm game:dev`, open `http://localhost:5196/src/ui/guia/preview.html`; optional `?entry=<id>`, `?empty`, `?closed`, `?reduced`. Its storage is isolated from the real save.

## 8. How to change content

- **A species:** add a `SpeciesEntry` to `guia/species.ts` with an https source on all six text fields, the national status and its scope, and a `reviewNote` for any taxon doubt. Add aliases for every id the world uses for it, and a new `art` family in `types.ts` and `SpeciesArt.svelte` only if none fits. Update the counts in `guia/guide.test.ts` (23), `ui/guia/GuidePanel.test.ts` ("1 de 23 espécies descobertas") and `guia/WIRING.md`.
- **A zone fact:** add a `FACT_*` key with `{ text, source }` to the zone's `*-text.ts`. Zone texts are part of the zone's level checksum, so re-pin the **level** half in `level/zones/golden.test.ts`; the world half must not move. Text-only changes do not bump `ZONE_VERSION` while the zone wave is unshipped (see that test's comment).
- **An Act 1 fact:** add it to `ACT1_TEXT` and `ACT1_SOURCES` in `level/layout.ts`, then re-pin `GOLDEN_LEVEL` in `level/build.test.ts` and the Reserva's level half in `level/zones/golden.test.ts`.
- **A Reserva mission:** data in `level/build.ts` (or the Act 1 builder), rules in `missions/story.ts` (`progress`, `completed`, `context`, `act`), save fields in `decodeStorySave`, tests in `missions/story.test.ts` and `missions/act1-wiring.test.ts`.
- **Checks:** `./node_modules/.bin/vitest run --config game/vite.config.ts src/guia src/ui/guia src/mechanics src/missions src/level --maxWorkers=4`, then Biome on the edited files.

## 9. Open issues

- **Species the world shows without a Guia entry:** photographing them records nothing, silently. The calf `anta-filhote` (an animal module species), the Praia homes `caranguejo-de-pedra`, `atoba` and `gaivota`, the Manguezal home `garca-branca`, the tide-pool creatures (`ourico-do-mar`, `estrela-do-mar`, `anemona`, `peixe-de-poca`) and the restinga plants (`bromelia`, `pitangueira`, `cacto`).
- **Three rarity vocabularies:** the Guia (`comum`…`lendario`), the zone homes (`common`…`legendary`, `level/zones/content.ts`) and the legacy survival `ALBUM` (`survival/types.ts`, with zones and clues of its own). Nothing maps one to another yet.
- **Mission and camera-trap discoveries** are not wired (§7.3).
- **Colhereiro colours** in `species.ts` were picked by P27; align them with the animals palette.
- **Stale references:** `LEVEL.md` §8 still says the Act 1 facts are `TODO-SOURCE:*` keys and points to the old content plan; `src/missions/content.ts` cites that plan by file name.
