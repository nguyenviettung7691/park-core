# Current-State Documentation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the README and master technical design so they describe Park-Core's current product and architecture without presenting implementation history as current status.

**Architecture:** Keep `README.md` as the concise user/contributor overview and `docs/tech-design.md` as the current technical architecture and constraint reference. Reconcile both against the approved detailed design, current Phase 6-8 designs/catalog, package metadata, and existing deployment workflow; do not rewrite or remove historical phase records.

**Tech Stack:** Markdown documentation; TypeScript, Vite, Three.js, Cannon-es, vanilla HTML/CSS, Vitest, and Playwright as documented project technologies.

**Spec:** Documentation request in the current task. Source references: `docs/detail-design.md`, `docs/phase-6-detail-design.md`, `docs/phase-7-ui-ux-improve.md`, `docs/phase-8-asset-catalog.md`, `docs/asset-pipeline.md`, `package.json`, and the repository's Pages workflow.

## Global Constraints

- Learner-facing instructions and controls are in Vietnamese; technical documentation and code identifiers are in English.
- Node.js requirement: `^22.22.2 || ^24.15.0 || >=26.0.0`.
- The approved 1440p/60 Hz target is p95 frame interval <=17.5 ms, mean >=57 FPS, and zero lost simulation time from catch-up or clamping; it is not a verified performance guarantee.
- The project uses TypeScript, Vite, Three.js, Cannon-es, and vanilla HTML/CSS; do not describe an unimplemented framework or rendering system as current.
- Prototype software checks do not establish training readiness, learner competence, supported-hardware compatibility, or reference-PC performance.
- New Phase 8 artwork, creative source definitions, and artwork-focused images use CC BY-NC 4.0; application code, functional tooling, and technical documentation remain MIT, and earlier MIT grants remain valid.

## Review Focus

- A feature or phase status is stale or presented as a dated milestone rather than current product behavior; verify both docs describe the same current feature set.
- A benchmark, live-site, browser, or hardware claim exceeds recorded evidence; label targets, observed software checks, and unverified status distinctly.
- A technical constraint or runtime detail is lost while removing the phase breakdown; compare the master document with the detailed design and current asset catalog.
- README links or image paths break during the documentation cleanup; inspect every retained relative link and image reference.
- Artwork licensing is summarized incorrectly or conflated with MIT code licensing; verify the README wording against the repository and asset license notices.

---

### Task 1: Refresh Current-State Project Documentation

**Files:**
- Create: `docs/superpowers/plans/2026-11-07-current-state-documentation.md`
- Modify: `README.md`
- Modify: `docs/tech-design.md`
- Modify: `.github/copilot-instructions.md`
- Modify: `docs/detail-design.md`
- Modify: `docs/phase-6-detail-design.md`
- Test: No automated documentation test exists; use the review checks in Step 3.

**Interfaces:**
- README owns the current product summary, user-facing controls, developer setup, deployment instructions, prototype limitations, and concise links to maintained reference documents.
- `docs/tech-design.md` owns the current architecture, technical constraints, implemented system boundaries, and evidence/validation limits.
- Both documents use English for technical content; learner-facing copy is described as Vietnamese.

- [x] **Step 1: Refactor `README.md` to show the current product only.** Keep the current feature overview, representative current screenshots and captions, stack, exact Node prerequisite, setup and verification commands, controls, deployment guidance, prototype limitations, and licensing distinction. Include graphics presets and settings for render scale, frame-rate cap, anti-aliasing and mirror/overhead quality, plus the in-settings `Đo hiệu năng` panel and standalone `/benchmark.html` page. Remove phase-by-phase status/history and links that primarily expose implementation or production-readiness logs; retain only maintained design, asset, and technical reference links. Do not remove historical documents from the repository.

- [x] **Step 2: Refactor `docs/tech-design.md` into the current master architecture.** Replace obsolete phase-by-phase implementation status, dated merge/push notes, and AI model-tier routing with current-state sections for scope and stack, vehicle/physics, views and support systems, controls, environments/lessons/progression, local persistence, UI, graphics settings and benchmark, assets/licensing, deployment, and validation boundaries. Preserve current measured facts and exact constraints, including 15 FPS mirror updates, 30 Hz overhead-target updates, 20 Hz sensor/DOM updates, fixed-step simulation independent of the render cap, approved benchmark limits (including zero combined catch-up/clamp loss), and explicit unverified claims. Align feature descriptions with current code and maintained design/asset documents; do not claim instructor approval, hardware support, benchmark success, or training readiness.

- [x] **Step 3: Update direct references to removed phase/tier sections.** In `.github/copilot-instructions.md`, remove the mapping to the deleted technical-design phase list; in `docs/detail-design.md`, describe the master design as a current architecture reference rather than a numbered implementation phase; in `docs/phase-6-detail-design.md`, remove the obsolete tier-routing reference. Keep each historical design document in place.

- [x] **Step 4: Verify documentation consistency and accuracy.** Review all changed documents against the source references in the Spec field and current code. Confirm README has no implementation-history or production-readiness-history link; confirm the master design no longer reads as a phase log or prescribes obsolete model tiers; verify the five Review Focus conditions, current graphics settings and benchmark, performance-loss definition, fixed-step/render-cap behavior, persistence stores, all retained relative links/image paths, Node requirement, current features, and license scopes. Run `git diff --check`; expected result: no whitespace errors. No application tests are required for this documentation-only change.

- [x] **Step 5: Commit the documentation refresh.**

```powershell
git add .github/copilot-instructions.md docs/detail-design.md docs/phase-6-detail-design.md docs/superpowers/plans/2026-11-07-current-state-documentation.md README.md docs/tech-design.md
git commit -m "docs: correct current-state design details" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
