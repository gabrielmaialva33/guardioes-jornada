# Guardiões da Mata Atlântica: guided journey

Offline-first PWA for a journey through the Atlantic Forest (Mata Atlântica): the
call to adventure comes first, then the participant gives a name and picks a group,
then five missions, group points, the final oath and a printable certificate. It
works for one person, a family or a class led by a guide; nothing asks for a school.

## Commands

```sh
pnpm dev          # http://localhost:5180
pnpm check        # svelte-kit sync + svelte-check (app and service worker)
pnpm build        # static site in build/
pnpm preview      # http://localhost:4180, test offline here (service worker is production-only)
pnpm db:new name  # new Supabase migration
pnpm db:push      # apply migrations to the linked project (supabase login + link first)
pnpm db:types     # regenerate src/lib/supabase/database.types.ts
pnpm db:lint      # Supabase security/performance advisors
pnpm db:config    # push auth/SMTP config (reads supabase/.env, git-ignored)
pnpm test         # unit tests (Vitest, fake IndexedDB)
pnpm test:e2e     # Playwright against the production build, incl. airplane mode
pnpm icons        # regenerate the icon set
```

## Stack and the 2026 conventions that differ from older docs

SvelteKit 3.1, Svelte 5.57 (runes only), Vite 8, TypeScript 6, adapter-static 4.

- There is no `svelte.config.js`: Kit options live in `sveltekit({...})` in `vite.config.ts`.
- `$lib` is gone. Import with `#lib/...` (package.json `imports`) and explicit extensions:
  `#lib/session.ts`, `#lib/state/sessions.svelte.ts`, `#lib/components/Icon.svelte`.
- `$app/stores` is gone: use `page` from `$app/state`. `$app/environment` is now `$app/env`.
- `$env/*` is deprecated: environment variables are declared in `src/env.ts` with
  `defineEnvVars` and imported from `$app/env/public`.
- `$app/paths` exports `resolve`/`asset`, no `base`. Routes are typed:
  `resolve(`/journey?id=${id}`)`.
- The service worker lives in `src/service-worker/` (own tsconfig) and uses
  `$app/manifest`, `$app/env` and `$app/service-worker`.
- tsconfig extends `$app/tsconfig`; TS 6 needs explicit `types`.

## Architecture

- `src/lib/content/`: the journey script as data (`mata-atlantica.ts`). Story, mission
  text, groups and tree facts belong to the content owner; change wording there, not in
  components. The journey id stays `'penap'` because stored sessions and cloud rows
  reference it; it is never shown. Every botanical statement needs a source in `TreeInfo`.
- `src/lib/session.ts`: pure domain logic (progress, levels, achievements, scores).
- `src/lib/data/`: IndexedDB repository (one record per session with its outbox state),
  valibot schemas for everything read from disk or the cloud, service worker cache helpers.
- `src/lib/state/*.svelte.ts`: rune-based stores.
  - `sessions`: the phone is the source of truth. Each mutation bumps a monotonic `rev`,
    is journaled synchronously (write-ahead, survives the app being killed) and then
    written to IndexedDB. One window is the writer (Web Locks, BroadcastChannel fallback);
    others are read-only. Invalid or unknown documents are quarantined, never deleted.
  - `sync`: optional Supabase backup through a persistent outbox (`rev > ackedRev`,
    tombstones kept until confirmed). Pushes go through the `push_journey_session` /
    `delete_journey_session` RPCs with compare-and-swap on `rev` and an idempotent
    mutation id; a conflict keeps the server copy and saves ours as a duplicate.
    Retries back off up to 60 s; every request has a timeout.
  - `auth`: guide sign-in with a 6-digit email code (links open outside the PWA).
    Sessions belong to the signed-in guide; guest sessions are only imported on request.
  - `preferences`, `pwa`: per-device settings, offline readiness, updates, install.
- `src/lib/diorama/`: the 3D forest (three.js, WebGL2), lazy-loaded over an SVG of the same
  scene; quality tiers `svg`/`lite`/`full`, renders only while something animates, one
  WebGL context per page.
- Scores are an append-only list of events; a group's score is their sum, undo pops the last one.
- Photos stay on the device (separate IndexedDB store), downscaled before saving.
- Icons: Phosphor (MIT) compiled by `scripts/icons.ts` into `src/lib/icons.generated.ts`.

## Rules

- Code and comments in English; everything the user sees in Brazilian Portuguese.
- Must keep working in airplane mode. Never require the network to advance a journey.
- Personal data is limited to the participant's name (shown on the certificate, never on
  `/verify`). School and class are optional legacy fields: never require them. Groups are
  named after trees; photos are of nature. No user-facing text may assume students or PENAP.
- Never use `alert`/`confirm`/`prompt`; use `Sheet.svelte`.
- Design tokens live in `src/app.css` (Mata dark default, Sol light). Big touch targets (`--tap`),
  visible focus, respect `prefers-reduced-motion`.
- Supabase: RLS on every table, `(select auth.uid())` in policies, `search_path = ''`
  on functions, only the publishable key in the app. See `.agents/skills/supabase`.
- Never put secrets in the repo. `.env` holds only public values and is git-ignored.
