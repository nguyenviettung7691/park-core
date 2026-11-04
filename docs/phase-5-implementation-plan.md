# Phase 5 Implementation Plan: Assets and Progression Foundation

**Status:** Implementation and software gates complete in the isolated
`phase-5-assets-progression` worktree; owner sign-off is pending.
Do not merge to `main` or push before owner sign-off.

**Approved design:** [Phase 5 design](superpowers/specs/2026-11-04-phase-5-assets-progression-design.md).
**Detailed contract:** [Phase 5 detail design](phase-5-detail-design.md).

## Architecture and constraints

The app owns asynchronous asset-load generations and transfers one selected
asset set to the preview. The preview remains the sole renderer, animation,
and physics-loop owner. Static visual geometry is separate from explicit
Cannon collider metadata. Persistence owns only progress, settings, and
controller calibration; the stage UI cannot award success.

Keep the existing TypeScript/Vite, Three.js, Cannon-es, and vanilla DOM stack.
Use original deterministic GLB generation, no added runtime dependency, and
Vietnamese learner-facing copy. Preserve loaded-resource disposal, cancellation,
pointer-lock/focus behavior, and corrupt-save recovery.

## Delivered tasks

| Task | Commit | Result |
|---|---|---|
| 1. Original assets | `0771d31` | Deterministic generator and four original GLB outputs |
| 2. Metadata and loader | `08b7712` | Dimension/anchor validation, explicit colliders, typed failures |
| 3. Async preview ownership | `ffcd460` | Selected-pair loading, cancellation, stale-result disposal, preview ownership |
| 4. Persistence | `1836f31` | Versioned records, unlock rules, validation/recovery and key-specific reset |
| 5. Stage selection | `51ba680` | Hydrated state, Stage 1 Garage sandbox, locked Stages 2-5, typed success boundary |
| 6. Browser acceptance and docs | In progress | Real-WebGL asset/lifecycle tests, master-document reconciliation, measured asset pipeline |

Phase 5 tasks 1-5 were committed separately on the feature branch. The current
uncommitted Task 6 changes include `tests/browser/phase-5.spec.ts`, its real
WebGL fixture, the remaining browser timing corrections, and the documentation
deliverables. Keep unrelated worktree changes intact.

## Acceptance criteria

- All four generated GLBs are deterministic, structurally valid, correctly
  dimensioned, have their required named nodes, and remain within triangle and
  transfer budgets.
- Loader requests only the chosen vehicle/environment pair, validates anchors
  and dimensions, fails explicitly by resource category, and disposes aborted,
  stale, or rejected resources exactly once.
- Stage 1 opens only the Garage sandbox. Stages 2-5 remain visibly locked until
  a future confirmed lesson success; no preview or menu action records success.
- Progress, settings, and calibration hydrate before the menu. Invalid records
  are preserved until confirmed key-specific reset; storage failure is clearly
  session-only.
- Browser acceptance exercises all four asset combinations with real WebGL,
  startup/cancellation/retry, and repeated close/reopen without stale scenes or
  uncaught errors.
- Report software evidence separately from art, hardware, route, performance,
  and instructor validation.

## Verification record

- `npm test`: 16 files, 297 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite reports the existing 789.90 kB minified JavaScript chunk warning.
- `npm run test:browser -- --reporter=line`: 26 tests passed across Chromium
  and Firefox, including all four asset combinations rendered through WebGL.
- `git diff --check`: passed.

The browser tests wait for visible telemetry to confirm the asynchronous
preview is running; pointer-lock acquisition alone occurs before its running
transition completes. Browser tests use Chromium and Firefox. Runtime Node is
v24.13.1, below the package's declared minimum v24.15.0; do not describe these
runs as supported-Node validation. The chunk warning is not a measured
performance result.

## Deferred work

Five lesson runtimes, briefings/checkpoints, parking evaluation, success/fail
recaps, scenario-specific driveable routes, production art, real-wheel and
reference-hardware checks, instructor review, and target-PC performance remain
outside this phase. Passing software gates does not establish training
readiness. Do not merge or push until Phase 5 is signed off.
