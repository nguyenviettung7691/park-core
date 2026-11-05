# Park-Core: Detailed Design

Date: 2026-11-02

Status: Approved by the project owner on 2026-11-02; not an implementation or validated simulation

Scope: Phase 0 of [the technical design](tech-design.md)

## 1. Intent and decision ownership

Park-Core teaches a learner what to do when parking: observe the space, choose
a setup position, maneuver slowly, check clearance, correct when necessary, and
secure the vehicle. It prioritizes believable low-speed behavior and useful
spatial understanding over game scores or photorealism.

### Confirmed with the project owner

- Aim for real-world behavior as closely as the project's constrained engine
  and scope permit.
- Follow Vietnam's right-hand-traffic, left-hand-drive context.
- Deliver learner-facing instructions and controls in Vietnamese.
- Use step-based lessons inspired by intuitive 3D-game tutorials: preparation,
  brief instructions/highlights, learner action, and a recap.
- Use the approved five-stage curriculum and briefing/driving/recap layout below.
- Default to first-person training; retain third-person and top-down aids.

### Designer's calls, subject to approval

- Use generic, front-wheel-drive Sedan and B-segment CUV profiles. Dimensions
  and tuning below are plausible starting points, not manufacturer data.
- Limit the first release to flat, dry surfaces, static obstacles, daylight
  roadside and a baked-lighting garage. Do not simulate traffic or pedestrians.
- Allow normal repositioning without penalty. No countdown, stars or leaderboard.
- Require a full stop, P and the parking brake to finish parking.
- Stop a failed attempt immediately, retain its recap, then reset on Retry.
  This clarifies the technical design's immediate fail/reset rule without
  erasing feedback before the learner can read it.
- Let completion with either vehicle unlock the next stage. Both vehicles remain
  selectable in every unlocked stage; vehicle choice is not a second curriculum.
- Offer requested help throughout; later lessons reduce unsolicited prompts,
  not safety warnings or access to aids.

### Goals, non-goals and anti-goals

| Category | Definition |
|---|---|
| Learning goals | Understand setup, gear changes, slow control, vehicle sweep, observation and safe correction in forward-bay, reverse-bay and parallel parking |
| Functional goals | Two vehicle profiles, two environments, five sequential lessons, keyboard and calibrated Gamepad API input, mirrors, sensors, 360 view and local progress |
| Non-goals | Official Vietnam driving-test reproduction, road-law certification, high-speed handling, clutch/manual shifting, traffic AI, VR, networking, accounts, force feedback |
| Anti-goals | Rewarding speed, pretending an aid guarantees clearance, exact-path grading, claiming a camera turn proves observation, hiding controller or save failures |
| Fidelity limit | Raycast tires, simplified automatic drive, box colliders and approximate mirrors are educational approximations, not a validated driver-training or vehicle-dynamics model |

Real-world instruction and supervised practice remain necessary. Include this
limitation in onboarding, not as an intrusive warning during every step.
Vietnam-specific scenarios are training layouts, not claims about statutory
parking dimensions or the legality of parking at an arbitrary real location.

## 2. Constraints and considered approaches

Keep TypeScript strict, Vite, Three.js, Cannon-es and vanilla HTML/CSS. No UI
framework, dynamic shadows, weather, procedural city, custom graphics pipeline
or heavy architectural layer. Use baked textures, `MeshBasicMaterial`, and
simple unshadowed lights only when needed.

| Approach | Benefits | Tradeoffs | Decision |
|---|---|---|---|
| Typed, step-based lessons and explicit checkpoints | Small, inspectable state machine; short instructions; straightforward recap and tests | Authors must allow multiple valid maneuvers rather than one exact trajectory | Chosen by owner |
| Authored driving demonstration, then practice | Shows a complete maneuver before attempting it | Believable recordings/animations for two vehicles and different setups require additional authoring | Not in first release |
| Continuous contextual coach | Flexible hints during arbitrary driving | Inferring intent and giving reliable corrections is much harder; risks contradictory advice | Not in first release |

Use plain lesson data and a small set of explicit checkpoint predicates, not a
generic workflow engine, scripting language or generative instructor. Sensor
warnings remain continuous and independent of lesson instructions.

The existing technical design's implementation phase numbering remains
authoritative for its planning documents. The repository instructions number
only implementation phases, so their Phase 1 corresponds to technical-design
Phase 2. This document covers technical-design Phase 0 only.

## 3. Runtime boundaries and update order

Use one physics world, one active vehicle, one loaded environment, one WebGL
renderer and DOM overlays. The application owns the lifecycle; systems exchange
typed input, telemetry and events rather than reading each other's DOM.

| Boundary | Responsibility |
|---|---|
| Application/session | Menu, loading, briefing, playing, pause, outcome and retry transitions; resource ownership |
| Input | Keyboard, selected controller, calibration, edge-triggered actions and normalized commands |
| Vehicle | Physics profile, Ackermann steering, engine/brake commands, wheel transforms and telemetry |
| Environment | GLB visuals, authoritative box-collider metadata, bounds, spawn and target definitions |
| Guidance/progression | Current lesson step, checkpoint evaluation, parking validation, recap and unlocks |
| Views | Driver/chase cameras, mirror RenderTargets, top-down viewport, trajectory visualization |
| Sensors/audio | Physics ray sampling, proximity classification and audio scheduling |
| HUD/storage | Vietnamese DOM presentation, settings and versioned local progress |

These are responsibilities, not a requirement for one class or file per row.
The implementation plan chooses small files with clear ownership; no ECS,
event-bus framework or dependency-injection container is required.

### Time and event rules

1. Poll input once per animation frame and cache normalized state. Queue discrete
   actions once; do not repeat gear changes for every physics substep.
2. Consume actions, derive steering and forces, then advance physics using an
   explicit accumulator at `h = 1 / 120 s`, at most eight steps per rendered frame.
3. After each physics step, process failure contacts/bounds first, then lesson
   checkpoints and parking success. Failure wins over success in the same step.
4. Sample sensors at 20 Hz of simulation time; publish telemetry after stepping.
5. Render interpolated chassis/wheel poses and cameras. Update DOM at up to
   20 Hz except immediate state changes; update mirrors at no more than 15 Hz.

Keep previous/current transforms for interpolation; derive all visual vehicle
parts from the same interpolated pose. Do not render current wheels against a
previous chassis. Refresh Cannon wheel transforms after stepping, but retain
contact information needed by telemetry before render-only transform updates.

Clamp incoming wall-clock delta to 0.1 s. If eight substeps cannot consume the
accumulator, discard excess backlog, record the overrun and show a performance
notice if recurring. Never increase `h` or launch catch-up loops indefinitely.
Do not assert bit-identical replay across browsers.

Pause on tab hiding, window blur, controller loss or lost required pointer lock.
Clear held inputs and the accumulator; suspend lesson clocks and audio. Resume
requires explicit user action and neutral pedals. No catch-up movement on return.

## 4. Units, axes and vehicle geometry

Use meters, kilograms, seconds and radians internally. HUD speed is km/h.
Three.js and Cannon use the same world coordinates: Y up; vehicle-local X right,
Y up, **-Z forward**. Positive steering input means left. Wheel order is always
front-left, front-right, rear-left, rear-right.

Set `indexRightAxis = 0`, `indexUpAxis = 1`, `indexForwardAxis = 2`,
`directionLocal = (0, -1, 0)`, `axleLocal = (1, 0, 0)`. With this convention,
positive steering values turn left and positive engine force drives forward.
The adapter must verify those signs with the pinned Cannon-es version.
Compute signed longitudinal speed as velocity dotted with the chassis's
world-transformed `(0, 0, -1)`; do not use Cannon's +Z speed sign directly.

The physics body origin is the center of mass (COM). Visual origins, collider
offsets, axle locations, sensor positions and camera anchors are relative to
that origin. Do not move COM by silently offsetting only the rendered mesh.

### Initial profile targets

| Parameter | Sedan | B-segment CUV |
|---|---:|---:|
| Mass, including nominal driver, kg | 1,450 | 1,400 |
| Body length / width / height, m | 4.60 / 1.80 / 1.45 | 4.35 / 1.80 / 1.62 |
| Width including mirrors, m | 2.04 | 2.06 |
| Wheelbase L / track T, m | 2.70 / 1.56 | 2.61 / 1.55 |
| Front / rear overhang, m | 0.90 / 1.00 | 0.85 / 0.89 |
| Front static weight fraction f | 0.55 | 0.58 |
| Ground clearance / COM height, m | 0.15 / 0.52 | 0.18 / 0.62 |
| Tire effective radius, m | 0.31 | 0.33 |
| Driver eye height above ground, m | 1.12 | 1.30 |
| Steering-wheel lock, each side | 540 degrees | 540 degrees |
| Steering ratio, wheel angle / virtual road-wheel angle | 16:1 | 16:1 |
| Virtual road-wheel lock, each side | 33.75 degrees | 33.75 degrees |
| Maximum total driven-wheel force, N | 2,400 | 2,600 |
| D / R idle-creep target, m/s | 0.83 / 0.56 | 0.83 / 0.56 |

Use front axle Z `= -(1-f)L`, rear axle Z `= fL`, wheel X `= +/- T/2`.
Body front extent from COM is `(1-f)L + frontOverhang`; rear extent is
`fL + rearOverhang`. Offset the body's box center accordingly; do not assume
equal overhangs or a centered COM.

Use a box from ground-clearance height to roof height, with the body's length
and width, plus small side-mirror boxes for conservative clearance/contact.
Do not include the air gap below the body in the chassis collider. Wheel rays
support the chassis; visible wheels are not additional colliding rigid bodies.
The full horizontal envelope, including mirrors, is used for parking completion.

Driver eye X begins at -0.36 m; eye Z begins 0.25 m behind the front axle.
Mount at `eyeHeight - COMHeight` locally. Final cockpit fit, mirror placement
and sightlines must be checked against the actual meshes, not only these numbers.

### Ackermann steering

Normalize steering-wheel input to `s` in `[-1, 1]`, positive left. The virtual
center-wheel angle is `delta = s * wheelLockRad / steeringRatio`.

For `abs(delta) < 0.0001`, both front angles are zero. Otherwise:

```text
R = L / tan(abs(delta))
inner = atan(L / (R - T/2))
outer = atan(L / (R + T/2))

left turn:  frontLeft = +inner; frontRight = +outer
right turn: frontLeft = -outer; frontRight = -inner
rearLeft = rearRight = 0
```

Validate `R > T/2` at maximum lock. Expected rear-axle-center turning radii
are approximately 4.04 m for the Sedan and 3.91 m for the CUV; these are not
curb-to-curb or wall-to-wall turning radii.

Keyboard steering ramps at one normalized unit/s, recenters at 1.5 units/s,
and cancels simultaneous left/right input to zero. A calibrated wheel maps
directly without keyboard auto-centering; allow a small configurable filter,
but no automatic speed-dependent steering or artificial countersteer.
The keyboard is a training-access fallback, not equivalent to a real wheel.

## 5. Physics and automatic drivetrain

### World and wheel starting values

Gravity is `(0, -9.81, 0)`. Use a broadphase appropriate for static boxes,
10 solver iterations and solver tolerance 0.001 as initial values. Environment
boxes are static; restitution is zero. Keep geometry near the world origin.

| Cannon-es setting | Sedan | CUV |
|---|---:|---:|
| Suspension rest length, m | 0.30 | 0.34 |
| Suspension maximum travel, m | 0.14 | 0.16 |
| `suspensionStiffness`, front / rear | 36 / 30 | 36 / 28 |
| `dampingCompression` / `dampingRelaxation` | 4.4 / 2.3 | 4.8 / 2.5 |
| `maxSuspensionForce`, per wheel, N | 18,000 | 18,000 |
| `frictionSlip` | 1.4 | 1.4 |
| `rollInfluence` | 1.0 | 1.0 |
| Chassis contact friction coefficient | 0.6 | 0.6 |
| Rolling-resistance coefficient | 0.015 | 0.015 |
| Body linear / angular damping | 0.01 / 0.05 | 0.01 / 0.05 |

These are **unvalidated tuning seeds**, not measured tire/suspension properties.
Cannon's raycast tire `frictionSlip` is not a real tire friction coefficient,
and wheel-ground tire behavior is not controlled by chassis contact friction.
Do not copy the stiff toy-car defaults from examples and call them calibrated.

In Cannon's suspension implementation the spring/damper expression is multiplied
by the entire chassis mass. On flat ground at rest:

```text
frontWheelLoad = mass * g * f / 2
rearWheelLoad  = mass * g * (1-f) / 2
compression   = wheelLoad / (mass * suspensionStiffness)
mountLocalY   = tireRadius + restLength - compression - COMHeight
```

Derive front/rear mounting heights separately. Initial static compression is
approximately 0.075/0.074 m for the Sedan and 0.079/0.074 m for the CUV.
Treat stiffness/damping as engine parameters, not directly as N/m and N*s/m.
Settle each spawn off-screen on its ground contacts, then clear transient
velocities and establish the initial lesson pose before enabling controls.

### Drive and brake rules

Only the front wheels receive engine force; split total force equally.
No RPM, torque converter, gear ratios or shift schedules are modeled.
All forces are applied through the vehicle/physics adapter, never by directly
advancing position or setting a desired speed every frame.

- In D, throttle produces forward force; in R, reverse force. Start with a
  linear pedal-to-force map, tapered from full force at 12 km/h to zero at
  15 km/h. This is a declared low-speed simulation envelope, not a real
  vehicle governor. Do not truncate velocity at that threshold.
- With no throttle, no brake and released parking brake, below the D/R creep
  target use `F = clamp(mass * (1.0/s * (targetSpeed - directionalSpeed)
  + 0.015 * g), 0, mass * 0.5 m/s²)`. The second term compensates modeled
  rolling resistance. Apply only in the selected direction and never use
  this controller to brake an overspeed vehicle. Releasing throttle at or
  above creep speed means coasting.
- Rolling resistance opposes horizontal motion with up to `0.015 * mass * g`
  total force, capped so it cannot reverse velocity in one fixed step.
- Any brake input above 0.02 inhibits propulsion, including creep. N has no
  propulsion. The parking brake inhibits propulsion in all gears.
- Service-brake target maximum deceleration is 5 m/s² on dry level ground.
  Allocate 60% to the front axle and 40% to the rear; pedal input scales it.
  Actual stopping performance must be measured and tuned.
- Convert desired per-wheel braking force to Cannon's `setBrake` impulse limit
  using `brakeImpulse = wheelBrakeForce * h`. The current engine implementation
  uses this value as a per-step impulse bound; do not label it wheel torque.
  Phase 3's measured four-wheel low-speed instability required an owner-approved,
  version-specific grounded-wheel correction in the adapter; see the
  [phase design](phase-3-detail-design.md#approved-engine-correction) and
  [measurements](phase-3-measurements.md). Brake-force budgets and acceptance
  thresholds are unchanged.
- P applies a holding brake to all wheels, without freezing the entire rigid
  body. The parking brake applies rear-wheel holding brakes. Begin with a
  total holding-force budget of `mass * g` for each mechanism and use the
  largest applicable per-wheel brake demand, not their sum.

### Gear changes and securing the vehicle

Start each attempt in P with the parking brake applied. Accept a gear change
only at total speed below 0.1 m/s with brake input at least 0.2. Reject invalid
requests with Vietnamese feedback; never queue them for a surprise later shift.
Selecting R/D does not release the parking brake.

Keyboard gear commands select P, R, N and D explicitly. Controller shoulders
request R and D explicitly rather than toggling unpredictably. The driver
manually applies/releases the parking brake. Holding a gear button emits one
request until released.

Opposite-direction motion is physically braked, not teleported into the
requested direction. Training scenes are flat; slope holding, rollback
validation and detailed driveline behavior are outside the first release.

## 6. Input and device behavior

| Action | Keyboard/mouse | Default controller mapping |
|---|---|---|
| Throttle | W / ArrowUp | `buttons[7].value` |
| Service brake | S / ArrowDown | `buttons[6].value` |
| Steer | A/D / ArrowLeft/ArrowRight | calibrated `axes[0]` |
| Select P / R / N / D | Digit1 / Digit2 / Digit3 / Digit4 | DOM gear selector; shoulders request R/D |
| Request reverse / drive | Same explicit gear keys | `buttons[4]` / `buttons[5]` |
| Parking brake | Space, edge-triggered | DOM button, optionally remapped physical button |
| Left / right indicator | Q / E, toggles | DOM buttons, optional remapping |
| Driver / chase camera | C | DOM button |
| Toggle 360 view | V | DOM button |
| Look | Mouse while canvas pointer-locked | Mouse; controller-only camera mapping not required |
| Help / pause | H / Escape | DOM buttons |
| Recenter driver view | DOM button | DOM button |
| Acknowledge lesson step (stopped only) | F, edge-triggered | Same keyboard key; shared discrete |

S is always brake, never an implicit reverse gear. Movement keys act only
while the driving canvas owns input and no editable DOM control is focused.
Discrete keys (Digit1–4, Space, Q/E, F) are shared by both input sources: they
require canvas focus, no modifier, no repeat and a non-editable target, while
continuous throttle, brake and steering stay source-specific.
Prevent page scrolling for relevant driving keys only. HUD controls remain
operable without pointer lock; reacquiring it requires a deliberate canvas click.

### Calibration and arbitration

Request a controller interaction before expecting browser discovery. Use one
selected Gamepad API device and check array lengths and connection state.
The stated axes/buttons mapping is a default for standard-mapped devices,
not a guarantee that every Sim Wheel exposes it.

Before enabling an unfamiliar/nonstandard device, provide a Vietnamese setup
screen to identify steering, brake and throttle controls, including axis-based
pedals, inversion, center and endpoints. Capture released and fully pressed
pedals; map each to `[0,1]`. Reject identical endpoints, missing controls and
non-finite samples with a visible explanation and keyboard fallback.

Steering calibration records center and both locks, applies a 0.02 normalized
dead zone and rescales the remainder. Store calibration locally by reported
controller ID as a convenience, but ask the learner to verify it on reconnect;
the browser ID is not a unique physical-device identity.

> **Phase 3 clarification:** until persistence (Task 7), accepted calibration and the selected device live only in session memory; nothing is stored by controller ID yet.

Select keyboard or a calibrated controller explicitly. Never combine throttle
from one source and steering from another. Mouse and HUD actions remain usable
with either source. Switching source pauses, clears held commands and requires
neutral pedals before resuming.

On disconnect or invalid live input, pause immediately and identify the cause.
Do not keep the last throttle, silently substitute keyboard commands or resume
automatically. Force feedback and universal wheel-driver support are non-goals.

## 7. Cameras, mirrors and trajectory aids

### Driver and chase views

Driver camera uses the vehicle's eye anchor, a fixed initial vertical FOV of
60 degrees and mouse-look bounded to yaw +/-110 and pitch -45 to +35 degrees.
Provide FOV adjustment from 50 to 80 degrees and an explicit recenter action.
No head bob, dynamic FOV or camera shake.

Chase camera starts 5 m behind and 2.5 m above the vehicle, looking toward its
center. Orbit limits keep it above ground. Cast from the look target toward
the desired camera and shorten the arm to the nearest solid hit minus 0.2 m;
use a center ray plus four small-offset rays to reduce corner clipping.
Restore arm length smoothly when clear, but retract immediately.

Mirrors and target/aid placement must remain readable at the supported viewport.
First-person camera position is part of each vehicle profile, not a global offset.

> **Phase 3 clarification:** the physics prototype temporarily uses a fixed external follow camera and no mouse look or pointer-lock acquisition; the driver/chase views above arrive in Phase 4 and the final requirement is unchanged.

> **Phase 4 clarification:** the current prototype's cockpit, driver/mirror anchors and mirror surfaces are temporary geometry, not asset-backed or training-validated visuals. Phase 5 replaces them through the asset pipeline without changing the camera and sensor safety boundaries.

### Three mirrors

Use rearview and two side-mirror cameras, each rendered to a low-resolution
RenderTarget and applied to simple in-cabin/side-mirror plane meshes.
Initial sizes are 512x128 for rearview and 256x256 per side; update each mirror
at most once per 66.7 ms, never run catch-up renders.

Start with 50-degree rearview and 75-degree side-mirror vertical FOVs, then
calibrate camera directions/aspect against actual sightlines. Side mirrors
use a wider-angle planar approximation of convex mirrors; they are not a
physically accurate curved reflection. Warn in onboarding that apparent mirror
distance is approximate.

Verify left/right reflection with labeled landmarks; apply horizontal texture
orientation once, not independently in both camera and material. Mirror views
exclude the driver's head and mirror surfaces to prevent recursion, but retain
appropriate vehicle bodywork as a reference. Refresh before resuming an attempt;
never show a previous scene as a live mirror while assets load.

### Top-down 360 view

Use one orthographic camera above the vehicle, not four stitched cameras.
Start with a 10x10 m ground footprint and a 320x320 CSS-pixel lower-right HUD
viewport. It follows the vehicle, with its forward direction at the top.
Use a non-collinear camera up vector derived from vehicle forward.

Update a small top-down RenderTarget at up to 30 Hz while enabled. The main
view still renders every animation frame; after that pass, composite the
latest top-down texture into a scissored viewport in the same canvas. Place
the DOM frame over exactly the same CSS rectangle and convert to drawing-buffer
pixels for viewport/scissor, accounting for the lower-left WebGL origin.
Retain the texture between updates so main-view clearing never erases the
inset. No GPU readback or second WebGL renderer.

Garage ceiling/upper wall visual meshes use layers excluded only from top-down
rendering. Do not remove their physical colliders. Label the view as a simulated
overhead aid rather than a real vehicle camera reconstruction.

Always restore render target, viewport, scissor, scissor-test, clear state and
camera/layer state after auxiliary passes. A simple render pass owner should
control this; systems must not leave the renderer pointed at a mirror.

### Highlights and trajectory

Use purple ground outlines and a short static label for the current relevant
setup/target area. Never highlight every future step simultaneously.
Use simple flat meshes/lines slightly above ground; avoid custom shaders.

When enabled, predicted trajectories are sampled bicycle-model curves from
the rear-axle midpoint using current steering and gear, extending at most 3 m
or to the first predicted envelope-obstacle overlap. At zero steering use a
straight line. Show both rear-wheel reference paths and a conservative swept
body envelope including front overhang, not a centerline advertised as clearance.

This is a low-speed geometric aid: it ignores slip and future steering changes.
Label it an estimate. It is not auto-steering, a guaranteed safe path or the
grading reference. Mirror/camera aids and highlights may be toggled freely.

## 8. Bumper sensors and audio

Use physics-world raycasts, not render-mesh intersections. Cast five rays per
bumper at local yaw offsets -60, -30, 0, +30 and +60 degrees from forward/rearward
directions, with origins distributed across the bumper width. Start at the
bumper surface, 0.45 m above ground; exclude the learner's vehicle and
non-solid lesson markers. Use nearest hits, including curbs only when they
actually intersect the ray; no-hit is `null`, not zero or a fabricated distance.

Ray coverage has gaps, misses some low obstacles and does not cover the
vehicle's full side sweep. Explain these limitations; sensors never authorize
a maneuver or replace observation. Targets remain non-colliding.

| Measured distance | Sensor indication | Beep interval |
|---|---|---|
| No hit within 2.5 m | Neutral/no warning | Silent |
| >1.2 m and <=2.5 m | Green + distance | 1.0 s |
| >0.6 m and <=1.2 m | Yellow + distance | 0.5 s |
| >0.3 m and <=0.6 m | Red + distance | 0.2 s |
| <=0.3 m | Red + STOP text | Continuous tone |

Enter a closer band immediately; leave it only after an extra 0.05 m clearance
to prevent flicker. Keep the minimum sample for each front/rear sector and
use the nearest warning for one audio stream; prioritize the current travel
direction on equal distances. Show front/rear labels so color is not the only cue.

Create/unlock the AudioContext on a deliberate Start interaction. Use a simple
short oscillator beep with adjustable volume and mute, no speech synthesis or
asset-heavy sound design. Stop audio on pause, outcome and scene disposal.
If audio is unavailable or blocked, show a nonblocking Vietnamese notice and
retain full visual warnings. Muting does not remove visible warning information.

## 9. Environments and five lessons

Vietnam context is expressed through right-hand circulation, left-hand-drive
cars, metric labels and roadside parking on the right in the direction of
travel. No traffic actors or official-test markings are required.

| Stage | Environment and maneuver | Instruction focus | Guidance |
|---|---|---|---|
| 1 | Garage; forward into a wide 3.0x6.0 m bay | P/brake/parking-brake sequence, creep, steering, stopping and securing | All step prompts; setup/target highlight |
| 2 | Garage; reverse into a 2.8x5.5 m bay | Approach, stop before selecting R, observe, reverse, straighten | Full prompts and optional trajectory |
| 3 | Roadside; reverse-parallel into a 7.0 m long, 2.5 m wide space | Signal right, establish setup, understand rear entry/front swing, correct and align | Full prompts with one highlighted reference at a time |
| 4 | Garage; reverse into a 2.6x5.3 m bay near pillars | Monitor side/front sweep, pause and reposition rather than force entry | Shorter prompts; help available |
| 5 | Roadside; parallel into a 6.5 m long, 2.5 m wide space with a different authored approach | Recall the sequence and adapt positioning | Briefing and goal by default; step help on request |

All dimensions are designer-selected training geometry, not regulatory minima.
Bay width includes a clearance allowance for mirrors. Target heading specifies
which way the parked car faces; an anti-parallel car does not pass.

Author scene layouts in local scenario coordinates. Maintain at least a 6 m
clear garage aisle and 3.5 m clear roadside maneuvering lane for these lessons.
Place static vehicles before/after parallel targets and pillars outside bay
boundaries; preserve a demonstrably feasible path for both vehicle profiles.
Use a level curb; target the parked body's curb-side gap at 0.15-0.30 m.
Validate this interval alongside full target containment.

Every definition includes a fixed spawn, allowed driving bounds, target pose,
parking bounds, any setup checkpoint regions and solid obstacle identifiers.
Stage 5 uses a second authored layout, not untested random generation.
Environment art may be shared; scenario colliders/targets come from explicit
metadata, not runtime inference from mesh names or visual bounding boxes.

### Lesson steps and checkpoints

The briefing identifies the maneuver, learning goal and main hazards. The
learner explicitly starts; no movement happens behind a briefing dialog.

A typical reverse-bay sequence is:

1. Observe the target and approach at walking speed.
2. Enter a generous setup region and stop.
3. Read the reminder to check surroundings, then confirm readiness.
4. With brake held, select R and release the parking brake if still applied.
5. Reverse toward the bay; pause and correct as needed.
6. Align, stop fully inside the target, apply the parking brake and select P.
7. Read the recap; retry or continue after success.

The step checker evaluates measurable state only: region, heading interval,
stationary dwell, gear, indicator and parking brake. Observation instructions
use an explicit acknowledgement while stopped. Record that acknowledgement,
not a claim that the learner actually looked for hazards.

Setup regions are broad suggestions. Add an alternative advance condition
when the learner already reaches the later maneuver region safely; do not
force them to leave a valid parking position to hit a missed tutorial marker.
Any valid final park can complete a lesson even when advisory steps were skipped.
Recap skipped acknowledgements as "not confirmed", never as observed negligence.

No exact steering timing, invisible ideal path or fixed number of corrections
is mandatory. A stopped learner can open Help to reread the current action and
reveal its highlight. Help does not steer, move the vehicle or disable collisions.

## 10. Outcome rules, recap and progression

### Successful parking

Evaluate these conditions together after each physics step:

- All four corners of the conservative horizontal vehicle envelope, including
  mirrors, lie within the oriented target rectangle inset by 0.05 m.
- Heading error to the target is no more than 5 degrees, wrapped at +/-pi.
- Total linear speed is below 0.1 m/s and angular speed below 0.05 rad/s.
- Gear is P and parking brake is applied.
- For roadside stages, curb-side body gap lies in the authored 0.15-0.30 m range.
- No failure has occurred.

Require these conditions continuously for 2.0 simulation seconds. Reset the
dwell immediately if any condition becomes false. Do not use a center point
or world-axis-aligned bounding box alone. Containment uses the vehicle's
actual planar pose, including unequal front/rear COM extents.

### Failure and reset

Any solid chassis/mirror contact with an obstacle, parked vehicle or curb
immediately fails the attempt. Normal wheel-ground support and non-solid
markers are excluded; ground contact by the chassis is a failure.
Because raycast wheels have no solid tire colliders, add explicit wheel-side/
curb clearance checks against authored curb boxes so wheels cannot silently
clip through a curb. They cause failure, not a simulated curb climb.

Leaving the scenario's allowed bounds, tipping more than 30 degrees, or
exceeding 15 km/h for one simulation second also fails the attempt.
The speed boundary is a training-scope constraint, not a Vietnamese legal limit.
Non-finite physics state is an application error, not a learner collision.

> **Phase 3 clarification:** the physics prototype has no attempt or lesson. A chassis/mirror/ground contact there is a non-lesson laboratory stop (only Reset/Menu continue), not `AppState.fail`, a recap or progression. The final curriculum failure rules above are unchanged.

On failure: zero requested controls, stop stepping the attempt, stop audio,
capture the first reason and relevant obstacle, then show Fail/recap. Retry
rebuilds attempt state and settles at the original spawn. Do not clear the
reason on contact separation or carry steering, gear actions or sensor history
into the new attempt.

### Recap

Present the correct maneuver sequence plus observations actually collected:
outcome, first failure reason, closest sampled clearance, peak speed,
number of direction changes/repositionings and requested aids. A direction
change counts only after movement above 0.2 m/s changes sign; stationary gear
button presses do not count as corrections.

Corrections are normal and not deductions. Do not infer unsampled clearances,
eye movements, legal competence or real-world readiness from telemetry.
No video replay or full time-series storage is required.

### Application states

```text
Menu -> Loading -> Briefing -> Playing -> Success / Fail
                              Playing <-> Paused
Success -> next unlocked lesson / retry / Menu
Fail    -> retry / Menu
Any recoverable loading/runtime error -> Error -> retry loading / Menu
```

Success/Fail contain the recap; they are not states that auto-dismiss. Only
Success unlocks the next stage. Previously completed stages remain replayable.
Completing stage 5 shows curriculum completion without promising driving mastery.

Phase 2 clarification ([phase design](phase-2-detail-design.md)): a static,
non-drivable inspection preview is a shell view flag (`PreviewPhase`) beside
`AppState`, not an `AppState`; `state` stays `menu` while it runs or pauses.

### Local persistence

Use a versioned key `park-core.progress.v1`, storing completed stage IDs and
last selected vehicle; derive the highest unlocked stage from the contiguous
completed prefix. Save on success, never per frame. Validate parsed values
from `unknown`, filter to known IDs, and do not trust stored unlock numbers.

Use separate versioned settings and controller-calibration keys. Do not persist
active motion, in-progress attempts, raw controller samples or personal data.

Missing data means a new learner. Malformed JSON or an unsupported version
shows a recovery notice and offers an explicit reset; do not silently erase it.
Allow session-memory play but suspend progress writes until the learner
explicitly resets the unreadable save, so a later success cannot overwrite it.
If storage is unavailable or quota is exceeded, continue with session-memory
progress and clearly state it will not survive closing the tab. A failed save
must not be shown as successful. Reset requires confirmation and removes only
the selected Park-Core record key, not unrelated localStorage data.

**Phase 5 implementation clarification:** progress, settings, and controller
calibration use separate versioned keys and key-specific recovery/reset. The
typed confirmed-stage-success boundary is called only after measured lesson
success. The Phase 6 implementation adds five lessons, parking evaluation,
completed-attempt history and retries; free drive cannot award completion.
See the [Phase 5 detail design](phase-5-detail-design.md), [Phase 6 detail
design](phase-6-detail-design.md) and [Phase 6 implementation plan](phase-6-implementation-plan.md).
Software acceptance does not establish training readiness or pending release
validation.

## 11. TypeScript boundary contracts

These are design contracts, not production implementation. Keep numeric ranges
and units enforced at input/config/storage boundaries; TypeScript `number`
alone does not validate them. Runtime snapshots are read-only to consumers.

```ts
type VehicleId = 'sedan' | 'cuv';
type EnvironmentId = 'roadside' | 'garage';
type StageId = 1 | 2 | 3 | 4 | 5;
type Gear = 'P' | 'R' | 'N' | 'D';
type CameraMode = 'driver' | 'chase';
type InputSource = 'keyboard' | 'gamepad';
type Indicator = 'off' | 'left' | 'right';
type SensorBand = 'clear' | 'green' | 'yellow' | 'red' | 'stop';
type MessageKey = string;
type Vec3Data = readonly [number, number, number];
type QuatData = readonly [number, number, number, number];
type WheelValues = readonly [number, number, number, number];

interface BodyPose {
  readonly positionM: Vec3Data;
  readonly rotation: QuatData;
}

interface SpawnPose {
  readonly positionM: Vec3Data;
  readonly yawRad: number;
}

interface InputFrame {
  readonly source: InputSource;
  readonly steering: number;
  readonly throttle: number;
  readonly brake: number;
}

type InputAction =
  | { readonly type: 'request-gear'; readonly gear: Gear }
  | { readonly type: 'toggle-parking-brake' }
  | { readonly type: 'set-indicator'; readonly indicator: Indicator }
  | { readonly type: 'set-camera'; readonly mode: CameraMode }
  | { readonly type: 'toggle-360' }
  | { readonly type: 'recenter-view' }
  | { readonly type: 'acknowledge-step' }
  | { readonly type: 'help' }
  | { readonly type: 'pause' };

interface VehicleProfile {
  readonly id: VehicleId;
  readonly massKg: number;
  readonly bodySizeM: Vec3Data;
  readonly mirrorWidthM: number;
  readonly wheelbaseM: number;
  readonly trackM: number;
  readonly frontOverhangM: number;
  readonly rearOverhangM: number;
  readonly frontWeightFraction: number;
  readonly groundClearanceM: number;
  readonly centerOfMassHeightM: number;
  readonly tireRadiusM: number;
  readonly driverEyeLocalM: Vec3Data;
  readonly steeringWheelLockRad: number;
  readonly steeringRatio: number;
  readonly suspensionRestLengthM: number;
  readonly suspensionTravelM: number;
  readonly suspensionStiffness: WheelValues;
  readonly dampingCompression: number;
  readonly dampingRelaxation: number;
  readonly maxSuspensionForceN: number;
  readonly frictionSlip: number;
  readonly rollInfluence: number;
  readonly chassisFriction: number;
  readonly rollingResistance: number;
  readonly linearDamping: number;
  readonly angularDamping: number;
  readonly maxDriveForceN: number;
  readonly creepForwardMps: number;
  readonly creepReverseMps: number;
}

interface VehicleTelemetry {
  readonly simulationTimeS: number;
  readonly vehicleId: VehicleId;
  readonly pose: BodyPose;
  readonly headingRad: number;
  readonly signedSpeedMps: number;
  readonly totalSpeedMps: number;
  readonly angularSpeedRadps: number;
  readonly steeringWheelRad: number;
  readonly frontWheelAnglesRad: readonly [number, number];
  readonly gear: Gear;
  readonly parkingBrake: boolean;
  readonly indicator: Indicator;
  readonly brake: number;
}

type SensorId =
  | 'front-left-outer' | 'front-left' | 'front-center'
  | 'front-right' | 'front-right-outer'
  | 'rear-left-outer' | 'rear-left' | 'rear-center'
  | 'rear-right' | 'rear-right-outer';

interface SensorReading {
  readonly id: SensorId;
  readonly distanceM: number | null;
  readonly obstacleId: string | null;
  readonly band: SensorBand;
}

interface SensorSnapshot {
  readonly sampledAtS: number;
  readonly readings: readonly SensorReading[];
}

interface OrientedRegion {
  readonly centerM: Vec3Data;
  readonly halfWidthM: number;
  readonly halfLengthM: number;
  readonly headingRad: number;
}

type Checkpoint =
  | { readonly kind: 'region'; readonly regionId: string }
  | { readonly kind: 'heading'; readonly targetRad: number;
      readonly toleranceRad: number }
  | { readonly kind: 'stopped'; readonly dwellS: number }
  | { readonly kind: 'gear'; readonly gear: Gear }
  | { readonly kind: 'parking-brake'; readonly applied: boolean }
  | { readonly kind: 'indicator'; readonly value: Indicator }
  | { readonly kind: 'acknowledgement' };

interface LessonStep {
  readonly id: string;
  readonly instructionKey: MessageKey;
  readonly highlightId: string | null;
  readonly required: readonly Checkpoint[];
  readonly alternativeRegionId: string | null;
}

interface ParkingTarget {
  readonly region: OrientedRegion;
  readonly insetM: number;
  readonly headingToleranceRad: number;
  readonly stationaryDwellS: number;
  readonly curbId: string | null;
  readonly curbGapRangeM: readonly [number, number] | null;
}

interface ScenarioDefinition {
  readonly stageId: StageId;
  readonly environmentId: EnvironmentId;
  readonly titleKey: MessageKey;
  readonly spawnByVehicle: Readonly<Record<VehicleId, SpawnPose>>;
  readonly drivingBounds: OrientedRegion;
  readonly regions: Readonly<Record<string, OrientedRegion>>;
  readonly target: ParkingTarget;
  readonly steps: readonly LessonStep[];
  readonly guidance: 'full' | 'reduced' | 'on-request';
}

type FailureReason = 'collision' | 'curb-contact' | 'out-of-bounds'
  | 'tipped' | 'speed-envelope';

interface AttemptSummary {
  readonly stageId: StageId;
  readonly vehicleId: VehicleId;
  readonly outcome: 'success' | 'fail';
  readonly failureReason: FailureReason | null;
  readonly obstacleId: string | null;
  readonly elapsedSimulationS: number;
  readonly closestSampledClearanceM: number | null;
  readonly peakSpeedMps: number;
  readonly directionChanges: number;
  readonly acknowledgedStepIds: readonly string[];
  readonly usedAids: readonly ('chase' | '360' | 'trajectory' | 'help')[];
}

interface LessonRuntime {
  readonly stageId: StageId;
  readonly stepIndex: number;
  readonly parkingDwellS: number;
  readonly acknowledgedStepIds: readonly string[];
}

interface ProgressSaveV1 {
  readonly version: 1;
  readonly completedStages: readonly StageId[];
  readonly lastVehicle: VehicleId;
}

interface PedalBinding {
  readonly kind: 'axis' | 'button';
  readonly index: number;
  readonly released: number;
  readonly pressed: number;
}

interface ControllerCalibration {
  readonly version: 1;
  readonly deviceId: string;
  readonly steeringAxis: number;
  readonly steeringLeft: number;
  readonly steeringCenter: number;
  readonly steeringRight: number;
  readonly throttle: PedalBinding;
  readonly brake: PedalBinding;
  readonly reverseButton: number;
  readonly driveButton: number;
}

type AppState =
  | { readonly kind: 'menu' }
  | { readonly kind: 'loading'; readonly stageId: StageId }
  | { readonly kind: 'briefing'; readonly stageId: StageId }
  | { readonly kind: 'playing'; readonly lesson: LessonRuntime }
  | { readonly kind: 'paused'; readonly lesson: LessonRuntime;
      readonly reason: 'user' | 'focus' | 'controller' | 'input-source' }
  | { readonly kind: 'success'; readonly summary: AttemptSummary }
  | { readonly kind: 'fail'; readonly summary: AttemptSummary }
  | { readonly kind: 'error'; readonly messageKey: MessageKey;
      readonly retryable: boolean };
```

The lesson runner treats `required` as an AND of checks and advances at most
one step per fixed update. Acknowledgements latch only for the current step;
physical conditions are checked in that update. An alternative region may
advance an advisory step only without an active failure. Final parking success
is evaluated independently of advisory step completion.

Use finite tuples consistently: body size is X width, Y height, Z length.
Store quaternion components in X/Y/Z/W order. Validate nonzero normalized
quaternions and all profile/region dimensions when loading configuration.
Message keys become a finite key union from the Vietnamese message dictionary
during implementation; no arbitrary HTML is permitted as message content.

## 12. UI/UX blueprint

All learner copy is Vietnamese, including errors, calibration, tooltips and
recaps. Keep technical design and code identifiers in English. Use a central
message dictionary with parameterized values; a language switch and translation
framework are unnecessary for the first release.

```text
body
  #app
    canvas#simulation
    #hud
      header#lesson-strip        current action, step count, Help
      #proximity-front          labeled front warning arcs
      #proximity-rear           labeled rear warning arcs
      #telemetry                speed, gear, brake/indicator state
      #view-controls            camera, 360, trajectory, recenter
      #overhead-frame           label/border around canvas inset
      #status-message           gear/input/audio/save feedback
    #screen-layer
      menu / calibration / loading / briefing / pause / recap / error
```

Use semantic buttons and native dialogs where appropriate, not click handlers
on decorative divs. `#hud` is a full-screen CSS Grid with named areas: lesson
across the top; warnings at front/rear center; telemetry bottom-left; view
controls bottom-center; overhead bottom-right. Pointer events pass through
noninteractive HUD areas; buttons opt back in.

During driving, keep one short action visible, not a paragraph. Example:
“Dừng hẳn, giữ phanh rồi chọn số R.” Briefing provides the goal and a simple
diagram; recap explains the sequence and measured result. The failed-attempt
message names the obstacle where available instead of only saying “Thất bại”.

At 1280x720 and larger, keep telemetry and instruction text at least 16 CSS px,
use 44x44 px controls, and keep the 360 inset from obscuring the action strip
or proximity warnings. On smaller desktop windows, collapse optional view
controls into a labeled menu and reduce/hide the optional inset with an
explanation; do not hide gear/speed or critical warnings. Mobile driving is
not a first-release target.

Phase 2 clarification: before their feature exists, HUD containers may be
present but empty and `hidden`, with no placeholder values. The menu entry to
the preview reads “Xem thử mô hình (không lái được)”, the exit “Quay lại menu”,
and a visible badge “Bản xem thử — không lái được”; “Bắt đầu” returns when a
drivable session exists.

### Visual tokens and accessibility

| Token | Value/use |
|---|---|
| Background | `#151318` |
| Panel | `#211D25`, opaque enough to remain readable over bright scenes |
| Main text | `#F5F3F6` |
| Secondary text | `#D0C8D6` |
| Accent | `#9B59B6` for selected state, target and trajectory |
| Light accent | `#D5B1E3` for small accent text and focus outlines |
| Sensor-only colors | Green `#66CC88`, yellow `#FFE066`, red `#FF6B6B` |

Do not use blue, orange or green as the main UI accent. Sensor colors are the
explicit exception. Check actual text/background contrast; do not assume
purple works for small text on every surface. Pair warnings with labels,
distance and shape, not color alone.

Allow keyboard navigation and visible focus. Move focus into modal screens,
return it on close, and prevent driving actions while a modal owns input.
Use polite live announcements for discrete lesson-step/result/error changes,
not 20 Hz speed or distance updates. Honor reduced motion; avoid flashing
highlights. Support mute and volume independently of visual warnings.
The visual nature of 3D driving is not a claim of full nonvisual accessibility.

## 13. Assets and rendering budget

Define authoritative profile/scenario data separately from GLB files. Export
vehicle meshes in meters with applied transforms; align visual forward to -Z,
up to +Y and origin to the profile COM. Supply named driver/mirror anchors,
separate wheel nodes and a minimal cockpit that supports useful mirror checks.
Do not rely on an exterior-only model for first-person training.

Use glTF 2.0 binary GLB. The Blender exporter handles its Z-up to glTF Y-up
conversion; verify with an axis/reference-size test asset and never apply the
conversion a second time in runtime code. Use pre-baked lighting/base textures
with ordinary supported materials, avoiding an additional lighting pass that
double-lights already baked artwork. Mark color textures with the appropriate
color space and keep data maps linear.

Initial content budgets: active environment <=150k triangles, vehicle/cockpit
<=50k triangles, main view <=150 draw calls, maximum 2048px texture dimension
except a measured need, and compressed transferred assets <=20 MB for the
initial selected scene. These are authoring budgets to verify, not current
measurements. Avoid special compression decoders until a measured need justifies
their deployment complexity.

Load only the selected environment/vehicle before Briefing. Show progress when
computable, otherwise an honest loading indication. Asset failure names the
failed resource category and provides Retry/Menu; do not continue a training
scene with missing colliders or silently replace a required cockpit.
Development boxes may be explicitly labeled prototypes, never validated content.

Only one active session owns its geometries, materials, textures, RenderTargets,
listeners and audio. Dispose/reuse them deliberately on retry/menu/scene changes;
do not accumulate new physics callbacks or WebGL contexts on each attempt.
Pause on WebGL context loss and offer reload/recovery rather than running blind.

**Phase 5 asset clarification:** the current four GLBs are deterministic
low-poly prototypes using static vertex colors, not image-based baked textures
or production vehicle art. Measured file sizes and triangle counts are in the
[asset pipeline report](asset-pipeline.md); sightline, clearance and hardware
validation remain pending.

Phase 2 clarification: the drawing buffer is CSS size x `devicePixelRatio`,
scaled uniformly by `min(1, 2560/w, 1440/h)`, each side rounded and at least 1
px. Missing WebGL2 offers only Menu; context loss is recovered by building a
new renderer on a fresh canvas, not by in-place restoration.

### Performance target and evidence

1440p at 144 Hz is an aspiration, not a guaranteed minimum on every supported
computer. The frame budget is approximately 6.94 ms. Start with a drawing
resolution cap of 2560x1440 while preserving aspect; do not blindly multiply
CSS size by an uncapped high-DPI device pixel ratio.

Benchmark the worst garage view with all mirrors, sensors and the overhead aid
enabled. Record CPU, GPU, RAM, OS, browser/version, drawing resolution, refresh
rate and quality settings. Target a 95th-percentile frame interval <=6.94 ms
on a named reference PC; select and record that PC before making a performance
claim. No reference hardware has been supplied yet.

**Approved benchmark criteria (master target).** The measured target is 2560x1440
at 60 Hz: p95 frame interval <=17.5 ms, mean >=57 FPS and zero loss. 144 Hz stays
an optional aspiration. The minimum PC is undetermined and is never inferred from
a reference result.

**Workload v1.** Four fixed cases (Sedan and CUV, each in driver and chase view),
10 s warm-up plus 60 s measurement each (about 5 minutes per browser). Garage
environment, all mirrors, sensors, overhead and trajectory aids on, full
resolution, audio muted, gear P with parking brake, driver FOV 60. Mirrors and
the overhead camera render at their capped rates, so frame intervals sample
those views only on frames where they update.

**Running it.** Open `/benchmark.html` (a separate production entry, not the
learner app) in a focused window at 100% zoom on a 60 Hz display with a
2560x1440 drawing buffer. Enter CPU, GPU, RAM, OS, graphics driver, browser and
refresh rate, confirm zoom, then click to load assets and click again to lock
the pointer. Keep mouse and keyboard still; mouse-look, driving keys, focus or
visibility loss, pointer-lock loss, resize and DPR changes invalidate the case
and it can be retried (at most 20 invalid attempts). Export JSON is available
after any outcome; partial reports are marked incomplete and test-only timing
cannot certify. The page stores nothing in localStorage or IndexedDB and uses
no learner save data.

**Automation boundary (2026-11-05).** Full-duration benchmark measurements and
JSON downloads are manual checks, excluded from the production test suite and
Pages CI. Automated validation retains setup/asset smoke checks, short Chromium
resize interruption, and unit-tested measurement and
report behavior. The manual workload, thresholds and strict timestamp validation
are unchanged; excluding a long test is not a Firefox timing fix or hardware
certification.

Offer a lower-resolution quality option if the target is missed. Do not silently
reduce physics frequency or hide mirrors to claim the full-feature benchmark.
The first release must remain usable at 60 rendered FPS on its eventual declared
minimum PC; that minimum is a validation outcome, not invented here.
Automated browser validation is Chromium-only by owner decision (2026-11-05);
Firefox is excluded from both learner and production suites, not repaired.
Manual Firefox benchmark timing remains unresolved. Test desktop Chromium on
Windows 11 and Linux with
WebGL2 available. Serve production over HTTPS and use localhost for development.
Feature-detect graphics, Gamepad API and storage; browser/device compatibility
claims require results from real hardware.

## 14. Validation and acceptance

No physics or performance numbers in this document have been experimentally
validated. The implementation must provide focused automated tests for pure
logic and repeatable browser/physics checks; choose tooling in the implementation
plan instead of adding it during Phase 0.

| Area | Acceptance evidence |
|---|---|
| Geometry | Asset dimensions, COM-relative axle/eye/collider anchors and mirror envelope match metadata within 0.02 m |
| Steering | Left/right signs correct in D and R; zero input is straight; inner angle exceeds outer at nonzero steering |
| Turning | At <=1 m/s, measured rear-axle path radius agrees with configured bicycle reference within 5% after transient settling |
| Suspension | On flat ground, all four wheels support load; no chassis-ground contact; settle within 3 s without growing oscillation |
| Stability | Remain in P/parking brake on level ground for 60 s with <=0.02 m drift; no non-finite transforms |
| Creep | On level ground, enter target speed +/-0.1 m/s within 6 s; service brake holds against creep without drift |
| Braking | From 5 km/h, full braking stops within 0.5 m after application; force conversion is invariant between rendered frame rates |
| Shift safety | Moving or unbraked requests are rejected and explained; held buttons do not repeat |
| Input | Standard and calibrated axis-pedal mappings work; invalid endpoints/missing controls/disconnect cannot leave throttle active |
| Sensors | Exact band boundaries, no-hit null, self exclusion, hysteresis, mute and directional audio prioritization are correct |
| Visibility | Mirror landmark orientation, front/rear sweep and cockpit sightlines reviewed on both vehicle profiles; ceiling excluded only from overhead visuals |
| Lesson flow | A learner can start, pause, request help, retry and finish all five stages without being trapped by an advisory checkpoint |
| Parking | Rotated targets, mirror/body overhang, heading wrap, curb gap and continuous dwell tested; failure overrides same-step success |
| Failure | Obstacle/curb/wheel-clearance/bounds/speed/tip cases produce one durable reason and clean retry |
| Persistence | New, malformed, unsupported and blocked/quota storage paths have honest visible outcomes; unlocks cannot skip the sequential prefix |
| UI | Vietnamese copy throughout; text/focus legible; DOM input does not drive the car; no HUD overlap at 1280x720 and 2560x1440 |
| Lifecycle | Ten retries and environment switches do not duplicate controls, audio, physics callbacks or retain previous scene views |
| Timing | Comparable creep, steering and stopping at 30/60/144 rendered FPS with fixed physics; blur/hidden-tab resume has no catch-up motion |
| Performance | Recorded reference-PC benchmark with all aids; report frame-time percentiles and physics overruns, not only average FPS |

Also run coached learner walkthroughs: ask a learner to explain the setup,
gear-change, clearance and correction sequence after each maneuver. A park
inside a rectangle alone does not demonstrate the project's learning objective.
Have an experienced Vietnam driving instructor review lesson wording and
observation reminders before release; do not substitute that review with
automated collision tests.

Release delivery (2026-11-04): the Pages workflow must pass `npm ci`, unit
tests, typecheck, build, the development-server browser suite and
`npm run test:production`, which loads the built `dist` and rejects missing or
HTML-substituted JS, CSS and GLB assets. Only a validated `main` run deploys.
Live-domain evidence is a separate, still outstanding release check.

If a parameter fails acceptance, tune and remeasure the related behavior; do
not change the acceptance result to match an unstable simulation. If simplified
engine behavior cannot meet the training requirement, document that limitation
and seek a design decision before adding a new physics architecture.

## 15. Builder discretion and deferred work

The builder may choose small-file organization, test runner, asset URLs,
exact obstacle coordinates within the authored constraints, wording polish,
and reasonable camera/physics tuning that preserves these behaviors.
Record tuned values and measurements alongside the profiles.

Phase 2 designer's call, subject to the owner's approval already recorded in
the phase design: a static non-drivable renderer preview, with `cannon-es`
deferred to Task 2. No lesson, physics or learner-behavior rule changes.

The following are release-validation prerequisites, not unspecified features:
select reference/minimum hardware, obtain suitable licensed cockpit/environment
assets, validate both vehicle profiles and confirm at least one real wheel's
browser mapping. Until then, hardware support and fidelity remain provisional.
An instructor review is required for training-content claims, not for writing
the implementation plan.

Defer official exam content, moving hazards, slopes/wet conditions, force
feedback, manufacturer-specific replicas, replay demonstrations, randomized
parking generation, multilingual UI and online progress synchronization.

The next planning phase may turn this design into isolated implementation
tasks, prompt templates and a precise asset-export checklist. It must not
silently promote draft tuning targets to validated specifications.

## 16. Technical references

- Project requirements: [technical design](tech-design.md) and
  repository instructions at `.github\copilot-instructions.md`.
- Cannon-es `RaycastVehicle` source, especially coordinate defaults,
  `updateSuspension`, `updateFriction` and `setBrake`:
  <https://github.com/pmndrs/cannon-es/blob/master/src/objects/RaycastVehicle.ts>.
- Cannon-es vehicle example (API usage, not validated road-car tuning):
  <https://github.com/pmndrs/cannon-es/blob/master/examples/raycast_vehicle.html>.
- Three.js renderer target/viewport/scissor behavior:
  <https://threejs.org/docs/#WebGLRenderer>.
- Three.js orthographic camera:
  <https://threejs.org/docs/#OrthographicCamera>.

Library references were consulted during drafting. Pin package versions during
scaffolding and recheck engine-sensitive assumptions against those versions.
