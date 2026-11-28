# Asset Pipeline: Reference to Reviewed GLB

## Reference-driven requests

This is the shared workflow for Copilot, Claude Code and manual authoring.
Instruction discovery varies by harness; explicitly ask the harness to read this
file if its entry point was not loaded. No external generation service or Blender
installation is required. Blender export is a future adapter to the same contract,
not a separate runtime pipeline.

Copyable request:

> Read docs/asset-pipeline.md and inspect the attached reference. Prepare the brief
> and impact table below, implement a candidate, run the affected checks, and
> present reference/before/after captures for my visual approval.

Before editing, record a compact brief in the session workspace:

| Field | Required information |
|---|---|
| Target | Sedan/CUV; exterior/interior/both; reference attachment IDs/local paths |
| Observed | Silhouette, proportions, windows, wheel placement, controls, colors |
| Inferred | Hidden surfaces/interior, scale, dimensions, eye and mirror placement |
| Features | Requested behavior beyond static artwork, runtime owner, tests |
| Constraints | Visual priorities, exclusions, source rights/provenance |
| Proposed changes | Dimensions/anchors, affected systems, required review shots |

Reference-driven dimension/anchor changes and consistent redesign of unseen parts
are allowed. Label inferred choices; a single screenshot is not a metric scan.
Without supplied scale, use an explicitly provisional vehicle-class scale. Ask
when ambiguity affects vehicle class, lesson compatibility, feature scope or
permitted use. Do not publish reference images without permission or assume our
artwork license covers them.

### Dependency map

| Change | Check before accepting |
|---|---|
| Exterior | Silhouette, glazing, chase/overhead views, mirrored self-visibility, parked clones |
| Cockpit/eye | Neutral POV, dashboard, pillars/headliner, FOV/look limits, clipping, all mirror faces |
| Dimensions/axles/tires/COM | Profiles, chassis/mirror colliders, wheels/suspension, sensor origins, trajectory, parking footprint, spawns/routes |
| Mirrors | Housing, display plane/UVs, virtual camera, collision envelope and layer are separate contracts |
| New feature | Behavior, named parts/pivots, runtime integration and regression tests; geometry alone is not implementation |

For example, an animated steering wheel requires a transformable part and a
telemetry-driven update; it is not delivered by adding a static wheel mesh.
Do not retune handling from a picture, move obstacles, weaken lesson criteria or
raise budgets just to pass a new asset. A failed scripted route witness requires
investigation; it does not prove that no valid driving route exists.

### Candidate loop and approval

1. Read the brief and relevant current code, not every historical phase document.
   Capture a baseline review before editing dimensions or camera contracts.
2. Record the impact table; change shared physical/view contracts when needed.
3. Generate only the selected vehicle to a candidate directory outside `public`.
4. Run parity/contract checks and the runtime review command below. Candidate
   requests must load candidate bytes, not the old public GLB.
5. Inspect reference, previous and candidate captures. Include neutral cockpit,
   look-down/side views, all mirrors, silhouette and geometry overlays. Red boxes
   show chassis/mirror colliders, yellow the body shell, purple the parking
   footprint. Record
   inferred geometry and remaining uncertainty.
6. Developer approves the candidate hash and appearance separately from automated
   success. Do not auto-update visual baselines. Copy only the approved GLB into
   `public\assets\vehicles`, recheck parity and update relevant provenance/catalog
   evidence. Keep unapproved candidates and screenshots out of public assets.

Missing image inspection, WebGL or browser tooling means visual validation is
**unverified/blocked**, never successful. Copilot/Claude entry-point loading must
be verified in the harness being used; these files alone do not prove discovery.

The current body art is centered on Z=0, whereas physical axle/overhang extents
are asymmetric: sedan artwork [-2.3, 2.3] versus collider [-2.115, 2.485] m;
CUV [-2.175, 2.175] versus [-1.9462, 2.4038] m. Reports expose this known mismatch.
Workflow setup preserves it rather than silently migrating artwork/physics.
New dimensional changes require explicit review of extents, not just equal sizes.

## Validation selection

Use generator/loader and view tests for every asset request. Dimension changes
also require vehicle, sensors, trajectory, parking, scenario-route and lesson
journey coverage. Anchor changes require neutral/FOV/look and mirror review.
Run typecheck/build for code changes and production asset-load checks before
promotion.

Keep the existing gates: <=10,000 vehicle triangles, <=4,000 parked triangles,
<=30,000 environment triangles, <=5,000,000 bytes per selected pair, and <=100
sandbox / <=140 lesson **main-pass** draw calls. Report auxiliary/full-frame costs
separately. Mirrors remain capped at 15 FPS and overhead at 30 Hz.
Screenshot checks on CI/SwiftShader do not verify 1440p60 performance, optical
mirror calibration or training readiness.

## Generate and edit

From the repository root:

```powershell
node tools\generate-assets.mjs
npm run assets:check
```

For a selected candidate (the output root contains `public\assets\vehicles`):

```powershell
npm run assets:generate -- --vehicle sedan --out C:\asset-work\candidate
npm run assets:check -- --vehicle sedan --candidate C:\asset-work\candidate
npm run assets:review -- --vehicle sedan --candidate C:\asset-work\candidate --out C:\asset-work\review
```

A candidate feature that is not yet approved sits behind an opt-in generator
option, off by default, so plain generation always reproduces the approved
public GLBs (and `assets:check` and the sync test stay green). Promotion after
the developer approves the candidate hash and captures is one reviewed change:
author the feature by default, regenerate with `node tools\generate-assets.mjs`,
confirm the public GLBs match the approved candidate, then run
`npm run assets:check` and the full suites.

The issue #11 exterior lamps went through this gate and are promoted: the
developer approved them (delegated approval on 2026-11-27, PR #22), so
`EXTERIOR_LAMPS_DEFAULT` in `tools\generate-assets.mjs` is on and the former
opt-in `--lamps` flag is retired. `buildGlb(id, { lamps: false })` remains as a
programmatic opt-out. Promoted vehicle GLB SHA-256: sedan
`e409a8961635fad8fea9a355979baf46e9546d45f774177a0ea5a9ff624d9a5b`, CUV
`7cb934d717dc51da168959d9a3876324bec6a8e21b48eed1917b39ea3133276b`.

The issue #23 movable `DriverSeat` went through the same gate and is promoted:
the developer approved both candidates by hash and appearance (2026-11-28,
PR #28), so `DRIVER_SEAT_DEFAULT` in `tools\generate-assets.mjs` is on and the
former opt-in `--driver-seat` flag is retired from the generator and the asset
workflow. `buildGlb(id, { driverSeat: false })` remains as a programmatic
opt-out. Promoted vehicle GLB SHA-256 (these supersede the #11 hashes above,
which remain the lamp-promotion record): sedan
`702d24364c3d362f87d108d2145d1116099ee64236aed8745eeafed04a4b3af3`, CUV
`c3ee1543916650ba2f2b18a753faa1d538a512b7a23c8c1c05da5bfe0b6d65a7`.
`src\world\head-clearance.test.ts` parses the default GLBs and checks that every
sampled eye (seat range corners x yaw -160 to +110 degrees) stays at least
0.12 m from every vehicle triangle.

The issue #25 pedestrian template went through the same gate and is promoted: the
developer approved the candidate captures and hashes on 2026-11-28 (PR #29), so
`PEDESTRIAN_TEMPLATE_DEFAULT` in `tools\generate-assets.mjs` is on and the former opt-in
`--pedestrians` flag is retired. `buildGlb(id, { pedestrians: false })` remains as a
programmatic opt-out. Both environment GLBs carry a hidden `PedestrianTemplate`: a
~460-triangle, 1.7 m, flat-shaded adult built from six mesh nodes (`PedestrianBody`,
`PedestrianHead`, `PedestrianLegL/R` and `PedestrianArmL/R`, legs pivoting at the hip
y = 0.8 and arms at the shoulder y = 1.4, facing -Z) that match `createPlaceholderPedestrian`
in `src\render\actors-scene.ts`. `assets.ts` hides it and does not require it; the actors
scene clones it when present and otherwise keeps the placeholder. It is original artwork with
no external reference. Promoted environment GLB SHA-256: garage
`dde9f7489ae433dd00cc1644d0fe011a0cafa2aaae638c50b063d5f630eb93cc`, roadside
`9811f1e7c5d9a36a543d2597b984e6e87bd2186033fb00d3b90815f8950a6eed`.

Use your session workspace in place of `C:\asset-work`. Choose an empty output
directory for each review: existing evidence is never overwritten or mixed with
another run. The review output must be outside the repository or inside
`test-results`; it contains `report.json` and
an `index.html` linking per-environment `review.html`, view-limit captures and
metrics. The command runs focused
generator/loader/view tests and the candidate browser review, using Playwright's
existing local server. It fails on stale candidate bytes, test failures or missing
browser tooling. It does not copy candidates into public assets or approve them.
Install the project's locked dependencies and Playwright Chromium when missing.
The focused unit run includes the "checked-in GLBs in sync" test: it compares
the public GLBs with default generation, which keeps unapproved options off and
authors promoted ones, so it passes before and after promotion. After promotion, run `npm run assets:check` and
the full suites.
(The sedan and CUV redesigns for issue #12 predate this and ran the browser spec
directly with the `PARK_CORE_REVIEW_*` variables.)
If dimensional/anchor changes make the old public GLB incompatible with the new
contract, the report labels its baseline unavailable. Use the pre-edit review for
comparison; do not bypass validation just to obtain a before image.

The shared physical authority is `src\vehicle\profiles.ts`; view poses and required
node roles are in `src\vehicle\asset-contract.ts`. Generator modules consume these
typed definitions through Node's native type stripping; use the supported Node
versions from `package.json`. Geometry, cockpit, wheel and mirror authors remain
separate functions within the licensed creative source.

The initial review has **no approved pixel baselines** and reports that fact.
After a developer approves captures, store those images in a chosen baseline
directory, named `sedan-garage-front.png`, etc., and add
`--baseline C:\asset-work\approved` to the review command. These are explicit
snapshot assertions; missing/mismatched snapshots fail and are never created or
updated automatically. Keep browser/GPU configuration consistent. The report's
visual approval stays pending until the developer records approval in the brief.

The automated CI path runs both the established asset suite (including parked
lesson cars) and the new review suite. Successful and failed artifacts are retained
for seven days. The local review command is intentionally focused; use the
dependency map above to select additional vehicle/lesson tests when needed.

The deterministic Node-only generator writes four binary glTF 2.0 files with
embedded mesh data, static vertex colors and `KHR_materials_unlit`.
No downloaded art, image textures, external GLB resources, Blender requirement,
new runtime dependencies, dynamic shadows or custom shaders are involved.

- `tools\generate-assets.mjs`: shared-profile adapter, GLB writer and selected-output CLI.
- `tools\asset-workflow.mjs`: parity/budget checks and runtime review command.
- `tools\asset-geometry.mjs`: reusable box/cylinder/torus, polygon, transform
  and merge mechanics (MIT).
- `tools\asset-designs`: original geometry, palettes and scene compositions
  (CC BY-NC 4.0).
- `public\assets`: generated artwork and its license notice.

Edit creative definitions and regenerate; do not hand-edit binary GLBs.
The [illustrated catalog](phase-8-asset-catalog.md) contains current pictures,
dimensions, triangle counts, payload sizes, render calls and validation limits.
Phase 5 measurements in repository history describe the superseded box prototypes.

## Geometry and runtime contracts

Vehicles use meters, +Y up, -Z forward and a center-of-mass root. `Body` is a
shaped shell, not a solid validation box. Required bounds, cockpit containment,
eye/mirror transforms and independent wheel nodes remain validated against
`src\vehicle\profiles.ts`. Vehicle handling, the chassis collider and mirror collider
sizes are unchanged; mirror collider positions follow `sideMirrorZOffsetM`.

`Exterior` groups the shell and static details; four wheels remain separate.
`Cockpit` contains seats, dashboard, instruments and steering wheel.
Both cockpits also have optional named controls that `src\render\asset-scene.ts`
drives from telemetry each rendered frame. `SteeringWheelPivot` (under the raked
`SteeringColumn`) turns with `steeringWheelRad`. `SpeedometerNeedle` sweeps
0-120 km/h over 240 degrees. `IndicatorLeftLamp`/`IndicatorRightLamp` flash at
1.5 Hz on simulation time. `ParkingBrakeLamp` follows the parking brake, and
`BrakePedal`/`AcceleratorPedal` rotate about their hinges with brake and the
optional `throttle` telemetry. The CUV console `ParkingBrakeLever` lifts 0.35 rad
while the parking brake is applied. `DriverSeat` (issue #23; the driver's cushion,
backrest, bolsters and headrest as one mesh, `DriverSeatParts`) sits at its authored
position plus the seat offset, moved with the driver eye. Vehicles without a node are left untouched;
geometry alone is not the feature.
Exterior lamp nodes (issue #11) are hidden by default and shown from telemetry:
`BrakeLampsLit` (brake above 0.05), `ReverseLampsLit` (gear R) and
`TurnSignalLeftLit`/`TurnSignalRightLit` (the indicator flash). They sit under
`Body`, are one batched unlit mesh each, and parked clones hide them (parked
clones also fit their bounds without the `*Lit` nodes). They are authored by
default and present in the public GLBs: the developer approved them (delegated
approval on 2026-11-27, PR #22).
Environment changes for issue #11 (0.11 m curbs, the garage wheel-stop
template) were approved by the developer in the same delegated approval
(2026-11-27, PR #22). Environment GLB SHA-256: roadside
`bfa62e02433f425ff100b75f3a38d1622cb90063d17d74e7ea7108a1fc755360`, garage
`bf7adefc4a4844f160048a6a176fc983648657148323e6cff1148ac62860778d`.
The driven exterior uses outward-only opaque glazing: no transparency sorting,
with open interior sightlines. That glazing is excluded from mirror passes.
`ParkedGlazing` is hidden on the driven car and enabled on parked clones.
Planar mirror surfaces have UV coordinates for the existing capped-rate
RenderTargets. Intentional anchor updates must change the shared view contract
(`vehicleViews` in `src\vehicle\asset-contract.ts`) and pass loader/render checks.
Both vehicles share one cabin view: it moves the side mirrors (glass and colliders)
forward via `sideMirrorZOffsetM` and places the rearview glass under the windshield
header. Each `Mirror*` node is the glass pivot and shares its `MirrorSurface*` pose,
size and default aim from the contract (`glass`, `sideInnerEdgeInwardRad`,
`sideGlassRiseM`). The renderer reflects the driver eye in the live glass plane and
renders through the glass rectangle, so there is no separate mirror camera anchor; the
loader rejects glass off its pivot or off the contract size. Exact anchors and the
manual-validation limitation are recorded in the catalog.

The environment floor contract and named Ground/ParkingMarkings/WallsAndCurbs
groups remain. Garage pipes and fixtures belong to Ceiling, whose rendering
layer is excluded from the overhead camera. Lamp faces are unlit geometry,
not new lights. Fixed color shading is not an image-based light bake.

The garage GLB carries a hidden `WallsAndCurbs/WheelStopTemplate` (one mesh,
1.8 x 0.11 x 0.15 m, centred on its origin). The loader requires it, and
`createLessonScene` clones it for every `wheel-stop` collider in the scenario,
taking the collider's id, position and yaw; it throws if a stage has stops but no
template, and never builds a parked car for a stop. Roadside curbs are 0.11 m tall
(`CurbLeft`/`CurbRight` 0.3 x 0.11 x 32 m at x = +/-4.2); art and colliders must
move together.

`src\world\colliders.ts` and `src\lessons\scenarios.ts` remain authoritative.
Parked lesson cars clone exterior/wheel resources, fit their visible bounds
to existing collider boxes and own their copies. They do not create physics
vehicles or mutate the live car. Generic environment bay markings are hidden
in lessons to avoid contradicting the lesson target; sandbox markings remain.

## Validation and licensing

Generator and loader regressions cover deterministic GLBs, dimensions,
anchors, geometry/payload budgets, cockpit sightlines, mirror UVs and layer
assignment. Render tests exercise actual GLTFLoader/WebGL and multi-pass views.
These checks do not replace manual mirror-landmark, vehicle-clearance,
instructor, real-wheel or reference-hardware validation. SwiftShader captures do
not verify 1440p60 performance or training readiness.

Application and functional generator code remain MIT. New artwork and its
creative sources use [CC BY-NC 4.0](../public/assets/LICENSE), with original
provenance and attribution embedded in each GLB. New artwork-focused images
have a [separate notice](images/phase-8/LICENSE). Freely available noncommercial
artwork is source-available, not OSI-open-source; older MIT releases retain
their previously granted permissions.
