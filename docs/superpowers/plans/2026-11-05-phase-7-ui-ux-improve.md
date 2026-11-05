# Phase 7 UI/UX Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an illustrated tutorial-first parking-learning experience with
clear screen priorities and non-interruptive driving guidance.

**Architecture:** Keep the existing app/preview lifecycle and vanilla DOM UI.
Add finite shell overlays and an independent onboarding record; reuse authored
lesson events for the coach and existing sensor events for warnings. Move
detailed settings out of the running HUD without changing simulation rules.

**Tech Stack:** Strict TypeScript, Vite, vanilla HTML/CSS/SVG, existing
Three.js/Cannon-es, Vitest/jsdom, Playwright/Chromium.

**Spec:** [Approved Phase 7 design](../../phase-7-ui-ux-improve.md).

## Global Constraints

- Keep `#9B59B6` as the main accent.
- Preserve Vietnamese learner-facing copy and English technical documentation.
- Reserve standard green/yellow/red for proximity indicators; do not add blue,
  orange, or green to the main UI.
- No new curriculum, physics, parking tolerances, failure rules, unlock rules,
  accounts, synchronization, or simulated traffic.
- No frontend framework or large UI/animation dependency.
- No production 3D asset replacement, environment makeover, new renderer,
  shaders, dynamic lighting, or extra real-time scene previews.
- No tutorial modal, forced acknowledgement, focus theft, or automatic tutorial
  pause while the learner is moving.
- Routine tutorial updates use the unobtrusive task panel. No additional
  lesson chime in the initial implementation.
- Preserve existing saved formats and sensor audio behavior; onboarding uses a
  separate versioned record and never silently replaces unreadable data.
- At least 44 px interaction targets; honor reduced motion and keyboard access.
- Validate 2560 x 1440, 1440 x 900, 1280 x 720, and a 390 x 844 narrow viewport,
  plus 200% zoom. Narrow layouts do not imply touch-driving support.
- Preserve mirror update cap; the 1440p/60 Hz target remains unverified on
  reference hardware.
- Use the repository's supported Node range:
  `^22.22.2 || ^24.15.0 || >=26.0.0`.
- Do not install dependencies unless an existing required tool is missing.
- Use Windows paths in shell commands. Every task commit includes
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Review Focus

1. Malformed/future-version onboarding data or storage denial must not erase
   progress, falsely claim persistence, or block the Skip path (Task 1).
2. Replaying onboarding from pause while device setup changes must return to the
   correct paused context without resuming or bypassing calibration (Task 2).
3. Pointer lock, simultaneous proximity/tutorial notices, and narrow layouts
   must leave safety information readable without stealing focus (Task 4).
4. Very long controller names, disconnect during capture, and repeated Cancel
   must preserve valid calibration and keyboard escape paths (Task 5).
5. Empty/large history, failed saving, and Stage 5 completion must not fabricate
   progress, lose records, or suggest a sixth lesson (Task 6).

---

## Execution and file map

Use one isolated feature worktree at execution time, not while writing this
plan. Preserve the unrelated untracked README design/plan in the current
workspace. Tasks are ordered because they share navigation and UI interfaces;
do not parallelize edits to `app.ts`, `screens.ts`, or `style.css`.

| Files | Responsibility |
|---|---|
| `src\storage\onboarding.ts`, `.test.ts` (new) | Independent dismissal record and explicit storage statuses |
| `src\ui\onboarding.ts` (new) | Three illustrated introduction steps |
| `src\ui\illustrations.ts` (new) | Original static SVG parking-goal diagrams |
| `src\ui\view-settings.ts` (new) | Existing view/audio controls moved out of HUD |
| `src\ui\onboarding.test.ts` (new), `src\ui\ui.test.ts` | Focused DOM behavior tests |
| `src\runtime-types.ts`, `src\app.ts`, `src\app.test.ts` | Typed shell routes, first visit/replay, safe lifecycle |
| `src\ui\screens.ts`, `src\ui\hud.ts`, `src\ui\calibration.ts` | Existing screen and HUD presentation |
| `src\messages.ts`, `src\style.css`, `index.html` | Vietnamese copy, tokens/layout, native-control theme |
| `src\views\layout.ts`, `.test.ts` (new) | Shared overhead-inset CSS-pixel rectangle |
| `src\views\cameras.ts`, `src\render\preview.ts` | Consume shared inset rectangle; publish HUD reservation on resize |
| `tests\ui-journey.ts` (new) | Real-UI onboarding and settings helpers shared by browser/production tests |
| `tests\browser\phase-7.spec.ts` (new) | Tutorial, focus, HUD, responsive, and screenshot acceptance |
| Existing browser/production app tests | Update navigation/selectors without dropping behavior checks |
| `docs\images\phase-7\*.png`, `README.md`, approved design | Actual UI captures, captions, and implementation evidence |

Keep evaluation, vehicle/input mechanics, asset models, audio engine, benchmark
page, and deployment configuration unchanged. Small pure presentation helpers
may remain private in existing files; do not add a generic router/design system.

### Task 1: Persist onboarding dismissal independently

**Files:** Create `src\storage\onboarding.ts`, `src\storage\onboarding.test.ts`.
Modify `src\runtime-types.ts` only for the shared onboarding contracts.

**Interfaces:**

- Consume `StoragePort` from `src\storage\persistence.ts` and `RecordStatus`
  from `src\runtime-types.ts`; do not extend `PersistenceRecord`.
- Produce `OnboardingSnapshot { readonly dismissed: boolean; readonly status:
  RecordStatus }` and `OnboardingStore` with `snapshot()`, `dismiss()`, and
  `reset()`, each returning `OnboardingSnapshot`.
- Produce `createOnboarding(getStorage: () => StoragePort | null):
  OnboardingStore`.
- Own only key `park-core.onboarding.v1`. The valid stored record is
  `{ version: 1, dismissed: true }`; absence means not dismissed.

- [ ] **Step 1: Add failing storage tests.**

  Implement these assertions using the in-memory storage pattern from
  `persistence.test.ts`:

  ```ts
  expect(createOnboarding(() => storage).snapshot())
    .toEqual({ dismissed: false, status: 'persistent' });
  expect(store.dismiss()).toEqual({ dismissed: true, status: 'persistent' });
  expect(createOnboarding(() => storage).snapshot().dismissed).toBe(true);
  expect(store.reset().dismissed).toBe(false);
  ```

  Add `it.each` cases for malformed JSON, unsupported version, wrong dismissal
  type, throwing getter/read/write/remove, and unavailable storage. Assert
  unreadable bytes are unchanged after `dismiss()`, status is `reset-required`,
  and in-session dismissal still works. Unavailable/write-denied storage
  or a throwing storage getter/read returns `session-only`; malformed data
  that was successfully read returns `reset-required`. A failed reset keeps
  `reset-required` for unreadable data, otherwise `session-only`, and never
  claims persistent removal. Seed progress/settings/calibration keys and assert
  they are byte-for-byte unchanged after dismissal and confirmed reset.

- [ ] **Step 2: Run the tests and establish failure.**

  Run `npm test -- src\storage\onboarding.test.ts`.
  Expected: missing module/export, not an unrelated environment failure.

- [ ] **Step 3: Implement the store and contracts.**

  Strictly validate the record before accepting it. Retain the existing
  unreadable value until `reset()` is explicitly invoked; after failed removal,
  retain a non-persistent status. Keep state in memory when persistence fails.
  Return statuses to the caller; do not log success or swallow failure status.

- [ ] **Step 4: Verify storage compatibility.**

  Run `npm test -- src\storage\onboarding.test.ts src\storage\persistence.test.ts`
  and `npm run typecheck`. Expected: all pass.

- [ ] **Step 5: Commit only Task 1 files** as
  `feat: persist tutorial dismissal separately`.

### Task 2: Add the replayable tutorial and safe shell navigation

**Files:** Create `src\ui\onboarding.ts`, `src\ui\onboarding.test.ts`,
`src\ui\illustrations.ts`, `tests\ui-journey.ts`,
`tests\browser\phase-7.spec.ts`. Modify `src\runtime-types.ts`, `src\app.ts`,
`src\app.test.ts`, `src\ui\screens.ts`, `src\ui\ui.test.ts`,
`src\messages.ts`, `src\style.css`, `index.html`, and app-entry journeys in
existing browser/production tests.

**Interfaces:**

- Consume Task 1's store via new `AppDeps.createOnboarding:
  () => OnboardingStore`; default it alongside existing persistence.
- Add `ScreenContext.onboarding: OnboardingSnapshot` and
  `onboardingResetRequested: boolean`.
- Add finite overlay contracts in `runtime-types.ts`:

  ```ts
  type ShellOrigin = 'menu' | 'paused';
  type OnboardingStep = 0 | 1 | 2;
  type SettingsTab = 'view' | 'audio' | 'input';
  type OverlayReturn = { readonly kind: ShellOrigin }
    | { readonly kind: 'onboarding'; readonly step: OnboardingStep;
        readonly origin: ShellOrigin };
  type ShellOverlay =
    | { readonly kind: 'onboarding'; readonly step: OnboardingStep;
        readonly origin: ShellOrigin }
    | { readonly kind: 'settings'; readonly tab: SettingsTab;
        readonly returnTo: OverlayReturn }
    | { readonly kind: 'help'; readonly origin: ShellOrigin };
  ```

- Add optional `ShellView.overlay?: ShellOverlay`; preserve `AppState` and
  existing `calibrating` lifecycle. Calibration temporarily replaces the
  overlay's presentation but returns to that overlay without resuming.
- Add `ScreenAction` members `tutorial-next`, `tutorial-back`,
  `dismiss-tutorial`, `replay-tutorial`, `open-help`, `close-overlay`,
  `request-onboarding-reset`, `confirm-onboarding-reset`,
  `cancel-onboarding-reset`, and `open-settings` with `tab: SettingsTab`.
- Produce `mountOnboarding(root: HTMLElement, overlay:
  Extract<ShellOverlay, {kind: 'onboarding'}>, context: ScreenContext,
  input: InputSetup | undefined, onAction: (action: ScreenAction) => void):
  () => void`.
- Produce `createParkingIllustration(stageId: StageId): SVGSVGElement`.
- Produce test helper `enterLessonMenu(page: Page): Promise<void>`: wait for
  `main[data-screen]`, use the real Skip button when the screen is onboarding,
  and wait for `#start-stage`; do not write storage to bypass the flow.

- [ ] **Step 1: Write failing tutorial/navigation tests.**

  In `onboarding.test.ts`, test `goal -> controls -> ready`, Back, Skip from
  every step, correct keyboard/gamepad instructions, and explicit notices for
  session-only/reset-required status. Assert buttons emit the typed actions.

  In `app.test.ts`, add an explicit fresh-store fixture. Assert:

  ```ts
  expect(f.root.querySelector('[data-screen="onboarding"]')).not.toBeNull();
  expect(f.factory).not.toHaveBeenCalled();
  // After skipping: menu, dismissal saved; after reload: menu.
  // In a separate started-session test, clear the existing resume spy,
  // then pause -> help -> replay -> input setup -> close -> dismiss:
  expect(f.previews[0]!.resume).not.toHaveBeenCalled();
  ```

  Cover reset request/cancel/confirm, failed writes, replay without changing
  progress/history, focus restoration, and disposed/stale async callbacks.
  Keep existing app tests on an explicitly dismissed in-memory onboarding
  fixture, not a product-code test bypass. Update the shared `ScreenContext`
  fixture in `ui.test.ts` with the new onboarding fields.

- [ ] **Step 2: Run targeted tests to observe the new failures.**

  Run `npm test -- src\ui\onboarding.test.ts src\app.test.ts`.
  Expected: new tutorial/navigation assertions fail before implementation.

- [ ] **Step 3: Implement navigation and the illustrated introduction.**

  Show onboarding at startup unless its valid record is dismissed. Use three
  steps Goal, Controls, Ready; Skip/finish call the same dismissal operation.
  Keep `#simulation` absent during onboarding and lesson briefing; retain the
  existing explicit lesson Start Driving and separate free-drive entry actions.
  Support input setup and calibration return without losing tutorial position.
  Ignore routine attempts to open overlays while running; the learner explicitly
  pauses first. Fault/menu/dispose clears obsolete overlay context.

  Build local SVG diagrams with accessible text equivalents, no external art
  requests. Keep artwork distinct from instructional maneuver guarantees.
  Apply dark/purple tokens, primary/secondary action styles, focus states,
  native `accent-color`, and reduced-motion behavior here.
  Keep `index.html`'s document language and theme-color aligned with the UI.

- [ ] **Step 4: Adapt and verify existing app-entry journeys.**

  Use `enterLessonMenu` after app entry in `shell.spec.ts`, `driving.spec.ts`,
  `phase-5.spec.ts`, `phase-6.spec.ts`, `lesson-completion.spec.ts`, and
  `tests\production\pages.spec.ts`; do not alter asset-only fixture entry.
  Replace `localStorage.length === 0` with exact absence of the original
  progress/settings/calibration records before setup, since explicit Skip now
  creates the onboarding record. Preserve every substantive acceptance check.

  Add a first-visit browser test that completes all three steps, reloads, replays,
  and skips. Assert no canvas or pointer lock before explicit Start Driving.
  Run `npm test -- src\storage\onboarding.test.ts src\ui\onboarding.test.ts src\app.test.ts`,
  `npm run typecheck`, and
  `npm run test:browser -- tests\browser\phase-7.spec.ts`.
  Expected: pass for the implemented tutorial cases.

- [ ] **Step 5: Commit Task 2** as
  `feat: add replayable tutorial-first onboarding`.

### Task 3: Give selection, loading, and briefings a visual learning focus

**Files:** Modify `src\ui\screens.ts`, `src\ui\illustrations.ts`,
`src\messages.ts`, `src\style.css`, `src\app.ts`, `src\app.test.ts`,
`src\ui\ui.test.ts`, `tests\browser\phase-7.spec.ts`.

**Interfaces:**

- Consume Task 2's illustrations, screen markers, and shell navigation.
- Retain `#vehicle`, `#input-source`, `#start-stage`, `[data-stage-id]`,
  `aria-pressed`, and disabled locked-stage semantics.
- Keep recommendations private to screen/app presentation. First incomplete
  unlocked stage is the default; Stage 5 after full completion. Explicit
  selection persists within the current menu visit; returning after successful
  completion recommends the next stage.
- Preserve `start`, `start-driving`, `free-drive`, and asset-loading actions.

- [ ] **Step 1: Add failing UI/app tests for priorities and recommendation.**

  ```ts
  expect(selectedStage(element)).toBe(2); // completedStages: [1]
  expect(selectedStage(allCompleteElement)).toBe(5);
  expect(element.querySelectorAll('[data-stage-id]')).toHaveLength(5);
  expect(lockedButton.disabled).toBe(true);
  ```

  Use a local test helper `selectedStage` reading the existing pressed button.
  Assert explicit stage selection overrides the recommendation, selected vehicle
  reaches the briefing, and Start is blocked for unverified gamepad input.
  Assert loading cancellation still aborts/releases stale assets, an unknown
  byte total has no fabricated percentage, and briefing alone never starts a
  preview. Reuse existing app lifecycle fixtures.

- [ ] **Step 2: Run `npm test -- src\ui\ui.test.ts src\app.test.ts`** and
  confirm the new recommendation/visual-structure assertions fail.

- [ ] **Step 3: Implement the hub and per-lesson visual briefing.**

  Use one illustrated recommended/selected lesson panel, a compact five-stage
  curriculum, and a setup summary. Keep free drive, history, help, settings,
  prototype notice, and onboarding recovery discoverable but secondary.
  Briefings show maneuver-specific goal diagrams and the first authored action.
  Maintain separate forward, reverse, parallel, narrow, and adapted lesson
  descriptions; avoid relabeling prototype art as real training scenes.

- [ ] **Step 4: Verify unit tests and the brief/start browser journey.**

  Run `npm test -- src\ui\ui.test.ts src\app.test.ts`, `npm run typecheck`,
  and the Phase 7 browser file. Expected: clear locked/completed/selected
  states and no implicit movement through loading/briefing.

- [ ] **Step 5: Commit Task 3** as
  `feat: prioritize lesson goals and visual briefings`.

### Task 4: Build the concentration-safe HUD and paused settings

**Files:** Create `src\ui\view-settings.ts`, `src\views\layout.ts`,
`src\views\layout.test.ts`. Modify `src\ui\hud.ts`, `src\ui\screens.ts`,
`src\app.ts`, `src\messages.ts`, `src\style.css`, `src\views\cameras.ts`,
`src\render\preview.ts`, relevant existing view/preview tests, UI/app tests,
`tests\ui-journey.ts`, and affected browser driving journeys.

**Interfaces:**

- Preserve the existing `Hud` public methods. Add `updateLesson(lesson:
  LessonRuntime | null): void` to update stable coach DOM without remounting
  the screen for every lesson event.
- Produce `mountViewSettings(root: HTMLElement, settings: SettingsSaveV1,
  tab: 'view' | 'audio', onAction: (action: ScreenAction) => void): () => void`;
  reuse current control IDs and typed actions. Input setup remains in
  `screens.ts`, so do not create circular UI imports.
- Produce `getOverheadInset(widthCss: number, heightCss: number):
  { readonly x: number; readonly y: number; readonly size: number }` from
  `src\views\layout.ts`, using top-left CSS pixels.
- Preserve inset size `min(320, max(0, width - 32), max(0, height - 32))`,
  right/bottom margin 16 px. `size < 1` yields `{x: 0, y: 0, size: 0}`.
  Reject negative/non-finite dimensions with `RangeError`, matching view resize
  validation. Cameras convert that rectangle to buffer/scissor coordinates
  with the existing pixel ratio and margin-rounding behavior.
- Preview's existing resize path publishes inset size/reservation CSS variables
  on its container; dispose removes those properties. HUD reserves it only
  when overhead is enabled. No second resize observer or render loop.
- Add stable telemetry hooks `[data-telemetry="speed"]`, `"gear"`,
  `"parking-brake"`, `"indicator"`, and `"brake"`; brake is an accessible compact
  meter, not a long percentage sentence. Preserve `#telemetry`.
- Extend test helpers with `openSettings(page: Page, tab: SettingsTab):
  Promise<void>` and `closeSettings(page: Page): Promise<void>` using real
  pause/overlay controls and restoring the correct menu/paused context.

- [ ] **Step 1: Add failing HUD, settings, and inset tests.**

  Assert a lesson update preserves the focused canvas and the coach node's
  identity, emits no new acknowledgement, and does not call pause/resume.
  Assert telemetry and sensor updates reuse mounted nodes; clear sensors keep
  a short limitations reminder, while danger retains direction/severity/distance.
  Assert settings are absent from running tab order, existing setting values
  survive moving to pause, and mute/audio-unavailable retain visual warnings.
  Assert simultaneous routine notices cannot replace an unresolved fault or
  obscure proximity information; unchanged messages are not reannounced.

  ```ts
  expect(getOverheadInset(1440, 900)).toEqual({ x: 1104, y: 564, size: 320 });
  expect(getOverheadInset(390, 844)).toEqual({ x: 54, y: 508, size: 320 });
  ```

  Cover zero-size and resized containers and existing pixel-ratio conversion
  through the existing view tests, not only helper constant assertions.

- [ ] **Step 2: Run affected UI/app/view tests and confirm failure.**

  Run `npm test -- src\ui\ui.test.ts src\app.test.ts src\views src\render\preview.test.ts`.
  Existing camera tests are in `src\views\views.test.ts`; preserve their
  render-target and update-rate checks. No new runner or mock audio framework.

- [ ] **Step 3: Implement the HUD and explicit paused settings.**

  Remove expanded camera/audio forms from running HUD. Keep stable task,
  instruments, compact sensors, and a reliable Escape pause hint. Maintain
  gamepad-mode on-screen gear/brake/indicator access. Use existing runtime
  events, current-step instructions, and stopped-only acknowledgement rules;
  do not implement new semantics for `ScenarioDefinition.guidance`.

  Keep routine messages visual-only and coalesced. Current instruction and
  unresolved faults persist; non-actionable routine notices may expire after
  5 seconds, with timer cleanup on replacement/disposal. Sensor warnings have
  their own reserved area and cannot be displaced by routine notices.
  Add no new chimes or modifications to the proximity audio engine.

  Apply the shared inset rectangle without changing camera targets or mirror
  update rates. Manually inspect the driver's mirror surfaces at supported
  FOVs; reserve central/side sightlines rather than adding projection math.
  Pause/settings/help contain focus, return it on close, and never auto-resume.

- [ ] **Step 4: Update dependent browser assertions and verify.**

  Open settings explicitly before changing controls moved out of running HUD.
  Use gear/speed hooks and brake meter values instead of matching the removed
  telemetry sentence; keep drivetrain assertions substantive. Expand metric
  details only in recap tests, not to simulate driving input.

  Add Phase 7 browser cases for pointer lock, keyboard-only pause/help,
  simultaneous warnings, reduced motion, actual overhead inset non-overlap,
  and tab order under an open overlay. Run the tests from Step 2, typecheck,
  and `npm run test:browser -- tests\browser\phase-7.spec.ts tests\browser\driving.spec.ts`.
  Expected: pass, no focus theft, retained audio and drivetrain checks.

- [ ] **Step 5: Commit Task 4** as
  `feat: streamline driving HUD and paused settings`.

### Task 5: Make calibration and recovery task-focused

**Files:** Modify `src\ui\calibration.ts`, `src\ui\screens.ts`,
`src\ui\ui.test.ts`, `src\app.test.ts`, `src\messages.ts`, `src\style.css`,
`tests\browser\phase-7.spec.ts`, and calibration navigation in
`tests\browser\lesson-driver.ts`/`driving.spec.ts` where required.

**Interfaces:**

- Preserve `mountCalibration` signature, calibration record format, capture
  sequence/validation, device verification, and disconnect handling.
- Reuse Task 2 overlay return targets and existing per-record reset actions.
  Do not fold onboarding reset into the three original persistence records.

- [ ] **Step 1: Add failing grouped-calibration and recovery tests.**

  Assert four labeled groups, raw values in collapsed diagnostics, and visible
  capture/error/Save readiness. Test a long synthetic device name, disconnect
  during capture, replacement, Cancel/reopen, keyboard Escape, and focus return.
  Keep the existing saved-calibration verification tests.
  Assert loader/error/storage recovery each keeps an actionable primary button,
  a non-transient failure explanation, and scoped reset confirmation/cancel.

- [ ] **Step 2: Run `npm test -- src\ui\ui.test.ts src\app.test.ts`** and
  confirm new grouped-content/focus assertions fail before presentation changes.

- [ ] **Step 3: Implement the grouped setup and coherent recovery states.**

  Use semantic fieldsets/legends and captured-state text, not color alone.
  Retain every capture control and expandable live diagnostics. Keep errors
  adjacent to their task and ensure long names wrap without obscuring Save.
  Use a concise heading and existing accurate recovery copy for loading,
  pointer-lock denial, asset/WebGL errors, disconnect, and persistence failures.
  Fix misleading sandbox/no-lesson labels on active lesson canvas and pause UI.

- [ ] **Step 4: Verify targeted tests and browser setup/recovery.**

  Run the Step 2 command, typecheck, and Phase 7 browser tests. In the browser,
  calibrate a fake gamepad through the actual grouped UI, cancel a reset, and
  test retry after an asset failure. Expected: retained safety gates and no
  background focusable controls beneath dialogs.

- [ ] **Step 5: Commit Task 5** as
  `feat: clarify device setup and recovery screens`.

### Task 6: Add constructive recaps and readable history

**Files:** Modify `src\ui\screens.ts`, `src\app.ts`, `src\messages.ts`,
`src\style.css`, `src\ui\ui.test.ts`, `src\app.test.ts`,
`tests\browser\phase-6.spec.ts`, `lesson-completion.spec.ts`,
`tests\browser\phase-7.spec.ts`.

**Interfaces:**

- Consume unchanged `AttemptSummary`/`CompletedAttemptRecord`.
- Keep Retry's existing briefing behavior. Success action `continue` returns
  to the menu with the next unlocked recommendation; Stage 5 recommends replay.
- Preserve `[data-attempt-id]` and full summary rows. Use native `<details>`
  for secondary recap/history metrics.
- Keep history newest-first. Render the first 20 records and a Show More action
  revealing 20 more; keep every record reachable, without deleting/capping
  persisted history or changing the IndexedDB store.

- [ ] **Step 1: Add failing outcome/history tests.**

  ```ts
  expect(failedRecap.textContent).toContain(messages.failureCollision);
  expect(historyRoot.querySelectorAll('[data-attempt-id]')).toHaveLength(20);
  // After Show More with 45 records:
  expect(historyRoot.querySelectorAll('[data-attempt-id]')).toHaveLength(40);
  ```

  Add all five failure-reason mappings to concise static practice tips and
  assert details still contain original metrics. Cover empty history, 45
  records, unknown historical step/obstacle labels, failed append, failed
  reset, and a Stage 5 result with no sixth-stage action.
  Assert success alone unlocks progress, retry disposes/reloads the same
  lesson, and history reset leaves onboarding and original local records intact.

- [ ] **Step 2: Run `npm test -- src\ui\ui.test.ts src\app.test.ts`** and
  establish failure for new outcome action hierarchy/paged presentation.

- [ ] **Step 3: Implement constructive results and structured history.**

  Lead with the recorded outcome and a relevant next action. Use one primary
  success navigation action or failure Retry, with secondary menu access.
  Show structured locale-aware date, lesson, vehicle, and result labels.
  Keep full saved metrics expandable and accessible; do not infer improvement,
  attention, or competence. Preserve every save/recovery warning and reset gate.

- [ ] **Step 4: Verify targeted tests and outcome journeys.**

  Run the Step 2 command, typecheck, and
  `npm run test:browser -- tests\browser\phase-6.spec.ts tests\browser\phase-7.spec.ts`.
  Update old text-shape assertions to the new labeled rows/details; keep their
  result, persistence, progression, and free-drive isolation checks unchanged.

- [ ] **Step 5: Commit Task 6** as
  `feat: add learner-focused recaps and history`.

### Task 7: Validate the complete experience and publish real screenshots

**Files:** Complete `tests\browser\phase-7.spec.ts`, adjust only directly
affected existing acceptance tests, add
`docs\images\phase-7\onboarding.png`, `lesson-hud.png`, `lesson-recap.png`;
update `README.md` and `docs\phase-7-ui-ux-improve.md`.

**Interfaces:** Consume all prior tasks and existing real lesson driver.
No new product API, benchmark target, dependency, or test-only runtime bypass.

- [ ] **Step 1: Finish browser acceptance assertions before final fixes.**

  Use `test.each`-style parameterized cases for the four specified viewports
  (ordinary Playwright `for` loop defining tests). Assert no horizontal overflow,
  readable primary actions, reachable settings/recovery, and bounding rectangles
  that do not overlap the coach/sensors/telemetry or actual overhead inset.
  At 200% browser zoom, inspect text and keyboard focus; CSS `zoom` alone is not
  evidence of browser-zoom accessibility. Check reduced-motion styles.
  Test repeated menu/start/pause/help/settings/retry/exit cycles for duplicate
  canvases, stale focus, duplicate announcements, and leaked overlay listeners.

- [ ] **Step 2: Run the required acceptance gates once on the final code.**

  ```powershell
  npm test
  npm run build
  npm run test:browser
  npm run test:production
  ```

  Run sequentially, stopping after any failed command. Build includes
  typecheck. The full browser gate includes both vehicles completing all five
  lessons through existing calibrated fake-gamepad/keyboard journeys; do not
  replace these with seeded success. Production must still emit no DEV app
  observations and preserve WebGL/asset failure checks. Fix only relevant
  failures and rerun the affected gate.

- [ ] **Step 3: Capture the implemented UI through real browser journeys.**

  Capture illustrated onboarding in a fresh context. Capture the running HUD
  during an actual lesson, including an optional overhead view only after
  explicitly configuring it. Capture a real completed lesson recap using the
  existing driver, not a fabricated completion callback. Use 1440 x 900 for
  consistent documentation captures. Do not include controller identifiers.
  Screenshots must show the built UI, not the brainstorming HTML.

- [ ] **Step 4: Update documentation and verify the image links.**

  Replace the obsolete leading README image with a representative Phase 7
  capture and add the other images with meaningful alt text and short captions.
  Link the approved design from Project Documentation. Record changed screens,
  exact test outcomes, viewport/zoom inspection, screenshot provenance, and
  remaining prototype/hardware/learner-validation limitations in the design.
  Open the rendered README and each image; run `git diff --check`.
  Do not claim reference-PC performance or real-wheel validation.

- [ ] **Step 5: Review and commit the final deliverable.**

  Perform one whole-branch review after the selected execution method's required
  checks, address substantive issues, and rerun relevant tests. Commit images,
  README, and recorded evidence as `docs: showcase Phase 7 learning experience`.
  Stop temporary verification servers; leave user-requested preview services
  only if explicitly needed. Report actual results and remaining limitations.

## Plan self-review

- Spec coverage: Tasks 1-2 cover introduction/storage/replay; Task 3 covers
  selection/loading/briefing; Task 4 covers HUD/settings/help/insets; Task 5
  covers calibration/errors/recovery; Task 6 covers outcomes/history; Task 7
  covers accessibility, regression acceptance, screenshots, and evidence.
- Interfaces: keep `AppState`, the original three persistence records,
  `AttemptSummary`, and physics contracts unchanged; shell-only additions are
  typed in `runtime-types.ts`. No audio cue API or generic router is introduced.
- Review Focus: each of the five conditions has explicit tests in its owning
  task. Manual art/sightline/zoom inspection complements, not replaces, tests.
- Proportion: implementation bodies and illustration geometry are left to the
  builder; contracts, storage key, navigation boundaries, paging, timing, and
  acceptance values are fixed here.

## Handoff

Plan written after owner approval of the design. Execution method and plan
review are pending; no product implementation or acceptance run has occurred.
Recommend native execution to minimize repeated context across tightly coupled
screen/HUD/app interfaces, with one independent whole-branch review at the end.
