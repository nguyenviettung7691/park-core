# Sim Wheel/Gamepad Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add selectable controller presets and a visual, verified setup/calibration path while preserving direct proportional analog input.

**Status:** Complete; all four tasks are implemented and final test/build validation passed.

**Architecture:** Add a typed static profile catalog that produces existing `ControllerCalibration` records. Extend the calibration screen with an auto-verified preset path and a one-step illustrated manual path, then connect profile selection to the existing app persistence/readiness flow.

**Tech Stack:** TypeScript, vanilla DOM/SVG/CSS, Vitest, existing Gamepad API and calibration persistence.

**Spec:** `docs/superpowers/specs/2026-11-06-sim-wheel-gamepad-support-design.md`

## Global Constraints

- “No change to vehicle physics or to the existing proportional gamepad input response.”
- “No wheel motor force-feedback, vibration, or other output-device feature.”
- “No claim that a profile works on every browser, driver, firmware, or connection mode; no unverified automatic profile application.”
- “Keep manual calibration for unmatched devices and mismatched device modes.”
- “The learner-facing UI and errors remain Vietnamese. Technical names and documentation remain English.”
- “Use vanilla DOM/CSS and the existing amethyst accent.”
- Reuse `ControllerCalibration` and the existing calibration record; do not add dependencies or a second profile persistence format.

## Review Focus

1. A standard-mapped gamepad with an unknown or misleading ID must not be silently identified as a named model; Task 1 tests unmatched and non-standard IDs.
2. Wheel/gamepad axes or button arrays that are missing, sparse, or non-finite must not verify or save a preset; Task 2 tests malformed/disconnected samples.
3. Noise or a brief spike must not count as control use, and held analog/button input must return to neutral before advancing; Task 2 tests threshold and release transitions.
4. A reversed steering axis or pedal binding must fail the corresponding guided check instead of silently changing direction; Task 2 tests expected signs and bindings.
5. Disconnecting or replacing a device during preset verification clears preset progress and cannot save preset calibration under the replacement ID. Manual fallback is a separate explicit flow and can save only after all nine captures validate under the current ID; Task 4 tests interrupted verification and readiness.

---

## File Map

- Create `src/input/profiles.ts`: profile IDs, labels, conservative matchers, default calibrations, and profile-to-device calibration construction.
- Modify `src/input/input.test.ts`: profile identity, defaults, and validation tests.
- Modify `src/ui/calibration.ts`: preset verification state machine and guided manual capture steps.
- Create `src/ui/controller-illustrations.ts`: accessible generic wheel/gamepad SVGs with the current control highlighted.
- Modify `src/ui/ui.test.ts` and `src/style.css`: verify rendered step/part/progress and style the illustrated flow.
- Modify `src/runtime-types.ts`, `src/ui/screens.ts`, and `src/app.ts`: profile selection action, setup view data, calibration handoff, and existing persistence/readiness integration.
- Modify `src/messages.ts`: Vietnamese profile, verification, step, error, and accessibility text.
- Modify `src/app.test.ts`: profile selection, save/readiness, ID binding, and reconnect behavior.
- Modify `README.md` and `docs/detail-design.md`: document selectable presets, verification, and manual fallback without claiming hardware validation.

## Task 1: Add typed device profiles

**Files:**
- Create: `src/input/profiles.ts`
- Test: `src/input/input.test.ts`

**Interfaces:**
- Produces `ControllerProfileId`, `ControllerProfile`, `controllerProfiles`,
  `findControllerProfile(pad: Pick<Gamepad, 'id' | 'mapping'>): ControllerProfile | null`,
  and `calibrationForProfile(id: ControllerProfileId, deviceId: string): ControllerCalibration`.
- Each profile has `id`, `name`, `kind: 'gamepad' | 'wheel'`, a calibration
  template without `deviceId`, and a conservative device matcher.

- [x] **Step 1: Write failing profile tests.** Assert the catalog contains the Xbox Series X, 8BitDo Ultimate 2C, Logitech G29/G920/G923, and Thrustmaster T300 RS GT profiles; each generated calibration uses the actual supplied device ID and passes `validateCalibration`.
- [x] **Step 2: Run the focused tests and confirm they fail** because the profile module/exports do not exist.

Run: `npm test -- src/input/input.test.ts`

Expected: FAIL in the new profile cases.

- [x] **Step 3: Implement the profile catalog and matchers.** Use standard mapping plus a case-insensitive model-name match for the Xbox and 8BitDo profiles. Use case-insensitive exact model tokens for wheel auto-matching; leave profiles selectable when their browser ID is not recognized. Do not match unknown/non-standard controller IDs automatically.

Default gamepad bindings: steering axis 0 (`-1/0/1`), throttle button 7 (`0/1`), brake button 6 (`0/1`), reverse button 4, and drive button 5. Candidate wheel bindings: steering axis 0 (`-1/0/1`), throttle axis 1 and brake axis 2 (`-1/1` endpoints), reverse button 4, and drive button 5. These are starting profiles only; later verification must reject a mismatch and route to manual calibration.

- [x] **Step 4: Run profile and calibration tests.**

Run: `npm test -- src/input/input.test.ts`

Expected: PASS, including unknown ID, non-standard mapping, wheel-name matching, and valid device-bound calibration cases.

- [x] **Step 5: Commit the profile catalog.**

```powershell
git add src/input/profiles.ts src/input/input.test.ts
if ($?) { git commit -m "feat: add controller profiles" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" }
```

## Task 2: Add preset verification and release checks

**Files:**
- Modify: `src/ui/calibration.ts`
- Test: `src/ui/ui.test.ts`
- Modify: `src/messages.ts`

**Interfaces:**
- Consumes Task 1's `ControllerProfile` and `calibrationForProfile`.
- Extend `mountCalibration(root, selectedIndex, getGamepads, onComplete, onCancel, profile?: ControllerProfile): () => void`; omitting `profile` preserves the manual path.

- [x] **Step 1: Write failing tests** for the preset path: expected movement auto-verifies steering-left, steering-right, throttle, brake, reverse, and drive; each completed control must return to neutral/released before advancing; completion calls `onComplete` only after all six checks.
- [x] **Step 2: Add failing cases** for reversed steering/pedal bindings, sub-threshold spikes, sparse/non-finite values, disconnection, and device ID replacement. Assert no profile is saved and all progress is invalidated on a bad/replaced device.
- [x] **Step 3: Run the focused UI tests and confirm the new cases fail.**

Run: `npm test -- src/ui/ui.test.ts`

Expected: FAIL in the new profile-verification cases.

- [x] **Step 4: Implement profile verification in `mountCalibration`.** Build the calibration with the selected profile and the currently connected device ID. Check normalized steering/pedals at a `0.35` activation threshold for three consecutive animation samples; require normalized magnitude at or below `0.10` before the next step. For reverse/drive buttons, require a pressed sample followed by release. Keep Save/complete disabled until all six checks finish; reuse existing device validation and clear all progress on disconnect or ID change.
- [x] **Step 5: Run the focused UI and calibration tests.**

Run: `npm test -- src/ui/ui.test.ts src/input/input.test.ts`

Expected: PASS; existing manual calibration tests remain unchanged at this step.

- [x] **Step 6: Commit preset verification.**

```powershell
git add src/ui/calibration.ts src/ui/ui.test.ts src/messages.ts
if ($?) { git commit -m "feat: verify controller presets" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" }
```

## Task 3: Guide manual calibration with device illustrations

**Files:**
- Create: `src/ui/controller-illustrations.ts`
- Modify: `src/ui/calibration.ts`
- Modify: `src/ui/ui.test.ts`
- Modify: `src/style.css`
- Modify: `src/messages.ts`

**Interfaces:**
- Produces `createControllerIllustration(kind: 'wheel' | 'gamepad', part: CalibrationPart): SVGSVGElement` with accessible `role="img"` and a Vietnamese `aria-label`.
- `CalibrationPart` identifies steering, throttle, brake, reverse, and drive regions.

- [x] **Step 1: Write failing tests** that assert manual calibration presents the nine capture steps in this order: steering left/center/right; throttle released/pressed; brake released/pressed; reverse; drive. Assert the visible progress is `n / 9`, the current step highlights its matching device part, diagnostics remain closed by default, and an unmatched device offers wheel/gamepad illustration choice while a known profile selects its kind.
- [x] **Step 2: Add failing tests** for manual capture invalidation when a binding changes, plus Cancel/Escape, focus restoration, and device replacement during a step.
- [x] **Step 3: Run focused UI tests and confirm the new cases fail.**

Run: `npm test -- src/ui/ui.test.ts`

Expected: FAIL in the new illustrated-step cases.

- [x] **Step 4: Implement generic accessible wheel/gamepad SVGs** and the one-step manual flow. Ask the learner to choose a generic wheel or gamepad drawing only when no selected profile identifies the device kind. Highlight the steering wheel/stick, pedal/trigger, or gear control for the current capture. Preserve manual sample capture, endpoint validation, invalidation on rebinding/replacement, expandable raw values, and Cancel/Escape/focus behavior.
- [x] **Step 5: Add compact CSS for the illustration, current-step highlight, capture state, and progress.** Use the existing accent and honor reduced-motion preferences; add no graphics dependency.
- [x] **Step 6: Add Vietnamese labels/instructions and run focused tests.**

Run: `npm test -- src/ui/ui.test.ts src/input/input.test.ts`

Expected: PASS for both manual and preset flows, including accessibility labels and the correct active part.

- [x] **Step 7: Commit the illustrated calibration flow.**

```powershell
git add src/ui/controller-illustrations.ts src/ui/calibration.ts src/ui/ui.test.ts src/style.css src/messages.ts
if ($?) { git commit -m "feat: guide controller calibration" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" }
```

## Task 4: Connect profile selection to app persistence

**Files:**
- Modify: `src/runtime-types.ts`
- Modify: `src/ui/screens.ts`
- Modify: `src/app.ts`
- Modify: `src/messages.ts`
- Test: `src/app.test.ts`
- Modify: `README.md`
- Modify: `docs/detail-design.md`

**Interfaces:**
- Add `ScreenAction` variant `{ readonly type: 'open-profile-verification'; readonly profileId: ControllerProfileId }`.
- Add optional `ShellView.calibrationProfileId?: ControllerProfileId | null`.
- Extend `InputSetup` with `profiles: readonly ControllerProfile[]` and `matchedProfileId: ControllerProfileId | null`.
- Consumes the profile-mode `mountCalibration` from Task 2 and manual flow from Task 3.

- [x] **Step 1: Write failing app/UI tests** for profile names and match status in gamepad setup, explicit selection opening preset verification, and manual calibration remaining available for unmatched devices.
- [x] **Step 2: Add failing persistence/readiness tests.** Assert calibration is saved under the connected device's actual ID only after all verification checks; incomplete/cancelled profile checks and replacement without a complete explicit manual calibration do not save or mark input ready; saved calibration still requires existing reconnect verification.
- [x] **Step 3: Run focused app/UI tests and confirm the new cases fail.**

Run: `npm test -- src/app.test.ts src/ui/ui.test.ts`

Expected: FAIL in the new setup and app-flow cases.

- [x] **Step 4: Wire profile options and status into `InputSetup` and the settings input controls.** Show an exact match as a suggestion, retain explicit profile selection, and keep the manual-calibration action available. Reject unknown profile IDs at the app action boundary.
- [x] **Step 5: Pass the selected profile to `mountCalibration` from `app.ts`.** On successful completion, reuse the existing calibration map, `saveCalibrations`, verified-device state, preview setup, and readiness logic. On cancel/failure, preserve prior saved data and restore focus to the initiating profile/manual action.
- [x] **Step 6: Add Vietnamese profile and status copy; update README and `docs/detail-design.md`** to describe profile choice, auto-verification, manual fallback, and unchanged proportional analog response. Explicitly state that hardware compatibility remains unverified.
- [x] **Step 7: Run focused tests and type-check.**

Run: `npm test -- src/app.test.ts src/ui/ui.test.ts src/input/input.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit code 0.

- [x] **Step 8: Commit app integration and documentation.**

```powershell
git add src/runtime-types.ts src/ui/screens.ts src/app.ts src/messages.ts src/app.test.ts README.md docs/detail-design.md
if ($?) { git commit -m "feat: integrate controller setup profiles" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" }
```

- [x] **Step 9: Run final validation.**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: exit code 0.

## Self-Review

- **Spec coverage:** profile set/matching is Task 1; auto-detected preset verification and neutral release are Task 2; device drawings, highlighted manual steps, diagnostics, and accessible UX are Task 3; app selection, persistence, reconnect behavior, copy, and compatibility caveat are Task 4.
- **Step scan:** every implementation task starts with failing tests, runs a focused test command, implements only its component, and finishes with a passing check and commit.
- **Type consistency:** profile ID, profile record, `mountCalibration` parameter, `ScreenAction`, `ShellView`, and `InputSetup` interfaces are named and consumed consistently across tasks.
- **Review Focus:** all five cases are assigned to explicit tests in Tasks 1, 2, and 4.
- **Proportion:** four task boundaries correspond to independently reviewable profile data, verification logic, calibration UX, and app integration; no new dependencies or physics work are planned.
