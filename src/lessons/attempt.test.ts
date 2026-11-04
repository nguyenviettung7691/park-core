import { describe, expect, it } from 'vitest';
import type {
  FailureReason,
  InputAction,
  LessonRuntime,
  SensorSnapshot,
  VehicleTelemetry,
} from '../contracts';
import { createAttemptTracker, finishAttempt, updateAttemptTracker } from './attempt';

function telemetry(signedSpeedMps = 0): VehicleTelemetry {
  return {
    simulationTimeS: 1,
    vehicleId: 'sedan',
    pose: { positionM: [0, 0.52, 0], rotation: [0, 0, 0, 1] },
    headingRad: 0,
    signedSpeedMps,
    totalSpeedMps: Math.abs(signedSpeedMps),
    angularSpeedRadps: 0,
    steeringWheelRad: 0,
    frontWheelAnglesRad: [0, 0],
    gear: 'D',
    parkingBrake: false,
    indicator: 'off',
    brake: 0,
  };
}

function runtime(acknowledgedStepIds: readonly string[] = []): LessonRuntime {
  return {
    stageId: 1,
    stepIndex: 0,
    stepDwellS: 0,
    parkingDwellS: 0,
    acknowledgedStepIds,
  };
}

function sensors(...distancesM: readonly (number | null)[]): SensorSnapshot {
  return {
    sampledAtS: 1,
    readings: distancesM.map((distanceM, index) => ({
      id: 'front-center',
      distanceM,
      obstacleId: distanceM === null ? null : `obstacle-${index}`,
      band: distanceM === null ? 'clear' : 'yellow',
    })),
  };
}

describe('attempt tracking', () => {
  it('starts with zeroed metrics and no inferred observations', () => {
    expect(createAttemptTracker(1, 'sedan')).toEqual({
      stageId: 1,
      vehicleId: 'sedan',
      elapsedSimulationS: 0,
      closestSampledClearanceM: null,
      peakSpeedMps: 0,
      directionChanges: 0,
      acknowledgedStepIds: [],
      usedAids: [],
      previousDirectionSign: 0,
    });
  });

  it('measures elapsed time, peak absolute speed, clearance, acknowledgements, and requested aids', () => {
    const initial = createAttemptTracker(1, 'sedan');
    const first = updateAttemptTracker(
      initial,
      telemetry(-2),
      sensors(null, 1.2, 0.7),
      [{ type: 'help' }],
      ['chase'],
      runtime(['survey']),
      0.25,
    );
    const updated = updateAttemptTracker(
      first,
      telemetry(2.5),
      sensors(null, 0.5),
      [],
      ['trajectory'],
      runtime(['survey', 'confirm']),
      0.25,
    );

    expect(updated.elapsedSimulationS).toBe(0.5);
    expect(updated.peakSpeedMps).toBe(2.5);
    expect(updated.closestSampledClearanceM).toBe(0.5);
    expect(updated.acknowledgedStepIds).toEqual(['survey', 'confirm']);
    expect(updated.usedAids).toEqual(['chase', 'trajectory', 'help']);
    expect(initial.elapsedSimulationS).toBe(0);
  });

  it('counts direction changes only after signed motion exceeds 0.2 m/s', () => {
    let tracker = createAttemptTracker(1, 'sedan');
    tracker = updateAttemptTracker(tracker, telemetry(0.2), null, [], [], runtime(), 0.1);
    tracker = updateAttemptTracker(tracker, telemetry(-0.2), null, [], [], runtime(), 0.1);
    expect(tracker.directionChanges).toBe(0);

    tracker = updateAttemptTracker(tracker, telemetry(0.21), null, [], [], runtime(), 0.1);
    tracker = updateAttemptTracker(tracker, telemetry(0), null, [], [], runtime(), 0.1);
    tracker = updateAttemptTracker(tracker, telemetry(-0.21), null, [], [], runtime(), 0.1);
    expect(tracker.directionChanges).toBe(1);

    tracker = updateAttemptTracker(tracker, telemetry(-0.5), null, [], [], runtime(), 0.1);
    tracker = updateAttemptTracker(tracker, telemetry(0.21), null, [], [], runtime(), 0.1);
    expect(tracker.directionChanges).toBe(2);
  });

  it('uses the same summary shape for success and failure', () => {
    const tracker = updateAttemptTracker(
      createAttemptTracker(3, 'cuv'),
      telemetry(-1.5),
      sensors(0.8),
      [],
      ['360'],
      runtime(['reverse']),
      4,
    );
    const success = finishAttempt(tracker, { outcome: 'success' });
    const reason: FailureReason = 'curb-contact';
    const failure = finishAttempt(tracker, {
      outcome: 'fail',
      failure: { reason, obstacleId: 'roadside-curb-right' },
    });

    expect(success).toEqual({
      stageId: 3,
      vehicleId: 'cuv',
      outcome: 'success',
      failureReason: null,
      obstacleId: null,
      elapsedSimulationS: 4,
      closestSampledClearanceM: 0.8,
      peakSpeedMps: 1.5,
      directionChanges: 0,
      acknowledgedStepIds: ['reverse'],
      usedAids: ['360'],
    });
    expect(failure).toEqual({
      ...success,
      outcome: 'fail',
      failureReason: reason,
      obstacleId: 'roadside-curb-right',
    });
  });

  it('does not mutate the inputs or track sensors as requested aids', () => {
    const initial = createAttemptTracker(1, 'sedan');
    const actions: readonly InputAction[] = [{ type: 'acknowledge-step' }];
    const snapshot = sensors(0.4);
    const updated = updateAttemptTracker(
      initial,
      telemetry(),
      snapshot,
      actions,
      [],
      runtime(['step']),
      0.1,
    );

    expect(updated.usedAids).toEqual([]);
    expect(initial.acknowledgedStepIds).toEqual([]);
    expect(snapshot.readings[0].distanceM).toBe(0.4);
  });
});
