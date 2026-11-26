# Vehicle Physics Effects Design (issue #11)

Status: draft for approval. Source: GitHub issue
nguyenviettung7691/park-core#11, refined in a brainstorming conversation.

## Intent

Park-Core is a parking trainer. Issue #11 asks for cars that behave and look
more like real cars: lamps that respond to the driver, wheels that spin the
right way and ride over edges, and environments with curbs and wheel stops
that a learner can *feel* through the car.

The deciding answer from the conversation: a tyre meeting a wheel stop is
**something to use** ("reverse until the tyre touches the stop"), not a
mistake. At the roadside, a tyre **touching** the curb becomes a **warning**,
and **climbing** the curb **fails** the attempt.

## What already exists (do not rebuild)

Delivered with the issue #12 cockpit redesign and driven by
`src/render/asset-scene.ts` from telemetry:

- `SteeringWheelPivot` turns with `steeringWheelRad`.
- `SpeedometerNeedle` sweeps 0-120 km/h.
- `IndicatorLeftLamp`/`IndicatorRightLamp` flash at 1.5 Hz on simulation time.
- `ParkingBrakeLamp`, the pedals and the CUV `ParkingBrakeLever`.

These satisfy the issue's cockpit items. This work only re-checks that they
are visible from the neutral cockpit POV in review captures, and reuses the
`indicatorLit` flash phase for the exterior lamps so the dash and body agree.

## Goals

1. **Exterior lamps.** Both vehicles get named exterior lamp nodes, switched
   by telemetry the same way the cockpit lamps are:
   - brake lamps (incl. a centre high-mount lamp) lit while service brake > 0.05;
   - reverse lamps lit while gear is R;
   - front and rear turn signals per side, flashing in phase with the dash
     arrows (`indicatorLit`).
   Lit state = a brighter emissive-looking mesh shown, the unlit mesh hidden
   (all art is unlit vertex colour; no real lights, no shaders).
   Parked lesson clones show all exterior lamps off.
2. **Correct wheel spin.** Wheel rotation about the axle matches the direction
   of travel in D and R (and stops when the car stops). The current
   suspicion is that cannon-es's `indicateForwardAxis: 2` (+Z) disagrees with
   the project's -Z forward, inverting spin; a test must confirm before fixing.
3. **Tyre-edge physics (option 1).** Keep the existing
   `CorrectedRaycastVehicle` and its handling. Give each wheel a sense of the
   tyre's shape:
   - several extra probes across the tyre's front and rear arc, in the wheel
     plane, detect a raised edge ahead/behind the contact point;
   - the wheel's support height follows the edge smoothly as the tyre rolls
     up it (no single-frame pop), so the suspension compresses visibly and
     from the cockpit;
   - a vertical face below the tyre centre pushes back along the tyre's
     rolling direction with a force derived from step height, tyre radius and
     wheel load (the standard step-climb relation), so the outcome *emerges*:
     at creep the car comes to rest against a stop with a small felt bump; with
     enough momentum or throttle the tyre rolls up and over.
   - probes also cover the tyre's **sides** (inboard/outboard of the tread),
     because in parallel parking the tyre usually rubs the curb sideways;
     side rubbing counts as `touching` (no climb force sideways beyond the
     existing friction/collision response).
   - each wheel reports a per-step edge state plus the collider id, exposed
     via the rig (e.g. `wheelEdgeContacts()` or a telemetry field) for lessons
     and HUD. States, per wheel and edge collider:
     - `none`;
     - `touching`: tread or sidewall against the edge face, wheel still
       supported by the lower surface;
     - `climbing`: wheel support has lifted onto the edge by more than half the
       edge height, but the wheel centre has not crossed the edge's centre plane;
     - `over`: the wheel centre lies above the edge's footprint in plan (the
       tyre has rolled onto the stop or curb top). Stateless, so it needs no
       entry-side tracking; at <=15 km/h and 120 Hz a wheel moves <=3.5 cm per
       step, so crossing a 0.15 m stop is always observed.
   - climbing is **momentum-only** by design: with the step-climb relation
     (about 1.2x wheel load for the 0.11 m stops and curbs) the unchanged
     2,400-2,600 N drive force and creep cap cannot lift the car from rest, so
     a stop or curb is only mounted by arriving with speed. Tests drive the
     climb/fail cases by approach speed, not throttle from rest. No softening
     factor.
4. **Roadside curb rules.**
   - Lower both roadside curbs from 0.24 m to a realistic **0.11 m** (collider
     in `src/world/colliders.ts` and art in `tools/asset-designs/environments.mjs`,
     regenerated). Plan width and position are unchanged, so the 0.15-0.30 m
     parallel-parking gap criterion is unchanged. 0.11 m sits below both
     ground clearances (0.15 m sedan / 0.18 m CUV), so the chassis/mirror
     collision box does not reach the curb before the tyre does; a test must
     show this margin holds under hard braking dive for both vehicles, in D and
     R and with steering during the stop. The chassis collider shape is not
     changed.
     *Amended after the final review (ruling R12):* this design first chose
     0.12 m, but a hard brake in **R** beside a 0.12 m curb left the sedan's
     chassis corner only 0.8 mm above the curb top, below the 2 mm test margin.
     Clearance under dive is the reason for the curb height, so the curbs were
     lowered to 0.11 m, the same as the wheel stops and still within real curb
     heights (10-15 cm).
   - Tyre `touching` a curb → **warning**: HUD notice, not a failure, and not
     the sandbox "contact" pause. Counted per attempt (`curbTouches`), shown on
     the result and history-detail screens. Attempt history
     (`src/storage/attempt-history.ts`, IndexedDB v1 with strict key and
     reason checks) bumps its version and migrates old records with
     `curbTouches: 0`; the new failure reason is added to its allow-list.
   - Tyre `climbing`/`over` a curb, or the chassis/body touching it → the
     existing `curb-contact` failure.
   - `wheelTouchesCurb` in `src/lessons/failure.ts` (today: any overlap
     fails) is replaced by the rig's edge state.
5. **Garage wheel stops.**
   - Concrete wheel stops, **0.11 m** tall (below both ground clearances,
     0.15 m sedan / 0.18 m CUV, so overhangs pass over them), about 1.8 m wide
     and 0.15 m deep, with a small top chamfer, one per bay used by garage
     stages 1, 2 and 4.
   - New collider kind `wheel-stop`. Tyre `touching` it is allowed and silent
     (no failure, no warning, no contact pause); `climbing` a stop is also
     silent (it is the felt bump, and a tyre may roll back). Tyre going `over` a stop is a
     failure: new `FailureReason` `'wheel-stop-mounted'` with its own message.
   - Placement: positions are chosen so that, for every garage stage x vehicle,
     the pose where the relevant tyres (rear in reversing stages 2 and 4, front
     in forward stage 1) rest against the stop lies inside the existing parking
     target with its inset and heading tolerance. A test proves this.
     Targets, spawns, parked obstacles and lesson criteria do not move.
   - Reaching the target is still judged by the existing region/gear/brake
     checkpoints; touching the stop is not required to pass (it is a tool, not
     a checkpoint).

## Non-goals

- No change to steering, braking, creep, drive force, suspension stiffness or
  damping numbers, gear logic or the friction adapter (project rule: do not
  retune handling for this).
- No rigid-body wheels (option 2) and no wheel collision proxies (option 3).
- No real-time lights, light cones on the floor, bloom or custom shaders.
- No new cockpit instruments; existing ones are only verified.
- No speed bumps on the driving lanes (only wheel stops and curbs).
- No change to lesson pass criteria, target boxes or stage layout.

## Anti-goals (failure even if it "works")

- Handling of the existing scripted lesson routes changes noticeably on flat
  ground (route witnesses in `src/lessons/scenario-routes.test.ts` must still
  pass unchanged).
- The car pops up a curb in one frame, or passes through a stop.
- A learner reversing at creep onto a stop fails or gets a warning.
- Parking sensors scream "stop" permanently in every garage bay.
- Non-deterministic physics (fixed-step results must be repeatable).

## Constraints

- TypeScript / Three.js 0.187 / cannon-es 0.20.0, fixed-step simulation; no
  new runtime dependencies.
- Vehicle and environment GLBs are generated by `tools/generate-assets.mjs`
  from `tools/asset-designs`; never hand-edit binaries.
- **Vehicle GLB changes (exterior lamps) follow `docs/asset-pipeline.md`**:
  brief + impact table, candidate generated outside `public`,
  `assets:check`/`assets:review`, and developer visual approval of the
  candidate hash before promotion. No auto-approved baselines. Environment
  changes (curb height, wheel stops) are regenerated and reviewed the same way
  (captures of both environments), with the developer approving the visuals.
- Budgets unchanged: <=10,000 vehicle triangles, <=4,000 parked, <=30,000
  environment, <=5 MB per pair, <=100/<=140 main-pass draw calls. Lamp
  on/off pairs should be batched per lamp group so they add few draw calls.
- Software tests do not prove performance or training readiness; say so in
  reports.

## Approaches considered

1. **Keep the raycast vehicle and add tyre-shape probes (chosen).** Edge
   detection, smooth climbing and a push-back force layered on the existing
   rig. Keeps tuned handling and existing tests; costs custom physics code that
   needs careful tests.
2. **Rigid-body wheels attached by constraints.** Most natural edge physics,
   but replaces the vehicle model: brakes, creep, gear rules, settling and
   their tests would all need re-tuning. Largest and riskiest.
3. **Invisible collision balls at the wheels.** Free contacts, but they follow
   the body, not the suspension, so they cannot drive the climb; effectively
   half of option 2 with the same tuning risk. Dropped.

The developer picked option 1.

## Decided in conversation

- Wheel stops are a tool: touching is fine.
- Roadside: touch = warning, climbing = fail.
- Option 1 physics approach.

## Calls made in this design (check while reading)

- Curb height 0.11 m (below both ground clearances; first 0.12 m, lowered for
  reverse brake-dive clearance, ruling R12); wheel stop
  0.11 m x ~1.8 m x 0.15 m.
- Edge states and their thresholds as defined in goal 3; side rubbing counts
  as touching.
- Climbing is momentum-only; drive force and creep are not changed.
- Wheel stop `climbing` is silent; only `over` fails.
- Curb-touch count is stored, migrated (old records = 0) and shown on result
  and history-detail screens.
- Driving over a wheel stop fails with a new reason (symmetry with the curb).
- Curb-touch warning is shown on the HUD and counted in the attempt result.
- Wheel stops are excluded from the ultrasonic parking sensors (real sensors
  usually miss low stops; avoids permanent "stop" beeps). Curbs stay as they
  are for sensors.
- Brake lamp threshold: service brake > 0.05. The parking brake alone does
  not light brake lamps.
- Exterior turn signals reuse the dash flash phase.
- Order of delivery (each independently shippable):
  1. wheel spin direction (test, then fix);
  2. exterior lamps (asset candidate + approval gate);
  3. tyre-edge physics + roadside curb height + curb rules;
  4. garage wheel stops + wheel-stop rules.

## Left to the builder

- Number and placement of extra probes per tyre, and the smoothing used for
  support height, provided the anti-goals hold and the flat-ground route
  witnesses are unchanged.
- Whether edge state lives on telemetry or a separate rig accessor.
- (Resolved during planning) Wheel stops are **per-scenario colliders**: the
  stage 1 (nose-in) and stage 2 (reverse) targets share the x=0 bay but need
  the stop at different depths, so one environment placement cannot serve
  both. Art comes from a hidden `WheelStopTemplate` node in the garage GLB,
  cloned by the lesson scene. Placement (stop centre, 1.8 x 0.11 x 0.15 m):
  stage 1 (0, 0.055, -6.70); stage 2 (0, 0.055, -8.60); stage 4
  (5.4, 0.055, -8.60). These are the middle of the windows where both
  vehicles' touching poses lie inside each target with its inset.
- Exact lamp node names (suggested: `BrakeLamps`, `ReverseLamps`,
  `TurnSignalLeft`, `TurnSignalRight`, each with lit and unlit meshes) and
  their geometry, within the asset workflow.
- Message wording for the new warning and failure (`src/messages.ts`).
