# Sim Wheel/Gamepad Support Design

Date: 2026-11-06

Status: Approved

Issue: [#7 Sim Wheel/Gamepad Support](https://github.com/nguyenviettung7691/park-core/issues/7)

## Intent

Let learners select a known controller profile instead of repeatedly binding
every control by hand, and make unfamiliar-device calibration understandable
through simple device drawings that highlight the control for the current step.
Gamepad and wheel input continues to scale vehicle response directly with the
reported analog position. Keyboard movement remains binary.

## Goals

- Offer named presets for Xbox Wireless Controller (Series X), 8BitDo Ultimate
  2C Wireless, and a small set of common sim wheels.
- Keep profile selection explicit, with a clear verification step before
  profile-derived calibration is saved or used.
- Keep manual calibration for unmatched devices and mismatched device modes.
  Guide it one control at a time with a generic drawing and a highlight of the
  relevant wheel, pedal, trigger, or button.
- Make current step, capture status, live response, errors, and completion
  progress easy to understand; keep raw diagnostics expandable.
- Preserve existing persistence, reconnect verification, keyboard fallback,
  safety checks, and calibrated controls.

## Non-goals and anti-goals

- No change to vehicle physics or to the existing proportional gamepad input
  response.
- No wheel motor force-feedback, vibration, or other output-device feature.
- No claim that a profile works on every browser, driver, firmware, or
  connection mode; no unverified automatic profile application.
- No exhaustive device catalog, third-party mapping dependency, account/cloud
  profiles, or additional graphics framework.
- No change to lesson behavior, progression, or keyboard controls.

## Constraints and current behavior

- `src/input/controller.ts` already reads continuous gamepad axes/buttons.
  `src/input/calibration.ts` normalizes pedals and steering, and the vehicle
  rig applies those normalized values to drive force and steering. Keyboard
  movement is binary.
- Calibration currently records steering center/locks, throttle and brake
  endpoints, and R/D buttons; it supports axes and buttons for pedals.
  Accepted calibration is saved by reported device ID and re-verified on
  reconnect.
- Device discovery uses the browser Gamepad API. The browser's `mapping`
  property can report a standard layout, but device IDs and raw layouts can
  differ by operating system, driver, connection, and controller mode.
- The learner-facing UI and errors remain Vietnamese. Technical names and
  documentation remain English. Use vanilla DOM/CSS and the existing
  amethyst accent.
- No physical wheel/controller validation is available in this task. Software
  tests may verify matching and calibration behavior, but cannot establish
  hardware compatibility.

## Approaches considered

| Approach | Benefits | Tradeoffs | Decision |
|---|---|---|---|
| A. Preset-first with illustrated manual fallback | Recognized/selected profiles avoid nine manual captures; unfamiliar devices still get a guided route; directly addresses the repeated setup burden | Profile identification varies by browser and hardware mode, so matching and learner verification must be conservative | Selected by the owner |
| B. Guided calibration for every device | One consistent illustrated experience; explicit captures work even when browser IDs or mappings differ | Adds manual steps to every setup, including devices with known mappings; weaker fit for avoiding repeated calibration | Not selected |

The owner selected A. Device presets are a convenience, not proof of
compatibility. Match only known identifiers/layouts; when the current device
does not match confidently, offer profile selection with explicit verification
or the manual calibration path rather than silently applying a guessed map.

## Device profiles

Owner-prioritized gamepads:

- Xbox Wireless Controller (Series X)
- 8BitDo Ultimate 2C Wireless

Proposed initial wheel candidates, selected as a builder recommendation because
the owner has no wheel-model preference:

- Logitech G29, G920, and G923
- Thrustmaster T300 RS GT

Treat the wheel list as candidate profiles, not verified compatibility. A
profile defines the control bindings and expected analog ranges/directions
using the existing calibration representation. Keep the profile list small and
static. Prefer the browser's standard mapping where it accurately describes a
gamepad; use model-specific IDs/layouts only when their bindings are known.
Allow the learner to choose a named preset. Show when the current reported
device/mapping is an exact known match versus a manually chosen profile.

Before saving a preset-derived calibration, show the generic device drawing
with highlighted controls and a short verification task. For each control,
automatically mark it verified only after the expected movement crosses a
safe threshold, then require the control to return to neutral/released before
advancing. Confirm steering direction, throttle, brake, and any preset gear
controls against their live indicators. A mismatch or missing input routes to
manual calibration. Save the resulting calibration against the actual reported
device ID and retain the existing reconnect verification behavior.

## Setup and calibration experience

1. Keep the current input-source and device discovery actions.
2. With gamepad selected, show the connected device, any confidently matching
   profile, the named profile selector, and a manual-calibration action.
   Clearly distinguish detected, selected, verified, and unmatched states.
3. Selecting a profile opens a compact illustrated verification view. The
   generic device graphic highlights each control being checked; live values
   make the proportional response visible. Let the learner continue only
   after the expected controls have been checked, or route them to manual
   calibration if a check fails.
4. For manual calibration, replace the flat capture form with a guided sequence
   ordered as steering, throttle, brake, and gears. Keep one current capture
   action prominent; show its matching device part highlighted, concise
   Vietnamese instruction, captured/unverified state, and overall progress.
   Use generic illustrations rather than model-specific artwork.
5. Keep raw axis/button diagnostics in expandable details. Preserve visible
   device errors and Save readiness, Cancel/Escape, keyboard navigation,
   focus restoration, and safe disabled states while disconnected or invalid.

The learner-reviewed mockup showed a generic wheel/pedal drawing and gamepad
drawing, with the current steering/pedal part highlighted beside a single
capture instruction and progress. This is the intended visual direction, not
pixel-level approval.

## Decisions and remaining builder calls

Owner decisions:

- Analog device position directly scales vehicle response; do not add a
  nonlinear response curve or force-feedback output.
- Prioritize the two named gamepads; the owner delegated wheel model selection.
- Use a simple generic device graphic and highlight the relevant part for each
  calibration step.
- Use preset-first setup with an illustrated manual fallback.
- Automatically detect expected movement during preset verification and
  require release to neutral before advancing; do not rely on a learner-only
  confirmation to mark a control verified.

Builder calls:

- Choose conservative device-ID/mapping match conditions and avoid treating
  ambiguous IDs as verified model matches.
- Keep the candidate wheel list above only where bindings can be represented
  and safely verified; do not invent mappings for unverified variants.
- Keep the profile data shape as small as possible and reuse
  `ControllerCalibration` and existing persistence unless implementation
  evidence requires a directly dependent contract change.
- Create original simple diagrams with accessible text equivalents; do not add
  a graphics or UI dependency.
- Preserve existing validation and error reporting; do not convert invalid or
  unsupported input into a success-shaped fallback.

## Acceptance evidence

- Tests cover each built-in profile's binding/normalization, correct match and
  mismatch behavior, explicit verification before saving, and fallback to
  manual calibration.
- UI tests cover profile selection, highlighted control/progress updates,
  error and disconnected states, and existing cancel/focus behavior.
- Existing keyboard and gamepad input tests remain valid; direct analog
  proportional behavior is unchanged.
- Documentation and UI do not claim that software tests prove real-device
  compatibility. Hardware verification remains separate follow-up evidence.

## Research references

- [W3C Gamepad specification](https://www.w3.org/TR/gamepad/) describes analog
  button and axis values and includes wheels and pedals among the device types
  the API can represent.
- [MDN: Gamepad `mapping`](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad/mapping)
  documents the browser-reported standard mapping value.
- [8BitDo Ultimate 2C Wireless product page](https://www.8bitdo.com/ultimate-2c-wireless-controller/)
  lists its Xbox layout and Windows connection options; it does not guarantee
  a uniform browser mapping across modes.
- Recent beginner-wheel roundups commonly include Logitech G29/G920/G923 and
  Thrustmaster T300 RS GT; this informs the candidate list but is not evidence
  of browser-level compatibility:
  [Flow Racers](https://flowracers.com/blog/best-beginner-sim-racing-wheel/),
  [Yahoo Tech](https://tech.yahoo.com/gaming/articles/best-racing-wheels-2025-favorite-154118144.html).
