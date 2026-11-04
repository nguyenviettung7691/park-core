# Phase 6 Detailed Design: Lessons and Parking Evaluation

**Status:** Implemented in the isolated `phase-6-lessons-parking-evaluation`
worktree. Software acceptance and owner sign-off status are recorded in the
[implementation plan](phase-6-implementation-plan.md). Do not merge to `main`
or push before explicit Phase 6 owner approval.

**Approved design:** [Lessons and parking evaluation](superpowers/specs/2026-11-04-phase-6-lessons-parking-evaluation-design.md).
The approved master behavior remains in [the project detail design](detail-design.md).

## Intent and fidelity boundary

Deliver the five authored Vietnamese lessons on top of Phase 5 asset loading,
local progress/settings/calibration, and contiguous stage unlocks. A learner
reads a briefing, explicitly starts the simulation, practices with advisory
checkpoints, and receives a measured success or failure recap. Only confirmed
lesson success advances progression. Garage free drive remains a separate
sandbox action.

The simulation uses simplified RaycastVehicle dynamics, authored box colliders,
estimated sensors, and approximate parking geometry. Passing software
acceptance does not establish instructor approval, vehicle or wheel support,
driver competence, or training readiness. The current assets remain prototype
art; no official test or certification claim is made.

## Runtime boundaries

The existing application owns the UI, generation token, asset loading, and
disposal. The preview owns one renderer, one fixed-step loop, the world, and the
vehicle rig. It receives either a lesson scenario or sandbox mode:

| Module | Responsibility |
|---|---|
| `src/lessons/scenarios.ts` | Finite `ScenarioDefinition` data, vehicle-specific spawns, bounds, regions, target poses, steps, and solid colliders |
| `src/lessons/checkpoints.ts` | Pure typed checkpoint evaluation, one-step advancement, stopped acknowledgements, optional alternative-region advancement |
| `src/lessons/parking.ts` | Oriented full-envelope containment, heading, stationary state, gear/brake, curb-gap and continuous dwell |
| `src/lessons/failure.ts` | First collision, curb-contact, out-of-bounds, tip, or sustained-speed failure |
| `src/lessons/attempt.ts` | Uniform success/failure `AttemptSummary` and measured attempt metrics |
| `src/storage/attempt-history.ts` | Validated completed-record append/list/reset in IndexedDB with explicit session-only or reset-required states |
| `src/app.ts`, `src/ui/screens.ts` | Briefing/start, outcome, retry/continue, history, reset, and free-drive navigation |

For a lesson, settle the rig at
`scenario.spawnByVehicle[vehicleId]`; sandbox mode retains the prototype
Garage spawn. Scenario colliders are composed with explicit environment
colliders and never inferred from render meshes. Every attempt begins with
fresh controls, lesson state, sensor history, and metrics.

Each fixed step applies input and physics, then evaluates in this order:

1. Failure, which wins if a collision and success could occur in the same step.
2. At most one advisory checkpoint transition.
3. Parking completion and recap measurement.

Pause stops simulation time and dwell. A terminal outcome stops simulation,
clears held input, stops audio, and displays the recap. Retry reloads the same
stage through its briefing; Menu closes and disposes the session. A sandbox
session has no lesson runtime, recap, or progression callback.

## Authored lesson set

All measurements are in meters; headings are radians. The values below are
the implemented scenario metadata, not regulatory dimensions.

| Stage | Environment and maneuver | Sedan/CUV spawn X,Z; yaw | Target center X,Z; yaw | Safety context |
|---|---|---|---|---|
| 1 | Garage forward-bay, 3.0 × 6.0 | 0, 9; 0 | 0, -5; 0 | Parked vehicles at X ±3.4, Z -5; practice slow approach and secure in P |
| 2 | Garage reverse-bay, 2.8 × 5.5 | 0, 10; π | 0, -7; π | Parked vehicles flank the bay at X ±3.2; stop and acknowledge before reverse |
| 3 | Roadside reverse-parallel, 2.5 × 7.0 | 0, -7.1; 0 | 2.9, 0; 0 | Right curb plus vehicles before and after the space; signal, setup, reverse and correct |
| 4 | Garage narrow reverse-bay, 2.6 × 5.3 | 5.4, 9; π | 5.4, -7; π | Adjacent vehicle near X 2.7, Z -7; assess sweep and safely reposition |
| 5 | Roadside adapted parallel, 2.5 × 6.5 | -1.5, -7.32; 0 | 2.9, 1; 0 | Right curb and authored parked vehicles; recall and adapt the approach |

Both profiles share the listed X/Z/yaw per stage and use their own center-of-mass
height. Each scenario also has an authored setup region, driving bounds, and
finite typed checkpoint sequence. Checkpoints guide but do not mandate an exact
path; a safe alternative-region arrival can bypass an advisory setup step.
Observation prompts are never treated as proof that the learner looked.

## Parking, failure, and recap rules

Success requires all of the following continuously for 2.0 seconds of
simulation time:

- The complete oriented planar vehicle envelope, including mirrors, fits
  inside the target inset by 0.05 m.
- Wrapped heading error is at most 5 degrees.
- Linear speed is below 0.1 m/s and angular speed below 0.05 rad/s.
- Gear is P and the parking brake is applied.
- Roadside stages also meet their authored 0.15-0.30 m curb-side body-gap range.

Any failed sample resets the dwell. Failure boundaries are solid chassis/mirror
contact, explicit wheel-side curb contact, leaving authored bounds, tipping
past 30 degrees, or exceeding 15 km/h for one simulation second. Non-finite
physics is an application error, not a learner failure. Preserve the first
failure reason and obstacle.

The same `AttemptSummary` is used for either outcome: stage/vehicle, result,
failure and obstacle when relevant, simulation duration, closest sampled
clearance, peak speed, direction changes, acknowledged steps, and requested
camera/trajectory/help aids. Acknowledgements and aid use are recorded as
events; camera use does not prove observation. Never save an active attempt.

## Persistence and recovery

Completed records use IndexedDB database `park-core.attempt-history`, version
1, object store `attempts`, key path `id`, and `completedAt` index. The outer
record contains a stable ID, ISO-8601 UTC completion timestamp, and unchanged
summary. Lists are newest-first; history is local to the current browser
profile, with no account, sync, or application-level record cap.

Validate stored values at the boundary. Do not silently delete, replace, or
rewrite malformed/unsupported data. A failed append retains older records and
the current recap in session memory, and reports it as session-only; reset is
explicit and deletes only this history database. Phase 5 progress, settings,
and calibration remain in their existing separate localStorage records.
History reset must not clear those records. A failed history save does not
change a simulated success or suppress the separate progression-save result.

## UI and access

```text
Menu -> Loading -> Briefing -> Playing <-> Paused -> Success / Fail
  |         |                         |                   |
  |         +-> Error -> Retry/Menu   +-------------------+
  +-> History -> History detail
  +-> Lái tự do -> Garage sandbox
```

Use Vietnamese learner-facing copy, semantic keyboard-operable controls,
visible focus, and polite announcements for discrete lesson transitions.
Keep telemetry out of frame-rate live announcements. The Menu exposes separate
lesson, history, and `Lái tự do` actions. Recap history lists date, stage,
vehicle, and result, with a detail view and confirmed reset.

## Tier routing

Follow the project-defined tiers in `docs/tech-design.md`:

- **Premium:** oriented-envelope geometry, curb-gap calculations, and
  route/physics geometry.
- **Standard:** checkpoint/failure/parking evaluation, typed state and storage
  integration, and cross-system verification.
- **Lightweight:** repetitive DOM/CSS scaffolding only after contracts and
  behavior are fixed.

These are task-routing requirements, not claims about which model executed
each historical change.

## Validation boundary

See the [Phase 6 implementation plan](phase-6-implementation-plan.md) for
fresh test, typecheck, build, and Chromium/Firefox acceptance output, commit
history, and environment limits. Geometric route witnesses and browser
acceptance are software evidence only. Supported-Node validation, manual
learner walkthrough, instructor review, real-wheel mapping, reference-PC
performance, and production-art/sightline review remain separate pending work
unless the implementation plan records otherwise.
