# Finding 2: Repeatable Production Performance Benchmark

## Intent

Provide honest, repeatable performance evidence tooling for Park-Core, not an
unmeasured optimization or a performance guarantee. The owner selected a
32 GB / 2560x1440 / 60 FPS baseline and approved the reference specification
and protocol below. Actual hardware validation remains pending; delivering
this tooling must not mark Finding 2 Done.

## Goals and non-goals

- Measure a versioned Garage workload using production rendering, physics,
  assets and aid scheduling, and export a local report.
- Revise the master performance contract to the approved 60 FPS reference
  target. Retain 144 Hz only as an optional, unverified aspiration.
- Distinguish workload validity, measured target results, and reference-PC
  validation. A passing result on another machine is not reference validation.
- Do not infer a minimum PC, broad "upper-mid PC" support or training readiness.
- Do not optimize unmeasured bottlenecks, alter physics frequency, hide aids,
  change lesson progression, or upload reports/collect analytics.
- Do not close other findings or present the sampled workload as a proven
  global worst-case Garage view.

## Approved reference configuration and criteria

| Item | Reference |
|---|---|
| CPU | AMD Ryzen 5 7600, 6 cores / 12 threads |
| GPU | NVIDIA GeForce RTX 4060, 8 GB dedicated VRAM |
| RAM | 32 GB dual-channel DDR5 |
| Storage | NVMe SSD, at least 10 GB free |
| OS | Windows 11 64-bit |
| Browsers | Current stable Chrome and Firefox, hardware acceleration enabled |
| Display | 2560x1440 at 60 Hz, browser zoom 100% |

Record exact browser and driver versions, OS build, refresh rate and actual
hardware rather than substituting the reference specification as measured
metadata. Reference component choices are approved targets, not proof.

Every valid measured case targets p95 frame interval <=17.5 ms, average
rendered FPS >=57, and zero dropped physics time. The owner approved this
5% allowance for a nominal 60 FPS target. Report raw numbers and sample
counts, not just pass/fail. No separate minimum hardware is declared until
measurements support one.

## Approaches

1. **Repeatable production benchmark (owner-selected):** a dedicated entry
   runs fixed cases with the actual production runtime, collects frame and
   physics loss metrics, and exports comparable reports. More setup, but
   controlled comparisons.
2. **Manual in-app capture:** record arbitrary normal driving sessions.
   Smaller integration, but workload differences undermine comparisons.

The owner selected the first and declined browser mockups.

## Workload and user flow

Add a separate production-built `/benchmark.html` diagnostic entry. It must
not load or write learner progress, settings, calibration or attempt history.
Use vanilla DOM, Vietnamese controls, existing visual conventions and no
additional dependencies.

Run four fixed cases: Sedan/driver, Sedan/chase, CUV/driver, CUV/chase.
All use the production Garage sandbox spawn, stationary in P with parking
brake, fixed camera orientation/FOV, mirrors, sensors, overhead and trajectory
enabled, full resolution scale, and normal existing update-rate caps.
Document these constants as workload version 1. No artificial driving or
second simulation/render loop.

Each case has 10 seconds of warm-up and 60 seconds of measurement using a
monotonic clock. Exclude loading and warm-up from measured samples. Four
cases take about five minutes plus user interactions/loading.

Builder decision: use an explicit start gesture for each case to honor the
production pointer-lock lifecycle; show progress/results between cases and
release lock on completion. Do not bypass production input safety. Keep the
benchmark stationary; driving input during measurement invalidates the case.
Keep audio muted, document this setting; sensors and rendering remain active.

Before starting, require actual CPU/GPU/RAM, OS/driver, display refresh rate
and browser-zoom confirmation. Browser-readable metadata complements these
fields; it cannot reliably identify every hardware detail. Do not prefill
actual hardware with the approved reference machine.

Builder-check resolutions (designer decisions, subject to owner approval):
the shipping benchmark requires 2560x1440 drawing buffer and confirmed 60 Hz
display/100% zoom to start; other setups are explicitly ineligible for this
version-1 protocol, not passing non-reference substitutes. A machine with
different CPU/GPU may still run this protocol if display requirements match,
but its report is not verified reference-hardware evidence. Do not assign an
automatic "reference validated" label from user-entered specifications.

Run a separate four-case suite in each of Chrome and Firefox, producing one
report per browser. Future reference acceptance requires both reports; no
combined cross-browser average. Browser smoke may set its viewport/DPR to
produce the required drawing buffer and supply explicit test metadata;
shortened capture is marked test-only and cannot pass as version-1 evidence.

## Measurement and reporting

Use the production frame loop to observe completed rendered-frame timing and
the production fixed-step clock's discarded time. Add a minimal optional
typed observer, not a second benchmark simulation. Normal app behavior must
remain unchanged when no observer is supplied.

Collect consecutive completed-frame intervals and report average rendered
FPS as interval count divided by summed interval seconds. Report p50, p95,
p99 and maximum interval with a documented nearest-rank definition. Timestamp
the measured window, count completed rendered frames/intervals, and report
the actual elapsed time. Do not include an interval spanning warm-up.

Report fixed-step catch-up-limit loss separately from incoming elapsed time
discarded by the clock's 0.1-second clamp; both count toward the zero-loss
criterion. Preserve the existing clock's stepping behavior and existing
`droppedTimeS` semantics; do not silently relabel that value as total loss.

Reports include schema/workload version, build identity when available,
timestamp, actual and reference machine metadata, user agent/browser,
WebGL vendor/renderer when available (explicitly unavailable otherwise),
CSS viewport, DPR, drawing-buffer dimensions, settings/update-rate caps,
per-case metrics/validity/criteria, and complete/incomplete suite status.
Export JSON locally; include enough raw frame/loss samples to recompute
summary metrics. Never claim CPU/GPU execution times from requestAnimationFrame
intervals; these are delivered-frame/physics-health measurements, not GPU
profiling or a load-time benchmark.

## Validity and errors

Measurement requires actual drawing buffer 2560x1440, visible foreground page,
correct settings and uninterrupted production rendering. Treat resize, DPR
or visibility/focus changes, loss of pointer lock, user driving input,
unexpected pause/contact, context loss and runtime/asset errors as explicit
invalid/interrupted cases, never successful measurements. Clear the first
interval baseline at measurement start. A low FPS result is a valid failure,
not invalid input.

Designer decision: invalidate on nonzero mouse-look movement, steering,
pedal or gear/parking-brake input during warm-up or measurement. Do not ignore
production controls or change their normal behavior to keep a case valid.
Tell the user to leave the mouse and controls still; accidental movement
requires a retry. Menu/cancel/Escape cleanly interrupt rather than recording a
valid performance result. Mouse clicks needed between cases are not samples.

Stop and dispose failed/cancelled cases; show actionable errors and allow
retry. Partial reports remain explicitly incomplete. Do not silently resume
or stitch interrupted windows. Bound samples to the fixed run duration and
avoid retaining frame samples after disposal or unbounded repeated runs.

## Validation and release boundary

Focused tests cover percentile/FPS/loss calculation, warm-up boundary,
interruption/invalid resolution, both loss sources, optional-observer normal
behavior and resource cleanup. Production browser smoke verifies the built
entry and an actual short render/capture path; shortened test durations are
explicit test configuration, never reference-performance evidence. Keep
normal version-1 durations fixed in the shipping entry.

Run repository tests/typecheck/build, relevant browser suites and whitespace
checks. CI hardware/software rendering results verify tooling only. Record
real reference hardware, browser/driver, workload version and results later;
Finding 2 stays open until that evidence and a justified minimum-PC conclusion
exist, or the owner explicitly revises the remaining requirement.

## Documentation and execution

Update the master technical/detailed design and implementation roadmap,
README benchmark instructions and the readiness report's dated Finding 2
status. Preserve historical evidence and distinguish new targets from results.
Document reproducible machine setup and report interpretation.

Work in `.worktrees\performance-benchmark` on `performance-benchmark`, created
from `07b1a3b`. Baseline: 356 tests pass on unsupported local Node v24.13.1;
use the supported Node CI path for supported-runtime evidence.

Follow `docs\tech-design.md` model routing: Standard for metric logic,
state/lifecycle integration, tests and docs; Lightweight only for repetitive
DOM/CSS after contracts are fixed; Premium only if genuinely necessary
physics/geometry changes emerge. None are planned. Routing is not a claim
about the parent Auto model.

Obtain owner approval of this design before planning/implementation. After
implementation/review, obtain separate sign-off before merge into `main` and
push. Existing Pages deployment will publish approved main changes.

## Remaining builder choices

Exact module/file decomposition, minimal observer payload, fixed camera FOV,
UI layout, build identity injection, and short browser-test mechanism are
builder choices. They must preserve production runtime ownership, input
safety, existing loop/update rates, workload reproducibility and honest
measurement semantics.
