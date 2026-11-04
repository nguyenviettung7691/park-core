# Phase 5 Design: Original Assets and Sequential Progression

**Status:** Approved by project owner
**Date:** 2026-11-04
**Implementation branch:** `phase-5-assets-progression`

## Intent

Complete the repository's Phase 4 asset-loading work and Phase 5 linear
progression work on the existing Phase 4 prototype. Supply original,
prototype-grade Sedan/CUV and roadside/garage GLB assets through a validated
loader, plus honest versioned persistence and a sequential stage-selection
surface. This gives the next phase real content and a durable progression
boundary without pretending lessons or parking evaluation already exist.

The codebase already has `SceneAssets`, camera/mirror anchors, vehicle profiles,
`ProgressSaveV1`, versioned settings and calibration contracts, and a
disposable prototype scene. `src/app.ts` still hardcodes empty progress and
starts that prototype synchronously. There are no GLB/source-art files or
asset-loader/storage modules. The implementation therefore adds an asynchronous
asset boundary and safe persistence rather than extending the prototype with
fake stage outcomes.

## Owner decisions

- Implement both original low-poly asset loading and Phase 5 progress/unlock
  behavior; do not defer asset loading merely because the technical design
  numbers it Phase 5.
- Author the four assets in code and produce reproducible GLB files. Do not
  import unvetted third-party models.
- Include persistent progress, settings and controller calibration. Never
  persist active motion, attempt state, raw controller samples or personal data.
- Record completion only through a typed confirmed-success boundary. Until a
  future lesson system emits that result, later stages stay locked in the live
  application; do not add a test/debug/manual “win” action.
- Defer lesson instructions/checkpoints, parking evaluation, failure handling,
  attempt recaps and stage-path feasibility acceptance.
- Use Vietnamese for learner-facing UI/errors and retain the existing
  TypeScript, Vite, Three.js, Cannon-es and vanilla DOM stack.

## Goals and boundaries

| Category | Definition |
|---|---|
| Goals | Four original GLBs; deterministic code source; dimension/named-node/anchor validation; explicit static collider metadata; cancellable async loading and exact resource ownership; stage 1 entry with stages 2-5 visibly locked; contiguous unlock calculation; versioned progress/settings/calibration storage and recovery |
| Non-goals | Lesson step runtime, training prompts, parking target evaluation, collision outcomes/recaps, authoring a driveable route for each lesson, external asset acquisition, Blender tooling, instructor or hardware validation |
| Anti-goals | Unlocking from preview use, user-controlled debug completion, trusting a stored highest-stage number, inferring colliders from visual meshes, silently overwriting corrupt/future saves, claiming prototype models or software tests prove training readiness |
| Fidelity limit | Assets are intentionally simple low-poly geometry with static authored color/shading. They are original prototypes, not production vehicle models, measured scans, validated sightlines or baked photorealistic lighting. |

Stage 1 may open the existing drivable sandbox with its authored garage and
selected vehicle. It is not a lesson and cannot complete or unlock a stage.
The persistence/progression API and its tests exercise completion independently;
only a later lesson outcome may call the production completion boundary.

## Approaches

| Approach | Benefits | Tradeoffs | Decision |
|---|---|---|---|
| Build Three.js primitives at runtime | Smallest implementation; easy to edit | No standalone GLBs, no GLTF loading/validation or export pipeline; misses the Phase 4 asset requirement | Rejected |
| Deterministic code-authored low-poly GLBs loaded through Three.js `GLTFLoader` | Original and reproducible; exercises the intended loader, node/anchor contract, async lifecycle and actual files | More authoring/validation work; flat vertex colors cannot provide production baked textures or art fidelity | Chosen by owner |
| Use downloaded community models | Could improve appearance quickly | No supplied models or verified redistribution rights; dimensions, cockpit anchors, named wheels and collider fit would be unknown | Rejected |

## Asset authoring and runtime contract

### Source and outputs

- Keep a small deterministic source generator in the repository and generate
  `public/assets/vehicles/sedan.glb`,
  `public/assets/vehicles/cuv.glb`,
  `public/assets/environments/roadside.glb`, and
  `public/assets/environments/garage.glb`.
- Use only original, flat-shaded low-poly geometry and embedded GLB materials.
  Encode a restrained baked-look palette/occlusion in static vertex colors;
  use no runtime dynamic shadows, weather, procedural city, extra renderer or
  image/decoder dependency.
- Keep each vehicle's root at the profile center of mass, dimensions in meters,
  forward along local -Z and up +Y. Include `Body`, `WheelFL`, `WheelFR`,
  `WheelRL`, `WheelRR`, `DriverEye`, `MirrorRear`, `MirrorLeft`, `MirrorRight`,
  and separately replaceable mirror surfaces. Keep the driver's seat, steering
  wheel, dashboard and windshield frame inside the vehicle asset.
- Keep each environment visual separate from authoritative collider metadata.
  Include ground/road or garage floor, visible parking markings, walls/curbs,
  garage pillars and a separately named ceiling/upper visual group for the
  existing overhead layer. Make geometry areas large enough to show the
  intended environment, but do not claim a lesson-specific feasible route.
- Keep geometry below the existing design budgets (vehicle/cockpit <=50k
  triangles; environment <=150k triangles; textures <=2048px; selected asset
  transfer <=20 MB). Record generated file byte sizes, triangle counts,
  node names, dimensions and declared provenance in `docs/asset-pipeline.md`.

The generated assets use static vertex color rather than image-based light-bake
textures because no Blender or source art is available and the owner selected
code-authored low-poly assets. This is a deliberate fidelity limitation, not a
claim that the original baked-texture target has been met.

### Metadata and loading

- Add explicit vehicle anchor/dimension metadata and per-environment
  `ColliderBox` arrays in TypeScript. Never construct physics from GLB mesh
  bounds or node names.
- Add `loadSceneAssets(environment, vehicle, signal)` over Three.js
  `GLTFLoader`. It loads only the selected vehicle/environment pair and
  produces the existing `SceneAssets` interface plus any required asset
  identity/layer metadata.
- Validate the GLB version, root and named vehicle nodes, four distinct wheel
  nodes, camera/mirror anchors, separable garage ceiling, and expected
  dimensions within 0.02 m of explicit metadata. Reject missing or malformed
  content with a typed resource category; do not silently substitute the
  prototype scene.
- Keep one asset-set owner for loaded geometries, materials and textures.
  `dispose()` is idempotent. Aborting a request prevents session start; a load
  that finishes after abort/generation change is disposed and never attached.
  Network abort is an optimization, not the stale-result correctness guard.
- Show an honest loading state. Report determinate progress only when total
  bytes are known; otherwise use an indeterminate indicator. Retry/Menu
  feedback identifies the failed resource category in Vietnamese.
- Keep the preview as the only renderer/RAF/physics-loop owner. Reset/menu,
  replacement load and disposal remove listeners and bodies and dispose the
  selected asset set exactly once.

## Progression and persistence

### Unlock model

- `park-core.progress.v1` stores the existing `ProgressSaveV1` shape:
  completed stage IDs and last selected vehicle. Do not store a separate
  unlocked-stage number; derive it from the contiguous completed prefix.
- Stage 1 is available for every new learner. Stages 2-5 remain locked until
  all prior stage IDs are complete. Replaying a completed stage is allowed.
  Completion of the next locked stage is idempotent; an out-of-order completion
  cannot skip a stage. Completion with either vehicle is equivalent.
- Expose a typed `recordConfirmedStageSuccess(stageId)` boundary. Call it only
  after a future lesson runtime confirms success. No current preview, menu
  control or public development hook may award completion.
- Save only on confirmed completion or explicit changes to last vehicle,
  settings or calibration, never per frame. UI shows the locked/unlocked state
  and session-only/corrupt-save notices without relying on color alone.

### Storage behavior

- Use the approved keys `park-core.progress.v1`,
  `park-core.settings.v1` and `park-core.calibration.v1`; each value is
  versioned and validated from `unknown`. Calibration entries use stable
  device IDs, never a persisted gamepad array index.
- Missing keys use documented defaults. Unknown IDs, duplicates, invalid
  fields, malformed JSON or unsupported versions are not trusted. Preserve an
  unreadable key and mark it `reset-required`; do not overwrite it on later
  session success or setting change.
- Continue in clearly labeled in-memory session-only mode if storage access
  throws or a write fails (including quota). A failed persistent write must
  never be reported as saved.
- For any unreadable progress, settings or calibration record, offer explicit
  confirmation to reset that record individually. Remove only its corresponding
  key; preserve the other records and unrelated origin storage. A successful
  explicit reset clears that record's recovery lock and permits future writes.
- Keep load/save/reset operations typed and small. Do not add a generic storage
  framework, account/sync behavior or schema-migration framework beyond the
  supported version-1 records.

## Application and documentation integration

- Add a stage-selection screen to the existing semantic Vietnamese shell.
  Render stages 2-5 as locked until the contiguous-prefix rule enables them;
  show environment/manoeuvre labels from finite message keys and keep vehicle
  selection available. A Stage 1 launch opens the Garage sandbox, not a
  briefing or lesson.
- Replace synchronous prototype-only scene creation with a generation-guarded
  async load path. Keep application state and `ScreenAction` types aligned;
  stale loading callbacks must not attach scenes or change the current screen.
- Load persisted progress/settings/calibration before mounting the menu;
  persist user changes and calibrations through explicit operations. Preserve
  existing pointer-lock, focus, WebGL recovery, pause and disposal behavior.
- Update `docs/tech-design.md`, `docs/detail-design.md` and
  `docs/implementation-plan.md` to distinguish repository implementation
  phases from technical-design planning phases. Mark assets and persistence as
  the current delivery; keep lesson/evaluation requirements visible but
  explicitly deferred to the next phase.
- Add `docs/phase-5-detail-design.md`,
  `docs/phase-5-implementation-plan.md` and `docs/asset-pipeline.md`.
  The phase documents record verified software results and remaining art,
  performance, hardware, route and instructor validation separately.

## Acceptance and verification

### Automated

- Asset-source tests verify deterministic generation, GLB container validity,
  required nodes, declared dimensions, anchors, environment ceiling grouping,
  explicit collider metadata and budget calculations.
- Loader tests cover selected-pair loading, missing/invalid asset categories,
  dimension/anchor mismatch, load rejection, abort, late completion after
  abort, stale session generation and idempotent resource disposal.
- Persistence tests cover missing keys, valid round trips, unknown/duplicate
  stage IDs, contiguous unlock derivation, out-of-order and repeated
  completion, either vehicle, malformed JSON, unsupported versions, throwing
  storage getter, write/quota failure, corrupt-save no-overwrite and key-scoped
  reset.
- UI/app tests cover stage locks, Stage 1 sandbox selection, persisted vehicle
  choice, recovery/reset confirmation, session-only messaging, focus and
  stale-load isolation. No test awards success through a user-facing debug
  control.
- Browser acceptance loads each vehicle/environment asset through WebGL,
  switches all supported asset pairs repeatedly, and checks no stale scene,
  uncaught error, leaked canvas or accumulated listener/resource.
- Run `npm test`, `npm run typecheck`, `npm run build`,
  `npm run test:browser`, and `git diff --check`.

### Claims and pending evidence

Passing software tests will establish loader/storage/UI behavior only. The
generated content is not production art. Manual cockpit/mirror sightline,
roadside/garage clearance, supported-Node, real wheel, reference-hardware
performance, feasible lesson paths and instructor wording checks remain
pending. Do not claim training readiness or full Phase 6 curriculum completion.

## Plan-level questions

The builder owns detailed node transforms and low-poly composition within the
fixed profile dimensions and named-node contract. Before implementation,
verify whether the installed Three.js `GLTFLoader` can validate the generated
files in the repository's Node/test environment without a new runtime
dependency; if not, keep production loading in Three.js and validate generated
GLB structure with the smallest deterministic test helper.

## Approval

Approved by the project owner on 2026-11-04. The approved recovery behavior
offers confirmed, key-specific reset for any corrupt or unsupported progress,
settings or calibration record.
