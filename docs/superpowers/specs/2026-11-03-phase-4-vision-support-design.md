# Park-Core Phase 4: Vision & Support Systems

## Intent

Implement the complete vision and support slice for the current Park-Core
prototype: useful driver/chase views and parking aids, plus honest proximity
warnings and audio. This is for learners exploring vehicle position and
clearance. It is not a training-ready simulator until the Phase 5 vehicle and
environment assets, and the remaining release validation, exist.

The Phase 3 code has one external follow camera and one preview render loop.
The HUD already reserves hidden view and sensor elements; contracts already
include camera actions, sensor readings, view settings and vehicle anchors.
Extend that foundation rather than creating a second renderer or runtime.

## Goals

- Add driver and chase views, bounded mouse-look with pointer lock, FOV control,
  recentering, and required-lock-loss pause behavior.
- Add rear and side mirrors, a simulated top-down 360 inset, and an estimated
  low-speed trajectory aid.
- Add front/rear physics-world bumper ray sensors, visible labeled warnings,
  distance hysteresis, and accessible optional audio warnings.
- Integrate view and sensor controls into the existing Vietnamese HUD and
  preview lifecycle. Keep warnings informative when muted or audio is
  unavailable.
- Use explicit driver/mirror anchors and simple placeholder cabin/mirror
  surfaces in the current prototype. Keep their boundary compatible with the
  Phase 5 asset pipeline; do not present them as final vehicle artwork.

## Non-goals and anti-goals

- No Phase 5 GLB vehicle/cockpit or environment asset delivery, lesson system,
  parking evaluation, persistence expansion, or change to vehicle physics.
- No claim that placeholder views, sensor coverage, generic vehicle profiles,
  hardware compatibility, or simulator performance are training-validated.
- A trajectory is not a clearance guarantee or auto-steering. Sensors do not
  authorize a maneuver and cannot guarantee detection of low or side obstacles.
- No extra renderer, continuous GPU readback, custom shaders, separate
  render/audio polling loops, speech, or sound-asset pipeline.

## Constraints and acceptance

- Continue using strict TypeScript, Three.js, Cannon-es, and vanilla DOM/CSS.
  Keep the fixed-step simulation and its single RAF owner in `render/preview.ts`.
- Preserve one WebGL renderer. An auxiliary pass must restore render target,
  viewport, scissor, clear state, and camera/layer state even when rendering
  throws. No GPU readback.
- Driver view uses the profile eye anchor, 60-degree default vertical FOV
  adjustable from 50 to 80 degrees, yaw limits +/-110 degrees, and pitch
  limits -45 to +35 degrees. No head bob, shake, or dynamic FOV.
- Chase view starts 5 m behind and 2.5 m above the vehicle. Use a center ray
  and four offset obstruction rays; retract immediately to the closest hit
  minus 0.2 m and restore smoothly when clear.
- Mirrors use one rear and two side cameras/targets, initially 512x128 and
  256x256, respectively, and refresh no faster than 15 Hz without catch-up.
  Use initial vertical FOVs of 50 degrees rear and 75 degrees side. Exclude
  mirror surfaces/driver head from mirror passes and verify left/right
  orientation with labeled landmarks.
- The overhead view uses one orthographic camera and a 10x10 m ground
  footprint in a 320x320 CSS-pixel lower-right inset, forward at the top. Update
  its target at no more than 30 Hz and composite its latest image in the same
  canvas after the main view. Exclude overhead-only roof/upper-wall visuals
  from this pass, not their colliders.
- Trajectory samples follow a bicycle model from rear-axle midpoint using
  current steering and gear, stopping at 3 m or the first predicted
  conservative body-envelope overlap. Label it an estimate.
- Sensors cast five physics rays per front/rear bumper at yaw offsets
  -60/-30/0/+30/+60 degrees, from origins across the bumper width, starting at
  the bumper surface 0.45 m above ground. Exclude the learner vehicle and
  non-solid lesson markers. Use nearest hits; no hit is `null`.
- Sensor bands: clear/no warning when no hit within 2.5 m; green above 1.2 m
  through 2.5 m; yellow above 0.6 m through 1.2 m; red above 0.3 m through
  0.6 m; red STOP at or below 0.3 m. Enter closer bands immediately and require
  0.05 m extra clearance to leave a band. Prefer the travel direction on equal
  distances. Sensor and regular DOM updates remain at or below 20 Hz.
- Unlock AudioContext only through a deliberate Start interaction. Use one
  simple oscillator stream: 1.0 s interval for green, 0.5 s yellow, 0.2 s red,
  continuous at STOP. Provide volume/mute; stop audio on pause, outcome and
  disposal. Audio failure is a nonblocking Vietnamese notice; visual warnings
  remain complete.
- Keep learner-facing text in Vietnamese, technical documents and identifiers
  in English. Warnings use labels/shapes/distance as well as color, honor
  reduced motion and keyboard operation, and fit the existing HUD layout.
- Preserve the current WebGL/error, resize, context-loss, generation-token and
  idempotent-disposal behavior. Do not claim reference-PC performance or
  unverified browser/device support.

## Approaches

1. **Sequential vertical slices (selected):** implement views and trajectory
   first, then sensors/audio, integrating both into the existing preview,
   renderer and simulation clock. This follows the existing master plan Tasks
   4-5 and exposes render-pass ownership issues before adding support audio.
2. **Support-first:** finish sensors/audio before the view system. This could
   validate proximity behavior sooner, but risks reworking the HUD when view
   controls are added.
3. **Isolated modules with late integration:** build standalone components and
   connect them at the end. This postpones the most important renderer,
   simulation-time and lifecycle interactions and is not selected.

An additional renderer or independent RAF/audio polling loop is excluded by
the accepted single-renderer and simulation-time constraints.

## Decisions and routing

- The full original product-design scope is authoritative for Phase 4:
  driver/chase and mouse-look, mirrors, overhead 360, trajectory, sensors and
  audio. The narrower Phase 4 bullet in `tech-design.md` is incomplete and must
  be reconciled.
- Use temporary prototype anchors and simple cockpit/mirror surfaces until
  Phase 5 assets replace them. They remain explicitly non-training visuals.
- Keep existing numeric behavior, safety limitations, and acceptance gates;
  this phase does not revise product thresholds or physics.
- Route camera/projection, view geometry and trajectory-envelope reasoning to
  Premium; typed app/lifecycle integration, sensor/audio behavior and tests to
  Standard; use Lightweight only for repetitive CSS/DOM scaffolding after
  interfaces and behavior are fixed.

## Documentation and builder discretion

- Add `docs/phase-4-detail-design.md` and `docs/phase-4-implementation-plan.md`
  as the phase-specific build references.
- Update `docs/tech-design.md` to describe the full Phase 4 scope and link the
  phase documents. Update `docs/detail-design.md` only for any necessary
  clarification of the explicitly provisional placeholder visuals. Update
  `docs/implementation-plan.md` with completed Task 4-5 status and verified
  evidence only after the relevant gates pass.
- The builder may choose small-file organization, test doubles for audio and
  renderer ports, simple placeholder geometry, and exact non-product visual
  styling. Do not change numeric acceptance limits, add dependencies, or make
  training-readiness claims without a separate owner decision.
- Verification must include focused unit/DOM tests, typecheck, build, and real
  Chromium/Firefox browser coverage for pointer lock, camera modes, mirrors,
  overhead compositing, resize, sensor/audio behavior and disposal. Use a
  typed renderer-port fake for state-restoration failure tests, but do not use
  fakes as a substitute for browser rendering evidence. If a browser gate
  cannot run, report it blocked rather than passed.
