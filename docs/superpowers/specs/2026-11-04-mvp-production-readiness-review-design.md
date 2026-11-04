# Public MVP Production-Readiness Review

## Intent

Provide an independent, evidence-based release gate for Park-Core as a small
public MVP/POC hosted from this repository with GitHub Actions and GitHub Pages
on the owner's custom subdomain. The review must identify implementation,
deployment, operational, and evidence gaps so they can be prioritized in later
plans. It must not mistake completed phase requirements or passing tests for
deployment readiness.

The target is low traffic (about ten concurrent users maximum) and comfortable
operation on most upper-mid-range PCs. The project is not being approved as a
validated driver-training product.

## Goals

- Inspect the current implementation and its documentation against the
  intended public MVP and the requirements actually stated in the technical
  and phase design documents.
- Independently examine repository deployment configuration for GitHub Actions
  and Pages, custom-domain handling, HTTPS, static asset paths, and an
  operational release/smoke-check path.
- Run fresh available project checks: `npm test`, `npm run typecheck`,
  `npm run build`, and `npm run test:browser -- --reporter=line`, recording
  exact results and the Node version. Do not describe checks on an unsupported
  Node version as supported-Node validation.
- Create a root-level `PRODUCTION-READINESS-REVIEW.md` with a clear overall
  verdict, scope, reviewed commit/environment, evidence, and prioritized,
  actionable findings. Each finding should identify impact, relevant
  file/line or missing evidence, and an acceptance condition for later work.
- Separate repository-fixable work from evidence that requires an actual
  GitHub Pages deployment, custom DNS/subdomain, reference PC, physical
  controller, instructor, or learner.

## Verdict and finding rules

Use one overall verdict:

- **NO-GO:** at least one evidenced repository- or deployment-configuration
  blocker prevents the stated public MVP release.
- **CONDITIONAL GO:** no evidenced repository-fixable blocker remains, but
  specifically named external deployment or environment evidence is still
  outstanding.
- **GO:** repository and deployment checks, including observable custom-domain
  HTTPS access, pass for the stated MVP. Do not infer this from local tests.

Order findings by release impact, then by confidence. Use Blocker, High,
Medium, or Low; avoid treating non-goals of formal driver training as release
blockers for this public prototype. Every finding must be grounded in current
repository evidence or be explicitly labeled as an unverified external
condition. Preserve passing evidence and limitations so later implementers
can distinguish a real gap from a deliberate product boundary.

## Non-goals and anti-goals

- Do not modify application behavior, add CI/deployment configuration, alter
  DNS, deploy, publish, or push.
- Do not claim or certify driver-training effectiveness, legal compliance,
  instructor approval, supported physical-wheel behavior, or learner
  competence.
- Do not claim “upper-mid PC” performance without a named reference machine
  and measurable acceptance target. Record that ambiguity and any absent
  performance evidence rather than inventing a benchmark.
- Do not expose credentials, inspect or reproduce secret values, or assume
  access to private repository settings.
- Do not present software tests as proof of custom-domain DNS, TLS, browser
  support beyond tested configurations, or actual field performance.

## Approaches

1. **Paper review:** assess source, design documents, and already-recorded test
   results. This is quicker, but can miss regressions in the current build and
   does not verify the current browser run.
2. **Executable MVP readiness gate (chosen):** conduct an independent
   repository/deployment review and run fresh tests, typecheck, build, and
   browser acceptance. This gives stronger evidence while clearly leaving
   actual GitHub Pages/DNS, reference-PC, and user validation unclaimed.

## Implementation choices

- The independent review covers the shipping app and the repository's static
  delivery path, not whether the simulation is appropriate for real driver
  instruction.
- Review repository evidence first, then verify every material claim against
  source/configuration and fresh command output. Do not treat checklist
  language in a design or implementation plan as proof by itself.
- Record the current reviewed commit and available Node/browser environment.
  If a required supported runtime or browser is unavailable, state the
  limitation and do not silently substitute or install tools outside scope.
- Keep the requested final findings document at the repository root. Link
  findings to exact file paths/lines where possible, and state acceptance
  tests or external proof needed to close them.
- Do not use the report to predetermine the verdict; derive it from evidence
  under the verdict rules above.

## Remaining to builder

Read the master and phase designs/plans, inspect source and deployment
configuration, run the fresh checks, obtain a read-only independent review of
the current tree, reconcile findings against direct evidence, and write the
root-level report. Where an “upper-mid PC” baseline or DNS/deployment proof is
missing, record it as an external acceptance gap rather than guessing.
