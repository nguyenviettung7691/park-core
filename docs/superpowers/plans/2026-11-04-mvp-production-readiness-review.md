# Public MVP Production-Readiness Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an independent, evidence-based release verdict and prioritized gap register for hosting Park-Core as a low-traffic public MVP on GitHub Pages with a custom subdomain.

**Architecture:** A read-only audit of current source, documentation, and Pages/Actions configuration is paired with fresh local test/build/browser results and an independent reviewer’s findings. The only repository output is a root-level `PRODUCTION-READINESS-REVIEW.md`; no application, workflow, DNS, or deployment changes are made.

**Tech Stack:** TypeScript/Vite application, npm scripts, Playwright, GitHub Pages/Actions repository configuration, Markdown.

**Spec:** `docs/superpowers/specs/2026-11-04-mvp-production-readiness-review-design.md`

## Global Constraints

- The target is low traffic (about ten concurrent users maximum) and comfortable operation on most upper-mid-range PCs.
- The project is not being approved as a validated driver-training product.
- Do not modify application behavior, add CI/deployment configuration, alter DNS, deploy, publish, or push.
- Do not claim “upper-mid PC” performance without a named reference machine and measurable acceptance target.
- Do not describe checks on an unsupported Node version as supported-Node validation.
- Use the overall verdicts **NO-GO**, **CONDITIONAL GO**, or **GO** as defined by the spec; do not predetermine the verdict.
- Keep evidence requiring actual Pages deployment, custom DNS, reference hardware, physical controllers, instructors, or learners explicitly separate from repository-verifiable findings.

## Review Focus

- Missing Actions/Pages configuration or an incompatible Vite asset base can prevent the public site from loading at the intended custom-domain root; inspect repository configuration and built output, and report a deployment blocker if the path is absent or invalid.
- Local success cannot prove DNS/TLS or production reachability; report the absence of an observable custom-domain HTTPS deployment as external evidence still required.
- “Upper-mid PC” has no named hardware or measurable frame/load target; do not benchmark by proxy or turn this into a guessed pass.
- Prior phase reports used Node v24.13.1, below the package's declared supported range `^22.22.2 || ^24.15.0 || >=26.0.0`; record the actual current runtime and label support validation accurately.
- Software checks do not prove physical gamepad support, instructor approval, or learner outcomes; assess whether claims and UI disclosures stay within the MVP's stated boundary.

---

### Task 1: Audit MVP readiness and publish the findings report

**Files:**
- Create: `PRODUCTION-READINESS-REVIEW.md`
- Reference: `docs/superpowers/specs/2026-11-04-mvp-production-readiness-review-design.md`
- Reference: `docs/tech-design.md`, `docs/detail-design.md`, `docs/phase-5-implementation-plan.md`, `docs/phase-6-implementation-plan.md`, `docs/asset-pipeline.md`, application source and repository deployment configuration.

**Interfaces:**
- Consumes: Current checkout commit, source/design/phase documents, repository Actions/Pages files, and fresh command output.
- Produces: Root-level release-gate record with overall verdict; target/scope; reviewed commit and runtime; evidence; prioritized findings with file/line or external-evidence references; and closure/acceptance criteria for later tasks.

- [x] **Step 1: Capture the audit baseline**

Record `git rev-parse HEAD`, `git status --short --branch`, `node --version`, `npx playwright --version`, `npx playwright install --list`, and whether `.github/workflows` plus Pages/domain configuration exist. Do not inspect or print secret values.

Expected: the report can identify the exact revision and distinguish repository configuration from private GitHub settings and external DNS.

- [x] **Step 2: Run fresh software checks**

Run each command from the repository root and retain its exact outcome:

```powershell
npm test
npm run typecheck
npm run build
npm run test:browser -- --reporter=line
```

Expected: record pass/fail and test counts for every command. Any failure is evidence for a finding, not grounds to omit the check. Compare `node --version` with `package.json`; if unsupported, explicitly label every result as unsupported-runtime evidence rather than supported-Node validation. Do not install dependencies or browsers unless a missing-tool failure occurs; install Playwright browsers only after a missing-executable failure.

- [x] **Step 3: Obtain an independent, read-only repository review**

Dispatch one fresh reviewer with the design's target and constraints. Have it examine the implementation, tests, static output/deployment configuration, persistence/privacy boundary, and claims against the actual source. Require severity, confidence, exact file/line evidence, and external evidence gaps. Prohibit edits, deployment, DNS changes, secret inspection, and subagent dispatch.

Expected: receive a distinct set of findings and explicitly stated limitations; do not treat the reviewer report itself as proof until each material claim is checked against the checkout.

- [x] **Step 4: Write `PRODUCTION-READINESS-REVIEW.md`**

Include: date, reviewed commit, deployment target, scope/exclusions, overall verdict under the spec's definitions, concise rationale, command/runtime evidence, deployment-configuration status, and a prioritized findings table. Each finding must state impact, confidence, exact file/line or the external fact that is unavailable, the next action, and a test or proof that closes it. Separate repository-fixable work from DNS/HTTPS, reference-PC, controller, instructor, and learner validation. Do not claim formal training readiness or invent an upper-mid hardware benchmark.

- [x] **Step 5: Validate the report against the repository**

Run `git diff --check`. Confirm each cited repository path and line range exists at the reviewed commit, each command result matches captured output, each finding is either evidenced or explicitly external/unverified, and the verdict follows the spec. Verify the only product deliverable is the root-level report; preserve unrelated worktree changes.

Expected: no dangling references or whitespace errors, no unexplained audit claims, and no application/deployment configuration changes.

- [x] **Step 6: Commit the audit record**

```powershell
git add PRODUCTION-READINESS-REVIEW.md docs\superpowers\specs\2026-11-04-mvp-production-readiness-review-design.md docs\superpowers\plans\2026-11-04-mvp-production-readiness-review.md
git commit -m "docs: add public MVP readiness review" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
