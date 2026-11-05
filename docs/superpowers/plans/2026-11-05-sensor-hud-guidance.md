# Finding 4 Proximity HUD Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the live front/rear proximity HUD cannot be mistaken for confirmation that a maneuver is safe or clear.

**Architecture:** Keep the existing sensor snapshots and classification unchanged. Render a neutral reading and a visible Vietnamese limitation note under each active front/rear reading, including no-hit states; reuse static DOM children in the existing HUD update loop.

**Tech Stack:** TypeScript, vanilla DOM/CSS, Vitest, Playwright, Vite.

**Spec:** `docs\superpowers\specs\2026-11-05-sensor-hud-guidance-design.md`

## Global Constraints

- Replace the green band's “safe” assurance with neutral Vietnamese wording.
- Whenever a sensor snapshot is displayed, show a concise visible note with that reading, including neutral/no-warning readings: sensors are guidance only, may miss obstacles, and never confirm clearance.
- Describe a no-hit result as “not detected by the sensor,” not as absence of an obstacle.
- Preserve the existing sensor readings, warning bands, colors, distances, audio, sampling, and no-snapshot hidden state.
- Do not change ray origins/count/angles/range, collision behavior, thresholds, or sensor sampling.
- Do not recolor the sensor bands or alter unrelated HUD controls.
- Do not make a tooltip, menu, or general disclaimer the only explanation.
- Never label a green/no-hit state “safe,” “clear,” or equivalent.
- Learner-facing copy remains Vietnamese; identifiers and technical documents remain English.
- Standard tier for typed UI behavior, tests, and docs; Lightweight only for isolated repetitive CSS; no Premium physics work. Follow `docs\tech-design.md` Section 6.
- Finding 4 remains open until reviewed, owner-signed-off, merged, pushed, and supported CI passes.

## Review Focus

- Green and no-hit copy must report sensor observations, not vehicle/path safety; pin exact terms in the HUD unit test.
- Front warning and rear no-hit panels must each carry the visible note in the real HUD; extend the existing muted-warning browser test.
- A null snapshot must hide both panels and clear their reading and note; extend the HUD unit test.
- Repeated sensor updates must preserve the note without replacing the panel structure in the 20 Hz update path; test successive warning/no-hit snapshots.
- The note must be visible at a narrow viewport as well as desktop; check the existing browser assertion at the configured viewport and a narrow resize.

---

### Task 1: Make live proximity HUD wording non-assuring

**Tier:** Standard for the integrated typed UI/test/doc change; use Lightweight only if a small, isolated CSS adjustment is needed.

**Files:**
- Modify: `src\messages.ts` — neutral green/no-hit strings and shared Vietnamese limitation copy.
- Modify: `src\ui\hud.ts` — static reading/note children and snapshot/null rendering.
- Modify: `src\style.css` — block presentation for the note, preserving existing warning colors and readable text sizing.
- Test: `src\ui\ui.test.ts` — neutral green/no-hit copy, note in active warning/no-hit states, null clearing, and repeated updates.
- Test: `tests\browser\driving.spec.ts` — real visible front warning and rear no-hit guidance; narrow viewport.
- Modify: `docs\detail-design.md` — record the learner-facing sensor limitation at the sensor HUD contract.
- Modify: `PRODUCTION-READINESS-REVIEW.md` — record implementation and keep Finding 4 pending until publication evidence.

**Interfaces:**
- Consumes: `Hud.updateSensors(sensors: SensorSnapshot | null): void`; existing `SensorSnapshot`, `SensorBand`, and `selectMostSevereWarning`.
- Produces: no new public API. The existing `#proximity-front` and `#proximity-rear` panels continue to expose reading text and contain one visible `.sensor-guidance` note when a snapshot is active.

- [ ] **Step 1: Write failing unit tests** in `src\ui\ui.test.ts` for an active green front reading and clear/no-hit rear reading. Assert the green label is neutral, the no-hit wording scopes itself to sensor detection, both panels contain the exact `vi.sensorGuidance` copy, and null data hides/clears both. Exercise a second snapshot update to prove the note remains attached.
- [ ] **Step 2: Run the focused unit test** with `npm test -- src\ui\ui.test.ts`. Confirm failure is due to the absent guidance and current assurance wording.
- [ ] **Step 3: Implement** the approved copy in `src\messages.ts`; create one reading node and one `.sensor-guidance` node for each panel in `mountHud` and update their text without recreating nodes per sensor sample. Hide and clear both on `null`. Preserve severity selection, measured distances, color classes, audio, and sampling.
- [ ] **Step 4: Add browser assertions** to the existing muted-warning test in `tests\browser\driving.spec.ts`: the front warning and rear no-hit state both visibly contain the note. Resize to a narrow viewport while the snapshot is present and verify both panel and note remain visible.
- [ ] **Step 5: Style and document** the note as a separate readable line in `src\style.css`; update the bumper sensor contract in `docs\detail-design.md` and report Finding 4 as implemented but pending review/owner sign-off/CI in `PRODUCTION-READINESS-REVIEW.md`.
- [ ] **Step 6: Verify** with `npm test -- src\ui\ui.test.ts`, the focused `driving.spec.ts` cases, `npm test`, `npm run build`, and `npm run test:production`. Do not run performance benchmarks. Record results; do not mark Finding 4 Done yet.
- [ ] **Step 7: Commit** the focused source, tests, and documentation changes.

### Task 2: Review, sign-off, and publish

- [ ] Obtain independent review and present the diff plus verification evidence to the owner.
- [ ] After explicit owner sign-off, merge into `main`, verify the merged unit/build checks, and push without force.
- [ ] Observe one hosted Pages workflow run; require supported-Node unit/typecheck/build, browser, production smoke and deployment success. On failure, retain Finding 4 as pending and investigate from run evidence; do not rerun unchanged jobs.
- [ ] Verify the live app and record the successful run/revision in the master docs, then mark Finding 4 Done. This closes only the HUD wording/disclosure gap, not sensor coverage or clearance validation.
