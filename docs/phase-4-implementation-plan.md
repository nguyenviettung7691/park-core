# Phase 4 Implementation Plan: Vision & Support Systems

**Status:** Phase 4 implementation tasks are complete in the prototype. This
plan records the delivered interfaces and evidence; it does not mark Phase 5
assets, release validation or training readiness complete.

**Approved design:** [Phase 4 Vision & Support Systems](superpowers/specs/2026-11-03-phase-4-vision-support-design.md).
**Detailed requirements:** [product detail design](detail-design.md), Sections
7, 8, 12 and 13.

## Architecture and constraints

Use the existing TypeScript/Vite, Three.js and Cannon-es stack. The preview
remains the only fixed-step/RAF owner and the application uses one WebGL
renderer. View, sensor and audio systems share the preview lifecycle; do not
add independent polling loops, GPU readback, custom shaders or dependencies.
Keep Vietnamese learner copy and preserve the current pause, error, resize,
context-loss and idempotent-disposal behavior.

Delivered boundary contracts:

- `createViews(renderer, scene, assets, profile, boxes): ViewSystem`; `ViewSystem`
  owns driver/chase cameras, bounded look, FOV, mirror/overhead passes,
  trajectory toggles, resize, recentering and disposal.
- `sampleTrajectory(telemetry, profile, boxes)` returns rear-axle positions and
  conservative body envelopes, bounded by the 3 m estimate.
- `createSensors(world, body, profile)` exposes simulation-time sampling and
  reset; `classifyDistance(distanceM, previous)` implements the specified
  warning bands and hysteresis.
- `createAudio(onError?)` returns `AudioOutput`; the optional error callback
  forwards asynchronous failures into the existing preview fault handling.
- `PreviewEvents` publishes typed sensor snapshots/notices. `Preview` owns
  audio unlock, pointer-lock/resume, view settings and cleanup. `Hud` exposes
  sensor/settings updates and keeps visual warnings independent of audio.

## Task order and completion

| Task | Tier | Delivered result |
|---|---|---|
| 1. Trajectory geometry | Premium | Rear-axle bicycle sampling, reverse/forward direction, bounded path and conservative envelope stopping, with focused unit tests. |
| 2. View and auxiliary rendering | Premium | Driver/chase cameras, mirrors, overhead composition, trajectory rendering, renderer-state restoration, throttling and resource ownership. |
| 3. Preview/HUD integration | Standard; Lightweight only for repetitive CSS/DOM | Camera settings and controls, pointer-lock loss pause, explicit resume/recenter, and shared preview lifecycle. |
| 4. Proximity/audio support | Standard | Ten physics rays, classifications/hysteresis, visible HUD warnings, user-gesture audio unlock and pause/disposal/fallback handling. |
| 5. Browser acceptance and documentation | Standard | Chromium/Firefox real-rendering acceptance, phase references and reconciliation of the technical design. |

## Verification record

Final gates passed: `npm test` (12 files, 221 tests), `npm run typecheck`,
`npm run build`, `npm run test:browser` (22 tests across Chromium and Firefox),
and `git diff --check`. The build succeeds with Vite's warning that the
minified JavaScript chunk exceeds 500 kB.

Browser coverage includes real WebGL camera/view changes, mouse-look and
recentering, overhead and trajectory toggles, visible sensor labels while
muted, audio unlock/pause and unavailable-audio behavior, pointer-lock
lifecycle, viewport bounds and repeated preview disposal. `AudioContext` is
faked only in tests.

Firefox live in-page resize is not claimed: `page.setViewportSize()` hangs in
this environment. Firefox size bounds use fresh browser contexts; Chromium
checks live resize. Node v24.13.1 is below the repository's declared minimum
v24.15.0, so validation under a supported Node version remains pending. The
prototype has no labeled left/right mirror landmarks or garage test wall;
those visual checks remain pending for an appropriate asset/test fixture.

Real wheel mapping, Phase 5 assets, reference hardware, instructor review and
performance targets also remain pending; passing software gates does not mark
those release prerequisites complete.
