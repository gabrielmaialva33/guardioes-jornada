# Guia da Mata v1 — integration contract (P24 / p2)

The preview is `/src/ui/guia/preview.html` on the game dev server. The runtime is independent of `Root.svelte`, scene wiring and `data/local-save.ts`.

## Construct once per device save

```ts
import { GuideService, IndexedDbThumbnails, SpeciesRegistry, SPECIES } from './guia/index.ts';
import { GuideMechanicsBridge } from './mechanics/guide-bridge.ts';

const photos = new IndexedDbThumbnails();
const guide = await GuideService.open(new SpeciesRegistry(SPECIES), saveAdapter, photos);
const bridge = new GuideMechanicsBridge(guide);
```

`saveAdapter: GuideSaveAdapter` has `read(): Promise<unknown>` and `write(document: GuideDocument): Promise<boolean>`. It owns only the proposed `gameSave.guia` field. Read returns the raw field; write merges the supplied field into the **latest** main save through the host's existing writer, preserving unrelated fields and returning false on failure. Do not capture an old whole-save snapshot in this adapter. There is no new main-save writer in this package.

## Save migration proposal (not applied)

Add an optional `guia` section to the host save schema, without changing existing progress or player fields:

```json
{
	"guia": {
		"version": 1,
		"discoveries": { "mico-leao-dourado": { "firstSeen": 1792972800000, "origins": ["photo"] } }
	}
}
```

An absent section means an empty guide. The section owns its version independently of the outer save version. `decodeGuide` validates before reading; unknown species and extra document/record fields survive the next snapshot, aliases become canonical, duplicate aliases merge origins and earliest timestamp. Invalid data, newer section versions, and read failures remain untouched: `GuideService.writable` becomes false, discoveries continue in memory, and the panel explains the save problem. Reopen the service after the host resolves that condition. `retry()` retries normal write/quota failures. Keep the host's established quarantine/recovery behavior; never replace an invalid main save with defaults.

Existing completed missions may be backfilled via `guide.record(canonicalSpeciesIds, 'mission', undefined, timestamp)` only when the mission-to-species mapping is known. Do not infer sightings from unlocked zones. Repeated discoveries are idempotent. The registry currently contains **23** species, so the preview is **12/23**, not a hardcoded 12/32; adding approved records automatically changes the denominator. Game scheduling/rarity metadata is separate from conservation status.

## Connect event boundaries, not the render loop

- After `PhotoCamera.action()` saves a new revision, call `await bridge.photoSaved(cameraState, {source: renderer.domElement, width: renderer.domElement.width, height: renderer.domElement.height})` immediately after the matching render. The pure PhotoCamera carries subject ids/revision, not pixels; this explicit frame argument supplies the actual player's view. The default encoder copies synchronously before its first await, before the WebGL drawing buffer is cleared. No `preserveDrawingBuffer` requirement for the production renderer. One frame may discover several species; all receive the same thumbnail. The bridge deduplicates revisions.
- Call `await guide.record(speciesIds, 'mission')` on successful mission completion.
- Notify existing traps of completed mission ids using their P19 API. They stay pending until another mission completes. On the contextual collect action use `await bridge.collectTrap(trap, optionalTrapFrame)`. It consumes a ready trap once, discovers its species with origin `trap`, and leaves a ready trap with an unknown species unconsumed. A trap frame is optional: discovery still works without a thumbnail. Render the trap's own view if providing an image; do not use an unrelated current player frame.
- `bridge.photoIssue` signals image encoding failure; discovery still succeeds. Surface a short photo-save message using the host's existing feedback when true. `guide.issue` reports metadata/thumbnail persistence problems and the panel includes a retry control.

Ids include canonical pt-BR slugs and aliases for P19 (`mico`, `saira`, `tucano`, `bugio`, `onca`, `preguica`) and incoming fauna ids. Check `registry.find(id)` before linking newly authored mission data.

## Panel and input ownership

Mount `GuidePanel.svelte` with `{ service: guide, onclose, initialEntry?: string, reducedMotion?: boolean }` from the host's Guia HUD action. `onclose` must actually unmount the panel. Native modal focus containment, Escape, focus restoration, labeled filters and >=44px controls are included. The panel stops bubbled key/pointer-down input. **The host must also pause/suspend gameplay input and clear the virtual stick while it is open**, because document capture listeners and a previously held stick can otherwise continue moving the player. Resume and clear held input on close. Do not add a second game loop.

The panel reads existing `--font-ui` / `--font-story` tokens, with local paper/forest fallbacks. It has no external assets or network dependency. Fonts in the preview are bundled. Phone portrait uses collection/detail pages; landscape and desktop have two independently scrollable pages. Reduced motion works via media query and explicit game setting. The preview's storage namespace is isolated from the actual game save.

## Thumbnail storage / lifecycle

Default DB `guardioes-guia-thumbnails`, schema v1, `photos` store, key `speciesId`. One binary Blob replaces the prior thumbnail atomically. No base64 or pixels in localStorage/gameSave. JPEG encoder: longest edge <=256px, quality fallback until <=60 KiB. JPEG/PNG/WebP only, nonempty, <=60 KiB accepted by the adapter; own UTF-8 record metadata plus image must fit <=64 KiB. Browser-internal IndexedDB accounting overhead is implementation-specific. No automatic deletion of unreadable existing records. Quota/unavailable IDB errors keep discoveries and a session thumbnail; retry persists them later. Panel object URLs are revoked when selection changes or the panel unmounts. Call `photos.close()` when disposing the host service.

PWA asset precaching remains the host's responsibility. The preview verifies loaded-page operation with the network disabled and persistence on normal reload; it does not install a separate service worker.

## Content gate

All biological prose is centralized in `species.ts`; each field carries `source`. `TODO-SOURCE` means editorial review is still required. `reviewNote` records taxonomy ambiguity. Do not treat game rarity as conservation status, or global IUCN status as a Brazilian red-list status. In particular, green turtle global status is LC on the IUCN Marine Turtle Specialist Group's 2025 summary; older global EN pages must not overwrite this without checking scope/date. Coordinator approval of facts remains necessary before release.
