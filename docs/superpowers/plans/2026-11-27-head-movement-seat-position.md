# Head Movement, Shoulder Checks and Seat Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yaw-coupled head translation, mirror parallax, an adjustable `DriverSeat`, and controller hold-to-glance / stick look (issue #23).

**Architecture:** Pure modules in `src/views/` compute the eye (`head-pose.ts`) and ease the look pose on the fixed 1/120 s step (`look.ts`); `cameras.ts` consumes both and feeds the same eye to the three mirror passes. The seat is a named GLB node moved by `asset-scene.ts`; seat values persist per vehicle in settings; look buttons and stick axes live in calibration v2.

**Tech Stack:** TypeScript 7, Three.js 0.187, Vitest 5 (jsdom), Playwright 1.64, Node-only GLB generator (`tools/`).

**Spec:** `docs/superpowers/specs/2026-11-27-head-movement-seat-position-design.md`

## Global Constraints

- Read `AGENTS.md` and `docs/asset-pipeline.md`; GLB changes go through the candidate loop. Never hand-edit GLBs, never copy unapproved candidates into `public/assets/vehicles`.
- Budgets unchanged: ≤10,000 vehicle triangles, ≤100 sandbox / ≤140 lesson main-pass draw calls, mirrors 15 FPS, overhead 30 Hz, no extra render passes.
- Yaw convention (`cameras.ts`): positive yaw = look left. Limits: left +110°, right −160°; pitch −45°/+35°.
- Head offset onset 60° |yaw|. Offsets at full ramp — left: (−0.06, 0, −0.05) m; right at 110°: (+0.14, 0, −0.03); right at 160°: (+0.19, +0.03, +0.02).
- Seat range: fore/aft −0.10…+0.10 m (+Z rearward), height −0.03…+0.05 m; persisted as integer cm.
- Glance spring: critically damped, ~0.25 s settle, integrated at 1/120 s. Stick: deadzone 0.15, 180°/s yaw, 120°/s pitch.
- Clearance rule: every sampled eye is ≥ 0.12 m from every vehicle triangle (0.1 m near plane + 0.02 m).
- Seat adjustment only while held: speed < `GEAR_SPEED_MPS` and (gear P or parking brake), same as mirrors.
- Mirrors never re-aim when the seat moves.
- All new UI copy is Vietnamese in `src/messages.ts`.
- Do not change handling, lessons, colliders or the parking footprint.

## Review Focus

1. **Glance held while pausing / losing focus / unplugging the pad** → the glance releases and the view eases back on resume; nothing sticks. Test in Task 6 and Task 9.
2. **Old v1 calibration in storage** → still loads and drives; only look features are absent. Test in Task 5.
3. **Corrupt or out-of-range `seatPositions`** (NaN, strings, 99 cm, unknown vehicle) → defaults/clamped, settings never rejected. Test in Task 4.
4. **Seat moved, then a full shoulder check / look back** → the eye stays in front of every mirror glass (no `applyMirrorCamera` RangeError) and clear of geometry. Test in Task 2 and Task 8.
5. **Mouse moving during a held glance, then release** → returns to the pre-glance pose, not pose + accumulated mouse. Test in Task 3.

---

### Task 1: Head pose

**Files:**
- Create: `src/views/head-pose.ts`
- Test: `src/views/head-pose.test.ts`

**Interfaces:**
- Produces:
  - `interface SeatOffset { readonly foreAftM: number; readonly heightM: number }`, `const ZERO_SEAT: SeatOffset`
  - `interface HeadClearance { readonly minM: Vec3Data; readonly maxM: Vec3Data }` (vehicle-local)
  - `const LOOK_LEFT_LIMIT_RAD = 110°`, `LOOK_RIGHT_LIMIT_RAD = 160°` (positive magnitudes), `SHOULDER_ONSET_RAD = 60°`
  - `headOffsetLocal(yawRad: number): Vec3Data`
  - `headEyeLocal(baseEye: Vec3Data, seat: SeatOffset, yawRad: number, clearance: HeadClearance): Vec3Data`

- [ ] **Step 1: Write failing tests** in `head-pose.test.ts`:
  - `zero below onset`: `headOffsetLocal(±59.9°)` equals `[0,0,0]`.
  - `full left lean`: `headOffsetLocal(110°)` ≈ `[-0.06, 0, -0.05]` (1e-9).
  - `right 110 and 160`: `headOffsetLocal(-110°)` ≈ `[0.14,0,-0.03]`; `headOffsetLocal(-160°)` ≈ `[0.19,0.03,0.02]`.
  - `C1 at 110 right`: numeric derivative of each component at −110° ± 1e-4 rad differs by < 1e-3.
  - `monotonic`: |offset| non-decreasing over a 0.5° sweep on both sides.
  - `seat adds rigidly`: `headEyeLocal(eye, {foreAftM:0.1,heightM:0.05}, 0, wideBox)` = eye + `[0,0.05,0.1]`.
  - `clamped into box`: a box tighter than the offset returns a point with every component within `[minM,maxM]`.
  - `deterministic and finite`: non-finite yaw throws `RangeError`.
- [ ] **Step 2: Run** `npx vitest run src/views/head-pose.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.** `s(a,b,x)` = smoothstep. Left (yaw > 0): `L·s(60,110,|yaw|)`. Right (yaw < 0): `A·s(60,110,|yaw|) + (B−A)·s(110,160,|yaw|)` with A = right@110, B = right@160. Yaw is clamped to the limits before evaluation. `headEyeLocal` = clamp(baseEye + [0, heightM, foreAftM] + offset).
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `feat(views): yaw-coupled head pose (#23)`.

### Task 2: Contract seat range and head clearance

**Files:**
- Modify: `src/vehicle/asset-contract.ts` (`VehicleViewProfile`, `deriveVehicleAssetContract`)
- Test: `src/vehicle/asset-contract.test.ts`

**Interfaces:**
- Consumes: `SeatOffset`, `HeadClearance`, `headEyeLocal` (Task 1).
- Produces: `deriveVehicleAssetContract(profile)` returns additionally
  `seatRangeM: { foreAft: readonly [number, number]; height: readonly [number, number] }` and `headClearance: HeadClearance`. `VehicleViewProfile` gains `seatRangeM` and `headClearanceM` (per vehicle; split `cabinView` into sedan/CUV objects if values differ).

- [ ] **Step 1: Write failing tests:**
  - `seat range matches spec` for both vehicles: `foreAft [-0.1, 0.1]`, `height [-0.03, 0.05]` (unless narrowed per Task 8's evidence, recorded in a comment).
  - `eye stays in front of every mirror glass`: for seat corners × yaw sweep −160°…+110° step 2°, `(eye − glass.positionM)·normal > 0.05` for rear/left/right.
  - `clearance box contains default eye with full offsets` at every seat corner (i.e. clamping is a guard, not the mechanism): unclamped eye lies inside the box.
- [ ] **Step 2: Run** `npx vitest run src/vehicle/asset-contract.test.ts` → FAIL.
- [ ] **Step 3: Implement** the fields. Box starting values (vehicle-local, relative to `driverEyeLocalM`): min `[-0.20, -0.06, -0.20]`, max `[+0.30, +0.08, +0.16]`; final values are tuned so Task 8's ≥ 0.12 m geometry test passes. Validate both are finite and min < max, else `RangeError`.
- [ ] **Step 4: Run** → PASS; also `npx vitest run src/views` stays green.
- [ ] **Step 5: Commit** `feat(vehicle): seat range and head clearance contract (#23)`.

### Task 3: Look controller (fixed step)

**Files:**
- Create: `src/views/look.ts`
- Test: `src/views/look.test.ts`

**Interfaces:**
- Consumes: limits from Task 1.
- Produces:
  - `type Glance = 'left' | 'right' | 'back'`
  - `interface LookPose { readonly yawRad: number; readonly pitchRad: number }`
  - `interface LookStepInput { readonly mouseDx: number; readonly mouseDy: number; readonly stickX: number; readonly stickY: number; readonly glance: Glance | null; readonly recenter: boolean }`
  - `createLookController(): { step(input: LookStepInput, dtS: number): void; pose(): LookPose; reset(): void }`
  - Glance targets: left `{yaw:+110°,pitch:0}`, right `{−110°,0}`, back `{−160°,−5°}`.

- [ ] **Step 1: Write failing tests:**
  - `mouse applies directly`: dx = 100 px → yaw −0.2 rad after one step (sensitivity 0.002 rad/px, sign as today); clamps at +110° / −160° and pitch limits.
  - `stick deadzone and rate`: stickX 0.1 → no change; stickX 1 for 1 s (120 steps) → yaw −180°… clamped to −160°; stickY 1 for 0.5 s → pitch changes 60°.
  - `glance eases without snap`: per-step yaw change < 8° throughout (no snap); within 1° of target by 0.4 s; never overshoots by > 0.5°.
  - `release returns to pre-glance pose` and `mouse ignored during glance` (Review Focus 5): free pose 20°, hold left with mouse dx 500 px during it, release → settles at 20°.
  - `recenter eases to 0/0`.
  - `reset()` zeroes pose and spring velocity instantly (used on vehicle/session reset).
- [ ] **Step 2: Run** `npx vitest run src/views/look.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Free pose is updated by mouse/stick only when no glance is held and no recenter ease is active (new mouse input cancels a recenter ease). Displayed pose follows its target (glance target, or the free pose while easing back) with a critically damped spring, ω = 16 rad/s (≈0.25 s settle); once within 0.05° and slow, it snaps to the free pose and tracks it directly.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(views): fixed-step look controller with glances (#23)`.

### Task 4: Seat positions in settings

**Files:**
- Create: `src/views/seat-position.ts`
- Modify: `src/runtime-types.ts` (`SettingsSaveV1`), `src/storage/persistence.ts` (parse)
- Test: `src/views/seat-position.test.ts`, `src/storage/persistence.test.ts`

**Interfaces:**
- Consumes: `SeatOffset` (Task 1), contract `seatRangeM` (Task 2).
- Produces:
  - `type SavedSeatPosition = { readonly foreAftCm: number; readonly heightCm: number }`
  - `SettingsSaveV1.seatPositions?: Readonly<Partial<Record<VehicleId, SavedSeatPosition>>>`
  - `seatFromSaved(saved: SavedSeatPosition | undefined, range): SeatOffset`, `savedFromSeat(seat: SeatOffset): SavedSeatPosition` (rounds to integer cm), `parseSavedSeatPositions(value: unknown, vehicleIds): ... | undefined` (lenient like `parseSavedMirrorAdjustments`).

- [ ] **Step 1: Write failing tests:** round-trip; missing field → defaults; `{foreAftCm:'x', heightCm:NaN}` → 0/0; `{foreAftCm:99, heightCm:-99}` → 10/−3; unknown vehicle dropped; non-object → `undefined`; persistence load of a save with malformed `seatPositions` still returns the rest of the settings (Review Focus 3).
- [ ] **Step 2: Run** `npx vitest run src/views/seat-position.test.ts src/storage/persistence.test.ts` → FAIL.
- [ ] **Step 3: Implement**; wire `parseSavedSeatPositions` next to `parseSavedMirrorAdjustments` in `persistence.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(storage): per-vehicle seat positions (#23)`.

### Task 5: Calibration v2

**Files:**
- Modify: `src/contracts.ts` (`ControllerCalibration`), `src/input/calibration.ts` (`validateCalibration`), `src/input/profiles.ts`, `src/storage/persistence.ts` (`copyCalibration`, save record)
- Test: `src/input/input.test.ts`, `src/storage/persistence.test.ts`

**Interfaces:**
- Produces: `ControllerCalibration` with `version: 2` plus optional `lookLeftButton?`, `lookRightButton?`, `lookBackButton?`, `recenterButton?: number` and `lookStick?: { readonly xAxis: number; readonly yAxis: number }`. Storage key/record name unchanged.

- [ ] **Step 1: Write failing tests:**
  - `v1 upgrades`: a stored v1 entry validates to v2 with no look fields (Review Focus 2).
  - `look button conflicts rejected`: a look button equal to 0, reverse, drive or another look button → that look field dropped (calibration kept).
  - `stick conflicts dropped`: `lookStick` sharing an axis with steering or an axis-kind pedal → `lookStick` dropped; xAxis === yAxis → dropped.
  - `profiles`: gamepad-kind profiles produce `lookStick {2,3}`; wheel profiles have none; no profile presets look buttons.
  - `persistence round-trip` keeps look fields.
- [ ] **Step 2: Run** `npx vitest run src/input src/storage` → FAIL.
- [ ] **Step 3: Implement**; accept `version` 1 or 2 on parse, always emit 2.
- [ ] **Step 4: Run** → PASS; `npm run typecheck` clean (update fixtures typed `version: 1`).
- [ ] **Step 5: Commit** `feat(input): calibration v2 with look buttons and stick (#23)`.

### Task 6: Input controller look input

**Files:**
- Modify: `src/input/controller.ts`
- Test: `src/input/input.test.ts`

**Interfaces:**
- Consumes: calibration v2 (Task 5), `Glance` (Task 3).
- Produces: `InputController.lookInput(): { readonly glance: Glance | null; readonly recenter: boolean; readonly stickX: number; readonly stickY: number }`. `recenter` is true once per press (edge). Values are read during `poll()`; keyboard source returns `{null,false,0,0}`.

- [ ] **Step 1: Write failing tests:** held look-left → `glance 'left'`; holding left then pressing back → `'back'`; releasing back while left still held → `'left'`; recenter edge true once; stick raw axes passed through (deadzone is Task 3's); `clear()` and a poll issue (disconnect) → `glance null` (Review Focus 1); calibration without look fields → all neutral.
- [ ] **Step 2: Run** `npx vitest run src/input/input.test.ts` → FAIL.
- [ ] **Step 3: Implement** inside `readGamepad`/`poll`, tracking press order for "latest pressed wins".
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(input): controller glance, recenter and stick look (#23)`.

### Task 7: Views use head pose and look pose

**Files:**
- Modify: `src/views/cameras.ts`
- Test: `src/views/views.test.ts`

**Interfaces:**
- Consumes: `headEyeLocal`, `SeatOffset` (Task 1), `LookPose` (Task 3), contract `headClearance` (Task 2; add `headClearance` to `VehicleAnchors` in `src/runtime-types.ts` and fill it in `src/render/prototype.ts` and `src/world/assets.ts`).
- Produces: `ViewSystem` replaces `look()`/`recenter()` with `setLookPose(pose: LookPose): void`, and adds `setSeatOffset(seat: SeatOffset): void`. `driverEyeLocal(): Vec3Data` (for #24 and tests).

- [ ] **Step 1: Update/write tests:**
  - Port `bounds driver FOV and mouse look` and chase-orbit tests to `setLookPose`; chase yaw follows the pose.
  - `eye follows seat`: `setSeatOffset({foreAftM:0.1,heightM:0.05})` moves `driver-camera` world position by that vector (vehicle at identity).
  - `shoulder check translates eye`: `setLookPose({yawRad:110°})` moves the camera ≈ (−0.06,0,−0.05).
  - `mirror parallax`: mirror-left camera position differs between yaw 0 and yaw 110° by > 0.05 m; still exactly 3 mirror passes per 15 FPS tick.
  - Rerun the existing frustum rule at both seat extremes (centres: rear/left at neutral, right after 30° look).
- [ ] **Step 2: Run** `npx vitest run src/views/views.test.ts` → FAIL.
- [ ] **Step 3: Implement**: `updateDriverCamera` uses `headEyeLocal(anchors.driverEyeLocalM, seat, yaw, anchors.headClearance)`; the same `driverEye` already feeds `updateMirrorCameras`.
- [ ] **Step 4: Run** `npx vitest run src/views` → PASS.
- [ ] **Step 5: Commit** `feat(views): head translation, seat offset and mirror parallax (#23)`.

### Task 8: `DriverSeat` node (opt-in authoring) and runtime

**Files:**
- Modify: `tools/asset-designs/vehicles.mjs` (`authorCabin`), `tools/generate-assets.mjs` (option `driverSeat`, `DRIVER_SEAT_DEFAULT = false`, CLI `--driver-seat`), `tools/asset-workflow.mjs` (pass option through for candidates), `src/render/asset-scene.ts` (`cockpitControls`), `src/render/prototype.ts`, `src/world/assets.ts` (optional node, no failure if absent)
- Test: `src/world/generate-assets.test.mjs`, `src/render/asset-scene.test.ts`, `src/render/prototype.test.ts`, new `src/world/head-clearance.test.ts`

**Interfaces:**
- Consumes: contract `seatRangeM`, `headClearance` (Task 2), `headEyeLocal` (Task 1).
- Produces: optional node `DriverSeat` (child of `Cockpit`, origin at the authored seat position) containing the driver-side (`x = -0.31`) pedestal, cushion, bolsters, backrest, headrest post and headrest. `AssetScene.setSeatOffset(seat: SeatOffset): void` sets `DriverSeat.position = authored + [0, heightM, foreAftM]`.

- [ ] **Step 1: Write failing tests:**
  - Generator: `buildGlb('sedan', { driverSeat: true })` has a `DriverSeat` node; default `buildGlb('sedan')` is byte-identical to the public GLB (existing sync test stays green); triangles with the option equal those without ± 12 and ≤ 10,000.
  - `head-clearance.test.ts`: for both vehicles, parse `buildGlb(id, { driverSeat: true })` with three's `GLTFLoader.parse`; for seat corners × yaw −160°…+110° step 5°, translate `DriverSeat` by the seat offset and assert every vehicle triangle is ≥ 0.12 m from `headEyeLocal(...)` (Review Focus 4). If a vehicle fails only at a seat extreme, narrow that vehicle's `seatRangeM` (Task 2) and note why.
  - `asset-scene`: `setSeatOffset` moves `DriverSeat`; absent node → no throw.
  - `prototype`: has a `DriverSeat` box group that moves the same way.
- [ ] **Step 2: Run** `npx vitest run src/world src/render` → FAIL.
- [ ] **Step 3: Implement**: split the driver seat parts out of `cabin` into their own merged mesh under `DriverSeat` only when `driverSeat` is on; otherwise authoring is unchanged.
- [ ] **Step 4: Run** → PASS; `npm run assets:check` green (public GLBs unchanged).
- [ ] **Step 5: Commit** `feat(assets): opt-in DriverSeat node and runtime seat offset (#23)`.

### Task 9: Preview wiring

**Files:**
- Modify: `src/render/preview.ts`
- Test: `src/render/preview.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 6, 7, 8.
- Produces: `Preview` replaces `recenterView()` semantics (now eases via look controller) and adds `setSeatOffset(seat: SeatOffset): void`, `seatAdjustAllowed(): boolean`. `PreviewEvents.onSeatAdjustAllowed?(allowed: boolean)` fires on change.

- [ ] **Step 1: Write failing tests:**
  - Mouse deltas are accumulated and consumed inside the `clock.advance` step: two frames at 30 Hz and at 120 Hz with the same total movement give the same yaw at the same simulation time.
  - A held gamepad glance moves `driver-camera`; pausing (Escape/focus/controller issue) clears it and the look controller is reset to free pose easing on resume (Review Focus 1).
  - `setSeatOffset` moves the camera and `DriverSeat`; `seatAdjustAllowed()` true only when held.
- [ ] **Step 2: Run** `npx vitest run src/render/preview.test.ts` → FAIL.
- [ ] **Step 3: Implement**: create the look controller per session; `onMouseMove` adds to an accumulator; in each fixed step call `look.step({...accumulated, ...input.lookInput()}, 1/120)` (zero the accumulator after the first step of the frame); before `views.render` call `views.setLookPose(look.pose())`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(render): fixed-step look and seat wiring (#23)`.

### Task 10: UI, app persistence and copy

**Files:**
- Modify: `src/ui/calibration.ts` (four optional look-button steps + optional stick step on manual path; four look-button steps on profile path; each with "skip"), `src/ui/view-settings.ts` (sliders `seat-fore-aft` −10…10 and `seat-height` −3…5 cm, `reset-seat` button, disabled with notice when not allowed), `src/ui/screens.ts`, `src/app.ts` (save `seatPositions[vehicleId]` on slider change commit and reset, apply on session open like `mirrorAdjustments`), `src/messages.ts`
- Test: `src/ui/ui.test.ts`, `src/app.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 9.
- Produces: view-settings actions `{ type: 'set-seat'; seat: SavedSeatPosition }` and `{ type: 'reset-seat' }`.

- [ ] **Step 1: Write failing tests:** calibration flow captures look-left/right/back/recenter and skip; a button already used (0/reverse/drive/other look) shows a rejection message and does not advance; manual stick step captures axes or skips. View settings: sliders emit `set-seat`, disabled when `seatAdjustable` false; reset emits `reset-seat`. App: seat saved per vehicle and reapplied on next session; v1-calibrated device shows the "set up look buttons" notice.
- [ ] **Step 2: Run** `npx vitest run src/ui src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement**; Vietnamese strings for every new label, step, rejection and notice.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(ui): look-button setup and seat controls (#23)`.

### Task 11: Browser coverage

**Files:**
- Modify: `tests/browser/driving.spec.ts`

- [ ] **Step 1: Write tests:** in P, moving the seat-height slider changes the cockpit capture; in D while rolling the sliders are disabled; a pointer-locked mouse shoulder check (yaw ≥ 100°) changes the left-mirror pixels versus neutral (parallax).
- [ ] **Step 2: Run** `npx playwright test tests/browser/driving.spec.ts --trace off` → PASS.
- [ ] **Step 3: Commit** `test(browser): seat and shoulder-check parallax (#23)`.

### Task 12: Candidate GLBs and review — STOP for approval

- [ ] **Step 1:** Capture a baseline review per `docs/asset-pipeline.md` (empty dir under the session workspace).
- [ ] **Step 2:** `npm run assets:generate -- --vehicle sedan --driver-seat --out <ws>/candidate-sedan` (and CUV); `npm run assets:check -- --vehicle <id> --candidate <dir>`; `npm run assets:review -- --vehicle <id> --candidate <dir> --out <ws>/review-<id>`. Extend the review spec (`tests/browser/asset-review.spec.ts`) with captures at default and both seat extremes: neutral, left 110°, right 110°, back 160°, all mirrors at neutral and full lean, look-down at the seat. Record draw calls and triangles.
- [ ] **Step 3:** Present reference/before/after captures, hashes, budgets and inferred choices to the developer. **Do not continue until the developer approves the candidate hashes and appearance.**

### Task 13: Promotion (after approval only)

- [ ] **Step 1:** Set `DRIVER_SEAT_DEFAULT = true` (keep `{ driverSeat: false }` as programmatic opt-out, retire the CLI flag as with `--lamps`), `node tools/generate-assets.mjs`, confirm the public GLBs match the approved hashes.
- [ ] **Step 2:** Update `docs/asset-pipeline.md` (promoted hashes, `DriverSeat` in the cockpit-controls paragraph), `docs/phase-8-asset-catalog.md` evidence, and the #9 spec note that parallax is now in scope.
- [ ] **Step 3:** Run `npm run assets:check`, `npm run typecheck`, `npm test`, `npm run test:browser -- --trace off` → all green.
- [ ] **Step 4:** Commit `feat(assets): promote approved DriverSeat GLBs (#23)` and push.
