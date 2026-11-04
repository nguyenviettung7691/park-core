# Validated Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver finding 1's validated Actions-to-Pages release path at `https://park-core.nguyenviettung.id.vn/`.

**Architecture:** Validate changes with existing checks plus a separate Playwright suite against the production preview. Publish that checked `dist` artifact only from `main`, through official Pages actions; keep deployment/domain evidence separate from local evidence.

**Tech Stack:** GitHub Actions/Pages, supported Node/npm, Vite, Playwright, Markdown.

**Spec:** `docs\superpowers\specs\2026-11-04-pages-deployment-design.md` (owner-approved).

## Global Constraints

- Work only in `.worktrees\pages-deployment` on `fix-pages-deployment`.
- Only a validated `main` run may deploy; pull requests and dispatches on other branches must not publish.
- The hostname is `park-core.nguyenviettung.id.vn`; repository-subpath hosting is out of scope.
- Use a supported Node version, `npm ci`, unit tests, typecheck/build, and the existing Chromium/Firefox acceptance suite.
- Do not change runtime source unless implementation reveals an actual delivery defect.
- Do not inspect credentials or change DNS without authorization.
- Obtain owner sign-off on the implemented and tested changes before merging into `main` and pushing.
- Finding 1 remains open until successful Actions deployment and live HTTPS/asset evidence exist.
- Follow `docs\tech-design.md` routing: Standard for integration, verification and planning; Lightweight only for repetitive scaffolding.
- No dependency additions, simulator changes, or fixes to other readiness findings.

## Review Focus

1. A pull request or non-main manual dispatch must never publish; verify the deploy-job ref/event guard.
2. A failed check must prevent artifact deployment; verify job dependencies and exercise the production smoke's failure path.
3. Development fixtures must not disguise broken built delivery; the new suite must serve `dist`, not Vite development mode.
4. An HTML fallback masquerading as a GLB must fail smoke checks; verify GLB magic, not just HTTP 200.
5. Missing Pages settings, DNS or TLS must remain explicitly blocked evidence; inspect the actual run and hostname before closing finding 1.

---

### Task 1: Implement and verify the deployment path

**Files:**
- Create: `.github\workflows\pages.yml`
- Create: `public\CNAME`
- Create: `playwright.production.config.ts`
- Create: `tests\production\pages.spec.ts`
- Modify: `package.json` (add `test:production`, no dependency change)
- Modify: `README.md`, `docs\tech-design.md`, `docs\detail-design.md`, `docs\implementation-plan.md`
- Modify: `PRODUCTION-READINESS-REVIEW.md` (dated remediation note only)

**Interfaces:**
- Consumes: Existing npm commands, `dist`, root-relative `/assets/` paths,
  menu heading `Park-Core`, `[data-stage-id="1"]`, `#simulation`, `#telemetry`.
- Produces: `npm run test:production`, a Chromium/Firefox production smoke
  suite using `npm run preview -- --port 4174 --strictPort`; a workflow that
  checks changes and deploys the checked artifact from `main`.

- [x] **Step 1: Add focused production delivery tests and runner configuration.**
  Set `testDir` to `tests/production`, `baseURL` to
  `http://127.0.0.1:4174`, `reuseExistingServer: false`, one worker, Chromium
  and Firefox projects, and retained-on-failure traces. Add the npm script
  selecting this config. Test `built app serves assets and enters Stage 1`:
  assert visible menu, successful same-origin built JS/CSS responses with
  appropriate content types, enabled Stage 1, visible simulation/telemetry
  after starting it, no page errors, and successful fetches of all four GLBs
  whose first little-endian uint32 equals `0x46546c67`.

- [x] **Step 2: Exercise the smoke check's negative path.**
  Add a focused test that intercepts the Sedan GLB with an HTML 200 response
  and confirms the existing explicit asset-load alert appears instead of a
  working simulation. Run against a fresh build. The positive test must fail
  if a required built asset is absent; do not mock successful asset delivery.

- [x] **Step 3: Add the minimal Pages workflow and hostname file.**
  Use Node `24.15.0`, `npm ci`, existing tests/typecheck/build, install Chromium
  and Firefox with Linux dependencies, run existing browser tests and the
  new production suite, then upload `dist` for eligible `main` runs.
  Trigger on `pull_request`, pushes to `main`, and `workflow_dispatch`.
  The deploy job requires passing validation and
  `github.ref == 'refs/heads/main' && github.event_name != 'pull_request'`.
  Use official checkout/setup-node/configure-pages/upload-pages-artifact/
  deploy-pages actions with verified current stable revisions. Default
  permissions are `contents: read`; only deployment receives `pages: write`
  and `id-token: write`. Use the `github-pages` environment and a deployment
  concurrency group with `cancel-in-progress: false`.
  `public\CNAME` contains exactly `park-core.nguyenviettung.id.vn`.

- [x] **Step 4: Document setup and reconcile master documents.**
  Document Pages source `GitHub Actions`, custom-domain verification and DNS,
  HTTPS readiness/enforcement, automatic/manual releases, workflow logs,
  live app/asset smoke checks, and recovery by restoring a known-good change
  through `main` validation. Preserve historical phase/audit evidence.
  Repository inspection on 2026-11-04 returned `has_pages: false` and HTTP 404
  for Pages settings; activation and live evidence remain outstanding.

- [x] **Step 5: Run verification and inspect workflow eligibility.**
  Run `npm test`, `npm run typecheck`, `npm run build`,
  `npm run test:browser -- --reporter=line`,
  `npm run test:production -- --reporter=line`, and `git diff --check`.
  Validate YAML with an available workflow validator; do not add a package
  dependency solely for linting. Check PR/main/manual ref behavior, failed
  validation dependencies, permissions, artifact path and deployment
  serialization. Check built `CNAME` and retain honest Node-version evidence.

- [x] **Step 6: Review and commit the implementation.**
  Obtain one bounded independent branch review, fix verified defects, and
  rerun affected checks. Record actual results in this plan and commit only
  scoped files with the required Copilot co-author trailer. Do not merge or
  push yet.

  Recorded results (local Node v24.13.1, unsupported; CI pins 24.15.0):
  `npm test` 356 passed; typecheck and build clean; `test:browser` 28 passed;
  `test:production` 4 passed (includes built `CNAME` assertion);
  `git diff --check` clean; actionlint v1.7.12 reports no findings on
  `pages.yml`. Review fixes: validation concurrency scoped to the validate job,
  `configure-pages` moved to the deploy job, `persist-credentials: false`.
  Workflow not yet run on GitHub at that point.

  Post-push evidence (2026-11-04): after owner approval, `d751da9` was merged
  and pushed to `main`. Run 41833951982 passed 356 unit tests, typecheck and
  build on supported Node 24.15, but the browser suite failed (17 failed, 11
  passed) on the Linux runner; production smoke, upload and deploy were skipped.
  A diagnostic-only workflow change (WebGL2 probe, per-suite output directories,
  failure artifact upload) collects runner evidence; it is not a fix. The owner
  manages Pages setup, and Finding 1 remains open.

  Run 41835725600 (e0cc61a) reproduced 17 failed / 11 passed and retained
  artifacts: the probe showed Firefox webgl2:false and Chromium software
  WebGL2, with very slow Chromium actions that are not a complete root cause.
  Owner-selected experiment, unverified until run on CI: headed Chromium/Firefox
  under xvfb-run --auto-servernum for the probe and both suites; assertions,
  retries and deploy gates unchanged. Playwright documents Xvfb for headed Linux
  runs but does not guarantee WebGL.

  Run 41837675459 (66caa71): Firefox WebGL2 true (llvmpipe) and Chromium
  SwiftShader; headed Xvfb resolved the Firefox failures, leaving 27 passed / 1
  failed. The remaining Chromium audio/pause test held full throttle until the
  sensor label appeared and the car was already in contact-stop (front 0.02 m),
  so no pause control existed: a test-sequencing flaw, not a product defect.
  Fix: approach by idle creep, brake to 0 km/h, engage parking brake, assert no
  contact before Escape; 60 s test timeout (about 20 s locally).
  Independent task review and scoped fix review are complete; the whole-branch
  review at `f97e646` found no Critical or Important issues and approved
  readiness for owner sign-off. Implementation commits: `6e952a7`, `f97e646`.
  Minor follow-up: consider explicit job timeouts; no release blocker.

### Task 2: Sign off, publish and collect closure evidence

**Interfaces:** Consumes Task 1's reviewed commit and owner sign-off; produces
merged/pushed `main`, observed workflow result, and truthful closure status.

- [x] **Step 1: Present implementation evidence and request owner sign-off.**
  State changed files, check counts, runtime limitations and outstanding Pages
  setup. Wait for explicit approval before integration.
  Owner approved merge/push only and retained Pages configuration.
- [x] **Step 2: Merge and push after approval.**
  Check both worktrees for unrelated changes, merge the approved branch into
  `main` non-interactively, verify merged-tree checks, and push without force.
  Do not overwrite or discard unrelated work.
  Fast-forwarded and pushed `d751da9`; merged-tree unit tests (356), build
  and production smoke tests (4) passed on local Node v24.13.1 (unsupported).
- [ ] **Step 3: Observe deployment and live HTTPS delivery.**
  Inspect the actual Actions run, Pages configuration and HTTPS hostname.
  Check the app, JS/CSS and four GLBs; exercise a deployed Stage 1 launch.
  If Pages activation/settings changes need authorization or DNS/TLS is
  unavailable, report the exact blocker rather than claiming closure.
- [ ] **Step 4: Persist final evidence.**
  Record run URL, deployed revision, live results, and remaining gaps in the
  remediation note and plan; commit/push this evidence only within the
  approved scope. Close finding 1 only when all its closure conditions pass.
