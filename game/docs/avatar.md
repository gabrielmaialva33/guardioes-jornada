# Secret Trail: the avatar and its editor

The player is a Roblox-classic blocky character: Kenney's six-block body with one 64×64 skin painted at runtime from flat colours, a face decal and an optional hair accessory, or one of Kenney's 18 pixel skins. The art rules (palette, diverse skin tones, clothes that stand out from the forest, no gold) are in [ART.md](../ART.md) "Avatar"; this file covers the data contract, the runtime, the save and the editor. It distils the regions contract (versions 1 to 3, 25–26/10/2026), the first chooser (avatar customisation, after P1.6), P12 (the editor) and the avatar parts of P13. Animation of the avatar, including the hair sway, is in [animation.md](animation.md).

## 1. Files

| Path                                                              | What                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/assets/models/avatar.glb`                                    | Kenney Blocky Characters 2.0 `character-a`, animations stripped, six named rigid nodes (`head` among them), head scale normalised, meshopt + quantised                       |
| `src/assets/models/avatar-hair.glb`                               | One top-level node per hair mesh, plus the v3 dangle children (§5)                                                                                                           |
| `src/assets/skins/avatar-regions.json`                            | The regions contract (§3–§4): slots, paint order, face decals, hair styles, 18 presets                                                                                       |
| `src/assets/skins/skin-{a..r}.webp`                               | Kenney's 18 player skins, 128×128 lossless WebP, nearest filtering                                                                                                           |
| `src/avatar/atlas.ts`                                             | `decodeAvatarAtlas` (strict validation) and `composePixels`                                                                                                                  |
| `src/avatar/catalog.ts`                                           | `AVATAR_ATLAS` from the real asset (`ATLAS_SOURCE = 'assets'`), `AVATAR_PRESETS`, `DEFAULT_AVATAR` (preset 1), `KENNEY_SKINS`                                                |
| `src/avatar/texture.ts`, `updates.ts`                             | The one canvas texture per avatar and its latest-wins update queue                                                                                                           |
| `src/avatar/hair.ts`                                              | `HairAccessories`: the accessory mesh on the head and its dangles                                                                                                            |
| `src/scene/avatar.ts`                                             | `loadModel`, `disposeModel`, `loadAvatar(signal, profile)`                                                                                                                   |
| `src/data/local-save.ts`                                          | `AvatarProfile`, `decodeAvatarProfile`, the device save                                                                                                                      |
| `src/ui/avatar-editor/`                                           | The editor (P12, §8)                                                                                                                                                         |
| `scripts/assets.mjs`                                              | `generateAvatarRegionsAndDefaultSkin`: writes `avatar-regions.json` and composites preset p01 into `avatar.glb`'s embedded texture; also builds the skins and the avatar GLB |
| `scripts/blender/models/avatar_hair.py`, `scripts/split-hair.mjs` | Build the hair meshes; cut the v3 dangles out of the packed GLB                                                                                                              |

`src/avatar/atlas.fixture.json` is for the composition tests only and never ships.

## 2. Body and scale

- The avatar is 3.0 u tall (ART.md §3); `loadAvatar` scales the Kenney model by `3 / 2.7` and keeps it facing +Z.
- Every mesh gets one shared stylized Lambert material (`flatShading`, vertex colours, rim light) whose `map` is the avatar's own skin texture. The GLB's original materials, textures and bitmaps are disposed at load.
- Loading is abortable: an exit during the load disposes the model, the texture and the hair source.

## 3. Regions contract, version 1

The data belongs to the asset pipeline; the runtime and the editor consume it. Any change goes through a new `version`.

- `size: 64`; `uvSource: "character-a.glb"`, the GLB whose UVs the rects follow.
- `slots`: `skin`, `shirt`, `pants`, `shoes`, `hair`, each a list of pixel rects `[x, y, w, h]` with the origin at the top left of the 64×64 image. Each slot is one flat colour.
- `paintOrder`: the five slots, each once; later slots paint over earlier ones (the code uses skin, shirt, pants, shoes, hair).
- `face`: `rect` (the head's front face) and `decals` `smile` and `neutral`: rows of equal length, legend `.` transparent, `k` dark `#1e1e24`, `w` eye white `#f4f4ef`, `m` mouth `#5a2e2e`. Painted after the hair, scaled nearest-neighbour into the rect.
- `presets`: exactly 18, each `{ id, name, skin, hair, shirt, pants, shoes, face }` with a short pt-BR name.
- `decodeAvatarAtlas` rejects anything else: wrong version or size, rects outside 64×64, a paint order that is not the five slots, decal rows outside `.kwm` or of unequal length, not 18 presets, bad ids or hex colours, and gold (`ACCENT.gold`) on shirt, pants or shoes.

## 4. Version 2: hair styles

The live file is `"version": 2`. A missing `hairStyle` means `curto`, so version 1 files stay valid.

| Id            | Name           | Mesh                             | Tint  |
| ------------- | -------------- | -------------------------------- | ----- |
| `curto`       | Curto          | none (painted only, the v1 look) | hair  |
| `longo`       | Longo          | `hair-long`                      | hair  |
| `rabo`        | Rabo de cavalo | `hair-ponytail`                  | hair  |
| `coque`       | Coque          | `hair-bun`                       | hair  |
| `black-power` | Black power    | `hair-afro`                      | hair  |
| `trancas`     | Tranças        | `hair-braids`                    | hair  |
| `bone`        | Boné           | `cap`                            | shirt |
- **Meshes.** Each node's origin is the `head` node's origin, so the runtime parents it to `head` with an identity transform and it follows every head animation. White vertex colours with baked AO, multiplied by the tint; flat shading; at most 80 triangles per style. The painted hair slot stays under every style, so no skin shows between mesh and head. Shapes sit outside the head box, never cover the face rect, and end at the shoulders so they never clip the arm swing.
- **Presets.** 6 of the 18 use `curto` and every other style appears exactly twice. Skin tones and styles are not paired by stereotype. At most 2 presets wear leaf or grass greens (ART.md).
- **Runtime.** One shared geometry per style and one material plus tint; changing style swaps the child mesh and never rebuilds the skin texture. Kenney skins always use `curto` (no mesh).

## 5. Version 3: dangling hair parts

`avatar-regions.json` does not change; v3 is about `avatar-hair.glb` and the runtime (P10b).

| Style     | Parent node     | Child node(s)                           | Pivot (head units)     | What swings                            |
| --------- | --------------- | --------------------------------------- | ---------------------- | -------------------------------------- |
| `rabo`    | `hair-ponytail` | `hair-ponytail-tail`                    | `[0, 0.63, -0.5]`      | the three tail segments behind the tie |
| `trancas` | `hair-braids`   | `hair-braids-left`, `hair-braids-right` | `[±0.32, 0.78, -0.22]` | side and back braid of each side       |
| `coque`   | `hair-bun`      | `hair-bun-knot`                         | `[0, 0.9, -0.24]`      | the six-sided knot above the band      |
- Axes: +y up, +z the face, +x the character's left. Left comes before right.
- The six style nodes keep their names and identity transforms. `cap`, `hair-afro` and `hair-long` have no children (the brim is stiff).
- At rest every style is exactly the v2 shape: the split moves triangles and adds none; parent plus children stay within 80 triangles.
- **Source of truth:** `HAIR_DANGLES` in `src/animation/hair-sway.ts`. `node game/scripts/split-hair.mjs` cuts the packed GLB with it (in place by default; a split file is left alone) and `--check` verifies a split file against the original: `cap`, `hair-afro`, `hair-long` and the compressed buffer bit-identical, the same triangles once the children are put back. The packed file is not what `avatar_hair.py` builds today (different triangle counts), so do not rebuild the hair from Blender without redoing the split.
- **Runtime.** `HairAccessories` keeps one accessory mesh on the head (`avatar-hair-accessory`) and up to two `dangles` (`avatar-hair-dangle-0/1`), children at the visible style's pivots, same material and tint, hidden for styles without parts. `apply()` resets their rotation. Each frame, after `applyToRig`, the scene sets every visible dangle to `rotation.set(animator.hair.pitch, 0, animator.hair.roll, 'YXZ')`; `animator.hairStyle` follows the profile. Reduced motion outputs 0, so the parts stay at rest.

## 6. Skin texture and updates

- `createAvatarTexture()` owns one 64×64 canvas and one `CanvasTexture` for the avatar's lifetime: sRGB, `NearestFilter`, no mipmaps, `flipY = false`. Classic choices are composed with `composePixels`; a Kenney skin is drawn into the same canvas. No material swap and no shader recompile per change.
- `SkinUpdates` (latest wins): a new choice aborts the pending one, a generation counter drops stale answers, every decoded `ImageBitmap` is closed even when it resolves after cancel or dispose. Re-applying the same choice neither paints nor uploads; going back to the committed choice cancels a pending one without an upload. `needsUpdate` is set only on commit, never from the render loop.
- A Kenney skin is fetched (from the pack, through the worker) and decoded only when a texture applies it: the player's choice, or the editor's Skins tab thumbnails. The pack still contains all 18 WebP files so they work offline after any deploy.

## 7. Apply flow and the save

- `Root.svelte` holds `avatarProfile` (from the save, or `DEFAULT_AVATAR` under `?golden`). The HUD button "Personalizar personagem" opens the editor and pauses the game (`choosing`).
- `applyAvatar(value)` awaits `Graybox.setAvatarProfile(value)` (the explicit apply point: `appearance.apply`, then `animator.hairStyle`), copies the profile, writes the save and closes. A generation counter stops a pending apply from landing after cancel or exit. `closeChooser()` re-applies the saved profile, which reverts any unapplied state.
- If the save cannot be written the look still changes for this session and the HUD says "A aparência mudou só nesta partida. Não foi possível guardar neste celular."
- **Save (`data/local-save.ts`).** `localStorage['guardioes-secret-trail-save']`, stable across packs, envelope `{ format: 1, avatar, controls, audio, story, guia, checkpoints, … }`. The avatar section is `{ style: 'classic' | 'kenney', kenneySkin: 'a'…'r', colors: { skin, hair, shirt, pants, shoes }, face: 'smile' | 'neutral', hairStyle }`. Every write re-reads first and preserves sections it does not own; a future `format` or corrupt JSON is never overwritten by an old pack. Legacy profiles without shoes get `#4f5c55`, without a face `smile`, without a style `curto`. No name or other personal data is stored, and nothing goes to Supabase.

## 8. The editor (P12, `src/ui/avatar-editor/`)

`AvatarEditor.svelte` replaced `scene/AvatarChooser.svelte` in `Root.svelte`. It is a full-screen dialog with a live 3D preview and 3D thumbnails.

- **Props.** `profile`, `onapply(value): Promise<void>`, `onclose()`; optional `presets` (default `AVATAR_PRESETS`), `skins` (default the keys of `KENNEY_SKINS`), `quality` (else measured on its own context with the game's `pickQuality`), `reducedMotion` (else `prefers-reduced-motion`), `initialTab`; measurement hooks `onready`, `ondispose`, `onstage`.
- **Draft semantics.** The editor edits a copy; the saved profile is never mutated. "Usar este personagem" plays a `cheer` and applies 650 ms later; if `onapply` throws it says "Não foi possível trocar o personagem. Tente novamente." "Cancelar", the X and Escape call `onclose()`, and a pending cheer-apply is dropped. Any classic choice switches back to the classic style; a Kenney skin keeps the classic choices underneath, and a hint says so on the classic tabs.
- **Gold rule.** `ACCENT.gold` never appears among clothes swatches, and the free picker refuses any colour within RGB distance 20 of it (`GOLD_TOLERANCE`) with "O dourado fica reservado aos objetivos da trilha.", reverting the input. Ipê-amarelo `#f2c94c` (distance 30) stays allowed.
- **Tabs.** Prontos, Pele, Rosto, Cabelo (styles, then colours), Roupas (Camiseta, Calça, Sapatos sub-tabs) and Skins (starting with "Clássico"). Rosto and Cabelo frame the head, the rest the whole body; the camera tweens 0.45 s (cut under reduced motion) and each framing is fitted to the canvas aspect.
- **Preview.** The avatar on a forest-floor pedestal (one merged vertex-coloured mesh, `pedestal.ts`) with the game's blob shadow and daylight, no shadow maps. It plays the real `AvatarAnimator` idle, looks at the viewer, waves on every change and sways the v3 dangles. Drag turns it with inertia (`spin.ts`); arrow keys turn it 30° when focused; it is a `role="slider"` with `aria-valuetext` like "De frente, 22 graus".
- **Own WebGL context.** Created on open, `dispose()` then `forceContextLoss()` on close, so at most two contexts exist while the editor is open and one after. The game's canopy shade uniform is neutralised during the editor's draws. Context loss pauses and shows "Recarregando a prévia…"; a second loss within 3 minutes gives up with "A prévia 3D não abriu, mas você ainda pode escolher." and the rest keeps working.
- **Frame loop.** Draws only while visible on screen and the page is visible. Tiers in `STAGE_TIERS`: low caps DPR at 1.5 and about 0.45 MP, runs at 30 FPS, 96² thumbnails and no MSAA; medium and high cap DPR at 2 with 128² thumbnails. Reduced motion freezes the idle and stops drawing 0.4 s after a gesture ends.
- **Thumbnails.** A second, hidden `loadAvatar` poses for them after the first preview frame, renders into an sRGB render target and reads it back into a small canvas. One session LRU of 72 entries (`sessionThumbnails`, about 4.7 MB at 128²); `releaseThumbnails()` frees it and `Root` calls it on destroy. Only the visible tab renders, within `THUMB_BUDGET_MS = 4` per frame with debt carried over. Rabo, tranças and coque thumbnails use a 3/4 back view (`THUMB_BACK_YAW` −135°), chosen from `HAIR_DANGLES`, with their own cache keys.
- **Accessibility.** Roving-tabindex tablist (arrows wrap, Home/End), radiogroups with 2D arrow keys and selection following focus, focus trapped and starting on the selected tab, pt-BR labels on every tile and swatch ("Tom de pele N", "Skin A"…), targets ≥ 44 px, safe-area insets with a 16 px minimum gutter, no horizontal scroll.
- **Gotcha: wheel.** Dialogs must stop wheel propagation (`onwheel={(e) => e.stopPropagation()}` on `AvatarEditor` and `SettingsPanel`); otherwise the camera's wheel listener calls `preventDefault()` and the panel cannot scroll.
- **Gotcha: retained shell.** V8's cached `PointerEvent` hidden class can keep one closed dialog's detached DOM alive through a Svelte delegated-event accessor. It never accumulates and the GPU side is already freed; the editor empties its canvases on unmount so the shell holds no pixels.
- **Sound and controls** moved out of the avatar dialog into `scene/SettingsPanel.svelte` ("Som e controles"), keeping the top bar at seven buttons, which fits 360 px portrait phones.

## 9. Editor numbers (workstation, not a phone)

|                                          | Desktop, high          | Phone-emulated, low, 4× CPU |
| ---------------------------------------- | ---------------------- | --------------------------- |
| Open to first frame, cold                | about 500 ms           | about 370–410 ms            |
| Open to first frame, warm (median)       | about 56 ms            | about 80–130 ms             |
| Thumbnail, mean / max per item           | 2.3 / 4.9 ms           | 3.1 / 12.7 ms               |
| Long tasks while thumbnails render       | 0                      | 0                           |
| Idle preview                             | 9 draws, 472 triangles | DPR 1.5, 30 FPS             |
| Heap after 1 / 10 / 20 open-close cycles | 13.0 / 14.0 / 14.0 MB  | same                        |

Every close reports 0 geometries, 0 textures and 0 programs left, and 0 live contexts after 10 cycles. In the game, tap to first frame was 413–617 ms. Wiring the editor in place of the chooser added about 12 KB gzip to the pack.

## 10. Verification

- **Unit:** `src/avatar/*.test.ts` (atlas bounds and order, real asset, hair, update queue), `data/local-save.test.ts`, `ui/avatar-editor/*.test.ts` (draft and gold rules, swatches, keyboard, framing, spin, thumbnail queue and cache, and the stage through a fake renderer that tracks GPU objects down to 0/0/0).
- **Preview page:** with `pnpm game:dev`, `http://localhost:5196/src/ui/avatar-editor/preview.html?tab=hair&skin=c&preset=5&quality=low&reduced&closed`; `window.__avatarEditor` exposes `open`, `close`, `metrics` and counters. It never ships.
- **`pnpm test:game-pack`:** opens the editor in the built pack, counts 18 presets and one preview canvas, picks "Skin R", applies, checks `__gameDebug().avatarStyle === 'kenney'`, the editor's context released (one left, at most two while open), and that the choice persists offline after updates. See [pack.md](pack.md).
- **`node game/avatar-wiring-acceptance.ts`** (needs `pnpm game:dev`, or `GAME_MEASURE_URL`): picks hair in the editor, applies, checks that the dangle rotation actually applied (`hairAppliedPitch`) equals the animator's, plus P13 postures, gestures and the wheel. `map-measure.ts` also changes hair and checks there is no texture re-upload.
- **Golden:** `node game/golden/avatar-sheet.ts` renders the avatar's contexts and gestures from the real `avatar.glb`. Golden frames hide the editor.

## 11. Open items

- Not measured on an A07 or A57: Mali shader compile, the `readPixels` stall of thumbnails and the memory of two live contexts.
- Without the `quality` prop the editor measures its tier once; it does not follow a later downgrade by the game's DPR governor. Passing Graybox's current tier is optional follow-up.
- `scene/AvatarChooser.svelte` has no importers since the editor was wired; delete it.
- The header of `scripts/assets.mjs` still says the skins are 256×256; the files and the step itself are 128×128.
