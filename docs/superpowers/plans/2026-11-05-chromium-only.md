# Chromium-only Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Use Chromium only for automated learner and production checks.
**Architecture:** Remove Firefox projects and CI installation/probing. Retain
runtime and manual benchmark behavior; document reduced coverage.
**Tech Stack:** Playwright, TypeScript, GitHub Actions.
**Spec:** `docs\superpowers\specs\2026-11-05-chromium-only-design.md`

## Global Constraints

No dependencies, runtime changes or full-duration benchmark runs.
Validated-main-only deployment remains mandatory; sign-off precedes merge/push.

## Review Focus

Both configurations must select Chromium only. CI must not install/probe
Firefox. Existing Chromium tests must remain selected. Manual benchmark
semantics must stay unchanged. Current docs must not claim Firefox coverage.
Check these through Playwright listing, scoped diff and existing tests.

### Task 1: Chromium-only automation and current documentation

**Files:** `playwright.config.ts`, `playwright.production.config.ts`,
`.github\workflows\pages.yml`, `tests\production\benchmark.spec.ts`,
`README.md`, `docs\tech-design.md`, `docs\detail-design.md`,
`PRODUCTION-READINESS-REVIEW.md`.

**Interfaces:** Existing Playwright projects and workflow commands; no new APIs.

- [x] Remove Firefox projects, installation and WebGL probe; remove obsolete
  benchmark skip. Retain browserName because metadata setup still uses it.
  Preserve other test bodies.
- [x] Update current coverage descriptions; preserve historical results.
- [x] Verify both `--list` outputs contain Chromium only, with 14 learner and
  four production cases. Run build, browser and production suites; expect
  14 and four passing tests with no Firefox skips. Run `git diff --check`.
  Actual: baseline 417 unit tests; build/typecheck passed; 14 acceptance tests
  and four production tests passed without skips. Existing bundle warning
  retained. Runtime source unchanged; no full-duration benchmark performed.
- [x] Review scoped diff and commit with required co-author trailer.
  Independent Standard-tier review approved; historical dual-browser evidence
  intentionally retained. Implementation committed `79af1b1`.
- [x] Obtain sign-off, merge into main, run unit suite, push and observe CI.
  Owner approved; merge `6f163a3` pushed after 417 merged-tree unit tests passed.
  Pages run 41960377679 passed 417 unit, 14 acceptance and four production
  tests, typecheck/build; deployed successfully. Live app/benchmark HTTPS 200.
