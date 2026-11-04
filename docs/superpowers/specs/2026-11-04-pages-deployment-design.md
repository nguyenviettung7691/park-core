# Finding 1: Validated GitHub Pages Deployment

## Intent and scope

Resolve the missing Actions-to-Pages delivery path for the public prototype at
`https://park-core.nguyenviettung.id.vn/`. This is a small deployment change,
not a simulator feature or a closure of the other readiness findings.

## Approaches

1. **Validated automatic deployment (owner-selected):** validate pull requests
   and pushes to `main`; publish a passing `main` build automatically, with a
   manual rerun option. This removes a release step but makes later `main`
   pushes publication events.
2. **Manual-only deployment:** validate changes automatically but publish only
   on explicit workflow dispatch. This offers extra release control at the
   cost of an additional operational step.

The owner selected automatic deployment. Existing root-relative application
and GLB paths suit the custom-domain root; repository-subpath hosting is not
part of this change.

## Delivery design

- Add a GitHub Actions workflow for pull requests, pushes to `main`, and manual
  dispatch. Only a validated `main` run may deploy; pull requests and dispatches
  on other branches must not publish.
- Use a supported Node version, `npm ci`, unit tests, typecheck/build, and the
  existing Chromium/Firefox acceptance suite. Add a focused production-preview
  smoke check that loads the built app and verifies its JS, CSS and GLB assets;
  development-server tests alone do not prove the shipping artifact works.
- Upload and deploy the checked `dist` artifact through official Pages
  actions. Scope Pages write and OIDC permissions to deployment, use the
  `github-pages` environment, and prevent overlapping deployments.
- Preserve the domain in `public/CNAME` and document GitHub Pages source
  selection, domain verification, DNS setup, certificate readiness, HTTPS
  enforcement, release checks, and recovery by redeploying a known-good
  revision. Do not inspect credentials or change DNS without authorization.
- Update relevant master design/roadmap documentation and README. Preserve the
  original audit as historical evidence, adding a dated remediation status
  rather than rewriting the original review results.
- Do not change runtime source unless implementation reveals an actual
  delivery defect. Root-path hosting currently needs no asset-loader change.

## Validation and release boundary

Work in `.worktrees\pages-deployment` on `fix-pages-deployment`. The baseline
has 356 passing tests on Node v24.13.1; that runtime is unsupported and must
not be reported as supported-Node evidence.

Run local applicable checks and validate workflow structure. Report any local
runtime limitation honestly; the workflow must use supported Node. Obtain
owner sign-off on the implemented and tested changes before merging into
`main` and pushing. After the approved push, observe the Actions result and
check the live hostname, HTTPS, and built asset delivery. Finding 1 remains
open until that external evidence exists; unavailable permissions or DNS/TLS
are blockers to closure, not reasons to claim success.

## Constraints and builder decisions

Follow `docs\tech-design.md` routing: Standard for integration, verification
and planning; Lightweight only for repetitive scaffolding. No Premium
geometry/physics work is involved. These are routing requirements, not claims
about the model used by Auto mode.

Builder decisions: exact supported Node pin, official action revisions,
production-smoke implementation, and minimal documentation placement. Keep
existing simulator behavior and all unrelated readiness findings unchanged.
