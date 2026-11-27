# Head movement, shoulder checks and driver seat position (issue #23)

## Intent

Part of #5. Learners must be able to physically perform the observation a real driver
does (lean, look over the shoulder, see past the pillars) so that the mirror and
blind-spot checks of #24 become a habit rather than a camera spin. #24 will measure where
the learner looked from the cockpit view, and in Stage 3+ a missed check before reversing
fails the attempt, so the head pose must be deterministic and reproducible on the
fixed-step clock.

## Current state

- `src/views/cameras.ts`: the driver camera sits at `assets.anchors.driverEyeLocalM`
  (fixed per profile in `src/vehicle/profiles.ts`); mouse-look changes yaw (±110°) and
  pitch (−45°/+35°) only. Mirror cameras are rebuilt every pass from that fixed eye by
  `applyMirrorCamera` (`src/views/mirror-optics.ts`).
- The #9 spec made head movement/parallax a non-goal; this issue reverses it.
- Front seats are authored inside the merged `SeatsAndInterior` mesh in
  `tools/asset-designs/vehicles.mjs` (`authorCabin`), positioned from the default eye.
  There is no driver body mesh.
- Default mirror glass aim (`deriveVehicleAssetContract`) is computed from the default eye.
- Controller calibration (`ControllerCalibration` v1, `src/contracts.ts`) has steering,
  pedals, reverse/drive buttons; button 0 is the parking brake. No look bindings.
  Mirror adjustment is keyboard only.

## Goals

1. Head translation coupled to look yaw so shoulder checks see past B/C-pillars; smooth,
   bounded, never clipping.
2. Mirror reflections follow the moved eye (parallax) inside the existing mirror budgets.
3. Adjustable driver seat (height, fore/aft) that moves a real `DriverSeat` part and the
   eye with it, persisted per vehicle.
4. Controller/wheel look bindings (hold-to-glance left/right/back, recenter) chosen during
   controller setup, plus gamepad right-stick free look.

## Non-goals

- Head-tracking hardware, webcam tracking, VR.
- Retuning handling, lessons, colliders or the parking footprint.
- The observation-check evaluation itself (#24); this issue only provides a head pose it
  can consume.
- Manual lean keys independent of yaw; mirrors re-aiming themselves when the seat moves.

## Anti-goals

- Camera clipping through cabin, pillars, headliner, the driver seat/headrest or the wheel.
- Discomfort: snaps, bob, translation that depends on anything except yaw and seat.
- Extra render passes, higher mirror frame rate, changed main-pass draw-call or triangle
  gates, or anything that threatens the 1440p/60 Hz target.
- Bypassing the asset workflow's candidate review for the GLB change.

## Approaches considered

1. **Pure head-pose module (chosen by the developer).** A pure function computes the
   vehicle-local eye from seat offset, yaw and a per-vehicle head-clearance box from the
   asset contract; a small look controller eases yaw/pitch for mouse, stick and held
   glances. `cameras.ts` feeds the eye to the driver camera and the mirror passes;
   `asset-scene.ts` moves `DriverSeat` by the seat offset. Deterministic, unit-testable,
   negligible per-frame cost, reusable by #24.
2. **Raycast clipping against the cockpit mesh.** Most exact, but per-frame CPU cost,
   couples the camera to mesh details that change with every regeneration, and makes #24
   evaluation depend on mesh data. Rejected.
3. **Scene-graph rig (seat → torso → head nodes).** Natural parenting, but spreads view
   state through the scene graph, needs a full scene for unit tests and still needs a
   clearance guard. Rejected.

## Design

### Seat (developer decided: real `DriverSeat` part)

- `authorCabin` emits the driver's cushion, backrest, bolsters and headrest as a separate
  mesh under a new node `DriverSeat` (child of `Cockpit`), whose origin is the default
  eye's projection on the seat so translation is a plain offset. The passenger seat, rear
  bench, steering wheel and pedals remain where they are. The merged interior mesh loses
  only the driver-seat parts; total triangle count stays the same within a few triangles,
  and the vehicle stays ≤10,000 triangles. The extra mesh costs at most one main-pass draw
  call; the sandbox ≤100 / lesson ≤140 gates must still pass (measured, not assumed).
- `DriverSeat` is optional at load like `SteeringWheelPivot`; the prototype box scene
  (`src/render/prototype.ts`) gets an equivalent node so the fallback behaves the same.
- Seat offset (my proposal, accepted in conversation): fore/aft ±10 cm (+Z = rearward),
  height −3 cm to +5 cm, 1 cm steps. The eye moves rigidly with the seat.
- The asset contract validates both seat extremes for each vehicle: the eye (including
  the maximum head offset) stays inside the head-clearance box and at least a minimum
  distance from the steering-wheel rim. The existing `views.test.ts` visibility rule is
  rerun at the seat extremes, unchanged in criterion (my call, after the builder check):
  glass **centres** in the driver frustum at the default 60° FOV and the test's aspect,
  rear-view and driver mirror at neutral look, passenger mirror after the existing 30°
  glance (it sits ~59° right of the eye even at the default seat). If an extreme fails for
  a vehicle, that vehicle's seat range is narrowed in the contract; cabin geometry is not
  changed for it.
- Adjusted in the view settings panel with two sliders and a "reset seat" button, only
  while the car is held (gear P or parking brake on), the same gate as mirror adjustment.
  Otherwise the sliders are disabled with the existing blocked-notice style.
- Persisted per vehicle as optional `seatPositions: Record<VehicleId, { foreAftCm,
  heightCm }>` in `SettingsSaveV1`, parsed leniently like `mirrorAdjustments` (missing or
  invalid → default 0/0, values clamped and rounded to integer cm, no version bump).
- Mirrors do not re-aim when the seat moves: default aim stays computed from the profile
  (default-seat) eye, and the learner re-adjusts mirrors as in a real car. "Reset mirrors"
  still returns to that default aim.

### Head pose (`src/views/head-pose.ts`, new, pure)

`headEyeLocal(baseEye, seatOffset, yawRad, clearance) → Vec3` in vehicle-local metres.
Yaw sign follows `cameras.ts`: positive yaw turns left (towards the driver's window in
these left-hand-drive vehicles).

- `t = smoothstep(60°, limit, |yaw|)` where `limit` is the yaw limit on that side
  (110° left, 160° right). Below 60° the offset is exactly zero.
- Target offsets at full `t` (my proposal, accepted in conversation; tunable ±30 % in
  review):
  - Left (driver window): lean out and slightly forward, about 8 cm total:
    x −0.06, y 0, z −0.05.
  - Right up to 110°: torso turn towards the centre, about 15 cm: x +0.14, y 0, z −0.03.
  - Right 110° to 160° (look back through the rear window): continues to about 20 cm
    towards the centre with a slight rise: x +0.19, y +0.03, z +0.02.
  The right-side curve is a single continuous piecewise-smooth function of yaw (C1 at
  110°), so there is no kink when the view passes 110°.
- Result = baseEye + seatOffset + offset, then clamped component-wise into the vehicle's
  head-clearance box. Pitch never translates the head. No time dependence, so no bob.
- Head-clearance box comes from `deriveVehicleAssetContract` per vehicle (vehicle-local
  axis-aligned box): inside the door trim minus margin (trim at x = ±0.775 in cockpit
  space), below the headliner minus margin, behind the windshield/steering wheel, ahead
  of the rear bench headrests, and in front of the driver headrest at every seat position.
  Margins ≥ the driver camera near plane (0.1 m) plus 2 cm so the near plane never cuts
  geometry. Pillars are guarded because the box is inside the door trim/glass plane; the
  review captures at full lean confirm no pillar geometry is within the near plane.

### Look controller (`src/views/look.ts`, new, pure)

Time base (my call, after the builder check, following #24's "reproducible on the
fixed-step clock" anti-goal): look state advances **inside the fixed 1/120 s simulation
step** in `preview.ts`'s `clock.advance` callback, like the rig. Mouse deltas are
accumulated between steps and consumed by the next step; stick and glance buttons are read
from the step's input poll. The spring integrates at 1/120 s. Rendering reads the latest
stepped yaw/pitch (optionally interpolated with the clock's `alpha`); #24 will sample the
stepped value. While paused nothing advances.

Holds `{ yaw, pitch }` and a "free" pose. Inputs per simulation step:

- Mouse deltas (unchanged sensitivity 0.002 rad/px) and gamepad right-stick rate
  (deadzone 0.15, max 180°/s yaw, 120°/s pitch) update the free pose, clamped to
  yaw [−160°, +110°] in `cameras.ts` convention (positive = left: +110° left limit,
  −160° right limit) and pitch −45°/+35°.
- Held glance (`left` | `right` | `back`) overrides the free pose: target
  left = yaw full-left 110°, pitch 0; right = right 110°, pitch 0;
  back = right 160°, pitch −5°. Mouse/stick input is ignored while a glance is held.
- On release the view returns to the free pose it held before the glance. Recenter sets
  the free pose to 0/0.
- Transitions (glance in/out, recenter) use a critically damped spring with ~0.25 s
  settle time integrated per fixed step; free mouse/stick input applies directly (as
  today), so nothing snaps.
- Exposes the current yaw/pitch so `cameras.ts` drives both driver and chase cameras as
  today, and `headEyeLocal` uses the eased yaw so head translation is equally smooth.
- Keyboard: no new keys in this issue (mouse-look remains the keyboard user's look). Chase
  camera behaviour is unchanged apart from the wider right yaw range.

### Views (`src/views/cameras.ts`)

- `updateDriverCamera` uses `headEyeLocal(...)` instead of the fixed anchor; the same
  world eye goes to `applyMirrorCamera` for all three mirrors (parallax). No new passes;
  mirrors stay at 15 FPS, so the glass can lag a fast lean by up to ~66 ms (accepted).
- `ViewSystem` gains `setSeatOffset(offset)` and `setGlance(glance | null)` and a stick
  look input; `look`/`recenter` delegate to the look controller.
- `applyMirrorCamera` throws if the eye is behind the glass; the clearance box keeps the
  eye in front of every glass at all poses, asserted by a contract test over a yaw sweep
  at both seat extremes.

### Asset scene (`src/render/asset-scene.ts`)

`cockpitControls` finds optional `DriverSeat`; when the seat offset changes its position
is set to its authored position + offset. Static otherwise (no per-frame cost beyond a
vector copy).

### Controller bindings

- `ControllerCalibration` gains optional `lookLeftButton`, `lookRightButton`,
  `lookBackButton`, `recenterButton` (each a button index or absent) and becomes
  `version: 2`. v1 saves still parse (as v2 with no look buttons); the calibration key and
  storage record are unchanged. The controller screen shows a short notice offering setup
  when a calibrated device has no look buttons.
- Setup flow (`src/ui/calibration.ts`, both manual and profile paths) adds four optional
  steps after drive: "press the button for look left/right/back/recenter, or skip".
  A button already bound to parking brake (0), reverse or drive, or to another look
  action, is rejected with a message. Profiles do not preset look buttons.
- `src/input/controller.ts`: in `readGamepad`/`poll`, held look buttons produce the
  current glance (if several are held, the latest pressed wins); recenter is an edge
  action.
- Stick look is stored explicitly (my call, after the builder check), not inferred from
  device kind: v2 gains optional `lookStick: { xAxis, yAxis }`. Gamepad-kind profiles
  preset axes 2/3; wheel profiles leave it absent. Manual setup adds an optional "move the
  right stick, or skip" step. An axis already bound to steering or a pedal is rejected
  for stick look (at setup, and at parse time a conflicting `lookStick` is dropped), so
  driving input can never move the camera. Look input is exposed alongside `mirrorInput()`
  (e.g. `lookInput()`), not as driving actions.
- All new UI strings are Vietnamese in `src/messages.ts`.

### Asset workflow

Follow `docs/asset-pipeline.md`: baseline review first; `DriverSeat` authoring behind an
opt-in generator option (off by default) until approved; generate candidates outside
`public`; `assets:check` and `assets:review`. Review captures per vehicle at default and
both seat extremes: neutral cockpit, full left shoulder check, full right (110°), look
back (160°), all three mirrors at neutral and at full lean, and a look-down at the seat.
Stop for developer approval of hashes and appearance; then promote (option on by default,
regenerate, update provenance/catalog and promoted hashes).

## Delivery order (builder's call within this outline)

1. Pure modules and tests: head pose, look controller, contract clearance box and seat
   extremes, persistence, calibration v2 parsing.
2. Wiring: views, asset scene, prototype scene, input controller, calibration UI, view
   settings, messages.
3. Candidate GLBs and review captures; stop for approval.
4. Promotion and full suites.

## Testing

- `head-pose`: zero offset below 60°; monotonic and smooth (C1) in |yaw| including at
  110° on the right; clamped into the box; seat offset adds rigidly; deterministic.
- `look`: glance hold/ease/return to prior free pose, recenter, mouse ignored during
  glance, stick deadzone and rate, limits left 110° / right 160°, frame-time clamping.
- Contract: clearance box inside the cabin for both vehicles; eye in front of all mirror
  glasses over a yaw sweep at both seat extremes; neutral frustum contains windshield and
  mirrors at seat extremes.
- Views: mirror cameras move when the eye moves (parallax); still 3 passes per 15 FPS
  tick; `DriverSeat` follows seat offset.
- Input/calibration: v1 → v2 parse, look button capture/skip/conflict rejection, held
  glance priority, recenter edge.
- Persistence: seat round-trip, missing/malformed/clamped values.
- Browser (`driving.spec.ts` or a new spec): seat slider moves the view when held in P,
  disabled otherwise; mouse shoulder check changes mirror pixels (parallax).
- Asset workflow: generator/loader/view tests, `assets:check`, `assets:review`, draw-call
  and triangle gates.

## Left to the builder

- Exact smoothstep/spring constants within the stated feel, and ±30 % offset tuning found
  necessary in review captures (record in review notes).
- Exact clearance-box margins per vehicle, provided the near-plane rule holds.
- Slider placement/styling in the view settings panel.
- Whether look buttons are also offered from a dedicated "look buttons only" setup entry.

## Validation limits

CI/SwiftShader screenshots do not verify comfort, optical calibration or 1440p60
performance; head-motion feel and the absence of visible clipping remain developer visual
judgements in the review captures.
