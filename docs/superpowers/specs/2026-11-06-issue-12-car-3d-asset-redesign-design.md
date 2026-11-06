# Issue #12 Design: Car 3D Asset Redesign

**Status:** Approved

**Date:** 2026-11-06
**Issue:** [#12 — Redesign the car 3D assets](https://github.com/nguyenviettung7691/park-core/issues/12)

## Intent

Improve the Sedan and CUV's low-poly 3D artwork so the cars feel enclosed and
recognizable from outside and their cockpits feel complete from the driver's
view. Issue #12's references and requested details are the visual target. The
current Phase 8 generator already provides shaped bodies, seats, a floor/roof,
dashboard, gauges, and mirrors; this update must improve those assets rather
than repeat that work.

## Owner decisions

- Revisit both vehicles' visible geometry as one coordinated redesign, rather
  than limiting changes to added trim.
- Treat Issue #12's first image as the Sedan reference and its second image as
  the CUV reference. They guide the visual direction rather than require exact
  geometry; the issue's listed shortcomings are the acceptance targets, adapted
  to the existing simulator contracts.
- Keep the dashboard and all modeled indicators static artwork. Do not connect
  gauges, gear/parking indicators, or turn signals to simulator state.
- Preserve the current vehicle profile dimensions, physics colliders, runtime
  driver-eye and mirror-camera anchors, renderer, and asset-generation pipeline.
  Visible mirror displays and housings may be reshaped/repositioned separately
  from their camera anchors to improve cockpit sightlines.
- Keep the established low-poly style, original palettes, and no-texture,
  deterministic GLB generation. New creative geometry follows the existing
  CC BY-NC 4.0 artwork license.
- After implementation, write a separate detailed change record under
  `docs/` and create a pull request for issue #12.

## Goals and boundaries

| Category | Definition |
|---|---|
| Goals | Redraw the Sedan and CUV exterior/cabin geometry; visually close gaps between body panels; make the Sedan hood longer and trunk shorter within the existing envelope; improve side-mirror visibility from the cockpit and make the rearview display smaller/higher; model a fuller static cockpit with an instrument cluster and signal/parking indicators, pedals, console/storage, door panels, floor and seating; retain valid named asset nodes and generated GLBs |
| Non-goals | Live telemetry or functional indicators; changes to vehicle handling, profiles, colliders, lesson layouts, camera behavior, or mirror-camera projection; new asset tools, dependencies, textures, shaders, or dynamic lighting; production/manufacturer-accurate models |
| Anti-goals | Breaking cockpit sightlines or mirror render targets; extending visible geometry outside the validated vehicle envelope; increasing asset/render budgets without need; replacing original artwork with unlicensed or externally sourced models; claiming manual, hardware, or training validation from software tests |

## Approaches

| Approach | Benefits | Tradeoffs | Decision |
|---|---|---|---|
| Focused polish of the current shells, adding cabin details and patching obvious seams | Lowest regression risk and least geometry work | Leaves the current overall proportions and cabin framing largely unchanged, so it may not resolve the immersion problems together | Rejected |
| Coordinated exterior and cockpit geometry redesign for both vehicles, keeping physics and runtime contracts fixed | Can address the shell, proportions, mirrors, and cockpit as a consistent visual design while retaining the existing simulation | More geometry and sightline validation; visible meshes must remain within existing dimensions and named-node contracts | Chosen |
| Rebuild the vehicles and revise profiles, colliders, camera anchors, or physics to fit | Unconstrained physical and visual refit | Expands the issue into simulation/lesson changes and risks vehicle clearance and existing behavior; unnecessary for a visual redesign | Rejected |

## Asset and runtime constraints

- Edit the original vehicle definitions in `tools/asset-designs/vehicles.mjs`
  and regenerate GLBs with `node tools\generate-assets.mjs`; do not hand-edit
  binary assets.
- Keep each vehicle's declared dimensions, root origin, center-of-mass
  convention, `Body` fit, wheel node names, and independently animated wheels
  compatible with `src/vehicle/profiles.ts` and the loader contract.
- Keep `DriverEye`, `MirrorRear`, `MirrorLeft`, and `MirrorRight` camera-anchor
  transforms unchanged. Surface and housing meshes may move relative to those
  anchors only as needed for visibility, while preserving mirror UVs and the
  existing render-target update behavior.
- Keep geometry in meters, +Y up, -Z forward. Maintain outward-only opaque
  driven-car glazing, open interior sightlines, the existing parked-glazing
  variant, and the distinction between exterior and cockpit groups.
- Keep Sedan and CUV each under the existing 10,000-triangle vehicle limit and
  selected vehicle/environment pairs under the 5 MB payload limit. Avoid new
  materials/objects where existing geometry merge patterns apply.
- Add static gauge faces/needles and indicator lamps as modeled geometry. Do not
  introduce per-frame updates, simulator state dependencies, labels that
  require textures, or new UI behavior.
- Keep any new artwork provenance/license metadata consistent with the
  existing asset pipeline and attribution.

## Validation

Extend the generator and real-loader tests to cover the redesigned geometry
and preserve its contracts: generated deterministic GLBs and budgets; required
nodes/dimensions; closed exterior coverage; hood/trunk proportions; cockpit
contents and forward sightlines; rear/side mirror visibility and display size
or placement; glazing and parked variants. Keep relevant renderer/browser
coverage for actual loaded assets and mirror passes. Regenerate and commit the
four existing GLBs as appropriate, then run focused asset tests, the project
test suite, typecheck, production build, browser tests, and `git diff --check`.

Software checks do not replace manual cockpit/mirror-landmark and vehicle
clearance validation on reference hardware. Report those as pending unless
they are actually performed.

## Documentation and delivery

After implementation, add `docs/update-12-car-3d-asset-redesign.md` describing
the final geometry changes per vehicle, preserved runtime/physics contracts,
regressions added, generated assets and captures updated, commands run, and
remaining manual validation limits. Update the asset catalog/pipeline only
where the new generated assets make their existing descriptions or captures
inaccurate. Create a pull request linked to issue #12 and include a concise
implementation summary plus verified checks and outstanding limits.

## Builder discretion

- Choose simple low-poly geometry and any detail placement that best matches
  the provided visual references without changing the approved contracts.
- Add focused measurable test assertions for visual mesh bounds, node presence,
  and ray-based visibility; avoid brittle exact vertex snapshots.
- Decide whether current Phase 8 screenshots need replacement after inspecting
  actual regenerated renders. Do not claim a visual improvement based only on
  geometry metrics.
