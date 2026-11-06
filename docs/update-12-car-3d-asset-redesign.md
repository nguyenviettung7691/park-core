# Update #12: Sedan and CUV 3D Asset Redesign

**Issue:** [#12 — Redesign the car 3D assets](https://github.com/nguyenviettung7691/park-core/issues/12)

**Date:** 2026-11-06

## Summary

Realigned the Sedan and CUV models to the Issue #12 reference boards in the
deterministic vehicle asset generator. The follow-up corrects the criticized
short Sedan hood and oversized greenhouse, redesigns visible mirror hardware
instead of enlarging the windows, and reduces the cockpit panel so the wheel
ring remains clear. The simulator's body dimensions, colliders, camera
anchors, and runtime behavior remain unchanged.

The Sedan and CUV reference boards guided their respective proportions and
four-view details. Both remain generic low-poly vehicles using the existing
palettes, vertex colors, unlit materials, and CC BY-NC 4.0 artwork license. No
third-party art, textures, shaders, dynamic lighting, dependencies, or live
vehicle telemetry were added.

## Vehicle changes

- **Sedan:** lengthened the rounded hood to 0.85 m and shortened its separate
  trunk to 0.20 m, adjusted the hood shoulder, and retained the thin 0.03 m
  box lid.
- **CUV:** retained its upright hatch silhouette and extended the rear deck
  across the full 1.8 m body width to eliminate rear-side slits.
- **Both:** kept side-glass Z-spans to at most 78% of Sedan length and 80% of
  CUV length, aligned glazing with the outer shell and roof, raised the rear
  wall, and connected the upper side shell to the rear deck. Added side-mirror
  stems and housings, with pale exterior reflector faces distinct from the
  driver-facing display surfaces. Existing profile dimensions and collider
  boxes are unchanged. Loaded-GLB regressions cover body bounds, glass edges,
  exterior mirror faces, and fixed-eye mirror visibility.

## Static cockpit and mirrors

Added named `InstrumentCluster`, `PedalSet`, `CenterConsole`, `DoorPanels`, and
`Floor` meshes, and completed the seating in `SeatsAndInterior`. Narrowed the
dashboard from 1.46 m to 1.10 m, reduced the instrument backing from 0.66 m to
0.44 m, and compacted the three static dials so all 16 sampled points around
the steering-wheel ring are unobstructed. Four separated indicator lamps,
needles, pedals, console, seats and static controls remain artwork only, not
simulator telemetry. Loaded-GLB regressions check the wheel ring, dial faces,
indicator visibility and steering-wheel clearance.

Reduced the rearview display surface from 0.12 x 0.05 m to 0.07 x 0.025 m and
raised it inside the cabin, within the driver's forward view. Its offset from
the unchanged `MirrorRear` camera anchor is (-0.28, -0.06, +0.52) m. Side-mirror
display meshes face the fixed driver eye; separate pale exterior faces make the
mirror bodies read in outside views. Camera anchors and yaw remain unchanged;
housings sit behind the driver-facing display planes. Render-target behavior,
UVs and the 15 FPS update cap remain unchanged. Displays are view proxies, not
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
| Sedan | 3,270 | 43 / 31 | 240,280 |
| CUV | 3,390 | 42 / 30 | 248,452 |

Both vehicles remain below the 10,000-triangle limit. Selected vehicle and
environment payloads remain below 5 MB:

| Selected pair | Uncompressed bytes |
|---|---:|
| Sedan + garage | 422,872 |
| Sedan + roadside | 403,044 |
| CUV + garage | 431,084 |
| CUV + roadside | 411,256 |

Parked lesson cars reuse only the selected vehicle's exterior and wheels,
including static glazing but excluding cockpit/live mirror surfaces. Their
measured geometry is 2,302 Sedan triangles and 2,422 CUV triangles; both
remain below the 4,000-triangle cap.

## Real-render verification

The Phase 8 Chromium fixture loaded each vehicle/environment pair and all five
parked lesson scenes. Ten browser cases passed with no page errors. Main-pass
calls stayed below the sandbox limit of 100 and lesson limit of 140.

| Scene | Main calls / triangles | Mirror calls | Overhead | Composite | Full-frame calls |
|---|---:|---|---:|---:|---:|
| Sedan + garage | 28 / 3,512 | 36 + 19 + 19 | 41 | 1 | 144 |
| Sedan + roadside | 24 / 3,332 | 34 + 19 + 19 | 41 | 1 | 138 |
| CUV + garage | 28 / 3,644 | 35 + 19 + 19 | 40 | 1 | 142 |
| CUV + roadside | 24 / 3,464 | 33 + 19 + 19 | 40 | 1 | 136 |
| Stage 1, CUV | 73 / 8,388 | 35 + 21 + 21 | 40 | 1 | 191 |
| Stage 2, CUV | 24 / 3,480 | 78 + 21 + 21 | 40 | 1 | 185 |
| Stage 3, CUV | 36 / 4,550 | 57 + 20 + 29 | 64 | 1 | 207 |
| Stage 4, CUV | 25 / 3,492 | 59 + 21 + 24 | 41 | 1 | 171 |
| Stage 5, CUV | 27 / 3,576 | 55 + 20 + 29 | 60 | 1 | 192 |

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
  — 67 tests passed.
- `npm test` — 518 tests passed across 31 files.
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
