# Logo and Favicon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a top-down parking-alignment mark to the Park-Core menu and use the same SVG as the browser favicon.

**Architecture:** Keep the existing textual menu heading as the accessible wordmark. Add one decorative public SVG next to it, style the compact lockup with the existing CSS, and reference that SVG from the page head.

**Tech Stack:** TypeScript, Vite, HTML, CSS, SVG, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-logo-favicon-design.md`

## Global Constraints

- Add one SVG asset and reference it from the menu and `index.html`.
- Keep the menu heading’s text accessible and preserve the existing page title.
- Use the current high-contrast dark and amethyst palette.
- Do not change lessons, the driving HUD, or other application behavior.
- Keep the implementation native to the existing Vite app; add no packages.

## Review Focus

- The logo is visible after the learner reaches the menu, while the existing heading remains its accessible name; cover in the menu unit test and production browser test.
- The favicon and menu image resolve to the same SVG in the built app; cover the favicon URL and successful SVG response in the production browser test.
- The top-down car, space, and guidance cue remain recognizable at favicon scale; inspect the emitted SVG and browser tab during visual verification.

---

### Task 1: Add the shared menu mark and favicon

**Files:**
- Create: `public/park-core-mark.svg`
- Modify: `index.html`
- Modify: `src/ui/screens.ts`
- Modify: `src/style.css`
- Test: `src/ui/ui.test.ts`
- Test: `tests/production/pages.spec.ts`

**Interfaces:**
- Consumes: `mountScreen`'s existing menu branch and `screen` element; Vite's existing public-file serving.
- Produces: a decorative `img.brand-mark` with `src="/park-core-mark.svg"` beside the existing Park-Core `h1`; `link[rel="icon"]` with the same href.

- [ ] **Step 1: Add failing unit and production tests**

  In `src/ui/ui.test.ts`, add `renders a decorative parking mark beside the accessible menu heading`. Mount the menu and assert:
  - the `h1` still has text `Park-Core`;
  - `.brand-mark` is present with `src="/park-core-mark.svg"`, empty `alt`, and `aria-hidden="true"`.

  In `tests/production/pages.spec.ts`, add `built app serves the shared menu logo and favicon`. After `enterLessonMenu(page)`, assert the logo is visible and points to `/park-core-mark.svg`, the favicon link has the same href, and `request.get('/park-core-mark.svg')` returns status 200 with an SVG content type.

- [ ] **Step 2: Run the focused tests and verify they fail for the missing mark**

  Run: `npm test -- src/ui/ui.test.ts`

  Run: `npm run build` to create the `dist` directory required by the production preview server.

  Run: `npm run test:production -- tests/production/pages.spec.ts`

  Expected: the new UI assertion finds no `.brand-mark`, and the production assertion finds no favicon link.

- [ ] **Step 3: Implement the shared mark**

  Create `public/park-core-mark.svg` as a small, single-color-compatible top-down car aligning with a marked parking space and one amethyst guidance cue. In the menu branch of `src/ui/screens.ts`, wrap the existing `h1` and decorative image in `.brand-lockup`; retain the heading text. Add compact, responsive `.brand-lockup` and `.brand-mark` rules to `src/style.css`. Add `<link rel="icon" type="image/svg+xml" href="/park-core-mark.svg" />` to `index.html` without changing the page title.

- [ ] **Step 4: Run focused tests and build**

  Run: `npm test -- src/ui/ui.test.ts`

  Run: `npm run test:production -- tests/production/pages.spec.ts`

  Run: `npm run build`

  Expected: all three commands pass; the production test confirms the menu and favicon resolve to the same SVG.

- [ ] **Step 5: Visually verify favicon-scale legibility**

  Inspect the built app's menu and browser tab. Confirm the top-down car and parking-space cue remain distinguishable at favicon scale, and that the lockup remains legible at the narrowest supported layout.
