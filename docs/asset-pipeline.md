# Asset Pipeline: Original Phase 8 GLBs

## Generate and edit

From the repository root:

```powershell
node tools\generate-assets.mjs
```

The deterministic Node-only generator writes four binary glTF 2.0 files with
embedded mesh data, static vertex colors and `KHR_materials_unlit`.
No downloaded art, image textures, external GLB resources, Blender requirement,
new runtime dependencies, dynamic shadows or custom shaders are involved.

- `tools\generate-assets.mjs`: metric profiles, GLB writer and CLI.
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
RenderTargets; camera anchors remain unchanged.
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
