# Mirror reflections, default alignment and live adjustment (issue #9)

## Intent

In cockpit view the rear-view ("overhead") mirror and both side mirrors must look
and behave like real car mirrors, so parking practice transfers to a real car:
believable size/distance in the reflection, side mirrors aimed the way a typical
driver sets them, and the ability to adjust each mirror like in a real car.

## Current state (why it looks wrong)

- `src/views/cameras.ts` renders each mirror from an independent camera placed at the
  mirror anchor with a fixed symmetric FOV: rear 50° vertical on a 512x128 target
  (~130° horizontal), sides 75° on a square 256x256 target. A real flat mirror shows
  only the ~15-25° cone the eye sees through the glass, so the image is strongly
  minified. The square side targets are also stretched onto 0.18x0.10 m glass.
- `src/vehicle/asset-contract.ts` aims the side cameras at ±105° yaw (only 15° short
  of pointing straight sideways). The authored glass face yaw in
  `tools/asset-designs/vehicles.mjs` (`authorMirrors`) is derived from that camera yaw.
- There is no mirror adjustment.

## Goals

1. Physically based planar reflection for all three mirrors, from the fixed driver eye.
2. Realistic default aim for both side mirrors and the rear-view mirror.
3. Live in-cockpit adjustment of each mirror, saved per vehicle, with reset.

## Non-goals

- Head movement/parallax: mouse-look rotates the view but does not move the eye, so
  reflections don't change with look direction (true to a fixed head position).
- Gamepad bindings for adjustment (keyboard only in this issue).
- Power-folding mirrors, auto-dimming, blind-spot indicators.
- Retuning handling, lessons, colliders or the parking footprint.

## Anti-goals

- Exceeding the existing budgets: mirrors stay capped at 15 FPS, no extra draw passes,
  main-pass draw-call and triangle gates unchanged.
- Glass that points one way while its image shows another.
- Letting adjustment interfere with driving (arrow keys must not both steer and tilt).
- Bypassing the asset workflow's candidate review: regenerated GLBs need developer
  visual approval before they're copied to `public/assets/vehicles`.

## Approaches considered

1. **True reflection off the glass (chosen).** Each mirror pass reflects the driver eye
   across the glass plane and renders from that virtual eye through the four glass
   corners using an off-axis frustum whose near plane is the glass plane. Optically
   correct, so proportions need no tuning. Adjustment is just rotating the glass.
   Reuses existing render targets and the 15 FPS cap.
2. **Retune the independent cameras.** Cheaper, but the image is never tied to the
   glass, so proportions stay guesses and glass/image can disagree. Rejected.
3. **three.js `Reflector`.** Re-renders at full frame rate from the main camera, breaks
   the 15 FPS cap and budgets, and doesn't fit authored glass/UV contract. Rejected.

The developer picked approach 1 with the defaults below.

## Design

### Reflection math (`src/views/mirror-optics.ts`, new, pure functions)

Inputs (vehicle-local or world, consistently): eye E; glass centre P, unit normal N
(glass mesh local +Z, facing the eye), glass right axis R and up axis U (local +X/+Y),
glass half-size (w, h); convexity factor k ≥ 1; far distance.

- Virtual eye E' = E − 2((E − P)·N)N.
- Camera at E', orientation: camera −Z = +N (looks through the glass away from the
  eye), camera +X/+Y from R/U (sign chosen so the authored UV + existing horizontal
  `repeat.x = -1` flip shows a correct mirror image; pinned by a test, see below).
- Distance d = (P − E')·N. Glass corners in camera space give the off-axis extents
  left/right/top/bottom at depth d (centre offset of P relative to E' projected onto
  R/U). Near = d (the glass plane, so the housing/door behind the glass is clipped),
  far = 100 m. Convex mirrors scale the four extents by k about the glass centre.
- Set via `camera.projectionMatrix.makePerspective(l, r, t, b, near, far)` and update
  `projectionMatrixInverse`; never call `updateProjectionMatrix()` on mirror cameras.
- Render target aspect derives from glass aspect (largest side 512 px for rear, 256 px
  for sides at high quality; halved at low quality), replacing the fixed `MIRROR_SPECS`.

Per mirror pass the camera pose is recomputed from the glass mesh's current world
transform and `anchors.driverEyeLocalM`, so it follows the vehicle and any adjustment.

### Glass dimensions and convexity (my calls, reviewable in the asset review)

| Mirror | Glass (W x H) | k (convexity) |
|---|---|---|
| Rear-view | 0.24 x 0.06 m (was 0.18 x 0.045) | 1.0 flat |
| Driver (left) | 0.22 x 0.13 m (was 0.18 x 0.10) | 1.0 flat |
| Passenger (right) | 0.22 x 0.13 m | 1.3 slightly convex |

Sizes follow typical passenger-car mirror glass. With the contract positions (driver
glass ~1.0 m from the eye, passenger ~1.55 m) a true reflection gives roughly 11-12°
horizontal view on the driver side and ~13° on the passenger side with k = 1.3. That's
close to the legal minimum for a flat driver mirror (FMVSS-111: a 2.4 m lane at 10.7 m
behind, ~13°), so it's realistic. The earlier "15-25°" estimate was too generous.
Colliders stay unchanged; the glass already overhangs the 0.12 m mirror box slightly,
and the asset review checks the housing against the collision envelope.

Vehicles are left-hand drive (driver eye x = −0.36), so left = driver side.

### Default alignment (`src/vehicle/asset-contract.ts`)

Replace `mirrorYawRad` (camera yaw) with a desired **reflected centre ray** per mirror,
from which the glass orientation is computed: N = normalize(toEye + reflectedDir)
(reflection law, bisector), where toEye is the unit vector glass → eye.

- Side mirrors: the common "sliver of your own car" setting. The rule, in priority
  order: (1) the inner (car-side) edge of the horizontal view points 1° inward of the
  vehicle's rearward axis, so the flank fills a thin strip on the inner edge; (2) the
  centre ray is pitched so the horizon sits slightly above the middle (about 3° down).
  The yaw follows from the view width, roughly 5° outward for the driver and 6° for the
  passenger, which also answers the issue's "turned outward too much". The default
  rays are computed from this rule in the contract, not hard-coded. A unit test asserts
  that the body side is visible on the inner edge and absent from the outer 80% of the
  image. (The wider "blind-spot" setting, about 15° outward, stays reachable by
  adjustment.)
- Rear-view: centre ray passes through the middle of the rear window, i.e. straight
  back along the vehicle axis, pitched down ~2°.

The contract exposes, per mirror, the glass pose (position + full quaternion, yaw
*and* pitch) and glass half-size. Positions are unchanged (side glass at the existing
`mirrorBoxes` centres, rear at `rearDisplayM`). Colliders/mirror boxes are unchanged.

### Asset contract and GLBs

- `authorMirrors` uses the contract glass pose and size directly instead of deriving
  face yaw from a camera yaw. Housings stay fixed; only glass moves at runtime.
- `MirrorRear/Left/Right` nodes become the **glass pivot**: same position as the glass,
  default glass rotation. `validateVehicleScene` checks the full quaternion (not just
  yaw) against the contract; `MirrorSurface*` must sit at its pivot with matching
  rotation and the contract half-size (within tolerance).
- Regenerate sedan and CUV through the candidate loop in `docs/asset-pipeline.md`
  (`assets:generate` → `assets:check` → `assets:review`), present reference/before/after
  captures of neutral cockpit and all mirror faces, and wait for approval before copying
  into `public/assets/vehicles`.
- The prototype box scene (`src/render/prototype.ts`) uses the same contract poses/sizes
  so the fallback path behaves identically.

### Adjustment state (`src/views/mirror-adjust.ts`, new)

- Per mirror: `{ yawRad, pitchRad }` offset from default, clamped to ±12° each
  (typical power-mirror range; rear-view uses the same range).
- Applied as glass quaternion = default × yaw(about glass up) × pitch(about glass right),
  rotating about the glass centre. Reflection follows automatically.
- Rate: 8°/s while a key is held, frame-rate independent.
- `ViewSystem` gains `setMirrorAdjustments(value)`, `adjustMirror(id, dYaw, dPitch)`
  and `resetMirrors()`; it reports changes through a callback for persistence.

### Controls

- **M** cycles the selected mirror: off → left → right → rear → off.
- While a mirror is selected, **arrow keys** tilt it (left/right = yaw, up/down = pitch)
  and do not drive. WASD keeps driving behaviour unchanged.
- Selection only works while the car is stopped (below 0.1 m/s, the gear-change threshold)
  and the gear is P or the parking brake is on (added in PR review). Selecting
  otherwise shows a status notice; leaving P/releasing the brake, pausing, or Escape
  deselects.
- The selected mirror's glass gets a thin highlight outline (on the mirror-excluded
  layer, so it doesn't appear in reflections), and the HUD status line names it.
- `src/input/controller.ts` owns key routing: a mirror-adjust mode that diverts arrow
  keys from movement to an adjust axis exposed on the poll result. Movement-key
  suppression rules (held/suppressed sets) apply on mode changes so no key "sticks".
- All new UI text is Vietnamese in `src/messages.ts`.

### Persistence and reset

- `SettingsSaveV1` gains optional `mirrorAdjustments: Record<VehicleId,
  Record<MirrorId, { yawDeg, pitchDeg }>>`. Missing or invalid entries parse to zero
  offsets (old saves stay valid, no version bump). Values are clamped on load.
- Saved on deselect (not every frame).
- View settings panel gets a "reset mirrors" button for the current vehicle.

## Delivery order (my call)

Single branch, no PR until the GLBs are approved:
1. Pure optics, contract, adjustment, controls and persistence, tested against the
   prototype scene and unit fixtures.
2. Regenerate candidates outside `public`, run `assets:check`/`assets:review`, and
   present reference/before/after captures in this conversation. **Stop for developer
   approval.**
3. After approval: copy the approved GLBs, tighten `validateVehicleScene` to the full
   glass quaternion/size, update provenance/catalog evidence, rerun all checks.

The checked-in GLBs are stale between steps 1 and 3, so the full suite is only
expected green after step 3. No loader compatibility path for the old poses is written.

## Testing

- Unit (`mirror-optics`): virtual eye symmetry; a world point seen by the eye via the
  glass centre projects to the glass centre UV; a point at a glass corner's reflected
  ray lands at that corner UV (pins axis/flip signs); near plane equals glass plane;
  k scales the visible angle; flat mirror visible angle ≈ glass angular size × 1.
- Unit (contract): default reflected centre rays match the spec; the inner edge of both side views
  shows the body flank (per the alignment rule); quaternions are finite and normalized.
- Unit (adjust/controller): clamping, rate, P/brake gating, arrow diversion and
  restoration, M cycling, deselect on gear change/pause/Escape.
- Persistence: round-trip, missing field, malformed values, clamping.
- Existing `views.test.ts` mirror tests updated to the new contract (glass in driver
  frustum, glass facing away from housing, throttling and low-quality halving).
- Browser: `driving.spec.ts` covers select → tilt → reflection pixels change → reset.
- Asset workflow: generator/loader/view tests, `assets:check`, `assets:review` captures.

## Left to the builder

- Exact highlight style and HUD placement.
- Whether render-target sizing rounds to powers of two.
- Small numeric tweaks (±3°) to the pitch or the 1° inward margin found necessary in
  the review captures, recorded in the review notes.

## Validation limits

CI/SwiftShader screenshots don't verify optical calibration on real displays or
1440p60 performance; mirror realism remains a developer visual judgement.
