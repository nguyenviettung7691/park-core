# Vehicle Physics Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct wheel spin, telemetry-driven exterior lamps, tyre-edge physics with realistic curbs, and garage wheel stops that learners can use, for issue #11.

**Architecture:** Wheel spin and edge physics live in `CorrectedRaycastVehicle` (`src/vehicle/rig.ts`). A new pure module, `src/vehicle/tyre-edges.ts`, computes tyre contact with curb and wheel-stop boxes. The rig injects that contact into cannon's suspension raycast and reports a per-wheel edge state on `PhysicsSnapshot`. Lessons (`failure.ts`, `attempt.ts`) and the preview loop turn edge states into warnings and failures. Lamps follow the existing cockpit pattern: generated lit meshes toggled in `asset-scene.ts`.

**Tech Stack:** TypeScript 7, Three.js 0.187, cannon-es 0.20.0, Vitest 5, Playwright 1.64, Node generator `tools/generate-assets.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-26-vehicle-physics-effects-design.md`

## Global Constraints

- No new runtime dependencies; fixed step `1/120` s; results deterministic.
- Do not change any `profiles.ts` handling number, gear logic, brake/creep logic or the chassis collider shape.
- GLBs are regenerated (`npm run assets:generate`), never hand-edited. Vehicle GLB changes follow `docs/asset-pipeline.md`: brief, candidate outside `public`, `assets:check`, `assets:review`, then **developer approval of the candidate hash before promotion**. No auto-approved baselines.
- Budgets: <=10,000 vehicle triangles, <=4,000 parked, <=30,000 environment, <=5,000,000 bytes per pair, <=100 sandbox / <=140 lesson main-pass draw calls.
- Curb: 0.12 m tall. Wheel stop: 1.8 x 0.11 x 0.15 m (x, y, z extents).
- Brake lamps lit when `brake > 0.05`; reverse when `gear === 'R'`; turn signals use `indicatorLit`.
- All UI copy is Vietnamese, in `src/messages.ts`.
- Software tests do not prove performance or training readiness; reports must say so.

## Review Focus

1. **Route witnesses with stops.** Body overhangs legitimately pass over a 0.11 m stop, so a plan-view overlap check would wrongly reject every bay route. Expected: stops are checked against tyre patches, not body envelopes (Task 6).
2. **Fast approach into a stop.** At 15 km/h a tyre must still register `over` and not tunnel through. Expected: fail with `wheel-stop-mounted` (Task 6 test).
3. **Brake dive at the curb.** Hard braking next to the 0.12 m curb must not bring the chassis box into contact, which would turn a warning into a fail. Expected: no chassis contact (Task 4 test).
4. **Old saved history.** A v1 IndexedDB database must open after upgrade, with old records gaining `curbTouches: 0`. Expected: no data loss (Task 5 test).
5. **Sandbox curb touch.** A curb touch in free-drive must show the warning and must not trigger the `contact` pause. Expected: notice only (Task 5 test).

---

### Task 1: Wheel spin direction

**Files:**
- Modify: `src/vehicle/rig.ts` (`CorrectedRaycastVehicle`)
- Test: `src/vehicle/vehicle.test.ts`

**Interfaces:**
- Produces: no API change. Wheel poses from `rig.snapshot().wheelPoses` spin consistently with travel.

- [ ] **Step 1: Write the failing test** `it('spins wheels in the rolling direction for D and R', ...)` for both `IDS`. Use the existing `setup`/`run` helpers. Drive gear D (release the parking brake, request the gear with brake held, as existing tests do), take a creep throttle of 0.2 for 2 s, then repeat in R. For each wheel, compute the spin angle about the wheel's local X axis: the wheel world quaternion relative to `chassisQuat * steerYaw`, accumulated step by step with the wrap removed. Assert:
  - in D, accumulated angle `< 0` and `|angle| ≈ distance / tireRadiusM` within 10%;
  - in R, accumulated angle `> 0`, with the same magnitude check.
  (Rolling toward -Z without slip gives ωx = -v/r.)
- [ ] **Step 2: Run** `npx vitest run src/vehicle/vehicle.test.ts -t "spins wheels"`. Expected: FAIL (sign inverted), confirming the spec's suspicion. If it passes, record the measurement, keep the test as a regression, skip Step 3 and commit the test only.
- [ ] **Step 3: Fix** by overriding `updateVehicle(timeStep)` in `CorrectedRaycastVehicle`. After `super.updateVehicle`, correct each wheel's `rotation` so that `deltaRotation` uses the project's forward (-Z, `chassis.quaternion.vmult((0,0,-1))`), keeping cannon's magnitude. Do not touch forces.
- [ ] **Step 4: Run** `npx vitest run src/vehicle`. Expected: all PASS, with no other vehicle test changed.
- [ ] **Step 5: Commit** `fix(vehicle): spin wheels in the direction of travel (#11)`.

### Task 2: Exterior lamps (asset gate)

**Files:**
- Modify: `tools/asset-designs/vehicles.mjs` (sedan and CUV exterior), `src/render/asset-scene.ts`, `src/render/parked-vehicle.ts`
- Test: `src/render/asset-scene.test.ts`, `src/render/parked-vehicle.test.ts`, the generator/loader tests named by `docs/asset-pipeline.md`

**Interfaces:**
- Produces: `export function exteriorLampState(t: VehicleTelemetry): { brake: boolean; reverse: boolean; left: boolean; right: boolean }` in `asset-scene.ts`.
- Optional nodes under `Exterior`: `BrakeLampsLit` (left, right and centre high-mount), `ReverseLampsLit`, `TurnSignalLeftLit` (front and rear), `TurnSignalRightLit`. Each is one batched mesh, hidden by default.

- [ ] **Step 1: Record the asset brief and impact table** in the session workspace, per `docs/asset-pipeline.md` (target: both vehicles, exterior; feature: telemetry lamps; runtime owner: `asset-scene.ts`). Capture a baseline review before editing.
- [ ] **Step 2: Write failing tests:**
  - `exteriorLampState` returns `brake` false at 0.05 and true at 0.06. `reverse` is true only in R. `left` equals `indicatorLit(t, 'left')` at t = 0.1 s and t = 0.4 s.
  - `createAssetScene().apply` toggles the four nodes' `visible` from the current telemetry.
  - `createParkedVehicle` hides all four nodes.
- [ ] **Step 3: Run** `npx vitest run src/render`. Expected: FAIL.
- [ ] **Step 4: Implement:**
  - Add the lit meshes in `vehicles.mjs`: bright colours, placed 3–5 mm outboard of the existing static lamp details (`lampRed`, `amber`, `lamp`).
  - Toggle them in `asset-scene.ts` next to the cockpit lamps (`cockpitControls` → find the nodes; vehicles without the nodes are untouched).
  - Hide them in `parked-vehicle.ts`.
- [ ] **Step 5: Generate the candidate and review it:** `npm run assets:generate -- --vehicle sedan --out <ws>/cand-sedan`, `npm run assets:check -- --vehicle sedan --candidate <ws>/cand-sedan`, `npm run assets:review -- --vehicle sedan --candidate <ws>/cand-sedan --out <ws>/review-sedan`. Repeat for `cuv`. Expected: checks pass, triangle and draw-call budgets are met, and captures show each lamp lit and unlit from the chase view.
- [ ] **Step 6: STOP for developer approval.** Present the captures and candidate hashes. Promote only the approved GLBs into `public/assets/vehicles`, then run `npm run assets:check` and `npm test`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(vehicles): telemetry-driven exterior lamps (#11)`, including the regenerated GLBs and catalog/provenance updates.

### Task 3: Tyre-edge geometry module

**Files:**
- Create: `src/vehicle/tyre-edges.ts`, `src/vehicle/tyre-edges.test.ts`
- Modify: `src/runtime-types.ts` (`ColliderBox.kind` adds `'wheel-stop'`; new types below), `src/contracts.ts` (`ScenarioCollider.kind` adds `'wheel-stop'`)

**Interfaces (produces):**
```ts
// runtime-types.ts
export type TyreEdgeState = 'none' | 'touching' | 'climbing' | 'over';
export interface WheelEdgeContact {
  readonly colliderId: string | null;
  readonly kind: 'curb' | 'wheel-stop' | null;
  readonly state: TyreEdgeState;
}
// tyre-edges.ts
export const TYRE_HALF_WIDTH_M = 0.1;
export interface TyreFrame {
  readonly centerM: Vec3Data;   // wheel centre, world
  readonly rollDir: Vec3Data;   // unit, horizontal, wheel forward incl. steer
  readonly axleDir: Vec3Data;   // unit, horizontal
  readonly radiusM: number;
  readonly groundY: number;     // height of the surface the wheel would sit on without edges
}
export interface TyreEdgeResult {
  readonly contact: WheelEdgeContact;
  readonly supportY: number | null;            // virtual support height for the suspension; null = no lift
  readonly normal: Vec3Data | null;            // unit, from edge corner to wheel centre
  readonly hitPointM: Vec3Data | null;         // corner contact point
  readonly lateralPenetrationM: number;        // >= 0, sidewall overlap into the face
  readonly lateralNormal: Vec3Data | null;     // horizontal, outward from the face
}
export function tyreEdge(tyre: TyreFrame, edges: readonly ColliderBox[]): TyreEdgeResult;
```

Algorithm (this is the part the tests do not fully determine). Work per edge box in its yaw-local plan frame. Let `top = centerY + halfY` and `h = top - groundY`. Evaluate three slices at axle offsets `-TYRE_HALF_WIDTH_M, 0, +TYRE_HALF_WIDTH_M`. For each slice centre `c`, find the plan distance `d` to the box rectangle, the nearest rectangle point `p` and the outward face normal `n`.
- **Centre slice inside the rectangle:** state `over`, `supportY = top`, normal up.
- **Rolling contact**, when `|n·rollDir| >= 0.5`, `d < r` and `groundY < top`: `supportY = top + sqrt(r² - d²) - r` and `normal = unit(c_xz - p_xz, sqrt(r² - d²))`. This yields the step-climb push-back ratio `d / sqrt(r²-d²)` through cannon's suspension impulse.
- **Lateral contact**, when `|n·rollDir| < 0.5` and an outer slice overlaps the rectangle: no lift, `lateralPenetrationM` = that overlap depth, `lateralNormal = n`.
- **Per wheel**, keep the highest `supportY` over all slices and boxes, and the largest penetration.
- **State:** `over` as above. Otherwise `climbing` if `supportY - groundY >= h/2`. Otherwise `touching` if any contact exists. Otherwise `none`.

- [ ] **Step 1: Write failing tests** in `tyre-edges.test.ts`, using a 0.12 m curb box and r = 0.31:
  - `none` at d = 0.4.
  - Rolling contact at first touch (`d = sqrt(2rh-h²)`): `supportY ≈ groundY` (±1e-6), state `touching`, and `normal` horizontal/vertical ratio `≈ 0.237/0.19` for h = 0.11 (the spec's 1.2× relation), within 1%.
  - `supportY` is continuous: sweeping `d` from 0.31 to 0 in 1 mm steps, the largest jump is ≤ 2 mm, and it reaches `top` at d = 0.
  - `climbing` once lift ≥ h/2; `over` with the wheel centre above the box.
  - Side approach (curb face parallel to `rollDir`) with the outer slice 0.02 m inside: `touching`, `supportY === null`, `lateralPenetrationM ≈ 0.02`.
  - The box's `kind` and `id` are copied into `contact`.
- [ ] **Step 2: Run** `npx vitest run src/vehicle/tyre-edges.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `tyreEdge` per the algorithm. Pure, allocation-light, no cannon import.
- [ ] **Step 4: Run** the same command, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(vehicle): tyre-edge contact geometry (#11)`.

### Task 4: Edge physics in the rig + roadside curb height

**Files:**
- Modify: `src/vehicle/rig.ts`, `src/world/colliders.ts`, `src/runtime-types.ts` (`PhysicsSnapshot.wheelEdges`), `tools/asset-designs/environments.mjs`, every `PhysicsSnapshot` fixture (`grep -rln "wheelPoses:" src`)
- Test: `src/vehicle/edge-physics.test.ts` (new), plus existing curb tests in `src/lessons/*.test.ts` updated for 0.12 m

**Interfaces:**
- Consumes: `tyreEdge`, `TyreFrame` (Task 3).
- Produces:
  - `ColliderCleanup.edges: readonly { box: ColliderBox; body: CANNON.Body }[]` (the curb and wheel-stop boxes).
  - `createVehicleRig(world, profile, colliderIdForBody?, edges: ColliderCleanup['edges'] = [])`.
  - `PhysicsSnapshot.wheelEdges: readonly [WheelEdgeContact, WheelEdgeContact, WheelEdgeContact, WheelEdgeContact]` (required).

- [ ] **Step 1: Write failing tests** in `edge-physics.test.ts`. Build a world with a flat ground plus one test curb (0.12 m) or stop (0.11 m) box, for both vehicles:
  - **Creep stop:** reversing at creep (no throttle) square onto a 0.11 m stop, the car comes to rest with rear wheels `touching`. It never reaches `climbing`. Final speed is < 0.05 m/s within 3 s.
  - **Momentum climb:** arriving at 3 m/s rolling (released brake, no throttle) square onto the stop, the rear wheels reach `over`.
  - **No pop:** during the momentum climb, the wheel-centre height (from `wheelPoses`) changes by ≤ 0.01 m per step.
  - **Side rub:** steering toward a curb parallel to travel at 0.5 m/s, the outer wheel is `touching` and never `climbing` for 3 s. Every `wheelEdges[i].kind === 'curb'` when touching.
  - **Brake dive:** braking at brake 1 from 2 m/s parallel to the curb, with tyres 0.02 m from its face, the rig's `onContact` never fires.
  - **Flat ground unchanged:** with `edges = []`, a 3 s creep-forward run on flat ground gives chassis poses identical to a rig built with no edge colliders in the same world (compare to 1e-9), which proves the castRay override is a no-op without edges.
- [ ] **Step 2: Run** `npx vitest run src/vehicle/edge-physics.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - In `CorrectedRaycastVehicle`, override `castRay(wheel)`. Call `super.castRay`, build a `TyreFrame` (`groundY` = cannon hit point Y, or the edge box bottom if there is no hit) and call `tyreEdge`. When `supportY` is above the cannon hit:
    - rewrite `raycastResult` (`distance`, `hitPointWorld`, `hitNormalWorld = normal`, `body` = the edge's body, `isInContact = true`);
    - recompute `suspensionLength` (clamped), `suspensionRelativeVelocity` and `clippedInvContactDotSuspension` with the same formulas as cannon-es 0.20.0 `castRay`, already covered by the file's licence header;
    - return the new depth.
  - Store each wheel's result for this step.
  - In `applyInput`, apply each lateral penetration as a force on the chassis at the wheel hit point: `F = 150000 * pen - 8000 * (v_point · lateralNormal)` along `lateralNormal`, and only when `F > 0`.
  - `snapshot()` emits `wheelEdges`. Pass `colliderCleanup.edges` from `src/render/preview.ts`.
- [ ] **Step 4: Lower the curbs:**
  - colliders: `centerM [±4.2, 0.06, 0]`, `halfExtentsM [0.15, 0.06, 16]`;
  - `environments.mjs`: `CurbLeft`/`CurbRight` to `[±4.2, 0.06, 0]` with size `[0.3, 0.12, 32]`, and the curb joint lines to y = 0.122;
  - run `npm run assets:generate`, update the curb-height expectations in the lesson tests, and update the catalog figures.
- [ ] **Step 5: Run** `npm test` and `npm run assets:check`. Expected: PASS, including `scenario-routes.test.ts` unchanged and the environment triangle budget met.
- [ ] **Step 6: Visual check.** Run the browser asset suite (`npm run test:browser -- --trace off`). Present the roadside captures (chase and cockpit near the curb) for developer approval of the environment change.
- [ ] **Step 7: Commit** `feat(physics): tyre-edge suspension and 0.12 m roadside curbs (#11)`.

### Task 5: Curb rules, warning, count and history migration

**Files:**
- Modify: `src/lessons/failure.ts`, `src/lessons/attempt.ts`, `src/contracts.ts` (`AttemptSummary.curbTouches: number`; `FailureReason` adds `'wheel-stop-mounted'`), `src/storage/attempt-history.ts`, `src/render/preview.ts`, `src/ui/screens.ts`, `src/messages.ts`
- Create: `src/lessons/edge-warnings.ts`
- Test: `src/lessons/failure.test.ts`, `src/lessons/attempt.test.ts`, `src/storage/attempt-history.test.ts`, `src/ui/ui.test.ts`, `src/render/preview.test.ts`

**Interfaces:**
- `updateFailure(scenario, profile, telemetry, colliders, contactId, wheelEdges: readonly WheelEdgeContact[], previousSpeedEnvelopeDwellS, deltaS)`. The new parameter goes after `contactId`.
- `export function curbTouchBegan(previous: readonly WheelEdgeContact[], current: readonly WheelEdgeContact[]): boolean`. Returns true when no wheel had a `curb` contact in the previous snapshot and at least one has `touching` now.
- `updateAttemptTracker(..., deltaS, curbTouchBegan = false)` increments `curbTouches`.
- New message keys: `curbTouchWarning: 'Lốp chạm lề - hãy chỉnh lái'`, `failureWheelStopMounted: 'Bánh xe vượt qua cục chặn'`, `practiceWheelStopMounted` (matching the existing practice-map pattern), `metricCurbTouches: 'Số lần chạm lề'`.

- [ ] **Step 1: Write failing tests:**
  - `updateFailure`:
    - a curb `touching` returns `event: null`;
    - curb `climbing` and curb `over` each return `curb-contact` with the curb id;
    - wheel-stop `touching` and `climbing` return `null`;
    - wheel-stop `over` returns `wheel-stop-mounted`;
    - chassis `contactId` on a curb still returns `curb-contact`.
  - `curbTouchBegan`: true on a transition, false while a touch continues, true again after a `none` gap.
  - The tracker counts 2 touches across two episodes, and `finishAttempt` reports `curbTouches: 2`.
  - Attempt history: open a v1 database seeded with a valid v1 record, then reopen it at v2. The record now has `curbTouches: 0`. A record with `failureReason: 'wheel-stop-mounted'` validates.
  - Preview: in sandbox mode a curb touch emits `curbTouchWarning` and does not pause. In lesson mode it emits the notice without failing.
  - UI: the result and history-detail screens show `metricCurbTouches` with the count. The failure and practice maps contain `wheel-stop-mounted`.
- [ ] **Step 2: Run** `npx vitest run src/lessons src/storage src/ui src/render`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - Delete `wheelTouchesCurb` and add the edge rules to `firstFailure`, after the `contactId` check.
  - Set `DATABASE_VERSION = 2`; `onupgradeneeded` from v1 adds `curbTouches: 0` to existing records via a cursor. Extend `SUMMARY_KEYS`, `FAILURE_REASONS`, and validate `curbTouches` as a finite integer ≥ 0.
  - Wire `curbTouchBegan` in the preview step loop, both to the notice and to the tracker.
  - Add the screens entries and the messages.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lessons): curb touch warning, climbing fails, history v2 (#11)`.

### Task 6: Garage wheel stops

**Files:**
- Modify: `src/lessons/scenarios.ts` (stages 1, 2, 4 `obstacles`), `tools/asset-designs/environments.mjs` (`WheelStopTemplate` under `WallsAndCurbs`, garage only, hidden), `src/world/assets.ts` (hide the template on load), `src/render/lesson-scene.ts` (clone the template for `kind === 'wheel-stop'`, never a parked car), `src/lessons/scenario-routes.test.ts`, `src/lessons/scenario-test-utils.ts`
- Test: `src/lessons/scenarios.test.ts`, `src/lessons/scenario-routes.test.ts`, `src/render/lesson-scene.test.ts`, `src/vehicle/edge-physics.test.ts`, `src/sensors/sensors.test.ts`

**Interfaces:**
- Consumes: `kind: 'wheel-stop'` (Task 3), edge physics (Task 4), failure rules (Task 5).
- Stop colliders (`halfExtentsM [0.9, 0.055, 0.075]`, `yawRad 0`):
  - `stage1-wheel-stop` at `[0, 0.055, -6.70]`;
  - `stage2-wheel-stop` at `[0, 0.055, -8.60]`;
  - `stage4-wheel-stop` at `[5.4, 0.055, -8.60]`.

- [ ] **Step 1: Write failing tests:**
  - **Touching pose inside the target:** for each stage in {1, 2, 4} × {sedan, cuv}, place the car square to the target heading so the leading tyres (front in stage 1, rear in stages 2 and 4) sit at `dx = sqrt(2rh-h²)` from the stop's near face. Assert `footprintInsideRegion(target, inset)` holds.
  - **Simulated touch:** a simulated creep approach in the lesson world ends `touching`, inside the target, with no failure event.
  - **Fast approach:** a 15 km/h approach yields `wheel-stop-mounted`.
  - **Sensors:** with the car at the touching pose, no rear sensor reading has the stop as its obstacle (sensor rays are at 0.45 m).
  - **Lesson scene:** it creates one `WheelStopTemplate` clone per stop at the collider pose, and no parked car for it.
- [ ] **Step 2: Run** `npx vitest run src/lessons src/render src/sensors src/vehicle`. Expected: FAIL.
- [ ] **Step 3: Update the route witness:**
  - exclude `kind === 'wheel-stop'` colliders from the body-envelope overlap (stops sit below both ground clearances);
  - instead, assert that the route's tyre patches (wheel centre ± `tireRadiusM` along roll, ± `TYRE_HALF_WIDTH_M` along axle) never cross a stop's near face;
  - end each route at the earlier of the target centre and the touching pose.
  Do not change spawns, targets or the existing obstacles.
- [ ] **Step 4: Implement** the stop art and the scenario colliders:
  - art: concrete body with a top chamfer and two yellow stripes, in one batched mesh;
  - add the colliders to the scenarios;
  - load the template (hidden) and clone it in the lesson scene;
  - run `npm run assets:generate`.
- [ ] **Step 5: Run** `npm test`, `npm run assets:check` and `npm run build`. Expected: PASS, with the lesson main pass ≤ 140 draw calls (check the existing draw-call test).
- [ ] **Step 6: Visual check.** Run the browser suite. Present garage captures of stages 1, 2 and 4 (chase, and cockpit while touching the stop) for developer approval of the environment change.
- [ ] **Step 7: Commit** `feat(lessons): garage wheel stops for stages 1, 2 and 4 (#11)`.

### Task 7: Cockpit verification and docs

**Files:**
- Modify: `docs/asset-pipeline.md` (exterior lamp nodes, `WheelStopTemplate`), `docs/phase-8-asset-catalog.md` (curb height, stops, lamps, triangle and draw-call figures), `README.md` if it lists features

- [ ] **Step 1: Run** `npm run test:browser -- --trace off` and `npm run test:production`. Expected: PASS. Confirm in the neutral cockpit captures that the steering wheel, speedometer needle and indicator arrows are visible. Report any that are not; do not move anchors.
- [ ] **Step 2: Update the docs** with the new nodes, dimensions and measured budgets. State that SwiftShader captures do not verify 1440p60 performance or training readiness.
- [ ] **Step 3: Commit** `docs: record issue #11 physics, lamps and stops`.
