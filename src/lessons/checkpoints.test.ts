import { describe, expect, it } from 'vitest';
import type {
  Checkpoint,
  InputAction,
  LessonRuntime,
  LessonStep,
  OrientedRegion,
  ScenarioDefinition,
  VehicleTelemetry,
} from '../contracts';
import { scenarios } from './scenarios';
import { advanceLesson } from './checkpoints';

function step(
  id: string,
  required: readonly Checkpoint[],
  alternativeRegionId: string | null = null,
): LessonStep {
  return {
    id,
    instructionKey: 'lessonSurveySpace',
    highlightId: null,
    required,
    alternativeRegionId,
  };
}

function scenario(
  steps: readonly LessonStep[],
  regions: Readonly<Record<string, OrientedRegion>> = scenarios[1].regions,
): ScenarioDefinition {
  return { ...scenarios[1], steps, regions };
}

function runtime(overrides: Partial<LessonRuntime> = {}): LessonRuntime {
  return {
    stageId: 1,
    stepIndex: 0,
    stepDwellS: 0,
    parkingDwellS: 0,
    acknowledgedStepIds: [],
    ...overrides,
  };
}

function telemetry(overrides: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return {
    simulationTimeS: 1,
    vehicleId: 'sedan',
    pose: { positionM: [0, 0.52, 0], rotation: [0, 0, 0, 1] },
    headingRad: 0,
    signedSpeedMps: 0,
    totalSpeedMps: 0,
    angularSpeedRadps: 0,
    steeringWheelRad: 0,
    frontWheelAnglesRad: [0, 0],
    gear: 'P',
    parkingBrake: true,
    indicator: 'off',
    brake: 1,
    ...overrides,
  };
}

describe('lesson checkpoint progression', () => {
  it('requires every checkpoint, including oriented region and wrapped heading', () => {
    const definition = scenario([
      step('confirm', [
        { kind: 'region', regionId: 'setup' },
        { kind: 'heading', targetRad: Math.PI - 0.01, toleranceRad: 0.03 },
        { kind: 'gear', gear: 'P' },
        { kind: 'parking-brake', applied: true },
        { kind: 'indicator', value: 'right' },
      ]),
    ], {
      setup: {
        centerM: [2, 0, 3],
        halfWidthM: 0.5,
        halfLengthM: 2,
        headingRad: Math.PI / 2,
      },
    });
    const car = telemetry({
      pose: { positionM: [3, 0.52, 3], rotation: [0, 0, 0, 1] },
      headingRad: -Math.PI + 0.01,
      indicator: 'off',
    });

    expect(advanceLesson(definition, runtime(), car, [], 0.1).stepIndex).toBe(0);
    expect(advanceLesson(
      definition,
      runtime(),
      telemetry({ ...car, indicator: 'right' }),
      [],
      0.1,
    ).stepIndex).toBe(1);
  });

  it('advances at most one step per update', () => {
    const definition = scenario([
      step('first', [{ kind: 'gear', gear: 'P' }]),
      step('second', [{ kind: 'gear', gear: 'P' }]),
    ]);

    const updated = advanceLesson(definition, runtime(), telemetry(), [], 0.1);

    expect(updated.stepIndex).toBe(1);
  });

  it('latches acknowledgements only for the current step and only while stopped', () => {
    const definition = scenario([
      step('first', [{ kind: 'acknowledgement' }]),
      step('second', [{ kind: 'acknowledgement' }]),
    ]);
    const acknowledge: readonly InputAction[] = [{ type: 'acknowledge-step' }];

    const moving = advanceLesson(
      definition,
      runtime(),
      telemetry({ totalSpeedMps: 0.1 }),
      acknowledge,
      0.1,
    );
    expect(moving.acknowledgedStepIds).toEqual([]);

    const first = advanceLesson(
      definition,
      runtime(),
      telemetry({ totalSpeedMps: 0.099 }),
      acknowledge,
      0.1,
    );
    expect(first.stepIndex).toBe(1);
    expect(first.acknowledgedStepIds).toEqual(['first']);

    const secondWithoutAck = advanceLesson(
      definition,
      first,
      telemetry(),
      [],
      0.1,
    );
    expect(secondWithoutAck.stepIndex).toBe(1);
    expect(secondWithoutAck.acknowledgedStepIds).toEqual(['first']);
  });

  it('accumulates stopped dwell, resets it when moving, and clears it on advance', () => {
    const definition = scenario([
      step('stop', [{ kind: 'stopped', dwellS: 0.5 }]),
      step('next', [{ kind: 'gear', gear: 'P' }]),
    ]);
    const partial = advanceLesson(
      definition,
      runtime(),
      telemetry({ totalSpeedMps: 0.05 }),
      [],
      0.2,
    );
    expect(partial.stepDwellS).toBeCloseTo(0.2);

    const reset = advanceLesson(
      definition,
      partial,
      telemetry({ totalSpeedMps: 0.1 }),
      [],
      0.2,
    );
    expect(reset.stepDwellS).toBe(0);

    const advanced = advanceLesson(
      definition,
      reset,
      telemetry({ totalSpeedMps: 0.05 }),
      [],
      0.5,
    );
    expect(advanced.stepIndex).toBe(1);
    expect(advanced.stepDwellS).toBe(0);
  });

  it('uses the alternative safe region to skip advisory steps without claiming acknowledgement', () => {
    const definition = scenario([
      step('advisory', [{ kind: 'acknowledgement' }], 'safe'),
      step('later', [{ kind: 'gear', gear: 'P' }]),
    ], {
      safe: {
        centerM: [5, 0, 5],
        halfWidthM: 1,
        halfLengthM: 1,
        headingRad: 0,
      },
    });

    const updated = advanceLesson(
      definition,
      runtime(),
      telemetry({ pose: { positionM: [5, 0.52, 5], rotation: [0, 0, 0, 1] } }),
      [],
      0.1,
    );

    expect(updated.stepIndex).toBe(1);
    expect(updated.acknowledgedStepIds).toEqual([]);
  });

  it('does not mutate the scenario or supplied runtime', () => {
    const definition = scenario([step('confirm', [{ kind: 'gear', gear: 'P' }])]);
    const current = runtime();
    const originalSteps = definition.steps;

    advanceLesson(definition, current, telemetry(), [], 0.1);

    expect(current).toEqual(runtime());
    expect(definition.steps).toBe(originalSteps);
  });
});
