# Park-Core: Phase 2 Detailed Design (Design & Scaffolding)

Date: 2026-11-03

Status: Approved and implemented on 2026-11-03. Scaffold software checks passed; this is not a validated driving simulation or performance result.

Scope: Phase 2 "Design & Scaffolding" of [the technical design](tech-design.md). This is **not** the instruction file's "Phase 2" (Cannon-es/Gamepad physics). It refines [the approved detailed design](detail-design.md) and Task 1 of [the implementation plan](implementation-plan.md); where they differ, Section 9 lists the precise updates the implementing agent will apply after approval.

Deliverable order requested by the owner: this design, then the Phase 2 implementation plan, then code. The implementing agent also updates original documents alongside the deliverable that changes a decision.

## 1. Intent

Produce the smallest bootable foundation on which later phases can add physics, input, sensors, assets and progression without reworking it: strict toolchain, authoritative shared contracts, a tested fixed-step clock, the Amethyst theme, a Vietnamese menu shell, empty HUD containers and one Three.js rendering loop. Why: Phase 3+ tasks consume these contracts; a mistaken boundary here multiplies rework under a token-limited budget.

The Three.js loop is shown only as a **static, explicitly labeled, non-drivable prototype preview** (box, plane, axes markers). It proves renderer lifecycle, resize and error handling; it teaches nothing and simulates nothing.

## 2. Goals, non-goals, anti-goals

| Category | Definition |
|---|---|
| Goals | Strict TS/Vite project with the six original scripts; exact-pinned dependencies; `contracts.ts`, `runtime-types.ts`, `messages.ts`, `clock.ts`; Vietnamese menu with vehicle selector; HUD containers (empty); one renderer with safe lifecycle; WebGL2 failure/context-loss screens; tests written before code |
| Non-goals | Cannon-es world or vehicle, input controllers/Gamepad, sensors, audio, mirrors, overhead camera, GLB assets, lessons, persistence, calibration UI, a reusable multi-screen framework |
| Anti-goals | Presenting the preview as `AppState.playing`, a lesson or a completed lesson; automatic simulation; invented or live-looking telemetry; enabled controls whose feature does not exist; performance, browser or hardware claims |

## 3. Constraints

- Strict TypeScript, Vite, Three.js, vanilla DOM/CSS. No framework, state-machine library, CSS library or extra test runner. `cannon-es` is **not** installed or imported in this phase (it is first needed by Task 2).
- Learner copy in Vietnamese; identifiers and docs in English. Accent `#9B59B6`; no blue/orange/green main-UI accent; sensor colors only for sensors (none are shown).
- Fixed step `h = 1/120 s`, at most 8 steps per frame, wall-clock delta clamp 0.1 s.
- Exact dependency versions (`--save-exact`), lockfile committed. Existing tools only: Vitest (Node default, jsdom opt-in), Playwright (Chromium + Firefox), TypeScript, Vite.
- Scripts unchanged: `dev`, `typecheck`, `build`, `test`, `test:browser`, `preview`.
- Prototype visuals use `MeshBasicMaterial`, no shadows, no external assets.

## 4. Approaches and owner's choice

| Approach | Verdict |
|---|---|
| **A. Phase-bounded scaffold** (chosen by the owner): only what Phase 2 lists, plus contracts needed by Task 1 | Smallest reviewable surface; later phases extend named contracts |
| B. Broader reusable future-screen framework (router, screen registry, generic HUD binding) | Rejected: speculative abstraction contradicting "no heavy architectural layer" and the plan's glue-only `app.ts` |

## 5. Architecture and ownership

```text
main.ts -> createApp(root) -> { dispose() }
app.ts   owns: AppState, shell view flag, renderer (via preview), clock, listeners
ui/screens.ts  mountScreen(...) -> unmount     (menu, error, preview notice)
ui/hud.ts      static HUD containers only (see 5.4)
render/preview.ts  createPreview(canvas, size) -> Preview
clock.ts       createClock()
```

`render/preview.ts` is a Phase 2 addition to the Task 1 file map (Section 9). It is a small module, not a framework.

The renderer lifecycle is the foundation later phases extend, not throwaway code. Keep the prototype scene construction separate from lifecycle functions within this module so later work can replace the placeholder content without rewriting sizing, cleanup and error handling. Do not introduce a pluggable scene framework in anticipation.

### 5.1 Application state and the preview flag

`AppState` is used exactly as in design Section 10/11; Phase 2 only ever holds `{ kind: 'menu' }` or `{ kind: 'error', ... }`. The preview is a separate shell flag owned by `app.ts`:

```ts
type PreviewPhase = 'closed' | 'running' | 'paused'; // runtime-types.ts
interface ShellView { readonly state: AppState; readonly preview: PreviewPhase }
```

Rules: preview is entered only from `menu`; `state` stays `menu` while preview is `running`/`paused`; no code path creates `loading`, `briefing`, `playing`, `success` or `fail`. The Task 1 `'start'` action is not emitted in Phase 2 (its type remains defined for Task 2).

### 5.2 Menu and preview entry (designer's call)

- Menu keeps a labeled native `<select>` vehicle selector (`Sedan`, `CUV`) and native `<button>` controls. The selection updates `ScreenContext.selectedVehicleId` and the preview label only; no vehicle model exists.
- "Bắt đầu" is **removed in Phase 2** because it implies a lesson. The primary button reads **"Xem thử mô hình (không lái được)"**. Inside the preview, the exit button reads **"Quay lại menu"**. This wording is a designer's call, subject to approval, and "Bắt đầu" returns with Task 2/6 when a drivable session exists.
- Menu also shows a short Vietnamese note that this is a technical preview with no driving, lessons or saved progress.
- Add `'open-preview'` and `'close-preview'` payload-free members to `ScreenAction`.
- The selector emits `'select-vehicle'` with a `VehicleId` payload; screens never mutate `ScreenContext` themselves. This is an implementation detail of the approved selector, not new behavior.
- Keep `ScreenContext` intact. Initialize session-memory progress to `{ version: 1, completedStages: [], lastVehicle: 'sedan' }`, selected stage to `1`, and selected vehicle to `'sedan'`. Designer-selected settings defaults: version `1`, volume `0.5`, muted `false`, driver FOV `60`, camera `'driver'`, overhead `false`, trajectory `false`, input `'keyboard'`, resolution scale `1`. These are internal defaults, not displayed completion, active aid or persistence claims; no storage is accessed.

### 5.3 Rendering startup and loop (one renderer)

1. Importing or `createApp` never creates a WebGL context. The renderer is created only on the learner's `open-preview` click (explicit user interaction).
2. `createPreview` first feature-detects WebGL2 by creating the context on the app's `canvas#simulation` (`getContext('webgl2')`); the same canvas is passed to `THREE.WebGLRenderer`. No probe canvas, so exactly one context ever exists.
3. The preview scene: ground `PlaneGeometry`, one `BoxGeometry` placeholder, simple theme-colored axis markers, a clearly visible DOM badge "Bản xem thử — không lái được". Camera is fixed; nothing moves automatically.
4. The loop is `requestAnimationFrame`, renders only while `running`. It calls `clock.advance` with the clamped delta and a no-op step callback so the foundation is exercised without simulating anything; the rendered result is static.
5. Returning to the menu disposes the preview (Section 7). Re-entry creates a new renderer; contexts never accumulate.

### 5.4 HUD containers

`ui/hud.ts` creates the design Section 12 hierarchy (`#lesson-strip`, `#proximity-front`, `#proximity-rear`, `#telemetry`, `#view-controls`, `#overhead-frame`, `#status-message`) inside `#app` with CSS Grid named areas. Phase 2 honesty rules:

- Containers are present in the DOM but empty and `hidden`, except `#status-message` (polite live region) and the preview badge. Telemetry shows no number, gear or proximity state; there is no placeholder "0 km/h" or "P".
- No HUD button exists in Phase 2, so none can be enabled without a feature. `pointer-events: none` on `#hud`.

## 6. Contracts

- `src/contracts.ts`: copy design Section 11 verbatim (types, `VehicleTelemetry`, `InputFrame`, `InputAction`, `AppState`, lesson/scenario/profile/sensor/persistence types). Future contracts may exist without implementations. `MessageKey` is `keyof typeof vi`, not `string`.
- `src/runtime-types.ts`: Task 1 adapter types exactly as the plan (`PhysicsSnapshot`, `RenderFrame`, `ColliderBox`, `VehicleAnchors`, `SceneAssets`, `ControlNotice`, `InputPoll`), `SettingsSaveV1`, `ScreenContext`, `ScreenAction`, plus `PreviewPhase`/`ShellView`. `SceneAssets` imports `THREE` as a type only.
- `src/messages.ts`: finite Vietnamese dictionary `vi`, parameterised by functions where needed. Phase 2 keys cover menu title, preview entry/exit/badge/notice, vehicle labels, WebGL unsupported, context lost, runtime error, reload and back-to-menu actions, resume and paused notice, and the non-claim notice. No subsystem redefines `Gear`, `VehicleTelemetry`, `ScenarioDefinition`, `AppState`.
- Boundary validation (ranges, units) stays at config/storage boundaries per design; Phase 2 has no storage, so no validators beyond `Clock` input checks.

## 7. Lifecycle, failure and cleanup

### Clock
`createClock().advance(elapsedS, step)` rejects negative/non-finite delta by throwing `RangeError`; clamps to 0.1 s; at most 8 steps; discards excess backlog and reports `droppedTimeS`; returns `alpha` in `[0,1)`. `reset()` clears the accumulator including a half-step. The step callback is a no-op in Phase 2; no physics exists.

### WebGL2 and context loss
- No WebGL2: state becomes `{ kind: 'error', messageKey: 'webglUnsupported', retryable: false }`; screen offers "Quay lại menu" only (reload cannot fix it).
- Renderer construction throws: `error` with `retryable: true`, buttons "Thử lại" (reopen preview) and "Quay lại menu".
- `webglcontextlost` (listener calls `preventDefault`): stop the loop, set error `webglContextLost`, `retryable: true`. Offer "Tải lại trang" (`location.reload()`) and "Quay lại menu". Restoration is **not** attempted in place; the learner re-enters the preview, which builds a fresh renderer.
- An unexpected exception in a frame stops the loop and shows the runtime error screen; it is never swallowed.

### Focus and visibility
`visibilitychange` (hidden), `window blur` while preview `running` → `paused`: cancel the animation frame, `clock.reset()`, show a Vietnamese paused notice and an explicit **"Tiếp tục xem thử"** button. Resume is only by that button (focus moves to it); it resets the clock and records a fresh timestamp so no delta from the hidden interval is used. No automatic resume on focus return. This pause is the shell's `PreviewPhase`, not `AppState.paused` (which belongs to a lesson).

### Sizing
`resize` (and `ResizeObserver` on the canvas container) updates the camera aspect and drawing buffer. Buffer size = CSS size × `devicePixelRatio`, then scaled uniformly by `min(1, 2560/w, 1440/h)` so both axes stay within 2560×1440 and aspect is preserved; each side is rounded and floored to ≥1. Extreme portrait (e.g. 400×3000) and wide (e.g. 5000×300) aspects must not yield a zero or distorted buffer. Call `renderer.setSize(w, h, false)`; CSS (not JS style) sets the canvas to fill the viewport. The scale factor is a pure function `fitDrawingBuffer(cssW, cssH, dpr)` for unit testing.

### Idempotent disposal
`Preview.dispose()` may be called any number of times and in any state. First call: cancel the animation frame, remove `resize`/`visibilitychange`/`blur`/`webglcontextlost`/`webglcontextrestored` listeners and the `ResizeObserver`, dispose every geometry and material the preview created, call `renderer.dispose()`, and `forceContextLoss()` only if the context is not already lost; later calls are no-ops. `createApp(...).dispose()` disposes the preview first, then unmounts screens, then removes its own listeners. No `window.__*` or other production debug globals; tests inspect via injected seams (Section 8).

## 8. Testing (authored before implementation)

Test seams without production globals: `createApp(root, deps?)` and `createPreview(canvas, deps?)` accept optional injected `{ now, requestFrame, cancelFrame, createRenderer, createContext }` defaulting to browser implementations. Tests pass fakes; production never exposes them.

| Level | Cases |
|---|---|
| Vitest (Node) `clock.test.ts` | 8-step cap with `droppedTimeS`, `alpha` range, `reset()` clears half-step, negative/NaN/Infinity rejected, 0.1 s clamp, exact `1/120` accumulation |
| Vitest `fitDrawingBuffer` | 1280×720@1; 2560×1440@2 capped; 5120×1440; extreme portrait/wide; never <1 px; aspect within 1 px |
| Vitest jsdom `ui.test.ts` | Menu is Vietnamese; labeled vehicle selector; native buttons; keyboard-focusable with visible-focus class; no preview button label "Bắt đầu"; menu does not create a renderer; HUD containers present, empty/hidden, no telemetry text; open/close preview keeps `AppState` `menu` |
| jsdom lifecycle (fake renderer/frame) | Preview created only on click; exactly one renderer per open; double `dispose()` safe; all listeners removed (count add/remove calls); frame cancelled; hide/blur pauses and resets clock; resume only through button, no catch-up delta; context-lost shows error and stops loop; ten open/close cycles leave zero listeners and zero live renderers |
| Playwright `shell.spec.ts` (Chromium, Firefox) | Menu appears, no unexpected console error; open preview shows canvas with non-blank pixels and the non-drivable badge; WebGL error path (WebGL disabled via launch option or context stub before load) shows Vietnamese message; resize from 1280×720 to extreme sizes has no horizontal page overflow and capped buffer; return to menu then re-open works |

Browser tests fail on missing evidence rather than mocking. Test browsers are installed only when the first run reports missing executables. Use real browser WebGL2; software rendering and documented browser launch options are acceptable for functionality, never performance evidence. If the environment cannot render after reasonable configuration attempts, report that browser gate as blocked, not passed or silently skipped. Pixel evidence may be captured by a canvas screenshot; do not enable continuous GPU readback in production. Use portable forward-slash paths in commands and new documentation. Tests do not claim frame rate, GPU or cross-platform support.

## 9. Required updates to original documents (implementing agent executes)

| Document | Update |
|---|---|
| `implementation-plan.md` Task 1 | Menu test: replace “Bắt đầu” assertion with preview entry label “Xem thử mô hình (không lái được)”; `ScreenAction` add `'open-preview'`, `'close-preview'` and note `'start'` is not emitted until Task 2; add `PreviewPhase`/`ShellView` to Interfaces; add `src\render\preview.ts` (+ test seams) to the file map and Task 1 Files; Step 4: state that preview is a static non-drivable inspection, `cannon-es` is not installed until Task 2; add focus/visibility pause and explicit resume, context-loss and drawing-buffer-cap tests |
| `implementation-plan.md` Execution conventions | State `cannon-es` is installed in Task 2, not Task 1 |
| `detail-design.md` Sections 10, 12, 13, 15 | Section 10: note that a non-drivable inspection preview is a shell view flag, not an `AppState`. Section 12: record the preview entry/exit wording and badge; HUD containers may be empty/hidden before their feature exists. Section 13: record the 2560×1440 cap formula and WebGL2/context-loss recovery by new renderer. Section 15: add Phase 2 preview as a designer's call |
| `tech-design.md` Section 6 Phase 2 | Add one sentence: Phase 2 delivers a static non-drivable preview; no physics, input or assets |
| `.github/copilot-instructions.md` | Add note that doc "Phase 2 Design & Scaffolding" maps to its Phase 1 only; no change to rules |

## 10. Model routing (current examples)

| Work | Tier / example |
|---|---|
| Vite/TS/Playwright config, `style.css`, HUD DOM scaffolding, preview scene boilerplate | Lightweight, `claude-haiku-5.5` |
| `contracts.ts`, `runtime-types.ts`, `messages.ts`, `clock.ts`, app/preview lifecycle and test seams, WebGL failure handling | Standard, `claude-sonnet-5.5` |
| Premium | Not used; no physics or 3D mathematics in this phase |

Tests are written first and observed failing before implementation. Routing names are current examples, not requirements.

Execution used Lightweight (`claude-haiku-5.5`) for configuration/CSS and Standard (`claude-sonnet-5.5`) for bounded contract extraction, document work and review. Core clock, renderer, shell and integration were implemented inline under the selected Native workflow.

## 11. Builder discretion and remaining gates

The builder may choose: exact dependency versions compatible with the selected Node (pinned), file-internal structure, preview placeholder dimensions and colors within the theme, Vietnamese wording polish that preserves the entry/exit meaning, and the exact WebGL-disable technique in Playwright.

Not allowed without owner approval: adding tools or dependencies, new `AppState` kinds, a screen framework, drivable behavior, sample HUD values.

The dependency restriction excludes the exact runtime/development packages already authorized by the original implementation plan and this design; selecting compatible versions of those packages needs no additional approval.

### Builder check

A fresh Standard-tier reviewer checked this draft on 2026-11-03. The three remaining implementation questions were resolved as designer's calls: retain and extend renderer lifecycle rather than discard it; use real browser rendering with an honest blocked gate if unavailable; preserve `ScreenContext` with explicit in-memory defaults. No additional product decision was needed.

Performance non-claims: no frame-time, 144 Hz, GPU or memory statement is made. The preview is not a benchmark. Reference/minimum hardware, real-wheel mapping, licensed assets, physics validation and instructor review remain open per design Section 15. Phase 2 verification covers only: unit/DOM tests, typecheck, build, and Chromium/Firefox preview smoke on the machine used, reported as run.

## 12. Implementation evidence

On 2026-11-03 in the isolated `phase-2-scaffolding` worktree, Node 26.13.0:
`npm test` passed 46 tests; `npm run typecheck` and `npm run build` passed;
`npm run test:browser` passed six tests across Chromium and Firefox. Browser
tests decoded real rendered pixels, exercised ten preview cycles, resizing,
keyboard focus, explicit resume, context loss and unsupported WebGL2 feedback.
The first browser run exposed a mixed-clock-origin error; a failing regression
was added before fixing it by reading the same monotonic clock on every frame.

The renderer's narrow `PreviewContext` type also permits explicit context release
if renderer construction fails. Resize-observer disposal and no catch-up on resume
have focused coverage. These are implementation refinements, not added features.
The build reports a 500 kB chunk-size warning for the bundled Three.js code;
no warning threshold was suppressed or performance claim made.
Git author identity was initially unset. The owner supplied it and authorized
committing the work and merging locally into `main`, without a push.

The final Standard-tier code review found no Critical or Important issues.
One minor remains deferred: if a resume action is delivered after the document
has become hidden, the shell can show the running controls while the preview
declines to resume. Returning to Menu and reopening recovers; normal visible-tab
resume and context-loss recovery pass browser tests.
