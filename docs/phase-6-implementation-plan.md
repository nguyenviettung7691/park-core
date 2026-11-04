# Phase 6 Implementation Plan: Lessons and Parking Evaluation

**Status:** Implementation and software acceptance are complete on the
isolated `phase-6-lessons-parking-evaluation` branch. Owner sign-off is pending.
Do not merge to `main` or push before explicit approval.

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

## Limits and pending validation

The scenario route witnesses are geometry/curvature checks, not proof of
dynamic drivability. Manual learner walkthrough, instructor review, real-wheel
compatibility, supported-Node validation, reference-PC performance, production
assets and sightline validation remain pending unless later recorded as
completed. Passing software checks does not establish driver competence or
training readiness.

No merge or push is authorized until explicit Phase 6 owner sign-off.
