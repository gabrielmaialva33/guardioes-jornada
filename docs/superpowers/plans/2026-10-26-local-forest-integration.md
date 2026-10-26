# Local Forest Vegetation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add layered, habitat-aware understorey from the corrected local extraction to the study forest.

**Architecture:** A pure deterministic placement plan consumes the existing world and story clearances. A DEV-gated loader resolves asset metadata from the local catalog, normalizes static models, and builds instanced pools on the existing BlockGrid. The P17 agent owns the dynamic import and loader composition in placements.ts.

**Tech Stack:** Existing TypeScript, Three.js, Vitest and Vite study middleware; no dependencies added.

**Spec:** API and ownership explicitly accepted by the coordinator in this conversation, 2026-10-26. Existing game/ART.md remains the shared art direction; raw and painted study looks both work.

## Global Constraints

- Work in the shared checkout as requested for coordination; own only the new study vegetation modules, their tests and isolated preview. No branch switch, broad commit or edits to peers' files.
- Keep asset paths, sizes, source bounds and detailed inventories in tmp/greenhell-port. Commit only role-based choices and placement/rendering behavior.
- Never import extracted assets statically or ship their bytes in a production build. Caller and loader both preserve the DEV study gate.
- Pure placement plan does not mutate world arrays, collision, seeds, checksums or level data. Keep existing native tree silhouettes.
- Preserve base, river/pool, bridges, trunks, trails, obby pieces, collectibles, planting spots and mission/POI access.
- Culling uses the existing grid; wind uses existing shared uniforms. Quality changes and abort/dispose must release owned resources without affecting baseline placements.

## Review Focus

- A one-point or zero-length trail still reserves its access area.
- Late async decode after cancellation cannot leak a model or register live pools.
- Missing assets produce a partial additive layer, keeping the original world intact.
- A source model with a remote origin, duplicate shadow meshes or invalid bounds cannot create giant scenery.
- Low quality and quality switching must bound visible density and triangles, not merely total placements.

## Task 1: Deterministic layered plan

- [x] Write and run failing placement tests for determinism, no world mutation, habitat/clearance, nested density and bounded counts on synthetic and authored worlds.
- [x] Implement `planStudyVegetation(world, level?)` and shared role/quality settings in `game/src/study/vegetation-plan.ts`. Return placements with role, ground position, uniform size, heading and stable density rank; no asset paths or Three.js.
- [x] Run focused Vitest with two workers inside a memory-capped scope; verify every placement against the independent geometric assertions.

## Task 2: Safe loader and visible preview

- [x] Write and run failing tests for the DEV gate, static-model normalization, caster filtering, partial failures, cancellation ownership and disposal with small synthetic geometry.
- [x] Implement `loadStudyVegetation(host): Promise<StudyVegetation|null>` in `game/src/study/vegetation.ts`. Host: `{grid,quality,world,signal,level?,look?}`. Result: `{object,pools,setQuality,debug,dispose}`; object equals pools.object. Resolve curated roles from the catalog, fetch with bounded concurrency, use source or painted materials, normalize at the base, instance with culling and wind, and free ownership on abort.
- [x] Provide an isolated DEV preview harness under study/ for visual verification without editing the P17-owned runtime hooks.
- [x] Run focused tests, scoped type checks and visual captures of painted/raw looks and lower quality. Record counts and limitations under tmp/greenhell-port.
- [x] Deliver the API and verified module to the P17 agent, review integration changes once available, and verify the actual game route. No push or deployment.

## Execution record

Ruling: Execute in place with strict file ownership because the user requested cooperation with the agents editing this checkout and the coordinator accepted the module handoff. Do not create an isolated worktree that hides the module from that integration.

Delivered: vegetation hook integrated by P17; native Chrome acceptance,26 focused tests,clean scoped lint and production isolation passed. Terrain adapter delivered separately; P17 explicitly retains ground shader integration. See coordinator report p16-estudo-vegetacao.md.
