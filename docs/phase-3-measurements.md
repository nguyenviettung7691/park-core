# Park-Core Phase 3 — Measured Physics Evidence

Date: 2026-11-03. Source: real Cannon-es worlds in `src/vehicle/vehicle.test.ts`
(Node/Vitest, `h = 1/120 s`, prototype yard from `src/world/colliders.ts`).
No scripted motion; fixtures set an initial velocity only for the braking and
barrier measurements.

## Versions

| Package | Installed |
|---|---|
| `cannon-es` | 0.20.0 (exact pin, verified from `node_modules/cannon-es/package.json`) |
| `three` | 0.187.0 (unchanged) |

## Adapter correction (measured engine defect)

With the stock `RaycastVehicle` and the design's P distribution (`mass*g/4`
brake per wheel), a perfectly settled Sedan (static equilibrium to 1e-16 m/s
with no brakes) diverged as soon as all four wheels were braked:

| Stock Cannon-es 0.20.0, Sedan | Value |
|---|---|
| Per-step velocity ratio, steps 4-11 | about -2.1 (alternating, growing from 1e-16) |
| Limit cycle after 60 steps | 0.0565 m/s, net drift 0.0386 m in 3 s |
| `settle` within 360 steps | failed (`settle-failed`, 0.066 m/s, 0.0137 m drift) |
| Two rear wheels braked only | stable (decays to 1e-40 m/s) |

Cause: Cannon's `updateFriction` lets every braked wheel compute the full
impulse that zeroes the chassis contact velocity, so N braked wheels apply ~N
times the correction. The Bullet `btRaycastVehicle` it ports divides that
impulse by `numWheelsOnGround`. No seed (stiffness, damping, roll influence,
brake value) changes this gain, so seed tuning could not meet the settle, P hold
or braking gates (the limit cycle alone exceeds the 0.05 m/s stop threshold).

`rig.ts` therefore uses `CorrectedRaycastVehicle`, a subclass whose
`updateFriction` is the 0.20.0 method with only that Bullet division restored.
Brake values remain `force*h` impulse caps; engine force, side friction,
friction-slip clipping and roll influence are unchanged. **This is an adapter
change, not seed tuning; explicitly approved by the owner on 2026-11-03.**
The adapted method retains Cannon's upstream MIT notice. Re-audit the
version-specific method on any dependency upgrade.

## Measured gates (both profiles, corrected adapter)

| Gate | Requirement | Sedan | CUV |
|---|---|---:|---:|
| Settle: Y vs nominal COM height | finite, 4 supports, no contact | 0.52000 / 0.52 | 0.62000 / 0.62 |
| Settle: vertical p2p first / last second of 3 s | not growing | 0 / 0 m | 0 / 0 m |
| D creep after 6 s | 0.83 +/- 0.1 m/s | 0.8186 | 0.8186 |
| R creep after 6 s | -0.56 +/- 0.1 m/s | -0.5530 | -0.5530 |
| Full brake from 5 km/h, travel to < 0.05 m/s | <= 0.5 m | 0.1813 m (0.267 s) | 0.1814 m (0.267 s) |
| P hold, 60 s horizontal drift | <= 0.02 m | 0 m | 0 m |
| Parking-brake hold (N), 60 s drift | <= 0.02 m | 0 m | 0 m |
| Full-lock rear-axle circle fit (4-14 s) | within 5% of reference | 4.0409 vs 4.0408 m (0.00%) | 3.9083 vs 3.9061 m (0.05%) |
| Turn speed after transient | <= 1 m/s | 0.884 m/s max | 0.890 m/s max |
| Creep at 30 / 60 / 144 fps via production clock | t = 6 s within one step; v within 0.1 of mean | 6.0000 s each; 0.8186 each | 6.0000 s each; 0.8186 each |
| Full throttle 6 s (taper 12->15 km/h, no clamp) | 12-15 km/h | 14.658 km/h | 14.696 km/h |
| 15 km/h into 0.1 m barrier, 0.1 s frames (8 steps, backlog dropped), every substep checked | contact, never past far face | contact at substep 1; deepest front -9.9679 (near -9.95, far -10.05); 0.0179 m penetration | contact at substep 1; deepest -9.9677; 0.0177 m |

Holding-brake impulses (Sedan): P 29.634 per wheel, parking brake 59.269 per
rear wheel; with both, rear wheels use the maximum (59.269), not the sum.
Interlocks: gear requests at brake 0.1 or at 0.5 m/s are rejected
(`gearRejected`) and keep the gear; brake > 0.02 or parking brake inhibits all
propulsion; R/D requests never release the parking brake.

The 30/60/144 schedule values agree to the printed precision; this is not a
claim of bit-identical replay. Thin-box contact relies on the fixed step at
15 km/h (0.035 m per step); no CCD guarantee.

## Tuning record

Seeds from product design Sections 4-5 are unchanged (`rollInfluence = 1.0`,
damping 4.4/2.3 Sedan, 4.8/2.5 CUV, stiffness, travel, friction slip). No creep
feedforward beyond the original formula was added; the 0.011 m/s creep error is
inside tolerance. Builder choices: settle converges after >= 60 steps once
|v| and |w| < 0.01 with four supports; pedal force uses
`max(pedal force, creep force)` so light throttle never falls below creep;
rolling resistance is split over all four wheels as opposing engine force,
capped at `mass*|v|/h`; static yard boxes use friction 1 so the pair product
equals the chassis coefficient 0.6.

## Software verification

`npm test`: 167/167 unit, DOM and real-physics tests passed.
`npm run typecheck`, `npm run build` and `git diff --check` passed.
`npm run test:browser`: 12/12 passed, six each in Chromium and Firefox,
with Playwright 1.64.1 on Linux. Browser coverage includes actual rendered
motion, controls/telemetry, calibration, physical brake plus HUD gear,
disconnect/reverification, contact stop, reset, focus safety, real pixels,
resize, ten open/close cycles and WebGL loss/recovery.

Initial real-browser failures exposed implicit select-label lookup and a
focus-loss redraw that removed Reset before its click. Explicit labels and
persistent native session controls fixed them; regressions were observed
failing before the fixes. Non-finite control/wheel-orientation regressions
also fail explicitly rather than silently normalizing to zero.

The production bundle is approximately 660 kB minified; Vite's >500 kB
warning is retained, not suppressed. This is no performance certification.

## Final branch review

One fresh Premium whole-branch review of `473939a..5ca8069` found no Critical
issues and one lost-keyup Resume problem. The reviewer labeled it Minor; the
implementer regraded it Important because releasing a movement key in another
application could leave Resume blocked with a misleading release instruction.
Two regressions failed before the correction. Window refocus now clears stale
suppression without automatic resume or held-key repeat replay. The full
167-test suite, typecheck/build and all 12 Chromium/Firefox tests passed after
the correction. No second reviewer was dispatched.

Reviewed behaviors retained: a same-gear request still checks the shift
interlock; keyboard HUD Pause can record focus rather than user as the reason;
physical controller R/D mapping uses HUD buttons for P/N/parking brake.
These do not bypass safety or claim additional hardware support.

## Local integration

The owner selected a local merge. `main` fast-forwarded from `473939a` to
`32b9061`, byte-identical to the verified phase branch. After restoring locked
dependencies with `npm ci`, the merged tree passed all 167 tests, typecheck,
build and whitespace checks. Browser evidence above is from that same code
tree before integration. Nothing was pushed. The sibling Phase 2 and Phase 3
worktrees and the Phase 2 documentation backup stash remain preserved.

## Pending (not established here)

Real hardware controllers, reference-PC and Windows performance, assets and
instructor review remain open release gates.
