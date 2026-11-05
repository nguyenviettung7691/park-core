# Chromium-only automated validation

## Intent and scope

The owner chose immediate fallback rather than changing measurement semantics:
remove Firefox from both learner acceptance and production test suites.
This reduces automated coverage; it does not fix or certify Firefox timing.

## Approaches

- Quantized-clock compatibility: preserve tied timestamps as zero intervals,
  reject backwards time and zero total duration. Not selected; would change
  the previously approved measurement contract and require new validation.
- Chromium-only automation: selected by the owner. Remove Firefox projects,
  installation/probing and obsolete benchmark Firefox skip. Retain all
  Chromium tests and validated-main-only deployment.

## Invariants and validation

Manual benchmark runtime, export, strict timestamp validation and workload
remain unchanged. Full-duration benchmark tests remain excluded from CI.
Firefox remains unverified manually, not prohibited in the application.
Update README, master delivery/browser contracts and the review with this
coverage reduction, preserving historical evidence. Validate unit tests,
typecheck/build, Chromium acceptance and production smoke; no long benchmarks.
Work in an isolated worktree; require sign-off before merge/push.
