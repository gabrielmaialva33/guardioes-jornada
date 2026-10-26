# Secret Trail: the pack, the launcher and the loading screen

The game ships as an independent, content-addressed pack that the app's `/secret-trail` route downloads on request, keeps offline and mounts through a small plain-data ABI. The app never bundles the game, and installing the PWA downloads zero bytes of it. This file covers the build, the manifest, the ABI, the launcher's cache and update check, the loading screen and how to verify all of it. It distils the work of P1 (pack and launcher), P1.5/P1.6 (graybox, presentation, debug meter), P11 (loading screen and its wiring) and the launcher update notice of 26/10/2026.

## 1. Shape

- **Two runtimes, no iframe.** The pack carries its own Svelte, three.js and game code (`game/package.json` pins them); nothing is shared with the app's runtime, and no reactive proxy crosses the boundary. The page keeps `X-Frame-Options: DENY`.
- **Optional by construction.** Kit builds first and the pack is built after it, so pack files can never enter the worker's precache or install graph. Home and install never request `/game-packs/*`; acceptance fails if they do.
- **Content-addressed.** Each pack lives at `build/game-packs/<packId>/`, where `packId` is the SHA-256 of the manifest content (ABI, entry and file list with hashes), independent of the app version. `build/game-packs/latest.json` names the current one.
- **Two files from the app side.** `game/abi.ts` and `game/protocol.ts` are imported by the app (`src/lib/data/game-pack*.ts`, the launcher route and the worker), so moving them touches the app too.

## 2. Build

- **Commands.** `pnpm build` runs the Kit build, then `node game/build.ts`, then copies `deploy/_headers`. `pnpm build:game` rebuilds only the pack.
- **`game/vite.config.ts`.** Separate root, `base: './'`, no public dir, `assetsInlineLimit: 0`, one CSS file (`cssCodeSplit: false`). The rolldown input is the loader `src/ui/loading/entry.ts` (P11), emitted as `entry.js`; the game is `chunks/main-*.js` and the shared Svelte runtime plus palette is `chunks/palette-*.js`. A plugin fails the build if any chunk imports a module outside the bundle, and emits `licenses/phosphor.txt` (the HUD icons' MIT notice).
- **Build-time defines.** `__PACK_BUILD__` comes from `GAME_BUILD_TAG` (acceptance uses it to make builds A, B and C differ) and is exported as `buildTag`. `__PACK_SOFTWARE_TEST__` is true when `GAME_ALLOW_SOFTWARE_TEST=1`: it lets a software rasterizer (SwiftShader) pass the quality gate in `main.ts` and enables the test-only flags (`?e2e`, `?golden`) in `scene/testing.ts` and `scene/golden.ts`. Default builds have neither.
- **`game/build.ts`.** Runs the Vite build into `game/.build/`, calls `writePack(.build, build/)`, then copies `build/game-packs/` into `.svelte-kit/output/client/game-packs/`. That last copy exists because `pnpm preview` serves Kit's output folder, not `build/`; it happens after Kit has written the worker and its manifest, so packs still stay out of install.
- **`game/pack-build.ts`.** `makeManifest` sorts the files, records `bytes` and `sha256`, adds `gzipBytes` (gzip level 9) for `js|css|json|svg|wasm|txt|glb`, and tags `.webm`/`.m4a` with their `codec`. `writePack` writes the files, `manifest.json` and `latest.json`, then writes `.gz` and `.br` (Brotli 11) next to every pack text file and every deployed GLB, because Kit's precompress list omits GLB.
- **Serving.** `deploy/nginx.conf` and `deploy/_headers`: `/game-packs/*` is `public, max-age=31536000, immutable`; `/game-packs/latest.json` is `no-cache`. Both keep the security snippet.

## 3. Manifest and protocol (`game/protocol.ts`)

- `GAME_ABI = 1`. A `GameManifest` is `{ packId, abi, entry, files[] }`; a `GameFile` is `{ path, bytes, sha256, gzipBytes?, codec? }`.
- `decodeGameManifest` treats every manifest (disk, HTTP, worker message) as untrusted. It requires the ABI, a 64-hex `packId`, an `entry` ending in `.js` that is in the file list, 1 to 2048 files, at most 64 MiB in total, safe relative paths without `.` or `..`, no duplicates, and never the reserved names `__complete__.json` or `manifest.json`.
- **Audio codecs.** Every sound ships twice, Opus in WebM and AAC in M4A. `chooseAudioCodec(canPlayType)` picks one per device (every `probably` before every `maybe`, Opus before AAC). `requiredFiles(manifest, codec)` is what a device downloads: every untagged file plus its codec's audio. The launcher and the game's audio bank ask the same browser the same question, so they agree. `null` means no audio is downloaded and the game keeps its placeholders; `undefined` is a pack completed before codecs existed and needs every file. Details of the bank are in [audio.md](audio.md).

## 4. ABI (`game/abi.ts`)

```ts
interface GameBridge {
	abi: 1;
	exit(): void;
	earnBadge(): void;
}
type GameDispose = () => void | Promise<void>;
interface GameModule {
	abi: number;
	mountGame(element: HTMLElement, bridge: GameBridge): GameDispose;
}
```

- `mountGame` returns its dispose synchronously; dispose is idempotent and awaitable. A bridge with another ABI throws `game-abi-mismatch`; the launcher throws `game-abi` when the module's `abi` or `mountGame` is wrong.
- `earnBadge()` is the only thing the game can write in the app: the launcher maps it to `secretBadge.earn()` (stored under `guardioes-secret-badge`). It never touches the journey session, points, oath, certificates or sync. Two callers: `StoryGame`'s `badge` hook in `Root.svelte` (the story map) and the `summit` checkpoint of the graybox fixture in `scene/Graybox.svelte` (what acceptance climbs to).
- `exit()` makes the launcher stop and dispose the game.
- `main.ts` adds an optional third argument, `{ loading?: LoadingProgress }`; the loader passes it, older callers can omit it.

## 5. Launcher and cache (app side)

- **Discovery.** The trail is hidden in the app's diorama (long press, five taps or the Konami code; `tests/secret-trail.test.ts`); `SecretTrailSheet.svelte` only navigates to `/secret-trail`. The launcher calls `getGamePackInfo(root, signal)` on mount when no pack is saved: with a saved pack it would answer `complete: true` without any request; otherwise it reads `latest.json` and returns the missing transfer for this device's codec (`missingBytes`, `sizeKB` rounded up). Without a manifest or network the sizes are `null`; never print `null` in the text. Never call it from the home page.
- **Route `src/routes/secret-trail/+page.svelte`.** States `checking → ready → downloading → mounting → playing`, plus `error` and `unsupported` (no `WebGL2RenderingContext`, or the game reports `game-webgl-unavailable`). Error text distinguishes offline, quota full and anything else.
- **Entering.** `enter()` calls `beginGamePresentation(launcherRoot)` synchronously in the tap handler, before any await, because fullscreen needs the user gesture (`src/lib/data/game-presentation.ts`). It then tries `screen.orientation.lock('landscape')`; failure never blocks play, and release exits only the fullscreen it acquired. The web manifest stays `orientation: portrait`.
- **Mounting.** `start()` waits for `acquireGameGpu()` (`src/lib/diorama/host.svelte.ts`), which cancels pending diorama work and waits out its 1.5 s release so only one WebGL context is alive. It then loads the pack CSS by URL, imports the entry by its versioned URL (`/* @vite-ignore */`), checks the module and mounts it. On stop it disposes the game, removes the CSS links, releases the GPU lease and the presentation.
- **`GamePacks` (`src/lib/data/game-pack.ts`).** `current()` reads the active pointer without the network and falls back to the previous complete pack if the active one is damaged. `latest(signal)` reads only `latest.json` (512 KiB cap). `newer(saved)` is the update check (§6). `download(manifest, { signal, progress })` streams each required file with a size cap and a 60 s timeout, checks its size and SHA-256, writes to a staging cache, copies into the pack cache, writes the completion marker and only then publishes. Publication is serialised across tabs with the Web Lock `game-download:<base path>`.
- **Storage layout (`game-pack-cache.ts`).** Cache names are `guardioes-game:<encoded base path>:<packId>`, outside the app's version prefix, so app updates never evict them. The marker `game-packs/<packId>/__complete__.json` holds the manifest plus the `audioCodec` downloaded. The pointer `game-packs/__active__` in the `…:registry` cache holds `{ active, previous }` and is written with one `Cache.put`. Staging (`…:staging:<uuid>`) is deleted in `finally`; an orphan from a killed tab is never marked complete or served.
- **Retention.** Complete packs are kept for old open clients and offline rollback; nothing deletes them automatically yet. Failure, cancel, corruption or a full quota leave the active pack untouched.
- **Service worker.** Requests under `game-packs/` go to `matchGamePack`, which serves only files listed in a complete pack's marker, cache-first, even after the server stopped publishing that pack; anything else falls through to the network.

## 6. Update notice (26/10/2026)

- `GamePacks.newer(saved)` reads only `latest.json` and returns `null` when its `packId` equals the saved one, otherwise `{ manifest, bytes }` with the transfer for this device's codec (`gzipBytes` where present). Checking never replaces the saved pack.
- The launcher runs the check once per visit when a pack is saved, the app is online and the state is `ready`. When a newer pack exists it shows "Tem uma versão nova da trilha (cerca de N MB). A versão guardada continua funcionando sem internet." and styles "Baixar versão mais recente" as a pill. When the saved pack is the latest, that button is hidden (it stays for `error`). If the check fails it keeps `unknown` and the button stays as a fallback.
- `game/acceptance.ts` asserts the notice appears after B and C are published, and that after install the only request under `/game-packs/` was `latest.json`.

## 7. Loading screen (P11, `src/ui/loading/`)

- **Why a loader.** The host imports `entry.js` and calls `mountGame`; with one bundle nothing could paint before about 390 KB gz of JS was parsed. `entry.ts` holds only the screen: `mountGame` starts `import('../../main.ts')`, mounts `LoadingScreen` with `flushSync` and returns dispose synchronously. When the chunk arrives it calls the game's `mountGame(element, bridge, { loading })`; the game mounts under the screen (z-index 60 over 50) and the same screen fades out once the world calls `ready()`. If the module lacks `reportsLoading === true` the loader calls `ready()` itself as soon as the game mounts.
- **First paint.** `entry.js` about 5.7 KB gz plus the shared chunk (about 17 KB gz) and the CSS; measured 46 ms to the first frame in Chrome. A test keeps the screen's sources under 15 KB gz.
- **Model (`loading.ts`, pure, injected clock).** `track(id, promise, weight)`, `reserve(id, weight)`, `ready()`, `fail(error)`, `retry()` with `onretry`. The fraction is finished weight plus a creep for running tasks (60 % of a task's weight, τ 3 s), capped at 0.95 until `ready()`. A critically damped spring (ω 5, then 14 once ready) drives it and it never moves backwards, even when a late task grows the total. Minimum visible time 700 ms, fade 400 ms, then `done` and unmount.
- **Stages and weights.** The label is the first unfinished stage: `code` (loader) → `placements` 3 → `life` 2 → `sound` 1 → `avatar` 1 → `story` 2 → `compile` 2 (reserved, then the `compileAsync` promise). `scene/Graybox.svelte` tracks its five loads by index in that table and calls `ready()` next to `ready = true`, `fail(error)` in its catch.
- **Errors.** A rejected task (aborts are ignored: that is teardown) switches to `error`. `game-webgl-unavailable` is kind `unsupported` ("Voltar" calls `bridge.exit()`); anything else offers "Tentar de novo" (dispose and remount, the bar keeps its place) and "Sair". A late rejection from an abandoned attempt cannot fail the new one.
- **Screen.** Inline SVG coloured only from `style/palette.ts`; the mico walks the trail as the bar (`role="progressbar"`, `aria-valuetext` like "Plantando as árvores (40%)"); the error card is `role="alert"`. Fonts come from the host page; the pack fetches nothing. Reduced motion stops every animation except the bar itself. 16 px gutter or the safe-area inset, whichever is larger.
- **Goldens.** With `?golden` the loader mounts no screen.
- **"Você sabia?"** `facts.ts` holds 10 facts, one per 6 s, starting at a random one. Their sources are in §8.

## 8. Sources of the loading facts

| #   | About             | Source                                                                                                                                                          |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | muriqui           | ICMBio, _Plano de Ação Nacional para a Conservação dos Muriquis_; IUCN Red List, _Brachyteles_ spp.                                                             |
| 2   | mico-leão-dourado | Associação Mico-Leão-Dourado (about 200 in the early 1970s; 2023 census about 4 800); Kleiman et al., _Conservation program for the golden lion tamarin_ (1986) |
| 3   | bugio             | Smithsonian's National Zoo, _Howler monkey_; Wikipedia, _Alouatta guariba_                                                                                      |
| 4   | onça-pintada      | Smithsonian's National Zoo, _Jaguar_; IUCN Red List, _Panthera onca_                                                                                            |
| 5   | tucano            | Tattersall, Andrade & Abe, _Science_ 325:468 (2009), the toucan bill as a thermal radiator                                                                      |
| 6   | preguiça          | Pauli et al., _Proc. R. Soc. B_ 281 (2014), weekly descent to defecate                                                                                          |
| 7   | jequitibá-rosa    | Lorenzi, _Árvores Brasileiras_ vol. 1 (_Cariniana legalis_, 30–50 m)                                                                                            |
| 8   | pau-brasil        | Bueno (org.), _Pau-brasil_ (Axis Mundi, 2002); Wikipedia, _Paubrasilia echinata_                                                                                |
| 9   | palmeira-juçara   | Reis et al., _Biotropica_ 32 (2000); Galetti et al., _Science_ 340 (2013)                                                                                       |
| 10  | gralha-azul       | Embrapa Florestas, _Araucária_; Wikipedia, _Cyanocorax caeruleus_                                                                                               |

Two facts were softened on purpose: the jaguar "nada muito bem" and the bugio heard "a quilômetros". The sources policy for every in-game fact is in [content.md](content.md).

## 9. Inside the game: `main.ts`

- `mountGame` appends its own root, mounts `Root.svelte` with `createRenderer` and the optional `loading`, and returns an idempotent async dispose that aborts listeners, releases pointer lock, stops the loop, unmounts and then disposes the renderer with `forceContextLoss()`.
- `createRenderer` builds a `WebGLRenderer` (`antialias: false`, `alpha`, `powerPreference: 'low-power'`, `preserveDrawingBuffer` only for goldens), then runs `pickQuality(readCapabilities(...), { mobileMedium: false })`. A device that cannot render throws `game-webgl-unavailable` unless `__PACK_SOFTWARE_TEST__`.
- The animation loop is wrapped so it stops while the page is hidden and on `pagehide`, and resumes on `pageshow`.
- What happens after mount (world choice, loads, frame loop) is in the [README](../README.md).

## 10. Debug meter (`?debug`)

- With `?debug`, `scene/Graybox.svelte` sets `globalThis.__gameDebug = readDebug` and deletes it on dispose. The shape is `GameDebug` in `scene/types.ts`: `fps`, `frameP95Ms`, `drawCalls`, `triangles`, `dpr`, `quality`, `geometries`, `textures`, `programs`, `heapMB?`, `ready`, position, `grounded`, `checkpoint`, `animation`, plus the avatar, life, audio and story fields added since.
- **Contract (P1.5).** `render/budget.ts` turns `renderer.info.autoReset` off and resets once per frame, so draws and triangles include every pass of the frame (shadows, post). Any new pass must run before the stats stage. FPS and p95 use a 120-frame window; pauses are excluded. `heapMB` appears only where the browser exposes it. The snapshot exposes no three.js objects, stores or mutators.
- Consumers: Playwright e2e, `acceptance.ts`, `map-measure.ts`, `controls-acceptance.ts`, `avatar-wiring-acceptance.ts` and the golden runner.

## 11. Development

- **Game alone:** `pnpm game:dev` serves `game/index.html` on port 5196 (`--host 0.0.0.0 --strictPort`). `src/dev.ts` mounts the real loader `ui/loading/entry.ts` with a fake bridge (the badge goes to `localStorage['secret-trail-dev-badge']`, exit shows an "Entrar na trilha" button). Over USB: `adb reverse tcp:5196 tcp:5196`, then `http://localhost:5196/?debug` on the phone. This path does not exercise the launcher, download or cache.
- **App with a built pack:** `pnpm dev` (port 5180) serves the last `build/game-packs` through `gamePacksDev()` (`game/dev-pack.ts`): raw bytes, never transformed by Vite, GET/HEAD only, no traversal or symlink escape, `no-store`; a missing `latest.json` answers 204 so the app opens before the first game build.
- `index.html`, `dev.ts` and the avatar-editor preview page never ship: the only build input is the loader.

## 12. Verification

- **Unit:** `pack-build.test.ts`, `abi.test.ts`, `dev-pack.test.ts` (game root), `src/lib/data/game-pack.test.ts`, `game-presentation.test.ts`, `ui/loading/*.test.ts`.
- **`pnpm test:game-pack`** (`node game/acceptance.ts`) builds three snapshot packs A, B and C with `GAME_BUILD_TAG=<label>` and `GAME_ALLOW_SOFTWARE_TEST=1`, serves them on its own HTTP server (port `GAME_ACCEPTANCE_PORT`, default 4190) and drives Chrome over CDP (`GAME_ACCEPTANCE_CDP_PORT`, default 9238; `PLAYWRIGHT_CHANNEL`, `GAME_TEST_ANGLE=gl` for the real GPU). It checks: zero pack bytes at install and home; download and the graybox obby to the summit and badge; the avatar editor (18 presets, one preview canvas, its context released on close); 20 enter/exit cycles with listeners, rAF and contexts back to baseline and at most one live context; the update notice; A still opening offline with app C, page and worker cut with CDP and HTTP cache off; atomic switch to C only after it completes; C offline after reload; the default story world offline with every life animal; 20 story/life cycles; one codec of audio only; no page or worker errors. It writes `acceptance.json` to `GAME_ACCEPTANCE_DIR`, then rebuilds the default pack.
- **Gotcha:** acceptance rewrites `build/` four times. Do not run `pnpm test:e2e` or `pnpm preview` against `build/` at the same time; one P12 run died with `ENOENT` on `latest.json` that way.
- **Gotcha:** Chrome checks `/service-worker.js` on its own timer; the offline assertions ignore only that request.
- **Gotcha:** with CDP offline emulation Chromium may still report `navigator.onLine === true`; the offline proof is the request log, not the UI state.
- **e2e:** `pnpm test:e2e` runs `tests/secret-trail.test.ts` (discovery, badge) and `tests/story-missions.test.ts` against the production build.
- **Loading screen:** `node game/golden/loading-sheet.ts` renders the real component at 0/40/90 % on portrait, landscape and desktop, the error and unsupported states and reduced motion, and writes `checks.json` (no horizontal scroll, gutters, monotone `aria-valuenow`, still frames under reduced motion).

## 13. Sizes over time

| Build                         | Files                    | Raw               | Transfer                                               |
| ----------------------------- | ------------------------ | ----------------- | ------------------------------------------------------ |
| P1 placeholder                | 2                        | 793 KB            | 205 KB gzip                                            |
| P1.5 graybox                  | 4                        | 977 KB            | 266 KB gzip                                            |
| Avatar customisation          | 28                       | 1.11 MB           | 343 KB gzip                                            |
| P11 split, before → after     | 210 → 212                | 2.63 MB → 2.64 MB | first paint 392 → 27.7 KB gz                           |
| Local build, 26/10/2026 04:30 | 257 (58 per audio codec) | 4.89 MB           | about 2.3 MB for a WebM device; `main` chunk 417 KB gz |

The app's diorama, not the pack, is what install costs; the pack is downloaded only after the player asks.

## 14. Open items

- Fullscreen and landscape lock/restore have not been checked on an installed Android PWA; desktop Chrome rejects the lock with `NotSupportedError` and the fallback is playable.
- No physical A07/A57 run of the download, the loading screen or two live contexts (game plus editor); all numbers above come from the workstation.
- Old complete packs are never evicted; a "free old versions" action may be needed.
- The host card still says "Abrindo a clareira…" for the few milliseconds before `entry.js` runs.
- The `deploy/nginx.conf` comment on `latest.json` ("only after explicit download consent") predates the size estimate and the update check, which both read it without a tap.
