# Issue #12 Car 3D Asset Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Sedan and CUV's low-poly exterior and static cockpit artwork to address issue #12 while preserving vehicle physics and runtime camera contracts.

**Architecture:** Keep `tools\asset-designs\vehicles.mjs` as the deterministic source of vehicle geometry and regenerate the existing GLBs. Extend generator/loader regressions and the existing Phase 8 real-render browser suite; refresh the asset catalog and add the requested detailed Update #12 record.

**Tech Stack:** JavaScript asset generator, GLB/glTF, Three.js and GLTFLoader, Vitest, Playwright, Vite.

**Spec:** `docs\superpowers\specs\2026-11-06-issue-12-car-3d-asset-redesign-design.md`

## Global Constraints

- Preserve the vehicle profile dimensions, physics colliders, runtime driver-eye and mirror-camera anchors, renderer, and asset-generation pipeline.
- Keep geometry in meters, +Y up, -Z forward; preserve the center-of-mass root and required named nodes.
- Keep the dashboard and modeled indicators static; do not connect them to simulator state.
- Keep deterministic generated GLBs, static vertex colors, and `KHR_materials_unlit`; add no dependencies, textures, shaders, dynamic lighting, or downloaded art.
- Keep each vehicle below 10,000 triangles and selected vehicle/environment pairs below 5 MB.
- License new creative geometry under CC BY-NC 4.0 and preserve existing attribution metadata.

## Review Focus

- Driver forward/downward sightlines remain clear after cockpit reconstruction; pin this in the real-loader ray tests in Task 2.
- Side mirror faces remain unobstructed from both fixed driver eyes and rearview display geometry stays within the cabin; pin this in the existing mirror ray-grid and cockpit containment tests in Task 2.
- Sedan hood/trunk balance changes without extending beyond the existing body envelope; pin this in generator bounds tests in Task 1.
- Exterior side surfaces remain continuous at representative door-panel samples on both vehicles; pin this in loaded-mesh ray tests in Task 1.
- Geometry changes do not exceed triangle, payload, or per-render main-pass limits; pin this in generator budget tests and the existing browser report assertions in Tasks 1 and 3.

---

### Task 1: Redesign and verify the exterior shells

**Files:**
- Modify: `tools\asset-designs\vehicles.mjs`
- Modify: `src\world\generate-assets.test.mjs`
- Modify: `src\world\assets.test.mjs`
- Regenerate: `public\assets\vehicles\sedan.glb`
- Regenerate: `public\assets\vehicles\cuv.glb`

**Interfaces:**
- Preserve `Body`, `Hood`, all four wheel nodes, and the existing root dimensions.
- Add a named `Trunk` geometry node for the Sedan so its length can be measured independently of merged exterior trim.
- Keep `Exterior` as the parent/group for the shell and static details.

- [ ] **Step 1: Add failing generator regressions**

In `src\world\generate-assets.test.mjs`, add:

1. `exports a rebalanced sedan hood and trunk within the body envelope` — resolve each node's world-space Z bounds; assert both have positive depth, the hood depth is greater than the trunk depth, and both remain within the Sedan's `[-2.3, 2.3]` m length.
2. `includes a named Trunk node for sedan` — require `Trunk` in the generated node list.

- [ ] **Step 2: Run the generator tests and verify the new assertions fail**

Run: `npx vitest run src\world\generate-assets.test.mjs`
Expected: FAIL because the generator has no named `Trunk` and the current hood is shorter than its rear deck.

- [ ] **Step 3: Add loaded-shell coverage regression**

In `src\world\assets.test.mjs`, add `keeps both vehicle door-side shells covered at representative samples`. Load each generated asset pair; cast rays from X = `-1.2` and `+1.2` m through the vehicle at local Y = `0.2` m and Z = `[-0.8, -0.4, 0, 0.4, 0.8]` m toward the opposite side. Require a nearest hit on the exterior body at every sample.

- [ ] **Step 4: Run the loaded-asset test and confirm the coverage guard**

Run: `npx vitest run src\world\assets.test.mjs -t "door-side shells covered"`
Expected: PASS when the exterior covers every sample; if it fails, use the missed sample to correct the exterior before proceeding. The generator test above supplies the current known failing regression.

- [ ] **Step 5: Implement the exterior redraw**

In `tools\asset-designs\vehicles.mjs`, redraw body sections, door faces/seams, hood, trunk, glazing boundaries, bumpers, and mirror housings for both profiles. Make the Sedan's named hood longer than its named trunk while keeping all visible geometry within the existing envelope. Keep the CUV's upright hatch form. Avoid new per-part draw calls when the existing geometry-merge helpers can batch static details.

- [ ] **Step 6: Regenerate and run exterior/asset regressions**

Run:

```powershell
node tools\generate-assets.mjs
npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs
```

Expected: PASS with unchanged dimensions and anchors, covered door-side samples, and all existing asset budgets and loader contracts intact.

- [ ] **Step 7: Commit the exterior work**

```powershell
git add tools\asset-designs\vehicles.mjs src\world\generate-assets.test.mjs src\world\assets.test.mjs public\assets\vehicles\sedan.glb public\assets\vehicles\cuv.glb
git commit -m "feat: redesign vehicle exterior assets" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Complete the static cockpits and mirror presentation

**Files:**
- Modify: `tools\asset-designs\vehicles.mjs`
- Modify: `src\world\generate-assets.test.mjs`
- Modify: `src\world\assets.test.mjs`
- Regenerate: `public\assets\vehicles\sedan.glb`
- Regenerate: `public\assets\vehicles\cuv.glb`

**Interfaces:**
- Consume Task 1's `Body`, `Exterior`, `Hood`, and `Trunk` geometry and preserve their bounds.
- Preserve `Cockpit`, `DriverEye`, `MirrorRear`, `MirrorLeft`, `MirrorRight`, mirror surface UVs, and the four wheel nodes.
- Add named static geometry nodes: `InstrumentCluster`, `PedalSet`, `CenterConsole`, `DoorPanels`, and `Floor`.

- [ ] **Step 1: Add failing generator contract tests for static cockpit details**

In `src\world\generate-assets.test.mjs`, add `includes the complete static cockpit node set for sedan` and the equivalent CUV case. Require the five nodes in the Interfaces block plus `SeatsAndInterior`, `Dashboard`, and `SteeringWheel`.

- [ ] **Step 2: Run generator tests and verify the new cockpit-node assertions fail**

Run: `npx vitest run src\world\generate-assets.test.mjs -t "static cockpit node set"`
Expected: FAIL because the newly required detail nodes are not yet present.

- [ ] **Step 3: Add failing loaded-cockpit and rearview regressions**

In `src\world\assets.test.mjs`, add:

1. `keeps cockpit details inside the body bounds` — for both vehicles, use `Box3` to verify the instrument cluster, pedal set, console, door panels, floor, and seats remain within the loaded `Body` bounds.
2. `keeps the rearview display smaller and above the driver eye` — for both vehicles, require its world-space width to be `< 0.12` m, height `< 0.05` m, and center Y to exceed `profiles[id].driverEyeLocalM[1]`.
3. Keep the existing full 9 × 9 fixed-eye side-mirror ray grid, forward sightline, downward steering-wheel, mirror UV, and rearview containment assertions.

- [ ] **Step 4: Run cockpit and mirror tests and verify failures are specific**

Run: `npx vitest run src\world\assets.test.mjs -t "cockpit details|side-mirror faces|rearview display"`
Expected: FAIL on missing nodes or geometry that violates the existing sightline/mirror contracts.

- [ ] **Step 5: Implement detailed static cockpit geometry**

In `tools\asset-designs\vehicles.mjs`, add a visibly modeled instrument cluster with static dial faces/needles and indicator lamps, pedals, center console/storage, door panels, floor, and complete seating. Reposition/resize only the visible side/rear display and housing meshes as needed; keep their virtual camera anchors and runtime render behavior unchanged. Merge compatible static meshes to preserve the existing render-call budgets.

- [ ] **Step 6: Regenerate and run generator/loader tests**

Run:

```powershell
node tools\generate-assets.mjs
npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs
```

Expected: PASS for both vehicles, including every existing dimension, root, wheel, cockpit sightline, glazing, mirror, collider, and payload assertion.

- [ ] **Step 7: Commit the cockpit work**

```powershell
git add tools\asset-designs\vehicles.mjs src\world\generate-assets.test.mjs src\world\assets.test.mjs public\assets\vehicles\sedan.glb public\assets\vehicles\cuv.glb
git commit -m "feat: detail static vehicle cockpits" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Validate real renders and refresh the asset catalog

**Files:**
- Verify: `tests\browser\phase-8-assets.spec.ts`
- Update captures as needed: `docs\images\phase-8\sedan-front.png`, `sedan-rear.png`, `sedan-cockpit.png`, `cuv-front.png`, `cuv-rear.png`, `cuv-cockpit.png`
- Modify: `docs\phase-8-asset-catalog.md`
- Modify only if its pipeline description becomes inaccurate: `docs\asset-pipeline.md`

**Interfaces:**
- Consume the regenerated GLBs from Tasks 1–2.
- Preserve the existing browser capture fixture and per-pass call thresholds.

- [ ] **Step 1: Run the real-asset browser suite**

Run: `npm run test:browser -- phase-8-assets.spec.ts`
Expected: PASS for all vehicle/environment render pairs and parked lesson scenes; each frame remains within the existing main-pass limits and produces no page errors.

- [ ] **Step 2: Inspect generated front, rear, and driver-view screenshots for both vehicles**

Use the browser-test output captures for each vehicle. Confirm closed exterior surfaces, Sedan proportion changes, and cockpit component visibility from the actual driver view. Do not copy a capture into `docs\images\phase-8` until it visibly demonstrates the completed design.

- [ ] **Step 3: Refresh the catalog with verified output**

Replace only captures that are superseded by this redesign. Update vehicle triangle counts, node/mesh counts, GLB sizes, cockpit/mirror descriptions, and sampled render-call values from the actual generated assets and browser report. Retain the existing manual-validation caveats.

- [ ] **Step 4: Commit the verified captures and catalog**

```powershell
git add docs\phase-8-asset-catalog.md docs\images\phase-8\sedan-front.png docs\images\phase-8\sedan-rear.png docs\images\phase-8\sedan-cockpit.png docs\images\phase-8\cuv-front.png docs\images\phase-8\cuv-rear.png docs\images\phase-8\cuv-cockpit.png
git commit -m "docs: refresh redesigned vehicle asset catalog" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Add `docs\asset-pipeline.md` only if its current pipeline description becomes inaccurate.

### Task 4: Record Update #12 and deliver the pull request

**Files:**
- Create: `docs\update-12-car-3d-asset-redesign.md`
- Include in the final PR: `docs\superpowers\specs\2026-11-06-issue-12-car-3d-asset-redesign-design.md` and this implementation plan.
- Verify: all changed source, tests, generated GLBs, and documentation.

**Interfaces:**
- Consume final geometry, image captures, measurements, and test results from Tasks 1–3.
- The change record must distinguish verified software/render results from pending manual mirror-landmark, vehicle-clearance, and reference-hardware validation.

- [ ] **Step 1: Write the detailed Update #12 change record**

Create `docs\update-12-car-3d-asset-redesign.md` with the final Sedan and CUV changes, static cockpit details, mirror display changes, preserved profile/collider/anchor contracts, generated asset measurements, regression coverage, captures/catalog changes, exact checks run, and remaining validation limits. Use observed results, not intended or unverified claims.

- [ ] **Step 2: Run final focused and project checks**

Run:

```powershell
node tools\generate-assets.mjs
npx vitest run src\world\generate-assets.test.mjs src\world\assets.test.mjs
npm test
npm run typecheck
npm run build
npm run test:browser -- phase-8-assets.spec.ts
git diff --exit-code -- public\assets\vehicles\sedan.glb public\assets\vehicles\cuv.glb
git diff --check
```

Expected: all commands pass; rerunning the deterministic generator leaves both committed vehicle GLBs unchanged.

- [ ] **Step 3: Commit the design, plan, and Update #12 record**

```powershell
git add docs\superpowers\specs\2026-11-06-issue-12-car-3d-asset-redesign-design.md docs\superpowers\plans\2026-11-06-issue-12-car-3d-asset-redesign.md docs\update-12-car-3d-asset-redesign.md
git commit -m "docs: record issue 12 vehicle asset redesign" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 4: Review, push, and create the issue-linked pull request**

Run a fresh whole-branch code review and resolve any valid findings. Review the final diff for scope, generated-artifact consistency, and test evidence. Push `issue-12-redesign-the-car-3d-assets` to `origin`, then create a PR targeting `main` and referencing `Closes #12`. Include the change record and exact verified checks; state outstanding manual validation explicitly.

Expected: the PR exists in `nguyenviettung7691/park-core`, includes all source/tests/generated assets/docs, and links to issue #12.
