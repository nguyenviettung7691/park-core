# Phase 5 Detailed Design: Assets and Progression Foundation

**Status:** Implemented; software gates passed. Owner sign-off is pending
before merge or push.
**Approved design:** [Original-assets and progression design](superpowers/specs/2026-11-04-phase-5-assets-progression-design.md).

## Intent and phase mapping

Deliver reproducible vehicle/environment GLBs, a validated asynchronous loader,
and honest local progress/settings/calibration persistence. Add a five-stage
selection surface without inventing lesson completion. The learner can drive
Stage 1 as the existing Garage sandbox; Stages 2-5 remain locked until a future
lesson runtime reports confirmed success.

This work spans the technical design's Phase 5 asset foundation and the
persistence/progression foundation formerly grouped under Phase 6. It does not
deliver the curriculum or parking evaluation. Repository numbering and
technical-design numbering differ; the technical roadmap is reconciled in
[`tech-design.md`](tech-design.md).

## Goals and boundaries

| Category | Definition |
|---|---|
| Goals | Four original reproducible GLBs; named vehicle anchors; separate collider metadata; validated/cancellable selected-pair loading; exact resource ownership; versioned local records; contiguous stage unlocks; Vietnamese status and recovery UI |
| Non-goals | Lesson briefings/checkpoints, parking-success evaluation, stage-specific driveable routes, collision outcomes/recaps, production artwork, Blender tooling, external asset acquisition, hardware or instructor validation |
| Anti-goals | Unlocking from preview use; debug/manual completion controls; deriving colliders from visual meshes; overwriting unreadable saves; treating software tests as proof of training readiness |
| Fidelity limit | The models are low-poly, static, code-authored prototypes with vertex color. They are not production models, measured vehicle scans, image-based light bakes, validated sightlines, or release art. |

## Approaches

The approved choice is deterministic, code-authored low-poly GLBs loaded through
Three.js `GLTFLoader`. Runtime Three.js primitives would not exercise the GLB
asset contract; downloaded models would add unverified licensing, scale, and
anchor risks. The chosen approach is original and reproducible, but intentionally
trades visual fidelity and texture baking for a small dependency-free pipeline.

## Asset contract and measured outputs

`tools/generate-assets.mjs` writes the four checked-in binary glTF 2.0 files.
Vehicle roots use the profile center of mass, dimensions in meters, +Y up, and
-Z forward. They include separate body/wheel nodes, `DriverEye`, named rear and
side mirror anchors/surfaces, and basic cockpit geometry. Environment roots
include visible markings and geometry groups; the garage ceiling is separable.
`src/world/colliders.ts` remains authoritative for physics and is not generated
from visual geometry.

| Asset | Dimensions (m) | Named nodes | Triangles | File bytes |
|---|---:|---:|---:|---:|
| Sedan | 1.8 × 1.45 × 4.6 | 24 | 640 | 54,500 |
| CUV | 1.8 × 1.62 × 4.35 | 24 | 640 | 54,508 |
| Roadside | 50 × 3 × 32 | 17 | 168 | 27,232 |
| Garage | 30 × 6 × 30 | 23 | 216 | 34,812 |

Triangle counts sum indexed glTF primitive index counts divided by three.
The largest selected pair is CUV + Garage at 89,320 bytes before transport
compression, well below the 20 MB design budget. The generator and files are
original project work; no third-party model or texture is included. Materials
use static vertex colors and glTF's unlit material extension; there are no
image textures or baked texture maps.

## Loading, validation, and ownership

`loadSceneAssets(environment, vehicle, signal, onProgress?)` fetches only the
selected pair. It validates the GLB v2 container, root, required named nodes,
distinct wheels, effective body/cockpit bounds, driver/mirror transforms,
environment floor and ceiling grouping, and dimensions against explicit
metadata within 0.02 m. Returned vehicle anchors are vehicle-root-relative.
A typed `AssetLoadError` identifies the vehicle or environment resource. The
app shows an indeterminate loading state unless a response has a known content
length.

Abort and app-generation checks prevent stale loads from starting a session.
Any successfully parsed result that becomes stale is disposed, not attached.
The app owns the loaded set until preview creation succeeds; preview then owns
and disposes it. Resource cleanup is idempotent. Explicit collider arrays stay
separate from GLB nodes and meshes.

## Progression and persistence

- `park-core.progress.v1` stores completed stage IDs and the last vehicle.
  Unlocks derive from the contiguous completed prefix; a stored unlock number
  is never trusted.
- `park-core.settings.v1` stores validated settings; `park-core.calibration.v1`
  stores stable device-ID calibration entries, never gamepad array indices.
- Missing keys use defaults. Malformed, unsupported, or invalid records remain
  unchanged and enter `reset-required`; only a confirmed key-specific reset
  removes that record.
- A storage access/write failure is reported as session-only; failed writes
  are not presented as saved.
- The typed `recordConfirmedStageSuccess(stageId)` boundary is available to a
  future lesson outcome. No menu, preview, or debug action calls it.

All learner-facing labels, loading/error messages, locked-stage states, and
reset confirmations are Vietnamese. Locking does not rely on color alone.

## Verification and limitations

Automated acceptance covers deterministic generation/GLB budgets, loader
validation and cancellation, explicit colliders, persistence/recovery, stage
locks, loading errors, all four asset combinations through WebGL, and repeated
preview teardown. Exact final command results are listed in the
[implementation plan](phase-5-implementation-plan.md).

Software validation does not establish production art quality, cockpit or
mirror sightlines, environment clearance, a feasible lesson route, real-wheel
compatibility, supported-Node behavior, reference-PC performance, or instructor
approval. These remain explicit follow-up evidence, not Phase 5 claims.
