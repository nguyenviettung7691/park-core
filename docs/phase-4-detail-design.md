# Phase 4 Detailed Design: Vision & Support Systems

**Status:** Implemented as a prototype slice; this is not training-ready. The
approved scope and rationale are in the
[Phase 4 design](superpowers/specs/2026-11-03-phase-4-vision-support-design.md).
Product-level requirements remain in [detail design](detail-design.md),
Sections 7, 8, 12 and 13.

## Intent and boundaries

Provide spatial guidance and honest proximity warnings on the existing
drivable prototype. Phase 4 adds useful driver/chase views, mirrors, a simulated
overhead inset, an estimated trajectory, front/rear proximity sensors and
optional audio. It does not add lessons, parking evaluation, persistence,
release assets or new vehicle physics.

The prototype cabin, eye/mirror anchors and mirror surfaces are temporary
geometry. Sensor rays and trajectory limits are aids, not clearance or safety
guarantees. Phase 5 asset work and the remaining compatibility, hardware,
fidelity and performance validation are still required before training claims.

## Architecture and interfaces

Keep the existing preview as the sole fixed-step simulation and animation-loop
owner, with one `WebGLRenderer`. `createViews` receives the renderer port, scene,
explicit `SceneAssets` anchors, vehicle profile and authoritative collider
boxes. Its `ViewSystem` exposes `render`, `look`, `setCamera`, `setOverhead`,
`setTrajectory`, `setFov`, `resize`, `recenter` and `dispose`. Auxiliary passes
restore renderer and camera/layer state, including when a render throws.

`Preview` owns view, input, audio and sensor lifecycle. Pointer-lock loss pauses
and clears driving input; resume requires an explicit lock request. Its typed
events report pause, fault, telemetry, sensor snapshots and notices. `Hud`
receives sensor snapshots through `updateSensors` and retains visible text and
distance labels independently of audio availability.

`createSensors(world, body, profile)` returns `sample(simulationTimeS)` and
`reset()`. `classifyDistance` applies immediate closer-band entry and
hysteretic exit. `createAudio(onError?)` returns an `AudioOutput` with
gesture-driven `unlock`, simulation-time `update`, volume/mute controls,
`suspend` and `dispose`. Expected audio unavailability is nonblocking; other
failures use the preview fault path.

Implementation ownership:

| Area | Implementation |
|---|---|
| Trajectory geometry | `src/views/trajectory.ts` |
| Camera, mirror and overhead passes | `src/views/cameras.ts`, `src/views/auxiliary.ts` |
| Preview lifecycle and integration | `src/render/preview.ts`, `src/app.ts` |
| Proximity and audio | `src/sensors/proximity.ts`, `src/sensors/audio.ts` |
| Vietnamese HUD and controls | `src/ui/hud.ts`, `src/ui/screens.ts`, `src/messages.ts`, `src/style.css` |
| Real-browser acceptance | `tests/browser/driving.spec.ts`, `tests/browser/shell.spec.ts` |

## Behavior and constraints

- Driver view uses the profile eye anchor, 60-degree default vertical FOV
  adjustable from 50 to 80 degrees, yaw limits of +/-110 degrees and pitch
  limits of -45 to +35 degrees. Recenter is explicit; there is no head bob,
  shake or dynamic FOV.
- Chase starts 5 m behind and 2.5 m above. A center ray and four offset rays
  retract the camera immediately to the closest hit minus 0.2 m; a clear path
  restores smoothly.
- Rear and side mirrors use three render targets (512x128 rear, 256x256 per
  side), 50-degree rear and 75-degree side vertical FOVs, and a 15 Hz maximum
  refresh without catch-up. Mirror surfaces and the driver head are excluded
  from mirror passes.
- The simulated overhead view is a single orthographic camera with a 10x10 m
  ground footprint, forward at the top, in a 320x320 CSS-pixel lower-right
  inset. Its target updates at no more than 30 Hz and is composited into the
  same canvas. No GPU readback, custom shader or second renderer is used.
- Trajectory samples use a bicycle model from the rear axle, current steering
  and gear, and stop at 3 m or the first conservative envelope overlap. Both
  rear-wheel references and the body envelope are visualized; the aid is
  labeled an estimate.
- Five physics rays per bumper use yaw offsets -60/-30/0/+30/+60 degrees,
  origins across the bumper width and a height of 0.45 m above ground. The
  learner vehicle and non-solid markers are excluded; no hit is `null`.
- Sensor bands are clear beyond 2.5 m or on no hit; green above 1.2 m through
  2.5 m; yellow above 0.6 m through 1.2 m; red above 0.3 m through 0.6 m; and
  STOP at or below 0.3 m. Closer entry is immediate; leaving a band requires
  0.05 m extra clearance. Samples and regular DOM updates are limited to 20 Hz.
- Audio unlock follows a deliberate Start gesture. A single oscillator stream
  uses 1.0/0.5/0.2-second intervals for green/yellow/red and continuous STOP.
  Pause, outcomes and disposal silence it. Muting or unavailable audio never
  hides the visual warnings.
- Learner-facing copy remains Vietnamese. Warnings use labels and distances
  as well as color, controls remain keyboard-operable, and reduced-motion and
  existing WebGL/context-loss/disposal handling are preserved.

## Verification and remaining validation

The browser suite uses the real WebGL renderer in Chromium and Firefox. A
test-only `AudioContext` fake makes unlock, pause and unavailable-audio behavior
deterministic without adding a production debug global. Browser evidence covers
pointer-lock lifecycle, driver/chase changes, rendered look/recenter changes,
view-aid toggles, visible muted sensor labels, fallback behavior and repeated
preview disposal. Unit tests cover auxiliary state restoration, render timing,
mirror targets and geometry, sensor boundaries/hysteresis and audio scheduling.

Chromium exercises live viewport resizing. Firefox's Playwright
`page.setViewportSize()` hangs in this environment, including on a blank page;
Firefox viewport bounds are instead checked in fresh contexts at the target
sizes. This does not claim Firefox live-resize coverage. Supported-Node
verification is also pending: the recorded runs use Node v24.13.1, below the
repository's declared minimum v24.15.0. Real wheel mapping, Phase 5 assets,
reference hardware, instructor review and performance targets remain outside
this phase's verified evidence. The current prototype yard also has no
independent labeled left/right mirror landmarks or garage test wall, so those
asset-dependent sightline/occlusion checks remain pending rather than claimed
as browser-verified.
