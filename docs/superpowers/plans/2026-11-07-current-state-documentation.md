# Current-State Documentation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the README and master technical design so they describe Park-Core's current product and architecture without presenting implementation history as current status.

**Architecture:** Keep `README.md` as the concise user/contributor overview and `docs/tech-design.md` as the current technical architecture and constraint reference. Reconcile both against the approved detailed design, current Phase 6-8 designs/catalog, package metadata, and existing deployment workflow; do not rewrite or remove historical phase records.

**Tech Stack:** Markdown documentation; TypeScript, Vite, Three.js, Cannon-es, vanilla HTML/CSS, Vitest, and Playwright as documented project technologies.

**Spec:** Documentation request in the current task. Source references: `docs/detail-design.md`, `docs/phase-6-detail-design.md`, `docs/phase-7-ui-ux-improve.md`, `docs/phase-8-asset-catalog.md`, `docs/asset-pipeline.md`, `package.json`, and the repository's Pages workflow.

## Global Constraints

- Learner-facing instructions and controls are in Vietnamese; technical documentation and code identifiers are in English.
- Node.js requirement: `^22.22.2 || ^24.15.0 || >=26.0.0`.
- The approved 1440p/60 Hz target is p95 frame time <=17.5 ms, mean >=57 FPS, and zero loss; it is not a verified performance guarantee.
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
- Test: No automated documentation test exists; use the review checks in Step 3.

**Interfaces:**
- README owns the current product summary, user-facing controls, developer setup, deployment instructions, prototype limitations, and concise links to maintained reference documents.
- `docs/tech-design.md` owns the current architecture, technical constraints, implemented system boundaries, and evidence/validation limits.
- Both documents use English for technical content; learner-facing copy is described as Vietnamese.

- [ ] **Step 1: Refactor `README.md` to show the current product only.** Keep the current feature overview, representative current screenshots and captions, stack, exact Node prerequisite, setup and verification commands, controls, deployment guidance, prototype limitations, and licensing distinction. Remove phase-by-phase status/history and links that primarily expose implementation or production-readiness logs; retain only maintained design, asset, and technical reference links. Do not remove historical documents from the repository.

- [ ] **Step 2: Refactor `docs/tech-design.md` into the current master architecture.** Replace obsolete phase-by-phase implementation status, dated merge/push notes, and AI model-tier routing with current-state sections for scope and stack, vehicle/physics, views and support systems, controls, environments/lessons/progression, local persistence, UI, assets/licensing, deployment, and validation boundaries. Preserve current measured facts and exact constraints, including 15 FPS mirror updates, 30 Hz overhead updates, 20 Hz sensor/DOM updates, approved benchmark limits, and explicit unverified claims. Align feature descriptions with `docs/detail-design.md` and Phases 6-8; do not claim instructor approval, hardware support, benchmark success, or training readiness.

- [ ] **Step 3: Verify documentation consistency and accuracy.** Review both documents against the source references in the Spec field. Confirm README has no implementation-history or production-readiness-history link; confirm the master design no longer reads as a phase log or prescribes obsolete model tiers; verify the five Review Focus conditions, all retained relative links/image paths, Node requirement, performance boundaries, current features, and license scopes. Run `git diff --check`; expected result: no whitespace errors. No application tests are required for this documentation-only change.

- [ ] **Step 4: Commit the documentation refresh.**

```powershell
git add docs/superpowers/plans/2026-11-07-current-state-documentation.md README.md docs/tech-design.md
git commit -m "docs: refresh current-state project documentation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
