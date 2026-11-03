import type { vi } from './messages';

export type VehicleId = 'sedan' | 'cuv';
export type EnvironmentId = 'roadside' | 'garage';
export type StageId = 1 | 2 | 3 | 4 | 5;
export type Gear = 'P' | 'R' | 'N' | 'D';
export type CameraMode = 'driver' | 'chase';
export type InputSource = 'keyboard' | 'gamepad';
export type Indicator = 'off' | 'left' | 'right';
export type SensorBand = 'clear' | 'green' | 'yellow' | 'red' | 'stop';
export type MessageKey = keyof typeof vi;
export type Vec3Data = readonly [number, number, number];
export type QuatData = readonly [number, number, number, number];
export type WheelValues = readonly [number, number, number, number];

export interface BodyPose {
  readonly positionM: Vec3Data;
  readonly rotation: QuatData;
}

export interface SpawnPose {
  readonly positionM: Vec3Data;
  readonly yawRad: number;
}

export interface InputFrame {
  readonly source: InputSource;
  readonly steering: number;
  readonly throttle: number;
  readonly brake: number;
}

export type InputAction =
  | { readonly type: 'request-gear'; readonly gear: Gear }
  | { readonly type: 'toggle-parking-brake' }
  | { readonly type: 'set-indicator'; readonly indicator: Indicator }
  | { readonly type: 'set-camera'; readonly mode: CameraMode }
  | { readonly type: 'toggle-360' }
  | { readonly type: 'recenter-view' }
  | { readonly type: 'acknowledge-step' }
  | { readonly type: 'help' }
  | { readonly type: 'pause' };

export interface VehicleProfile {
  readonly id: VehicleId;
  readonly massKg: number;
  readonly bodySizeM: Vec3Data;
  readonly mirrorWidthM: number;
  readonly wheelbaseM: number;
  readonly trackM: number;
  readonly frontOverhangM: number;
  readonly rearOverhangM: number;
  readonly frontWeightFraction: number;
  readonly groundClearanceM: number;
  readonly centerOfMassHeightM: number;
  readonly tireRadiusM: number;
  readonly driverEyeLocalM: Vec3Data;
  readonly steeringWheelLockRad: number;
  readonly steeringRatio: number;
  readonly suspensionRestLengthM: number;
  readonly suspensionTravelM: number;
  readonly suspensionStiffness: WheelValues;
  readonly dampingCompression: number;
  readonly dampingRelaxation: number;
  readonly maxSuspensionForceN: number;
  readonly frictionSlip: number;
  readonly rollInfluence: number;
  readonly chassisFriction: number;
  readonly rollingResistance: number;
  readonly linearDamping: number;
  readonly angularDamping: number;
  readonly maxDriveForceN: number;
  readonly creepForwardMps: number;
  readonly creepReverseMps: number;
}

export interface VehicleTelemetry {
  readonly simulationTimeS: number;
  readonly vehicleId: VehicleId;
  readonly pose: BodyPose;
  readonly headingRad: number;
  readonly signedSpeedMps: number;
  readonly totalSpeedMps: number;
  readonly angularSpeedRadps: number;
  readonly steeringWheelRad: number;
  readonly frontWheelAnglesRad: readonly [number, number];
  readonly gear: Gear;
  readonly parkingBrake: boolean;
  readonly indicator: Indicator;
  readonly brake: number;
}

export type SensorId =
  | 'front-left-outer' | 'front-left' | 'front-center'
  | 'front-right' | 'front-right-outer'
  | 'rear-left-outer' | 'rear-left' | 'rear-center'
  | 'rear-right' | 'rear-right-outer';

export interface SensorReading {
  readonly id: SensorId;
  readonly distanceM: number | null;
  readonly obstacleId: string | null;
  readonly band: SensorBand;
}

export interface SensorSnapshot {
  readonly sampledAtS: number;
  readonly readings: readonly SensorReading[];
}

export interface OrientedRegion {
  readonly centerM: Vec3Data;
  readonly halfWidthM: number;
  readonly halfLengthM: number;
  readonly headingRad: number;
}

export type Checkpoint =
  | { readonly kind: 'region'; readonly regionId: string }
  | { readonly kind: 'heading'; readonly targetRad: number;
      readonly toleranceRad: number }
  | { readonly kind: 'stopped'; readonly dwellS: number }
  | { readonly kind: 'gear'; readonly gear: Gear }
  | { readonly kind: 'parking-brake'; readonly applied: boolean }
  | { readonly kind: 'indicator'; readonly value: Indicator }
  | { readonly kind: 'acknowledgement' };

export interface LessonStep {
  readonly id: string;
  readonly instructionKey: MessageKey;
  readonly highlightId: string | null;
  readonly required: readonly Checkpoint[];
  readonly alternativeRegionId: string | null;
}

export interface ParkingTarget {
  readonly region: OrientedRegion;
  readonly insetM: number;
  readonly headingToleranceRad: number;
  readonly stationaryDwellS: number;
  readonly curbId: string | null;
  readonly curbGapRangeM: readonly [number, number] | null;
}

export interface ScenarioDefinition {
  readonly stageId: StageId;
  readonly environmentId: EnvironmentId;
  readonly titleKey: MessageKey;
  readonly spawnByVehicle: Readonly<Record<VehicleId, SpawnPose>>;
  readonly drivingBounds: OrientedRegion;
  readonly regions: Readonly<Record<string, OrientedRegion>>;
  readonly target: ParkingTarget;
  readonly steps: readonly LessonStep[];
  readonly guidance: 'full' | 'reduced' | 'on-request';
}

export type FailureReason = 'collision' | 'curb-contact' | 'out-of-bounds'
  | 'tipped' | 'speed-envelope';

export interface AttemptSummary {
  readonly stageId: StageId;
  readonly vehicleId: VehicleId;
  readonly outcome: 'success' | 'fail';
  readonly failureReason: FailureReason | null;
  readonly obstacleId: string | null;
  readonly elapsedSimulationS: number;
  readonly closestSampledClearanceM: number | null;
  readonly peakSpeedMps: number;
  readonly directionChanges: number;
  readonly acknowledgedStepIds: readonly string[];
  readonly usedAids: readonly ('chase' | '360' | 'trajectory' | 'help')[];
}

export interface LessonRuntime {
  readonly stageId: StageId;
  readonly stepIndex: number;
  readonly parkingDwellS: number;
  readonly acknowledgedStepIds: readonly string[];
}

export interface ProgressSaveV1 {
  readonly version: 1;
  readonly completedStages: readonly StageId[];
  readonly lastVehicle: VehicleId;
}

export interface PedalBinding {
  readonly kind: 'axis' | 'button';
  readonly index: number;
  readonly released: number;
  readonly pressed: number;
}

export interface ControllerCalibration {
  readonly version: 1;
  readonly deviceId: string;
  readonly steeringAxis: number;
  readonly steeringLeft: number;
  readonly steeringCenter: number;
  readonly steeringRight: number;
  readonly throttle: PedalBinding;
  readonly brake: PedalBinding;
  readonly reverseButton: number;
  readonly driveButton: number;
}

export type AppState =
  | { readonly kind: 'menu' }
  | { readonly kind: 'loading'; readonly stageId: StageId }
  | { readonly kind: 'briefing'; readonly stageId: StageId }
  | { readonly kind: 'playing'; readonly lesson: LessonRuntime }
  | { readonly kind: 'paused'; readonly lesson: LessonRuntime;
      readonly reason: 'user' | 'focus' | 'controller' | 'input-source' }
  | { readonly kind: 'success'; readonly summary: AttemptSummary }
  | { readonly kind: 'fail'; readonly summary: AttemptSummary }
  | { readonly kind: 'error'; readonly messageKey: MessageKey;
      readonly retryable: boolean };
