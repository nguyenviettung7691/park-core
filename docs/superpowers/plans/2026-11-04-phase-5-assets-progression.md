# Phase 5 Assets and Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver original vehicle/environment GLB assets and a validated async loader, then connect a persistent, sequential Phase 5 progression surface to the existing simulator.

**Architecture:** Keep generated visuals separate from explicit Cannon collider metadata. The app owns async asset-load generations and transfers one selected asset set to the preview; a small versioned persistence module owns progress, settings and controller calibration. Unlocks derive from completed-stage prefixes and only a typed confirmed-success boundary can record completion.

**Tech Stack:** Strict TypeScript, Vite, Three.js `GLTFLoader`, Cannon-es, vanilla DOM/CSS, Vitest, jsdom and Playwright. Keep the existing dependencies; the deterministic asset generator uses Node built-ins only.

**Spec:** [Approved Phase 5 design](../specs/2026-11-04-phase-5-assets-progression-design.md)

## Global Constraints

- Produce `public/assets/vehicles/sedan.glb`, `cuv.glb` and `public/assets/environments/roadside.glb`, `garage.glb` from original deterministic code-authored geometry.
- Use static vertex colors; add no runtime shadows, custom shaders, image decoder or package dependency.
- Keep each vehicle root at its profile center of mass; vehicle-local +Y is up, -Z is forward, dimensions are in meters, and authored vehicle/cockpit geometry is <=50k triangles and environment geometry <=150k triangles.
- Keep explicit collider metadata authoritative and separate from GLB visuals; reject asset dimensions differing from metadata by more than 0.02 m.
- Load only the selected vehicle/environment pair; abort or discard stale loads and dispose each owned geometry/material/texture exactly once.
- Stage 1 opens the Garage sandbox. Stages 2-5 remain visibly locked until the contiguous completed-stage prefix allows them; no preview or UI action awards completion.
- Persist only progress, settings and stable-device-ID controller calibration under `park-core.progress.v1`, `park-core.settings.v1` and `park-core.calibration.v1`.
- Preserve unreadable records until the learner confirms a key-specific reset; never silently overwrite corrupt or unsupported versions.
- Continue with clearly labeled session-only state if storage access or writes fail. Never report a failed write as persistent.
- Learner-facing copy and errors are Vietnamese. Keep existing renderer/RAF ownership, focus, pointer-lock, pause, recovery and idempotent-disposal behavior.
- Do not merge to `main` or push before the project owner signs off on Phase 5.

## Review Focus

1. A selected scene load resolves after Menu/cancel or a replacement request. Expect no stale attachment and exactly-once disposal; pin in Task 3 app lifecycle tests.
2. A GLB has a missing node, invalid root, wrong dimensions or unsupported format. Expect a typed resource failure and no prototype substitution; pin in Task 2 loader tests.
3. Persisted JSON is malformed, unsupported or contains invalid/duplicate IDs. Expect the original key preserved, record marked reset-required and no later save over it; pin in Task 4 storage tests.
4. The `localStorage` getter or a quota-limited write throws. Expect honest session-only mode, visible notice and no false saved result; pin in Task 4 tests and Task 5 UI tests.
5. A browser reports unknown total transfer size or fails one selected resource. Expect an indeterminate loading state or a Vietnamese resource-specific retry/menu error, not a fabricated percentage; pin in Task 3 and Task 6 browser tests.

---

## File Ownership Map

| Files | Responsibility |
|---|---|
| `tools\generate-assets.mjs`, `src\world\generate-assets.test.mjs`, `vite.config.ts`, `public\assets\vehicles\*.glb`, `public\assets\environments\*.glb` | Deterministic original geometry and reproducible GLB outputs |
| `src\world\assets.ts`, `src\world\colliders.ts`, `src\world\assets.test.mjs` | Asset URLs/metadata, validated loader, explicit per-environment colliders |
| `src\runtime-types.ts`, `src\render\asset-scene.ts`, `src\render\preview.ts`, `src\render\preview.test.ts` | Scene contract, visual composition, animated wheel poses, preview ownership |
| `src\app.ts`, `src\app.test.ts`, `src\ui\screens.ts`, `src\ui\ui.test.ts`, `src\messages.ts`, `src\style.css` | Async load state, stage selection, persistence notices and key-scoped reset confirmation |
| `src\storage\persistence.ts`, `src\storage\persistence.test.ts`, `src\contracts.ts` | Versioned record validation, storage recovery, unlock derivation and confirmed completion boundary |
| `tests\browser\phase-5.spec.ts` | Real-browser asset-pair, loading, stage-lock and lifecycle acceptance |
| `docs\phase-5-detail-design.md`, `docs\phase-5-implementation-plan.md`, `docs\asset-pipeline.md` | Phase deliverables, generator/provenance evidence and status |
| `docs\tech-design.md`, `docs\detail-design.md`, `docs\implementation-plan.md`, `.github\copilot-instructions.md` | Phase-number reconciliation and explicit lesson/evaluation deferral |

Keep test fixtures in their owning tests unless reused. Do not build a parallel simulation, storage framework or generated-art toolchain.

## Shared Interfaces

The following are the boundaries later tasks consume. Existing interfaces in `src\contracts.ts` and `src\runtime-types.ts` remain authoritative unless a listed field is explicitly added.

```ts
// runtime-types.ts
interface AssetLoadProgress {
  readonly resource: 'vehicle' | 'environment';
  readonly loadedBytes: number;
  readonly totalBytes: number | null;
}

// world/assets.ts
type AssetFailureCategory = 'vehicle' | 'environment';
function loadSceneAssets(
  environment: EnvironmentId,
  vehicle: VehicleId,
  signal: AbortSignal,
  onProgress?: (progress: AssetLoadProgress) => void,
): Promise<SceneAssets>;

// world/colliders.ts
function collidersForEnvironment(id: EnvironmentId): readonly ColliderBox[];

// storage/persistence.ts
type PersistenceRecord = 'progress' | 'settings' | 'calibration';
interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
type RecordStatus = 'persistent' | 'session-only' | 'reset-required';
interface PersistenceSnapshot {
  readonly progress: ProgressSaveV1;
  readonly settings: SettingsSaveV1;
  readonly calibrations: readonly ControllerCalibration[];
  readonly recordStatus: Readonly<Record<PersistenceRecord, RecordStatus>>;
}
interface PersistenceResult {
  readonly record: PersistenceRecord;
  readonly status: RecordStatus;
}
interface PersistenceStore {
  snapshot(): PersistenceSnapshot;
  saveProgress(value: ProgressSaveV1): PersistenceResult;
  saveSettings(value: SettingsSaveV1): PersistenceResult;
  saveCalibrations(value: readonly ControllerCalibration[]): PersistenceResult;
  recordConfirmedStageSuccess(stageId: StageId): PersistenceResult;
  resetRecord(record: PersistenceRecord): PersistenceResult;
}
function createPersistence(getStorage: () => StoragePort | null): PersistenceStore;
function unlockedStages(progress: ProgressSaveV1): readonly StageId[];
function recordStageSuccess(
  progress: ProgressSaveV1, stageId: StageId,
): ProgressSaveV1;
```

`loadSceneAssets` rejects with a typed `AssetLoadError` that identifies the resource category. `SceneAssets.dispose()` remains idempotent and owns only loaded visual resources. A version-1 calibration record stores an `entries` array of validated `ControllerCalibration` values keyed by each entry's stable `deviceId`; it never stores a gamepad array index.

## Task 1: Generate Original GLB Assets

**Files:**
- Create: `tools\generate-assets.mjs`
- Create: `src\world\generate-assets.test.mjs`
- Modify: `vite.config.ts`
- Create: the four `public\assets\...\*.glb` outputs listed above

**Interfaces:**
- Produces `buildGlb(assetId)` for deterministic binary GLB bytes and `writeAssets(outputRoot)` for reproducible output. CLI form: `node tools\generate-assets.mjs [outputRoot]`, defaulting to the project root.
- Uses only Node built-ins; no downloaded geometry, runtime dependency or generated timestamps.
- Vehicle GLBs contain `Body`, `WheelFL`, `WheelFR`, `WheelRL`, `WheelRR`, `DriverEye`, `MirrorRear`, `MirrorLeft`, `MirrorRight`, `MirrorSurfaceRear`, `MirrorSurfaceLeft`, `MirrorSurfaceRight`, and interior/dashboard geometry.
- Environment GLBs contain visible floor/road markings and the declared walls/curbs/pillars; garage ceiling is a separately named `Ceiling` group.

- [ ] **Step 1: Write failing generator tests.** Assert each of four definitions emits a GLB v2 header and valid JSON/BIN chunks; assert required vehicle nodes, distinct wheels, anchors, vehicle/environment dimensions, separate garage ceiling, stable output bytes across repeated generation, and per-asset triangle budgets.
- [ ] **Step 2: Run the focused tests red.** Run `npm test -- src\world\generate-assets.test.mjs`. Expected: subprocess exit failure because the generator CLI does not exist yet, not missing test tooling.
- [ ] **Step 3: Implement deterministic low-poly mesh and GLB encoding.** Export `buildGlb(assetId: AssetId): Uint8Array` and `writeAssets(outputRoot: string): void`; encode original geometry and static vertex colors only. Keep the source compact and make dimensions/nodes explicit in each definition.
- [ ] **Step 4: Generate and verify all four committed outputs.** Run `node tools\generate-assets.mjs`, then `npm test -- src\world\generate-assets.test.mjs`, `npm run typecheck`, and `npm run build`. Expected: stable GLB outputs and all asset-definition assertions pass; production build succeeds.
- [ ] **Step 5: Commit the generator, tests and generated GLBs.**

```text
feat: add original phase 5 glb assets
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Task 2: Add Asset Metadata, Colliders and Validated Loader

**Files:**
- Create: `src\world\assets.ts`, `src\world\assets.test.mjs`
- Modify: `src\world\colliders.ts`, `src\runtime-types.ts`
- Modify: `tools\generate-assets.mjs`, `public\assets\vehicles\*.glb` for validated mirror-anchor rotations
- Consume: generated GLBs from Task 1

**Interfaces:**
- Produces the `loadSceneAssets(...)` and `collidersForEnvironment(...)` shared above.
- Defines explicit expected vehicle dimensions/anchors and separate collider arrays for `roadside` and `garage`; do not derive physics from visual geometry.
- Validates GLB version, roots, required nodes, distinct wheels, anchor transforms, garage ceiling group and dimensions within 0.02 m.
- `SceneAssets` returns environment/vehicle groups, ordered wheel nodes and `VehicleAnchors`; loader applies the existing mirror/overhead excluded layers to the intended nodes.

- [ ] **Step 1: Probe Three.js parsing and write failing loader/collider tests.** First confirm `GLTFLoader.parse` handles generated image-free GLBs in the Node test environment without a new dependency. If it needs browser globals, unit-test the deterministic GLB structure with a small helper and inject the loader transport for validator tests; the real browser gate in Task 6 still exercises `GLTFLoader`. Cover selected-pair URLs, only two requested resources, required-node omission, malformed GLB, dimension/anchor mismatch, collider independence, typed category, abort, and disposal of partially loaded resources.
- [ ] **Step 2: Run the focused tests red.** Run `npm test -- src\world\assets.test.mjs`. Expected: missing loader/metadata exports or contract failures.
- [ ] **Step 3: Implement metadata and explicit collider arrays.** Add separate roadside/garage `ColliderBox` arrays and `collidersForEnvironment(id)`; retain `prototypeYard` only where current tests still use the prototype fixture.
- [ ] **Step 4: Implement `loadSceneAssets`.** Use Three.js `GLTFLoader`; load only the requested pair, validate each before returning, report known byte totals only, honor `AbortSignal`, dispose partial results on rejection, and throw `AssetLoadError` with `vehicle` or `environment` category.
- [ ] **Step 5: Run loader tests, typecheck and production build.** Run `npm test -- src\world\assets.test.mjs`, `npm run typecheck`, and `npm run build`. Expected: focused tests pass and build succeeds without adding dependencies.
- [ ] **Step 6: Commit loader, metadata, colliders and tests.**

```text
feat: validate phase 5 scene assets
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Task 3: Integrate Async Asset Ownership Into Preview

**Files:**
- Create: `src\render\asset-scene.ts`
- Modify: `src\render\preview.ts`, `src\render\preview.test.ts`, `src\runtime-types.ts`
- Modify: `src\views\cameras.ts`, `src\views\views.test.ts` to resolve authored mirror-surface names
- Modify: `src\app.ts`, `src\app.test.ts` for load cancellation and stale-result handling
- Modify: `src\ui\screens.ts`, `src\ui\ui.test.ts`, `src\messages.ts` for the asset-loading screen

**Interfaces:**
- `createPreview` receives an already validated `SceneAssets`; once accepted, preview owns and disposes it.
- `AppDeps` adds `loadSceneAssets: typeof loadSceneAssets`.
- `ShellView` adds nullable asset-load progress; unknown `totalBytes` renders as indeterminate.
- The app owns one `AbortController` and generation token per load. `Menu`, replacement load and `dispose()` abort; a late successful result is disposed and never attached.

- [x] **Step 1: Write failing ownership/loading tests.** Assert a successful asset set is disposed once on preview close; a renderer/scene initialization failure releases it; abort, close/menu, app disposal and a late stale resolution never attach the set and dispose it once. Assert the loading screen has an accessible status, indeterminate progress without a total, and a working Menu cancellation action.
- [x] **Step 2: Run `npm test -- src\app.test.ts src\render\preview.test.ts src\ui\ui.test.ts` red.** Expected: injection/ownership/loading-state tests fail against the synchronous prototype-only path.
- [x] **Step 3: Implement `asset-scene.ts`.** Compose the loaded environment/vehicle into a Three.js `Scene`; update chassis and wheel nodes from `RenderFrame`; preserve the existing camera/view integration and make `dispose()` idempotently release the `SceneAssets`.
- [x] **Step 4: Replace production prototype-scene creation.** Pass selected environment colliders to Cannon, use `asset-scene.ts` in preview and keep `buildPrototypeScene` only as a test fixture if existing unit tests still need it.
- [x] **Step 5: Add guarded async loading to the app.** Do not create the simulation until assets load; show Vietnamese loading feedback and only determinate progress when totals are known; route typed resource errors to retry/menu feedback without silently falling back to prototype geometry. Transfer asset ownership only after preview creation succeeds; if preview initialization throws, the app disposes the loaded set.
- [x] **Step 6: Run app/preview/UI tests, typecheck and build.** Run `npm test`, `npm run typecheck`, and `npm run build`. Expected: all ownership, stale-generation and loading-state cases pass.
- [x] **Step 7: Commit the preview integration.**

```text
feat: load selected assets in preview lifecycle
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Task 4: Implement Versioned Persistence and Unlock Rules

**Files:**
- Create: `src\storage\persistence.ts`, `src\storage\persistence.test.ts`
- Modify: `src\contracts.ts`, `src\runtime-types.ts` only for shared record/status types
- Reuse: `src\input\calibration.ts` `validateCalibration`

**Interfaces:**
- Produces `unlockedStages(progress)` and pure `recordStageSuccess(progress, stageId)` from Shared Interfaces.
- Produces `createPersistence(getStorage)` with a snapshot of progress, settings, stable-device-ID calibration entries, per-record recovery status, `saveProgress`, `saveSettings`, `saveCalibrations`, `resetRecord`, and `recordConfirmedStageSuccess`.
- Loads from `unknown`; validates v1 only. Missing keys use existing documented defaults. A reset-required key remains untouched by saves until `resetRecord` explicitly removes that one key.

- [x] **Step 1: Write failing pure progression tests.** Verify Stage 1 is always initially unlocked, only the contiguous completed prefix unlocks later stages, duplicate/out-of-order completion cannot skip a stage, repeated next-stage completion is idempotent, and either vehicle has identical unlock behavior.
- [x] **Step 2: Run progression tests red.** Run `npm test -- src\storage\persistence.test.ts -t "unlock|completion"`. Expected: missing progression functions.
- [x] **Step 3: Implement `unlockedStages(progress)` and `recordStageSuccess(progress, stageId)`.** Add exact known-stage validation; do not persist a separate unlocked number or expose completion through UI/debug actions. The store's distinct `recordConfirmedStageSuccess(stageId)` method is the typed boundary available to a future lesson outcome.
- [x] **Step 4: Write failing record validation/recovery tests.** Cover missing and valid records, round trips, unknown/duplicate stage IDs, invalid vehicle/settings/calibration entries, malformed JSON, unsupported versions, throwing storage getter, write/quota failure, preservation of corrupt keys, and reset affecting only the confirmed key.
- [x] **Step 5: Implement the three-key persistence module.** Store `ProgressSaveV1`, `SettingsSaveV1`, and `{version: 1, entries: ControllerCalibration[]}` under the approved keys. Keep session memory on access/write failure, return explicit mode/status, preserve all reset-required records, and never store a gamepad index.
- [x] **Step 6: Run storage tests, typecheck and build.** Run `npm test -- src\storage\persistence.test.ts`, `npm run typecheck`, and `npm run build`. Expected: every validation, recovery and write-mode test passes.
- [x] **Step 7: Commit persistence and its tests.**

```text
feat: persist phase 5 progression and settings
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Task 5: Add Stage Selection and Wire Persisted State

**Files:**
- Modify: `src\app.ts`, `src\app.test.ts`, `src\ui\screens.ts`, `src\ui\ui.test.ts`, `src\messages.ts`, `src\style.css`
- Consume: preview integration from Task 3 and persistence API from Task 4

**Interfaces:**
- `ScreenContext` receives persistence state/status and derived unlocked stage IDs; screens remain DOM-only and dispatch typed `ScreenAction`s.
- Render stages 1-5 with only contiguous-prefix stages enabled. Stage 1 launches the Garage sandbox; Stage 2-5 stay disabled/visibly locked absent real confirmed successes.
- Add an explicit request/confirm flow for progress/settings/calibration record resets; only confirmed reset calls `resetRecord(record)`.
- Hydrate persisted progress/settings/calibration before first menu draw; persist vehicle selection, settings changes and successful calibration saves through explicit operations.

- [x] **Step 1: Write failing UI tests.** Assert five stages render, default Stage 1 is startable, later stages are labeled locked/disabled, unlocked stages follow context, vehicle selector is retained, storage recovery/session-only messages are Vietnamese and not color-only, and reset requires a matching explicit confirmation.
- [x] **Step 2: Run `npm test -- src\ui\ui.test.ts` red.** Expected: current prototype menu has no stage/progress/recovery surface.
- [x] **Step 3: Implement the stage-selection screen and finite Vietnamese copy.** Stage 1 action starts the Garage sandbox; no UI control emits a completion result.
- [x] **Step 4: Write failing app persistence tests.** Verify hydration precedes menu render, selected vehicle/settings/calibration saves call only their intended persistence operation, confirmed reset is key-scoped, failed writes show session-only state, and no completion can originate from preview/menu actions.
- [x] **Step 5: Wire persistence into `createApp`.** Load persisted records before mounting the menu, persist explicit changes, install saved calibrations by stable device ID, and expose `recordConfirmedStageSuccess` only as the typed application boundary for a future lesson outcome.
- [x] **Step 6: Run UI/app tests, typecheck and build.** Run `npm test -- src\ui\ui.test.ts src\app.test.ts`, `npm run typecheck`, and `npm run build`. Expected: stage locks, reset confirmation, persistence and existing focus/pause behavior all pass.
- [x] **Step 7: Commit UI and app integration.**

```text
feat: add sequential phase 5 stage selection
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Task 6: Record Phase Deliverables and Run Browser Acceptance

**Files:**
- Create: `docs\phase-5-detail-design.md`, `docs\phase-5-implementation-plan.md`, `docs\asset-pipeline.md`, `tests\browser\phase-5.spec.ts`
- Modify: `docs\tech-design.md`, `docs\detail-design.md`, `docs\implementation-plan.md`, `.github\copilot-instructions.md`
- Consume: all delivered code and evidence from Tasks 1-5

- [ ] **Step 1: Write failing browser acceptance.** Use a Playwright-only fixture to exercise `loadSceneAssets` with real WebGL for all four vehicle/environment combinations; do not add a production debug hook. Also start Stage 1 Garage, switch vehicle requests, cancel/retry and close repeatedly; assert no stale canvas/scene, uncaught error or duplicate listeners. Assert later stages stay locked with no completion entry point.
- [ ] **Step 2: Run `npm run test:browser -- tests\browser\phase-5.spec.ts` and address only failures introduced by Phase 5.** Expected: focused browser acceptance passes in configured Chromium/Firefox projects; report browser/environment limitations explicitly.
- [ ] **Step 3: Create Phase 5 detail design and implementation plan deliverables.** Record scope, exact interfaces, actual software acceptance results, and remaining art/performance/hardware/route/instructor checks. Do not mark deferred lesson/evaluation work complete.
- [ ] **Step 4: Create `docs\asset-pipeline.md`.** Record the deterministic generator command, asset provenance, GLB sizes, triangle counts, named nodes, declared dimensions, static vertex-color limitation and any measured budget warnings.
- [ ] **Step 5: Reconcile master documents.** Clarify repository Phase 4/5 versus technical-design Phase 5/6 numbering, mark current assets/persistence delivery, and leave lessons/evaluation visibly deferred to the next phase.
- [ ] **Step 6: Run final gates.** Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser`, and `git diff --check`. Expected: all software gates pass; do not claim production art, hardware support, instructor approval, measured reference-PC performance or training readiness.
- [ ] **Step 7: Review the complete branch diff and report Phase 5 sign-off evidence.** Do not merge or push; wait for explicit owner sign-off before integration.

## Self-Review

- **Spec coverage:** Tasks 1-2 deliver original assets, metadata, explicit colliders and validation. Task 3 covers selected-pair loading, progress/error states, cancellation, stale results and ownership. Task 4 covers versioned records, unlock rules, key-specific recovery and memory-only mode. Task 5 covers stage locks, Garage sandbox entry, persistence UI, calibration, and the typed completion boundary. Task 6 covers the four phase docs, master-doc reconciliation, browser acceptance, final gates and pending-evidence claims.
- **Step scan:** Each task starts with a named failing test, runs it red, implements the bounded interface, verifies green and commits its own deliverable.
- **Type consistency:** Loader consumes `EnvironmentId`/`VehicleId` and returns existing `SceneAssets`; preview accepts that result; app injects the loader; persistence consumes existing progress/settings/calibration records; UI consumes derived unlocks/status.
- **Review focus:** All five listed failure classes have an owning test in Tasks 2-6.
- **Proportion:** The plan chooses interfaces, behavior, test names/conditions and files; it leaves low-poly composition and exact transforms to the approved named-node/dimension constraints.
