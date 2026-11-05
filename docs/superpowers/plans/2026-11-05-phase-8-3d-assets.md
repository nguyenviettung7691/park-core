# Phase 8 Original 3D Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver original recognizable vehicle/environment artwork, visible lesson obstacles, licensed editable sources, verified budgets, an illustrated catalog, refreshed README pictures and a PR.

**Architecture:** Extend the existing deterministic unlit GLB pipeline with shaped, vertex-colored geometry. Separate MIT generator mechanics from CC BY-NC creative definitions; retain runtime asset contracts. Reuse simplified exterior meshes for stationary lesson cars and keep evidence tooling in browser test fixtures, not a public gallery.

**Tech Stack:** Strict TypeScript, Node ESM generators, Three.js, Cannon-es, Vite, Vitest and Playwright; existing dependencies only.

**Spec:** `docs\superpowers\specs\2026-11-05-phase-8-3d-assets-design.md` (owner approved 2026-11-05).

## Global Constraints

- At most 10,000 triangles per interactive vehicle, including cockpit.
- At most 30,000 triangles per environment.
- At most 4,000 triangles per stationary lesson vehicle.
- At most 100 draw calls for one ordinary vehicle/environment scene render; at most 140 with the existing lesson obstacle cars and guidance.
- At most 5 MB of uncompressed selected vehicle/environment GLBs, including any shared asset payload needed for the selected scene. Use 5,000,000 bytes for the gate.
- No image textures and no external GLB resources.
- Keep meters, +Y up, -Z forward, center-of-mass vehicle roots and identity export transforms.
- Preserve actual body sizes: sedan 1.8 x 1.45 x 4.6 m and CUV 1.8 x 1.62 x 4.35 m.
- Do not change physics, collision dimensions, lesson routes/tolerances, progression, camera controls or the existing 15 FPS mirror cap.
- Keep Vietnamese learner-facing signage and English technical documentation.
- Apply CC BY-NC 4.0 to new GLBs, creative source geometry/palette definitions and artwork-focused images. Application and functional tooling code remain MIT.
- No dynamic shadows, lighting cycles, custom shaders, downloaded artwork or new runtime dependencies.
- 2560 x 1440 at 60 Hz remains the target: p95 <=17.5 ms, mean >=57 FPS and zero loss under the existing benchmark definition. Do not equate automation with reference-hardware validation.
- Use Windows paths and PowerShell commands. Every commit ends with `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- Preserve unrelated untracked README design/plan documents. Do not merge the eventual PR.

## Review Focus

- Driver camera inside the new shell: forward/side apertures must stay open rather than intersecting an opaque Body box; Task 2 adds loaded-mesh ray tests.
- Tall CUV near a garage ceiling: overhead exclusion must include new pipes/fixtures, while driver/chase views retain them; Task 3 adds layer tests and Task 5 renders both views.
- A narrow or rotated parked-car collider: visible car bounds must follow the collider without changing physics or sharing mutable driving-wheel transforms; Task 4 tests rotated/narrow cases.
- Retry/dispose with cloned parked cars: releasing lesson visuals must not dispose live selected-vehicle resources or leak cloned resources; Task 4 checks ownership and Task 5 retains repeated-session checks.
- Multiple render passes on an auxiliary-update frame: main-pass limits must not hide full-frame costs or reset counters midway through reporting; Task 5 records and asserts each pass separately.

---

## File Map and Interfaces

| File | Responsibility |
|---|---|
| `tools\generate-assets.mjs` | Existing CLI, profile metadata and GLB container writer; delegate creative definitions |
| `tools\asset-geometry.mjs` | MIT raw geometry construction, transforms and merging |
| `tools\asset-designs\vehicles.mjs` | CC BY-NC original vehicle geometry/palettes, named export nodes |
| `tools\asset-designs\environments.mjs` | CC BY-NC original roadside/garage definitions |
| `tools\asset-designs\LICENSE` | License and provenance boundary for creative source definitions |
| `public\assets\LICENSE` | CC BY-NC notice/attribution for newly generated GLBs |
| `public\assets\vehicles\*.glb`, `public\assets\environments\*.glb` | Deterministic generated artwork |
| `src\world\generate-assets.test.mjs`, `src\world\assets.test.mjs` | Determinism, budgets, loaded geometry/anchor regressions |
| `src\render\parked-vehicle.ts`, `src\render\parked-vehicle.test.ts` | Owned, simplified stationary exterior clones fitted to collider metadata |
| `src\render\lesson-scene.ts`, `src\render\lesson-scene.test.ts` | Attach parked cars and own their lifetime; preserve overlays |
| `src\render\preview.ts`, `src\render\preview.test.ts` | Pass the loaded vehicle template into lesson construction |
| `tests\browser\fixtures\phase-8.html`, `tests\browser\fixtures\phase-8.ts` | Test-only asset views, pass metrics and capture controls |
| `tests\browser\phase-8-assets.spec.ts` | Real WebGL checks and catalog screenshot artifacts |
| `README.md`, `LICENSE`, `docs\asset-pipeline.md` | Accurate licensing, current assets, usage and screenshots |
| `docs\phase-8-asset-catalog.md`, `docs\images\phase-8\*` | Rendered asset inventory, images, measurements and image license |
| `docs\implementation-plan.md`, `docs\tech-design.md` | Narrow updates to obsolete current-art statements |

Preserve `buildGlb(assetId): Uint8Array` and `writeAssets(outputRoot): void`.
Keep geometry data as `{ positions: number[], normals: number[], colors: number[], indices: number[] }`.
Document that shape with JSDoc in the generator helpers; do not introduce a runtime schema system.

The generator supplies creative modules a small writer object:
`{ root, addNode, addMesh, box }`, retaining the existing writer signatures.
`authorVehicle(writer, assetId, profile): void` accepts `sedan | cuv` and
the current numeric profile object. `authorEnvironment(writer, assetId): void`
accepts `roadside | garage`. Creative palettes live with those definitions.
Generic helpers have no artistic presets.

## Task 1: Reproducible Art Pipeline and License Boundary

**Files:** Generator, new geometry helper and creative-definition modules, both asset license notices, root `LICENSE`, generator tests.

**Interfaces:** Consume existing `buildGlb`/`writeAssets` and nested writer signatures; produce the writer and authoring interfaces above. Preserve the four existing asset URLs.

- [ ] **Step 1: Add failing generator budget regressions** in `src\world\generate-assets.test.mjs`.

  Retain deterministic double-generation/container assertions. Replace the old
  50k/150k ceilings with 10k/30k; add every selected-pair byte sum <=5,000,000,
  no images/external buffers, and embedded `asset.extras` artwork attribution
  identifying `CC-BY-NC-4.0`. The missing attribution is the initial red test;
  do not rely on tighter limits failing the small old placeholders.

- [ ] **Step 2: Run** `npx vitest run src\world\generate-assets.test.mjs`; confirm missing artwork attribution fails, not an unrelated import error.
- [ ] **Step 3: Extract functional geometry helpers and creative definitions** behind the exact interfaces above. Keep the GLB writer and CLI deterministic; preserve old geometry initially. Add attribution/license metadata to GLBs and clearly scoped notices to source/output folders. Use the canonical CC BY-NC 4.0 license reference and attribution to Park-Core contributors; root MIT scope explicitly excludes these newly licensed paths and images without rewriting historical grants.
- [ ] **Step 4: Regenerate and verify** with `node tools\generate-assets.mjs` and `npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs`. Expect all tests passing and regenerated files byte-stable on a second invocation.
- [ ] **Step 5: Commit only Task 1 files**, message `build: establish original artwork pipeline and licensing`, with the required trailer.

## Task 2: Distinct Vehicles and Open Cockpit Sightlines

**Files:** Vehicle creative definitions, generic geometry helper, both vehicle GLBs, generator/asset-loader tests. Change loader validation only if necessary to retain equivalent shaped-shell guarantees.

**Interfaces:** Consume `authorVehicle` writer API. Produce named `Body`, `Hood`, `Cabin`, `Windshield`, `RearWindow`, all existing required wheel/eye/mirror/cockpit nodes, and an `Exterior` grouping for stationary-car reuse.

`Body` remains a Mesh with the existing validated overall bounds, not an
invisible or opaque full-volume box. `Exterior` contains shell, exterior trim,
lamps and housings, but no seats/dashboard/steering-wheel or mirror surfaces;
the four animated wheel roots remain independently accessible. Existing named
cockpit nodes remain rendered and bounded. Empty window apertures may use
thin perimeter meshes for the retained Windshield/RearWindow names.

- [ ] **Step 1: Add focused failing loaded-vehicle tests** to `src\world\assets.test.mjs`, using actual generated GLBs and the existing mocked-fetch helper.

  For each profile, raycast against the vehicle only from `driverEyeLocalM`
  in directions `[0,0,-1]` and normalized `[+/-0.35,0,-1]`; expect no hit
  within 0.1–3 m. Assert the named `Exterior` exists. Preserve all existing
  dimension/anchor/cockpit-containment mutation tests. Add a shell test that
  the roof reaches the exact profile height and hood remains below eye height.
  The old full-volume body/absent Exterior must fail.

- [ ] **Step 2: Run** `npx vitest run src\world\assets.test.mjs src\world\generate-assets.test.mjs`; confirm the new sightline/Exterior regressions fail.
- [ ] **Step 3: Implement shaped original vehicle art** in `authorVehicle`.

  Build rounded hood/nose surfaces, wheel-arch openings, doors, roof and
  window pillars rather than decorating a solid box. Sedan: low amethyst
  three-box body and separate angular trunk. CUV: ivory/charcoal, higher
  upright cabin, roof rails, cladding and rear hatch. Include lamp clusters,
  handles, simple alloy rims, dashboard, seats, steering wheel hub/spokes,
  floor and roof interior. Use economical fixed shading and merge static
  compatible pieces. Keep exterior plus wheels <=4,000 triangles so Task 4
  can reuse it, and full vehicles <=10,000. Preserve all profile/anchor values.

- [ ] **Step 4: Regenerate and verify** with `node tools\generate-assets.mjs`, `npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs src\render\asset-scene.test.ts src\views\views.test.ts`, and `npm run typecheck`. Expect passing tests and no type errors.
- [ ] **Step 5: Commit**, message `feat: add distinct original sedan and CUV artwork`, with the required trailer.

## Task 3: Coherent Roadside and Garage Art

**Files:** Environment creative definitions, environment GLBs, generator/asset-loader tests, `src\render\asset-scene.ts` and its tests only for generic marking visibility if needed by Task 4.

**Interfaces:** Consume `authorEnvironment` and existing collider coordinates. Produce existing Ground/ParkingMarkings/WallsAndCurbs/Pillars/Ceiling contracts, with all overhead pipes and fixtures descendants of Ceiling.

- [ ] **Step 1: Add failing regressions** in generator/loaded-asset tests.

  Assert named `RoadSurfaceDetails`, `FenceDetails`, `GarageWallDetails`,
  `CeilingFixtures` groups exist in their relevant assets. For loaded garage,
  assert every mesh below Ceiling (including fixtures) is on
  `OVERHEAD_EXCLUDED_LAYER`, and all floor/wall meshes remain visible on
  ordinary world layer 0. Keep existing collider/ground-dimension assertions.

- [ ] **Step 2: Run** `npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs`; confirm missing-detail tests fail.
- [ ] **Step 3: Implement** roadside asphalt/sidewalk regions, joints, existing curb/fence/barrier treatment and restrained architectural backdrop; garage concrete seams, wall bands, bay identifiers, pillar guards, pipes and bright unlit fixture faces. Keep all existing collision footprints and no reachable new solid-looking objects. Batch color-detail geometry rather than emitting a mesh per seam. Avoid new image textures or lights.
- [ ] **Step 4: Regenerate and verify** with `node tools\generate-assets.mjs` and the same two Vitest files. Assert actual environment triangles <=30,000 and all selected pairs <=5,000,000 bytes. Expect all tests passing.
- [ ] **Step 5: Commit**, message `feat: replace placeholder parking environments with original art`, with the required trailer.

## Task 4: Visible Parked Cars Without Physics Changes

**Files:** New parked-vehicle module/tests; lesson-scene and preview modules/tests.

**Interfaces:**
- `createParkedVehicle(template: Object3D, collider: ColliderBox): Group` in `src\render\parked-vehicle.ts`.
- Change `createLessonScene(scenario: ScenarioDefinition, vehicleTemplate: Object3D): LessonScene`.
- Preserve `LessonScene`'s existing `group`, `update(runtime)` and idempotent `dispose()` interface.
- `preview.ts` supplies `prototype.sceneAssets.vehicle`; update every test call site.

- [ ] **Step 1: Add failing parked-car tests** with a small named Exterior/wheel template and uniquely tracked geometry/material resources.

  For ordinary, narrow (`halfExtentsM: [0.7,0.8,2.1]`) and rotated
  (`yawRad: Math.PI/4`) colliders, undo the output root's yaw and assert
  visible bounds match `halfExtentsM * 2` and center matches `centerM`
  within 0.02 m. Assert cloned wheels do not follow later template rotation.
  Dispose lesson visuals twice and expect each owned clone resource released
  once, with original template resource dispose spies untouched.
  Add all-five-scenario assertions that every obstacle ID has a visible car.

- [ ] **Step 2: Run** `npx vitest run src\render\parked-vehicle.test.ts src\render\lesson-scene.test.ts`; confirm missing implementation fails.
- [ ] **Step 3: Implement** exterior/wheel-only cloning, per-instance owned geometry/materials and bounds-based fit to the collider in local space before applying collider yaw. Exclude cockpit and live mirror surfaces; never mutate template transforms/materials. Retain mirror housings and closed dark static window shapes where necessary for parked-car recognition without adding a full cockpit. Tag roots by collider ID and deduplicate resource disposal.
- [ ] **Step 4: Integrate** into lesson-scene and preview. Preserve highlights and targets. Hide generic environment `ParkingMarkings` during lessons if they conflict; keep them in sandbox. Test that lesson-specific target/highlight planes stay visible, and sandbox generic markings are unchanged.
- [ ] **Step 5: Verify** with `npx vitest run src\render\parked-vehicle.test.ts src\render\lesson-scene.test.ts src\render\preview.test.ts` and `npm run typecheck`. Expect all passing; no collider/profile/scenario file changes.
- [ ] **Step 6: Commit**, message `feat: render lesson parked vehicles from collider metadata`, with the required trailer.

## Task 5: Real Render Evidence and Budget Gates

**Files:** New Phase 8 browser fixture/spec; reuse existing phase-5 checks and lesson-completion journeys.

**Interfaces:** Test-only `window.phase8Capture` exposes:
`ready: boolean`, `setShot(shot: 'front' | 'rear' | 'driver' | 'overhead' | 'environment' | 'props'): void`,
`report(): { passes: { name: string; calls: number; triangles: number }[]; parkedTriangles: number[] }`.
Fixture URL accepts validated `vehicle`, `environment`, and optional stage 1–5;
invalid fixture parameters fail explicitly. Do not expose this API in the app.

- [ ] **Step 1: Write a failing Playwright spec** for the missing fixture. Cover all four vehicle/environment pairs; front/rear/driver/overhead views; garage ceiling visible in ordinary views but excluded overhead; all five lesson obstacle counts; per-parked-car <=4,000 triangles; sandbox main-pass <=100 calls; lesson main-pass <=140 calls; zero page errors.
- [ ] **Step 2: Run** `npx playwright test tests\browser\phase-8-assets.spec.ts`; confirm the fixture-not-found/readiness failure.
- [ ] **Step 3: Implement the fixture** using actual `loadSceneAssets`, asset/lesson scenes and `createViews`. Use a settled rig snapshot at existing spawn poses. Instrument render passes around the real view pipeline, recording each pass immediately after render before any counter reset. Exercise two frame times less than 66.67 ms apart and an auxiliary-update frame; preserve 15 FPS mirror behavior. Report actual full-frame totals alongside named main/auxiliary passes, not as the main-pass budget.
- [ ] **Step 4: Capture screenshots** as test artifacts using `testInfo.outputPath(...)`, not automatic overwrites of committed pictures. Include each vehicle's front/rear three-quarter and cockpit, both environments, parked cars, small-prop collages, and representative real app driving/menu screenshots. Use neutral readable framing and the real selected assets. Inspect captures and correct actual art problems before accepting them.
- [ ] **Step 5: Verify focused browser behavior** with `npx playwright test tests\browser\phase-5.spec.ts tests\browser\phase-8-assets.spec.ts tests\browser\lesson-completion.spec.ts`. Expect four loaded pairs, budgets passing, two successful five-stage journeys and no page errors. Do not bypass timing failures by loosening lesson/physics rules.
- [ ] **Step 6: Run existing final software gates**: `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser`, `npm run test:production`. Keep logs/evidence; existing package scripts define no lint command. Do not install dependencies unless these commands establish a missing-tool failure.
- [ ] **Step 7: Exercise the existing benchmark** at 2560 x 1440 with honest machine/browser metadata, its existing measurement duration and all four fixed cases. Save its JSON outside committed artwork folders. If automation/pointer-lock/hardware limitations prevent valid measurement, report the failed/invalid attempt and reason, not invented FPS or a performance guarantee.
- [ ] **Step 8: Commit**, message `test: verify original assets and rendering budgets`, with the required trailer.

## Task 6: Illustrated Delivery and Pull Request

**Files:** Catalog, chosen PNG captures and their license notice, README, asset pipeline, narrow roadmap/current-art statements, approved spec status.

**Interfaces:** `docs\phase-8-asset-catalog.md` is the authoritative asset inventory/evidence index; README links it. Preserve useful existing menu coverage and add actual updated driving images.

- [ ] **Step 1: Copy only inspected artifact images** into `docs\images\phase-8\` with descriptive names; include a CC BY-NC 4.0 artwork-image notice. No screenshots of brainstorming SVGs, broken views, personal paths or browser secrets.
- [ ] **Step 2: Write the catalog** with each GLB and stationary/modular object category, real rendered pictures, metric dimensions, named anchors, measured triangles, per-pass/full-frame calls, file/pair bytes, regeneration command, original provenance, license boundary and hardware/manual-validation limits. Identify the unchanged simple box-collision approximation.
- [ ] **Step 3: Refresh README images/license and asset pipeline statements**. Replace obsolete descriptions of blank art with precise delivered capabilities; retain simulator/training-readiness caveats. Update only affected roadmap/current-art paragraphs. Mark the design owner-approved and link the plan/catalog.
- [ ] **Step 4: Verify documentation**: check every local image/link resolves, all required categories appear, reported values match generated GLBs/browser reports, and `git diff --check` passes. These are documentation-only edits after Task 5, so rerun software gates only if implementation changed.
- [ ] **Step 5: Commit**, message `docs: catalog Phase 8 artwork and refresh screenshots`, with the required trailer.
- [ ] **Step 6: Request one whole-branch review** using the applicable review skill. Fix high-confidence findings surgically and rerun affected checks. Confirm final status, commit list and exact diff contain no unrelated README planning files or session artifacts.
- [ ] **Step 7: Push the dedicated branch and create the PR** with `gh pr create --base main --head <implementation-branch>`. Include art previews, catalog link, license split, verification results and unverified hardware/instructor limitations. Do not merge.

## Execution Setup and Self-Review

Before product edits, use the required isolation skill to create an execution
worktree from the committed design/plan branch. Follow native execution unless
the owner explicitly chooses subagent-driven execution at handoff.

Coverage checked: selected visual direction (Tasks 2–3), all lesson objects and
unchanged routes (Task 4), licenses/editable sources (Tasks 1 and 6), sightlines
and runtime contracts (Tasks 2–5), quantitative budgets/performance caveats
(Tasks 1 and 5), catalog/README/PR (Task 6). No product code is written by
this plan.
