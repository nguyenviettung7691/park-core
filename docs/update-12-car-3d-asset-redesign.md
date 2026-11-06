# Update #12: Sedan and CUV 3D Asset Redesign

**Issue:** [#12 — Redesign the car 3D assets](https://github.com/nguyenviettung7691/park-core/issues/12)  
**Date:** 2026-11-06

## Summary

Redesigned the Sedan and CUV exterior proportions and cockpit artwork in the
deterministic vehicle asset generator. The update improves the Sedan's hood to
trunk balance, closes the visible body-shell gaps, adds static cockpit detail,
and makes the rearview display smaller while preserving simulator geometry,
physics, camera, and rendering contracts.

The issue's first reference guided the Sedan and its second guided the CUV.
Both remain generic low-poly vehicles using the existing palettes, vertex
colors, unlit materials, and CC BY-NC 4.0 artwork license. No third-party art,
textures, shaders, dynamic lighting, dependencies, or live vehicle telemetry
were added.

## Vehicle changes

- **Sedan:** lengthened the modeled hood relative to its separate, shorter
  named trunk; adjusted the hood shoulder and glazing boundary while retaining
  the original overall body envelope.
- **CUV:** retained its upright hatch silhouette while refining the exterior
  shell, glazing edges, and panel coverage.
- **Both:** preserved the existing profiles and collider boxes. Added loaded
  mesh ray coverage at representative door-side samples to check that the body
  shell remains closed from both sides.

## Static cockpit and mirrors

Added named `InstrumentCluster`, `PedalSet`, `CenterConsole`, `DoorPanels`, and
`Floor` meshes, and completed the seating in `SeatsAndInterior`. The instrument
cluster has static dial faces, needles, and indicator lamps; these are artwork
only and are not connected to simulator state. The browser captures were
visually inspected, and a loaded-geometry ray/color regression verifies that a
dial face is visible from each vehicle's fixed driver eye.

Reduced the rearview display surface from 0.12 x 0.05 m to 0.09 x 0.035 m and
repositioned its visible mesh inside the cabin. Its offset from the unchanged
`MirrorRear` camera anchor is (-0.22, -0.075, +0.52) m. The virtual rear and
side mirror anchors, yaw, render-target behavior, UVs, and 15 FPS update cap
remain unchanged. The display is a view proxy, not a calibrated optical mirror.

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
| Sedan | 3,204 | 36 / 27 | 230,500 |
| CUV | 3,330 | 35 / 26 | 239,288 |

Both vehicles remain below the 10,000-triangle limit. Selected vehicle and
environment payloads remain below 5 MB:

| Selected pair | Uncompressed bytes |
|---|---:|
| Sedan + garage | 413,124 |
| Sedan + roadside | 393,296 |
| CUV + garage | 421,912 |
| CUV + roadside | 402,084 |

## Real-render verification

The Phase 8 Chromium fixture loaded each vehicle/environment pair and all five
parked lesson scenes. Ten browser cases passed with no page errors. Main-pass
calls stayed below the sandbox limit of 100 and lesson limit of 140.

| Scene | Main calls / triangles | Mirror calls | Overhead | Composite | Full-frame calls |
|---|---:|---|---:|---:|---:|
| Sedan + garage | 30 / 3,518 | 32 + 18 + 18 | 37 | 1 | 136 |
| Sedan + roadside | 26 / 3,338 | 30 + 18 + 18 | 37 | 1 | 130 |
| CUV + garage | 30 / 3,646 | 31 + 18 + 18 | 36 | 1 | 134 |
| CUV + roadside | 26 / 3,466 | 29 + 18 + 18 | 36 | 1 | 128 |
| Stage 1, CUV | 61 / 8,282 | 31 + 20 + 20 | 36 | 1 | 169 |
| Stage 2, CUV | 26 / 3,482 | 66 + 20 + 20 | 36 | 1 | 169 |
| Stage 3, CUV | 36 / 4,538 | 49 + 19 + 28 | 53 | 1 | 186 |
| Stage 4, CUV | 27 / 3,494 | 51 + 20 + 23 | 37 | 1 | 159 |
| Stage 5, CUV | 29 / 3,578 | 47 + 19 + 28 | 52 | 1 | 176 |

The figures are sampled render calls, not FPS or worst-case performance
measurements. The full-frame totals include the separate mirror, overhead, and
composite passes; the enforced budget is for the main pass only.

## Captures and catalog

Replaced the six superseded Sedan/CUV front, rear, and driver-view captures in
`docs/images/phase-8`. The updated driver views show the static dials through
the steering-wheel opening. Refreshed `docs/phase-8-asset-catalog.md` with the
verified GLB sizes, triangle/node/mesh counts, payload sizes, mirror
description, cockpit details, and render-call samples. The asset generation
pipeline itself did not change.

## Checks

Final verification:

- `node tools\generate-assets.mjs` — passed; `git diff --exit-code -- public\assets\vehicles\sedan.glb public\assets\vehicles\cuv.glb`
  confirmed deterministic output with no GLB changes.
- `npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs`
  — 49 tests passed.
- `npm test` — 500 tests passed across 31 files.
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
