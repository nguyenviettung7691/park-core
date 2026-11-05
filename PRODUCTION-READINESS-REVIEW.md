# Production Review — Change History

Chronological record of the changes made in response to the production-readiness review.

## 2026-11-04 — GitHub Pages delivery

Added the Pages build-and-deploy workflow, custom-domain configuration, and production-preview smoke tests (`6e952a7`). Hosted run [41841460826](https://github.com/nguyenviettung7691/park-core/actions/runs/41841460826) passed 356 unit tests, typecheck/build, 28 browser tests, and four production smoke tests; deployment succeeded. The owner verified the custom domain.

## 2026-11-05 — Performance benchmark tooling

Added `/benchmark.html`, the versioned Garage workload, and local JSON report export (`e437d52`). Hosted run [41957312693](https://github.com/nguyenviettung7691/park-core/actions/runs/41957312693) passed 417 unit tests, typecheck/build, 28 browser tests, and nine production tests; deployment succeeded.

Changed automated production checks to short setup/asset smoke coverage rather than full-duration benchmark runs (`5627e3d`). Hosted run [41958808599](https://github.com/nguyenviettung7691/park-core/actions/runs/41958808599) passed 417 unit tests, typecheck/build, 28 browser tests, and seven production smoke tests; deployment succeeded.

## 2026-11-05 — Lesson completion journeys

Added browser journeys completing all five lessons with both Sedan and CUV, including recap and progression checks (`f1a8204`); adjusted the Stage 4 test-driver approach speed (`c921766`). Hosted run [41981753519](https://github.com/nguyenviettung7691/park-core/actions/runs/41981753519) passed 427 unit tests, typecheck/build, 19 browser tests, and five production smoke tests; deployment succeeded.

## 2026-11-05 — Proximity HUD guidance

Replaced safety-assuring proximity wording with neutral readings and a visible limitation note in each active sensor panel (`e47112a`). Hosted run [41988083375](https://github.com/nguyenviettung7691/park-core/actions/runs/41988083375) passed 428 unit tests, typecheck/build, 19 browser tests, and five production smoke tests; deployment succeeded.

## 2026-11-05 — Performance target documentation

Aligned project guidance with the approved 1440p/60 Hz benchmark criteria and marked 144 Hz as optional and unverified (`140f64b`, `50185bc`). No runtime performance behavior was changed.
