# Repository README, License, and Ignore Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a useful project README with an authentic app screenshot, establish MIT terms for project-owned content, and keep local/generated files out of version control.

**Architecture:** Documentation-only repository updates plus one screenshot captured from the running Vite app with Playwright's screenshot CLI. No application behavior or dependency manifests change.

**Tech Stack:** Markdown, MIT license text, `.gitignore`, Vite, Playwright CLI.

**Spec:** `docs/superpowers/specs/2026-11-04-repository-readme-license-gitignore-design.md`

## Global Constraints

- Add an English, contributor-facing `README.md` with a real screenshot of the app, technology/license badges, project summary, features, controls, setup, test/build commands, and links to the phase documentation.
- Add an MIT `LICENSE` for project-owned repository content, including original prototype assets and documentation. Third-party dependencies retain their own licenses.
- Preserve existing `.gitignore` exclusions for dependencies, generated builds, browser reports, Superpowers artifacts, and worktrees.
- Capture a screenshot from the real running web app and store it at `docs/images/park-core-main.png`.
- Clearly state that the simulator and assets are prototypes and that software acceptance does not establish instructor approval, supported hardware, learner competence, or training readiness.
- Do not modify the application or dependency manifests.

## Review Focus

- README's relative screenshot and documentation links must resolve to tracked repository files; validate all local links after writing.
- The screenshot must show the real app at a readable desktop viewport, not a mockup or a blank/loading state; inspect the captured image.
- Badges must not imply a CI workflow or other unsupported project status; check the rendered badge targets and claims.
- MIT terms must be clearly limited to project-owned content, with third-party dependency licenses left intact; verify the README note and standard license text.
- Ignore additions must not hide `.env.example` or the committed screenshot; verify both ignore and exception patterns explicitly.

---

### Task 1: Add repository introduction, license, ignore rules, and screenshot

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Modify: `.gitignore`
- Create: `docs/images/park-core-main.png`

**Interfaces:**
- Consumes: Existing project scripts and dependency versions from `package.json`; learner control descriptions from `src/messages.ts`; prototype boundaries from `docs/detail-design.md` and `docs/asset-pipeline.md`.
- Produces: GitHub-renderable repository instructions and image, MIT project license, and ignore rules retaining the current entries.

- [ ] **Step 1: Extend `.gitignore` narrowly**

Keep the existing entries `node_modules`, `dist`, `test-results`, `playwright-report`, `.superpowers`, and `.worktrees`. Add ignores for `.env*`, `.vite`, `coverage`, and `*.log`, with `!.env.example` after the environment-file pattern. Confirm the env example and screenshot are not ignored while `.env.local`, `.vite\cache`, and `coverage\lcov.info` are ignored:

```powershell
git check-ignore -v .env.local .vite\cache coverage\lcov.info
git check-ignore .env.example docs\images\park-core-main.png
```

Expected: first command lists all three paths; second command prints no matches and exits with code 1.

- [ ] **Step 2: Add the standard MIT license**

Create `LICENSE` with the complete standard MIT text and `Copyright (c) 2026 Park-Core contributors`. Do not add terms purporting to license third-party dependencies.

- [ ] **Step 3: Capture the real app screenshot**

Start the app in one terminal with `npm run dev -- --port 4173`. In another terminal run:

```powershell
npx playwright screenshot --browser=chromium --viewport-size="1440,900" --wait-for-timeout=2000 http://127.0.0.1:4173/ docs/images/park-core-main.png
```

Expected: `docs/images/park-core-main.png` is created from the running app at 1440x900. Inspect it to confirm the page is loaded and legible; recapture if it shows a blank or loading state.

- [ ] **Step 4: Write the contributor-facing README**

Use the screenshot near the top via `docs/images/park-core-main.png`. Include a concise summary, current prototype/features, technology and MIT badges (no CI badge), prerequisites from `package.json`, install/run/test/build commands, Vietnamese controls, links to relevant phase and asset documentation, and the explicit prototype/training-readiness limitations from the spec. Clarify that MIT covers project-owned content and third-party dependencies have their own licenses.

- [ ] **Step 5: Verify the documentation deliverables**

Run `git diff --check`. Confirm all local Markdown links in `README.md` point to existing files, the screenshot exists and is legible, and the license contains the full MIT terms. Repeat the Step 1 ignore checks; the screenshot must remain trackable and `.env.example` must remain unignored. No application test suite is required for these documentation-only changes.

- [ ] **Step 6: Commit the complete deliverable**

```powershell
git add README.md LICENSE .gitignore docs\images\park-core-main.png docs\superpowers\specs\2026-11-04-repository-readme-license-gitignore-design.md docs\superpowers\plans\2026-11-04-repository-readme-license-gitignore.md
git commit -m "docs: add project README and MIT license" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
