# Ten-case Lesson Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Track steps with checkboxes.

**Goal:** Close Finding 3 with ten real Chromium UI successes and a usable
acknowledgement control.
**Architecture:** Shared discrete keyboard actions fix learner controls.
Optional detached observations feed a development-only DOM transport. A
test-only feedback driver operates normal calibrated inputs through two
five-stage UI journeys, without replacing physics or evaluation.
**Tech Stack:** Strict TypeScript, vanilla DOM, Playwright, Vitest, existing Cannon-es.
**Spec:** `docs\superpowers\specs\2026-11-05-lesson-completion-design.md`

## Global Constraints

- No dependencies, physics tuning, telemetry mutation, pose writes, outcome
  injection, persistence seeding or weakened lesson/parking rules.
- DEV-only transport; production runtime never exposes it.
- F acknowledges; Digit1–4, Space, Q/E are shared discrete actions, canvas-focused,
  unmodified, non-repeat and non-editable; movement remains source-specific.
- 90 seconds active driving per stage, ten minutes per vehicle test; no retries.
- No Finding 2 benchmarks. Preserve existing tests and deployment gates.
- Standard-tier control/state/integration/docs; Premium only after a separately
  scoped verified physics/complex-geometry blocker. No unnecessary UI worker.
- Sign-off before merge/push; Finding 3 closure follows ten cases and hosted CI.

## Review Focus

- Gamepad movement must ignore WASD while discrete keys work only canvas-focused.
- Acknowledgement while moving must not bypass stopped/current-step requirements.
- Old session callbacks and mutable observer payloads must not affect runtime.
- Paused/closed/stale observations must not drive the wrong session.
- Browser successes must arise from normal inputs with persistent UI recaps,
  not offline loop duplication or injected unlocks.

### Task 1: Normal discrete learner controls

**Files:** `src\input\controller.ts`, `src\input\input.test.ts`,
`src\ui\screens.ts`, `src\ui\ui.test.ts`, `src\messages.ts`,
`README.md`, `docs\detail-design.md`.
**Interfaces:** Existing `InputAction`, `InputController.poll(): InputPoll`,
and `mountScreen`; no new action type.

- [ ] Add failing input tests: F yields `{type:'acknowledge-step'}` once in
  each source, Digit1/Space/E work in calibrated gamepad mode; WASD still
  leaves gamepad axes/pedals authoritative. Modified/repeat/editable/unfocused
  events yield no discrete actions.
- [ ] Add failing screen test: current acknowledgement step shows Vietnamese
  F/stopped hint; other steps do not. Existing checkpoint tests still reject
  moving acknowledgements.
- [ ] Run `npm test -- src\input\input.test.ts src\ui\ui.test.ts` and confirm
  failures exercise missing controls/hint.
- [ ] Implement shared discrete handling, F action and localized conditional
  hint in the existing playing screen. Update README/master controls contract.
- [ ] Run focused tests and typecheck; run unit suite once and commit.

### Task 2: Detached app observation and DEV-only transport

**Files:** create `src\app-observation.ts`, `src\app-observation.test.ts`;
modify `src\app.ts`, `src\app.test.ts`, `src\main.ts`;
test production exclusion in `tests\production\pages.spec.ts`.
**Interfaces:** Export `APP_OBSERVATION_EVENT = 'park-core:observation'`;
`AppObservation` discriminated union with `kind`, `generation`, `sequence`,
`capturedAtMs` and per-kind payload. Kinds: `session` (stageId nullable,
vehicleId), `telemetry` (VehicleTelemetry), `lesson` (LessonRuntime), `outcome`
(AttemptSummary), `paused` (reason), `resumed`, `closed`.
Optional `AppDeps.onObservation?: (event: AppObservation) => void`.
Transport helper `dispatchAppObservation(event: AppObservation): void`.
No preview/rig/app handle or writers in any payload.

- [ ] Write failing app tests: session/initial lesson precede telemetry;
  resume/pause/close events identify generation; stale callbacks ignored;
  mutating nested observed telemetry/outcome does not change runtime/history.
- [ ] Write transport test for named DOM CustomEvent with detached detail.
  Add production test listener before navigation/start: no observation events.
- [ ] Run focused tests to establish RED, then implement observation emission
  inside existing generation guards using detached copies, only when configured.
- [ ] Wire transport in `main.ts` only inside `import.meta.env.DEV`; no settings
  or query-switch. Emit close/reset and fresh identity for every new preview.
- [ ] Run app/transport tests, typecheck/build and targeted production smoke.
  Verify event marker absent from built app JS, run unit suite once and commit.

### Task 3: Feedback-driven ten-case browser journeys

**Files:** create `tests\browser\lesson-driver.ts`,
`tests\browser\lesson-completion.spec.ts`; preserve
`tests\browser\phase-6.spec.ts`. Update `docs\detail-design.md`,
`docs\phase-6-implementation-plan.md`, `PRODUCTION-READINESS-REVIEW.md`.
**Consumes:** Task 1 normal keys; Task 2 event/types; existing scenarios,
profiles and rear-axle geometry, normal gamepad calibration UI.
**Produces:** two vehicle tests containing five named `test.step` successes
each and actionable failure evidence.

- [ ] Install listener and fake Gamepad before navigation using typed test-only
  declarations. Calibrate through UI, select vehicle, leave storage empty.
  Listener caches new detached events, resets on session/closed and validates
  identity/finite telemetry; stale threshold two seconds, first sample deadline
  ten seconds after resume.
- [ ] Implement route/control helpers from the verified spike concept, not its
  duplicated simulation loop. Straight stages 1/2/4; radius-5 reverse arcs 3/5.
  Steering uses real rear-axle telemetry, speed feedback ~0.7 m/s and normal
  axis/pedal samples. Gear/brake/indicator/F are real keyboard events while
  canvas-focused/pointer-locked. Acknowledge only the current required step
  while stopped, never blindly each tick.
- [ ] Run one hard targeted vehicle case initially; fail promptly on failure
  recap/pause/staleness and log stage, vehicle, pose, heading, speed, step.
  Any verified source defect requires focused RED/GREEN, not test weakening.
- [ ] Complete each vehicle's stages 1–5 through unlocked-stage UI; assert
  success recap/identity, persisted unlock after reload, saved attempt/history
  identity and recap; Stage 5 has no Stage 6. Release normal controls before
  navigation. Set each test timeout ten minutes, per-drive deadline 90 seconds.
- [ ] Run both journeys once after targeted issues resolved. Retain ten-case
  output and diagnostics. Run unit/typecheck/build and existing acceptance/
  production suites once for final integration; no automatic rerun loop.
- [ ] Document exact dynamic browser evidence separately from spike/geometry
  witnesses. Leave instructor, real-wheel and human walkthrough limits open.
  Commit source/tests/docs and obtain task/branch review.

### Task 4: Owner sign-off and publication

- [ ] Present ten-case results, control change, DEV-only limitation and review;
  obtain explicit merge/push approval.
- [ ] Merge approved branch, verify merged unit/build checks, push without force.
  Observe existing supported-Node Chromium CI; no manual reruns without cause.
- [ ] On passing ten-case CI/deployment, record run/revision and mark Finding 3
  Done with exact scope. Check normal app and benchmark entry over HTTPS.
  If CI or ten cases fail, keep Finding 3 open and preserve evidence.
