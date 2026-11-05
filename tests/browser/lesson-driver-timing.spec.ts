import { expect, test, type Page } from '@playwright/test';
import { driveLesson, type ObservationSnapshot } from './lesson-driver';

const snapshot: ObservationSnapshot = {
  session: { generation: 1, stageId: 3, vehicleId: 'cuv' },
  telemetry: {
    simulationTimeS: 4.2, vehicleId: 'cuv',
    pose: { positionM: [0.1, 0.5, -3.25], rotation: [0, 0, 0, 1] },
    headingRad: 0.123, signedSpeedMps: -0.4, totalSpeedMps: 0.4, angularSpeedRadps: 0,
    steeringWheelRad: 0, frontWheelAnglesRad: [0, 0], gear: 'R', parkingBrake: false, indicator: 'right', brake: 0,
  },
  lesson: { stageId: 3, stepIndex: 2, stepDwellS: 0, parkingDwellS: 0, acknowledgedStepIds: [] },
  outcome: null, paused: null, closed: false, telemetryAgeMs: 5, sinceStartMs: 4000, telemetryCount: 10, ignored: 0,
};

// Test double: the first poll answers, every later poll never settles (frozen browser).
function frozenPage(): Page {
  let calls = 0;
  return {
    evaluate: () => (++calls === 1 ? Promise.resolve(snapshot) : new Promise(() => undefined)),
    keyboard: { press: () => Promise.resolve() },
  } as unknown as Page;
}

test('a never-resolving observation poll fails promptly with last known pose and step', async () => {
  const started = Date.now();
  const error = await driveLesson(frozenPage(), 3, 'cuv', undefined, 200).then(
    () => null, (caught: unknown) => caught as Error);
  expect(Date.now() - started).toBeLessThan(3000);
  expect(error?.message).toContain('observation poll unresponsive');
  expect(error?.message).toMatch(/stage=3 vehicle=cuv .*step=reverse-into-space/);
  expect(error?.message).toContain('pos=0.10,0.50,-3.25');
  expect(error?.message).toContain('heading=0.123');
});

// CI regression: the sedan stopped 0.16 m past the stage 4 aim point because it arrived at ~0.75 m/s.
// Stage 3 must keep the baseline drive control (no new braking) at the same distance and speed.
for (const stageId of [3, 4] as const) {
  test(`stage ${stageId} ${stageId === 4 ? 'slows' : 'keeps baseline speed'} within 0.3 m of the route end at 0.75 m/s`, async () => {
    const targetZ = stageId === 4 ? -7 : 0;
    const at = (bodyZ: number, speed: number): ObservationSnapshot => ({
      ...snapshot,
      session: { generation: 1, stageId, vehicleId: 'sedan' },
      telemetry: {
        ...snapshot.telemetry!, vehicleId: 'sedan', gear: 'R', parkingBrake: false, indicator: 'off',
        pose: { positionM: [stageId === 4 ? 5.4 : 2.9, 0.52, bodyZ], rotation: stageId === 4 ? [0, 1, 0, 0] : [0, 0, 0, 1] },
        headingRad: stageId === 4 ? Math.PI : 0, signedSpeedMps: -speed, totalSpeedMps: speed,
      },
      lesson: { stageId, stepIndex: stageId === 4 ? 2 : 3, stepDwellS: 0, parkingDwellS: 0, acknowledgedStepIds: [] },
    });
    // Stage 4 reverses toward -z, stage 3 toward +z; the last frame is 0.3 m of body travel short of the target.
    const far = stageId === 4 ? targetZ + 10 : targetZ - 7;
    const near = stageId === 4 ? targetZ + 0.3 : targetZ - 0.3;
    const frames = [at(far, 0), at(far + (stageId === 4 ? -6 : 6), 0.75), at(near, 0.75)];
    const sent: { brake: number; throttle: number }[] = [];
    let calls = 0;
    const page = {
      evaluate: (_fn: unknown, input: { brake: number; throttle: number }) => {
        sent.push(input);
        return calls < frames.length ? Promise.resolve(frames[calls++]) : new Promise(() => undefined);
      },
      keyboard: { press: () => Promise.resolve() },
    } as unknown as Page;
    await driveLesson(page, stageId, 'sedan', undefined, 100).catch(() => undefined);
    expect(sent[2].brake).toBe(0);
    expect(sent[3].throttle).toBe(0);
    if (stageId === 4) expect(sent[3].brake).toBeGreaterThan(0);
    else expect(sent[3].brake).toBe(0);
  });
}
