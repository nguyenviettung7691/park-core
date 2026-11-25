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
Known limitation: the focused unit run includes the "checked-in GLBs in sync"
test. When the authoring source changes, that test fails until the approved GLB
is promoted, so a pre-promotion `assets:review` stops before the browser step.
Until the command handles this, run the focused unit tests (expecting only that
failure) and run `asset-review.spec.ts` directly with the `PARK_CORE_REVIEW_*`
variables. After promotion, rerun the full `assets:review`, which must pass.
The sedan exterior redesign for issue #12 followed this path.
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
`src\vehicle\profiles.ts`. Vehicle handling and collision dimensions are unchanged.

`Exterior` groups the shell and static details; four wheels remain separate.
`Cockpit` contains seats, dashboard, instruments and steering wheel.
The driven exterior uses outward-only opaque glazing: no transparency sorting,
with open interior sightlines. That glazing is excluded from mirror passes.
`ParkedGlazing` is hidden on the driven car and enabled on parked clones.
Planar mirror surfaces have UV coordinates for the existing capped-rate
RenderTargets; baseline camera anchors remain unchanged. Intentional anchor
updates must change the shared view contract and pass loader/render checks.
The smaller rearview display mesh is positioned inside the cabin separately
from its unchanged virtual camera; its exact offset and manual-validation
limitation are recorded in the catalog.

The environment floor contract and named Ground/ParkingMarkings/WallsAndCurbs
groups remain. Garage pipes and fixtures belong to Ceiling, whose rendering
layer is excluded from the overhead camera. Lamp faces are unlit geometry,
not new lights. Fixed color shading is not an image-based light bake.

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
instructor, real-wheel or reference-hardware validation.

Application and functional generator code remain MIT. New artwork and its
creative sources use [CC BY-NC 4.0](../public/assets/LICENSE), with original
provenance and attribution embedded in each GLB. New artwork-focused images
have a [separate notice](images/phase-8/LICENSE). Freely available noncommercial
artwork is source-available, not OSI-open-source; older MIT releases retain
their previously granted permissions.
