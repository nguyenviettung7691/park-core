# Finding 4: Proximity HUD guidance design

## Intent

Prevent learners from mistaking the limited bumper-ray display for proof that
the vehicle's path is clear. The live front and rear readings must remain
informative without claiming safety beyond the sensors' coverage.

## Goals

- Replace the green band's “safe” assurance with neutral Vietnamese wording.
- Whenever a sensor snapshot is displayed, show a concise visible note with
  that reading, including neutral/no-warning readings: sensors are guidance
  only, may miss obstacles, and never confirm clearance.
- Describe a no-hit result as “not detected by the sensor,” not as absence of
  an obstacle.
- Preserve the existing sensor readings, warning bands, colors, distances,
  audio, sampling, and no-snapshot hidden state.

## Non-goals and anti-goals

- Do not change ray origins/count/angles/range, collision behavior, thresholds,
  or sensor sampling.
- Do not recolor the sensor bands or alter unrelated HUD controls.
- Do not make a tooltip, menu, or general disclaimer the only explanation.
- Never label a green/no-hit state “safe,” “clear,” or equivalent.

## Approaches

1. **Per-reading caveat (selected):** place the note directly beneath each
   front/rear reading whenever a snapshot exists. Each independently positioned
   reading carries its own limitation; the tradeoff is repeated copy.
2. **Shared caveat:** place one notice between the two HUD sensor regions. This
   avoids repetition but requires more responsive-grid work and can detach the
   notice from the rear reading.

The owner selected the per-reading caveat and requested it for every active
snapshot, including no-warning states.

## Proposed copy

- Green band: `PHÁT HIỆN XA` (neutral distance observation).
- No hit: `Không phát hiện bằng cảm biến trong phạm vi 2,5 m`.
- Visible note under each active reading: `Chỉ hỗ trợ quan sát; có thể bỏ sót
  vật cản, không xác nhận khoảng trống an toàn.`

Keep the existing caution/warning wording for other bands unless a direct
conflict is found.

## Constraints and verification

Learner-facing copy remains Vietnamese; identifiers and technical documents
remain English. Keep the change limited to HUD presentation, messages, focused
HUD tests, and the original readiness/detail-design documents. Verify both
warning and no-hit snapshots show the caveat, green/no-hit wording makes no
safety claim, and a null snapshot still hides the panels. Preserve all sensor
data and behavior. Run focused tests, the unit suite, build/typecheck, and
browser verification appropriate to the final display change.

The finding closes only after source/docs, review, sign-off, merge, push, and
passing supported CI. This UI correction is not sensor validation or vehicle
clearance certification.
