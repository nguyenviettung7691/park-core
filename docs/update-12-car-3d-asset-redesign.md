# Update #12: Sedan and CUV 3D Asset Redesign

**Issue:** [#12 — Redesign the car 3D assets](https://github.com/nguyenviettung7691/park-core/issues/12)

**Date:** 2026-11-06

## Summary

Redesigned the Sedan and CUV exterior proportions and cockpit artwork in the
deterministic vehicle asset generator. Post-implementation review corrections
also close rear-side shell and glazing gaps, make the side-mirror displays face
the driver, raise the rearview display, and separate the cockpit dials and
indicator lamps. The simulator's body dimensions, colliders, camera anchors,
and runtime behavior remain unchanged.

The issue's first reference guided the Sedan and its second guided the CUV.
Both remain generic low-poly vehicles using the existing palettes, vertex
colors, unlit materials, and CC BY-NC 4.0 artwork license. No third-party art,
textures, shaders, dynamic lighting, dependencies, or live vehicle telemetry
were added.

## Vehicle changes

- **Sedan:** lengthened the rounded hood relative to its separate, shorter
  trunk, adjusted the hood shoulder, and replaced the flat trunk surface with
  a thin 0.03 m box lid.
- **CUV:** retained its upright hatch silhouette and extended the rear deck
  across the full 1.8 m body width to eliminate rear-side slits.
- **Both:** aligned side glazing with the outer shell and roof, raised the rear
  wall, and connected the upper side shell to the rear deck. Existing profile
  dimensions and collider boxes are unchanged. Loaded-GLB regressions ray-test
  both sides and representative front/rear glass edges, plus side and rear
  body coverage.

## Static cockpit and mirrors

Added named `InstrumentCluster`, `PedalSet`, `CenterConsole`, `DoorPanels`, and
`Floor` meshes, and completed the seating in `SeatsAndInterior`. The instrument
cluster has three static dial faces, needles, and four separated indicator
lamps; these are artwork only and are not connected to simulator state. Their
height and spacing put all faces and lamps in the default driver's view.
Loaded-GLB ray/color regressions verify their visibility, while browser
captures show the spacing and steering-wheel clearance.

Reduced the rearview display surface from 0.12 x 0.05 m to 0.09 x 0.035 m and
raised it inside the cabin. Its offset from the unchanged `MirrorRear` camera
anchor is (-0.22, -0.025, +0.52) m. The visible side-mirror display meshes now
face the fixed driver eye; their camera anchors and yaw remain unchanged.
Housings sit behind the reflective planes. Render-target behavior, UVs, and
the 15 FPS update cap remain unchanged. Displays are view proxies, not
calibrated optical mirrors.

The following runtime and geometry contracts remain unchanged:

| Contract | Sedan | CUV |
|---|---:|---:|
| Declared body dimensions (m) | 1.8 x 1.45 x 4.6 | 1.8 x 1.62 x 4.35 |
| Center-of-mass height (m) | 0.52 | 0.62 |
| `DriverEye` local position (m) | (-0.36, 0.60, -0.965) | (-0.36, 0.68, -0.8462) |
| `MirrorRear` camera anchor (m) | (0, 0.72, -1.715) | (0, 0.80, -1.5962) |

All geometry remains in meters, +Y up, -Z forward. Wheel nodes, collider
dimensions, center-of-mass roots, mirror camera transforms, and runtime
rendering behavior are preserved.

## Generated asset measurements

Measurements are from the regenerated GLBs. Triangle counts include stored
cockpit and glazing variants, including hidden variants.

| Asset | Triangles | Nodes / meshes | GLB bytes |
|---|---:|---:|---:|
| Sedan | 3,226 | 39 / 27 | 232,452 |
| CUV | 3,342 | 38 / 26 | 240,432 |

Both vehicles remain below the 10,000-triangle limit. Selected vehicle and
environment payloads remain below 5 MB:

| Selected pair | Uncompressed bytes |
|---|---:|
| Sedan + garage | 415,076 |
| Sedan + roadside | 395,248 |
| CUV + garage | 423,056 |
| CUV + roadside | 403,228 |

Parked lesson cars reuse only the selected vehicle's exterior and wheels,
including static glazing but excluding cockpit/live mirror surfaces. Their
measured geometry is 2,258 Sedan triangles and 2,374 CUV triangles; both
remain below the 4,000-triangle cap.

## Real-render verification

The Phase 8 Chromium fixture loaded each vehicle/environment pair and all five
parked lesson scenes. Ten browser cases passed with no page errors. Main-pass
calls stayed below the sandbox limit of 100 and lesson limit of 140.

| Scene | Main calls / triangles | Mirror calls | Overhead | Composite | Full-frame calls |
|---|---:|---|---:|---:|---:|
| Sedan + garage | 30 / 3,530 | 32 + 18 + 18 | 37 | 1 | 136 |
| Sedan + roadside | 26 / 3,350 | 30 + 18 + 18 | 37 | 1 | 130 |
| CUV + garage | 30 / 3,658 | 31 + 18 + 18 | 36 | 1 | 134 |
| CUV + roadside | 26 / 3,478 | 29 + 18 + 18 | 36 | 1 | 128 |
| Stage 1, CUV | 67 / 8,306 | 31 + 20 + 20 | 36 | 1 | 175 |
| Stage 2, CUV | 26 / 3,494 | 66 + 20 + 20 | 36 | 1 | 169 |
| Stage 3, CUV | 38 / 4,554 | 49 + 19 + 28 | 56 | 1 | 191 |
| Stage 4, CUV | 27 / 3,506 | 51 + 20 + 23 | 37 | 1 | 159 |
| Stage 5, CUV | 29 / 3,590 | 47 + 19 + 28 | 54 | 1 | 178 |

The figures are sampled render calls, not FPS or worst-case performance
measurements. The full-frame totals include the separate mirror, overhead, and
composite passes; the enforced budget is for the main pass only.

## Captures and catalog

Replaced the six superseded Sedan/CUV front, rear, and driver-view captures in
`docs/images/phase-8`. Updated `docs/phase-8-asset-catalog.md` with final
geometry and mirror details, focused visibility checks, GLB sizes,
triangle/node/mesh counts, payload sizes, parked-car geometry, render-call
samples, and validation limits. Driver-view captures omit the HUD overhead
inset so all three dials can be inspected; render metrics and application
behavior remain unchanged. The asset generation pipeline itself did not change.

## Checks

Final verification:

- `node tools\generate-assets.mjs` — passed; SHA-256 hashes for both vehicle
  GLBs were unchanged across regeneration.
- `npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs`
  — 61 tests passed.
- `npm test` — 512 tests passed across 31 files.
- `npm run typecheck` — passed.
- `npm run build` — passed. Vite reported the existing large-chunk warning:
  the generated assets chunk is 766.91 kB, above its 500 kB advisory threshold.
- `npm run test:browser -- phase-8-assets.spec.ts` — 10 browser cases passed,
  including the five parked lesson scenes.
- `git diff --check` — passed.

## Remaining validation limits

Software and browser checks do not replace manual cockpit and mirror-landmark
inspection, optical calibration, vehicle-clearance checks, or validation on
reference hardware. The 1440p60 performance target remains unverified; the
1440p benchmark was not measured. These checks used Node 24.13.1, below the
repository's declared Node 24.15.0 minimum for that major. Hardware-wheel,
route, instructor, and learner validation also remain pending. The artwork and
software tests do not establish training readiness.
