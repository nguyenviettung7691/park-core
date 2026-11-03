# Phase 4 Vision & Support Systems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the complete Phase 4 camera, mirror, overhead, trajectory, proximity-sensor, and audio-warning systems to the Park-Core prototype.

**Architecture:** Keep `render/preview.ts` as the sole physics/animation loop and `WebGLRenderer` as the sole renderer. Build the view system and trajectory first, then connect world-ray sensors and optional audio to the same simulation lifecycle and Vietnamese HUD.

**Tech Stack:** Strict TypeScript, Three.js 0.187.0, Cannon-es 0.20.0, vanilla DOM/CSS, Vitest, Playwright Chromium and Firefox.

**Spec:** [Approved Phase 4 design](../specs/2026-11-03-phase-4-vision-support-design.md); detailed product requirements in `docs/detail-design.md` Sections 7, 8, 12 and 13; current code foundation in `src/render/preview.ts`, `src/render/prototype.ts`, `src/ui/hud.ts`, `src/contracts.ts` and `src/runtime-types.ts`.

## Global Constraints

- Use meters, radians and vehicle-local X right, Y up, -Z forward; use the existing fixed-step simulation and single RAF owner.
- Use one WebGL renderer, one overhead RenderTarget, no GPU readback, no custom shaders, and no separate render/audio polling loops.
- Driver FOV is 60 degrees by default and adjustable from 50 to 80; yaw is limited to +/-110 degrees and pitch to -45 through +35 degrees.
- Chase starts 5 m behind and 2.5 m above; use one center plus four offset obstruction rays, retract immediately to hit distance minus 0.2 m, and restore smoothly.
- Rear mirror target starts at 512x128 with 50-degree vertical FOV; each side target starts at 256x256 with 75-degree vertical FOV. Mirrors update at most 15 Hz without catch-up.
- The overhead view covers 10x10 m in a 320x320 CSS-pixel lower-right inset, faces forward at the top, and updates at most 30 Hz.
- Trajectory extends at most 3 m from the rear axle, uses current steering and gear, and stops at the first predicted conservative body-envelope overlap.
- Cast five physics rays per front/rear bumper at yaw offsets -60/-30/0/+30/+60 degrees, across the bumper width, starting 0.45 m above ground. Exclude the learner vehicle and non-solid markers; no-hit is `null`.
- Sensor bands are clear beyond 2.5 m/no hit; green above 1.2 m through 2.5 m; yellow above 0.6 m through 1.2 m; red above 0.3 m through 0.6 m; STOP at or below 0.3 m. Require 0.05 m extra clearance to leave a band.
- Sensor and regular DOM updates are at most 20 Hz. Audio is unlocked by a deliberate user action, silenced on pause/outcome/disposal, and never replaces visible warnings.
- Keep all learner-facing copy in Vietnamese. Use labels, distance and shape as well as color; preserve 44x44 px controls, keyboard focus, reduced-motion behavior and existing resize/context-loss/disposal handling.
- Temporary cockpit and mirror surfaces are explicitly prototype visuals, not training-ready assets. Do not claim validated hardware, vehicle fidelity, or reference-PC performance.
- Do not add a dependency, revise physics, or expand persistence.

## Review Focus

1. **Auxiliary pass corrupts later rendering:** tests must prove renderer/camera state is restored after a successful pass and a thrown render; owner: Task 2.
2. **Pointer lock is lost or denied while controls remain active:** tests must prove start/resume requires the requested lock and lock loss pauses without auto-resume; owner: Task 3.
3. **Ray sampling reports the vehicle itself or a fabricated zero for no hit:** real-world tests must prove self exclusion, nearest valid hit and `null`; owner: Task 4.
4. **Band hysteresis or loop timing causes flicker/beep bursts:** boundary, simulation-time, pause and no-catch-up tests must prove stable warnings and stopped audio; owner: Task 4.
5. **Preview disposal leaks render targets, audio nodes, listeners or frames:** repeated open/close and fault-path tests must prove exactly-once cleanup; owners: Tasks 2-5.

---

## File ownership map

| Files | Responsibility |
|---|---|
| `src/views/trajectory.ts`, `trajectory.test.ts` | Pure bicycle-path sampling and swept-envelope obstacle stopping |
| `src/views/auxiliary.ts`, `cameras.ts`, `views.test.ts` | Renderer state ownership, camera rigs, mirror/overhead passes, view timing and resources |
| `src/runtime-types.ts`, `src/render/prototype.ts` | Prototype scene assets, explicit local anchors, temporary cockpit/mirror geometry |
| `src/render/preview.ts`, `preview.test.ts` | Shared loop, camera/mouse lifecycle, sensor sample timing and cleanup |
| `src/ui/hud.ts`, `ui.test.ts`, `src/style.css`, `src/messages.ts` | Accessible view controls, proximity warnings, volume/mute and Vietnamese copy |
| `src/app.ts`, `app.test.ts` | Settings routing, deliberate pointer-lock/audio unlock gestures, paused/error notices |
| `src/sensors/proximity.ts`, `audio.ts`, `sensors.test.ts` | Ray coverage, classification/hysteresis and audio output lifecycle |
| `tests/browser/driving.spec.ts` | Real-browser integration for views, pointer lock, warning UI, audio fallback and disposal |
| `docs/phase-4-detail-design.md`, `docs/phase-4-implementation-plan.md`, `docs/tech-design.md`, `docs/detail-design.md`, `docs/implementation-plan.md` | Phase documents and verified roadmap/status reconciliation |

## Model-tier routing

| Task | Tier | Work |
|---|---|---|
| 1 | Premium | Rear-axle reference, bicycle trajectory and conservative swept-envelope geometry |
| 2 | Premium | Camera/projection math, chase obstruction, mirror/overhead render passes and state restoration |
| 3 | Standard; Lightweight only after decisions for repetitive CSS/DOM | Pointer-lock lifecycle, typed settings, HUD controls and app integration |
| 4 | Standard | Cannon ray sampling, threshold/hysteresis, audio scheduling and sensor/HUD integration |
| 5 | Standard | Cross-system browser verification and documentation/status updates |

Keep the work task-bounded; do not run a whole-phase parallel implementation or duplicate review pass.

### Task 1: Trajectory geometry

**Files:**
- Create: `src/views/trajectory.ts`
- Create: `src/views/trajectory.test.ts`
- Consume: `src/contracts.ts`, `src/runtime-types.ts`, `src/vehicle/geometry.ts`, `src/world/colliders.ts`

**Interfaces produced:**

```ts
export interface TrajectorySample {
  readonly rearAxleM: Vec3Data;
  readonly envelope: readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data];
}

export function sampleTrajectory(
  telemetry: VehicleTelemetry,
  profile: VehicleProfile,
  boxes: readonly ColliderBox[],
): readonly TrajectorySample[];
```

Tier: **Premium**.

- [ ] **Step 1: Write failing tests.** Cover straight travel at zero steering, D/R direction, a turning path, the front-overhang swept envelope, and stopping at the first overlap with an axis-aligned and rotated solid box; ground colliders must not truncate the path.
- [ ] **Step 2: Run the focused tests red.** Run `npm test -- src\views\trajectory.test.ts`; confirm the missing function/test failures.
- [ ] **Step 3: Implement trajectory sampling.** Use the rear axle center (`COM - worldForward * frontWeightFraction * wheelbaseM`); sample the bicycle-model curve no farther than 3 m and build a conservative body envelope from vehicle profile dimensions. Exclude non-solid markers.
- [ ] **Step 4: Run focused tests and typecheck.** Run `npm test -- src\views\trajectory.test.ts` and `npm run typecheck`; both must pass.

### Task 2: Camera, mirror and overhead view system

**Files:**
- Create: `src/views/auxiliary.ts`
- Create: `src/views/cameras.ts`
- Create: `src/views/views.test.ts`
- Modify: `src/runtime-types.ts`, `src/render/prototype.ts`
- Consume: Task 1 `sampleTrajectory`; `src/render/fit.ts`; `src/contracts.ts`

**Interfaces produced:**

```ts
export interface RendererPort {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setRenderTarget(target: THREE.WebGLRenderTarget | null): void;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setViewport(x: number, y: number, width: number, height: number): void;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  setScissor(x: number, y: number, width: number, height: number): void;
  getScissor(target: THREE.Vector4): THREE.Vector4;
  setScissorTest(enabled: boolean): void;
  getScissorTest(): boolean;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
}

export interface AuxiliaryPass {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly target: THREE.WebGLRenderTarget | null;
  readonly viewport: readonly [number, number, number, number];
  readonly scissor: readonly [number, number, number, number] | null;
  readonly scissorTest: boolean;
  readonly layerMask: number;
}

export interface ViewSystem {
  render(frame: RenderFrame, nowMs: number): void;
  look(deltaX: number, deltaY: number): void;
  setCamera(mode: CameraMode): void;
  setOverhead(enabled: boolean): void;
  setTrajectory(enabled: boolean): void;
  setFov(degrees: number): void;
  resize(widthCss: number, heightCss: number, pixelRatio: number): void;
  recenter(): void;
  dispose(): void;
}

export function renderAuxiliaryPass(
  renderer: RendererPort, pass: AuxiliaryPass,
): void;

export function createViews(
  renderer: RendererPort,
  scene: THREE.Scene,
  assets: SceneAssets,
  profile: VehicleProfile,
  boxes: readonly ColliderBox[],
): ViewSystem;
```

Tier: **Premium**.

- [ ] **Step 1: Write failing renderer/camera tests.** Verify `renderAuxiliaryPass` restores target, viewport, scissor, scissor-test, clear color/alpha and camera layer mask on success and when `render()` throws; test prototype anchors/placeholders, FOV/yaw/pitch bounds, chase retraction/restore, mirror and overhead rates with no catch-up, CSS-to-buffer scissor coordinates including WebGL's lower-left origin, and exactly-once RenderTarget disposal.
- [ ] **Step 2: Run the focused tests red.** Run `npm test -- src\views\views.test.ts`; confirm the new behavior is not present.
- [ ] **Step 3: Implement prototype anchors and the view system.** Extend `SceneAssets` with vehicle-local driver-eye and rear/left/right mirror poses. Add simple, non-final cockpit and mirror surfaces; keep collision geometry authoritative in Cannon, not inferred from meshes. Use one driver and one chase camera, three mirror RenderTargets, one orthographic overhead RenderTarget, and one pass owner. Mirrors update at most once per 66.7 ms; overhead capture updates at most once per 33.3 ms but its most recent texture is composited each main frame. Render the main camera every frame. Use design camera limits, FOVs, target dimensions, forward-up overhead orientation and chase collision offsets. Draw the Task 1 trajectory only when enabled.
- [ ] **Step 4: Run focused tests and typecheck.** Run `npm test -- src\views\views.test.ts src\views\trajectory.test.ts` and `npm run typecheck`; both must pass.

### Task 3: Preview, pointer lock and view HUD integration

**Files:**
- Modify: `src/render/preview.ts`, `src/render/preview.test.ts`
- Modify: `src/app.ts`, `src/app.test.ts`
- Modify: `src/ui/hud.ts`, `src/ui/ui.test.ts`
- Modify: `src/messages.ts`, `src/style.css`, `src/runtime-types.ts`
- Consume: Task 2 `ViewSystem`

**Interfaces produced:**

```ts
export interface Preview {
  resume(): boolean;
  pause(): void;
  enqueue(action: InputAction): void;
  requestPointerLock(): Promise<boolean>;
  updateSettings(settings: SettingsSaveV1): void;
  dispose(): void;
}

export interface Hud {
  update(telemetry: VehicleTelemetry | null, source: InputSource): void;
  updateSettings(settings: SettingsSaveV1): void;
  setDriveControls(visible: boolean): void;
  setSession(phase: PreviewPhase): void;
  dispose(): void;
}
```

Tier: **Standard** for pointer-lock lifecycle, settings and app/HUD integration; **Lightweight** only for repetitive CSS/DOM scaffolding once controls and interfaces are fixed.

- [ ] **Step 1: Write failing preview/app/HUD tests.** Cover camera mode, overhead, trajectory, FOV and recenter controls; initial settings are passed to `createPreview` and later updates reach the running preview without persistence; mouse movement affects view only while locked; denied lock stays paused with a Vietnamese notice; lock loss pauses and requires explicit resume; disposing removes pointer listeners and releases view resources. Keep existing gamepad and keyboard controls unchanged.
- [ ] **Step 2: Run the focused tests red.** Run `npm test -- src\render\preview.test.ts src\app.test.ts src\ui\ui.test.ts`; confirm the new behavior fails.
- [ ] **Step 3: Integrate `ViewSystem` into the existing preview loop.** Add initial `SettingsSaveV1` to `PrototypeOptions`. `createPreview` owns the view system, passes interpolated frames and wall time, routes mouse deltas only while pointer-locked, updates it on settings/resize, and disposes it on every close/fault path. `requestPointerLock()` resolves `true` only after acquisition and `false` on expected denial/unavailability; it cannot remain pending after disposal. Start/resume requests pointer lock from a deliberate user gesture; failure remains paused, and loss while running pauses without auto-resume.
- [ ] **Step 4: Wire semantic HUD controls and messages.** Use existing `ScreenAction.update-settings` for camera mode, overhead/trajectory toggles, FOV, volume and mute. Preserve Vietnamese labels and focus behavior; keep controls at least 44x44 px. Existing `InputAction` gear/indicator actions remain unchanged.
- [ ] **Step 5: Run focused tests, typecheck and build.** Run `npm test -- src\render\preview.test.ts src\app.test.ts src\ui\ui.test.ts`, `npm run typecheck` and `npm run build`; all must pass.

### Task 4: Proximity sensing and accessible audio

**Files:**
- Create: `src/sensors/proximity.ts`
- Create: `src/sensors/audio.ts`
- Create: `src/sensors/sensors.test.ts`
- Modify: `src/render/preview.ts`, `src/render/preview.test.ts`
- Modify: `src/app.ts`, `src/app.test.ts`
- Modify: `src/ui/hud.ts`, `src/ui/ui.test.ts`
- Modify: `src/messages.ts`, `src/style.css`
- Consume: Task 3 `Hud`, `Preview` and view/settings lifecycle

**Interfaces produced:**

```ts
export function classifyDistance(
  distanceM: number | null,
  previous: SensorBand,
): SensorBand;

export interface ProximitySensors {
  sample(simulationTimeS: number): SensorSnapshot;
  reset(): void;
}

export function createSensors(
  world: CANNON.World,
  body: CANNON.Body,
  profile: VehicleProfile,
): ProximitySensors;

export interface AudioOutput {
  unlock(): Promise<'ready' | 'unavailable'>;
  update(
    sensors: SensorSnapshot,
    signedSpeedMps: number,
    simulationTimeS: number,
  ): void;
  setVolume(value: number): void;
  setMuted(value: boolean): void;
  suspend(): void;
  dispose(): void;
}

export function createAudio(): AudioOutput;
```

Tier: **Standard**.

- [ ] **Step 1: Write failing HUD, classification and ray tests.** Cover sensor DOM hidden/empty until a real sample; exact boundaries (`null`, 2.5, 1.2, 0.6, 0.3 m); 0.05 m hysteresis for leaving each band; immediate entry to closer bands; nearest hit; self exclusion; bumper origins/angles; and a low obstacle missed at the specified ray height. Use real Cannon worlds for ray coverage.
- [ ] **Step 2: Write failing audio tests.** Verify one nearest-warning stream, travel-direction tie preference, 1.0/0.5/0.2-second intervals and continuous STOP, mute/volume, suspension on pause, disposal, and unavailable AudioContext retaining visual warnings.
- [ ] **Step 3: Run the focused tests red.** Run `npm test -- src\sensors\sensors.test.ts src\ui\ui.test.ts`; confirm expected failures.
- [ ] **Step 4: Add the typed HUD/preview seam and implement sensors.** Add `PreviewEvents.onSensors(snapshot: SensorSnapshot)`, implement `Hud.updateSensors(sensors: SensorSnapshot | null)`, and route the latest snapshot to front/rear warning elements. Keep them empty and hidden until a real sample exists. Cast five rays per bumper at the specified offsets and height; exclude the learner body and non-solid markers; report no hit as `null`. Sample from fixed simulation time no more than 20 Hz, never with catch-up bursts. Reset band history on a new attempt.
- [ ] **Step 5: Implement `createAudio` and integrate sensor snapshots.** Unlock only from the Start gesture. Schedule at most one stream using the nearest warning and specified intervals. Pause/outcome/disposal stops scheduled audio; muted or unavailable audio leaves the labeled sensor UI intact. Surface expected audio unavailability with a nonblocking Vietnamese notice; propagate unexpected failures through the existing fault path.
- [ ] **Step 6: Run focused tests, typecheck and build.** Run `npm test -- src\sensors\sensors.test.ts src\render\preview.test.ts src\app.test.ts src\ui\ui.test.ts`, `npm run typecheck` and `npm run build`; all must pass.

### Task 5: Browser acceptance and phase documentation

**Files:**
- Modify: `tests/browser/driving.spec.ts`
- Create: `docs/phase-4-detail-design.md`
- Create: `docs/phase-4-implementation-plan.md`
- Modify: `docs/tech-design.md`
- Modify only if needed: `docs/detail-design.md`
- Modify after verified completion only: `docs/implementation-plan.md`

Tier: **Standard**; use **Lightweight** only for repetitive documentation formatting or static presentation scaffolding.

- [ ] **Step 1: Add real-browser acceptance tests.** In both configured Chromium and Firefox projects, exercise lock acquisition/loss and explicit resume; driver/chase changes and bounded mouse-look; view controls, resize, mirror refresh and left/right landmark orientation, overhead forward-up orientation/compositing and trajectory toggles; visible front/rear distance labels while muted; audio unlock only after the user gesture, pause silence and unavailable-audio fallback; open/close cycles without uncaught errors. Use the actual WebGL renderer for view evidence; use a test-only AudioContext fake for deterministic sound scheduling, not a production debug global.
- [ ] **Step 2: Run the browser tests.** Run `npm run test:browser -- tests\browser\driving.spec.ts`. Both browsers must pass; install browser binaries only if the runner reports them missing. If real rendering or pointer lock remains unavailable after reasonable setup, record that gate as blocked, not passed.
- [ ] **Step 3: Write the phase-specific detail design and implementation plan.** Link the approved design and record actual interfaces, constraints, task order, tier routing, and evidence without claiming future assets or release gates as complete.
- [ ] **Step 4: Reconcile original documents.** Expand Phase 4 in `docs/tech-design.md` to include driver/chase, pointer lock, mirrors, trajectory, sensors and audio, and link both phase documents. Add only necessary provisional-placeholder clarification to `docs/detail-design.md`. Do not change master-plan acceptance limits.
- [ ] **Step 5: Verify the full phase and record status.** Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser` and `git diff --check`. Only after all required gates pass, mark original implementation-plan Tasks 4-5 and roadmap status complete with actual results and any blocked validation.

## Execution Order and Dependencies

Task 1 and Task 2 form the view slice; Task 2 consumes Task 1. Task 3 consumes
Task 2. Task 4 consumes Task 3. Task 5 verifies and documents the completed
integrated phase. Execute sequentially in this order; keep the two agreed
vertical slices (views/trajectory, then sensors/audio) visible in the work.

## Spec coverage

| Requirement | Task |
|---|---|
| Driver/chase cameras, bounded mouse-look, FOV, recenter and pointer-lock safety | 2-3 |
| Mirrors, overhead inset, render-pass restoration, resizing and resource ownership | 2-3, 5 |
| Trajectory, rear-axle reference and conservative obstacle envelope | 1-2 |
| Front/rear ray readings, bands, hysteresis, labels and audio | 4 |
| Vietnamese accessible HUD and settings | 3-4 |
| Placeholder/non-training boundary and original-document reconciliation | 5 |
| Real browser evidence, pause/disposal and regression gates | 2-5 |
