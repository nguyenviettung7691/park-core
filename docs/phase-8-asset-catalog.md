# Phase 8 Original 3D Asset Catalog

Captured and measured: 2026-11-05. These are actual GLTFLoader/WebGL renders,
not the earlier concept drawings. Artwork uses shaped low-poly geometry,
vertex colors and unlit materials; there are no image textures, downloaded
meshes, dynamic shadows or custom shaders.

## Vehicles

The amethyst sedan has a low three-box body, rounded hood and separate angular
trunk. The ivory/charcoal CUV has a taller cabin, roof rails, wheel-arch cladding,
an upright hatch and vertical rear lamps. Both include handles, door seams,
grilles, bumpers, static lamp colors, mirror housings and independently animated
alloy wheels. Designs are generic and unbranded.

| Asset | Width x height x length (m) | Stored triangles | Nodes / meshes | GLB bytes |
|---|---|---:|---:|---:|
| [Sedan](../public/assets/vehicles/sedan.glb) | 1.8 x 1.45 x 4.6 | 2,854 | 30 / 21 | 200,548 |
| [CUV](../public/assets/vehicles/cuv.glb) | 1.8 x 1.62 x 4.35 | 2,970 | 30 / 21 | 209,464 |

Counts include the cockpit, mirror surfaces and both stored glazing variants,
even when one is hidden. Both are below the 10,000-triangle vehicle gate.

### Sedan: front and rear

![Amethyst sedan, rounded front hood and alloy wheels](images/phase-8/sedan-front.png)

![Sedan rear, separate trunk and horizontal red lamps](images/phase-8/sedan-rear.png)

### CUV: front and rear

![Ivory CUV, taller cabin, charcoal trim and roof rails](images/phase-8/cuv-front.png)

![CUV upright hatch and vertical rear lamps](images/phase-8/cuv-rear.png)

### Cockpits and mirrors

Both cockpits contain a dashboard, simple instrument rings/needles, steering
wheel with spokes/hub, front seats/headrests, rear-seat silhouette, console,
floor and roof lining. Captures look slightly downward to show controls;
application camera controls and default poses are unchanged.

![Sedan cockpit with controls and working rearview RenderTarget](images/phase-8/sedan-cockpit.png)

![CUV cockpit and garage viewed through its open interior aperture](images/phase-8/cuv-cockpit.png)

Driven-car window faces are opaque and outward-facing: exterior views show
closed windows while interior rays see the culled backfaces. These faces are
excluded from mirror renders. Stationary cars use separate double-sided
glazing. This is not a transparent-glass simulation.

Vehicle roots remain center-of-mass based, in meters, +Y up and -Z forward.
The physical profiles, eye anchors and mirror-camera anchors are unchanged:

| Vehicle | COM height (m) | `DriverEye` local (m) | `MirrorRear` local (m) | Left/right mirror local (m) |
|---|---:|---|---|---|
| Sedan | 0.52 | (-0.36, 0.60, -0.965) | (0, 0.72, -1.715) | (+/-0.96, 0.43, -0.865) |
| CUV | 0.62 | (-0.36, 0.68, -0.8462) | (0, 0.80, -1.5962) | (+/-0.965, 0.48, -0.7462) |

Mirror anchor yaw remains rear 180 degrees, left +105 degrees and right
-105 degrees. The smaller rearview **display mesh** is placed inside the
cabin, offset from its unchanged virtual camera by (-0.25, -0.075, +0.52) m.
It is a view proxy, not a newly calibrated optical mirror. Planar mirror
surfaces now have UVs; updates retain the existing 15 FPS cap.
Side housings sit behind their reflective planes relative to the driver.
Loaded-mesh 9 x 9 ray grids verify both side faces are unobstructed from
each fixed eye; this does not establish optical calibration.

## Environments and modular objects

| Asset | Declared width x height x depth (m) | Stored triangles | Nodes / meshes | GLB bytes |
|---|---|---:|---:|---:|
| [Underground garage](../public/assets/environments/garage.glb) | 30 x 6 x 30 | 2,160 | 19 / 14 | 182,624 |
| [Urban roadside](../public/assets/environments/roadside.glb) | 50 x 3 x 32 | 1,968 | 12 / 9 | 162,796 |

Both are below the 30,000-triangle environment gate. Repeated static details
are merged into compatible batches rather than separate objects/draw calls.

### Underground garage

Concrete floor/wall joints, amethyst wall bands, bay markings, B1 and pillar
identifiers, protective pillar bases, hazard stripes, overhead pipes/supports
and bright static fixture faces make the space recognizable. Fixture faces
are geometry, not lights or an image-based lighting bake.

![Garage floor, bays, wall bands and labeled pillars](images/phase-8/garage-overview.png)

![Garage pillar guard, hazard stripes, identifier and concrete joints](images/phase-8/garage-details.png)

The cockpit pictures above also show ceiling fixtures and pipe runs.
All overhead details remain in `Ceiling`, excluded from the overhead camera
but retained in ordinary views.

![CUV overhead view with ceiling removed by the existing camera layer](images/phase-8/overhead.png)

### Urban roadside

The road has an asphalt color region, lane/edge markings, sidewalk slabs,
curb joints, a concrete barrier block and detailed existing fence. Restrained
background frontages sit behind that physical fence, outside the reachable
driving surface; they do not introduce traversable solid-looking buildings.

![Roadside asphalt, curbs, sidewalk, barrier, fence and background frontage](images/phase-8/roadside-overview.png)

![Roadside fence rails/posts, sidewalk joints and frontage windows](images/phase-8/roadside-details.png)

### Parked lesson cars and guidance

Every existing lesson obstacle now has a visible stationary car, reusing the
selected vehicle's exterior and wheels without its cockpit or live mirror
surfaces. Each owns cloned geometry/materials and is fitted to the exact
collider box before applying its yaw. Stationary geometry is 2,252 triangles
for sedan and 2,368 for CUV, below the 4,000-triangle gate.

![Stage 1 parked CUV obstacles beside the unchanged lesson target](images/phase-8/lesson-parked-cars.png)

Stages 1, 2, 3 and 5 each have two parked cars; Stage 4 has one. Narrow
obstacles intentionally produce narrower visual cars to match the unchanged
training layout. Collision remains a **simple box approximation**, not
per-polygon contact with curved artwork. No physics vehicles are added.

Generic environment bay lines are hidden during lessons so they cannot
contradict lesson targets. Sandbox bay lines, target/highlight planes,
trajectory guidance and sensor overlays retain their existing behavior.

## Payload and actual rendering measurements

Only the selected vehicle/environment pair is loaded; parked cars reuse it.
All GLBs are self-contained and use no external image/buffer resources.

| Selected pair | Uncompressed bytes |
|---|---:|
| Sedan + garage | 383,172 |
| Sedan + roadside | 363,344 |
| CUV + garage | 392,088 |
| CUV + roadside | 372,260 |

All pairs are below the 5,000,000-byte gate.

The test fixture measures the real view pipeline at a settled spawn with
driver view, trajectory and overhead enabled, 1280 x 720. Counters are reset
and read **around each actual render**, not once across unrelated passes.
The table reports an auxiliary-update frame at 80 ms:

| Scene | Main calls / triangles | Three mirror calls | Overhead calls | Composite calls | Full-frame calls |
|---|---:|---|---:|---:|---:|
| Sedan + garage | 26 / 3,218 | 27 + 16 + 16 | 31 | 1 | 117 |
| Sedan + roadside | 22 / 3,038 | 25 + 16 + 16 | 31 | 1 | 111 |
| CUV + garage | 26 / 3,334 | 27 + 16 + 16 | 31 | 1 | 117 |
| CUV + roadside | 22 / 3,154 | 25 + 16 + 16 | 31 | 1 | 111 |
| Stage 1, CUV | 57 / 7,970 | 27 + 18 + 18 | 31 | 1 | 152 |
| Stage 2, CUV | 22 / 3,170 | 62 + 18 + 18 | 31 | 1 | 152 |
| Stage 3, CUV | 32 / 4,226 | 45 + 17 + 26 | 48 | 1 | 169 |
| Stage 4, CUV | 23 / 3,182 | 47 + 18 + 21 | 32 | 1 | 142 |
| Stage 5, CUV | 26 / 3,274 | 43 + 17 + 26 | 47 | 1 | 160 |

The gates are <=100 **main-pass** calls in sandbox and <=140 in lessons,
not limits on the sum of all camera passes. These sampled poses pass; their
full-frame costs are explicitly larger. A frame at 20 ms has no mirror
update, preserving the existing rate cap. Counts are not an FPS benchmark
or a worst-case guarantee for every driving pose.

## Reproduce and inspect

```powershell
node tools\generate-assets.mjs
npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs
npx playwright test phase-8-assets.spec.ts
```

Editable artwork is in `tools\asset-designs`; generic geometry helpers and the
GLB writer are separate. Browser captures are written to test artifacts, never
automatically over the committed pictures. Inspect artifacts before choosing
updated catalog images. The fixture and its capture API are test-only, not
part of the production app. See [asset pipeline](asset-pipeline.md).

## Verification limits

Final software checks passed: 487 unit/DOM/physics/asset tests, 37 explicitly
selected generator/loader checks, typecheck, production build, 40 Chromium
browser checks (including both five-stage journeys) and five production
checks. The explicit asset selection overlaps the ordinary suite; these
numbers are not additive. No lint script exists. The existing bundle-size
warning remains.

The branch includes the current Phase 7 learner experience. Its app captures
follow the real tutorial/menu/settings/briefing flow rather than bypassing it.
The independent whole-branch review found side-mirror housing obstruction;
driver-eye grid regressions reproduced it before the housing correction,
and all software gates above passed after that fix.

Captures used Chromium 156.0.8078.4 with ANGLE Vulkan **SwiftShader**, not the
host's hardware GPU. App screenshots are 1920 x 1080; asset captures are
1280 x 720. The 2560 x 1440 benchmark was attempted with honest metadata,
but the host display was 144 Hz, so the existing 60 Hz eligibility gate
rejected it before measurement. No cases or FPS were measured.

The approved 1440p60 target (p95 <=17.5 ms, mean >=57 FPS, zero loss) is
**unverified**. These runs used Node 24.13.1, below the declared 24.15.0
floor for that major. Supported-Node, reference/minimum-PC, physical wheel,
manual labeled mirror-landmark, vehicle-clearance, route and instructor
validation remain pending. Artwork and software checks do not establish
real-world training readiness.

## Provenance and license

Original geometry, palette choices and compositions were authored for
Park-Core by Park-Core contributors. No third-party artwork was imported;
no manufacturer identity is claimed. Regeneration is deterministic, and
license/attribution metadata is embedded in each GLB.

New creative definitions, GLBs and artwork-focused pictures are
[CC BY-NC 4.0](../public/assets/LICENSE): freely share/adapt for
**noncommercial** purposes with attribution, a license link and an indication
of changes. Attribute "Park-Core contributors, Park-Core Phase 8 original
artwork" and link the [source repository](https://github.com/nguyenviettung7691/park-core).
See the [creative-source notice](../tools/asset-designs/LICENSE) and
[picture notice](images/phase-8/LICENSE).

Application code, generic generation mechanics and technical documentation
remain [MIT](../LICENSE). The new artwork is source-available, **not
OSI-open-source** because commercial use is restricted. Existing MIT grants
on earlier versions remain valid; dependency/tool licenses are unchanged.
