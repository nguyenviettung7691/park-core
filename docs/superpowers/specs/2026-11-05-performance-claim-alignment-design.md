# Finding 5: Performance Claim Alignment

## Intent

Make project guidance describe the approved 1440p/60 Hz benchmark criteria
without implying measured results or a validated minimum-PC capability.

## Goals and boundaries

- Align stale top-level performance statements with the approved 2560x1440 at
  60 Hz criteria: p95 frame interval <=17.5 ms, mean >=57 FPS and zero loss.
- Keep 144 Hz explicitly optional and unverified, and keep reference/minimum-PC
  measurements pending.
- Close Finding 5 only as a documentation-accuracy issue. Finding 2 remains
  open until actual hardware evidence exists.
- No runtime source, optimization, or benchmark change: none can create
  hardware evidence.
- Do not imply the criteria have passed on any machine or certify general
  support.

## Approaches

1. **Align documentation (selected):** update the stale `.github` and
   implementation-plan target statements, then record Finding 5's limited
   closure in the readiness review. This follows the owner's choice and the
   already-correct technical/detail-design wording.
2. **Measure reference hardware:** collect and document a real benchmark before
   changing any claim. This is not selected because the requested outcome is
   alignment to the approved 60 Hz target and no measurement is available.

## Constraints and routing

The approved benchmark contract remains authoritative: 2560x1440 at 60 Hz,
p95 <=17.5 ms, mean >=57 FPS and zero loss; 144 Hz is optional. No minimum PC
is inferred. Follow the repository's lightweight tier for mechanical
documentation edits and verify the resulting wording against the existing
benchmark contract; no source-code tier is needed.

## Builder work

Update the two stale target statements and the review's Finding 5 status,
preserving explicit uncertainty about real hardware validation. Search
remaining top-level guidance for contradictory 144 Hz claims and review the
diff; no runtime source files should change.
