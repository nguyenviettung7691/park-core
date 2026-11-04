import type {
  AttemptSummary,
  FailureReason,
  InputAction,
  LessonRuntime,
  SensorSnapshot,
  StageId,
  VehicleId,
  VehicleTelemetry,
} from '../contracts';
import type { FailureEvent } from './failure';

const DIRECTION_THRESHOLD_MPS = 0.2;
const AID_ORDER: AttemptSummary['usedAids'][number][] = [
  'chase',
  '360',
  'trajectory',
  'help',
];

export interface AttemptTracker {
  readonly stageId: StageId;
  readonly vehicleId: VehicleId;
  readonly elapsedSimulationS: number;
  readonly closestSampledClearanceM: number | null;
  readonly peakSpeedMps: number;
  readonly directionChanges: number;
  readonly acknowledgedStepIds: readonly string[];
  readonly usedAids: AttemptSummary['usedAids'];
  readonly previousDirectionSign: -1 | 0 | 1;
}

export type AttemptResult =
  | { readonly outcome: 'success' }
  | { readonly outcome: 'fail'; readonly failure: FailureEvent };

export function createAttemptTracker(
  stageId: StageId,
  vehicleId: VehicleId,
): AttemptTracker {
  return {
    stageId,
    vehicleId,
    elapsedSimulationS: 0,
    closestSampledClearanceM: null,
    peakSpeedMps: 0,
    directionChanges: 0,
    acknowledgedStepIds: [],
    usedAids: [],
    previousDirectionSign: 0,
  };
}

function directionSign(signedSpeedMps: number): -1 | 0 | 1 {
  if (signedSpeedMps > DIRECTION_THRESHOLD_MPS) return 1;
  if (signedSpeedMps < -DIRECTION_THRESHOLD_MPS) return -1;
  return 0;
}

export function updateAttemptTracker(
  tracker: AttemptTracker,
  telemetry: VehicleTelemetry,
  sensors: SensorSnapshot | null,
  actions: readonly InputAction[],
  activeAids: AttemptSummary['usedAids'],
  runtime: LessonRuntime,
  deltaS: number,
): AttemptTracker {
  let closestSampledClearanceM = tracker.closestSampledClearanceM;
  for (const reading of sensors?.readings ?? []) {
    if (reading.distanceM === null) continue;
    closestSampledClearanceM = closestSampledClearanceM === null
      ? reading.distanceM
      : Math.min(closestSampledClearanceM, reading.distanceM);
  }

  const currentDirectionSign = directionSign(telemetry.signedSpeedMps);
  const directionChanged = currentDirectionSign !== 0
    && tracker.previousDirectionSign !== 0
    && currentDirectionSign !== tracker.previousDirectionSign;
  const aids = new Set([...tracker.usedAids, ...activeAids]);
  if (actions.some((action) => action.type === 'help')) aids.add('help');
  const usedAids = AID_ORDER.filter((aid) => aids.has(aid));
  const acknowledgedStepIds = [
    ...new Set([...tracker.acknowledgedStepIds, ...runtime.acknowledgedStepIds]),
  ];

  return {
    ...tracker,
    elapsedSimulationS: tracker.elapsedSimulationS + deltaS,
    closestSampledClearanceM,
    peakSpeedMps: Math.max(tracker.peakSpeedMps, Math.abs(telemetry.signedSpeedMps)),
    directionChanges: tracker.directionChanges + Number(directionChanged),
    acknowledgedStepIds,
    usedAids,
    previousDirectionSign: currentDirectionSign || tracker.previousDirectionSign,
  };
}

export function finishAttempt(
  tracker: AttemptTracker,
  result: AttemptResult,
): AttemptSummary {
  const failureReason: FailureReason | null = result.outcome === 'fail'
    ? result.failure.reason
    : null;
  return {
    stageId: tracker.stageId,
    vehicleId: tracker.vehicleId,
    outcome: result.outcome,
    failureReason,
    obstacleId: result.outcome === 'fail' ? result.failure.obstacleId : null,
    elapsedSimulationS: tracker.elapsedSimulationS,
    closestSampledClearanceM: tracker.closestSampledClearanceM,
    peakSpeedMps: tracker.peakSpeedMps,
    directionChanges: tracker.directionChanges,
    acknowledgedStepIds: [...tracker.acknowledgedStepIds],
    usedAids: [...tracker.usedAids],
  };
}
