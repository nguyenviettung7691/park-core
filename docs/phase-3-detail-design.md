# Park-Core: Phase 3 Detailed Design — Physics & Input Mechanics

Date: 2026-11-03

Status: Design, plan and targeted braking correction approved by the owner on 2026-11-03. Implemented software gates pass (167 unit/DOM/physics tests, typecheck/build, 12 Chromium/Firefox tests). Final branch review and its verified correction are complete. Merged into local `main` with owner approval; nothing pushed.

Sources: [technical roadmap](tech-design.md), [approved product design](detail-design.md),
[original implementation plan, Tasks 2–3](implementation-plan.md), and the
[implemented Phase 2 foundation](phase-2-detail-design.md).

## 1. Intent and scope

Turn the existing static preview into a small, genuinely drivable physics
prototype. A learner can select either vehicle, steer and maneuver slowly,
operate an automatic drivetrain, and use keyboard or explicitly calibrated
Gamepad API input. It remains development geometry, not a parking lesson,
validated driver-training product or real-wheel compatibility claim.

Deliverables, in order: this design, a Phase 3 implementation plan, then
Phase 3 implemented code. The request's last “Phase 2” is treated as a typo.
Update original documents whenever this phase changes their decisions.

The owner selected **evolving the existing preview**, not retaining a separate
static mode. Visual mockups were offered and declined; use the approved DOM
blueprint and theme.

| Approach | Benefits / tradeoffs | Decision |
|---|---|---|
| Evolve the preview into one driving prototype | Reuses renderer ownership, sizing and cleanup; replaces the non-drivable entry | Chosen by owner |
| Keep static and driving modes | Preserves an obsolete inspection mode; adds another session path and shared infrastructure | Rejected |

### Goals

- Real Cannon-es `RaycastVehicle` physics for Sedan and CUV.
- Correct COM-relative geometry, steering signs, suspension, propulsion and braking.
- Safe exclusive keyboard/controller ownership, endpoint calibration and explicit resume.
- Truthful Vietnamese telemetry, errors, controls and prototype labeling.
- Real-engine and browser evidence, not mocked claims of motion or hardware support.

### Non-goals and anti-goals

No lessons, grading, unlocks, recap, saved progress/settings/calibration, GLB
assets, driver/chase view system, mouse look, mirrors, overhead aid, sensors,
audio, trajectory, force feedback or mobile controls. Do not wire controls for
unimplemented aids. Do not set velocity or position each frame to imitate driving,
mix input sources, hide invalid samples, auto-resume, or relax failed acceptance
criteria. Test fixtures may initialize velocity to establish a braking measurement.

## 2. Existing foundation and constraints

Baseline is `0270cd7`: strict TypeScript/Vite, Three.js 0.187.0, vanilla DOM,
finite Vietnamese messages, boundary contracts, clock, capped drawing buffer,
one preview lifecycle and 46 passing unit/DOM tests. Main is clean.

Keep the existing exact-pinned packages and six scripts. Add only exact-pinned
`cannon-es` (target 0.20.0, verify the installed version). No new framework,
runner, dependency-injection layer, general screen framework or rendering stack.

Continue meters/kilograms/seconds/radians; world/vehicle Y up, X right, **-Z
forward**, positive steering left, wheel order FL/FR/RL/RR. Use `h=1/120 s`,
at most eight steps per frame, wall delta clamped to 0.1 s; never increase `h`.
Use one monotonic `now()` source on startup, frames and resume.

Keep `#9B59B6`, the existing contrast/focus tokens, 44 px controls, Vietnamese
learner copy and no blue/orange/green main-UI accents. Static basic materials,
no dynamic shadows. Keep the 2560×1440 aspect-preserving drawing-buffer cap.
Regular telemetry DOM updates are at most 20 Hz; notices/state changes are immediate.

## 3. Ownership and phase boundaries

- `app.ts` remains lifecycle/UI glue: selection, session-only calibration,
  opening/resetting/closing the prototype, notices and calibration screens.
- Evolve `render/preview.ts`, retaining a single RAF owner. It assembles the
  prototype's world, vehicle rig and input controller, advances them, interpolates
  poses and renders; algorithms stay in the modules below.
- `vehicle/profiles.ts`, `geometry.ts`, `steering.ts`, `rig.ts`: typed parameters,
  derived shapes/poses, Ackermann and the real-engine adapter.
- `world/colliders.ts`: world configuration and authored static prototype boxes.
- `input/calibration.ts`, `controller.ts`: normalization/validation, ownership,
  action edges, neutral checks and complete listener cleanup.
- `ui/screens.ts`, `ui/hud.ts`, `messages.ts`, `style.css`: semantic calibration,
  controls, truthful telemetry and explicit safety feedback.

Keep `AppState` as the lesson/application contract. This phase does **not** create
fake `LessonRuntime`, `playing`, `success` or `fail` values. Continue the separate
shell preview phase (`closed`, `running`, `paused`) for the prototype. Calibration
is a menu/paused subview, not another simulation or new lesson state.

Retain the existing `createPreview` dependency seam and app factory seam.
Extend them with typed prototype options and a Gamepad provider as needed;
do not expose production debug globals. The implementation plan fixes the final
signatures and dependent tests together.

## 4. Physics contract

The product design Sections 4–5 remain authoritative for **all** profile values,
world settings, force formulas and interlocks. Copy them, not example defaults.
They are tuning seeds until measured. Premium-tier source verification found
the axis/force/steering and brake-impulse assumptions consistent with Cannon-es
0.20.0; the implementation must still demonstrate them on the installed engine.

Explicitly configure right/up/forward indices 0/1/2, direction `(0,-1,0)`,
axle `(1,0,0)`, radius, rest length, maximum suspension travel, stiffness,
damping, maximum suspension force, friction slip and roll influence.
Do not use Cannon's default axes or its signed total-speed property.

### Geometry and suspension

Body size tuple is width/height/length. The physics origin is COM, not a centered
mesh. Use front axle Z `= -(1-f)L`, rear Z `= fL`, and wheel X `= +/-T/2`.
Body front/rear extents include their distinct overhangs.

| Derived seed | Sedan | CUV |
|---|---:|---:|
| Front axle Z / rear axle Z, m | -1.215 / 1.485 | -1.0962 / 1.5138 |
| Chassis box half size X/Y/Z, m | 0.90 / 0.65 / 2.30 | 0.90 / 0.72 / 2.175 |
| Chassis box center local Y/Z, m | 0.28 / 0.185 | 0.28 / 0.2288 |
| Driver eye local X/Y/Z, m | -0.36 / 0.60 / -0.965 | -0.36 / 0.68 / -0.8462 |

For each axle, derive `compression = (g * axleWeightFraction / 2) / stiffness`,
then mount Y `= tireRadius + restLength - compression - COMHeight`.
Do not round the calculation to the table's display precision.

Designer-selected mirror boxes: each extends from body half-width to mirror
half-width, hence X half-size `(mirrorWidth-bodyWidth)/4` and center magnitude
`(mirrorWidth+bodyWidth)/4`. Use Y/Z half-sizes 0.05/0.10 m; world mounting
height 0.95 m Sedan / 1.10 m CUV, Z 0.35 m behind the front axle. Derive local
Y from COM height. These are conservative prototype parts, not validated assets.
The parking footprint helper uses mirror width and full COM-relative front/rear
extents, including rotated poses.

### Drive, braking and steering

Implement the original Ackermann formula, including the zero-angle guard and
inner/outer wheel assignment. Keyboard steering ramps at 1 normalized unit/s,
recenters at 1.5 units/s, and cancels opposing keys; apply this at fixed-step
time, not by counting rendered frames. Calibrated steering maps directly.

Compute signed longitudinal speed against world-transformed local -Z; total
speed is the full velocity magnitude. Split propulsion across the front wheels.
Use original creep, force taper, resistance and brake inhibition formulas.
Resistance cannot reverse velocity in one step. No velocity governor/clamping.

Convert per-wheel force to Cannon brake impulse using `force*h`.
Designer-selected distribution of the original total holding budget:
P `mass*g/4` per wheel; parking brake `mass*g/2` per rear wheel. Take the
maximum applicable demand per wheel, not the sum. Start in P with parking brake.

Accept a gear request only with total speed **<0.1 m/s** and brake **>=0.2**;
otherwise reject immediately with a Vietnamese notice, never defer it.
Brake **>0.02** or parking brake inhibits all propulsion. Selecting R/D never
releases parking brake. Opposite-direction motion changes by physical forces,
not teleporting or overwriting velocity.

### Spawn, snapshots and faults

`settle(spawn)` uses the real world, nominal COM height and derived mounts,
bounded to 360 fixed steps. Require finite state, all wheel supports and stable
motion before enabling controls; otherwise raise a visible startup error.
Keep the actual settled vertical pose rather than reintroducing a drop by
unconditionally restoring nominal Y. Clear transient velocities/forces and
establish matching previous/current snapshots before exposing the session.

After each step, preserve contact-dependent values before refreshing wheel
transforms for rendering. In Cannon-es 0.20.0, `updateWheelTransform` calls
`updateWheelTransformWorld`, which sets `wheel.isInContact=false`; capturing
contact flags first is mandatory, not merely an optimization. Snapshots own
immutable tuple values, not mutable
Cannon/Three objects. Interpolate chassis, all wheels and camera from the same
previous/current frame. A non-finite state raises `SimulationStateError` and
stops the session as an application error, never a learner failure.

Keep `rollInfluence=1.0` and documented damping as initial seeds. Tune only
after a real failure/measurement, record changed values and rationale, and
remeasure affected gates. Do not add damping feedforward merely to eliminate
an error already inside the approved creep tolerance.

### Approved engine correction

Real measurements exposed unstable four-wheel braking in stock Cannon-es
0.20.0: P prevented settling and produced alternating low-speed motion.
The owner explicitly approved a version-specific `RaycastVehicle` subclass
that divides the zero-contact-velocity braking correction by the grounded
wheel count before limiting the impulse. All original acceptance gates,
force-to-impulse caps and profile seeds remain unchanged. The adapted method
retains the upstream MIT notice; re-audit it on any engine upgrade.
See [failed-stock and corrected-adapter measurements](phase-3-measurements.md).

## 5. Input, calibration and resume

Reuse `InputFrame`, `InputAction`, `ControllerCalibration`, `InputPoll` and
`ControlNotice`; do not duplicate or weaken their types.

Keyboard: W/Up throttle, S/Down service brake, A/D or Left/Right steering,
Digit1–4 P/R/N/D, Space parking brake, Q/E indicators, Escape pause.
Help may show the control instructions while paused; it is not lesson coaching.
Do not intercept unrelated browser shortcuts or bind C/V/F to unavailable aids.
Space and the parking-brake HUD button both **toggle** on an activation edge;
holding either never repeatedly toggles. Q/E toggle their indicator, with a
second activation turning that indicator off; selecting the other replaces it.

Movement keys only act while the focusable canvas owns keyboard input. Ignore
editable controls and modified browser/system shortcuts. Losing keyboard focus
pauses and clears held inputs and queued actions. Suppress stale/repeated held
keys across blur until release or a fresh press; no held-key replay on resume.
When the window regains focus, clear stale suppression because a keyup may
have gone to another application. This never resumes automatically or
reactivates repeat keydowns; driving still requires a fresh non-repeat press.

Poll one selected source once per running animation frame. Cache normalized
continuous input for substeps; retain discrete actions until the first subsequent
fixed step, consume them once, then use an empty action list for later substeps.
Pause/help is handled before stepping. Pause, reset, source switch and disposal
clear both the controller queue and any not-yet-consumed frame actions.

### Controller setup

Gamepad API discovery follows a deliberate user action and hardware interaction;
explain browser/device limitations. No Gamepad API means visible keyboard fallback,
not an application-wide failure. Keyboard polling need not query gamepads.

Every selected device requires explicit calibration/verification before enabling
it in this session. Standard-mapped devices may prefill axes[0], L2 buttons[6],
R2 buttons[7], reverse buttons[4], drive buttons[5]; do not silently accept an
unknown mapping. Nonstandard devices expose binding kind/index and raw values.

Capture steering left/center/right, each pedal released/pressed, and R/D buttons.
Validate finite samples, present indices, distinct pedal endpoints, center strictly
between steering endpoints and sane integer binding indices. Support inverted and
axis pedals, asymmetric steering spans, and the 0.02 normalized steering dead zone
with remainder rescaling. Normalize pedals to [0,1] and steering to [-1,1].

Calibration runs only from Menu or Paused. Its bounded raw-value RAF loop is
the only polling loop while normal driving polls are stopped. Cancel does not
resume motion. Restore focus, dispose the calibration loop/listeners, and retain
accepted calibration in app session memory only. Reconnect requires verification;
device ID/index is not a permanent physical identity.

Reverse and drive must use distinct button bindings. Do not prohibit a
legitimate shared-axis pedal layout when its separate endpoint mappings
correctly represent released and pressed states.

On disconnect, device replacement, missing controls, unavailable provider or
non-finite live samples: zero requested input/actions, pause immediately and show
the specific cause. No automatic keyboard substitution. Shoulder requests are
edge-triggered R/D, not toggles or per-substep repeats.

Keyboard is the default source. Choose source and device explicitly in Menu or
Paused, never through an automatically blended fallback. Selecting an unverified
gamepad disables starting/resuming with it and shows a setup action; the learner
may explicitly choose keyboard instead. Preserve calibration and selections
only for the current page session.

### Neutral and focus rules

Source change pauses and clears commands. Resume is explicit and requires the
selected device to be present/valid and pedals released (normalized <=0.02).
Check live raw/normalized controls, not a focus-zeroed frame. Keyboard held or
suppressed movement keys block resume until safely neutralized.

Refine `Preview.resume()` to return whether it actually resumed. The shell
switches to running only on success; hidden documents, faults and failed neutral
checks retain the paused/error UI. This closes the Phase 2 deferred resume race.

Keyboard gear/indicator/parking-brake commands use their documented canvas keys.
With gamepad selected, expose semantic HUD buttons for P/R/N/D, parking brake
and indicators; a normal HUD button may keep gamepad polling active so holding
the physical brake and requesting a gear remains possible. Editing settings,
opening calibration, source changes and modal focus pause both sources.
Keyboard motion never leaks from a DOM control.

Pause/Menu/Reset remain native keyboard-operable controls with either source.
Escape pauses when the prototype canvas or its noneditable HUD owns focus,
including when gamepad is selected. Calibration's Escape cancels the dialog
without resuming. Do not capture Escape from unrelated page/editor controls.

## 6. Prototype presentation and safety

Designer-selected test yard: flat ground and simple static box boundaries,
plus a visible 0.1 m-thick test barrier. Derive visible boxes from collider
metadata; do not infer physics from meshes. Prototype chassis, conservative
mirror boxes and four visual wheels follow the real rig.

Use the existing external perspective camera with a fixed follow offset.
It is a temporary inspection view, not the final driver/chase system. Mouse look,
pointer-lock acquisition and its required-lock-loss behavior move to Phase 4
with the camera system; ordinary canvas/DOM/window focus safety applies now.

Replace “không lái được” entry/badge copy with clear Vietnamese
“Lái thử mô hình” / “Bản thử vật lý — chưa có bài học”. Explain that generic
vehicle parameters and controller support are not validated training hardware.
No completion claim, target bay, scoring or unlock appears.

Enable only real telemetry: speed in km/h, gear, parking brake, service brake,
indicators and selected input status. Keep sensor/overhead/lesson containers
hidden and empty. Keep Reset, Pause/Resume and Menu accessible.

After an actual chassis/mirror contact with a solid box (wheel-ground ray support
excluded), stop the prototype and show a contact/reset notice. Require Reset or
Menu, not resume through the obstacle. This is a laboratory safety stop, not
`AppState.fail`, lesson evaluation or a recap. Reset rebuilds at the selected
vehicle's settled spawn without carried motion/actions. Ordinary invalid gear
requests only show feedback; they do not fail a session.

The stop includes chassis/mirror contact with the ground box and any authored
curb/obstacle/boundary box. Only normal raycast-wheel support is excluded.
Install active-session contact handling after settling, not during startup
convergence; chassis-ground contact at the end of settling is a startup error.

Preserve all existing resize, WebGL2/error, context-loss, generation-token and
idempotent disposal behavior. No physics runs behind Menu, calibration or pause.
Stopping removes RAF, input listeners, body/world callbacks, calibration polling,
observer and owned geometries/materials/context exactly once.

## 7. Verification and evidence

Tests precede implementation and must be observed failing. Keep existing clock,
sizing, WebGL failure, context-loss, focus, real-pixel and ten-cycle lifecycle
coverage, updating only intentionally changed preview copy/behavior.

Use real Cannon worlds for signs, steering, geometry, settling, front-wheel
propulsion, brake inhibition, gear interlocks, P/parking-brake holds and thin-box
contact. Validate both profiles:

- All four supports, finite state, no chassis-ground contact and no growing
  oscillation after settling within 3 s.
- D/R creep reaches +0.83/-0.56 m/s respectively, within 0.1 m/s after 6 s.
- Full braking from 5 km/h stops within 0.5 m; measure horizontal travel from
  brake application to speed below 0.05 m/s.
- P and parking brake separately hold for 60 s with <=0.02 m horizontal drift.
- At <=1 m/s, steady rear-axle-center turning radius is within 5% of the
  configured bicycle reference after the transient. Rear axle center is
  COM **minus** world-forward times `f*L`.
- Compare 30/60/144 simulated render schedules through the production clock;
  no bit-identical replay claim. Test eight-step slow frames against the
  0.1 m barrier at 15 km/h; record contact before crossing it. No CCD guarantee.

Focused input tests cover axis/button inversion, asymmetric/dead-zone steering,
invalid endpoints/indices/samples, explicit source arbitration, edge actions,
DOM focus, blur/disconnect/source switches, neutral resume and empty action
queues after reset. Calibration cancellation/invalid capture stays paused.

Chromium/Firefox integration exercises real prototype motion and telemetry,
gear/brake/parking-brake behavior, pause/resume/reset/menu, canvas versus DOM
ownership, WebGL recovery, resizing and repeated disposal. Injected Gamepad
providers exercise calibration/disconnect without production debug globals;
synthetic devices do not establish real-wheel compatibility.

Run unit/DOM/physics tests, typecheck, build, browser tests and whitespace checks.
Record actual measured physics values and package versions with the phase
deliverables. Missing real hardware, reference-PC performance, Windows evidence,
assets and instructor review remain explicit release gates, not passing tests.

Both Chromium and Firefox software gates must actually pass before claiming this
phase verified. Use the existing Playwright projects; install their browsers only
after a missing-executable failure. Real software WebGL is acceptable for
functionality, never performance evidence. If rendering remains unavailable,
record that gate blocked rather than skipped/passed.

If existing-profile/adapter tuning cannot meet a physics gate, retain the failed
measurements, stop that completion claim and escalate the specific limitation.
Do not silently relax tolerances, replace physics with scripted motion, or
introduce a new engine. The original design already permits measured parameter
tuning; a scope/architecture/acceptance change requires the owner's decision.

## 8. Required original-document updates

- Technical roadmap: Phase 3 links, prototype scope and phase-specific documents.
- Original implementation plan: Tasks 2–3 phase mapping, portable commands,
  implemented results only after verification, contract refinements, neutral
  resume and pointer-lock tests moved to Task 4 where acquisition exists.
- Product design: narrowly clarify the prototype's external camera, session-only
  calibration and non-lesson contact stop; preserve final application requirements.
- Phase 2 documents: record that Phase 3 supersedes static-preview behavior and
  resolves its deferred resume race; retain Phase 2's historical evidence.
- Repository instructions: retain the numbering distinction; no change to stack,
  physics, input safety or theme rules. Replace ambiguous shoulder “D/R toggle”
  wording with explicit button 4 requests R / button 5 requests D, consistent
  with the approved product design; update the technical overview likewise.

For Phase 3 implementation this document refines the original plan where
explicitly listed above. It does not change final first-person/mouse-look
requirements; it puts those features and their pointer-lock tests in Phase 4.

## 9. Routing, discretion and approval

Premium: physics/kinematics design verification, rig implementation and measured
tuning. Standard: typed input/calibration, lifecycle/state integration, tests and
phase documents. Lightweight: repetitive profile/DOM/CSS scaffolding after its
typed decisions are fixed. Current model examples: Opus, Sonnet and Haiku tiers;
avoid redundant whole-task agents and duplicate implementation/review passes.

Builder discretion: small-file organization, exact simple yard coordinates,
Vietnamese wording polish, bounded settling convergence thresholds, and
measurement helpers. No new framework, premature camera/aids work, changed
acceptance tolerances or claimed real-device validation without approval.

The fresh builder check, owner design/plan approval and approval of the measured
braking correction are complete. Software verification is recorded in
[the measurement report](phase-3-measurements.md); real hardware, reference-PC
performance, Windows and instructor evidence remain unestablished.

### Builder check

A fresh Standard-tier builder check on 2026-11-03 raised six questions. All were
answered by the original requirements or settled as implementation details:
unmet measurement gates escalate; chassis/ground contact is included; explicit
R/D requests supersede ambiguous toggle wording; keyboard defaults and explicit
unverified-device blocking preserve exclusive input; parking brake is an edge
toggle; both installed-browser gates require real evidence. No unanswered
product requirement was returned to the owner.

## 10. Authoritative engine references

- [RaycastVehicle 0.20.0](https://github.com/pmndrs/cannon-es/blob/v0.20.0/src/objects/RaycastVehicle.ts):
  axis configuration, `updateFriction`, `updateSuspension`, `setBrake`,
  `updateWheelTransform` and `updateWheelTransformWorld`.
- [WheelInfo 0.20.0](https://github.com/pmndrs/cannon-es/blob/v0.20.0/src/objects/WheelInfo.ts):
  wheel options and defaults that the profile must explicitly override.

The Premium-tier check confirmed the original force/brake/mount conventions.
Two corrections to its initial analysis were independently challenged and
confirmed: rear-axle reference position subtracts forward, and render-only wheel
refresh clears the contact flag. The equations and contact ordering above
include those corrections.
