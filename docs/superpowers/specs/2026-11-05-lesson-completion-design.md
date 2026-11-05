# Finding 3: Ten-case dynamic lesson completion

## Intent

Demonstrate successful UI-driven completion of all five authored lessons with
Sedan and CUV in Chromium. Finding 3 is an evidence gap; do not assume scenarios
are defective. Preserve existing collision/failure, history and sandbox tests.
Human walkthroughs, instructor approval and physical-wheel validation remain
separate requirements, not outcomes of automated driving.

## Approaches and owner decisions

- Timed keyboard scripts: no observation API, but fragile across frame rates.
- Feedback-driven normal input: selected. Observe actual telemetry, drive through
  normal Gamepad/keyboard paths and UI, without changing physics or success rules.
- Owner approved a throwaway feasibility spike and chose development-only
  read-only observation. All ten cases belong in the learner browser suite,
  not merely offline physics tests or a shipping diagnostic surface.

## Spike evidence and limits

One offline real-physics execution completed stages 3/5 with both vehicles using
the existing radius-5 route and feedback steering, including lesson steps and
parking dwell. Wrong steering produced out-of-bounds failures. Artifacts are in
the worktree's ignored `.superpowers\spikes\finding-3` folder.
This duplicated the runtime loop without sensors; it proves feasibility only.
Browser input, calibration, rendering, recap and persistence still need proof.
Do not ship or promote the spike verbatim as the acceptance implementation.

## Read-only observation boundary

Add a strictly typed optional application observation callback using existing
preview telemetry, lesson-update and attempt-outcome events. Observations carry
session identity (stage, vehicle, generation), a monotonic observation sequence,
and detached data copies; never expose a preview, rig, mutable physics objects,
an input queue, persistence writers or the app's confirmed-success method.
Reject stale callbacks by the app's existing generation guards.
Emit session reset/closed observations so drivers cannot use stale telemetry.
Use discriminated events: session (stage/vehicle/generation), telemetry,
lesson, outcome, paused, resumed and closed. Every event includes generation,
sequence and capture time from performance.now(); telemetry includes its existing
simulationTimeS. Emit the initial lesson/session before the first telemetry.
Clear the driver's latest data on session/closed; paused must stop driving and
fail unless a test intentionally exercises pause.
Fail on no telemetry within 10 seconds of resume, or age above two seconds
while running. Only process new sequences. Compute rear-axle position in the
test using the existing profile geometry helper; do not expand observations
with derived route/control state.

Wire a development-only observer in `main.ts` behind `import.meta.env.DEV`.
Tests install their listener before navigation. A namespaced DOM event carrying
detached data is the proposed transport; listeners can inspect or mutate their
copy but cannot mutate runtime state. Production build has no active transport.
No query parameter, user control or alternate success path enables observation.
Observer lifecycle/integration and production exclusion receive focused tests.

## Feedback driver and test matrix

Use a test-only fake Gamepad at the browser API boundary, following the existing
calibration browser test. Calibrate through visible UI with real button/axis
samples; retain normal neutral-input, brake/gear and pointer-lock requirements.
The builder check discovered no learner-facing acknowledgement binding.
The owner selected shared discrete keyboard controls in keyboard/gamepad modes:
Digit1–4 request P/R/N/D, Space toggles parking brake, Q/E toggle indicators,
and F sends acknowledgement for the current step. F is the builder's proposed
unused key; show its Vietnamese hint beside the lesson instruction when the
current step requires acknowledgement, and document all shared keys.
Ignore modified/repeated/editable-target key events as existing controls do.
Only accept discrete commands when the simulation canvas owns keyboard focus;
gamepad steering/pedals remain the sole continuous inputs in gamepad mode.
Existing stationary acknowledgement and gear/brake interlocks remain unchanged.
Use these real keyboard keys while pointer lock is held rather than HUD clicks.
Never inject InputAction directly into the preview or acknowledge all steps
blindly. Add focused input/HUD regressions for this learner-facing fix.

Reuse the spike's verified route shape as test-only route data/control logic,
not a new runtime autopilot. Stages 1/2/4 use straight approach/reverse routes;
3/5 follow two radius-5 arcs. Controller reads rear-axle pose, heading, speed and
current lesson step. Target low speed around 0.7 m/s; stop, select P and apply
parking brake through normal input, then await the real two-second parking dwell.
No pose writes, teleportation, state seeding for success/unlocks, checkpoint
skipping, clock acceleration, outcome injection or weakened parking tolerances.

Create two independently isolated vehicle journeys, each completing stages 1–5
in order from empty browser storage. Select vehicle through UI, verify the
current unlocked stage, instruction/required acknowledgement handling, actual
success recap identity and next-stage availability after each case.
Reload between stages to verify persisted unlocks and the completed-attempt
history/recap for the previous stage. Stage 5 must finish without creating Stage 6.
Do not replace current failure/sandbox tests.
Each vehicle journey is a separate Playwright test with its own fresh context;
use test.step for the five stages and set its timeout to 10 minutes explicitly.
DOM success/recap/history and persisted unlock UI are authoritative acceptance
assertions; observer outcomes provide identity and debugging, not forced success.

## Bounded execution and failure evidence

Feedback reacts to simulation telemetry rather than fixed travel sleeps.
Use a 90-second active-drive deadline per stage and a 10-minute maximum per
vehicle journey, including navigation/calibration. No automatic retry.
Fail promptly on failure recap, missing/stale observation, lost session or
non-finite telemetry; report stage, vehicle, last pose/heading/speed/step.
Retain Playwright failure traces through existing configuration.
Run targeted changed tests first; do not repeat full suites without a new change
or a concrete unresolved failure. No Finding 2 performance benchmarks.

## Source fixes and documentation

Only change source/scenario geometry or checkpoints if an actual browser failure
identifies a defect. Reproduce with a focused regression first; preserve lesson
intent and explain any necessary adjustment. Physics tuning or complex geometry
requires a separately scoped Premium-tier investigation, not speculative changes.
Standard-tier routing covers observation, test integration, state and docs;
Lightweight is unnecessary for this tightly coupled task.

Update master validation docs and Phase 6/readiness records with exact evidence
and remaining non-software limitations. Mark Finding 3 Done only after all ten
UI-driven cases pass and reviewed changes are signed off, merged, pushed and
supported-Node CI passes. Development-served evidence is not proof of a separate
production ten-case suite; existing production smoke remains unchanged.
