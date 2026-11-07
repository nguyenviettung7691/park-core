# Park-Core: Technical Design

## 1. Product and current scope

Park-Core is a browser-based 3D parking simulator for practicing low-speed
maneuvers and spatial awareness. The current prototype supports a tutorial-first
journey, five authored parking lessons, a separate free-drive sandbox, and
local learner progress and attempt history. Learner-facing instructions and
controls are in Vietnamese.

The simulator uses simplified vehicle dynamics, estimated proximity sensors,
authored scenario geometry and generic prototype artwork. It is not an official
driving test or a substitute for qualified instruction or supervised practice.
Software acceptance does not establish learner competence, training
readiness, instructor approval, supported-hardware compatibility or
reference-PC performance.

## 2. Stack and engineering constraints

- **Application:** strict TypeScript and Vite.
- **Rendering:** Three.js with one WebGL renderer and vanilla HTML/CSS DOM
  overlays.
- **Physics:** Cannon-es `RaycastVehicle`, Ackermann steering and explicit
  box colliders for the environments and lesson scenarios.
- **Tests:** Vitest for unit/DOM/physics/asset checks and Playwright for
  Chromium browser and production checks.
- **Runtime:** Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`; dependencies and
  commands are defined in `package.json`.

Keep the renderer, physics loop and UI lightweight. Use static artwork,
vertex-color or unlit materials and simple uncast lights. Do not add dynamic
shadows, weather, procedural cities, custom shaders, a UI framework or a heavy
graphics/architecture layer.

Use Amethyst Purple (`#9B59B6`) for active states, target zones and trajectory
guidance. Reserve green, yellow and red for proximity indicators; do not use
blue, orange or green as the main UI accent.

The approved benchmark target is 2560x1440 at 60 Hz: p95 frame interval
<=17.5 ms, mean >=57 FPS and zero lost simulation time (combined catch-up and
clamp loss). This is a target, not a measured performance guarantee; 144 Hz is
optional and unverified.

The browser target is desktop Chromium with WebGL2 on Windows 11 and Linux.
Automated coverage does not certify compatibility across browsers or hardware.

## 3. Runtime architecture

The application owns session transitions, asset loading, UI and disposal. A
session uses one active vehicle, one environment, one renderer and one
fixed-step simulation loop. Systems exchange typed commands, telemetry and
events rather than reading one another's DOM.

| Boundary | Responsibility |
|---|---|
| Application/session | Menu, loading, onboarding, briefing, pause, outcome, retry and resource lifecycle |
| Input | Keyboard, selected Gamepad API device, calibration, discrete actions and normalized commands |
| Vehicle | Profile-based physics, steering, drivetrain, wheel poses and telemetry |
| Environment/scenario | GLB visuals, explicit collider metadata, bounds, spawn, target and lesson data |
| Lessons/progression | Advisory checkpoints, parking evaluation, failure, recap and success-only unlocks |
| Views | Driver/chase cameras, mirrors, overhead composition and trajectory guidance |
| Sensors/audio | Front/rear ray sampling, proximity classification and optional beeps |
| UI/storage | Vietnamese screens and HUD, settings, progress, calibration and completed-attempt history |

Advance physics at `h = 1 / 120 s`, with at most eight steps per
animation-frame callback and a maximum incoming wall-clock delta of `0.1 s`.
The frame-rate cap gates rendering only; physics continues on callbacks that
skip a render. Poll input once per callback; consume discrete actions once,
not once per physics substep. After each physics step, process failure before
checkpoint and parking success. Pause suspends simulation time and clears held
input; resuming requires an explicit action.

Bound mirror updates to 15 FPS, overhead-camera updates to 30 Hz, and sensor
and regular DOM updates to 20 Hz. Render interpolated vehicle poses; do not
add another renderer or simulation loop for auxiliary views.

## 4. Vehicles and controls

The two generic profiles are a Standard Sedan and a B-segment CUV. Vehicle
roots use meters, +Y up, -Z forward and a center-of-mass origin. The automatic
drivetrain has P, R, N and D; D includes simulated idle creep. Steering uses
Ackermann geometry with Cannon-es `RaycastVehicle` mechanics. Physics and
dimensions are prototype tuning values, not manufacturer specifications.

Keyboard is the default input: WASD or arrow keys for throttle, braking and
steering, and mouse for camera look. Gamepad API input supports a selected and
calibrated controller profile; `axes[0]` is steering, `buttons[6]` is brake,
and `buttons[7]` is throttle. `buttons[4]` and `buttons[5]` are explicit,
edge-triggered requests for R and D. Calibration and suggested profile names
do not certify support for a physical wheel or controller.

## 5. Views and proximity guidance

The driver camera is profile-anchored and supports bounded mouse-look. The
chase camera adjusts around environmental obstructions. Rear and side mirrors
use RenderTargets with a 15 FPS update cap. The overhead view uses one
high-altitude orthographic camera; its RenderTarget updates at no more than
30 Hz, while the latest texture is drawn into the canvas inset on rendered
frames under a DOM border and label. Trajectory lines and camera views are
aids, not proof that the learner observed an obstacle.

Front and rear bumper raycasters provide estimated proximity readings. The
HUD presents labeled visual warnings using standard green/yellow/red
proximity states; optional audio beeps require a deliberate user action to
unlock and stop on pause, outcome or disposal. Sensors are guidance aids, not
proof of safe clearance, and visual warnings remain available when audio is
muted or unavailable.

## 6. Environments, lessons and progression

The current environments are an urban roadside and an underground garage.
They use static low-poly artwork and explicit collider metadata. Collision
geometry comes from authored boxes, not render-mesh inference.

The five lessons are:

1. Garage forward-bay parking.
2. Garage reverse-bay parking.
3. Roadside reverse-parallel parking.
4. Narrow garage reverse-bay parking.
5. Adapted roadside parallel parking.

Checkpoints provide advisory guidance; they do not prescribe one exact path.
Parking success requires the complete oriented vehicle envelope, including
mirrors, to fit inside the target inset by `0.05 m`; heading error at most
`5 degrees`; linear speed below `0.1 m/s`; angular speed below `0.05 rad/s`;
gear P and the parking brake; and `2.0 s` of continuous compliance. Roadside
lessons also use their authored `0.15-0.30 m` curb-side body-gap range. Failure
boundaries include solid chassis/mirror contact, explicit wheel-side curb
contact, leaving bounds, tipping beyond `30 degrees`, or exceeding `15 km/h`
for one simulation second. Non-finite physics is an application error, not a
learner failure. A failure wins if failure and apparent success occur in the
same step.

Completed outcomes include a measured recap and persist in browser-local
attempt history. Only confirmed lesson success unlocks the next contiguous
stage. `Lái tự do` remains a separate Garage sandbox and cannot award lesson
progress. In free drive, contact halts motion until Reset or Menu.

Completed attempt history uses IndexedDB when available and retains a
session-only recap if persistence fails. Progress, settings (including
graphics settings), and controller calibration use separate versioned local
records; onboarding completion uses its own `park-core.onboarding.v1` record.
There are no accounts or cloud synchronization.

## 7. Learner interface

The journey includes an introductory tutorial, lesson selection, an explicit
briefing/start boundary, a compact in-drive coach, pause/settings/help, and a
success or failure recap. Free drive, attempt history and tutorial replay are
separate navigation choices. Settings stay out of the active driving HUD.
Graphics settings provide High, Balanced and Performance presets, render
scale, frame-rate cap, anti-aliasing, and mirror/overhead quality controls.
The settings screen can open an embedded `Đo hiệu năng` panel using the
selected graphics configuration. The separate `/benchmark.html` page runs
four fixed vehicle/view cases and supports JSON report export.

Use semantic keyboard-operable controls, visible focus, clear Vietnamese
labels and polite announcements for discrete lesson transitions. Keep
telemetry out of frame-rate announcements, preserve urgent visual warnings,
and respect reduced-motion preferences. A 3D interface is not a claim of full
nonvisual accessibility.

## 8. Assets and licensing

The selected Sedan/CUV and garage/roadside GLBs use original, generic shaped
geometry with static vertex colors and unlit materials. Parked lesson cars
reuse vehicle artwork; they do not add physics vehicles. The assets use no
external image resources, dynamic shadows, custom shaders or image-based light
bakes. See the [asset pipeline](asset-pipeline.md) and
[illustrated asset catalog](phase-8-asset-catalog.md) for dimensions,
provenance, payloads, render-call samples and software evidence.

Application code, functional tooling and technical documentation are MIT
licensed. The artwork GLBs in `public/assets`, creative definitions in
`tools/asset-designs`, and artwork-focused images in `docs/images/phase-8` use
CC BY-NC 4.0; earlier MIT grants remain valid.
License notices are in [`public/assets/LICENSE`](../public/assets/LICENSE),
[`tools/asset-designs/LICENSE`](../tools/asset-designs/LICENSE) and
[`docs/images/phase-8/LICENSE`](images/phase-8/LICENSE).

## 9. Deployment and validation boundaries

The Pages workflow validates pull requests and pushes to `main` with unit
tests, typecheck, production build, Chromium `@smoke` browser checks and
production-preview checks. A passing run on `main` deploys the static `dist`
build to [park-core.nguyenviettung.id.vn](https://park-core.nguyenviettung.id.vn/);
the workflow can also be started manually. See the README for setup, domain,
DNS, HTTPS and recovery guidance.

Automated browser coverage is Chromium-only and does not certify other
browsers or physical controller support. The approved 1440p/60 Hz benchmark
has not established a result on reference hardware. Supported-hardware,
physical-wheel, instructor, learner, route-feasibility and training-readiness
validation remain separate from software acceptance.

See the [detailed design](detail-design.md) for approved product requirements,
and the [README](../README.md) for current setup, controls and deployment.
Current asset details and measurements are in the linked asset pipeline and
catalog.
