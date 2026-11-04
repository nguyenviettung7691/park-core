# Park-Core Public MVP Production-Readiness Review

**Review date:** 2026-11-04

**Reviewed commit:** `e41fabefcc90fd2329f554964b4379a71311b97e`

**Target:** Public, low-traffic MVP/POC (about 10 concurrent users), built from this repository and hosted by GitHub Actions on GitHub Pages at the owner's custom subdomain.

**Scope:** Repository implementation, build/test evidence, static delivery configuration, and user-facing claims. This is not a driver-training, legal, instructor, learner, or physical-hardware certification.

> **Remediation status, 2026-11-04 (Finding 1, in progress; original review below is unchanged):** after owner sign-off, the Pages workflow, `public/CNAME` and production-preview smoke suite were merged and pushed to `main` at `d751da9`. [Actions run 41833951982](https://github.com/nguyenviettung7691/park-core/actions/runs/41833951982) passed 356 unit tests, typecheck and build on supported Node 24.15.0, but Linux browser acceptance failed (17 failed, 11 passed); production smoke, artifact upload and deployment were skipped. Firefox reported unavailable WebGL2; Chromium's four failures need retained traces before a root cause can be confirmed. Diagnostic instrumentation is prepared separately, not a fix. Pages setup is owner-managed: the repository reported `has_pages: false` and the Pages API returned 404. The hostname's HTTPS 404 via Cloudflare and absent public CNAME answer are baseline observations only (proxying/flattening may hide DNS targets). Run 41835725600 (`e0cc61a`) reproduced 17 failed / 11 passed with retained artifacts (Firefox probe `webgl2:false`; slow Chromium actions, root cause incomplete); headed Xvfb (run 41837675459) fixed Firefox WebGL2 and left 27 passed / 1 failed, a Chromium audio test that drove into contact before pausing; the audio correction (8f4234d, run 41839162095) passed, leaving 27 passed / 1 failed: Chromium driving.spec.ts:118 clicked Reset while the resumed canvas held pointer lock; a second test-precondition correction is pending CI. Finding 1 remains open pending passing CI, deployment and live HTTPS/app/asset evidence.

## Verdict: NO-GO for the requested public deployment

> **Latest remediation evidence, 2026-11-04:** [run 41841460826](https://github.com/nguyenviettung7691/park-core/actions/runs/41841460826) at `4ae956e` passed all software gates on supported Node 24.15.0: 356 unit tests, typecheck/build, 28 browser tests and four production smoke tests. Artifact upload and Pages deployment succeeded. Headed Xvfb restored Firefox WebGL2; two browser tests were corrected to stop before checking audio pause and release pointer lock before clicking Reset. Runtime simulator code is unchanged. Finding 1 is **not closed**: Pages reports `build_type: workflow`, `cname: null` and the repository-subpath URL; the intended custom hostname still returns HTTPS 404. The owner retained Pages/domain setup. Set the Pages custom domain to `park-core.nguyenviettung.id.vn`, then verify live app, JS/CSS and GLBs; the root-path build is not intended for `/park-core/`. The verdict and findings below remain the original audit, not a new whole-product review.

The app builds and renders locally, but this repository has no GitHub Actions workflow to publish it to Pages. Consequently, the deployment path requested for the MVP is not configured or verified. Do not treat successful local tests as a release sign-off.

This verdict is specific to public deployment. The local prototype passes the current software gates below. It is not evidence of actual custom-domain reachability, upper-mid-PC performance, or dynamic playability of every lesson.

## Verification evidence

All commands ran from the audit worktree at the reviewed commit on Windows.

| Check | Result |
|---|---|
| Node | `v24.13.1`, outside the package-supported range `^22.22.2 || ^24.15.0 || >=26.0.0`; therefore these checks do not establish supported-Node validation. |
| Playwright | `1.64.1`; installed Chromium `1248` and Firefox `1555`. |
| `npm test` | Passed: 24 files, 356 tests. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. Vite reported an 822.21 kB minified JavaScript chunk (217.81 kB gzip), above its 500 kB warning threshold. This is not a performance measurement. |
| `npm run test:browser -- --reporter=line` | Passed: 28 Chromium/Firefox tests in about 3.5 minutes. These run against the Vite development server (`playwright.config.ts:3,18-21`). |
| Local production-preview smoke | `dist/index.html`, generated JS/CSS, Sedan GLB, and Garage GLB returned HTTP 200; Chromium rendered the menu at 1440×900. This verifies local build paths only, not GitHub Pages or DNS. |

The independent reviewer initially could not start a second browser suite because port 4173 was occupied while this audit's suite was running. The audit's separate command completed with 28 passing tests; the reviewer confirmed its blocked attempt was superseded by that result.

## Findings

### 1. Blocker — GitHub Actions deployment to Pages is absent

**Confidence:** High

**Evidence:** There is no tracked `.github/workflows/` directory. `package.json:9-15` defines development, test, typecheck, build, and preview scripts, but no deployment job or command. No tracked `CNAME` file was found; Pages settings may manage a domain separately, so this does not prove whether a domain is configured in GitHub.

**Impact:** A local build does not publish the site, so the repository cannot currently deliver the stated Actions-to-Pages release path.

**Closure evidence:** Add the agreed Pages build/deploy workflow using a supported Node version, then show a successful Actions deployment of `dist`. Verify the deployed custom subdomain serves the app and its JS, CSS, and GLB assets over HTTPS. Confirm the domain in Pages settings and DNS without exposing secrets.

### 2. High — Performance on the stated upper-mid PC target is unverified

**Confidence:** High as an evidence gap

**Evidence:** `docs/detail-design.md:978-1003` requires selecting a named reference PC, measuring the worst garage view with all aids, targeting p95 frame interval ≤6.94 ms at 2560×1440, and retaining 60 rendered FPS on a declared minimum PC. The design says no reference hardware was supplied. The user target “most upper-mid PCs” does not name a machine or define a measurable threshold. No performance benchmark is recorded; the Vite bundle-size warning is not one.

**Impact:** “Runs comfortably” cannot be verified or responsibly claimed without an agreed reference/minimum machine and measurements.

**Closure evidence:** Select and record the representative upper-mid/reference and minimum machines, OS, browser, resolution, refresh rate, and quality settings. Benchmark the worst garage view with mirrors, sensors, and overhead enabled; report frame-time percentiles and physics overruns against the design's target.

### 3. Medium — Dynamic completion of all five lessons is not demonstrated

**Confidence:** High as an evidence gap; this does not prove a lesson is broken

**Evidence:** `tests/browser/phase-6.spec.ts:46-85` drives a full success path only for Stage 1, then enters Stage 2 without completing it. `src/lessons/scenario-routes.test.ts:84-109` checks geometric route witnesses, while `docs/phase-6-implementation-plan.md:66-70` explicitly says those checks do not establish dynamic drivability and that learner walkthroughs remain pending.

**Impact:** Five guided lessons are a core advertised MVP feature, but current evidence does not show that each is completable under the running physics and guidance rules.

**Closure evidence:** Complete an end-to-end success attempt for each of the five lessons with both Sedan and CUV, including expected recap and progression behavior; retain collision/failure checks and record any route or checkpoint adjustments.

### 4. Medium — The proximity HUD presents an incomplete reading as “safe”

**Confidence:** High

**Evidence:** `src/messages.ts:186` labels the green band “XANH — an toàn” (“GREEN — safe”), and `src/ui/hud.ts:171-176,193-210` renders that text in the proximity HUD. However, `docs/detail-design.md:441-443` says the rays have coverage gaps, miss some low obstacles, and do not cover the full side sweep; it requires those limitations to be explained. `src/sensors/sensors.test.ts:108-115` verifies that a low obstacle can produce no hit.

**Impact:** A user may interpret a green/no-warning state as clearance confirmation even though the simulation's limited rays can miss obstacles. The general prototype disclaimer does not explain that limitation next to the live reading.

**Closure evidence:** Replace assurance wording with a neutral proximity description and show a concise visible explanation that the sensor is limited guidance, can miss obstacles, and never confirms clearance.

### 5. Low — The technical design overstates the 144 Hz performance evidence

**Confidence:** High

**Evidence:** `docs/tech-design.md:10` says the engine is “optimized for 1440p at 144Hz”; `docs/detail-design.md:978-987` calls 1440p/144 Hz an aspiration, requires a named reference PC, and says none has been supplied.

**Impact:** Internal project documentation states a performance claim more strongly than the validation evidence supports.

**Closure evidence:** Qualify the technical-design wording as an unverified aspiration, or support the claim with a recorded benchmark on a named reference PC.

## External and environment evidence still outstanding

- Pages repository settings, the actual custom-subdomain DNS records, certificate issuance, and live HTTPS availability were not accessible from this checkout; the custom hostname was not provided.
- Current checks ran on unsupported Node `v24.13.1`. They establish the listed local results only, not behavior under the declared supported Node range.
- Browser acceptance ran in Chromium and Firefox on the available Windows host. Linux and other browsers/devices were not validated.
- No named upper-mid/minimum PC performance results, physical-wheel compatibility evidence, instructor review, or learner walkthroughs were available. Formal training readiness remains out of scope.

## Data and delivery boundary

The inspected app stores progress/settings/calibration in browser `localStorage` and completed-attempt history in IndexedDB. No account, sync, or server-side persistence path was identified. The local production preview served the built root-path assets successfully, which is compatible with a custom domain at `/`; it does not verify the requested GitHub Pages workflow or live deployment.
