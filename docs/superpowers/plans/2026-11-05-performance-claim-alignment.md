# Finding 5 Performance Claim Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align top-level performance guidance with the approved 1440p/60 Hz criteria and close Finding 5 only for wording accuracy.

**Architecture:** Documentation-only change. The existing technical/detail-design benchmark contract remains authoritative; update stale guidance and record the limited finding closure without touching runtime code or claiming hardware validation.

**Tech Stack:** Markdown documentation; Git.

**Spec:** [Finding 5 Performance Claim Alignment](../specs/2026-11-05-performance-claim-alignment-design.md)

## Global Constraints

- The measured target criteria are 2560x1440 at 60 Hz: p95 frame interval <=17.5 ms, mean >=57 FPS and zero loss.
- 144 Hz remains optional and unverified.
- Reference/minimum-PC measurements remain pending; do not imply tested performance or general support.
- Finding 2 remains open until actual hardware evidence exists.
- No runtime source, optimization, or benchmark change.
- Use the repository's lightweight tier for mechanical documentation edits.

## Review Focus

1. A stale target statement remains in project guidance: verify both `.github/copilot-instructions.md` and `docs/implementation-plan.md` describe 60 Hz and optional 144 Hz.
2. Finding 5 is marked Done too broadly: verify the closure text limits scope to documentation accuracy and preserves pending hardware evidence.
3. Finding 2 is accidentally closed or weakened: verify its status remains open.
4. The performance criteria drift from the approved contract: compare exact values against `docs/detail-design.md`.
5. Runtime files are changed despite the documentation-only scope: verify the diff contains no source or test changes.

---

### Task 1: Align performance claims and close Finding 5

**Files:**
- Modify: `.github/copilot-instructions.md` rendering performance target.
- Modify: `docs/implementation-plan.md` global performance constraint.
- Modify: `PRODUCTION-READINESS-REVIEW.md` current status and Finding 5 section.
- Verify against: `docs/tech-design.md` and `docs/detail-design.md`.

**Interfaces:**
- Consumes: Approved benchmark criteria in `docs/detail-design.md`.
- Produces: Consistent project guidance and a Finding 5 closure explicitly limited to wording accuracy.

- [ ] **Step 1: Correct stale guidance** so both top-level statements use the approved 1440p/60 Hz criteria, with 144 Hz described only as an optional unverified aspiration.
- [ ] **Step 2: Update the readiness review** to mark Finding 5 Done for documentation wording only, explain that the technical design is already qualified and the stale guidance is now aligned, and retain the absence of reference/minimum-PC results. Keep Finding 2 open.
- [ ] **Step 3: Search for the two obsolete statements** using `rg -n "1440p @ 144Hz target|1440p/144Hz remains a measured reference-PC target" .github/copilot-instructions.md docs/implementation-plan.md`. Expected: no matches.
- [ ] **Step 4: Review the patch** with `git diff --check` and `git diff -- .github/copilot-instructions.md docs/implementation-plan.md PRODUCTION-READINESS-REVIEW.md`. Expected: the product-document diff is limited to those three files; the approved spec and plan are also included as new docs, with no runtime source or test changes.
- [ ] **Step 5: Commit the signed-off documentation change** with the required Copilot co-author trailer; after owner sign-off, merge to `main` and push as requested.
