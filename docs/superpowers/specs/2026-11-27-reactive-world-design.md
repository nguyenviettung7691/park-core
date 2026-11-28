# Reactive World Design (issue #25)

Status: draft for approval. Source: GitHub issue
nguyenviettung7691/park-core#25 (part of #5), refined in a brainstorming
conversation on 2026-11-27.

## Intent

Park-Core is a parking trainer. Today the `garage` and `roadside`
environments hold nothing that moves except the learner's car, so checking
mirrors and blind spots never changes anything. This work adds pedestrians and
passing cars that show up **at the moments a real driver must look**: moving
off, selecting R, signalling to park. Skipping a check can then have a
visible cost.

It pairs with #24 (observation checks), which grades where the learner looked.
#24 is not implemented yet. This work must not depend on it, but it supplies
the situations #24 will point at (see "Hand-off to #24").

## Decisions made in the conversation

1. **Triggers (decided):** in lessons, actors are set off by **the learner's own
   actions** (gear change, indicator, moving off, first stop), plus a fixed
   delay. The same inputs always give the same timings. **Free drive** uses
   a fixed **looping ambient schedule** on the simulation clock.
2. **Consequences (decided, option C):**
   - **Stages 3–5:** actors brake within realistic limits. A pedestrian stops
     within about 0.5 m of deciding to. A car brakes at about 6 m/s², which is
     roughly 2.5 m from 20 km/h. Pulling or reversing into the path of an actor
     that is already close can cause a crash, and a crash fails the attempt.
   - **Stages 1–2:** actors always stop in time, so no crash is possible from
     an actor moving into the car. Each time one has to stop because of the
     learner, it is recorded as a **near miss** and listed in the results.
   - **All stages:** if the learner's car touches an actor (moving or
     stopped), the attempt fails as a `collision`, the same as hitting a
     parked car.
3. **Per-lesson situations and behaviour rules (approved as proposed):** see
   the tables below.
4. **Approach (decided, B): actors are pure logic, with no physics bodies.**

## Goals

- Pedestrians walk along garage aisles and roadside sidewalks. Some cross
  behind or beside the learner's car.
- Passing cars drive in the roadside lane and along the garage aisle,
  including cars approaching from behind.
- Fully deterministic: actor state is a pure function of the simulation
  clock (fixed step, 1/120 s) and the lesson trigger events.
- Actors show up in the in-scene mirrors, the overhead view and the chase
  view automatically, because they are scene objects.
- Running into an actor fails the attempt. In stages 1–2, an actor stopping
  for the learner is recorded as a near miss.
- Free drive has looping ambient traffic.

## Non-goals

- AI traffic, junctions, traffic lights, open-world driving.
- Real-time lighting or night scenes.
- Grading where the learner looked. That is #24.
- New lessons (for example a dedicated pull-out stage). Existing stages,
  their targets, spawns and pass criteria do not change.

## Anti-goals (a failure even if it technically works)

- Randomness: the same inputs pass once and fail the next time.
- An actor that blocks a lesson indefinitely or makes it unwinnable.
- Breaking the triangle or draw-call gates (<=140 lesson / <=100 sandbox
  main-pass calls, <=30,000 environment triangles) or the 1440p/60 Hz target.
- Parking sensors alarming constantly because of passing actors.
- Hand-edited GLBs, or a pedestrian model that skips the asset workflow's
  candidate and visual-approval gate.

## Current state that this builds on

- Fixed-step loop in `src/render/preview.ts` (`clock.advance`, 1/120 s steps):
  `rig.applyInput` → `world.step` → `rig.snapshot` → `sensors.sample` →
  `updateFailure` → attempt tracker.
- `updateFailure` (`src/lessons/failure.ts`) maps a contact collider id to
  `collision` / `curb-contact`.
- Parking sensors (`src/sensors/proximity.ts`) are 10 Cannon rays, 2.55 m
  long at 0.45 m height, and accept an `ignored` body set.
- Parked lesson cars are clones of the driven vehicle's GLB nodes, fitted to a
  collider box (`src/render/parked-vehicle.ts`). Passing cars can reuse this,
  so **no new car model is needed**.
- Environment GLBs carry hidden templates (`WheelStopTemplate` in the garage),
  authored in `tools/asset-designs/environments.mjs`.
- Roadside layout: the curbs are at x = ±4.2, so the road is 8.1 m wide. The
  dashed centre line is at x = -0.65. The sidewalks run from about |x| = 4.35
  out to the fence at x = 8, and the driving bounds are |x| <= 4.35,
  |z| <= 15.5. Vehicle forward is -z.
- The garage is 30 × 30 m with pillars at (±9, ±8). The lessons use bays at
  z = -5…-8, and the open aisle is around z = 0…10.
- Route witnesses (`src/lessons/scenario-routes.test.ts`) are geometric only:
  they check a swept route footprint against static colliders.
- Lesson-completion browser tests drive real attempts
  (`tests/browser/lesson-driver.ts`).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Actors as kinematic Cannon bodies | Reuses the contact and sensor code. But contact response shoves the learner's car, and witnesses would need the full physics running. |
| **B (chosen)** | **Pure-logic actor module, no physics** | Deterministic and unit-testable without Cannon. The rules (yield, near miss, braking) are plain code. Crash and sensor checks need their own small geometry tests. |
| C | Logic plus mirrored Cannon bodies for sensors and contacts | Two sources of truth that can drift apart, and the shove problem comes back unless contact response is turned off. |

B was chosen. Actors never physically block the car, which is acceptable
because any touch either fails the attempt or is prevented by the yield rule.

## Design

### Module: `src/world/actors.ts` (new, pure TypeScript)

- **Actor definition (data):** id, kind (`pedestrian` | `car`), footprint
  half extents (pedestrian about 0.25 × 0.25 m, height 1.7 m; a car uses the
  sedan or CUV parked-car box), a polyline path on the ground (world x/z), a
  cruise speed (pedestrian about 1.3 m/s, car about 20 km/h, always under 30
  km/h), and an optional **detour path** used when the actor is blocked.
- **Schedule (per scenario):** a list of `{ trigger, delayS, actorId }`.
  Triggers are derived from data the loop already has:
  - `moving-off`: the first step where the gear is D or R, the parking brake
    is released and the speed is above 0.2 m/s;
  - `gear-selected R`;
  - `indicator <side>` switched on;
  - `first-stop`: stopped (below 0.2 m/s) for 0.5 s after having moved.

  Each trigger fires **at most once per attempt** (no re-spawning). The
  schedule lives in `scenarios.ts` next to each stage, as a new optional
  `actors` field on `ScenarioDefinition`.
- **Ambient schedule (free drive):** a per-environment list of actors with a
  fixed start offset and loop period, on the simulation clock. Its rough
  shape: one pedestrian per sidewalk or aisle, plus a roadside car about every
  20 s, alternating lanes and directions. The garage aisle gets an occasional
  slow car.
- **State update:** `step(state, learner, dtS) → state`. `learner` holds the
  vehicle footprint (from `vehicleFootprint`), the signed speed and the
  telemetry the triggers need. All the rules are in this function:
  - **Path-ahead check:** each actor looks ahead along its path by its
    stopping distance plus a margin (pedestrian 0.5 m, car v²/(2·6) + 1 m).
    If the learner's footprint overlaps that swept corridor, the actor
    brakes.
  - **Stages 3–5:** the actor brakes at its realistic limit, so it may still
    reach the car.
  - **Stages 1–2:** the actor's deceleration is not limited. It stops before
    contact, and a `near-miss` event is emitted once per actor per encounter,
    but only when the learner's car was moving when the actor had to stop.
    Waiting for an actor that was already in the way is not a near miss.
  - **Yield and detour:** an actor stopped because of a *stationary* learner
    car waits 3 s, then switches to its detour path. That might mean turning
    back, or for a car, steering around inside the lane when there is room.
    It never sits blocked for longer than that.
    In free drive (ambient schedule) "stationary" also covers a learner that
    is creeping or rocking in place: while the actor is stopped, a learner
    whose footprint centre has moved less than 1.0 m since the hold began
    counts as stationary, whatever its reported speed. A learner that really
    drives on clears the corridor instead. Lessons keep the plain speed test
    (they are bounded by the 15 s lifetime).
  - **Bounded lifetime:** every lesson actor finishes its path, or is removed
    at its path end, within about 15 s of its trigger. It is gone afterwards.
  - **Actors yield to each other at runtime.** The schedules keep actors
    apart when nobody is in the way, but a learner can delay one actor into
    another's path, so each actor also checks other visible actors against
    its own corridor (the same swept corridor as the learner check):
    - it always yields to another actor's **current** box, whatever the
      schedule order;
    - it yields to another actor's **projection** (its boxes over the next
      1.5 s at its current speed) only when that actor is an earlier schedule
      entry, or is *committed* (braking for the learner, or on a detour).
      This order tie-break is what keeps two moving actors from both
      stopping;
    - it never stops for a projection when its own box already lies on the
      other actor's path ahead (the projection plus 3 m). Stopping there
      would leave it in the way; it keeps going to clear the path, and the
      other actor yields to its current box;
    - an actor on its detour ignores other actors (others yield to it), so
      there is no yield cycle.
    Yielding to an actor never produces a near miss or a contact. A hold by
    another actor feeds the same 3 s timer as a stationary learner, so a
    mutual hold (two boxes in each other's corridors) ends with a detour. For
    example, a car held 3 s by a crossing pedestrian turns back. Pairs whose
    scheduled paths can never bring their boxes together (all roadside
    pairs) are skipped, unless one of them is on a detour.
  - **Ambient starts are deferred, never dropped.** In free drive, a due
    start waits, and is retried every step, while 3 ambient actors are
    already visible (`MAX_AMBIENT_ACTIVE`), or while the learner's footprint
    overlaps the actor's box swept over the first 3 m of its path. The actor
    starts on the first step both are clear. This is a pure function of the
    state, so it stays deterministic.
  - Unit tests enforce no actor/actor overlap, for stationary learners on a
    pose grid and for a learner that parks across the garage aisle and then
    drives away at a sweep of times.
- **Outputs per step:** actor poses (for rendering, kept as previous and
  current so the renderer can interpolate with the clock `alpha`, as the car
  does), the **contact actor id**, if the learner footprint overlaps an
  actor footprint (2D oriented-box overlap, reusing the existing polygon
  helpers), and near-miss events.

### Integration in the step loop (`preview.ts`)

After `rig.snapshot`, call `actors.step(...)`.
- An actor contact id is passed to `updateFailure` like a collider contact,
  and becomes a `collision` with `obstacleId` set to the actor id. The physics
  contact still takes precedence when both happen in the same step.
- Near-miss events go to the attempt tracker.
- Actors reset with the attempt (restart / retry), back to the
  untriggered state.

### Parking sensors

Actors are not Cannon bodies, so the rays don't see them. `proximity.ts`
gains an analytic ray-against-oriented-box test over the **actors inside the
learner's corridor**. The corridor is the learner footprint expanded by the
2.55 m sensor reach, but only for actors that are crossing the learner's
path or stopped close to the car. Actors moving parallel in another lane
(heading within about 20° of the lane axis and centred more than 1.5 m
laterally outside the learner footprint) are skipped. The closest hit
between Cannon and the actors wins. The band hysteresis is unchanged.

### Attempt summary and history

- `AttemptSummary` gains `nearMisses: readonly { actorId: string; atS: number }[]`.
  Older stored records without the field read as `[]`. This is a version-safe
  extension in `src/storage/attempt-history.ts`.
- The results screen shows a "Near misses" metric (count, with actor kind),
  and new message keys for it.
- `FailureReason` is unchanged: hitting an actor is a `collision`. The results
  text names a pedestrian or car from the `obstacleId` prefix (`ped-` /
  `car-`).

### Per-lesson schedules (approved)

| Stage | Trigger (+ delay) | Actor and path |
|---|---|---|
| 1 garage, forward into bay | moving-off (+0 s) | A pedestrian walks along the aisle from behind on one side, passes beside the car (blind-spot check) and exits the far end. |
| 2 garage, reverse into bay | R selected (+1.5 s) | A pedestrian crosses behind the bay entrance, through the learner's reversing path. |
| 3 roadside, parallel park | right indicator on (+0 s) | A car comes from behind (+z, heading -z) in the left lane and passes the learner. It is beside or behind the learner if they reverse too early. |
| 4 garage, pillars | R selected (+0 s) | A car drives along the aisle behind the bay. |
| 5 roadside, reduced guidance | first-stop (+0 s) | A car comes from behind in the left lane. A pedestrian walks along the right sidewalk. |

The exact start positions and delays are tuned so that the actor is visible
in the relevant mirror or blind-spot region at the check moment. This is
confirmed with captures (see Validation).

### Rendering

- `src/render/actors-scene.ts` (new): one group per actor.
  - **Cars** are `createParkedVehicle` clones, with brake lamps lit while the
    car is braking (lamp nodes already exist).
  - **Pedestrians** are clones of a new hidden `PedestrianTemplate` node in
    both environment GLBs. It has a rigid body, head and limb nodes whose leg
    and arm swing is driven from walking distance, so a stopped pedestrian
    stands still.
- Actors that are not yet triggered or already finished are `visible = false`,
  with no draw calls.
- Draw-call budget: at most **2 actors visible at once in a lesson**, and 3 in
  free drive. Each actor must fit the remaining main-pass headroom, and the
  existing 140 / 100 gates are asserted with actors visible. If a car clone is
  too costly, the builder may merge its meshes per material when cloning.

### Pedestrian asset

- Authored in `tools/asset-designs/environments.mjs` (or a sibling module),
  generated by `tools/generate-assets.mjs`, never hand-edited. It stays behind
  an opt-in generator flag until it is approved, following the
  "candidate feature" rule in `docs/asset-pipeline.md`.
- Style: low-poly, matching the existing art. About 300–800 triangles, with
  neutral clothing colours. Its triangles count toward the environment's
  30,000 gate.
- Goes through the full asset workflow: brief, candidate generation, captures
  (standing and mid-stride, seen in each mirror), and **developer visual
  approval** before promotion.
- **Until approval, a placeholder is used:** a capsule or box stand-in made
  at runtime (as `src/test/vehicle-template.ts` does for tests), so the
  runtime work isn't blocked on the art.

### Free drive

The sandbox uses the ambient schedule for its environment. Crashes there
behave as today (no attempt fails). Actors still yield and detour, and they
use the stage 3–5 braking rule.

## Validation

- **Unit tests (`actors.test.ts`):**
  - determinism: same inputs give identical state, step for step;
  - each trigger fires at most once;
  - braking distances;
  - stages 1–2 never produce contact from actor motion;
  - stages 3–5 can produce contact when the learner cuts in late;
  - yield → 3 s → detour;
  - a 15 s lifetime bound;
  - no actor-actor overlap in any schedule;
  - the ambient loop is periodic.
- **Failure, attempt and storage tests:**
  - an actor contact becomes a `collision`;
  - near misses are recorded and persisted;
  - an old record without `nearMisses` loads.
- **Sensor tests:**
  - a pedestrian crossing behind the car triggers the rear sensors;
  - a car passing in the other lane leaves all sensors `clear`.
- **Route witnesses, now with time:** for each stage and vehicle, replay the
  scripted route against the actor schedule (triggers fired at the route's
  natural points), and assert:
  - a route that **waits** for the actor to pass completes without contact;
  - no actor stays in the route corridor for more than its 15 s lifetime.
- **Browser:**
  - The lesson-completion specs still pass. The lesson driver may add a wait
    at the trigger point; a real wait must be enough to win.
  - A capture test per stage shows the actor in the relevant mirror at the
    check moment.
  - Draw-call gates are asserted with actors visible.
- Screenshot or CI checks do not verify 1440p60 performance or training
  readiness (as in the existing docs).

## Hand-off to #24

Each lesson schedule entry carries the check moment it serves (`moving-off`,
`reverse`, `signal-right`) and the side. #24 can then link a missed check to
the actor that was there.

## Calls made during the builder check (author's calls, not discussed)

- **Near misses in stages 3–5 too.** In stages 3–5 an actor braking for the
  learner also counts as a near miss and is listed in the results (it was
  forced to brake but didn't hit). Only stages 1–2 *guarantee* stopping in
  time. This gives #24 the same signal in every stage.
- **Garage cars are slower:** about 10 km/h on the aisle. Roadside cars drive
  at about 20 km/h.
- **Appearing and disappearing:** paths start and end beyond the driving
  bounds, at the ground edge or behind the fence, frontage or pillars, so
  that actors don't pop into view close to the car or in a mirror.
- **The stage 3 crash is intended.** The front corner of a learner reversing
  too early swings into the left lane, and that is the consequence of
  skipping the check. The lesson-completion driver waits for the car to pass
  before reversing.
- **Shipping before the pedestrian art is approved:** the runtime uses the
  placeholder whenever `PedestrianTemplate` is missing from the loaded
  environment GLB. The candidate GLB with the template stays behind the
  opt-in flag until the developer approves it.

## Left to the builder

- Exact path coordinates, delays and detour shapes per stage, tuned with
  captures.
- Data-structure details, file split and message wording.
- How the near-miss metric is laid out on the results screen.
- Mesh merging for actor clones, if it is needed for the draw-call budget.
