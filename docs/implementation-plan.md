# Park-Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved five-lesson Vietnamese parking simulator in small, independently verifiable increments.

**Architecture:** One application owns a fixed-step Cannon-es world, a single vehicle, a Three.js renderer and vanilla DOM screens. Typed profile/scenario data drives physics, lesson checkpoints and presentation; pure geometry/state functions are tested independently from browser rendering. Tasks form dependent vertical slices of one simulator, not independently shippable products.

**Tech Stack:** Strict TypeScript, Vite, Three.js, Cannon-es; Vitest for logic/physics tests, jsdom for DOM tests, Playwright for browser integration.

**Spec:** [Approved detailed design](detail-design.md), dated 2026-11-02. Read it alongside this plan; its parameter tables and contracts are authoritative. Phase 2 refinements: [phase design](phase-2-detail-design.md) and [phase plan](phase-2-implementation-plan.md). Approved Phase 3 refinements for Tasks 2-3: [phase design](phase-3-detail-design.md) and [phase plan](phase-3-implementation-plan.md).

**Status:** Approved by the project owner on 2026-11-02. Task 1 (technical-design Phase 2) was implemented with Native execution on 2026-11-03: 46 unit/DOM tests, typecheck, build and six Chromium/Firefox tests passed, then merged locally with owner approval. Tasks 2-3 (technical Phase 3) are implemented and merged into local `main` with owner approval: 167 unit/DOM/physics tests, typecheck/build and 12 Chromium/Firefox tests passed. Final independent review and its verified correction are complete; merged-tree tests, typecheck and build passed. Nothing pushed. Phase 4 prototype code and software gates (Tasks 4-5) are complete in the current branch: 221 unit/DOM tests, typecheck, build and 22 Chromium/Firefox browser tests passed. Phase 5 assets and progression foundation are implemented on the isolated `phase-5-assets-progression` branch; see [Phase 5 detail](phase-5-detail-design.md), [Phase 5 plan](phase-5-implementation-plan.md), and [asset measurements](asset-pipeline.md). Phase 6 lesson/evaluation implementation is on its separate `phase-6-lessons-parking-evaluation` branch; see [Phase 6 detail](phase-6-detail-design.md) and [Phase 6 plan](phase-6-implementation-plan.md). Phase 6 software gates are recorded in its plan; owner sign-off remains pending. Runs to date used Node v24.13.1, below the declared v24.15.0 minimum; Firefox viewport bounds used fresh contexts because live `page.setViewportSize()` hangs. Labeled mirror landmarks, garage-wall occlusion, supported-Node, real wheel, reference-hardware, route and instructor validation remain pending.

## Global Constraints

- Learner-facing instructions and controls are in Vietnamese; technical documentation and code identifiers are in English.
- Use meters, kilograms, seconds and radians internally. HUD speed is km/h.
- Vehicle-local X is right, Y is up, -Z is forward; positive steering is left.
- Wheel order is front-left, front-right, rear-left, rear-right.
- Use `h = 1 / 120 s`, at most eight physics steps per rendered frame; clamp incoming wall-clock delta to 0.1 s.
- Sensor and regular DOM updates are at most 20 Hz; mirrors at most 15 Hz; overhead camera updates at most 30 Hz.
- Use TypeScript strict, Vite, Three.js, Cannon-es and vanilla HTML/CSS. No UI framework, dynamic shadows, weather, procedural city, custom graphics pipeline or heavy architectural layer.
- Amethyst accent is `#9B59B6`. No blue, orange or green main-UI accent; sensor colors are the explicit exception.
- First release is flat, dry, static, right-hand-traffic and left-hand-drive.
- Success requires full-envelope containment with 0.05 m inset, heading error <=5 degrees, speed <0.1 m/s, angular speed <0.05 rad/s, P and parking brake for 2.0 continuous seconds.
- Roadside success also requires a 0.15-0.30 m curb-side body gap.
- Failure wins over success in the same fixed step; retain recap until Retry/Menu.
- Either vehicle can unlock the next stage; no timers, star ratings or penalties for normal corrections.
- Physics values are tuning seeds, not validated manufacturer data. 1440p/144Hz remains a measured reference-PC target.
- Never install packages, create application files or execute this plan merely because the plan was approved as documentation; obtain execution approval.

## Review Focus

1. A held key/button survives blur, an input-source switch or disconnect: pause, clear it and require an explicit neutral-pedal resume. Tests belong to Tasks 3 and 7.
2. A mirror or overhead pass leaves renderer state changed: the main view and inset remain correctly targeted after every pass and resize. Tests belong to Task 4.
3. A save is corrupt, a storage getter throws or writes exceed quota: explain the condition, preserve unreadable data and continue honestly in session memory. Tests belong to Task 7.
4. A scene finishes loading after Retry/Menu: cancel or discard it without attaching stale objects or leaking resources. Tests belong to Task 6.
5. A slow rendered frame includes an obstacle contact and apparent parking success: bounded fixed stepping records one failure, never unlocks a stage and cannot tunnel through the authored thin obstacles at allowed speeds. Tests belong to Tasks 2, 7 and 8.

---

## Execution conventions and tools

Repository state at planning time: documentation and instructions only; no package manifest or
application yet. Inspect the worktree before execution. Preserve unrelated
untracked files. Create execution isolation with the required worktree skill
when execution begins, not while writing this plan.

Choose a supported Node version satisfying the selected packages' engine
requirements. In Task 1 install compatible stable versions with `--save-exact`
and commit `package-lock.json`; subsequent tasks use the lockfile, not fresh
version selections. Runtime package in Task 1 is `three`; `cannon-es` is installed with `--save-exact` in Task 2's setup and the lockfile updated then. Development
packages are `typescript`, `vite`, `@types/three`, `vitest`, `jsdom` and
`@playwright/test`. Do not add a framework, state-machine library, compression
decoder, CSS library or additional test runner.

Task 1 defines these scripts:

| Script | Command |
|---|---|
| `dev` | `vite --host 127.0.0.1` |
| `typecheck` | `tsc --noEmit` |
| `build` | `tsc --noEmit && vite build` |
| `test` | `vitest run` |
| `test:browser` | `playwright test` |
| `preview` | `vite preview --host 127.0.0.1` |

The `&&` above is inside an npm script executed by the platform command shell;
do not use it to chain PowerShell tool commands. Set Vitest's default environment
to Node and opt DOM tests into jsdom. Playwright owns its bounded Vite test server
and uses Chromium and Firefox projects. Install those test browsers only when
their first execution reports missing executables.

There is no existing linter/formatter; use compiler, tests and `git diff --check`
without introducing a separate formatting stack. Every green step also runs
`npm run typecheck`; each task's final verification runs `npm run build`.
Tests marked as future release measurements must be reported as pending until
actually performed, not replaced by mocked assertions.

For each task's final commit, stage only its listed created/modified files,
including the lockfile if changed. Use the specified message and append:

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## File ownership map

Paths are relative to the repository root.

| Files | Responsibility |
|---|---|
| `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `.gitignore` | Entry, exact dependencies, build/test configuration and generated-file exclusions |
| `src\main.ts`, `src\app.ts` | Bootstrap and session lifecycle; glue only, not physics/lesson algorithms |
| `src\render\fit.ts`, `preview.ts` and tests | Phase 2: pure drawing-buffer sizing; single-owner static preview renderer lifecycle (see phase design) |
| `src\contracts.ts`, `src\runtime-types.ts`, `src\messages.ts` | Approved boundary contracts, implementation-only adapter types and finite Vietnamese message keys |
| `src\clock.ts`, `src\clock.test.ts` | Fixed-step accumulator and pause/reset behavior |
| `src\ui\screens.ts`, `src\ui\hud.ts`, `src\ui\ui.test.ts`, `src\style.css` | Semantic screens, HUD binding, focus, responsive CSS and accessibility |
| `src\vehicle\profiles.ts`, `geometry.ts`, `steering.ts`, `rig.ts`, `vehicle.test.ts` | Profiles, COM-relative geometry, Ackermann and Cannon adapter |
| `src\input\calibration.ts`, `controller.ts`, `input.test.ts` | Calibration, exclusive input source, action queue and neutralization |
| `src\views\cameras.ts`, `auxiliary.ts`, `trajectory.ts`, `views.test.ts` | Driver/chase cameras, mirrors, overhead composition and estimated path |
| `src\sensors\proximity.ts`, `audio.ts`, `sensors.test.ts` | Physics ray sampling, hysteresis and one beep stream |
| `src\world\metadata.ts`, `colliders.ts`, `assets.ts`, `assets.test.ts` | Collider/anchor metadata, world bodies, cancellable GLB loading and disposal |
| `src\lessons\scenarios.ts`, `checkpoints.ts`, `parking.ts`, `attempt.ts`, `lessons.test.ts` | Five authored layouts, advisory steps, final success/failure and recap |
| `src\storage\persistence.ts`, `persistence.test.ts` | Versioned progress/settings/calibration, recovery and session-only storage |
| `tests\browser\shell.spec.ts`, `driving.spec.ts`, `lessons.spec.ts` | Real-browser UI/rendering/lifecycle checks |
| `tests\physics\acceptance.test.ts`, `src\diagnostics\metrics.ts` | Repeatable physics measurements and development-only runtime metrics |
| `public\assets\vehicles\sedan.glb`, `cuv.glb`; `public\assets\environments\roadside.glb`, `garage.glb` | Licensed/original release visuals, not collider inference |
| `docs\asset-pipeline.md`, `docs\validation-results.md` | Export/provenance checklist and actual measured evidence |

Create files only when their owning task begins. Test fixtures can live inside
their owning test file unless reused by multiple tests; do not build a parallel
simulation architecture solely for tests.

## Shared interface decisions

Task 1 copies the approved design's TypeScript contracts to `src\contracts.ts`.
Replace its illustrative `MessageKey = string` with the finite
`keyof typeof vi` type from `src\messages.ts`; all later messages extend that
dictionary. Do not duplicate or rename `Gear`, `VehicleTelemetry`,
`ScenarioDefinition`, `AppState` or their properties in subsystem modules.

Task 1 also creates these small adapter types in `src\runtime-types.ts`:

```ts
interface PhysicsSnapshot {
  readonly telemetry: VehicleTelemetry;
  readonly wheelPoses: readonly [BodyPose, BodyPose, BodyPose, BodyPose];
}

interface RenderFrame {
  readonly previous: PhysicsSnapshot;
  readonly current: PhysicsSnapshot;
  readonly alpha: number;
}

interface ColliderBox {
  readonly id: string;
  readonly kind: 'ground' | 'obstacle' | 'curb';
  readonly centerM: Vec3Data;
  readonly halfExtentsM: Vec3Data;
  readonly yawRad: number;
}

interface VehicleAnchors {
  readonly driverEyeLocalM: Vec3Data;
  readonly mirrors: Readonly<Record<'rear' | 'left' | 'right', BodyPose>>;
}

interface SceneAssets {
  readonly environment: THREE.Group;
  readonly vehicle: THREE.Group;
  readonly wheelNodes: readonly [
    THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D
  ];
  readonly anchors: VehicleAnchors;
  dispose(): void;
}

interface ControlNotice {
  readonly messageKey: MessageKey;
}

interface InputPoll {
  readonly frame: InputFrame;
  readonly actions: readonly InputAction[];
  readonly issue: MessageKey | null;
}
```

Use type-only imports as needed. `SceneAssets` owns visuals, not world bodies.
The `app.ts` owner disposes each subsystem once, stops simulation before disposal
and never shares a mutable scene between two active sessions.

### Task 1: Bootable Vietnamese shell and fixed-step foundation

**Files:** Create root configuration, `src\main.ts`, `app.ts`, `contracts.ts`,
`runtime-types.ts`, `messages.ts`, `clock.ts`, `clock.test.ts`, `style.css`,
`src\ui\screens.ts`, `hud.ts`, `ui.test.ts`, `src\render\fit.ts`, `fit.test.ts`,
`preview.ts`, `preview.test.ts` (injected renderer/scheduler seams, no production globals) and `tests\browser\shell.spec.ts`.

**Interfaces:**
- Produces `createApp(root: HTMLElement): { dispose(): void }`.
- Produces `mountScreen(root: HTMLElement, state: AppState, context: ScreenContext, onAction: (action: ScreenAction) => void): () => void`.
- Defines `ScreenContext` with `progress: ProgressSaveV1`, `settings: SettingsSaveV1`, `selectedStageId: StageId` and `selectedVehicleId: VehicleId`; do not make Menu inspect storage or physics globals.
- Defines `PreviewPhase = 'closed' | 'running' | 'paused'` and `ShellView { readonly state: AppState; readonly preview: PreviewPhase }` in `runtime-types.ts`; the preview is a shell flag, never an `AppState`.
- Defines `ScreenAction` with a `type` discriminant (Phase 2 adds payload-free `'open-preview'` and `'close-preview'`, and `'select-vehicle'` carrying `vehicleId: VehicleId`; `'start'` stays defined but is not emitted until Task 2): `'start'` carries `stageId: StageId` and `vehicleId: VehicleId`; `'retry'`, `'menu'`, `'continue'`, `'resume'`, `'open-calibration'`, `'request-reset-progress'` and `'confirm-reset-progress'` have no payload. Add `'select-input'` carrying `source: InputSource` and `gamepadIndex: number | null`; add `'update-settings'` carrying a validated `SettingsSaveV1`.
- Defines `SettingsSaveV1` in `runtime-types.ts`: version 1, `volume: number`, `muted: boolean`, `driverFovDeg: number`, `cameraMode: CameraMode`, `overhead: boolean`, `trajectory: boolean`, `inputSource: InputSource`, `resolutionScale: 1 | 0.75 | 0.5`. Task 7 persists this existing type.
- Produces `createClock(): Clock`; `Clock.advance(elapsedS: number, step: () => void): { alpha: number; droppedTimeS: number }`, `Clock.reset(): void`.
- Produces all shared design/adapter types and `vi`/`MessageKey`.

- [x] **Step 1: Create tool configuration only.** Set up the packages/scripts above, strict TypeScript with DOM types and Vite module resolution, Vitest and Playwright projects. Ignore `node_modules`, `dist`, browser reports and `.superpowers` artifacts; integrate rather than replace any existing `.gitignore`.
- [x] **Step 2: Write failing clock and screen tests.** Pin the accumulator cap and a Vietnamese, keyboard-operable Menu with no automatic simulation startup.

```ts
it('caps a slow frame at eight fixed updates', () => {
  const step = vi.fn();
  const result = createClock().advance(0.1, step);
  expect(step).toHaveBeenCalledTimes(8);
  expect(result.droppedTimeS).toBeCloseTo(0.1 - 8 / 120);
  expect(result.alpha).toBeGreaterThanOrEqual(0);
  expect(result.alpha).toBeLessThan(1);
});
```

Also test that `reset()` discards a half-step backlog and that a negative or
non-finite frame delta is rejected explicitly. In the jsdom file, assert the
Menu has the preview entry “Xem thử mô hình (không lái được)” (no “Bắt đầu”), a labeled vehicle selector and visible keyboard focus. Add tests for focus/visibility pause with explicit resume, context loss, idempotent disposal and the 2560x1440 drawing-buffer cap.
- [x] **Step 3: Run the tests red.** `npm test -- src/clock.test.ts src/ui/ui.test.ts src/render/fit.test.ts src/render/preview.test.ts`; expect missing implementation/export failures, not missing tooling.
- [x] **Step 4: Implement the shell and clock.** Copy exact design contracts, apply the visual token table and mount Menu. Add a capability error screen for unavailable WebGL2. Renderer startup happens only on the learner's preview click, under the application owner. The preview is a static, labeled, non-drivable inspection (no simulation, no `playing` state); `cannon-es` is not installed until Task 2. No fake “lesson complete” behavior.
- [x] **Step 5: Verify the slice.** Run the same unit tests, `npm run test:browser -- tests/browser/shell.spec.ts`, typecheck and build. Browser assertions: Vietnamese Menu appears, no unexpected console errors, unsupported-WebGL feedback is understandable, and 1280x720 has no horizontal page overflow.
- [x] **Step 6: Commit.** Message: `feat: add Vietnamese app shell and fixed-step clock`.

### Task 2: Real low-speed vehicle on a prototype test ground

> **Phase 3 mapping (implemented; software gates and final review complete):** delivered as Phase 3 Tasks 1 and 3 of the [phase plan](phase-3-implementation-plan.md) under the [approved phase design](phase-3-detail-design.md). Refinements: externally stepped rig, contact flags retained before wheel-transform refresh, typed `SimulationStateError`, authored yard/spawn, non-lesson contact stop, and an owner-approved version-specific braking correction. Actual measured gates are in [the evidence report](phase-3-measurements.md).

**Setup:** first run `npm install --save-exact cannon-es@0.20.0` (deferred from Task 1) and commit the updated `package.json` and `package-lock.json` with this task.

**Files:** Create `src\vehicle\profiles.ts`, `geometry.ts`, `steering.ts`,
`rig.ts`, `vehicle.test.ts`, `src\world\colliders.ts`; modify `package.json`,
`package-lock.json`, `src\app.ts`, `runtime-types.ts`, `messages.ts`.

**Interfaces:**
- Consumes the approved `VehicleProfile`, `InputFrame`, `InputAction` and `PhysicsSnapshot`.
- Produces `profiles: Readonly<Record<VehicleId, VehicleProfile>>`.
- Produces `ackermann(s: number, profile: VehicleProfile): readonly [number, number]`.
- Produces `vehicleFootprint(pose: BodyPose, profile: VehicleProfile): readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data]`.
- Produces `createWorld(): CANNON.World` and `addColliderBoxes(world: CANNON.World, boxes: readonly ColliderBox[]): () => void`.
- Produces `createVehicleRig(world: CANNON.World, profile: VehicleProfile): VehicleRig`.
- `VehicleRig` exposes `body: CANNON.Body`, `vehicle: CANNON.RaycastVehicle`, `settle(spawn: SpawnPose): void`, `applyInput(frame: InputFrame, actions: readonly InputAction[], h: number): readonly ControlNotice[]`, `snapshot(simulationTimeS: number): PhysicsSnapshot`, and `dispose(): void`.

- [x] **Step 1: Write failing geometry/steering/drive tests.** Assert full-lock left/right inner/outer relationships and mirror-aware COM-offset corners, not merely profile constants.

```ts
it('uses the inside front wheel for a left turn', () => {
  const [left, right] = ackermann(1, profiles.sedan);
  expect(left).toBeGreaterThan(right);
  expect(right).toBeGreaterThan(0);
  const [reverseLeft, reverseRight] = ackermann(-1, profiles.sedan);
  expect(reverseLeft).toBeCloseTo(-right);
  expect(reverseRight).toBeCloseTo(-left);
});
```

Use a real Cannon world for forward/reverse signs, stationary shift interlock,
front-wheel propulsion, brake-over-throttle, P/parking-brake holds, finite
settling and per-step brake-impulse conversion. Include eight-step slow frames
against a 0.1 m thick solid box at the allowed training speed.
- [x] **Step 2: Run red.** `npm test -- src/vehicle/vehicle.test.ts`.
- [x] **Step 3: Implement the rig and prototype integration.** Copy all profile/world values from design Sections 4-5. Derive axle/mount/collider offsets; compute signed speed against -Z; apply Ackermann, resistance-compensated creep, force taper and fixed-step braking. Preserve suspension contact data before refreshing render wheel transforms. A non-finite snapshot throws a typed `SimulationStateError`; `app.ts` stops stepping and displays Error, not learner Fail. Display simple, explicitly labeled development geometry on a flat ground; it is not release art or a validated lesson.
- [x] **Step 4: Verify the slice.** Repeat the tests, typecheck and build. On real physics at 30/60/144 simulated render schedules, compare elapsed simulated seconds, creep within +/-0.1 m/s after 6 s, braking from 5 km/h within 0.5 m, and 60 s hold drift <=0.02 m. A failing target triggers tuning and remeasurement, not relaxed assertions.
- [x] **Step 5: Commit.** Message: `feat: add calibrated-profile vehicle physics foundation`.

### Task 3: Keyboard, wheel calibration and safe input ownership

> **Phase 3 mapping (implemented; software gates and final review complete):** delivered as Phase 3 Tasks 2-4. Refinements: `InputController.checkNeutral(): MessageKey | null`; boolean `Preview.resume()` gates running UI; invalid calibration produces visible feedback; device selection/verification stay in session memory; keyboard steering ramps at fixed-step time. Native session controls survive focus-loss redraws; window refocus recovers missed keyup events without replay or automatic resume. Pointer-lock tests move to Task 4.

**Files:** Create `src\input\calibration.ts`, `controller.ts`, `input.test.ts`,
`tests\browser\driving.spec.ts`; modify `src\app.ts`, `runtime-types.ts`,
`messages.ts`, `src\ui\screens.ts`, `ui.test.ts`.

**Interfaces:**
- Produces `normalizePedal(raw: number, binding: PedalBinding): number`.
- Produces `normalizeSteering(raw: number, calibration: ControllerCalibration): number`.
- Produces `validateCalibration(value: unknown): ControllerCalibration | null`; callers must display an invalid-calibration notice for `null`.
- Produces `createInputController(target: HTMLElement, getGamepads: () => readonly (Gamepad | null)[]): InputController`.
- `InputController` exposes `poll(): InputPoll`, `enqueue(action: InputAction): void`, `selectSource(source: InputSource, index?: number): void`, `setCalibration(value: ControllerCalibration): void`, `clear(): void`, `dispose(): void`.
- Controller calibration remains in session memory until Task 7 wires persistence.
- Add `mountCalibration(root: HTMLElement, selectedIndex: number, getGamepads: () => readonly (Gamepad | null)[], onComplete: (value: ControllerCalibration) => void, onCancel: () => void): () => void` in `src\ui\screens.ts`. Calibration is a Menu/Paused dialog, not a second driving session; poll raw controls there only while normal driving polls are stopped.

- [x] **Step 1: Write failing input tests.** Parameterize button/axis and inverted pedals so released maps to 0 and fully pressed to 1. Reject equal endpoints, absent indices, NaN and infinity visibly. Test the 0.02 steering dead zone and both unequal calibration spans.
- [x] **Step 2: Add failing lifecycle/input ownership tests.** A held shoulder yields one R/D action; keyboard and gamepad never blend; typing in a DOM control never drives; blur, disconnect and source change clear throttle/steering/action queues and return a pause reason. Resume cannot succeed until explicitly requested with released pedals.
- [x] **Step 3: Run red.** `npm test -- src/input/input.test.ts src/ui/ui.test.ts`.
- [x] **Step 4: Implement polling and calibration UI.** Use the exact key/button mapping in design Section 6, including S as brake, Digit1-4 as P/R/N/D, Space parking brake and Q/E indicators. Explain nonstandard devices and expose steering/pedal endpoint capture. Poll once per animation frame; retain discrete actions until the next fixed step, consume once, and clear on pause/reset/source switch. Do not introduce force feedback or silently guess unknown wheel mappings.
- [x] **Step 5: Verify the slice.** Repeat unit tests and run `npm run test:browser -- tests/browser/driving.spec.ts`, typecheck and build. Browser tests operate keyboard controls on the real prototype, verify DOM focus pause behavior and check disconnect handling through an injected Gamepad provider (Phase 3 moves the pointer-lock-loss test to Task 4, where acquisition exists). This injection does not count as real wheel compatibility evidence.
- [x] **Step 6: Commit.** Message: `feat: add safe keyboard and calibrated wheel input`.

### Task 4: Useful driving views, mirrors and geometric guidance

**Phase 4 implementation status:** Prototype code and automated software gates
are complete. Real-browser tests pass in Chromium and Firefox. The current
prototype has no labeled left/right mirror landmarks or garage test wall, so
those original visual acceptance checks remain pending; do not treat them or
asset-backed sightline validation as passed.

**Files:** Create `src\views\cameras.ts`, `auxiliary.ts`, `trajectory.ts`,
`views.test.ts`, `src\ui\hud.ts`; modify `src\app.ts`, `messages.ts`,
`src\style.css`, `tests\browser\driving.spec.ts`.

**Interfaces:**
- Produces `createViews(renderer: THREE.WebGLRenderer, scene: THREE.Scene, assets: SceneAssets, profile: VehicleProfile, boxes: readonly ColliderBox[]): ViewSystem`; both chase obstruction and trajectory checks consume those authoritative boxes.
- `ViewSystem` exposes `render(frame: RenderFrame, nowMs: number): void`, `look(deltaX: number, deltaY: number): void`, `setCamera(mode: CameraMode): void`, `setOverhead(enabled: boolean): void`, `setTrajectory(enabled: boolean): void`, `setFov(degrees: number): void`, `setResolutionScale(scale: 1 | 0.75 | 0.5): void`, `recenter(): void`, `resize(widthCss: number, heightCss: number, pixelRatio: number): void`, `dispose(): void`. The application routes pointer-locked mouse deltas to `look` only while Playing.
- Produces `sampleTrajectory(telemetry: VehicleTelemetry, profile: VehicleProfile, boxes: readonly ColliderBox[]): readonly TrajectorySample[]`.
- Defines `TrajectorySample` with `rearAxleM: Vec3Data` and `envelope: readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data]`; stop at 3 m or first predicted envelope overlap.
- Produces `mountHud(root: HTMLElement, onAction: (action: InputAction) => void): Hud`; `Hud.update(telemetry: VehicleTelemetry, sensors: SensorSnapshot | null, instruction: MessageKey | null): void`, `Hud.dispose(): void`.

- [x] **Step 1: Write failing geometry and render-pass tests.** Straight trajectory at zero steering; opposite D/R direction; front-overhang sweep remains inside the conservative envelope; chase retracts on a hit and clears again. Use a typed renderer-port fake for pass ownership only.

```ts
it('restores renderer state after an auxiliary pass throws', () => {
  const before = rendererState(renderer);
  renderer.render.mockImplementationOnce(() => { throw new Error('render failed'); });
  expect(() => renderAuxiliaryPass(renderer, pass)).toThrow('render failed');
  expect(rendererState(renderer)).toEqual(before);
});
```

`rendererState` and the fake are test helpers in `views.test.ts`.
`renderAuxiliaryPass(renderer: RendererPort, pass: AuxiliaryPass): void` is an
internal export from `auxiliary.ts`; `RendererPort` is the minimum typed subset
of renderer methods needed for target/viewport/scissor/clear state. Define
`AuxiliaryPass` there as the camera, scene and target/viewport description.
Do not cast a partial fake to an entire renderer.
- [x] **Step 2: Add failing timing/resize tests.** Mirrors never exceed 15 Hz and never catch up in bursts; overhead capture never exceeds 30 Hz but composites every rendered frame. CSS-to-buffer rectangles respect the 2560x1440 cap and WebGL bottom-left origin.
- [x] **Step 3: Run red.** `npm test -- src\views\views.test.ts`.
- [x] **Step 4: Implement the view system and HUD.** Use design Section 7 camera/FOV/texture sizes, one renderer, one overhead RenderTarget and one pass owner. Interpolate chassis/wheels together. Use prototype `SceneAssets` with deliberate driver/mirror anchors until Task 6. Exclude mirror surfaces/driver head from mirror cameras and ceiling visuals only from overhead. Keep all labels and controls Vietnamese.
- [ ] **Step 5: Verify the slice.** Automated unit/typecheck/build and both-browser tests pass; live 1280x720 Chromium rendering/resize and Firefox viewport bounds pass. Labeled left/right landmarks, garage-wall occlusion and 2560x1440 HUD layout remain pending until an appropriate scene/asset fixture exists. Pointer-lock lifecycle, camera changes, look/recenter, aid toggles and actual WebGL rendering are covered.
- [ ] **Step 6: Commit.** Message: `feat: add driver views mirrors and parking aids`.

### Task 5: Bumper warnings and accessible audio

**Phase 4 implementation status:** Sensor/audio code and software verification
are complete. Automated browser tests cover muted visual labels, audio
unlock/pause, unavailable-audio fallback and repeated disposal; manual
obstacle approaches in both gears remain unverified.

**Files:** Create `src\sensors\proximity.ts`, `audio.ts`, `sensors.test.ts`;
modify `src\app.ts`, `messages.ts`, `src\ui\hud.ts`, `src\style.css`,
`tests\browser\driving.spec.ts`.

**Interfaces:**
- Produces `classifyDistance(distanceM: number | null, previous: SensorBand): SensorBand`.
- Produces `createSensors(world: CANNON.World, body: CANNON.Body, profile: VehicleProfile): { sample(simulationTimeS: number): SensorSnapshot; reset(): void }`.
- Produces `createAudio(): AudioOutput`; `AudioOutput.unlock(): Promise<'ready' | 'unavailable'>`, `update(sensors: SensorSnapshot, signedSpeedMps: number, simulationTimeS: number): void`, `setVolume(value: number): void`, `setMuted(value: boolean): void`, `suspend(): void`, `dispose(): void`.
- Unavailable audio returns a user-visible notice through `app.ts`; unexpected errors are not silently swallowed.

- [x] **Step 1: Write failing threshold/coverage tests.**

```ts
it.each([
  [null, 'clear'], [2.5, 'green'], [1.2, 'yellow'],
  [0.6, 'red'], [0.3, 'stop']
] as const)('classifies distance %s', (distance, expected) => {
  expect(classifyDistance(distance, 'clear')).toBe(expected);
});
```

Add hysteresis tests: entering a closer band is immediate; leaving yellow for
green requires distance >1.25 m. Use real physics rays for nearest hit, self
exclusion, distributed bumper origins and a low obstacle missed by ray height.
- [x] **Step 2: Write failing audio tests.** One stream chooses nearest warning and travel-direction tie; interval 1.0/0.5/0.2 s or continuous tone; mute/pause disposes scheduled sound; an AudioContext refusal reports unavailable while visual warnings remain.
- [x] **Step 3: Run red.** `npm test -- src\sensors\sensors.test.ts`.
- [x] **Step 4: Implement sensors/audio.** Copy ray height/range/yaws and warning labels from design Section 8. Schedule 20 Hz samples in the simulation clock, not a second `setInterval` loop. Start/unlock audio only on a user gesture and retain front/rear text/distance warnings without audio.
- [ ] **Step 5: Verify the slice.** Automated Cannon-ray, classification/hysteresis, browser label, audio pause/fallback, typecheck and build checks pass. The planned manual D/R obstacle approaches and muted STOP visual verification remain pending. Rays do not guarantee side/low-obstacle clearance.
- [ ] **Step 6: Commit.** Message: `feat: add bumper proximity warnings and audio`.

### Task 6: Two real environments and vehicle/cockpit asset pipeline

> **Phase 5 delivery note:** the isolated Phase 5 branch delivers original,
> deterministic prototype GLBs, explicit colliders, a validated cancellable
> loader, and measured geometry/transfer budgets. It does not deliver
> production art, image-based bakes, validated sightlines, or a lesson-ready
> route. See [Phase 5 detail](phase-5-detail-design.md) and
> [asset pipeline](asset-pipeline.md). The broader release-asset validation
> below remains pending.

**Files:** Create `src\world\metadata.ts`, `assets.ts`, `assets.test.ts`,
the four GLB files in the ownership map and `docs\asset-pipeline.md`; modify
`src\app.ts`, `src\views\cameras.ts`, `src\vehicle\profiles.ts` only for
verified anchor fit, `src\world\colliders.ts`, `messages.ts`.

**Interfaces:**
- Produces `vehicleAnchors: Readonly<Record<VehicleId, VehicleAnchors>>`.
- Produces `environmentBoxes: Readonly<Record<EnvironmentId, readonly ColliderBox[]>>`; scenario-specific obstacles are added by Task 7, not inferred from meshes.
- Produces `loadSceneAssets(environment: EnvironmentId, vehicle: VehicleId, signal: AbortSignal): Promise<SceneAssets>`.
- Loading validates dimensions, the four named wheel nodes and all camera/mirror anchors; missing required content rejects with a typed category that the application maps to Vietnamese feedback.

- [ ] **Step 1: Write failing load/ownership tests.** Missing wheel/anchor, dimension error >0.02 m, load rejection and abort all prevent session start. A late successful callback after abort is disposed, never attached. Two consumers must not accidentally dispose a shared texture twice; use one resource owner per loaded asset set.
- [ ] **Step 2: Run red.** `npm test -- src\world\assets.test.ts`.
- [ ] **Step 3: Produce the export checklist and original/licensed content.** Use the exact settings below. Record provenance/license, actual triangle/draw/texture/transfer sizes and anchor measurements in `docs\asset-pipeline.md`. If suitable art or an authoring tool is unavailable, report the task blocked; keep prototypes visibly labeled and do not claim first-person release assets are complete.
- [ ] **Step 4: Implement GLB loading and static colliders.** Use Three.js `GLTFLoader`; no DRACO/KTX decoder by default. Keep collider metadata authoritative. Abort or discard stale requests with a session generation check; loader network cancellation alone is not sufficient. Show progress only when total bytes are known and explicit resource-category errors otherwise. On WebGL context loss, prevent blind simulation, suspend audio and show a Vietnamese recovery/reload screen.
- [ ] **Step 5: Verify the slice.** Repeat tests, typecheck/build and browser driving tests against each actual GLB. Inspect both cockpits, mirrors, physical clearance and ceiling layers; exercise context-loss recovery. Switch environment/vehicle ten times; no stale scene, duplicate physics listeners, accumulating resources or previous-scene mirror image is permitted.
- [ ] **Step 6: Commit.** Message: `feat: load vehicle cockpits and parking environments`.

#### Required export settings

| Item | Exact requirement |
|---|---|
| Format | glTF 2.0 binary `.glb`; embed mesh/material/image content |
| Blender units | Metric, unit scale 1.0; modeled dimensions in meters; apply object rotation/scale |
| Axes | Blender Z up, vehicle forward +Y; let the exporter convert once to glTF Y up/-Z forward; verify with labeled axes and a 1 m reference |
| Vehicle root | `VehicleRoot` origin at profile COM; body not automatically recentered by loader |
| Vehicle nodes | `Body`, `WheelFL`, `WheelFR`, `WheelRL`, `WheelRR`, `DriverEye`, `MirrorRear`, `MirrorLeft`, `MirrorRight`; wheel local origins at axle centers |
| Mirror surfaces | Separate simple plane meshes with dedicated replaceable materials and camera-exclusion layer |
| Cockpit | Minimal opaque dashboard/body framing and mirrors with useful sightlines; no exterior-only model substituted |
| Garage | Ceiling/upper visual walls separable for overhead layer masking; physical ceiling/walls remain in collider metadata |
| Lighting | Bake static lighting/AO into base-color appearance; use basic/unshadowed runtime materials; avoid double lighting |
| Color | Base/baked color images use sRGB; data maps linear; keep export colors correct in the renderer's output color space |
| Geometry | Triangulate; export normals/UVs; no rig, skin, unused animation or unapplied modifiers required at runtime |
| Budget | Environment <=150k triangles; vehicle/cockpit <=50k; main view <=150 draw calls; textures <=2048px unless measured exception |
| Transfer | Selected initial scene assets <=20 MB compressed transfer; measure served bytes, not Blender project size |
| Verification | Dimensions and eye/wheel/mirror/collider anchors within 0.02 m of approved metadata; record any tuned profile values |
| Rights | Original work or a documented license permitting repository distribution and the intended use; never assume a downloaded model is redistributable |

### Task 7: Five playable lessons, durable recaps and honest saves

> **Phase 5/6 delivery note:** Phase 5 provides versioned
> progress/settings/calibration records, contiguous unlock derivation,
> key-specific recovery, and a typed confirmed-success boundary. Phase 6
> implements the five lesson runtimes, evaluation, outcomes, recaps, history,
> and authored scenario witnesses on its isolated branch; see the [Phase 6
> plan](phase-6-implementation-plan.md). Final gates and owner sign-off remain
> pending; do not merge or push before approval.

**Files:** Create `src\lessons\scenarios.ts`, `checkpoints.ts`, `parking.ts`,
`attempt.ts`, `lessons.test.ts`, `src\storage\persistence.ts`,
`persistence.test.ts`, `tests\browser\lessons.spec.ts`; modify
`src\app.ts`, `runtime-types.ts`, `messages.ts`, `src\ui\screens.ts`,
`hud.ts`, `ui.test.ts`, `src\style.css`.

**Interfaces:**
- Consumes all approved lesson/progress/state contracts and `vehicleFootprint`.
- Produces `scenarios: Readonly<Record<StageId, ScenarioDefinition>>` and `scenarioBoxes: Readonly<Record<StageId, readonly ColliderBox[]>>`.
- Produces `advanceLesson(runtime: LessonRuntime, scenario: ScenarioDefinition, telemetry: VehicleTelemetry, actions: readonly InputAction[], h: number): LessonRuntime`.
- Produces `isParked(telemetry: VehicleTelemetry, profile: VehicleProfile, target: ParkingTarget, curb: ColliderBox | null): boolean`; this evaluates geometry/state only, not elapsed dwell.
- Produces `createAttempt(scenario: ScenarioDefinition, profile: VehicleProfile): Attempt`; `Attempt.update(telemetry: VehicleTelemetry, contacts: readonly ContactEvent[], sensors: SensorSnapshot | null, actions: readonly InputAction[], h: number): AttemptSummary | null`, `Attempt.lesson(): LessonRuntime`.
- Defines `ContactEvent = { readonly kind: 'solid' | 'curb'; readonly obstacleId: string }`. The physics adapter emits these from actual contacts and explicit tire/curb overlap checks; no events for normal wheel support.
- Produces `openPersistence(getStorage: () => Storage): Persistence`.
- `Persistence` exposes `loadProgress(): LoadResult<ProgressSaveV1>`, `saveProgress(value: ProgressSaveV1): SaveResult`, `loadSettings(): LoadResult<SettingsSaveV1>`, `saveSettings(value: SettingsSaveV1): SaveResult`, `loadCalibrations(): LoadResult<CalibrationSaveV1>`, `saveCalibrations(value: CalibrationSaveV1): SaveResult`, `resetProgress(): SaveResult`.
- Define `LoadResult<T>` with `value: T`, `mode: 'persistent' | 'session-only' | 'reset-required'`, `notice: MessageKey | null`; `SaveResult` is `'saved' | 'session-only' | 'reset-required'`.
- Consumes Task 1's `SettingsSaveV1`; defines `CalibrationSaveV1` with `version: 1` and `entries: readonly ControllerCalibration[]`. Do not persist a gamepad array index as a stable device identity.

- [ ] **Step 1: Write failing parking/checkpoint tests.** Cover rotated targets, unequal COM extents, mirrors crossing the boundary, heading wrap near +/-pi, exact speed/angular thresholds, curb gap and continuous 2.0 s dwell. Advisory checkpoints allow alternate valid regions and safe final parking without an exact-path requirement. Observations require stopped acknowledgement, not inferred eye movement.

```ts
it('fails before awarding same-step parking success', () => {
  const { scenario, parkedTelemetry } = perfectBayFixture;
  const attempt = createAttempt(scenario, profiles.sedan);
  let summary: AttemptSummary | null = null;
  for (let i = 0; i < 239; i++) {
    summary = attempt.update(parkedTelemetry, [], null, [], 1 / 120);
    expect(summary).toBeNull();
  }
  summary = attempt.update(
    parkedTelemetry, [{ kind: 'solid', obstacleId: 'pillar-a' }], null, [], 1 / 120
  );
  expect(summary?.outcome).toBe('fail');
  expect(summary?.failureReason).toBe('collision');
});
```

Use a local `perfectBayFixture` object in the test file and its stopped
P/parking-brake telemetry; no generated fixture service is needed.
- [ ] **Step 2: Write failing failure/recap/persistence tests.** Cover wheel/curb clipping, chassis-ground contact, bounds, >30-degree tip, >15 km/h for 1 s, first-reason retention, direction-change threshold >0.2 m/s and minimum sampled clearance. Verify completion with either vehicle unlocks only the contiguous stage prefix.
- [ ] **Step 3: Add failing storage/focus/lifecycle tests.** Missing, malformed and future-version saves; throwing storage getter; quota errors; explicit reset confirmation; no overwrite of corrupt progress on later success; unrelated storage keys retained. Pause on blur/visibility/pointer-lock/input issue stops stepping and audio, clears the accumulator and requires explicit neutral resume. Retry creates one fresh attempt without stale actions or views.
- [ ] **Step 4: Run red.** `npm test -- src\lessons\lessons.test.ts src\storage\persistence.test.ts src\ui\ui.test.ts`.
- [ ] **Step 5: Implement data and state integration.** Copy all five maneuvers, bay dimensions, clearance/aisle requirements and guidance levels from design Section 9. Author fixed feasible layouts for both profiles; Stage 5 uses a second roadside setup, not random generation. Evaluate failures before lesson/success; wire briefing/play/pause/success/fail/error transitions, recap and explicit retry.
- [ ] **Step 6: Implement persistence and final screens.** Use `park-core.progress.v1`, `park-core.settings.v1` and `park-core.calibration.v1`; validate parsed `unknown` and preserve corrupt values until explicit reset. Distinguish session-only saves in Vietnamese. Add finite Vietnamese messages, focus management, live announcements for discrete changes and first-run fidelity/sensor/mirror limitations.
- [ ] **Step 7: Verify the slice.** Repeat selected tests, typecheck/build and `npm run test:browser -- tests\browser\lessons.spec.ts`. Browser tests exercise briefing/help/pause/recap/retry/menu, source change, corrupt-save notice and no stale late-load attachment. Test final success geometry directly with real physics fixtures, but do not claim that fixtures prove all five authored paths are driveable.
- [ ] **Step 8: Commit.** Message: `feat: add guided parking curriculum and local progression`.

### Task 8: Measured physics, browser and learner acceptance

**Files:** Create `tests\physics\acceptance.test.ts`,
`src\diagnostics\metrics.ts`, `docs\validation-results.md`; modify
`src\app.ts`, `src\vehicle\profiles.ts`, `src\lessons\scenarios.ts`,
`tests\browser\driving.spec.ts`, `lessons.spec.ts` only for measured corrections
and targeted regression tests.

**Interfaces:**
- Produces `createFrameMetrics(): FrameMetrics`; `FrameMetrics.record(frameMs: number, physicsOverrunS: number): void`, `report(): { frameCount: number; p50Ms: number; p95Ms: number; p99Ms: number; totalOverrunS: number }`, `reset(): void`.
- Metrics are development/explicit diagnostics only, not a production global API that can set gear, teleport vehicles or award lesson completion.
- Physics acceptance imports the same rig/scenarios as production, not a second approximate vehicle model.

- [ ] **Step 1: Write failing acceptance checks.** Implement the approved geometry/turning/settling/creep/brake/hold/timing tests for both profiles. Measure rear-axle path radius at <=1 m/s within 5% of the configured reference, settle within 3 s, hold drift <=0.02 m over 60 s, creep targets within +/-0.1 m/s after 6 s, and stopping distance <=0.5 m from 5 km/h. At 30/60/144 rendered FPS, simulate the same input duration through the real fixed-step clock. Include the Review Focus thin-obstacle collision case.
- [ ] **Step 2: Run and retain the failing measurements.** `npm test -- tests\physics\acceptance.test.ts`; distinguish a real tuning failure from fixture/setup mistakes. Write measured numbers and conditions, not only pass/fail.
- [ ] **Step 3: Implement metrics and necessary tuning only.** Use the same signed-speed, COM and contact conventions; keep validated values in profiles. Expose the explicit 100%/75%/50% resolution option without changing physics/mirror frequency. Show a Vietnamese performance notice after three clock overruns within five wall-clock seconds; reset that observation window on pause. Add a regression test for every behavioral correction and non-finite physics -> Error handling. Escalate if a proposed correction changes the approved engine architecture or acceptance criteria.
- [ ] **Step 4: Run full automated validation.** `npm test`; `npm run typecheck`; `npm run build`; `npm run test:browser`; `git diff --check`. All must pass before software-complete claims. Browser tests run Chromium and Firefox; headless software rendering is not reference-GPU performance evidence.
- [ ] **Step 5: Perform hardware/browser walkthroughs.** Record Windows 11/Linux browser versions; one real calibrated wheel's mapping; ten retry/environment-switch cycles; mute/blocked audio; hidden-tab resume; both cars in all five stages; and keyboard-only completion/focus. Confirm an actual safe route exists in each authored setup, not just a contained final-pose fixture.
- [ ] **Step 6: Record performance evidence.** Name CPU/GPU/RAM, browser, OS, drawing resolution and refresh rate. In the worst garage view, warm up, reset metrics, record 60 s with mirrors/sensors/overhead enabled, and report p50/p95/p99 and physics overruns. Evaluate p95 <=6.94 ms at 2560x1440 on the selected reference PC; document lower-resolution fallback and measured minimum-PC 60 FPS results separately.
- [ ] **Step 7: Review learning outcomes and release limitations.** Ask learners to explain the parking sequence after each maneuver; obtain an experienced Vietnam driving instructor's wording/observation review. Mark absent hardware, assets or instructor evidence as pending release gates. Do not call a simulator validated based only on passing software tests.
- [ ] **Step 8: Commit.** Message: `test: record parking simulator acceptance evidence`.

## Isolated implementation prompt templates

Use the approved spec and one task at a time; do not paste the whole repository.
Choose models through the user's current settings. The technical design's old
model names are examples, not current model availability or pricing guarantees.
Reserve stronger reasoning for measured physics/geometry issues, and use
lower-cost execution for known contracts, copy, asset metadata and CSS.

### Normal task

```text
Implement Task <number> from docs\implementation-plan.md only.
Read its Interfaces block and the referenced sections of docs\detail-design.md.
Inspect the existing files named in that task before changing them.
Use strict TypeScript, the existing helpers, Vietnamese learner copy and
vanilla DOM. No new dependencies beyond the task's approved tooling.
Write the task's behavior tests first, run them red, implement the smallest
solution, then run the specified tests, typecheck and build.
Change only the listed files and directly required call sites. Do not rewrite
unchanged code, add graphics effects, invent architecture or soften criteria.
Report changed behavior, exact verification commands/results and real blockers.
Commit only this task's files with its specified message and Copilot trailer.
Stop before the next task.
```

### Physics/geometry investigation

```text
Investigate the failing measured assertion: <test and actual/expected values>.
Use docs\detail-design.md Sections 4-5 and the pinned cannon-es source.
Check axes/signs, COM offsets, timestep, brake impulse and suspension mass
scaling before changing tuning. Reproduce in the smallest real-physics test.
Propose no engine replacement, hidden teleport, fake speed clamp or wider
acceptance tolerance. Make one justified correction and rerun related tests.
Report measurements and any unresolved model limitation. Stop when bounded.
```

### HUD/copy or asset metadata

```text
Implement only <named UI/metadata change> from Task <number>.
Reuse src\contracts.ts and src\messages.ts; all learner text is Vietnamese.
Keep #9B59B6 active/target accents; green/yellow/red only for sensor warnings.
Preserve semantic controls, visible keyboard focus and the 1280x720 layout.
For assets use docs\asset-pipeline.md; never infer colliders from mesh names,
apply axis conversion twice or substitute missing cockpit assets silently.
Run the task's focused checks and report exact results without extra prose.
```

## Dependency order and spec coverage

Execute Tasks 1-8 in order. Task 3 relies on the rig; Tasks 4-5 consume its
snapshots; Task 6 replaces explicit prototypes without changing those contracts;
Task 7 integrates the lessons/persistence; Task 8 validates the complete product.
This intentionally favors one coherent implementation thread over parallel
agents modifying shared app/types/UI files.

| Detailed-design sections | Owning tasks |
|---|---|
| 1-2: intent, constraints, chosen approach | Global constraints; Tasks 1, 7, 8 |
| 3: lifecycle/update order | Tasks 1-3 and 7 |
| 4-5: geometry, steering, physics and gears | Tasks 2 and 8 |
| 6: keyboard/wheel input | Tasks 3 and 7 |
| 7: cameras/mirrors/overhead/trajectory | Task 4; real-asset review in Task 6 |
| 8: sensors/audio | Task 5 |
| 9-10: five stages, outcomes and persistence | Task 7; driveability review in Task 8 |
| 11: strict boundary contracts | Task 1; adapter extensions explicitly defined above |
| 12: Vietnamese HUD, focus and accessibility | Tasks 1, 3-5 and 7 |
| 13: assets, disposal, budgets and compatibility | Tasks 4, 6 and 8 |
| 14-15: measured acceptance and deferred work | Task 8; blocked evidence reported explicitly |
| 16: engine-sensitive references | Task 2 verifies pinned implementation assumptions |

## Plan review and execution boundary

This plan does not claim that packages install, application code compiles,
assets exist or tests pass: none has been executed during documentation work.
Review the file boundaries, interfaces and acceptance thresholds before
authorizing implementation. Missing real hardware/art/instructor evidence
blocks the corresponding release claim, not unrelated logic development.

Selected execution method: **Native**, confirmed by the project owner. Tasks share a small set of
rig/snapshot/state interfaces and modify the same application owner; one
implementation thread reduces context cost and coordination churn. Use the
execution skill's required review gates, including an independent final review.
