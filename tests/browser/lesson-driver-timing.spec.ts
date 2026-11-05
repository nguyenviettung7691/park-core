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
