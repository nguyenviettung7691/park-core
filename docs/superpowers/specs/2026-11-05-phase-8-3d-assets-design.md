# Phase 8: Original 3D Asset Design

Date: 2026-11-05

Status: Builder check complete; awaiting owner approval. No implementation authorized yet.

## Intent

Replace Park-Core's placeholder art with recognizable, original, restrained
low-budget-game assets. Improve learner immersion and spatial recognition
without changing driving mechanics, lesson difficulty, or the existing
lightweight rendering model.

The owner requested both vehicle types, environments and involved objects,
an illustrated asset catalog, refreshed README screenshots, and a pull request
after implementation and verification.

This is a project-sized art and integration change, not a cosmetic recolor.

## Confirmed decisions

- The roadside and garage concept directions are acceptable.
- Sedan and CUV must differ clearly in silhouette and palette.
- The CUV must look taller overall, not like a scaled sedan.
- Hood and rear ends must be easy to distinguish. Use a visibly rounded hood.
- The owner approved the revised vehicle direction described below.
- Use approach A: shaped geometry and vertex colors.
- New artwork uses CC BY-NC 4.0; application code remains MIT.

Concept drawings are brainstorming artifacts under the ignored
`.superpowers` directory, not shipped artwork or acceptance screenshots.
They establish character, not exact geometry or measured performance.

## Goals, non-goals and anti-goals

Goals:

- Recognizable generic cars, usable left-hand-drive cockpits, and coherent
  roadside and underground-garage environments.
- Readable front/rear orientation in chase, overhead and driver views.
- Visible representations of all existing lesson collision obstacles.
- Deterministic, editable original artwork with measured geometry, transfer
  and draw-call budgets.
- Preserve existing simulator behavior and lesson routes.

Non-goals:

- Photorealism, licensed real-world car replicas, new vehicle types or maps.
- Traffic, pedestrians, opening doors, vehicle damage or new gameplay.
- New physics, changed collision dimensions, changed lesson tolerances,
  new progression, redesigned HUD, or changed camera controls.
- Dynamic shadows, lighting cycles, custom shaders, high-resolution textures,
  or changes to the existing 15 FPS mirror cap.

Anti-goals:

- Opaque placeholder boxes inside the driver's sightlines.
- Decorative collision-looking objects that can be driven through.
- Distinguishing the two vehicles by color alone.
- Attractive screenshots hiding broken mirrors, wheels or training guidance.
- Calling noncommercial artwork "open source" or claiming unmeasured
  upper-mid-range-PC performance.

## Current architecture and constraints

`tools\generate-assets.mjs` produces four self-contained GLBs: sedan, CUV,
roadside and garage. They use unlit vertex colors and no external textures.

`src\world\assets.ts` validates metric dimensions, root transforms, named
nodes, body bounds, cockpit containment, driver-eye and mirror anchors, and
environment floors. Wheel nodes are animated from physics in
`src\render\asset-scene.ts`. Mirror surfaces and the garage ceiling use
special rendering layers. Preserve these behaviors.

The existing Body mesh occupies the complete vehicle bounds as a solid box.
Replace its actual surfaces with a shaped shell rather than keeping an
opaque validation box underneath the new artwork. Preserve its required
overall bounds and named-node contract where possible; change assumptions
and their tests explicitly if a shaped shell requires a different hierarchy.
Do not weaken metric or anchor validation to accommodate artwork.

Physics dimensions in `src\vehicle\profiles.ts`, environment colliders in
`src\world\colliders.ts`, and lesson obstacles in
`src\lessons\scenarios.ts` remain authoritative. Keep meters, +Y up, -Z
forward, center-of-mass vehicle roots and identity export transforms.

`src\render\lesson-scene.ts` currently renders target/highlight planes but
not the scenario's parked-car obstacles. Adding their visible representations
is part of this phase, not permission to move or resize the collisions.

Keep Vietnamese learner-facing signage and English technical documentation.
Use vanilla Three.js and the existing generator; no new runtime dependencies.

## Approaches

### A. Shaped geometry and vertex colors — selected

Extend deterministic generation with shaped body sections, open window
apertures, wheels, cockpit parts and modular environmental geometry.
Use fixed vertex-color shading and merge compatible static geometry.

Benefits: directly extends the existing pipeline; no texture transfer or UV
mapping; reproducible original assets; simplest implementation of the
approved recognizable silhouettes.

Tradeoff: fine lettering and surface variation must be restrained and
represented by economical geometry or simple color regions.

### B. Shaped geometry and small original texture atlases — not selected

Use the same silhouettes with original generated textures for panel seams,
concrete, signs and dashboard details.

Benefits: richer surface detail without adding much geometry.

Tradeoff: UV mapping, image generation, filtering, texture memory and additional
validation enlarge the pipeline. The owner selected A because silhouette
recognition is the main gap.

## Vehicle art

### Sedan

Low, long, amethyst body with a three-box silhouette. Sloping windscreen,
defined separate trunk and restrained body contours. A rounded hood/nose
contrasts with flatter trunk surfaces, angular rear corners and red rear lamps.

### CUV

Warm ivory body with charcoal lower cladding and wheel-arch trim. Higher,
more upright cabin, taller glass, larger tires, roof rails, shorter-looking
hood and near-vertical rear hatch. Use vertical rear lamps and different
front lamp/grille shapes from the sedan.

Preserve actual body sizes: sedan 1.8 x 1.45 x 4.6 m and CUV
1.8 x 1.62 x 4.35 m. Make the real 17 cm roof-height difference visible
through proportions; do not exaggerate it by changing the physical profiles.
Required mirrors remain outside the body within their existing profile widths.

### Shared detail and cockpit requirements

- Shaped bumpers, wheel arches, lamp clusters, grille, handles, subtle door
  seams, mirror housings and simple alloy wheels.
- Real window apertures, not dark opaque boxes. Prefer open apertures over
  transparent glass materials to avoid sorting and mirror overdraw.
- Economical dashboard, instrument shapes, steering wheel with hub/spokes,
  front seats, rear-seat silhouette, floor, roof interior and supporting pillars.
- Driver-eye and mirror anchor transforms unchanged. No roof, dashboard,
  hood, window substitute or hidden shell blocks the forward/rear sightlines.
- Preserve independent animation of all four wheels and the replaceable
  mirror surfaces. Merge wheel details within each animated wheel, not
  into the static body.
- Original unbranded designs; no manufacturer badges or copied meshes.
- Static lamp colors are artwork, not a new working-lights feature.

## Environments and involved objects

### Roadside

Readable asphalt and sidewalk surfaces, curb joints, existing fence detail,
parking markings and restrained frontage/background architectural detail.
Fixed color regions provide surface variation without textures.

Keep the existing curb, fence and roadside block collision footprints.
Give the block a recognizable low concrete-barrier treatment. Any background
frontage must sit outside the reachable driving surface or behind an existing
physical boundary; do not add solid-looking traversable scenery.

### Underground garage

Concrete floor/wall seams, restrained wall bands, bay identifiers,
pillar protection, overhead pipes and static light-fixture geometry.
Make bays, pillars and walls readable without competing with target guidance.

Preserve garage wall/pillar dimensions and keep overhead additions in the
existing ceiling group/layer so the overhead view remains usable.
Represent light fixtures with unlit bright faces, not new light sources.

### Lesson objects

Every existing `scenario.obstacles` collider represents a parked vehicle.
Render a simplified recognizable stationary car for each, reusing original
vehicle art where practical without creating physics vehicles or loading
unnecessary interactive cockpits.

Place and orient each representation from the collider metadata. Fit its
outer bounds to the collider's dimensions, preserving existing narrow
adjacent-vehicle obstacles rather than substituting full-size collisions.
Keep visible ends and sides close to collision extents; retain simple box
collision approximation and document that curved silhouettes are not
per-polygon physics.

Keep region, trajectory, sensor and target overlays functionally unchanged.
Do not bake misleading target bays into environment art that contradict
the selected lesson; align or omit conflicting generic parking markings.
Free drive may retain appropriate generic markings.

## Proposed engineering budgets and implementation calls

These are author-proposed hard acceptance gates, not prior owner requirements.
Approval of this design adopts them. Do not silently relax them during
implementation; a required budget change needs owner agreement:

- At most 10,000 triangles per interactive vehicle, including cockpit.
- At most 30,000 triangles per environment.
- At most 4,000 triangles per stationary lesson vehicle.
- At most 100 draw calls for one ordinary vehicle/environment scene render;
  at most 140 with the existing lesson obstacle cars and guidance.
- At most 5 MB of uncompressed selected vehicle/environment GLBs, including
  any shared asset payload needed for the selected scene.
- No image textures and no external GLB resources.

Measure actual counts. Draw-call limits apply per main scene pass, not an
incorrect total that ignores or conflates mirror and overhead passes.
Report full-frame multipass costs separately using existing instrumentation
or a narrowly scoped test fixture. Avoid one draw call per seam or marking.

Merge compatible opaque static meshes by material/rendering behavior while
preserving named validation nodes, wheels, mirror surfaces, ceiling layer
and disposal ownership. Unlit fixed shading replaces runtime illumination.

The approved performance target remains 2560 x 1440 at 60 Hz:
p95 <=17.5 ms, mean >=57 FPS and zero loss under the existing benchmark
definition. Record available browser/hardware/rendering context truthfully.
Software-rendered automation cannot verify upper-mid-range-PC compatibility;
reference-hardware validation remains explicitly pending if unavailable.
144 Hz is not an acceptance requirement.

## Licensing and provenance

Keep the root MIT license for application and functional tooling code.
Explicitly exclude newly authored artwork from the root license's scope.

Apply CC BY-NC 4.0 to new GLBs, their creative source geometry/palette
definitions and new artwork-focused images. Separate reusable generator
mechanics from creative asset definitions sufficiently to identify the
license boundary unambiguously; exact file organization is left to planning.
Provide attribution, license links and clearly scoped notices beside the
artwork and its source definitions.

Update README licensing and the asset provenance documentation. Describe the
artwork as freely available, noncommercial/source-available, not OSI-open-source.
Code remains open source. Preserve existing MIT grants for earlier versions;
do not claim the new license revokes historical permissions.

New screenshots containing artwork must carry a clear documentation notice:
the repository's MIT source license does not override the artwork restriction.
Do not apply a new restriction to unrelated existing code or documentation.

Use only original project-generated shapes and colors; no downloaded art,
third-party textures, manufacturer designs or reference-photo tracing.

## Validation and delivery

1. Verify deterministic generation, GLB validity, required nodes, dimensions,
   bounds, anchors, resource ownership and the new geometry/transfer budgets.
2. Load all four vehicle/environment combinations in real WebGL browser checks.
   Exercise wheel animation, mirrors, ceiling exclusion and overhead rendering.
3. Check both cars from front/rear three-quarter and driver views. Check hood,
   rear visibility and recognizable height/palette differences. Add focused
   regressions for newly fixed sightline or lesson-obstacle integration issues.
4. Verify visible parked obstacles and unchanged lesson completion behavior
   for all five stages and both vehicles using existing browser journeys.
5. Run the existing unit tests, typecheck, production build, browser checks and
   production checks needed for affected behavior. No new test framework.
6. Measure triangle counts, draw calls, payload sizes and available benchmark
   results, with limitations clearly labeled. Optimize art if budgets fail.
7. Capture actual rendered assets after implementation, not concept SVGs.
   Add `docs\phase-8-asset-catalog.md` with asset inventory, representative
   pictures, dimensions, counts, provenance, licenses and verification limits.
   Include both exteriors and cockpits, both environments, lesson parked cars,
   and representative small-prop details; collages may cover modular pieces.
8. Refresh README pictures with real updated app screenshots showing the
   vehicles in their environments. Keep useful existing selection-screen
   coverage, add driving imagery and descriptive alt text, and link the catalog.
9. Update the existing asset pipeline/prototype status descriptions and phase
   roadmap only where this phase changes their accuracy.
10. Commit the work on a dedicated branch and create a PR against `main` after
    verification. Include evidence and unresolved hardware/manual-review
    limitations. Do not merge the PR automatically.

Preserve the two unrelated untracked README design/plan documents found in the
working tree; do not include them in Phase 8 commits.

## Left to the builder

Choose exact vertex topology, modest color shades within the confirmed
palettes, static shading factors, mesh batching layout and art-source file
organization. Choose practical catalog camera positions, image grouping and
focused test locations using existing repository conventions.

No separate asset editor, runtime configuration system, public asset-gallery
feature, additional environment or artistic tooling dependency is requested.

## Builder check

The independent builder check raised one question: whether the proposed
resource budgets block delivery. The author resolved it by making them hard
acceptance gates subject to the owner's approval of this document. No additional
owner-only requirement questions were identified.
