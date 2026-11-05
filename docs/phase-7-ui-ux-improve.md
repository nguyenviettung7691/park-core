# Phase 7: UI/UX Improvement

Date: 2026-11-05

Status: Draft for owner approval. Product changes and README screenshots are
not implemented. This document will also record implementation evidence once
the approved work is built.

## Intent and decisions

Make Park-Core feel like a deliberately designed learning game rather than a
collection of prototype controls. Attract the learner with clear, eye-catching
parking graphics, explain what to do, and preserve concentration during practice.

Owner decisions:

- Keep the current amethyst accent.
- Use game-tutorial UI/UX as inspiration.
- Choose the tutorial-first journey rather than the cinematic lesson hub.
- Make guidance clear without overwhelming the learner.
- Do not interrupt concentration while driving. Use unobtrusive signals, such
  as sound or a small notification panel, when attention is needed.
- Review every screen and component, document Phase 7 here, and add screenshots
  of new implemented screens to README with captions.

The implementation proposals below remain subject to approval of this document.
They are not additional decisions attributed to the owner.

## Goals, non-goals, and anti-goals

Goals:

- A first-time learner can identify the parking goal, basic controls, and next
  action without reading a wall of text.
- Give each screen one visually dominant action and a clear way back.
- Keep the central driving view clear; prioritize the current task, driving
  state, and actionable warnings.
- Explain outcomes constructively using recorded facts.
- Apply one coherent visual and interaction language to normal, empty, loading,
  failure, device-setup, and storage-recovery states.

Non-goals:

- No new curriculum, physics, parking tolerances, failure rules, unlock rules,
  accounts, synchronization, or simulated traffic.
- No production 3D asset replacement, environment makeover, new renderer,
  shaders, dynamic lighting, or extra real-time scene previews.
- No frontend framework or large UI/animation dependency.
- No claim that software acceptance establishes training readiness.

Anti-goals:

- No tutorial modal, forced acknowledgement, focus theft, or automatic tutorial
  pause while the learner is moving.
- No decorative information competing with clearance warnings.
- No invented praise, mastery claims, stars, scores, streaks, countdowns,
  competitive rankings, or penalties for safe repositioning.
- No sound-only, color-only, or hover-only instructions.
- No hiding data-loss warnings in transient notifications.

## Approaches considered

| Approach | Benefits | Tradeoffs | Decision |
|---|---|---|---|
| A. Cinematic lesson hub | Strong vehicle artwork; recommended lesson leads; fewer steps before practice | Less explicit first-time instruction; relies more on discovery | Not selected |
| B. Tutorial-first journey | Illustrated goal, input-specific controls, and readiness before the first drive; contextual guidance afterward | Adds first-visit state and a short onboarding flow; needs skip/replay paths | Selected by owner |

Both use the same lightweight DOM/CSS foundation and authored local graphics.
The owner selected B after seeing both browser mockups.

## Current-state review

Reviewed `src/ui/screens.ts`, `src/ui/hud.ts`, `src/ui/calibration.ts`,
`src/style.css`, app orchestration, typed input/storage contracts, lesson
metadata, and sensor audio. Inspected live menu, briefing, driving, and pause
states at 1440 x 900 in an isolated browser context. Other states were inspected
in source; this is not yet a full rendered-state acceptance pass.

Representative findings:

- `src/ui/screens.ts:329` - menu puts setup, curriculum, safety copy, controls,
  and navigation into one equal-weight column.
- `src/ui/screens.ts:233` - briefing explains only the first instruction;
  no visual parking-goal overview.
- `src/ui/screens.ts:274` - recaps lead with a definition list and equally
  styled actions rather than an outcome and next step.
- `src/ui/hud.ts:128` - camera, FOV, volume, and mute controls remain expanded
  over the driving view.
- `src/ui/hud.ts:191` - speed, gear, brakes, indicators, and input source form
  one sentence with little visual hierarchy.
- `src/ui/hud.ts:222` - both sensor panels repeat long guidance even when no
  obstacle is detected.
- `src/style.css:57` - HUD and screen layer use independently positioned
  content; live driving inspection showed the instruction overlapping the
  front sensor panel at 1440 x 900.
- `src/ui/hud.ts:105` - checkbox and range controls lack an explicit purple
  accent; live native sliders appeared blue.
- `src/ui/calibration.ts:26` - raw device values precede an extensive flat
  setup form; group the task and make diagnostics secondary.

Existing semantic buttons, control labels, focus-visible styling, reduced-motion
support, and explicit storage-reset confirmations are useful foundations.
Preserve and strengthen them rather than rebuilding the UI architecture.

Pointer lock is a material interaction constraint: during keyboard driving,
the canvas owns the pointer. Clicking an apparent HUD button is not a reliable
primary interaction. Releasing pointer lock correctly led to the pause screen
during inspection; this was not established as a broken stacking order.

## Visual language

- Keep `#9B59B6` as the main accent, with the existing dark charcoal surfaces,
  light text, and pale-purple supporting accents.
- Use a clear type scale, shorter headings, consistent spacing, restrained
  borders, and a stronger distinction between primary, secondary, and tertiary
  actions. Use system fonts; do not introduce a font download.
- Add original local SVG parking/vehicle illustrations: vehicle silhouette,
  bay outline, approach direction, and relevant obstacle. They communicate the
  task rather than decorate every surface. Provide an accessible text equivalent.
- Use simple static artwork or existing local asset-derived stills, not an
  additional live renderer. Illustrations are explanatory, not scale-accurate
  driving instructions or guaranteed maneuver paths.
- Use purple for selection, target zones, and progress. Reserve standard
  green/yellow/red for proximity indicators; do not add blue, orange, or green
  to the main UI. Set native control accent colors explicitly.
- Use brief opacity/transform transitions only where helpful; honor reduced
  motion. No autoplay cinematic, pulsating coach, or continuous celebration.
- Preserve Vietnamese learner-facing copy and English technical documentation.

## Experience and screen inventory

### First visit and replayable introduction

Proposed flow:

```text
First visit -> Goal -> Controls -> Ready -> Lesson selection
                 \------ Skip ------/
Returning visit ---------------------> Lesson selection
Help -> Replay introduction -> Return to invoking non-driving screen
```

1. Goal: a prominent parking illustration and a short explanation of securing
   the vehicle inside the bay.
2. Controls: show the selected input source and essential controls in visual
   groups. Make clear that S/Down is braking, not reverse; selecting R is
   necessary to reverse. Keep full controls available as secondary help.
3. Ready: explain pause/help and the prototype limitation, then enter lesson
   selection. Do not start moving or request pointer lock from onboarding.

Each screen has Back where applicable, Skip, and a clear next action. Keyboard
is the existing default, not a new owner preference. A secondary input-setup
action allows gamepad selection; gamepad instructions reflect verified
calibration and never claim an unverified device is ready.

Record only whether this introduction was completed or explicitly skipped.
Use a separate versioned local record, without rewriting existing progress,
settings, calibration, or attempt history. If the record is unavailable or
unreadable, continue in session memory, show an explicit save/recovery notice,
and keep practice available. Do not overwrite unreadable data without confirmed
reset. Replay never resets progress or interrupts an active drive: enter it
from the menu or explicit pause, then return to that context.

On startup, a valid completed/skipped record bypasses the introduction. An
absent, unavailable, or unreadable record offers it again, including for
existing learners who have not yet made this choice. Skip always reaches
lesson selection. With unavailable storage, completion/skip is remembered
only until reload; with unreadable storage, retain the original value until
confirmed reset and use session memory meanwhile.

### Lesson selection and free drive

- Lead with a recommended next unlocked lesson and its visual parking goal.
  Keep all five lessons accessible in a compact curriculum list with explicit
  selected, completed, and locked labels.
- Recommend the first incomplete unlocked stage, or replay Stage 5 once all
  are complete. An explicit learner selection takes precedence.
- Put vehicle and input setup in a clearly labeled secondary area, not ahead
  of the learning task. Show the current setup near the primary start action.
- Keep free drive separate and clearly labeled as practice without lesson
  progression. Keep history and replayable help discoverable.
- Keep an honest, compact prototype notice visible; make longer explanations
  available without forcing repeated reading.

### Loading and lesson briefing

- Loading retains selected lesson/vehicle context, accessible progress, and a
  clear cancel/back action. Do not invent percentages when total size is unknown.
- Briefing shows an authored diagram suited to the maneuver, a short goal,
  the initial action, and a secondary full-controls explanation.
- Keep an explicit Start Driving action. Loading, onboarding, and briefing
  never implicitly enable movement.
- Retry returns through the existing briefing/start safety boundary.

### Driving HUD and tutorial coach

- One compact, stable current-task panel; use existing authored lesson steps.
  Routine updates replace its text rather than stacking notifications.
- Do not move focus, open dialogs, pause, or require new acknowledgements for
  tutorial presentation. Preserve acknowledgements already required by lesson
  logic and their stopped-only rule.
- Visually separate speed, gear, parking brake, and indicators. Keep detailed
  brake percentage and input-source explanations in secondary help/details.
- Use compact front/rear proximity indicators with direction, severity, and
  distance where available. Always retain a visible short reminder that
  sensors are aids, not proof of safe clearance; put the full explanation in
  help instead of repeating it in two large panels.
- Keep existing sensor thresholds, directional logic, and audio behavior.
  Preserve urgent visual warnings even when muted or audio is unavailable.
- Routine tutorial updates use the unobtrusive task panel. No additional
  lesson chime in the initial implementation: existing proximity tones remain
  the audible attention signal and do not compete with decorative audio.
- Show actionable warnings in a reserved compact area. Routine notices may
  expire, but the current instruction and unresolved actionable faults remain
  available. Coalesce repeats; do not create a growing toast stack.
- Put FOV, audio, input setup, and detailed controls in pause/settings.
  Keep camera, overhead, trajectory, recentering, and help available from the
  explicit paused interface. Do not advertise nonexistent hotkeys.
- While pointer-locked, show Escape as the reliable pause/help entry. Do not
  rely on a clickable floating toolbar to operate the simulator. Preserve
  existing gamepad-mode on-screen gear, parking-brake, and indicator controls.
- Respect existing lesson-step and aid-recording semantics. Do not invent a
  new guidance curriculum based on unused metadata or change checkpoint rules.
- Reserve layout space for actual mirrors and the optional overhead inset;
  do not place coach, warnings, or telemetry over them. Coordinate with the
  renderer's actual inset dimensions, not only CSS placeholder boxes.

### Pause, settings, and input setup

- Give the paused state one clear Resume action plus secondary retry/menu
  actions. Explain any existing blocked-resume condition next to Resume.
- Group settings into View, Audio, and Input; retain every existing setting
  and persistence behavior.
- Help and settings only open through explicit learner action, not through
  routine notifications. Closing them restores the pause context and focus;
  resume still requires the existing neutral-input and pointer-lock checks.
- Do not leave active background driving controls focusable under a dialog.
  Do not silently resume after returning from setup or help.
- Use lesson-specific language for lessons and sandbox language for free
  drive; remove misleading "no lesson" labels from active lesson UI.

### Calibration

- Visually group steering, throttle, brake, and gear verification in that
  order, with short instructions and visible captured/unverified states.
- Keep the existing capture, validation, reconnection, and save semantics;
  this is not automatic calibration or new hardware support.
- Make raw axis/button values expandable diagnostics instead of the leading
  content. Keep device errors and Save readiness visible.
- Preserve Cancel, keyboard navigation, focus restoration, and explicit
  verification of saved calibration.

### Outcome and history

- Success leads with the completed lesson and a calm acknowledgement, not
  proof of driving competence. Failure leads with the recorded reason and
  one static, reason-specific practice suggestion.
- Success primary action returns to lesson selection with the next unlocked
  lesson recommended; failure primary action retries the same lesson through
  briefing. Avoid duplicate "Continue" and "Menu" actions with unclear results.
- Keep all existing recorded measurements accessible in expandable details.
  Never invent improvement comparisons or infer actual observation from
  acknowledged steps or camera usage.
- At Stage 5 completion, clearly return to the curriculum/replay choices;
  do not imply a nonexistent Stage 6.
- History uses structured date, lesson, vehicle, and result labels rather
  than one long button sentence. Detail retains the complete saved summary.
- Empty history explains that completed attempts appear here and links back
  to practice. Preserve loading, session-only, unreadable, and reset states.
- Long history remains scrollable and keyboard-accessible without rendering
  all records as a single expensive uninterrupted layout.

### Errors, notifications, and destructive actions

- Errors name the problem and retain existing retry/reload/menu recovery.
  Do not disguise failed asset loads or failed saves as success.
- Session-only and unreadable-storage notices identify the affected record.
  Reset remains explicit, scoped, and cancellable.
- Existing safety pauses, device disconnect handling, terminal lesson outcomes,
  and renderer faults may interrupt driving as they do now. The no-interruption
  rule concerns routine tutorial guidance, not suppression of safety behavior.

## Accessibility, layout, and performance

- Semantic headings, buttons, labels, and status regions; visible focus and
  at least 44 px interaction targets. Decorative icons are hidden from assistive
  technology; meaningful diagrams have text alternatives.
- Focus changes only for explicit navigation/dialog actions, not telemetry
  or current-task updates. Dialogs contain focus and restore it on exit.
- Announce discrete lesson changes politely, not frame-rate telemetry.
  Do not repeatedly announce unchanged warnings.
- Purple filled buttons must meet text contrast requirements; adjust text or
  surface treatment rather than assuming white on the accent is sufficient.
- Use locale-aware dates/numbers, tabular numerals for telemetry, and resilient
  wrapping for long Vietnamese text and controller names.
- Validate 2560 x 1440, 1440 x 900, 1280 x 720, and a 390 x 844 narrow viewport,
  plus 200% zoom. Narrow layouts support navigation/setup and readable HUD
  reflow; they do not imply touch-driving support.
- Keep the central view, mirrors, and overhead inset free of UI collisions.
  At constrained sizes, collapse optional information before essential state
  and safety warnings; allow scrolling on non-driving screens.
- No extra render loop or per-frame DOM remounting. Reuse mounted telemetry
  elements and update only changed presentation values.
- Preserve mirror update cap and the existing renderer/physics performance
  constraints. The 1440p/60 Hz target remains unverified on reference hardware.

## Implementation boundaries

Build on `src/ui/screens.ts`, `src/ui/hud.ts`, `src/ui/calibration.ts`,
`src/style.css`, and `src/messages.ts`. Extend typed navigation and onboarding
storage only where required. Keep lesson evaluation and existing saved formats
backward-compatible. Do not refactor unrelated runtime/rendering code.

Builder-owned details:

- Small UI helpers/file splits only when they reduce duplication.
- Exact SVG composition, spacing, responsive breakpoints, and component names.
- Exact notification expiry for non-actionable messages; actionable warnings
  must not disappear merely because a timer elapsed.
- Efficient long-history presentation using existing tooling, without adding
  a general-purpose UI framework.
- Precise Vietnamese copy, provided its meaning and safety rules are preserved.

## Verification and README deliverables

Add focused tests for onboarding complete/skip/replay and storage failure,
navigation/focus restoration, retained lesson start/acknowledgement semantics,
HUD notification priority, and access to moved settings/controls.

Use the existing Vitest and Playwright suites. Run relevant UI/app/storage
tests, typecheck, and build; then browser journeys covering keyboard and
calibrated fake-gamepad paths, lesson selection/briefing/pause/retry/outcome,
history/recovery, and responsive/reduced-motion behavior. Reuse existing
lesson-completion coverage to establish that presentation changes did not
alter successful progression. Do not equate mocks with real-wheel acceptance.

Capture at least three representative implemented screens: illustrated
onboarding, the in-session lesson HUD, and a real lesson recap. Save local
images under `docs/images/phase-7/` and embed them in README with short captions
explaining the learner benefit. Use real UI journeys or clearly labeled test
fixtures; do not present mockups or fabricated progress as product screenshots.
Set useful alt text, avoid personal controller identifiers, and ensure the
README no longer leads with an obsolete pre-Phase-7 screen.

Update this document with actual changed screens, verification results,
screenshot paths, and remaining limitations after implementation. Until then,
no implementation, test pass, learner-validation, or performance claim is made.

## Approval

Builder check completed on 2026-11-05. Its questions were resolved from the
existing request and explicit proposals: all listed screens are in scope;
onboarding uses the separate record and reload behavior above; routine tutorial
cues are visual-only initially; narrow layouts do not add touch driving.
These proposals still require owner approval, not another builder decision.

Pending owner review of this document and the tutorial-first browser mockups.
After approval, write the implementation plan before changing product code.
