# Phase 6 Design: Lessons and Parking Evaluation

**Status:** Approved for implementation
**Date:** 2026-11-04
**Implementation branch:** `phase-6-lessons-parking-evaluation`

## Intent

Turn the Phase 5 stage-selection and asset/persistence foundation into the
approved five-stage Vietnamese parking curriculum. A learner should be able to
read a briefing, practice with advisory steps and independent driving controls,
finish through measured parking criteria, understand success or failure in a
recap, and retry or continue. Completed recaps must remain available after
reload without saving active attempts or motion.

The existing master detail design is the behavior source of truth for stage
content, checkpoints, parking thresholds, failures, and recap measurements.
Phase 6 records those contracts here at implementation boundaries and does not
reopen their instructional or physics tuning decisions.

## Owner decisions

- Implement five authored lessons from the stage table in `docs/detail-design.md`.
- Convert the Stage 1 launch into the Garage forward-bay lesson. Preserve the
  current free-drive Garage sandbox as a separate Menu action named `Lái tự do`,
  using the currently selected vehicle and without lesson completion or recap.
- Persist every completed success and failure recap across reloads in the same
  browser profile. Use one `AttemptSummary` shape for every stage and outcome.
  Do not sync records across browsers/devices and do not persist active attempts.
- Add a separate Menu entry for recap history. Show a chronological list with
  completion date, stage, vehicle, and result; selecting a row opens its full
  recap.
- Retain recaps without an application-level count limit. Browser storage still
  has finite quota: if a history write fails, preserve older records, keep the
  current recap only for the session, and show that it was not saved.
- Use IndexedDB for completed-attempt history; keep Phase 5 progress, settings,
  and calibration records in their existing localStorage store.
- Keep Phase 5's contiguous unlock rule: only a confirmed successful lesson
  calls `recordConfirmedStageSuccess`; a failure, sandbox session, or preview
  cannot unlock a stage.
- Create and work in a separate Phase 6 worktree. Merge into `main` and push
  only after explicit Phase 6 owner sign-off.

## Goals and boundaries

| Category | Definition |
|---|---|
| Goals | Five scenario definitions; briefings and typed step/checkpoint progression; feasible authored spawns/routes for Sedan and CUV; oriented parking success evaluation; collision/failure outcomes; deterministic retry; success/failure recaps; persistent same-browser recap history; progression integration; retained free-drive sandbox |
| Non-goals | Online accounts/sync, arbitrary lesson scripting, procedural/random layouts, traffic actors, new vehicle/physics engine, saved motion or resumable attempts, production art, official driving-test certification |
| Anti-goals | Exact-path grading; rewarding speed; treating sensor guidance or a camera turn as proof of observation; letting advisory steps block a valid park; allowing failure and success in one fixed step; silently discarding history or claiming an unsaved recap persisted |
| Fidelity limit | Parking and route checks are software-level approximations. Passing tests does not establish instructor approval, vehicle/hardware support, driver competence, or training readiness. |

## Approaches

The approved master design already chooses typed, data-driven scenarios and
explicit checkpoint predicates integrated with the existing fixed-step loop.
The implementation must not introduce a generic workflow engine or another
simulation architecture.

| Approach | Benefits | Tradeoffs | Decision |
|---|---|---|---|
| Put lesson logic in `app.ts` and append all recaps to localStorage | Minimal new modules; synchronous integration with current app | Couples presentation, evaluation, and lifecycle; rewrites an ever-growing history and is a poor fit for unlimited history | Rejected |
| Add small scenario/checkpoint/parking/attempt modules; integrate their pure updates at the approved fixed-step boundary; store recaps in an IndexedDB object store | Testable behavior, clear ownership, append-oriented durable history; retains existing localStorage records for small settings/progress | Adds async persistence initialization/error paths and IndexedDB tests; browser quota still limits storage | Chosen |
| Add a generic lesson scripting platform or remote/cloud history | Could support future authoring or cross-device use | Out of scope, conflicts with local-only decisions, and adds unnecessary infrastructure and failure modes | Rejected |

## Lesson and runtime behavior

Use the five authored scenarios and constraints in `docs/detail-design.md`:

| Stage | Environment and maneuver | Instruction focus |
|---|---|---|
| 1 | Garage, forward into a 3.0 × 6.0 m bay | P/brake/parking-brake sequence, creep, steering, stopping, and securing |
| 2 | Garage, reverse into a 2.8 × 5.5 m bay | Approach, safe stop/shift, observation reminder, reverse, and straighten |
| 3 | Roadside, reverse-parallel into a 7.0 × 2.5 m space | Signal, setup, rear entry/front swing, correction, and alignment |
| 4 | Garage, reverse into a 2.6 × 5.3 m bay near pillars | Side/front sweep, pause, and safe repositioning |
| 5 | Roadside, parallel into a 6.5 × 2.5 m space with a different approach | Recall and adapt the sequence |

All scene/scenario geometry remains authored TypeScript metadata. Define
vehicle-specific spawns, allowed bounds, target poses, checkpoint regions, and
solid obstacle identifiers. Keep colliders separate from GLB render geometry.
Preserve at least a 6 m garage aisle and 3.5 m roadside maneuvering lane, and
check each layout against both vehicle profiles. Stage 5 is authored, not
randomly generated.

Load the selected scene, then show a briefing and wait for an explicit Start.
Run checkpoint evaluation after each physics step, advancing no more than one
step at once. Required conditions are an AND; acknowledgements latch only for
the current step and must be made while stopped. Alternative safe regions may
advance advisory setup prompts. Final parking success is independent of
advisory-step completion. Help explains or highlights the current action and
never controls the vehicle or disables collision checks.

At each fixed step process failure first, checkpoints second, and parking
success last. Failure therefore wins if both conditions would otherwise occur
in one step. Pause suspends simulation-time dwell and lesson clocks. Retry
rebuilds the attempt at its authored spawn and clears held inputs, step state,
sensor history, and attempt measurements. The separate free-drive action
retains Phase 5's current Garage sandbox lifecycle and does not create a lesson
attempt.

### Parking success

Use the master thresholds without changing their meaning:

- The full oriented planar vehicle envelope, including mirrors, fits inside
  the target inset by 0.05 m.
- Wrapped heading error is at most 5 degrees.
- Linear speed is below 0.1 m/s and angular speed below 0.05 rad/s.
- Gear is P and the parking brake is applied.
- Roadside stages also require an authored curb-side body gap of 0.15–0.30 m.
- All conditions remain true for 2.0 seconds of simulation time; any false
  sample resets the dwell.

### Failure and recap

Fail on solid chassis/mirror contact, explicit wheel-side curb clearance,
leaving allowed bounds, tipping beyond 30 degrees, or speed above 15 km/h for
one simulation second. Non-finite physics state is an application error, not a
learner failure. On failure, stop requested controls and stepping, retain the
first failure reason/obstacle, and show the recap until Retry or Menu.

Use the existing `AttemptSummary` fields for both success and failure. Store a
uniform outer history record containing a stable record ID, completion
timestamp, and the unchanged summary; this supports date ordering without
stage- or outcome-specific summary shapes. Include outcome, first failure and
obstacle when relevant, closest sampled clearance, peak speed, direction
changes, acknowledged steps, and requested aids. A direction change requires
movement above 0.2 m/s before its sign changes. Do not infer unsampled
clearance or actual observation.

History is browser-local, unbounded by application policy, and contains only
completed summaries. IndexedDB open/transaction/quota failures must be
observable. Preserve older records; keep the just-finished recap in application
memory and report it as session-only if the write fails. A failed history save
does not convert a valid simulated success into a failure; progression storage
continues to use the Phase 5 persistence result and its own honest notice.
Validate records at the storage boundary. Never silently replace malformed or
unsupported history; recovery/clear actions must be explicit and scoped only
to Park-Core history.

## UI flow and access

```text
Menu -> Loading -> Briefing -> Playing <-> Paused -> Success / Fail
  |         |                         |                   |
  |         +-> Error -> Retry/Menu   +-------------------+
  +-> Recap History -> Recap detail
  +-> Lái tự do -> existing Garage sandbox
```

The Menu keeps stage and vehicle selection for lessons, adds a separately
labeled history entry, and adds `Lái tự do`. The history list sorts newest
first and exposes date, stage, vehicle, and outcome; a selected record presents
the full recap. Use Vietnamese learner copy, semantic keyboard-operable
controls, visible focus, and polite announcements for discrete state changes.
Do not announce telemetry at frame rate.

## Implementation constraints and model routing

- Keep strict TypeScript, Vite, Three.js, Cannon-es, vanilla DOM, the existing
  renderer, and the single simulation/animation loop. Add no package unless a
  missing existing browser capability is demonstrated.
- Use the typed `ScenarioDefinition`, `Checkpoint`, `LessonRuntime`,
  `AttemptSummary`, and existing Phase 5 persistence boundary; refine only
  where required for clear ownership and persistent history.
- Maintain physics update order, pause/input neutralization, cancellation,
  resource disposal, Vietnamese errors, and explicit error reporting.
- Follow `docs/tech-design.md` tier routing: Premium for oriented-envelope,
  curb-gap, and route/physics geometry; Standard for lesson evaluation,
  state/persistence integration, and cross-system verification; Lightweight
  only for repetitive DOM/CSS scaffolding after contracts and behavior are
  fixed. The implementation plan will assign tiers to bounded tasks.
- Keep Phase 6 in its own worktree. Do not merge or push before owner sign-off.

## Validation and release limits

Add focused tests for checkpoint sequencing/alternative regions; oriented
target containment and heading wrap; continuous dwell reset; mirror-aware
envelope and roadside gap; failure precedence and each failure boundary;
recap metrics; retry determinism; IndexedDB persistence, ordering, validation,
and failed writes; progression unlock only on lesson success; and preserving
the free-drive path. Browser tests should exercise complete success/failure
flows, retry/Menu, history after reload, and free-drive bypass with real
rendering.

Run all unit tests, typecheck/build, browser tests in Chromium and Firefox, and
`git diff --check`. Report supported-Node, manual route feasibility, learner
walkthrough, driving-instructor review, wheel compatibility, reference-PC
performance, and art/sightline validation separately as pending unless
actually performed. Phase 6 software acceptance alone is not training
readiness.

## Builder discretion

- Choose simple stable IDs and an ISO-8601 UTC completion timestamp for each
  stored recap.
- Keep IndexedDB records independently appendable and query in reverse
  completion-time order; do not serialize the entire history for every save.
- Define a compact empty/loading/error state for the history screen using the
  existing Vietnamese message dictionary.
- Keep stage definitions declarative and finite; avoid a generic parser or
  arbitrary user-provided lesson data.
