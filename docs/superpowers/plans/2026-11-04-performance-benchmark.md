# Production Performance Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver repeatable production benchmark tooling for Finding 2 while leaving actual reference/minimum-PC validation explicitly pending.

**Architecture:** An optional production-preview frame observer feeds a pure bounded measurement collector. A separately built benchmark page owns four stationary Garage cases and local JSON reports without instantiating the learner app or persistence.

**Tech Stack:** Strict TypeScript, Vite, existing Three.js/Cannon-es runtime, vanilla DOM, Vitest and Playwright; no new dependencies.

**Spec:** `docs\superpowers\specs\2026-11-04-performance-benchmark-design.md`, approved by owner.

## Global Constraints

- Work in `.worktrees\performance-benchmark` on `performance-benchmark`; merge/push only after implementation sign-off.
- Reference: Ryzen 5 7600, RTX 4060 8 GB, 32 GB dual-channel DDR5, NVMe SSD, Windows 11; 2560x1440 at 60 Hz and 100% zoom.
- Every valid case targets p95 <=17.5 ms, average rendered FPS >=57 and zero total discarded simulation time.
- Four cases: Sedan/driver, Sedan/chase, CUV/driver, CUV/chase; 10-second warm-up plus 60-second measurement each.
- Mirrors, sensors, overhead and trajectory enabled, full resolution scale, fixed camera orientation/FOV, stationary P/parking brake, muted audio; no physics/update-rate changes.
- Preserve existing `Clock.advance().droppedTimeS` semantics; separately count incoming elapsed time lost to the 0.1-second clamp.
- Shipping entry requires 2560x1440 drawing buffer and confirmed 60 Hz/100% zoom; Chrome and Firefox produce separate suite reports.
- No learner saves, automatic upload, analytics, minimum-PC inference or reference-validation claims from CI/entered metadata.
- Findings 2–5 remain open; only benchmark tooling and performance-contract changes are in scope.
- Standard-tier metric/integration/test/documentation work; Lightweight only for repetitive UI after contracts are fixed; no planned Premium geometry/physics work.

## Review Focus

1. A long first/last interval must not disappear at warm-up/end boundaries or conceal clamp loss; Task 1 boundary/loss tests.
2. Focus/lock/input/resize interruption must invalidate, not stitch windows or appear as performance pass; Tasks 1–2 invalidation tests.
3. Optional instrumentation must not change normal preview physics/rendering/disposal; Task 1 observer regression tests.
4. Retry/disposal must not duplicate asset ownership, listeners, samples or callbacks; Task 2 lifecycle tests.
5. Short CI runs and manually entered reference specs must never become hardware certification; Task 2 export/schema/browser tests.

---

### Task 1: Frame observation and measurement collector

**Files:**
- Create: `src\benchmark\metrics.ts`, `src\benchmark\metrics.test.ts`
- Modify: `src\render\preview.ts`, `src\render\preview.test.ts`

**Interfaces:**
- Export `PreviewFrameSample` from `preview.ts`: readonly `completedAtMs`,
  `elapsedS`, `droppedTimeS`, `clampedTimeS`, `drawingWidthPx`,
  `drawingHeightPx`, all numbers.
- Extend `PreviewEvents` with optional
  `onFrame?(sample: PreviewFrameSample): void`, called once after a successful
  production render; no callback for initial static render or stopped ticks.
- Export `createMeasurement(startMs: number, timing?: MeasurementTiming): Measurement`
  from `metrics.ts`. `MeasurementTiming` contains readonly `warmupMs`,
  `measurementMs`, `testOnly`; default is 10000/60000/false.
- `Measurement` exposes `observe(sample: PreviewFrameSample): void`,
  `invalidate(reason: string): void`, `snapshot(): MeasurementResult`.
- `MeasurementResult` carries phase `warmup | measuring | complete | invalid`,
  invalid reason or null, configured timing/test-only marker, measured start/
  end timestamps or null, raw measured frame/loss samples, interval count,
  actual elapsed duration, p50/p95/p99/max interval, mean FPS, catch-up loss,
  clamp loss, total loss and nullable target verdict. Null summaries/verdict
  represent absent/insufficient samples; no zero-filled successful result.
- Export `summarizeIntervals(intervalsMs: readonly number[])` with interval
  count, total elapsed, p50/p95/p99/max and average FPS. Reject non-finite,
  zero or negative intervals explicitly. Keep exact public types in this
  module so Task 2 consumes, not redefines, them.

- [ ] **Step 1: Write metric and observer regression tests.**
  Test nearest-rank percentiles and interval-weighted FPS: `[10,20,30,40]`
  yields p50=20, p95=p99=max=40, mean FPS=40. Test no samples => no verdict;
  boundary 17.5 ms / 57 FPS comparisons use unrounded values; any positive
  loss fails. Reject invalid timing/interval input.
  Warm-up samples must not enter measured intervals; first measured frame
  establishes baseline, then include the full interval whose endpoint first
  reaches/exceeds the 60-second measurement duration. Long terminal intervals
  must not be discarded. Loss attached to that first baseline is excluded
  because it spans warm-up; subsequent measured frame loss is retained.
  Invalidations are sticky; finished results freeze; retries use fresh
  collectors. Require finite warmupMs >=0 and measurementMs >0; test timing
  overrides require testOnly=true. Bound measured samples at 100000 per case;
  if exhausted, mark invalid rather than truncate a successful result.
  Extend existing fake-preview tests: optional observer absent preserves
  current behavior; completed render emits actual dimensions/timestamp;
  0.2-second input exposes 0.1-second clamp loss plus catch-up loss without
  changing physics steps; disposed/paused ticks do not emit.

- [ ] **Step 2: Run focused RED tests.**
  `npm test -- src\benchmark\metrics.test.ts src\render\preview.test.ts`
  must expose missing collector/observer behavior, not dependency failures.

- [ ] **Step 3: Implement typed metrics and optional observer.**
  Reuse `clock.advance` result in `preview.ts`; compute
  `Math.max(0, elapsedS - 0.1)` separately before clamping. Sample completion
  time only after `views.render`; do not introduce a second animation loop.
  Keep per-frame instrumentation optional when unused. Use bounded arrays
  and nearest-rank sorting at summary/export boundaries, not every frame.

- [ ] **Step 4: Verify focused GREEN and compiler.**
  Run the Step 2 command and `npm run typecheck`; expect all passing.
  Commit scoped files with Copilot co-author trailer.

### Task 2: Production benchmark page, export, browser proof and documentation

**Files:**
- Create: `benchmark.html`
- Create: `src\benchmark\main.ts`, `src\benchmark\page.ts`,
  `src\benchmark\page.test.ts`, `src\benchmark\style.css`
- Create: `tests\production\benchmark.spec.ts`
- Modify: `vite.config.ts`
- Modify: `README.md`, `docs\tech-design.md`, `docs\detail-design.md`,
  `docs\implementation-plan.md`, `PRODUCTION-READINESS-REVIEW.md`

**Interfaces:**
- Consumes Task 1's `PreviewEvents.onFrame`, `Measurement` and result types,
  `createPreview`, `loadSceneAssets`, existing runtime settings and messages.
- Export `createBenchmarkPage(root: HTMLElement, options?: BenchmarkPageOptions): { dispose(): void }`
  from `page.ts`; `main.ts` mounts only this function, never `createApp`.
- `BenchmarkPageOptions` permits injected runtime/assets/clock/download ports
  for tests and explicitly test-only short timing. Production `main.ts` passes
  no overrides. Never accept query parameters/localStorage to shorten a
  shipping run or override target criteria.
- Use direct DOM IDs `benchmark-start`, `benchmark-cancel`,
  `benchmark-export`, `benchmark-status`, `benchmark-results` for tests.
- JSON schema version 1 includes workload version 1, metadata, configured
  timing/test-only marker, case settings/measurements, complete/incomplete
  suite status, targets and per-case verdicts. Overall measured pass requires
  four valid complete cases and all target verdicts pass, and is never named
  "reference hardware validated". Test-only output is ineligible for a
  workload-version-1 performance verdict.

- [x] **Step 1: Add failing page/lifecycle and export tests.** (written; RED history unrecorded)
  Assert missing actual-machine fields/60Hz/zoom confirmation prevents start;
  wrong drawing buffer reports invalid, not pass. Use injected observers to
  complete four cases and validate exported metrics/case order/settings,
  partial/incomplete suites, unavailable renderer metadata, test-only labels,
  invalidation on resize/DPR/focus/visibility/lock loss/mouse-look/driving input.
  Assert cancel/retry/load failure/dispose cancels stale loading and disposes
  one owned preview/assets without leaked listeners; no persistence APIs or
  learner app instantiated. Test metadata entered as reference does not grant
  reference-validation status.

- [ ] **Step 2: Run focused RED page tests.** (not evidenced; recovered session, only GREEN observed)
  `npm test -- src\benchmark\page.test.ts`; expect missing page behavior.

- [x] **Step 3: Implement page, runtime wiring and production entry.**
  Keep setup/results outside the measured canvas workload, with full-viewport
  canvas while running. Fixed driver FOV 60 degrees, centered look, existing
  Garage sandbox spawn, no lesson runtime. Load selected vehicle/Garage
  cancellably; request pointer lock from a deliberate start gesture after
  loading is ready, then resume normally. Track pause/fault/notices and
  invalidate as specified; do not bypass input safety or change update rates.
  Use metadata form plus detected browser/renderer/viewport details; no fake
  detection of CPU/GPU model or zoom. Export via local Blob/download, revoke
  URLs. Plain Vietnamese copy, existing purple/high-contrast theme, accessible
  labels/status/buttons; no additional framework.
  Add both `index.html` and `benchmark.html` to Vite build inputs while
  preserving Vitest configuration. Inject build revision from existing
  `GITHUB_SHA` or an explicit unavailable value; do not pretend tool version
  alone identifies a built revision.

- [ ] **Step 4: Add real production browser proof.** (spec written; browser run pending)
  In `tests\production\benchmark.spec.ts`, verify built `/benchmark.html`
  loads setup/validation and references production assets. At 2560x1440
  viewport/DPR 1 in Chromium/Firefox, fill explicit CI machine metadata and
  complete one real 10+60-second case (test timeout 150 seconds), then export
  an incomplete suite and check nonempty raw metrics/dimensions. This avoids
  shipping test entry points or duration switches. Pure page tests cover all
  four cases with injected short timing/test-only marker. Do not assert FPS
  targets on CI. In a separate short browser case, resize during warm-up and
  assert interruption, not success. No screenshots as performance evidence.

- [x] **Step 5: Reconcile performance contract and run instructions.**
  Update master reference target to approved 1440p/60FPS criteria, retaining
  144Hz as optional aspiration and minimum PC as undetermined. Document
  workload version/settings, fixed samples versus unknown worst-case view,
  measurement semantics, four cases per browser, about five minutes/browser,
  required actual hardware/driver fields, focused 60Hz setup, JSON export,
  invalid-run recovery and privacy boundary. Add dated Finding 2 status:
  tooling delivered, no real reference/minimum-PC evidence, remains open.
  Do not silently close Finding 5 or alter other findings.

- [ ] **Step 6: Verify and commit integrated tooling.** (unit/typecheck/build passed; browser suites pending)
  Run `npm test`, `npm run typecheck`, `npm run build`,
  `npm run test:browser -- --reporter=line`,
  `npm run test:production -- --reporter=line`, `git diff --check`.
  Existing Pages CI already runs both browser suites headed under Xvfb on
  supported Node 24.15.0; preserve that path without a separate test build.
  Record checks/runtime limitations and commit scoped files
  with required co-author trailer. Obtain task and whole-branch review;
  controller owns independent reviewer dispatch.

### Task 3: Owner sign-off, integration and truthful evidence

**Interfaces:** Consumes reviewed benchmark commits; produces approved
merged/pushed main and software-tooling evidence, not hardware certification.

- [ ] **Step 1: Present implementation, tests, limitations and request sign-off.**
  Wait for explicit approval before merge/push; hardware validation remains
  pending by the owner's decision.
- [ ] **Step 2: Merge approved branch and verify merged tree.**
  Preserve unrelated changes, merge non-interactively, run affected checks,
  then push without force and observe supported-Node Pages validation.
- [ ] **Step 3: Verify deployed benchmark entry and persist actual evidence.**
  Confirm production entry/JS/CSS assets and normal app still load. Record
  run URL/revision and software smoke counts. Keep Finding 2 open with exact
  remaining hardware/browser/minimum-PC evidence; do not invent measurements.
