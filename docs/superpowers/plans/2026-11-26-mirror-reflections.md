# Mirror Reflections and Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three fixed mirror cameras with true planar reflections from the driver eye, realign the default glass to the common "sliver of own car" setting, and add live, saved, per-vehicle mirror adjustment.

**Architecture:** A pure optics module turns (eye, glass pose, glass size, convexity) into a virtual-eye camera pose plus an off-axis projection; `cameras.ts` applies it per mirror pass from the glass mesh's live world transform. The asset contract derives default glass quaternions from an alignment rule; the generator, prototype scene and loader all consume the contract. Adjustment is yaw/pitch offsets on the glass mesh, driven by a keyboard mirror mode in the input controller, gated in the preview loop and persisted in settings.

**Tech Stack:** TypeScript, three.js 0.187, Vitest, Playwright, Node asset generator (`tools/`).

**Spec:** `docs/superpowers/specs/2026-11-26-mirror-reflections-design.md`

## Global Constraints

- Mirrors stay capped at 15 FPS (`MIRROR_INTERVAL_MS`); one auxiliary pass per mirror; no new main-pass draw calls beyond the selection outline (≤1 extra, hidden when nothing is selected).
- Glass: rear 0.24 x 0.06 m k=1.0; left (driver) 0.22 x 0.13 m k=1.0; right (passenger) 0.22 x 0.13 m k=1.3.
- Side default rule: inner horizontal view edge 1° inward of the rearward (+Z) axis; centre ray pitched 3° down. Rear default: centre ray straight back (+Z), pitched 2° down.
- Adjustment: ±12° yaw and pitch per mirror, 8°/s while held; only in gear P or with parking brake on.
- Keys: `KeyM` cycles off → left → right → rear → off; arrow keys tilt while selected (left/right yaw, up/down pitch); WASD unchanged.
- All user text in Vietnamese in `src/messages.ts`.
- Colliders, `mirrorBoxes`, profiles, lessons and handling unchanged.
- Never call `updateProjectionMatrix()` on mirror cameras.
- Regenerated GLBs go to a candidate dir outside `public` and need developer approval before promotion (docs/asset-pipeline.md).

## Review Focus

- Adjusting at the ±12° clamp then holding further: glass must stop, not drift or wrap — test in Task 4.
- Releasing the parking brake / shifting out of P while an arrow is held: mirror deselects and the held arrow must not start steering until re-pressed — test in Task 4.
- Corrupt or out-of-range saved `mirrorAdjustments` (NaN, strings, 90°): loads as clamped/zero, never throws or blocks other settings — test in Task 5.
- Switching vehicle (sedan ↔ CUV): each loads its own saved offsets, not the other's — test in Task 5.
- Eye extremely close to/behind the glass plane (degenerate adjustment or bad asset): optics must throw a RangeError rather than produce NaN matrices — test in Task 1.

---

### Task 1: Planar mirror optics

**Files:**
- Create: `src/views/mirror-optics.ts`
- Test: `src/views/mirror-optics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MirrorGlass {
    readonly center: Vector3;      // world
    readonly quaternion: Quaternion; // world; local +Z = normal facing the eye, +X right, +Y up
    readonly halfSizeM: readonly [number, number];
    readonly convexity: number;    // k >= 1
  }
  export function reflectPoint(point: Vector3, glass: MirrorGlass, out?: Vector3): Vector3;
  export function applyMirrorCamera(camera: PerspectiveCamera, eye: Vector3, glass: MirrorGlass, far: number): void;
  ```
  `applyMirrorCamera` sets camera position (virtual eye), quaternion, `matrixWorld`, `projectionMatrix` (via `makePerspective(l, r, t, b, near=d, far)`) and `projectionMatrixInverse`.

- [ ] **Step 1: Write failing tests** (`describe('mirror optics')`)
  - `reflects the eye across the glass plane`: glass at origin facing +Z, eye (0.1, 0.2, 0.7) → (0.1, 0.2, -0.7).
  - `maps the reflected centre ray to the glass centre`: take an eye and tilted glass (yaw 20°, pitch -5°); world point Q = glass centre + 10 m along the reflection of (centre − eye); project Q with the camera → NDC ≈ (0, 0) within 1e-6.
  - `maps reflected corner rays to the matching corners`: for corner (+w, +h) in glass local, the reflected ray's far point projects to NDC (+1, +1) after the texture flip convention is accounted for; assert the sign pairing explicitly (document in the test which NDC x corresponds to glass local +X, so the `repeat.x = -1` flip in `cameras.ts` yields a correct mirror image: an object to the driver's left appears on the left of the glass).
  - `puts the near plane on the glass`: a point on the glass plane has NDC z ≈ -1.
  - `widens the view by the convexity factor`: tan(half horizontal angle) for k=1.3 is 1.3x that of k=1.
  - `rejects an eye on or behind the glass`: eye on the plane or on the back side throws `RangeError`.

- [ ] **Step 2:** Run `npx vitest run src/views/mirror-optics.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** in `src/views/mirror-optics.ts`. Virtual eye E' = E − 2((E−P)·N)N; camera −Z = +N (camera quaternion = glass quaternion rotated 180° about local Y, or equivalent; pick the one making the corner test pass); d = (P − E')·N must be > 1e-3 else RangeError; extents from (P − E') projected on camera X/Y ± half-size, all scaled to near = d, then multiplied by k about the projected centre.

- [ ] **Step 4:** Run the test file → PASS. Run `npm run typecheck` → no errors.

- [ ] **Step 5: Commit** `feat(views): planar mirror optics with off-axis frustum`

---

### Task 2: Mirror contract — glass poses, sizes, convexity

**Files:**
- Modify: `src/vehicle/asset-contract.ts` (replace `mirrorYawRad` in `VehicleViewProfile`; extend `deriveVehicleAssetContract`)
- Modify: `src/runtime-types.ts:51` (`VehicleAnchors.mirrors` value type)
- Modify: `src/render/prototype.ts:68-136` (surfaces and anchors from contract)
- Modify: `src/world/assets.ts` (`validateVehicleScene` mirror check; `pose()` reads full quaternion; anchors carry glass size/convexity from contract)
- Test: `src/vehicle/asset-contract.test.ts`, `src/views/views.test.ts:205-216,375-395`

**Interfaces:**
- Consumes: `reflectPoint` (Task 1) for the alignment test only.
- Produces:
  ```ts
  export interface MirrorSpec extends BodyPose {   // positionM = glass centre, rotation = default glass quaternion (full)
    readonly halfSizeM: readonly [number, number];
    readonly convexity: number;
  }
  // deriveVehicleAssetContract(profile).mirrors: Record<MirrorId, MirrorSpec>
  // VehicleAnchors.mirrors: Readonly<Record<MirrorId, MirrorSpec>>
  export function defaultGlassRotation(eye: Vec3Data, glassCenter: Vec3Data, reflectedDir: Vec3Data): BodyPose['rotation'];
  ```
  Side glass centres stay at `mirrorBoxes(profile)[i].centerLocalM`; rear at `rearDisplayM`. Glass local +Z faces the eye; +Y stays as close to vehicle up as possible (no roll).

- [ ] **Step 1: Write failing tests** in `asset-contract.test.ts`, for both `sedan` and `cuv`:
  - `sizes and convexity match the spec`: rear halfSize [0.12, 0.03] k 1; left/right [0.11, 0.065], k 1 / 1.3.
  - `side mirrors show a sliver of the flank on the inner edge`: reflect the eye ray through the inner glass edge midpoint (edge nearest the body, accounting for k by widening per Task 1) — its horizontal direction is 1° ± 0.2° inward of +Z; through the outer edge it is outward. Driver centre-ray yaw is within 3°–8° outward; passenger within 3°–9°.
  - `side centre rays pitch 3° down and rear 2° down, rear straight back` (±0.2°).
  - `glass rotations are unit, finite, roll-free`.
- [ ] **Step 2:** Run `npx vitest run src/vehicle/asset-contract.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Solve the side centre-ray yaw numerically (bisection on yaw, 30 iterations) so the inner-edge ray satisfies the 1° rule, then `defaultGlassRotation` = rotation whose +Z = normalize(toEye + reflectedDir) with no roll. Update `prototype.ts` to place `mirror-surface-*` meshes (PlaneGeometry of contract size) at contract poses — remove the prototype's private rear display offset and ±45° side yaw — and anchors = contract mirrors. Update `assets.ts`: anchors merge node pose with contract `halfSizeM`/`convexity`; `validateVehicleScene` compares the full quaternion (angle < 0.5°) of `Mirror*` nodes. Update `views.test.ts` anchor/facing expectations to the contract.
- [ ] **Step 4:** Run `npx vitest run src/vehicle src/views src/render` → PASS except tests reading the checked-in GLBs (expected stale until Task 7; list them in the commit message).
- [ ] **Step 5: Commit** `feat(vehicle): mirror glass contract from alignment rule`

---

### Task 3: Render mirrors as reflections

**Files:**
- Modify: `src/views/cameras.ts` (remove `MIRROR_SPECS` FOVs and `bodyPoseCamera` use for mirrors; target sizing; per-pass optics)
- Test: `src/views/views.test.ts:236-372`

**Interfaces:**
- Consumes: `applyMirrorCamera`, `MirrorGlass` (Task 1); `anchors.mirrors[id].halfSizeM/convexity` (Task 2).
- Produces: `ViewSystem.setMirrorOffsets(offsets: MirrorOffsets): void` and `ViewSystem.setMirrorHighlight(id: MirrorId | null): void`, where `MirrorOffsets = Readonly<Record<MirrorId, { readonly yawRad: number; readonly pitchRad: number }>>` (type exported from `src/views/mirror-adjust.ts`, created in this task with just the type and `ZERO_MIRROR_OFFSETS`). Glass mesh quaternion = default × yaw(about glass local Y) × pitch(about glass local X).

- [ ] **Step 1: Write failing tests** in `views.test.ts`:
  - `sizes mirror targets from glass aspect`: high quality rear 512x128, sides 256x151 (round(256·0.13/0.22)); low quality halves both.
  - `places each mirror camera at the reflected driver eye`: after `render`, `mirror-left-camera` world position equals `reflectPoint(eye)` for the left glass's world transform.
  - `follows glass offsets`: `setMirrorOffsets({ left: { yawRad: 0.1, pitchRad: 0 }, ... })` then render → left glass world quaternion changed by 0.1 rad about its up axis and the camera's position changed accordingly; others unchanged.
  - `highlights only the selected mirror`: `setMirrorHighlight('right')` makes an object named `mirror-highlight` visible, on `MIRROR_EXCLUDED_LAYER`, positioned at the right glass; `null` hides it.
  - Keep the existing throttling test (9 mirror calls) and the binding test passing.
- [ ] **Step 2:** Run `npx vitest run src/views/views.test.ts` → new tests FAIL.
- [ ] **Step 3: Implement.** Store each glass mesh's default quaternion at creation; in `updateMirrorCameras` apply offsets, `updateMatrixWorld`, decompose world centre/quaternion, call `applyMirrorCamera(camera, driverEye, glass, 100)`. Highlight: one `LineSegments` rectangle (`EdgesGeometry` of a plane at glass size + 0.01 m), parented to the selected glass mesh; dispose in `dispose()`.
- [ ] **Step 4:** Run `npx vitest run src/views` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(views): render mirrors as planar reflections`

---

### Task 4: Live adjustment — controller mode, rate/clamp, gating

**Files:**
- Modify: `src/views/mirror-adjust.ts` (add stepping logic)
- Modify: `src/input/controller.ts` (mirror mode)
- Modify: `src/runtime-types.ts:68` (`InputPoll`)
- Modify: `src/render/preview.ts` (apply per frame, gating, events)
- Modify: `src/messages.ts` (notices)
- Test: `src/views/mirror-adjust.test.ts` (create), `src/input/input.test.ts`, `src/render/preview.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // mirror-adjust.ts
  export const MIRROR_LIMIT_RAD = 12 * Math.PI / 180;
  export const MIRROR_RATE_RADPS = 8 * Math.PI / 180;
  export function stepMirrorOffsets(offsets: MirrorOffsets, id: MirrorId, axis: { yaw: -1|0|1; pitch: -1|0|1 }, dtS: number): MirrorOffsets;
  export function clampMirrorOffsets(value: MirrorOffsets): MirrorOffsets;
  // InputPoll gains:
  readonly mirror: { readonly selected: MirrorId | null; readonly yaw: -1|0|1; readonly pitch: -1|0|1 };
  // InputController gains:
  setMirrorAdjustAllowed(allowed: boolean): void;   // false deselects and suppresses held arrows
  // PreviewEvents gains:
  onMirrorOffsets?(vehicleId: VehicleId, offsets: MirrorOffsets): void; // fired on deselect only
  // PreviewHandle gains:
  setMirrorOffsets(offsets: MirrorOffsets): void; resetMirrors(): void;
  ```
- Messages (keys in `vi`): `mirrorAdjustLeft: 'Đang chỉnh gương trái — dùng phím mũi tên'`, `mirrorAdjustRight: 'Đang chỉnh gương phải — dùng phím mũi tên'`, `mirrorAdjustRear: 'Đang chỉnh gương chiếu hậu trong — dùng phím mũi tên'`, `mirrorAdjustBlocked: 'Chỉ chỉnh gương khi về số P hoặc kéo phanh tay'`, `mirrorAdjustDone: 'Đã lưu vị trí gương'`.

- [ ] **Step 1: Write failing tests.**
  - mirror-adjust: `steps at 8°/s` (1 s yaw +1 → 8°); `clamps at ±12°` (3 s → 12°, further steps stay 12°); `ignores non-finite dt`; `clampMirrorOffsets` maps NaN → 0 and 90° → 12°.
  - controller: `KeyM cycles left, right, rear, off`; `arrows set mirror axis and not steering while selected`; `WASD still drives while selected`; `KeyM ignored when not allowed` (poll reports `mirror.selected === null` and enqueues no selection; preview raises `mirrorAdjustBlocked`); `disallowing deselects and a still-held arrow does not steer until re-pressed`; `Escape/blur/clear deselects`.
  - preview: with telemetry gear D and brake off, `setMirrorAdjustAllowed(false)` each frame; in P, holding ArrowLeft 0.5 s with left selected changes offsets by 4° yaw; deselect fires `onMirrorOffsets('sedan', …)` once and notice `mirrorAdjustDone`.
- [ ] **Step 2:** Run the three test files → FAIL.
- [ ] **Step 3: Implement.** Controller: `KeyM` handled alongside gear keys (same focus rule); while selected, arrow codes go to a separate `mirrorHeld` set, not `held`; on mode exit move still-held arrows into `suppressed`. Preview tick: `input.setMirrorAdjustAllowed(gear === 'P' || parkingBrake)` from `current.telemetry` before polling; step offsets once per rendered frame with real elapsed time, call `views.setMirrorOffsets` and `views.setMirrorHighlight`; emit selection notices via `events.onNotice` on change.
- [ ] **Step 4:** Run tests and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(input): live mirror adjustment mode`

---

### Task 5: Persistence, app wiring, reset button

**Files:**
- Modify: `src/runtime-types.ts:76` (`SettingsSaveV1`)
- Modify: `src/storage/persistence.ts` (default + `validateSettings`)
- Modify: `src/app.ts` (save on `onMirrorOffsets`, push saved offsets on preview start/vehicle change, `reset-mirrors` action)
- Modify: `src/ui/view-settings.ts:227-230` (button next to recenter), `src/contracts.ts:39` and `src/runtime-types.ts:170` (action union), `src/messages.ts` (`resetMirrors: 'Đặt lại gương'`)
- Test: `src/storage/persistence.test.ts`, `src/ui/ui.test.ts`, `tests/browser/driving.spec.ts`

**Interfaces:**
- Consumes: `MirrorOffsets`, `clampMirrorOffsets` (Tasks 3–4); preview `setMirrorOffsets`, `resetMirrors`, `onMirrorOffsets` (Task 4).
- Produces: `SettingsSaveV1.mirrorAdjustments?: Readonly<Partial<Record<VehicleId, Record<MirrorId, { yawDeg: number; pitchDeg: number }>>>>` (degrees on disk, radians in runtime); action `{ type: 'reset-mirrors' }`.

- [ ] **Step 1: Write failing tests.**
  - persistence: `round-trips mirror adjustments per vehicle`; `old saves without mirrorAdjustments load with zero offsets and keep other settings`; `malformed entries (NaN, string, 90) are clamped or zeroed without rejecting the record`.
  - ui: clicking `#reset-mirrors` emits `{ type: 'reset-mirrors' }`.
  - app/persistence: saving sedan offsets does not alter cuv offsets; starting a CUV preview applies CUV offsets.
  - browser `driving.spec.ts`: `adjusts and resets a side mirror` — start sandbox in P, press M, hold ArrowLeft 1 s, release, press M ×3 to deselect; the left mirror render-target pixels differ from before; reload → still adjusted; click reset → matches original capture.
- [ ] **Step 2:** Run unit tests → FAIL.
- [ ] **Step 3: Implement.** Adjustment saves bypass the "not while running" gate of `update-settings` (they come from `onMirrorOffsets`, not the panel). Reset clears the current vehicle's entry, saves, and calls `preview.resetMirrors()`.
- [ ] **Step 4:** Run `npm test` (unit) and `npm run typecheck` → PASS except stale-GLB tests. Browser spec runs after Task 7.
- [ ] **Step 5: Commit** `feat: persist mirror adjustments and add reset`

---

### Task 6: Regenerate vehicle candidates and present for approval

**Files:**
- Modify: `tools/asset-designs/vehicles.mjs:571-620` (`authorMirrors`) and whatever passes the contract into the generator (`tools/asset-geometry.mjs` / `generate-assets.mjs`, follow existing data flow)
- Test: existing generator/loader/view tests via `assets:review`

**Interfaces:**
- Consumes: contract `MirrorSpec` (Task 2).

- [ ] **Step 1:** Capture a baseline review of the current public GLBs: `npm run assets:review -- --vehicle sedan --out <scratchpad>/review-before-sedan` (and cuv).
- [ ] **Step 2: Update `authorMirrors`**: `Mirror*` node translation = glass centre, rotation = contract glass quaternion; `MirrorSurface*` quad of contract size at the same pose (drop the camera-yaw bisector code); housings fixed, sized to glass + 0.025 m and oriented to the default glass; side arm/foot as today. Keep triangle gates.
- [ ] **Step 3:** `npm run assets:generate -- --vehicle sedan --out <scratchpad>/candidate` (and cuv), then `npm run assets:check -- --vehicle <id> --candidate <scratchpad>/candidate` → PASS.
- [ ] **Step 4:** `npm run assets:review -- --vehicle <id> --candidate <scratchpad>/candidate --out <scratchpad>/review-after-<id>` → PASS; inspect neutral cockpit, look-left/right, each mirror face, silhouette and collider overlays.
- [ ] **Step 5: Commit** generator changes only (no GLBs) `feat(assets): author mirror glass from contract`.
- [ ] **Step 6: STOP.** Present before/after captures (all three mirrors, both vehicles) with notes on inferred geometry, and wait for developer approval of the candidate hashes.

---

### Task 7: Promote approved GLBs and finish verification (after approval only)

**Files:**
- Modify: `public/assets/vehicles/sedan.glb`, `public/assets/vehicles/cuv.glb` (approved candidate bytes), provenance/catalog evidence files the pipeline doc names
- Modify: `src/world/assets.ts` (also validate `MirrorSurface*` pose and half-size within 2 mm / 0.5°)
- Test: `src/world/assets.test.mjs`

- [ ] **Step 1: Write failing loader test**: a vehicle scene whose `MirrorSurfaceLeft` is rotated 5° from its pivot is rejected with `invalid-contract`.
- [ ] **Step 2:** Implement the check; copy approved GLBs; update provenance.
- [ ] **Step 3:** Run `npm run assets:check`, `npm test`, `npm run build`, `npm run test:browser -- --trace off` → all PASS.
- [ ] **Step 4: Commit** `feat(assets): promote approved mirror GLBs` and push.
