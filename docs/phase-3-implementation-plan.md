# Park-Core Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, the owner's recorded preference) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static preview into a small drivable physics prototype: real Cannon-es `RaycastVehicle` for Sedan and CUV, safe keyboard or explicitly calibrated Gamepad input, truthful Vietnamese telemetry, measured physics gates.

**Architecture:** `vehicle/` owns profiles, COM-relative geometry, Ackermann and the rig, stepped *externally* by its caller. `world/colliders.ts` owns the world and the authored yard. `input/` owns normalization, source arbitration and cleanup. `render/preview.ts` stays the single RAF owner and assembles world + rig + controller; `render/prototype.ts` builds/poses visuals; `app.ts` stays lifecycle glue plus session-memory selection/calibration.

**Tech Stack:** Strict TypeScript, Vite, Three.js 0.187.0, exact-pinned `cannon-es` (target 0.20.0, verify installed), Vitest (real physics in Node, jsdom for DOM), Playwright Chromium + Firefox.

**Spec:** [Approved Phase 3 design](phase-3-detail-design.md) (source of truth, approved 2026-11-03); refines Tasks 2-3 of [implementation-plan.md](implementation-plan.md) and Sections 4-6 of [detail-design.md](detail-design.md).

**Date / status:** Design approved 2026-11-03. This plan is **pending owner plan review**; no Phase 3 code or dependency is installed. Baseline: `main` at `7aa24ca` (46 unit/DOM tests, six browser tests).

## Global Constraints

- Meters/kilograms/seconds/radians; Y up, X right, **-Z forward**, positive steering left, wheels FL/FR/RL/RR. HUD speed km/h.
- `h = 1/120 s`, at most eight steps per frame, wall delta clamped to 0.1 s; never increase `h`. One monotonic `now()` for startup, frames and resume. Existing `createClock` is reused unchanged.
- The world is stepped by the caller; no per-frame velocity/position writes imitating driving. Test fixtures may set initial velocity only for braking/barrier measurements.
- Profile/world/force values are copied from the product design Sections 4-5; they are unvalidated seeds. `rollInfluence = 1`, documented damping stay unless a real measured failure justifies a recorded change.
- Failed gates are reported with the measurements, never relaxed. If bounded tuning cannot meet a gate, stop that claim and escalate. A non-finite physics state raises `SimulationStateError`; it is never normalized to zero and never a learner failure.
- Exact-pinned `cannon-es` is the only new dependency. No framework, runner, DI layer, debug globals, mirrors, sensors, lessons, persistence, mouse look or pointer-lock acquisition (Phase 4).
- `AppState` lesson contract is unchanged; no fake `playing/success/fail`. Accent `#9B59B6`, no blue/orange/green accents, 44 px controls, basic materials, no shadows, 2560x1440 buffer cap, telemetry DOM <=20 Hz, notices immediate.
- Learner copy Vietnamese; identifiers English. Portable commands use `/` separators. Do not install browsers until a missing-executable failure.
- Execution requires the owner's plan approval first; a preview of this plan is not that approval.

## Review Focus

1. **Support/contact truth:** `updateWheelTransformWorld` clears `wheel.isInContact`, and non-finite state hides as zero. Contact flags are captured before the render refresh; bad state throws. Tests: Task 1 (`supports()` ordering, `SimulationStateError`), Task 3 (startup error cleanup).
2. **Wrong reference geometry:** rear-axle center is COM **minus** world-forward x `f*L`; a plus sign would pass a lenient radius check. Tests: Task 1 (`rearAxleCenter`, circle-fit radius both profiles).
3. **Stale held input:** blur, disconnect, device replacement, source switch or stale key survives and a pedal/key drives on resume. Tests: Task 2 (controller), Task 3 (`resume()` boolean, queue clearing, contact stop), Task 4 (DOM/browser).
4. **Tunnelling/frame-rate dependence:** an eight-step slow frame crosses the 0.1 m barrier, or 30/60/144 schedules diverge. Tests: Task 1 (real contact + no crossing, three schedules), Task 3 (contact stops the session once).
5. **Lifecycle leakage:** world/Cannon listeners, calibration RAF, input listeners or a stale async open survive reset/menu/context loss/startup failure. Tests: Task 3 (exactly-once disposal incl. startup failure, ten cycles), Task 4 (calibration RAF, generation tokens).

## File ownership map

| Files | Task | Responsibility |
|---|---|---|
| `package.json`, `package-lock.json` | 1 | Exact `cannon-es` |
| `src/vehicle/profiles.ts`, `geometry.ts`, `steering.ts`, `rig.ts`, `vehicle.test.ts` | 1 | Profiles, derived geometry, Ackermann/keyboard ramp, rig, real-engine tests/measurements |
| `src/world/colliders.ts` | 1 | World, authored yard, collider add/remove |
| `docs/phase-3-measurements.md` | 1 (create), 3-4 (append) | Actual measured values, package versions, browser/blocked gates |
| `src/input/calibration.ts`, `controller.ts`, `input.test.ts` | 2 | Normalization, validation, source ownership, actions, neutral check |
| `src/render/prototype.ts`, `preview.ts`, `preview.test.ts` | 3 | Scene from collider metadata, interpolation/camera, single-RAF integration |
| `src/runtime-types.ts`, `src/messages.ts` | 3 (types/messages for Task 3 behavior), 4 (UI messages) | Types and finite Vietnamese keys |
| `src/app.ts`, `src/app.test.ts` | 3 (compile/resume/options), 4 (selection, calibration glue) | Glue |
| `src/ui/screens.ts`, `hud.ts`, `ui.test.ts`, `src/style.css` | 4 | Controls, calibration, HUD |
| `tests/browser/driving.spec.ts` (+ update `shell.spec.ts` copy) | 4 | Real-browser prototype |
| `docs/implementation-plan.md` etc. | Doc step of Task 4 | Mark Tasks 2-3 implemented only after verification |

Shared contracts (`contracts.ts`: `VehicleProfile`, `InputFrame`, `InputAction`, `ControllerCalibration`, `PedalBinding`, `SpawnPose`, `BodyPose`) are consumed unchanged. `PhysicsSnapshot`, `ColliderBox`, `InputPoll`, `ControlNotice` keep their original fields.

## Task 1: Real vehicle rig, yard and measured physics

**Setup:** `npm install --save-exact cannon-es@0.20.0`; record and verify the installed version.

**Files:** see map (Task 1 rows). Modify `src/messages.ts` only to add `gearRejected`.

**Interfaces consumed:** `VehicleProfile`, `InputFrame`, `InputAction`, `SpawnPose`, `BodyPose`, `ColliderBox`, `PhysicsSnapshot`, `ControlNotice`, `createClock`.

**Interfaces produced (exact):**
```ts
// profiles.ts
export const profiles: Readonly<Record<VehicleId, VehicleProfile>>;
// geometry.ts
export interface LocalBox { readonly centerLocalM: Vec3Data; readonly halfExtentsM: Vec3Data }
export interface VehicleGeometry {
  readonly frontAxleZ: number; readonly rearAxleZ: number;
  readonly wheelMountsLocalM: readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data];
  readonly chassis: LocalBox; readonly mirrors: readonly [LocalBox, LocalBox];
  readonly driverEyeLocalM: Vec3Data;
}
export function deriveGeometry(profile: VehicleProfile): VehicleGeometry;
export function rearAxleCenter(pose: BodyPose, profile: VehicleProfile): Vec3Data; // COM - worldForward*f*L
export function vehicleFootprint(pose: BodyPose, profile: VehicleProfile):
  readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data];
// steering.ts
export function ackermann(s: number, profile: VehicleProfile): readonly [number, number];
export function stepKeyboardSteering(current: number, target: number, h: number): number;
// world/colliders.ts
export function createWorld(): CANNON.World;
export const prototypeYard: readonly ColliderBox[];
export const prototypeSpawn: (profile: VehicleProfile) => SpawnPose;
export function addColliderBoxes(world: CANNON.World, boxes: readonly ColliderBox[]): () => void;
// rig.ts
export class SimulationStateError extends Error {
  constructor(readonly reason: 'non-finite' | 'settle-failed' | 'settle-contact');
}
export interface VehicleRig {
  readonly body: CANNON.Body; readonly vehicle: CANNON.RaycastVehicle;
  settle(spawn: SpawnPose): void;
  applyInput(frame: InputFrame, actions: readonly InputAction[], h: number): readonly ControlNotice[];
  snapshot(simulationTimeS: number): PhysicsSnapshot;
  supports(): readonly [boolean, boolean, boolean, boolean];
  onContact(listener: () => void): () => void;
  dispose(): void;
}
export function createVehicleRig(world: CANNON.World, profile: VehicleProfile): VehicleRig;
```
`applyInput` only sets engine force/brake/steering for the next step and never steps the world; keyboard frames (`frame.source === 'keyboard'`) carry a direction target in {-1,0,1} that the rig ramps at fixed-step time via `stepKeyboardSteering` (+1 unit/s away from centre, -1.5 units/s recentering); gamepad frames map directly. `supports()` returns the flags captured by the latest `snapshot()` *before* wheel transforms refresh. `onContact` fires on `beginContact` of the chassis body (chassis and mirror shapes) with any static box; wheel rays are not contacts. `settle` steps <=360 times, then requires finite state, four supports, no chassis contact, and no velocity growth, keeps the settled Y, clears velocity/forces, and throws `SimulationStateError`. Snapshot tuples are fresh immutable values.

- [ ] **Step 1: Write failing geometry/steering tests (no engine).**
```ts
it('derives COM-relative geometry', () => {
  const g = deriveGeometry(profiles.sedan);
  expect(g.frontAxleZ).toBeCloseTo(-1.215, 4);
  expect(g.rearAxleZ).toBeCloseTo(1.485, 4);
  expect(g.wheelMountsLocalM[0][1]).toBeCloseTo(0.01506, 4);
  expect(g.wheelMountsLocalM[2][1]).toBeCloseTo(0.01643, 4);
  expect(deriveGeometry(profiles.cuv).wheelMountsLocalM[0][1]).toBeCloseTo(-0.02903, 4);
  expect(g.mirrors[0].halfExtentsM[0]).toBeCloseTo(0.06, 4); // (2.04-1.80)/4
});
it('rear axle is behind COM along world forward', () => {
  const yaw90 = { positionM: [0, 0.5, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] } as const;
  const p = rearAxleCenter(yaw90, profiles.sedan); // forward is -X after +90 deg yaw
  expect(p[0]).toBeCloseTo(1.485, 4); expect(p[2]).toBeCloseTo(0, 4);
});
it('Ackermann full lock', () => {
  const [l, r] = ackermann(1, profiles.sedan);
  expect(l).toBeCloseTo(0.6916, 3); expect(r).toBeCloseTo(0.5105, 3);
  expect(ackermann(0, profiles.sedan)).toEqual([0, 0]);
  const [rl, rr] = ackermann(-1, profiles.sedan);
  expect(rl).toBeCloseTo(-r, 6); expect(rr).toBeCloseTo(-l, 6);
});
it('keyboard steering ramps at fixed-step time', () => {
  let s = 0; for (let i = 0; i < 60; i++) s = stepKeyboardSteering(s, 1, 1 / 120);
  expect(s).toBeCloseTo(0.5, 6);
  for (let i = 0; i < 40; i++) s = stepKeyboardSteering(s, 0, 1 / 120);
  expect(s).toBeCloseTo(0, 6);
});
```
Also: CUV full-lock `0.6949/0.5086`; `vehicleFootprint` includes mirror width and rotated poses (`profile.mirrorWidthM / 2` lateral, front/rear extents 2.115/2.485 for Sedan).
- [ ] **Step 2: Write failing real-engine tests** in the same file using `createWorld`, `addColliderBoxes(prototypeYard)`, `createVehicleRig`, helper `run(rig, world, frame, actions, seconds)` that calls `applyInput`, `world.step(h)`, `snapshot` per step. Cover, for **both profiles**:
  - Axis/sign: `D` creep moves along **-Z** (`signedSpeedMps > 0`), `R` along +Z; positive steering turns left (heading increases, X decreases).
  - Support/contact (Review Focus 1): after step+`snapshot`, `supports()` is `[true,true,true,true]`; a freshly lifted rig (body y=3) reports all false; reading `vehicle.wheelInfos[i].isInContact` after `snapshot` is `false`, proving ordering matters. A NaN body position makes `snapshot` throw `SimulationStateError` with reason `'non-finite'`.
  - Settle: finite, four supports, no chassis-ground contact, vertical oscillation amplitude over the following 3 s not growing (compare first vs last second peak-to-peak).
  - Interlocks: gear request at 0.5 m/s or brake 0.1 returns a `gearRejected` notice and keeps gear; accepted at rest with brake 0.2; throttle with brake >0.02 or parking brake produces no propulsion; R/D never releases parking brake.
  - Holds: P and parking brake (separately, at rest) drift `<=0.02` m over 60 s; per-wheel brake impulses equal `mass*g/4*h` (Sedan 29.634) for P and `mass*g/2*h` (59.269) on rear wheels for parking brake; maximum, not sum.
  - Creep: after 6 s D reaches 0.83 m/s +/-0.1 and R -0.56 +/-0.1 (signed speed).
  - Braking: set initial 5 km/h fixture velocity, full brake; horizontal travel from brake application until speed `<0.05` m/s is `<=0.5` m.
  - Turn radius: full lock at <=1 m/s, circle-fit (algebraic least squares) of `rearAxleCenter` samples after a 4 s transient; radius within 5% of `wheelbase/tan(delta)` (4.041 Sedan, 3.906 CUV).
  - Schedules: run the Creep scenario through the production clock at 30, 60 and 144 fps; elapsed simulated time equals 6 s within one step and speed within 0.1 m/s of the others' mean; no bit-identical claim.
  - Barrier (Review Focus 4): place the settled fixture with its chassis front 0.02 m before the barrier near face, initialize velocity at 15 km/h toward `-Z`, then run eight-step 0.1 s frames against the barrier from `prototypeYard`: `onContact` fires, and chassis front (`COM.z - frontExtent`) never passes the barrier far face at any step. Sample every substep, not just rendered endpoints.
- [ ] **Step 3: Run red.** `npm test -- src/vehicle/vehicle.test.ts`; expect missing-module failures, not tooling errors.
- [ ] **Step 4: Implement.** Copy profile/world values from product design Sections 4-5 exactly (not from examples). Explicitly set axis indices 0/1/2, direction `(0,-1,0)`, axle `(1,0,0)`, radius, rest length, travel, stiffness, damping, max force, friction slip, roll influence; signed speed uses world-transformed `(0,0,-1)`. Propulsion splits over the front wheels using the product formulas (linear pedal map, taper 12->15 km/h, creep controller, resistance capped so it cannot reverse velocity, brake inhibition above 0.02). Brake per wheel is `max(service, P, parking) * h` with P `mass*g/4`, parking rear `mass*g/2`. Yard: ground box centre `(0,-0.5,0)` half `(20,0.5,20)`; four walls half-thickness 0.05 (height 2) at x/z = +/-20; a barrier `id:'barrier'` kind `'obstacle'` centre `(0,0.5,-10)` half `(4,0.5,0.05)`; spawn `(0, COMHeight, 4)` yaw 0 (designer choices, not owner coordinates). `addColliderBoxes` returns a remover; the rig's `dispose()` removes vehicle, body and listeners once.
- [ ] **Step 5: Run green, tune only on measured failure.** `npm test -- src/vehicle/vehicle.test.ts`, `npm run typecheck`, `npm run build`. A failing gate: keep its numbers, adjust only documented seeds (`rollInfluence`, damping, suspension) within the design's discretion, remeasure *every* affected gate and both profiles; if still failing, stop and escalate.
- [ ] **Step 6: Record evidence.** Create `docs/phase-3-measurements.md` with installed `cannon-es` version and every measured value (creep, braking, holds, radius, settle, barrier, schedules) plus any tuning rationale; mark browser/hardware/performance gates pending.
- [ ] **Step 7: Commit** `package.json`, lockfile, `src/vehicle/*`, `src/world/colliders.ts`, `src/messages.ts`, `docs/phase-3-measurements.md`. Message `feat: add real vehicle rig and measured physics` plus the Copilot trailer:
```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Task 2: Safe input normalization and controller

**Files:** `src/input/calibration.ts`, `controller.ts`, `input.test.ts`; `src/messages.ts` (keys below).

**Interfaces consumed:** `InputFrame`, `InputAction`, `InputSource`, `Indicator`, `ControllerCalibration`, `PedalBinding`, `InputPoll`, `MessageKey`.

**Interfaces produced (exact):**
```ts
// calibration.ts
export function normalizePedal(raw: number, binding: PedalBinding): number;           // [0,1]
export function normalizeSteering(raw: number, calibration: ControllerCalibration): number; // [-1,1]
export function validateCalibration(value: unknown): ControllerCalibration | null;   // caller shows a notice on null
// controller.ts
export interface InputController {
  poll(): InputPoll;
  enqueue(action: InputAction): void;
  selectSource(source: InputSource, index?: number): void;
  setCalibration(value: ControllerCalibration): void;
  clear(): void;
  checkNeutral(): MessageKey | null;   // null = ready to resume; otherwise the explicit reason
  dispose(): void;
}
export function createInputController(
  target: HTMLElement, getGamepads: () => readonly (Gamepad | null)[],
): InputController;
```
Normalizers throw `RangeError` for non-finite or out-of-range (|raw|>1) samples; the controller turns that into an issue and never into 0. Pedal `(raw-released)/(pressed-released)` clamped; steering is piecewise about the centre toward each endpoint (positive toward the left endpoint, any raw ordering), then dead zone 0.02 with `(|s|-0.02)/0.98` rescale. `validateCalibration` requires version 1, string device id, integer indices 0..63, finite values in [-1,1], centre strictly between steering endpoints, `|pressed-released|>=0.1` (builder discretion) per pedal, button pedals within [0,1], and distinct reverse/drive buttons; throttle and brake may share an axis index.

New `MessageKey`s (Vietnamese text; names fixed here): `keyboardFocusLost`, `controllerDisconnected`, `controllerReplaced`, `controllerUnavailable`, `controllerNeedsSetup`, `controllerControlsMissing`, `controllerInvalid`, `pedalsNotReleased`, `keysNotReleased`, `invalidCalibration`.

Controller semantics: keyboard is default; it listens on `target` for keydown/keyup/blur with one `AbortController`. W/Up throttle, S/Down brake, A/Left (+1) and D/Right (-1) cancelling to 0, Digit1-4 gear requests, Space `toggle-parking-brake` on non-repeat keydown, Q/E `set-indicator` carrying the *desired* indicator from an internal intent (second press -> `off`, other key replaces). Events whose `target` is editable (input/select/textarea/contenteditable) or carry ctrl/meta/alt are ignored; `preventDefault` only for handled unmodified driving keys. Escape is **not** handled here (the preview owns it). Repeat keydowns do not re-trigger. Keyboard polling requires `target.ownerDocument.activeElement === target`; otherwise return `keyboardFocusLost`. With keyboard selected, blur sets that pending issue, marks held movement keys *suppressed* until their keyup or a fresh (non-repeat) press, and clears the queue. With gamepad selected, canvas blur to a normal HUD button must not clear gamepad state or report keyboard focus loss. `poll()` returns zero frame, `actions: []` and an `issue` whenever the source is invalid; otherwise normalized frame plus drained actions. Gamepad: only the selected index/`calibration.deviceId` is read; missing pad -> `controllerDisconnected`, different `id` at that index -> `controllerReplaced`, provider throw -> `controllerUnavailable`, no calibration -> `controllerNeedsSetup`, absent axes/buttons -> `controllerControlsMissing`, bad samples -> `controllerInvalid`. Reverse/drive buttons emit `request-gear` R/D on rising edge only; a button already held at the first poll after select/clear is treated as held. `enqueue` of `set-indicator` updates intent; `clear()` drops queue, held/pending state (suppressing held movement keys) but keeps indicator intent; `selectSource` clears. `checkNeutral()` reads live raw/normalized pedals (not a focus-zeroed frame): gamepad pedals >0.02 -> `pedalsNotReleased`, any held/suppressed movement key -> `keysNotReleased`, plus the gamepad issues above.

- [ ] **Step 1: Write failing normalization tests.**
```ts
const wheel = { version: 1, deviceId: 'w', steeringAxis: 0, steeringLeft: -0.6,
  steeringCenter: 0.1, steeringRight: 0.9,
  throttle: { kind: 'axis', index: 1, released: 1, pressed: -1 },
  brake: { kind: 'button', index: 6, released: 0, pressed: 1 },
  reverseButton: 4, driveButton: 5 } as const;
it('maps inverted axis pedals and asymmetric steering', () => {
  expect(normalizePedal(1, wheel.throttle)).toBe(0);
  expect(normalizePedal(-1, wheel.throttle)).toBe(1);
  expect(normalizePedal(0, wheel.throttle)).toBeCloseTo(0.5, 6);
  expect(normalizeSteering(-0.25, wheel)).toBeCloseTo(0.4898, 3);
  expect(normalizeSteering(0.1, wheel)).toBe(0);
  expect(normalizeSteering(0.5, wheel)).toBeCloseTo(-0.4898, 3);
});
it('rejects unsafe samples/calibrations visibly', () => {
  expect(() => normalizePedal(Number.NaN, wheel.brake)).toThrow(RangeError);
  expect(() => normalizeSteering(1.5, wheel)).toThrow(RangeError);
  expect(validateCalibration({ ...wheel, steeringCenter: -0.6 })).toBeNull();
  expect(validateCalibration({ ...wheel, driveButton: 4 })).toBeNull();
  expect(validateCalibration({ ...wheel, brake: { ...wheel.brake, pressed: 0.05 } })).toBeNull();
  expect(validateCalibration({ ...wheel, steeringAxis: 1.5 })).toBeNull();
  expect(validateCalibration(wheel)).toEqual(wheel);
});
```
Also a shared-axis combined-pedal calibration is accepted.
- [ ] **Step 2: Write failing controller tests** (jsdom, fake `getGamepads`): keyboard frame `{source:'keyboard',throttle:1,brake:0,steering:0}` for W+A+D; Space repeated keydown -> one toggle; Q,Q gives `set-indicator left` then `off`, E after Q replaces; keys typed into an `<input>` child or with ctrl ignored; blur -> next poll `issue === 'keyboardFocusLost'`, zero frame, empty actions; stale held W after blur blocks `checkNeutral()` (`keysNotReleased`) until keyup or fresh press; a released-then-held shoulder gives exactly one `request-gear R`, while an initially held shoulder gives none; gamepad frame never contains keyboard throttle and keyboard keys are ignored while gamepad is selected; disconnect, replaced device, throwing provider, NaN sample and missing control each produce their issue with zero frame/actions and no keyboard substitution; `selectSource` clears queued actions; `checkNeutral` returns `pedalsNotReleased` at throttle 0.03 and `null` at 0.02; after idempotent `dispose()`, synthetic key/focus/device events cannot mutate input or enqueue actions (AbortSignal cleanup need not call a spied `removeEventListener`).
- [ ] **Step 3: Run red.** `npm test -- src/input/input.test.ts`.
- [ ] **Step 4: Implement** both modules, minimal and without new `InputAction` variants.
- [ ] **Step 5: Run green.** `npm test -- src/input/input.test.ts`, `npm run typecheck`, `npm run build`.
- [ ] **Step 6: Commit** `src/input/*`, `src/messages.ts`; message `feat: add safe keyboard and gamepad input controller` plus the Copilot trailer.

## Task 3: Integrated drivable prototype (renderer, loop, lifecycle)

**Files:** `src/render/prototype.ts`, `preview.ts`, `preview.test.ts`; modify `src/runtime-types.ts`, `src/messages.ts`, `src/app.ts`, `src/app.test.ts`, `tests/browser/shell.spec.ts` (copy only).

**Interfaces consumed:** Task 1 `createWorld`, `addColliderBoxes`, `prototypeYard`, `prototypeSpawn`, `createVehicleRig`, `deriveGeometry`, `profiles`, `SimulationStateError`; Task 2 `createInputController`; `createClock`, `fitDrawingBuffer`.

**Interfaces produced (exact; `createPreview` keeps its first three parameters; typed prototype options take the fourth position and the existing dependency overrides move to fifth; update all callers/mocks):**
```ts
// runtime-types.ts
export type PreviewPauseReason = 'user' | 'focus' | 'controller' | 'contact';
export interface ShellView { readonly state: AppState; readonly preview: PreviewPhase;
  readonly calibrating?: boolean; readonly pauseReason?: PreviewPauseReason | null }
// ScreenAction gains payload-free { type: 'pause' } and { type: 'reset-preview' },
// and { type: 'input-action'; action: InputAction } for gear/parking/indicator buttons.
// render/prototype.ts
export interface PrototypeScene {
  readonly scene: THREE.Scene;
  apply(frame: RenderFrame, camera: THREE.PerspectiveCamera): void; // interpolates chassis, wheels, camera from one frame
  dispose(): void;
}
export function buildPrototypeScene(profile: VehicleProfile, boxes: readonly ColliderBox[]): PrototypeScene;
// render/preview.ts
export interface PrototypeOptions {
  readonly vehicleId: VehicleId; readonly source: InputSource; readonly gamepadIndex: number | null;
  readonly calibration: ControllerCalibration | null;
  readonly getGamepads: () => readonly (Gamepad | null)[];
}
export interface PreviewEvents {
  onPaused(reason: PreviewPauseReason): void;
  onFault(kind: 'context-lost' | 'runtime-error', error?: unknown): void;
  onTelemetry(telemetry: VehicleTelemetry): void; // <=20 Hz
  onNotice(messageKey: MessageKey): void;          // immediate
}
export interface PreviewDeps { /* existing members */ createWorld(): CANNON.World }
export interface Preview {
  resume(): boolean; pause(): void; enqueue(action: InputAction): void;
  selectSource(source: InputSource, index?: number): void; // only while paused
  setCalibration(value: ControllerCalibration): void;
  dispose(): void;
}
export function createPreview(canvas: HTMLCanvasElement, container: HTMLElement,
  events: PreviewEvents, prototype: PrototypeOptions,
  overrides?: Partial<PreviewDeps>): Preview;
```
`PreviewStartError.reason` gains `'simulation-failed'`; app maps it to a retryable `physicsStartFailed` error. `createPreview` builds renderer, world, colliders, rig, scene and controller, settles **off-screen before any poll**, renders one frame and returns **paused** (no RAF, no event); the app then calls `resume()`, which is the single neutral/hidden-document gate. Every partially built resource is cleaned on any startup failure (exactly once). `resume()` returns `false` (no state change) when disposed, faulted, hidden, contact-stopped, already running, or `checkNeutral()` is non-null (then `onNotice(reason)`); on `true` it clears the clock, takes a fresh `now()`, drops stale queues and starts the RAF. `pause()` stops RAF, resets the clock, clears controller and pending frame actions and emits `onPaused('user')`; focus/visibility/window blur emit `'focus'`, a controller issue emits `'controller'` plus `onNotice(issue)`, an Escape keydown on `container` (not editable targets, no modifiers; works with either source) emits `'user'`. A focusin on an editable element inside `container` while running pauses (`'focus'`). Per frame: poll once; an issue or `pause`/`help` action pauses **before** stepping; continuous input is cached for substeps; discrete actions stay pending until the first fixed step, are applied once, later substeps get `[]`; notices from `applyInput` go to `onNotice`. After each step `rig.snapshot` feeds previous/current; a `SimulationStateError` is a `'runtime-error'` fault. Contact (installed after settle) stops: RAF off, clear, `onPaused('contact')`, `onNotice('contactStop')`; only a fresh preview (app Reset/Menu) continues. Camera: fixed external follow `(0, 3.5, 8)` local offset looking at the chassis; no mouse look.

- [ ] **Step 1: Write failing preview tests** (jsdom; fake renderer/RAF/clock as existing; **real** rig; `createWorld` override records `addEventListener/removeEventListener`). Update existing expectations deliberately (starts paused; `onPaused(reason)`; resume returns boolean; new options argument):
  - Created preview is paused, rig settled (`onTelemetry` not yet called), one frame rendered, zero pending RAF; `resume()` returns `true` once and `false` while running.
  - Scene meshes derive from `prototypeYard` metadata (ground + barrier box sizes) and four wheel meshes track `snapshot().wheelPoses`.
  - Keyboard: hold S while pressing Digit4, release S, edge-press Space to release parking brake, then hold W; after 120 frames at 60 fps `telemetry.signedSpeedMps` > 0 and `pose.positionM[2]` < 4 (no scripted motion).
  - Review Focus 3: with gamepad throttle 0.03 `resume()` is `false` and `onNotice('pedalsNotReleased')`; hidden document is `false` without UI success; queued `request-gear` applied exactly once on the first step then `[]`; a controller issue pauses with zero steps taken that frame; pause/reset clear queues; source change while running throws.
  - Review Focus 4: a Sedan fixture placed 0.02 m before the barrier and initialized at 15 km/h toward it with 0.1 s frames triggers one `onPaused('contact')` + `contactStop` notice and `resume()` stays `false`.
  - Review Focus 1/5: NaN physics state yields `onFault('runtime-error')`; forced `SimulationStateError` from `settle` yields `PreviewStartError('simulation-failed')` with renderer disposed, context loss forced, world listeners removed; ten open/dispose cycles leave zero world/window/document/canvas listeners and zero live renderers; context loss disposes world listeners once; `dispose()` twice is harmless.
  - Existing resize, WebGL failure, context-loss, generation, and real-pixel (browser) coverage stays.
- [ ] **Step 2: Write failing app tests.** Fake previews gain the new members; `resume: vi.fn(() => true)`. The app calls `resume()` right after assignment; a `false` result renders paused with the notice; `resume` result `false` keeps Paused UI; Reset reopens a fresh preview without carrying actions (new `createPreview` call, old one disposed first); `physicsStartFailed` maps to a retryable error; stale async open still disposes.
- [ ] **Step 3: Run red.** `npm test -- src/render/preview.test.ts src/app.test.ts`.
- [ ] **Step 4: Implement** `prototype.ts`, evolve `preview.ts`, update `app.ts` minimally (options, resume gate, reset action, `pauseReason`). Copy Task 1/2 interfaces; visuals are `MeshBasicMaterial` boxes from collider metadata, chassis/mirror boxes from `deriveGeometry`, wheel cylinders as non-physical meshes. Add messages `physicsStartFailed`, `contactStop`, `gearRejected` copy, “Lái thử mô hình”, “Bản thử vật lý — chưa có bài học” (replacing the old preview strings and updating `shell.spec.ts` copy), and the generic-parameter/hardware disclaimer.
- [ ] **Step 5: Run green.** `npm test` (whole suite), `npm run typecheck`, `npm run build`; `git diff --check`.
- [ ] **Step 6: Commit** the listed files; message `feat: integrate drivable physics prototype into preview` plus the Copilot trailer.

## Task 4: Controls, calibration UI, telemetry and browser acceptance

**Files:** `src/ui/screens.ts`, `hud.ts`, `ui.test.ts`, `src/style.css`, `src/app.ts`, `src/app.test.ts`, `src/messages.ts`, `tests/browser/driving.spec.ts`, `docs/phase-3-measurements.md`, and the documentation status updates listed below.

**Interfaces consumed:** Task 3 `Preview`, `PrototypeOptions`, `ShellView`, `ScreenAction`; Task 2 `validateCalibration`.

**Interfaces produced (exact):**
```ts
// ui/hud.ts  (replaces the unmount-function return; Phase 4 may add a sensors argument later)
export interface Hud {
  update(telemetry: VehicleTelemetry | null, source: InputSource): void;
  setDriveControls(visible: boolean): void;  // gamepad P/R/N/D, parking brake, indicators
  dispose(): void;
}
export function mountHud(root: HTMLElement, onAction: (action: ScreenAction) => void): Hud;
// ui/screens.ts
export function mountCalibration(
  root: HTMLElement, selectedIndex: number,
  getGamepads: () => readonly (Gamepad | null)[],
  onComplete: (value: ControllerCalibration) => void, onCancel: () => void,
): () => void;
// app.ts
export interface AppDeps { createPreview: typeof createPreview;
  getGamepads: () => readonly (Gamepad | null)[] } // default: navigator.getGamepads() read at every call
```
Behavior: HUD shows real speed (rounded km/h), gear, parking brake, service brake, indicators and source status at <=20 Hz; sensor/lesson/overhead containers stay hidden and empty. Keyboard users use canvas keys; with gamepad selected the HUD exposes semantic P/R/N/D, parking-brake and indicator buttons (clicking them keeps gamepad polling) plus Pause/Reset/Menu native buttons always. Menu/Paused offer source and device selectors (session memory: selected source/index and `Map<deviceId, ControllerCalibration>`; no Storage). An unverified gamepad disables start/resume and shows a calibrate action; keyboard is never an automatic fallback. Help text lists controls (not lessons). `mountCalibration` owns one bound RAF that polls raw values only while it is mounted (driving polls are stopped because it opens from Menu/Paused); it shows live axes/buttons, lets the learner capture steering left/centre/right, each pedal released/pressed and reverse/drive button presses (prefilled indices for `mapping === 'standard'` still require capture; changing a binding clears that control's captures); disconnect or invalid sample shows an error and disables Save; Save passes `validateCalibration(draft)` (a `null` shows `invalidCalibration`); Escape or Cancel calls `onCancel` and the app stays paused; unmount aborts listeners and cancels the RAF once and restores focus. Disconnect while running arrives as `onPaused('controller')` plus a notice.

Verification is tied to the currently observed device connection, not just its ID. On disconnect/replacement (including while Menu/Paused), invalidate its verified status; saved session endpoints may prefill setup but reconnect always requires explicit verification. Use connection/disconnection events plus live validation on selection/start/resume, not another paused driving-poll RAF. Detect a disconnected/replaced device during calibration, invalidate all captures and block Save until verification restarts for the new connection. A same-ID reconnect is not implicitly trusted. Focus the canvas before a successful keyboard start/resume without discarding held-key suppression.

- [ ] **Step 1: Write failing UI/app tests** (jsdom): HUD updates throttled (frames at 50 ms boundaries), unhidden telemetry only, hidden/empty lesson/sensor/overhead nodes, no Storage access; gamepad HUD buttons emit `input-action` with `request-gear D`, `toggle-parking-brake`, `set-indicator left`; unverified gamepad disables start/resume and shows calibrate; calibration: indices prefilled but Save disabled until captures, rebinding clears captures, NaN/disconnect disables Save with visible error, device replacement invalidates captures, same-ID reconnect requires verification (running and paused cases), cancel keeps paused, unmount leaves zero pending RAF and listeners, Escape cancels without `onComplete`; source/device selectors work only in Menu/Paused and call `selectSource/setCalibration`; physical brake held plus HUD gear click succeeds without focus-zeroing the brake; contact stop shows only Reset/Menu; resume refusal keeps Paused and shows the neutral notice.
- [ ] **Step 2: Run red.** `npm test -- src/ui/ui.test.ts src/app.test.ts`.
- [ ] **Step 3: Implement** UI/HUD/CSS/app glue (44 px controls, focus tokens, `#hud` buttons `pointer-events:auto`, no new tokens/colors).
- [ ] **Step 4: Run green.** `npm test`, `npm run typecheck`, `npm run build`.
- [ ] **Step 5: Write and run browser tests** `tests/browser/driving.spec.ts` (Chromium **and** Firefox; install browsers only after a missing-executable failure): real prototype motion (Digit4 with brake, parking-brake toggle by Space, HUD shows >0 km/h creep, brake stops), gear rejection notice at speed, Pause/Resume/Reset/Menu, canvas focus vs. DOM control (typing in a control never drives), blur pause + explicit resume with stale key blocked, injected gamepad via `page.addInitScript` overriding `navigator.getGamepads` (calibrate, drive, disconnect pause, no keyboard fallback), real contact stop at the barrier, resize and repeated open/close, and context-loss recovery. Real software WebGL is acceptable for functionality only; if rendering is unavailable record the gate **blocked**, never skipped/passed. `npm run test:browser`.
- [ ] **Step 6: Final verification and documentation.** Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser`, `git diff --check`. Append actual browser results, versions and blocked/pending gates (real wheel hardware, reference-PC performance, Windows, assets, instructor review) to `docs/phase-3-measurements.md`. Only now mark Tasks 2-3 of `implementation-plan.md`, the Phase 3 status and the Phase 2 resume-race resolution as implemented, with actual counts.
- [ ] **Step 7: Commit** all touched files; message `feat: add controls, calibration and telemetry to physics prototype` plus the Copilot trailer. Then request **one fresh final review** of the whole branch (no per-task review agents).

## Execution and routing

Selected method: **Native** parent thread (shared rig/preview/app interfaces; fewest coordination hand-offs). Tier routing from the owner: **Premium** for Task 1 physics (rig, measured tuning, any gate escalation); **Standard** for Tasks 2-3 and Task 4 calibration/lifecycle/integration/test authoring; **Lightweight** only for repetitive Task 4 CSS/DOM scaffolding after its typed decisions are fixed. Use bounded specialists only for those tier-specific pieces; never duplicate implementation/review passes. Tasks 1 and 2 have no dependency on each other; Task 3 requires both, and Task 4 requires Task 3. Execute sequentially 1, 2, 3, 4.

## Spec coverage

| Phase design | Task |
|---|---|
| 4 physics, geometry, spawn/snapshots, tuning | 1 |
| 5 input, calibration (logic), neutral/resume | 2, 3 |
| 5 calibration UI, controller setup, focus/Escape | 3 (Escape/focus), 4 |
| 6 presentation, safety stop, disposal | 3, 4 |
| 7 verification and evidence | 1 (physics), 4 (browser) |
| 8 original-document updates | Planning step done as proposed; implemented claims in Task 4 Step 6 |
