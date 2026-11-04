import type * as THREE from 'three';
import type {
  AppState,
  AttemptSummary,
  BodyPose,
  CameraMode,
  ControllerCalibration,
  CompletedAttemptRecord,
  InputAction,
  InputFrame,
  InputSource,
  MessageKey,
  StageId,
  Vec3Data,
  VehicleId,
  VehicleTelemetry,
  ProgressSaveV1,
} from './contracts';

export interface PhysicsSnapshot {
  readonly telemetry: VehicleTelemetry;
  readonly wheelPoses: readonly [BodyPose, BodyPose, BodyPose, BodyPose];
}

export interface RenderFrame {
  readonly previous: PhysicsSnapshot;
  readonly current: PhysicsSnapshot;
  readonly alpha: number;
}

export interface ColliderBox {
  readonly id: string;
  readonly kind: 'ground' | 'obstacle' | 'curb';
  readonly centerM: Vec3Data;
  readonly halfExtentsM: Vec3Data;
  readonly yawRad: number;
}

export interface AssetLoadProgress {
  readonly resource: 'vehicle' | 'environment';
  readonly loadedBytes: number;
  readonly totalBytes: number | null;
}

export const MIRROR_EXCLUDED_LAYER = 1;
export const OVERHEAD_EXCLUDED_LAYER = 2;

export interface VehicleAnchors {
  readonly driverEyeLocalM: Vec3Data;
  readonly mirrors: Readonly<Record<'rear' | 'left' | 'right', BodyPose>>;
}

export interface SceneAssets {
  readonly environment: THREE.Group;
  readonly vehicle: THREE.Group;
  readonly wheelNodes: readonly [
    THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D
  ];
  readonly anchors: VehicleAnchors;
  dispose(): void;
}

export interface ControlNotice {
  readonly messageKey: MessageKey;
}

export interface InputPoll {
  readonly frame: InputFrame;
  readonly actions: readonly InputAction[];
  readonly issue: MessageKey | null;
}

export interface SettingsSaveV1 {
  readonly version: 1;
  readonly volume: number;
  readonly muted: boolean;
  readonly driverFovDeg: number;
  readonly cameraMode: CameraMode;
  readonly overhead: boolean;
  readonly trajectory: boolean;
  readonly inputSource: InputSource;
  readonly resolutionScale: 1 | 0.75 | 0.5;
}

export type PersistenceRecord = 'progress' | 'settings' | 'calibration';
export type RecordStatus = 'persistent' | 'session-only' | 'reset-required';

export interface PersistenceSnapshot {
  readonly progress: ProgressSaveV1;
  readonly settings: SettingsSaveV1;
  readonly calibrations: readonly ControllerCalibration[];
  readonly recordStatus: Readonly<Record<PersistenceRecord, RecordStatus>>;
}

export interface PersistenceResult {
  readonly record: PersistenceRecord;
  readonly status: RecordStatus;
}

export type AttemptHistoryStatus =
  | 'saving' | 'persistent' | 'session-only' | 'reset-required';

export interface AttemptHistorySnapshot {
  readonly records: readonly CompletedAttemptRecord[];
  readonly status: AttemptHistoryStatus;
}

export interface AttemptHistoryStore {
  list(): Promise<AttemptHistorySnapshot>;
  append(summary: AttemptSummary): Promise<{
    readonly record: CompletedAttemptRecord;
    readonly status: AttemptHistoryStatus;
  }>;
  reset(): Promise<AttemptHistoryStatus>;
}

export interface ScreenContext {
  readonly progress: ProgressSaveV1;
  readonly settings: SettingsSaveV1;
  readonly selectedStageId: StageId;
  readonly selectedVehicleId: VehicleId;
  readonly unlockedStageIds: readonly StageId[];
  readonly recordStatus: Readonly<Record<PersistenceRecord, RecordStatus>>;
  readonly resetRequested: PersistenceRecord | null;
}

export type ScreenAction =
  | { readonly type: 'start'; readonly stageId: StageId; readonly vehicleId: VehicleId }
  | { readonly type: 'select-stage'; readonly stageId: StageId }
  | { readonly type: 'verify-saved-calibration' }
  | { readonly type: 'request-reset'; readonly record: PersistenceRecord }
  | { readonly type: 'confirm-reset'; readonly record: PersistenceRecord }
  | { readonly type: 'cancel-reset' }
  | { readonly type: 'retry' }
  | { readonly type: 'menu' }
  | { readonly type: 'continue' }
  | { readonly type: 'resume' }
  | { readonly type: 'open-calibration' }
  | { readonly type: 'select-input'; readonly source: InputSource;
      readonly gamepadIndex: number | null }
  | { readonly type: 'update-settings'; readonly settings: SettingsSaveV1 }
  | { readonly type: 'recenter-view' }
  | { readonly type: 'open-preview' }
  | { readonly type: 'close-preview' }
  | { readonly type: 'pause' }
  | { readonly type: 'reset-preview' }
  | { readonly type: 'input-action'; readonly action: InputAction }
  | { readonly type: 'select-vehicle'; readonly vehicleId: VehicleId };

export type PreviewPhase = 'closed' | 'running' | 'paused';
export type PreviewPauseReason = 'user' | 'focus' | 'controller' | 'contact';

export interface ShellView {
  readonly state: AppState;
  readonly preview: PreviewPhase;
  readonly calibrating?: boolean;
  readonly pauseReason?: PreviewPauseReason | null;
  readonly assetLoadProgress?: AssetLoadProgress | null;
}
