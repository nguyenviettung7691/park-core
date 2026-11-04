# Phase 6 Lessons and Parking Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver five Vietnamese parking lessons with measured success/failure outcomes, durable completed-attempt history, and the Phase 5 free-drive Garage sandbox retained as a separate Menu action.

**Architecture:** Keep scenario data, checkpoint progression, parking/failure evaluation, and attempt metrics in small typed lesson modules. Call them from the existing 120 Hz physics loop, preserve its one-renderer/one-loop ownership, and persist completed summaries through an append-oriented IndexedDB store while Phase 5 records remain in localStorage.

**Tech Stack:** Strict TypeScript, Vite, Three.js, Cannon-es, vanilla DOM, Vitest, jsdom, and Playwright; no new runtime dependency or UI framework.

**Spec:** [Approved Phase 6 design](../specs/2026-11-04-phase-6-lessons-parking-evaluation-design.md), using [the master detail design](../../detail-design.md) as the exact lesson/outcome source.

## Global Constraints

- Keep strict TypeScript, Vite, Three.js, Cannon-es, vanilla DOM, the existing renderer, and the single simulation/animation loop.
- Use `h = 1 / 120 s`, at most eight physics steps per rendered frame; clamp incoming wall-clock delta to 0.1 s.
- Use meters, kilograms, seconds and radians internally; vehicle-local X is right, Y is up, and -Z is forward.
- Keep failure processing before checkpoints and parking success; failure wins in the same fixed step.
- Require the full mirror-aware vehicle envelope inside the target inset by 0.05 m, heading error <=5 degrees, linear speed <0.1 m/s, angular speed <0.05 rad/s, gear P, parking brake, and 2.0 continuous seconds; roadside gap is 0.15-0.30 m.
- Fail on solid chassis/mirror contact, wheel-side curb clearance, bounds, tipping >30 degrees, or speed >15 km/h for one simulation second; non-finite physics remains an application error.
- Persist every completed success/failure recap in the same browser profile without an application-level count limit; do not sync across browsers/devices or persist active attempts.
- Keep history in IndexedDB and Phase 5 progress/settings/calibration in existing localStorage records. If a history write fails, preserve older records and show the current recap as session-only.
- All learner-facing copy and errors are Vietnamese. Keep completed recaps in one `AttemptSummary` shape across every stage and outcome.
- Retain `Lái tự do` as a separate Garage sandbox entry using the selected vehicle; free drive cannot award completion.
- Route geometry must be authored and checked for both vehicle profiles. Test witnesses prove geometric clearance and curvature only, not dynamic drivability; manual route-driving, instructor approval, and training readiness remain unverified.
- Use a separate Phase 6 worktree. Do not merge to `main` or push before explicit Phase 6 sign-off.
- Follow `docs/tech-design.md` AI tier routing: Premium for route/parking geometry; Standard for lesson/state/persistence integration and verification; Lightweight only for repetitive DOM/CSS after behavior and contracts are fixed.

## Review Focus

1. A rotated target, heading wrap at ±pi, or mirror overhang passes/fails only at the specified full-envelope boundaries. Pin in Task 3 parking tests.
2. A chassis-to-ground collision, curb crossing, bounds exit, tip, or sustained overspeed occurs on the same step as a valid park. Failure must win and record the first reason; pin in Task 4 and Task 6 tests.
3. A learner pauses, loses focus/controller, retries, or enters Menu while inputs or dwell are active. No held input, dwell, sensor history, or attempt metric may leak to the next attempt; pin pause/focus cleanup in Task 6 and retry isolation in Task 8.
4. IndexedDB is unavailable, corrupt, quota-limited, or an append is repeated. Preserve old records, avoid duplicates, expose session-only/reset-required status, and never claim persistence falsely; pin in Task 7 and browser acceptance.
5. A lesson is skipped, a valid park occurs before advisory steps, or free drive is used. Only a confirmed successful lesson unlocks the contiguous next stage; pin in Tasks 2, 6, and 8.
6. A history read completes after the learner leaves the screen or the app is disposed. Ignore stale results and do not resurrect history UI; pin in Task 8.

---

## Execution Conventions

- Before implementation, invoke `superpowers:using-git-worktrees` and create `phase-6-lessons-parking-evaluation` from the signed-off `main`. Keep the approved Phase 6 spec and this plan with the implementation branch.
- Read this plan and the approved Phase 6 spec before starting each task. Preserve unrelated worktree changes.
- Write the regression test first, run it red for the intended reason, implement the smallest correction, and rerun the focused test.
- Every task's green checks include `npm run typecheck`; each task's final verification includes `npm run build`. Finish with full unit tests, typecheck/build, browser tests, and `git diff --check`.
- Use a supported Node version from `package.json` (`^22.22.2 || ^24.15.0 || >=26.0.0`) for supported-runtime evidence. If unavailable, report the actual runtime and do not claim supported-Node validation.
- Do not add a package unless existing browser APIs or test tools prove insufficient. No new application framework, physics engine, lesson DSL, or cloud storage.
- Commit each independently verified task with the required trailer:

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## File Ownership Map

| Files | Responsibility |
|---|---|
| `src\contracts.ts`, `src\runtime-types.ts` | Scenario obstacles, lesson runtime, completed-history record, history screen/actions |
| `src\lessons\scenarios.ts`, `scenarios.test.ts` | Five authored layouts, spawn/target/step data and static scenario obstacles |
| `src\lessons\scenario-test-utils.ts` | Test-only scenario loading and oriented geometry assertions |
| `src\lessons\checkpoints.ts`, `checkpoints.test.ts` | Pure typed checkpoint and advisory-step progression |
| `src\lessons\parking.ts`, `parking.test.ts` | Oriented envelope, heading, curb-gap and stationary-dwell evaluator |
| `src\lessons\failure.ts`, `failure.test.ts` | Collision/bounds/curb/tip/speed failure predicates |
| `src\lessons\attempt.ts`, `attempt.test.ts` | Simulation-time recap measurements and immutable `AttemptSummary` |
| `src\world\colliders.ts`, `src\vehicle\rig.ts` | Compose environment/scenario colliders and map contact bodies to authored IDs |
| `src\render\lesson-scene.ts`, `lesson-scene.test.ts` | Target/setup/highlight and static scenario visuals with owned cleanup |
| `src\render\preview.ts`, `preview.test.ts` | One-loop lesson update order, pause and outcome callbacks; retain sandbox behavior |
| `src\storage\attempt-history.ts`, `attempt-history.test.ts` | Versioned IndexedDB records, validation, ordered reads, append and explicit reset |
| `src\app.ts`, `app.test.ts`, `src\ui\screens.ts`, `src\ui\ui.test.ts`, `src\messages.ts`, `src\style.css` | Briefing/outcome/history/free-drive navigation, persistence status and Vietnamese copy |
| `src\lessons\scenario-routes.test.ts` | Collision-free witness traces for both vehicle profiles |
| `tests\browser\phase-6.spec.ts` | Real-browser lesson, retry/failure, IndexedDB history/reload and free-drive acceptance |
| `docs\phase-6-detail-design.md`, `docs\phase-6-implementation-plan.md`, `docs\tech-design.md`, `docs\detail-design.md`, `docs\implementation-plan.md`, `.github\copilot-instructions.md` | Phase deliverables, actual status/evidence, and roadmap reconciliation |

Keep test-only route witnesses inside the scenario route test. They demonstrate
one geometrically clear, curvature-feasible path; they are not shown to
learners and are never used to grade or constrain player movement.

## Shared Interfaces

`StageId`, `ScenarioDefinition`, `Checkpoint`, `LessonStep`, `ParkingTarget`,
`AttemptSummary`, and the relevant `AppState` variants already exist in
`src\contracts.ts`. Reuse them; add only the boundary fields needed below.

```ts
// contracts.ts
interface ScenarioCollider {
  readonly id: string;
  readonly kind: 'obstacle' | 'curb';
  readonly centerM: Vec3Data;
  readonly halfExtentsM: Vec3Data;
  readonly yawRad: number;
}

interface ScenarioDefinition {
  // Existing fields remain unchanged.
  readonly obstacles: readonly ScenarioCollider[];
}

// runtime-types.ts already defines ColliderBox with kind:
// 'ground' | 'obstacle' | 'curb'; keep that broader union for static geometry.

interface CompletedAttemptRecord {
  readonly id: string;
  readonly completedAt: string; // ISO-8601 UTC
  readonly summary: AttemptSummary;
}

type AttemptHistoryStatus =
  | 'saving' | 'persistent' | 'session-only' | 'reset-required';

// world/colliders.ts
const scenarios: Readonly<Record<StageId, ScenarioDefinition>>;
function collidersForScenario(scenario: ScenarioDefinition): readonly ColliderBox[];

// lessons/checkpoints.ts
function advanceLesson(
  scenario: ScenarioDefinition,
  runtime: LessonRuntime,
  telemetry: VehicleTelemetry,
  actions: readonly InputAction[],
  deltaS: number,
): LessonRuntime;

// lessons/parking.ts
interface ParkingUpdate {
  readonly eligible: boolean;
  readonly dwellS: number;
  readonly complete: boolean;
}
function updateParking(
  telemetry: VehicleTelemetry,
  profile: VehicleProfile,
  target: ParkingTarget,
  curb: ColliderBox | null,
  previousDwellS: number,
  deltaS: number,
): ParkingUpdate;

// lessons/failure.ts
interface FailureEvent {
  readonly reason: FailureReason;
  readonly obstacleId: string | null;
}
interface FailureUpdate {
  readonly event: FailureEvent | null;
  readonly speedEnvelopeDwellS: number;
}
function updateFailure(
  scenario: ScenarioDefinition,
  profile: VehicleProfile,
  telemetry: VehicleTelemetry,
  colliders: readonly ColliderBox[],
  contactId: string | null,
  previousSpeedEnvelopeDwellS: number,
  deltaS: number,
): FailureUpdate;

// lessons/attempt.ts
interface AttemptTracker {
  readonly stageId: StageId;
  readonly vehicleId: VehicleId;
  readonly elapsedSimulationS: number;
  readonly closestSampledClearanceM: number | null;
  readonly peakSpeedMps: number;
  readonly directionChanges: number;
  readonly acknowledgedStepIds: readonly string[];
  readonly usedAids: AttemptSummary['usedAids'];
  readonly previousDirectionSign: -1 | 0 | 1;
}
function createAttemptTracker(stageId: StageId, vehicleId: VehicleId): AttemptTracker;
function updateAttemptTracker(
  tracker: AttemptTracker,
  telemetry: VehicleTelemetry,
  sensors: SensorSnapshot | null,
  actions: readonly InputAction[],
  activeAids: AttemptSummary['usedAids'],
  runtime: LessonRuntime,
  deltaS: number,
): AttemptTracker;
function finishAttempt(
  tracker: AttemptTracker,
  result: AttemptResult,
): AttemptSummary;
type AttemptResult =
  | { readonly outcome: 'success' }
  | { readonly outcome: 'fail'; readonly failure: FailureEvent };

// contracts.ts
interface LessonRuntime {
  readonly stageId: StageId;
  readonly stepIndex: number;
  readonly stepDwellS: number;
  readonly parkingDwellS: number;
  readonly acknowledgedStepIds: readonly string[];
}

// storage/attempt-history.ts
interface AttemptHistorySnapshot {
  readonly records: readonly CompletedAttemptRecord[];
  readonly status: AttemptHistoryStatus;
}
interface AttemptHistoryStore {
  list(): Promise<AttemptHistorySnapshot>;
  append(summary: AttemptSummary): Promise<{
    readonly record: CompletedAttemptRecord;
    readonly status: AttemptHistoryStatus;
  }>;
  reset(): Promise<AttemptHistoryStatus>;
}
function createAttemptHistoryStore(
  indexedDB: IDBFactory,
  now?: () => Date,
  createId?: () => string,
): AttemptHistoryStore;
```

`LessonRuntime` uses the exact shape above; `stepDwellS` is for the currently
active step and its parking dwell remains separate. `ScenarioDefinition.obstacles` contains only
scenario-specific solids; `collidersForScenario` combines them with the
existing static colliders for its environment. `PreviewSessionMode` is
`{ readonly kind: 'sandbox' } | { readonly kind: 'lesson';
readonly scenario: ScenarioDefinition }`; lesson preview events are
`onLessonUpdate(runtime: LessonRuntime)` and
`onAttemptOutcome(summary: AttemptSummary)`.
`createLessonScene(scenario)` returns `{ readonly group: THREE.Group;
update(runtime: LessonRuntime): void; dispose(): void }`; its update only
changes scenario visuals, and disposal is idempotent.

Extend `AppState` with `{ readonly kind: 'history-loading' }`,
`{ readonly kind: 'history'; readonly records: readonly CompletedAttemptRecord[];
readonly status: AttemptHistoryStatus }`, and
`{ readonly kind: 'history-detail'; readonly record: CompletedAttemptRecord;
readonly status: AttemptHistoryStatus }`. Success/fail states carry
`historyStatus: AttemptHistoryStatus`, initially `saving` and updated when
append completes. Add ScreenActions `open-history`,
`select-history-record` with `recordId`, `history-back`,
`request-history-reset`, `confirm-history-reset`, `cancel-history-reset`, and
`start-free-drive` with the selected `vehicleId`; `ScreenContext` carries
`historyStatus` and `historyResetRequested`.

Expected IndexedDB availability, transaction, blocked, and quota failures
produce the documented session-only result and localized UI status. Do not
catch arbitrary programming errors as storage fallback; reject them to the
existing application error path.

When IndexedDB is unavailable, the history store keeps newly completed
session-only records in memory. `list()` merges them with readable persisted
records, newest first; after a read failure it returns the in-memory records
with `session-only` status without deleting or overwriting persisted data.
Malformed or unsupported persisted records yield `reset-required`, which
blocks persisted appends until the learner explicitly deletes and recreates
only the dedicated `park-core.attempt-history` database. Keep any newly
completed recap in memory and return `reset-required` so the outcome still
shows it was not saved. A generated duplicate record ID rejects the append
instead of being reported as a storage outage. An explicit reset clears the
in-memory fallback too; if IndexedDB cannot confirm the delete/recreate,
return `session-only` and keep the UI notice honest that saved records may
reappear. This operation never touches Phase 5 localStorage.

## Tasks

### Task 1: Author five scenario layouts and route geometry

**Tier:** Premium for geometry; Standard for data-contract tests.

**Files:**
- Modify: `src\contracts.ts`, `src\world\colliders.ts`, `src\messages.ts`
- Create: `src\lessons\scenarios.ts`, `src\lessons\scenarios.test.ts`
- Create: `src\lessons\scenario-routes.test.ts`
- Create: `src\lessons\scenario-test-utils.ts`

**Interfaces:**
- Consumes: `VehicleProfile`, `SpawnPose`, `OrientedRegion`, `ScenarioDefinition`, `ColliderBox`, `vehicleFootprint`, and `rearAxleCenter`.
- Produces: `scenarios[1..5]` and `collidersForScenario(scenario)`.

- [x] **Step 1: Write failing scenario contract and route tests.** Assert the exact stage/environment/target-size mapping from the spec; both vehicle spawns exist; all numeric scenario fields are finite, IDs are unique/nonempty, garage clear aisle is >=6 m and roadside clear lane >=3.5 m, and no spawn/final-target envelope intersects a solid. Add test-only body-pose traces for every stage/profile; compute rear-axle centers with `rearAxleCenter(pose, profile)`, assert samples stay within bounds and clear all colliders, with <=0.1 m translation and <=1 degree heading increments. For every turn, estimate radius from rear-axle travel divided by wrapped heading change and assert it is at least `wheelbaseM / tan(steeringWheelLockRad / steeringRatio)`.
- [x] **Step 2: Run the tests red.** Run `npm test -- src/lessons/scenarios.test.ts src/lessons/scenario-routes.test.ts`; expect missing scenario exports/fields, not test-runner errors.
- [x] **Step 3: Add authored scenario data and collider composition.** Add only scenario-specific parked-vehicle/obstacle/curb boxes; combine them with environment colliders using unique IDs. Author fixed spawn poses for Sedan and CUV and all required target/setup regions; add the Vietnamese step-instruction message keys referenced by those scenarios.
- [x] **Step 4: Verify route witnesses against authored layouts.** Run the route test for every stage/profile pair and adjust the authored layout, not the success evaluator, if any witness collides, leaves bounds, or turns tighter than the Ackermann minimum. Never use a witness trace in runtime evaluation.
- [x] **Step 5: Verify the task.** Run focused scenario/route tests, `npm run typecheck`, and `npm run build`.
- [x] **Step 6: Commit.** `feat: author Phase 6 lesson scenarios`.

### Task 2: Implement checkpoint and advisory-step progression

**Tier:** Standard.

**Files:**
- Modify: `src\contracts.ts`
- Create: `src\lessons\checkpoints.ts`, `src\lessons\checkpoints.test.ts`

**Interfaces:**
- Consumes: Task 1 scenarios, `LessonRuntime`, `VehicleTelemetry`, and `InputAction`.
- Produces: `advanceLesson(...)` as defined in Shared Interfaces and
  `LessonRuntime.stepDwellS`, initialized/reset to zero with each attempt.

- [x] **Step 1: Write failing progression tests.** Cover required-checkpoint AND semantics, only one step advance per update, stopped acknowledgement latching only on the current step, `stepDwellS` accumulation/reset, and alternative-region advancement of an advisory step without requiring prior acknowledgements.
- [x] **Step 2: Run the tests red.** Run `npm test -- src/lessons/checkpoints.test.ts`; confirm missing implementation or expected assertion failures.
- [x] **Step 3: Implement the pure evaluator.** Treat an acknowledgement as stopped only below 0.1 m/s; do not use DOM state or mutate the supplied scenario/runtime.
- [x] **Step 4: Verify.** Run focused tests, `npm run typecheck`, and `npm run build`.
- [x] **Step 5: Commit.** `feat: add typed lesson checkpoint progression`.

### Task 3: Implement parking envelope and dwell evaluation

**Tier:** Premium.

**Files:**
- Create: `src\lessons\parking.ts`, `src\lessons\parking.test.ts`
- Consume: `src\vehicle\geometry.ts`, `src\vehicle\profiles.ts`

**Interfaces:**
- Consumes: `VehicleTelemetry`, `VehicleProfile`, `ParkingTarget`, and the named roadside curb collider.
- Produces: `updateParking(...)` returning eligibility and continuous dwell.

- [x] **Step 1: Write failing geometry/boundary tests.** Cover each mirror-aware footprint corner in an oriented target inset by 0.05 m; target rotation; heading error wrap at +/-pi and the 5-degree boundary; linear/angular speed, P, parking brake; roadside body-to-curb gap endpoints 0.15/0.30 m; exactly 2.0 s success; and dwell reset when any requirement becomes false.
- [x] **Step 2: Run the tests red.** Run `npm test -- src/lessons/parking.test.ts`; confirm the missing evaluator fails as expected.
- [x] **Step 3: Implement oriented containment and gap checks.** Transform envelope corners into target-local X/Z; use body width for curb gap, not mirror width. Keep calculation pure and use explicit collider metadata.
- [x] **Step 4: Verify.** Run parking tests, `npm run typecheck`, and `npm run build`.
- [x] **Step 5: Commit.** `feat: evaluate measured parking completion`.

### Task 4: Implement attempt failure predicates

**Tier:** Premium for collision/clearance geometry.

**Files:**
- Create: `src\lessons\failure.ts`, `src\lessons\failure.test.ts`
- Consume: `src\vehicle\geometry.ts`, Task 1 scenario colliders.

**Interfaces:**
- Consumes: `ScenarioDefinition`, vehicle profile/telemetry, static collider IDs, and previous overspeed dwell.
- Produces: `updateFailure(...)` returning the first typed failure and updated speed dwell.

- [x] **Step 1: Write failing failure tests.** Cover chassis/mirror contact ID mapping, chassis-to-ground failure while excluding normal wheel-ground support, wheel-side curb overlap; full-envelope bounds; >30-degree tip boundary; >15 km/h sustained for 1.0 simulation second with timer reset below threshold; and non-finite telemetry being surfaced as an application error rather than a `FailureReason`.
- [x] **Step 2: Run the tests red.** Run `npm test -- src/lessons/failure.test.ts`; confirm intended failures.
- [x] **Step 3: Implement pure per-step failure evaluation.** Classify curb IDs as `curb-contact`, other solid IDs as `collision`, and retain the first detected event. Keep non-finite checks on the existing `SimulationStateError` path.
- [x] **Step 4: Verify.** Run failure tests, `npm run typecheck`, and `npm run build`.
- [x] **Step 5: Commit.** `feat: evaluate lesson failure boundaries`.

### Task 5: Track attempt metrics and create uniform recaps

**Tier:** Standard.

**Files:**
- Modify: `src\contracts.ts`
- Create: `src\lessons\attempt.ts`, `src\lessons\attempt.test.ts`

**Interfaces:**
- Consumes: telemetry, sensor snapshots, current lesson runtime, input actions, and Task 4 failure events.
- Produces: `createAttemptTracker`, `updateAttemptTracker`, and
  `finishAttempt` as defined in Shared Interfaces. Feed current requested aid
  use through `activeAids`; do not infer actual observation from sensor use.

- [ ] **Step 1: Write failing measurement tests.** Assert simulation elapsed time, peak absolute speed, closest non-null sampled clearance, acknowledged step IDs, requested aids, and direction changes only after signed motion exceeds 0.2 m/s.
- [ ] **Step 2: Run the tests red.** Run `npm test -- src/lessons/attempt.test.ts`; confirm expected missing-function failures.
- [ ] **Step 3: Implement a pure tracker.** Record completed attempts only; use the same summary fields for success/failure and `null` for unavailable failure/obstacle/clearance values as specified by `AttemptSummary`.
- [ ] **Step 4: Verify.** Run attempt tests, `npm run typecheck`, and `npm run build`.
- [ ] **Step 5: Commit.** `feat: summarize completed lesson attempts`.

### Task 6: Integrate lessons into the existing preview loop

**Tier:** Standard.

**Files:**
- Create: `src\render\lesson-scene.ts`, `src\render\lesson-scene.test.ts`
- Modify: `src\render\preview.ts`, `src\render\preview.test.ts`, `src\render\asset-scene.ts`, `src\world\colliders.ts`, `src\vehicle\rig.ts`, `src\runtime-types.ts`

**Interfaces:**
- Consumes: Tasks 1-5, the existing single `Preview` loop and `SceneAssets` ownership.
- Produces: discriminated `PreviewSessionMode`; `onLessonUpdate(runtime)` only
  when the visible step/acknowledgements change; `onAttemptOutcome(summary)`; and
  `createLessonScene(scenario)` with `group`, `update(runtime)`, and idempotent
  `dispose()`.

- [ ] **Step 1: Write failing preview tests.** Assert sandbox contact still pauses without producing a lesson outcome; lesson mode processes collision/failure before checkpoint and parking evaluation; failure takes precedence over same-step success; pause, focus loss and controller loss freeze dwell and neutralize controls; target/highlight update without a second renderer/RAF loop; and disposal releases visuals/colliders once.
- [ ] **Step 2: Run the tests red.** Run `npm test -- src/render/preview.test.ts src/render/lesson-scene.test.ts`; confirm missing session mode/events and visuals fail as expected.
- [ ] **Step 3: Expose collider IDs at the rig boundary.** Let static contact callbacks identify the other body and have the collider set map bodies to authored IDs; preserve existing cleanup behavior at all current call sites.
- [ ] **Step 4: Integrate one fixed-step lesson update.** Within the existing `world.step(1/120)` cycle, update failure, then checkpoint, then parking/dwell; update metrics with the same step's telemetry, sensor sample, actions, and aids before building any terminal summary. Stop stepping immediately on a terminal result; do not unlock progression in the renderer.
- [ ] **Step 5: Add target/setup visuals.** Render scenario geometry from typed scenario data and provide current-step highlight; keep visual meshes separate from collider authority and dispose them idempotently.
- [ ] **Step 6: Verify.** Run focused preview/lesson-scene tests, relevant vehicle/sensor tests, `npm run typecheck`, and `npm run build`.
- [ ] **Step 7: Commit.** `feat: integrate lesson evaluation in preview`.

### Task 7: Add IndexedDB completed-attempt history

**Tier:** Standard.

**Files:**
- Modify: `src\contracts.ts`, `src\runtime-types.ts`
- Create: `src\storage\attempt-history.ts`, `src\storage\attempt-history.test.ts`

**Interfaces:**
- Consumes: `AttemptSummary` and Shared Interfaces `CompletedAttemptRecord`/`AttemptHistoryStore`.
- Produces: database `park-core.attempt-history`, version 1, object store `attempts` keyed by `id`, and `completedAt` index; `createAttemptHistoryStore(indexedDB, now?, createId?)`.

- [ ] **Step 1: Write failing history tests.** Cover valid-record validation, rejected unknown/malformed values, duplicate ID rejection, and session-only fallback after open/transaction/quota failure. Cover persistent ordering, independent append, malformed/unsupported data blocking persisted writes while retaining the current recap in memory, reset deleting/recreating only this dedicated database plus memory fallback, and reset failure in the real-browser Task 9 acceptance tests.
- [ ] **Step 2: Run the tests red.** Run `npm test -- src/storage/attempt-history.test.ts`; confirm the store API is absent.
- [ ] **Step 3: Implement versioned IDB storage.** Validate values from `unknown`; append a generated ID and ISO UTC timestamp; query newest first; merge session-only records with persisted records; retain prior records after a failed append; never auto-clear invalid/unsupported data.
- [ ] **Step 4: Verify.** Run store tests, `npm run typecheck`, and `npm run build`. Exercise persistent behavior in the real browser IndexedDB acceptance tests in Task 9; add an IDB test package only if the existing test/browser setup proves insufficient.
- [ ] **Step 5: Commit.** `feat: persist completed attempt history`.

### Task 8: Wire lesson, history, and free-drive screens

**Tier:** Standard for app/state integration; Lightweight only for repetitive DOM/CSS after this task's contracts/tests are fixed.

**Files:**
- Modify: `src\app.ts`, `src\app.test.ts`, `src\runtime-types.ts`, `src\contracts.ts`, `src\ui\screens.ts`, `src\ui\ui.test.ts`, `src\messages.ts`, `src\style.css`

**Interfaces:**
- Consumes: preview session mode/events, IndexedDB history store, Phase 5 `PersistenceStore`, and existing `AppState`.
- Produces: Menu actions `start lesson`, `open history`, and `Lái tự do`; loader-to-briefing ownership; outcome/retry/continue flow; history loading/list/detail/reset states.

- [ ] **Step 1: Write failing app/UI tests.** Pin Stage 1 lesson briefing after asset load, explicit learner start before movement, locked-stage rejection, sandbox Garage launch with the selected vehicle and no recap/progress, success-only stage completion, failure recap without unlock, successful/failed summary persistence status, retry clearing held input/dwell/sensor history, history list/detail/return/reset confirmation, and stale asynchronous history reads ignored after navigation/disposal.
- [ ] **Step 2: Run tests red.** Run `npm test -- src/app.test.ts src/ui/ui.test.ts`; confirm unimplemented actions/screens or expected assertions fail.
- [ ] **Step 3: Add localized states/actions.** Extend screen state for briefing, playing, pause, outcome and history loading/list/detail/error; make history reset explicit and history storage status visible in Vietnamese.
- [ ] **Step 4: Integrate app ownership.** Hold loaded assets through Briefing, transfer ownership only when preview starts, dispose pending assets on Menu, and reopen/reload the same scenario on Retry. Persist a recap exactly once; call `recordConfirmedStageSuccess` only after a lesson success. Keep free drive on the current Garage sandbox path.
- [ ] **Step 5: Add accessible history navigation and recap presentation.** Sort newest first; list date/stage/vehicle/result; selecting opens the complete uniform summary. Keep keyboard focus, 44 px controls, and discrete live announcements.
- [ ] **Step 6: Verify.** Run app/UI/history tests, `npm run typecheck`, and `npm run build`.
- [ ] **Step 7: Commit.** `feat: add lesson and recap history flows`.

### Task 9: Browser acceptance, documentation, and final verification

**Tier:** Standard.

**Files:**
- Create: `tests\browser\phase-6.spec.ts`
- Modify: `docs\phase-6-detail-design.md`, `docs\phase-6-implementation-plan.md`, `docs\tech-design.md`, `docs\detail-design.md`, `docs\implementation-plan.md`, `.github\copilot-instructions.md`

**Interfaces:**
- Consumes: all Tasks 1-8 app/runtime behavior.
- Produces: measured Phase 6 deliverables, roadmap status, acceptance record, and sign-off evidence.

- [ ] **Step 1: Write browser acceptance tests.** Use Chromium and Firefox to exercise a real Stage 1 briefing-to-driving-to-success path, a collision failure and Retry/Menu, an unlocked later-stage entry, free-drive bypass, ordered recaps still listed after reload in real IndexedDB, and confirmed history reset leaving Phase 5 localStorage progress/settings intact. Assert no manual/debug completion action exists and no page errors occur.
- [ ] **Step 2: Run the new browser tests red.** Run `npm run test:browser -- tests/browser/phase-6.spec.ts`; failures must reflect missing Phase 6 behavior, not timing races or absent browsers.
- [ ] **Step 3: Implement only acceptance gaps.** Fix lifecycle/readiness/ownership behavior exposed by the tests; do not weaken parking, failure, or browser assertions to make a route pass.
- [ ] **Step 4: Write Phase 6 deliverables from actual implementation.** Record interfaces, five scenario definitions, success/failure thresholds, IndexedDB schema/recovery, recap behavior, tier routing and measured outputs in the Phase 6 docs. Update master status from deferred to implemented only for verified deliverables; retain unsupported hardware, learner, instructor and reference-PC claims as pending.
- [ ] **Step 5: Run all final checks.** Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser -- --reporter=line`, and `git diff --check`. Record actual Node version and any Vite chunk warning.
- [ ] **Step 6: Review the full branch diff and commit docs/status.** Confirm no recap history is synced remotely, no free-drive path awards completion, and no active attempt is persisted. Commit with the required co-author trailer.
- [ ] **Step 7: Request independent code review.** Fix any high-confidence correctness findings and rerun affected tests plus the required full gates.
- [ ] **Step 8: Present sign-off evidence.** Do not merge to `main` or push until explicit owner approval.

## Phase Dependencies

```text
1 scenarios -> 2 checkpoints -> 3 parking -> 4 failure -> 5 attempt tracking
                                     \                   / \
                                      +-> 6 preview <---+   +-> 7 IndexedDB
                                                               \
                                                                8 app/UI -> 9 acceptance/docs
```

Tasks are dependent slices of one Phase 6 simulator change; none can ship as
the requested curriculum independently. Task 7 can be implemented after the
summary contract from Task 5 is fixed, but Task 8 consumes both Task 6 and
Task 7.
