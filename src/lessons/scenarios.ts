import type {
  Checkpoint,
  LessonStep,
  MessageKey,
  OrientedRegion,
  ParkingTarget,
  ScenarioCollider,
  ScenarioDefinition,
  SpawnPose,
  StageId,
  Vec3Data,
} from '../contracts';
import { profiles } from '../vehicle/profiles';

const garageBounds: OrientedRegion = {
  centerM: [0, 0, 0],
  halfWidthM: 8.5,
  halfLengthM: 13.5,
  headingRad: 0,
};

const roadsideBounds: OrientedRegion = {
  centerM: [0, 0, 0],
  halfWidthM: 4.05,
  halfLengthM: 15.5,
  headingRad: 0,
};

function region(
  x: number,
  z: number,
  halfWidthM: number,
  halfLengthM: number,
  headingRad = 0,
): OrientedRegion {
  return { centerM: [x, 0, z], halfWidthM, halfLengthM, headingRad };
}

function spawns(x: number, z: number, yawRad: number): Readonly<Record<'sedan' | 'cuv', SpawnPose>> {
  return {
    sedan: { positionM: [x, profiles.sedan.centerOfMassHeightM, z], yawRad },
    cuv: { positionM: [x, profiles.cuv.centerOfMassHeightM, z], yawRad },
  };
}

function target(
  x: number,
  z: number,
  widthM: number,
  lengthM: number,
  headingRad: number,
  curbId: string | null = null,
): ParkingTarget {
  return {
    region: region(x, z, widthM / 2, lengthM / 2, headingRad),
    insetM: 0.05,
    headingToleranceRad: 5 * Math.PI / 180,
    stationaryDwellS: 2,
    curbId,
    curbGapRangeM: curbId ? [0.15, 0.30] : null,
  };
}

function box(
  id: string,
  centerM: Vec3Data,
  halfExtentsM: Vec3Data,
  kind: ScenarioCollider['kind'] = 'obstacle',
): ScenarioCollider {
  return { id, kind, centerM, halfExtentsM, yawRad: 0 };
}

function step(
  id: string,
  instructionKey: MessageKey,
  highlightId: string | null,
  required: readonly Checkpoint[],
  alternativeRegionId: string | null = null,
): LessonStep {
  return { id, instructionKey, highlightId, required, alternativeRegionId };
}

const scenarios: Readonly<Record<StageId, ScenarioDefinition>> = Object.freeze({
  1: {
    stageId: 1,
    environmentId: 'garage',
    titleKey: 'stage1',
    spawnByVehicle: spawns(0, 9, 0),
    drivingBounds: garageBounds,
    regions: {
      setup: region(0, 9, 3, 2.5),
      target: region(0, -5, 1.5, 3),
    },
    target: target(0, -5, 3, 6, 0),
    steps: [
      step('survey-space', 'lessonSurveySpace', 'setup',
        [{ kind: 'region', regionId: 'setup' }], 'target'),
      step('select-drive', 'lessonApproachForward', 'target',
        [{ kind: 'gear', gear: 'D' }, { kind: 'parking-brake', applied: false }], 'target'),
      step('secure-vehicle', 'lessonSecureVehicle', 'target', [
        { kind: 'region', regionId: 'target' },
        { kind: 'gear', gear: 'P' },
        { kind: 'parking-brake', applied: true },
      ]),
    ],
    guidance: 'full',
    obstacles: [
      box('stage1-parked-left', [-3.4, 0.8, -5], [0.9, 0.8, 2.2]),
      box('stage1-parked-right', [3.4, 0.8, -5], [0.9, 0.8, 2.2]),
    ],
  },
  2: {
    stageId: 2,
    environmentId: 'garage',
    titleKey: 'stage2',
    spawnByVehicle: spawns(0, 10, Math.PI),
    drivingBounds: garageBounds,
    regions: {
      setup: region(0, 10, 3, 2.5, Math.PI),
      target: region(0, -7, 1.4, 2.75, Math.PI),
    },
    target: target(0, -7, 2.8, 5.5, Math.PI),
    steps: [
      step('approach-space', 'lessonSurveySpace', 'setup',
        [{ kind: 'region', regionId: 'setup' }], 'target'),
      step('stop-and-check', 'lessonStopBeforeReverse', 'setup', [
        { kind: 'stopped', dwellS: 0.5 },
        { kind: 'acknowledgement' },
      ], 'target'),
      step('select-reverse', 'lessonConfirmSurroundings', 'target', [
        { kind: 'gear', gear: 'R' },
        { kind: 'parking-brake', applied: false },
      ], 'target'),
      step('reverse-and-secure', 'lessonReverseIntoBay', 'target', [
        { kind: 'region', regionId: 'target' },
        { kind: 'gear', gear: 'P' },
        { kind: 'parking-brake', applied: true },
      ]),
    ],
    guidance: 'full',
    obstacles: [
      box('stage2-parked-left', [-3.2, 0.8, -7], [0.8, 0.8, 2.2]),
      box('stage2-parked-right', [3.2, 0.8, -7], [0.8, 0.8, 2.2]),
    ],
  },
  3: {
    stageId: 3,
    environmentId: 'roadside',
    titleKey: 'stage3',
    spawnByVehicle: spawns(0, -7.1, 0),
    drivingBounds: roadsideBounds,
    regions: {
      setup: region(0, -7.1, 1.8, 1.8),
      target: region(2.9, 0, 1.25, 3.5),
    },
    target: target(2.9, 0, 2.5, 7, 0, 'roadside-curb-right'),
    steps: [
      step('signal-and-survey', 'lessonSignalRight', 'setup',
        [{ kind: 'indicator', value: 'right' }], 'target'),
      step('set-parallel', 'lessonSetParallel', 'setup', [
        { kind: 'region', regionId: 'setup' },
        { kind: 'stopped', dwellS: 0.5 },
        { kind: 'acknowledgement' },
      ], 'target'),
      step('reverse-into-space', 'lessonReverseParallel', 'target', [
        { kind: 'gear', gear: 'R' },
        { kind: 'parking-brake', applied: false },
      ], 'target'),
      step('align-and-secure', 'lessonCorrectAlignment', 'target', [
        { kind: 'region', regionId: 'target' },
        { kind: 'gear', gear: 'P' },
        { kind: 'parking-brake', applied: true },
      ]),
    ],
    guidance: 'full',
    obstacles: [
      box('stage3-parked-rear', [2.9, 0.8, -10], [0.9, 0.8, 2.3]),
      box('stage3-parked-front', [2.9, 0.8, 10], [0.9, 0.8, 2.3]),
    ],
  },
  4: {
    stageId: 4,
    environmentId: 'garage',
    titleKey: 'stage4',
    spawnByVehicle: spawns(5.4, 9, Math.PI),
    drivingBounds: garageBounds,
    regions: {
      setup: region(5.4, 9, 2.5, 2.5, Math.PI),
      target: region(5.4, -7, 1.3, 2.65, Math.PI),
    },
    target: target(5.4, -7, 2.6, 5.3, Math.PI),
    steps: [
      step('assess-pillars', 'lessonAssessPillars', 'setup',
        [{ kind: 'region', regionId: 'setup' }], 'target'),
      step('stop-and-select-reverse', 'lessonStopBeforeReverse', 'setup', [
        { kind: 'stopped', dwellS: 0.5 },
        { kind: 'gear', gear: 'R' },
        { kind: 'parking-brake', applied: false },
      ], 'target'),
      step('check-clearance', 'lessonPauseAndCheck', 'target', [
        { kind: 'region', regionId: 'target' },
        { kind: 'gear', gear: 'P' },
        { kind: 'parking-brake', applied: true },
      ]),
    ],
    guidance: 'reduced',
    obstacles: [
      box('stage4-adjacent-vehicle', [2.7, 0.8, -7], [0.7, 0.8, 2.1]),
    ],
  },
  5: {
    stageId: 5,
    environmentId: 'roadside',
    titleKey: 'stage5',
    spawnByVehicle: spawns(-1.5, -7.32, 0),
    drivingBounds: roadsideBounds,
    regions: {
      setup: region(-1.5, -7.3, 2, 2),
      target: region(2.9, 1, 1.25, 3.25),
    },
    target: target(2.9, 1, 2.5, 6.5, 0, 'roadside-curb-right'),
    steps: [
      step('recall-sequence', 'lessonRecallApproach', 'setup',
        [{ kind: 'acknowledgement' }], 'target'),
      step('adapt-position', 'lessonAdaptPosition', 'target',
        [{ kind: 'region', regionId: 'setup' }], 'target'),
      step('reverse-and-align', 'lessonReverseAndAlign', 'target', [
        { kind: 'region', regionId: 'target' },
        { kind: 'gear', gear: 'P' },
        { kind: 'parking-brake', applied: true },
      ]),
    ],
    guidance: 'on-request',
    obstacles: [
      box('stage5-parked-rear', [2.9, 0.8, -10], [0.9, 0.8, 2.3]),
      box('stage5-parked-front', [2.9, 0.8, 11], [0.9, 0.8, 2.3]),
    ],
  },
});

export { scenarios };
