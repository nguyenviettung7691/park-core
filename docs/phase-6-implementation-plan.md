# Phase 6 Implementation Plan: Lessons and Parking Evaluation

**Status:** Implementation and software acceptance were completed on the
isolated `phase-6-lessons-parking-evaluation` branch and merged into local
`main` as `1f372bd` after owner approval on 2026-11-04. Nothing was pushed.
External validation remains pending.

**Approved design:** [Phase 6 design](superpowers/specs/2026-11-04-phase-6-lessons-parking-evaluation-design.md).
**Detailed behavior:** [Phase 6 detail design](phase-6-detail-design.md), following
[the approved master design](detail-design.md).

## Delivered tasks

| Task | Commit | Result |
|---|---|---|
| 1. Author scenarios and route witnesses | `918061a` | Five authored layouts; contract and geometric route checks for both vehicle profiles |
| 2. Add checkpoint progression | `a4d1a51` | Typed advisory steps, stopped acknowledgements, dwell, and safe alternative-region advancement |
| 3. Evaluate parking | `80d3c38` | Oriented full-envelope containment, heading, curb gap, P/brake, and continuous dwell |
| 4. Evaluate failures | `9a30fe5` | First collision, curb, bounds, tip, overspeed, and non-finite-state handling |
| 5. Track attempts | `b34e2d9` | Uniform success/failure summaries with measured simulation metrics |
| 6. Integrate lesson preview | `e430d48` | Fixed-step evaluation order, lesson-specific spawn, retry isolation, and unchanged sandbox mode |
| 7. Persist completed history | `10f1de2` | Validated IndexedDB append/list/reset with explicit session-only and reset-required states |
| 8. Add lesson/history/free-drive UI | `24c707d` | Briefings, outcomes, success-only progression, history navigation/reset, and separate free drive |
| 9. Browser acceptance and documentation | `330b6ef` | Chromium/Firefox acceptance, lesson-spawn regression, roadmap reconciliation, and final review |

## Acceptance criteria

- All five authored lessons use the approved Vietnamese stage content and
  scenario-specific geometry. Route witnesses check geometric clearance for
  both profiles, but do not claim dynamic route drivability.
- Lesson success uses the approved full-envelope, heading, speed, gear/brake,
  curb-gap, and continuous-dwell conditions. Failure wins over success in a
  fixed step; non-finite physics remains an application error.
- Only confirmed lesson success updates contiguous stage progression. Failed
  lessons and free drive cannot unlock stages.
- Every completed success/failure recap uses the same summary shape and
  persists in the browser's IndexedDB history when available. Active attempts
  are not saved; history reset does not clear Phase 5 localStorage records.
- Retry starts a fresh attempt at its authored spawn. Free drive remains a
  separate Garage sandbox action.
- Browser acceptance exercises real success and collision failure, retry,
  later-stage unlock/entry, history ordering after reload, reset isolation,
  and free-drive bypass in Chromium and Firefox.
- Report software evidence separately from hardware, instructor, learner,
  production-art, and training-readiness validation.

## Verification record

Fresh final results:

- `npm test`: 24 files, 356 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite reports an 822.21 kB minified JavaScript chunk
  warning (217.81 kB gzip).
- `npm run test:browser -- --reporter=line`: 28 tests passed across Chromium
  and Firefox (14 per browser).
- `git diff --check`: passed after the final documentation edit.

These runs used Node v24.13.1, below the declared minimum v24.15.0; they are
not supported-Node validation.
The declared supported-Node range is `^22.22.2 || ^24.15.0 || >=26.0.0`;
supported-Node validation remains pending.

## Dynamic ten-case browser evidence (lesson-completion branch)

`tests/browser/lesson-completion.spec.ts` (two Playwright tests, five
`test.step` stages each, 10-minute test timeout, 90-second active drive per
stage, no retries) completes Stages 1-5 in order for Sedan and CUV from empty
storage on the Vite dev server in Chromium. It calibrates a fake Gamepad through
the visible UI, sends steering/pedals through `navigator.getGamepads`, and uses
real keyboard events for gear, parking brake, indicator and F. A route-following
controller (`tests/browser/lesson-driver.ts`: straight Stages 1/2/4, radius-5
arcs for 3/5, about 0.7 m/s) reads the DEV-only `park-core:observation` events;
it cannot write poses, inputs, outcomes or storage. Each stage asserts the
success recap, reload persistence of the unlock, history identity/recap and no
Stage 6. Production builds emit no observation events (existing smoke test).

Latest local run (all ten passed, wall seconds per stage S1/S2/S3/S4/S5):
Sedan 22.7/30.3/18.3/28.1/20.1; CUV 22.9/30.1/18.1/27.9/20.0. This is
software-rendered Chromium evidence from the dev-served app; the geometric
witnesses above remain separate. Hosted supported-Node CI after merge is
pending, as are manual walkthrough, instructor review and real-wheel testing.
Final local counts: 427 unit tests (27 files), typecheck/build, 16 browser
tests (14 existing plus the two journeys) and 5 production smoke tests.

## Limits and pending validation

The scenario route witnesses are geometry/curvature checks, not proof of
dynamic drivability. Manual learner walkthrough, instructor review, real-wheel
compatibility, supported-Node validation, reference-PC performance, production
assets and sightline validation remain pending unless later recorded as
completed. Passing software checks does not establish driver competence or
training readiness.

The local merge was explicitly approved. Do not push without separate owner
approval.
