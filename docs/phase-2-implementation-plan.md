# Park-Core Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (Native, owner's recorded preference) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Phase 2 scaffold: strict toolchain, shared contracts, tested fixed-step clock, Vietnamese menu, empty HUD containers and one safely managed static, non-drivable Three.js preview.

**Architecture:** `app.ts` owns shell state and screen mounting; `render/preview.ts` owns one clock, the renderer, animation loop and every preview listener on the app's behalf; `ui/` is glue-only DOM. Sizing is a pure function. Tests inject renderer/scheduler through optional factory arguments; no production globals.

**Tech Stack:** Strict TypeScript, Vite, Three.js (runtime); dev: `typescript`, `vite`, `@types/three`, `vitest`, `jsdom`, `@playwright/test`. `cannon-es` is not installed (Task 2 of the original plan installs it).

**Spec:** [docs/phase-2-detail-design.md](phase-2-detail-design.md) (approved 2026-11-03); refines Task 1 of [implementation-plan.md](implementation-plan.md).

**Date / status:** Approved and implemented on 2026-11-03. All three task verification gates passed (46 unit/DOM tests, typecheck, production build, six Chromium/Firefox tests). The owner supplied Git author identity and approved committing and merging locally into `main`, without a push.

> **Supersession note:** the approved [Phase 3 plan](phase-3-implementation-plan.md) replaces the static preview and makes `Preview.resume()` return `boolean`, resolving the deferred resume race with regression coverage. Phase 3 software gates pass (167 unit/DOM/physics, 12 browser tests). The evidence above stays historical.

## Global Constraints

- Fixed step `h = 1/120 s`; at most 8 steps per frame; wall-clock delta clamp 0.1 s.
- Accent `#9B59B6`; no blue/orange/green main-UI accent; learner copy Vietnamese, identifiers English.
- Preview: `MeshBasicMaterial`, no shadows, no external assets; state stays `menu`; no `loading|briefing|playing|success|fail`.
- Drawing buffer: CSS size x dpr, scaled by `min(1, 2560/w, 1440/h)`, each side rounded, >=1.
- Scripts unchanged: `dev` `vite --host 127.0.0.1`, `typecheck` `tsc --noEmit`, `build` `tsc --noEmit && vite build`, `test` `vitest run`, `test:browser` `playwright test`, `preview` `vite preview --host 127.0.0.1`.
- Dependencies installed with `--save-exact`; lockfile kept. Runtime: `three` only. No framework, linter/formatter stack, extra runner, `cannon-es`.
- Vitest default environment Node; jsdom opted in per file (`// @vitest-environment jsdom`). Playwright: Chromium + Firefox projects, owns a bounded Vite server (`webServer`).
- No `window.__*` debug globals; no WebGL context at import, `createApp` or menu render; no continuous readback.
- No storage access; defaults: progress `{version:1,completedStages:[],lastVehicle:'sedan'}`, stage `1`, vehicle `'sedan'`, settings `{version:1,volume:0.5,muted:false,driverFovDeg:60,cameraMode:'driver',overhead:false,trajectory:false,inputSource:'keyboard',resolutionScale:1}`.
- No performance/GPU/browser-support claims. Forward-slash paths in commands.
- Model routing: Standard `claude-sonnet-5.5` for contracts, messages, clock, fit, preview, app/integration, tests and docs; lightweight `claude-haiku-5.5` for configs, `style.css`, HUD DOM, static scene boilerplate. No premium. Native execution; the parent may use bounded specialist tasks per tier, not whole-plan agents.
- Git identity is unset: never set or assume one; commit steps stop after staging if `git config user.name`/`user.email` are empty and report it.

## Review Focus

1. Hidden/zero-size container or `NaN`/`0` dpr gives a zero or `NaN` buffer. Expect skip (hidden) or `RangeError` (invalid). Tests: Task 1 `fit.test.ts`, Task 2 resize test.
2. `webglcontextlost` racing `dispose()` (or `forceContextLoss` re-emitting the event) recurses or reports a fault after close. Expect exactly one or zero faults. Test: Task 2.
3. Window blur/tab hide then return auto-resumes or feeds the hidden interval to the clock. Expect paused until the button; no catch-up steps. Test: Task 2.
4. Re-opening after close or context loss reuses a dead canvas or leaks a second renderer. Expect fresh canvas, one live renderer after ten cycles. Test: Task 3.
5. WebGL2 unsupported shows a futile reload button, or the menu probes a context on startup. Expect "Quay lại menu" only; zero contexts before click. Tests: Task 3 (`ui.test.ts`, `shell.spec.ts`).

---

## File ownership map

| Files | Responsibility |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `.gitignore`, `index.html` | Tooling and entry (Task 1) |
| `src/contracts.ts`, `src/runtime-types.ts`, `src/messages.ts` | Exact approved contracts, adapter/shell types, Vietnamese dictionary (Task 1) |
| `src/clock.ts`, `src/clock.test.ts`, `src/render/fit.ts`, `src/render/fit.test.ts` | Fixed-step accumulator, pure sizing (Task 1) |
| `src/render/preview.ts`, `src/render/preview.test.ts` | Sole owner of renderer, loop, scene, preview listeners (Task 2) |
| `src/ui/screens.ts`, `src/ui/hud.ts`, `src/ui/ui.test.ts`, `src/style.css` | Screens, empty HUD, theme (Task 3; `style.css` tokens start in Task 1) |
| `src/app.ts`, `src/main.ts`, `src/app.test.ts`, `tests/browser/shell.spec.ts` | Shell state, canvas lifecycle, bootstrap, real-browser evidence (Task 3) |

Docs reconciled in Task 3: `docs/implementation-plan.md`, `docs/detail-design.md`, `docs/tech-design.md`, `.github/copilot-instructions.md`.

## Shared signatures (authoritative for all tasks)

```ts
// runtime-types.ts (plus all original Task 1 adapter types, SettingsSaveV1, ScreenContext)
type PreviewPhase = 'closed' | 'running' | 'paused';
interface ShellView { readonly state: AppState; readonly preview: PreviewPhase }
type ScreenAction = /* original members */
  | { type: 'open-preview' } | { type: 'close-preview' }
  | { type: 'select-vehicle'; vehicleId: VehicleId };  // 'start' stays defined, never emitted
// clock.ts
interface Clock { advance(elapsedS: number, step: () => void): { alpha: number; droppedTimeS: number }; reset(): void }
// render/fit.ts
function fitDrawingBuffer(cssW: number, cssH: number, dpr: number): { width: number; height: number } | null;
// render/preview.ts
type PreviewRenderer = Pick<THREE.WebGLRenderer, 'render' | 'setSize' | 'dispose' | 'forceContextLoss'>;
interface PreviewDeps {
  now(): number; requestFrame(cb: (t: number) => void): number; cancelFrame(id: number): void;
  createRenderer(canvas: HTMLCanvasElement): PreviewRenderer;
  createContext(canvas: HTMLCanvasElement): PreviewContext | null; // getContext('webgl2')
}
interface PreviewContext { getExtension(name: 'WEBGL_lose_context'): WEBGL_lose_context | null }
interface PreviewEvents { onPaused(): void; onFault(kind: 'context-lost' | 'runtime-error', error?: unknown): void }
interface Preview { resume(): void; dispose(): void }
class PreviewStartError extends Error { readonly reason: 'webgl-unsupported' | 'renderer-failed' }
function createPreview(canvas: HTMLCanvasElement, container: HTMLElement, events: PreviewEvents, deps?: Partial<PreviewDeps>): Preview;
// app.ts
interface AppDeps { createPreview: typeof createPreview }
function createApp(root: HTMLElement, deps?: Partial<AppDeps>): { dispose(): void };
```

`select-vehicle` implements the approved selector: screens emit actions rather than mutate `ScreenContext`. `resume` is reused for "Tiếp tục xem thử".

---

### Task 1: Toolchain, contracts, clock and sizing

**Files:** Create everything in the map marked Task 1 (`src/main.ts` only imports `./style.css`).

**Interfaces:** Produces `Clock`, `createClock(): Clock`, `fitDrawingBuffer`, `vi`/`MessageKey = keyof typeof vi`, contracts and shell types above. `fitDrawingBuffer` returns `null` when `cssW` or `cssH` is `0` (hidden layout) and throws `RangeError` for non-finite or negative sizes and for non-finite or `<=0` dpr.

- [x] **Step 1: Check Node, then create manifests (no install yet).** Run `node --version`; run `npm view <package> engines --json` separately for `vite`, `vitest`, `jsdom` and `@playwright/test`. Select stable versions compatible with supported Node, reporting a blocker if none are available. Create `package.json` (`private`, `type: module`, six scripts above, `engines` from the check), `tsconfig.json` (strict, DOM, `moduleResolution: bundler`, `noEmit`, include `src`, `tests`, `*.ts`), `vite.config.ts` using `defineConfig` from `vitest/config` with `test: { environment: 'node', include: ['src/**/*.test.ts'] }`, `playwright.config.ts` (projects `chromium`, `firefox`; `testDir: 'tests/browser'`; `webServer` running `npm run dev` on `127.0.0.1` with `reuseExistingServer: false`; a software-WebGL launch option such as `--use-angle=swiftshader` for Chromium only if needed), `.gitignore` (integrate, do not replace: `node_modules`, `dist`, `test-results`, `playwright-report`, `.superpowers`), `index.html` (`canvas`-free `#app`, `<script type="module" src="/src/main.ts">`), `src/main.ts`, `src/style.css` (Amethyst tokens).
- [x] **Step 2: Install, only now.** `npm install --save-exact three` then `npm install --save-exact --save-dev typescript vite @types/three vitest jsdom @playwright/test`. Expect `package-lock.json`; confirm `cannon-es` absent: `npm ls cannon-es` reports empty.
- [x] **Step 3: Write failing tests** `src/clock.test.ts` and `src/render/fit.test.ts`.

```ts
it('caps at eight steps and reports dropped time', () => {
  const step = vi.fn(); const r = createClock().advance(0.1, step);
  expect(step).toHaveBeenCalledTimes(8);
  expect(r.droppedTimeS).toBeCloseTo(0.1 - 8 / 120);
  expect(r.alpha).toBeGreaterThanOrEqual(0); expect(r.alpha).toBeLessThan(1);
});
it.each([-1, NaN, Infinity])('rejects delta %s', (d) => expect(() => createClock().advance(d, () => {})).toThrow(RangeError));
it('clamps 5 s to 0.1 s and reset() discards a half step', /* second advance after reset runs zero steps for h/2 */);
it('caps 2560x1440@2 and preserves extreme aspect', () => {
  expect(fitDrawingBuffer(1280, 720, 2)).toEqual({ width: 2560, height: 1440 });
  const w = fitDrawingBuffer(5000, 300, 1)!; expect(w.width).toBeLessThanOrEqual(2560); expect(w.height).toBeGreaterThanOrEqual(1);
  expect(fitDrawingBuffer(400, 3000, 1)!.width).toBeGreaterThanOrEqual(1);
});
it('Review Focus 1: hidden skips, invalid throws', () => {
  expect(fitDrawingBuffer(0, 720, 1)).toBeNull();
  for (const a of [[NaN, 5, 1], [-1, 5, 1], [5, 5, 0], [5, 5, NaN]] as const) expect(() => fitDrawingBuffer(...a)).toThrow(RangeError);
});
```

Also assert 1280x720@1, 5120x1440@1, aspect within 1 px, exact `1/120` accumulation (120 steps for 120 advances of `1/120`, plus two half-step advances yielding one step). Ten `0.1` s advances deliberately yield only 80 steps because of the per-frame cap; do not treat discarded backlog as clock drift.
- [x] **Step 4: Run red.** `npx vitest run src/clock.test.ts src/render/fit.test.ts`. Expected: FAIL on missing modules, not on tooling.
- [x] **Step 5: Implement** `src/contracts.ts` (design Section 11 verbatim, `MessageKey = keyof typeof vi`), `src/runtime-types.ts` (original adapter types exactly, type-only `three` import; `ScreenContext`, `SettingsSaveV1`, shell types above), `src/messages.ts` (`vi` keys listed in design Section 6), `src/clock.ts` (accumulator; throws `RangeError`), `src/render/fit.ts` (pure; round then `Math.max(1, ...)`).
- [x] **Step 6: Run green.** `npx vitest run src/clock.test.ts src/render/fit.test.ts`, `npm run typecheck`, `npm run build`. Expected: all tests pass, no type errors, `dist/` produced.
- [x] **Step 7: Commit.** Check `git config user.name` and `git config user.email`; if either is empty stop and report the blocked identity (do not set one). Otherwise `git add package.json package-lock.json tsconfig.json vite.config.ts playwright.config.ts .gitignore index.html src/main.ts src/style.css src/contracts.ts src/runtime-types.ts src/messages.ts src/clock.ts src/clock.test.ts src/render/fit.ts src/render/fit.test.ts` and `git commit -m "feat: add Phase 2 toolchain, contracts, clock and sizing"` with the Copilot co-author trailer.

### Task 2: Preview renderer lifecycle

**Files:** Create `src/render/preview.ts`, `src/render/preview.test.ts`.

**Interfaces:** Consumes `Clock`, `fitDrawingBuffer`, `PreviewPhase`. Produces `createPreview`, `Preview`, `PreviewEvents`, `PreviewDeps`, `PreviewStartError` (signatures above). `createPreview` is the only owner of: the animation frame, `resize`, `visibilitychange`, `blur`, `webglcontextlost`/`webglcontextrestored` listeners and the `ResizeObserver`. It starts `running`; it pauses itself (cancel frame, `clock.reset()`, `events.onPaused()`) on hide/blur; `resume()` resets the clock, takes a fresh `now()` and restarts the loop; it never auto-resumes.

- [x] **Step 1: Write failing jsdom tests** (`// @vitest-environment jsdom`) with fake `PreviewDeps` counting `addEventListener`/`removeEventListener`, frames and renderers.

```ts
it('throws PreviewStartError webgl-unsupported when createContext returns null', () => {
  expect(() => createPreview(canvas, box, ev, { ...fakes, createContext: () => null })).toThrow(PreviewStartError);
});
it('dispose is idempotent and removes every listener', () => {
  const p = createPreview(canvas, box, ev, fakes); p.dispose(); p.dispose();
  expect(fakes.listenerCount()).toBe(0); expect(fakes.renderer.dispose).toHaveBeenCalledTimes(1); expect(fakes.cancelled).toBe(1);
});
it('Review Focus 2: context lost races dispose without recursion', () => {
  const p = createPreview(canvas, box, ev, fakes); fakes.fireLost(); p.dispose();
  expect(ev.onFault).toHaveBeenCalledTimes(1); expect(fakes.renderer.forceContextLoss).not.toHaveBeenCalled();
  fakes.fireLost(); expect(ev.onFault).toHaveBeenCalledTimes(1);          // after dispose: ignored
});
it('Review Focus 3: blur pauses, return does not resume, resume adds no catch-up', () => {
  fakes.blur(); expect(ev.onPaused).toHaveBeenCalledTimes(1); fakes.advanceTime(60_000); fakes.focus();
  expect(fakes.pendingFrames()).toBe(0); p.resume(); fakes.runFrame(); expect(fakes.stepsRun()).toBeLessThanOrEqual(1);
});
it('Review Focus 1: hidden zero-size container skips resize', () => {
  fakes.setBox(0, 0); fakes.fireResize(); expect(fakes.renderer.setSize).not.toHaveBeenCalled();
});
it('frame exception stops loop and reports runtime-error once', /* fakes.render throws */);
```

Also: `setSize` called with `fitDrawingBuffer` output and `updateStyle` `false`; invalid resize inputs stop the loop and emit one `runtime-error` instead of an uncaught listener exception; ten create/dispose cycles leave zero listeners and zero live renderers; scene geometries/materials disposed (spy on dispose).
- [x] **Step 2: Run red.** `npx vitest run src/render/preview.test.ts`. Expected: FAIL, module `preview.ts` missing.
- [x] **Step 3: Implement `createPreview`.** Feature-detect with `deps.createContext(canvas)` on the passed canvas, then construct the renderer on that same canvas (default `createRenderer` is `new THREE.WebGLRenderer({ canvas })`); wrap failures in `PreviewStartError`. Keep scene construction in a separate local `buildScene()` (plane, box, axis markers, `MeshBasicMaterial`, fixed camera) from lifecycle functions. Set a `disposed`/`faulted` flag before removing listeners; on `webglcontextlost` call `preventDefault`, stop the loop, emit `onFault('context-lost')` once, and never call `forceContextLoss` for an already lost context. Default deps use `performance.now`, `requestAnimationFrame`, `canvas.getContext('webgl2')`.
- [x] **Step 4: Run green.** `npx vitest run src/render/preview.test.ts`, `npm run typecheck`, `npm run build`. Expected: pass, no errors.
- [x] **Step 5: Commit** (same identity check as Task 1): `git add src/render/preview.ts src/render/preview.test.ts`, message `feat: add preview renderer lifecycle`, with trailer.

### Task 3: DOM shell, app integration, reconciled docs and evidence

**Files:** Create `src/ui/screens.ts`, `src/ui/hud.ts`, `src/ui/ui.test.ts`, `src/app.ts`, `src/app.test.ts`, `tests/browser/shell.spec.ts`; modify `src/main.ts`, `src/style.css`, and the four docs listed under the file map.

**Interfaces:** Consumes everything above. Produces `createApp` (signature above), `mountScreen(root: HTMLElement, state: AppState, context: ScreenContext, onAction: (a: ScreenAction) => void, view?: ShellView): () => void` (the optional `view` selects running/paused preview controls instead of menu; the original four parameters are unchanged), `mountHud(root: HTMLElement): () => void`. `app.ts` owns `ShellView`, the `canvas#simulation` it creates per open and removes on close/fault, and the single `Preview`; the preview owns its clock. Preview events set the shell; screens only emit actions. Messages: menu primary "Xem thử mô hình (không lái được)", exit "Quay lại menu", badge "Bản xem thử — không lái được", resume "Tiếp tục xem thử", "Thử lại", "Tải lại trang".

- [x] **Step 1: Write failing jsdom tests** `ui.test.ts` and `app.test.ts` (fake `createPreview`, `getContext` spy).

```ts
it('menu is Vietnamese, labeled selector, native buttons, no "Bắt đầu"', () => {
  expect(root.textContent).not.toContain('Bắt đầu');
  expect(root.querySelector('label[for="vehicle"]')).not.toBeNull(); expect(root.querySelector('select#vehicle')).not.toBeNull();
  expect([...root.querySelectorAll('button')].some(b => b.textContent === 'Xem thử mô hình (không lái được)')).toBe(true);
});
it('HUD containers exist, empty and hidden, no telemetry text', () => {
  for (const id of ['lesson-strip','proximity-front','proximity-rear','telemetry','view-controls','overhead-frame']) {
    const el = root.querySelector('#' + id)!; expect(el.hasAttribute('hidden')).toBe(true); expect(el.textContent).toBe('');
  }
  expect(root.querySelector('#status-message')!.getAttribute('aria-live')).toBe('polite');
});
it('Review Focus 5: createApp creates no context; unsupported WebGL offers only the menu button', /* getContext spy 0 calls; fake throws webgl-unsupported; buttons === ['Quay lại menu'] */);
it('Review Focus 4: ten open/close cycles leave one canvas at most, zero live previews, state stays menu', /* assert state.kind==='menu' while running/paused */);
it('context lost shows reload + menu; menu then reopen uses a fresh canvas element', /* new canvas !== old */);
```

- [x] **Step 2: Run red.** `npx vitest run src/ui/ui.test.ts src/app.test.ts`. Expected: FAIL on missing modules.
- [x] **Step 3: Implement** `mountScreen` (menu, error with `retryable`, preview notice/paused notice; native `<select>`/`<button>`, visible-focus class, focus moved to resume button on pause), `mountHud` (Section 5.4 hierarchy in CSS Grid, `pointer-events: none`), `createApp` (initial defaults from Global Constraints; open-preview creates `canvas#simulation`, calls `createPreview` in `try`; `PreviewStartError` maps to error states per design Section 7; close/fault disposes the preview first, removes the canvas, then remounts; `dispose()` disposes preview, then screens, then own listeners). `main.ts` calls `createApp(document.getElementById('app')!)`.
- [x] **Step 4: Run green.** `npx vitest run`, `npm run typecheck`, `npm run build`. Expected: all unit tests pass.
- [x] **Step 5: Write `tests/browser/shell.spec.ts`.** Menu appears, console errors and uncaught page errors fail the test; click preview and assert badge plus a non-blank canvas screenshot. Decode `locator('canvas#simulation').screenshot()` into an image in a test-only 2D canvas and assert distinct decoded RGB colors across the scene, not distinct compressed PNG bytes (which do not prove rendering). No extra image dependency or production readback. The WebGL-disabled path shows the Vietnamese unsupported message (Chromium `--disable-3d-apis` / Firefox `webgl.disabled` pref via per-test launch option, or `addInitScript` stub of `getContext`); resize 1280x720 -> 5000x300 and 400x3000 asserts no horizontal overflow and buffer width <=2560, height <=1440; return to menu then re-open works.
- [x] **Step 6: Run browsers.** `npx playwright test tests/browser/shell.spec.ts`. If it reports missing executables only, run `npx playwright install chromium firefox`, then re-run once. If WebGL cannot render after reasonable configuration, record that gate as **blocked**, not passed or skipped.
- [x] **Step 7: Reconcile docs (apply surgical edits, no rewrites).** `docs/implementation-plan.md`: header links to both phase docs; status line states pending implementation (not "documentation-only"); Phase 2 scope authorizes Task 1 only; conventions: `cannon-es` installed in Task 2 setup with `--save-exact`; Task 1 menu test uses preview label, `ScreenAction` additions, `PreviewPhase`/`ShellView`, `src/render/preview.ts` and fit/preview tests in Files and file map, Step 4 preview wording. `docs/detail-design.md` Sections 10, 12, 13, 15: design Section 9 clarifications only. `docs/tech-design.md` Phase 2: one sentence. `.github/copilot-instructions.md`: "Phase 2 Design & Scaffolding" (technical design) = instruction Phase 1; rules unchanged. Verify with `git diff --check` and `git diff --stat`.
- [x] **Step 8: Final evidence.** Report actually run commands and results (unit, typecheck, build, Chromium, Firefox); mark any unrun or blocked gate as such; no performance claims.
- [x] **Step 9: Commit** (identity check as before): stage only listed files, message `feat: add Vietnamese shell, HUD containers and non-drivable preview`, with trailer. If identity is unset, leave staged and report.
