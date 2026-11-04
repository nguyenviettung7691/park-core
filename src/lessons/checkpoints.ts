import type {
  Checkpoint,
  InputAction,
  LessonRuntime,
  LessonStep,
  OrientedRegion,
  ScenarioDefinition,
  VehicleTelemetry,
} from '../contracts';

const STOPPED_SPEED_MPS = 0.1;
const REGION_EPSILON_M = 1e-8;

function wrapAngle(angleRad: number): number {
  return Math.atan2(Math.sin(angleRad), Math.cos(angleRad));
}

function containsPoint(positionM: readonly number[], region: OrientedRegion): boolean {
  const dx = positionM[0] - region.centerM[0];
  const dz = positionM[2] - region.centerM[2];
  const cos = Math.cos(region.headingRad);
  const sin = Math.sin(region.headingRad);
  const localX = cos * dx - sin * dz;
  const localZ = sin * dx + cos * dz;
  return Math.abs(localX) <= region.halfWidthM + REGION_EPSILON_M
    && Math.abs(localZ) <= region.halfLengthM + REGION_EPSILON_M;
}

function checkpointSatisfied(
  checkpoint: Checkpoint,
  step: LessonStep,
  scenario: ScenarioDefinition,
  runtime: LessonRuntime,
  telemetry: VehicleTelemetry,
): boolean {
  switch (checkpoint.kind) {
    case 'region': {
      const region = scenario.regions[checkpoint.regionId];
      return region !== undefined && containsPoint(telemetry.pose.positionM, region);
    }
    case 'heading':
      return Math.abs(wrapAngle(telemetry.headingRad - checkpoint.targetRad))
        <= checkpoint.toleranceRad;
    case 'stopped':
      return telemetry.totalSpeedMps < STOPPED_SPEED_MPS
        && runtime.stepDwellS >= checkpoint.dwellS;
    case 'gear':
      return telemetry.gear === checkpoint.gear;
    case 'parking-brake':
      return telemetry.parkingBrake === checkpoint.applied;
    case 'indicator':
      return telemetry.indicator === checkpoint.value;
    case 'acknowledgement':
      return runtime.acknowledgedStepIds.includes(step.id);
  }
}

export function advanceLesson(
  scenario: ScenarioDefinition,
  runtime: LessonRuntime,
  telemetry: VehicleTelemetry,
  actions: readonly InputAction[],
  deltaS: number,
): LessonRuntime {
  const step = scenario.steps[runtime.stepIndex];
  if (!step) return runtime;

  const inAlternativeRegion = step.alternativeRegionId !== null
    && scenario.regions[step.alternativeRegionId] !== undefined
    && containsPoint(
      telemetry.pose.positionM,
      scenario.regions[step.alternativeRegionId],
    );
  if (inAlternativeRegion) {
    return { ...runtime, stepIndex: runtime.stepIndex + 1, stepDwellS: 0 };
  }

  const stoppedCheckpoints = step.required.filter(
    (checkpoint): checkpoint is Extract<Checkpoint, { kind: 'stopped' }> =>
      checkpoint.kind === 'stopped',
  );
  const isStopped = telemetry.totalSpeedMps < STOPPED_SPEED_MPS;
  const stepDwellS = stoppedCheckpoints.length === 0 || !isStopped
    ? 0
    : runtime.stepDwellS + deltaS;
  const requiresAcknowledgement = step.required.some(
    (checkpoint) => checkpoint.kind === 'acknowledgement',
  );
  const acknowledgesCurrentStep = requiresAcknowledgement
    && isStopped
    && actions.some((action) => action.type === 'acknowledge-step');
  const acknowledgedStepIds = acknowledgesCurrentStep
    && !runtime.acknowledgedStepIds.includes(step.id)
    ? [...runtime.acknowledgedStepIds, step.id]
    : runtime.acknowledgedStepIds;
  const updatedRuntime: LessonRuntime = {
    ...runtime,
    stepDwellS,
    acknowledgedStepIds,
  };

  if (step.required.every((checkpoint) => checkpointSatisfied(
    checkpoint,
    step,
    scenario,
    updatedRuntime,
    telemetry,
  ))) {
    return {
      ...updatedRuntime,
      stepIndex: runtime.stepIndex + 1,
      stepDwellS: 0,
    };
  }

  return updatedRuntime;
}
