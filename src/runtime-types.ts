import type * as THREE from 'three';
import type {
  AppState,
  BodyPose,
  CameraMode,
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

export interface ScreenContext {
  readonly progress: ProgressSaveV1;
  readonly settings: SettingsSaveV1;
  readonly selectedStageId: StageId;
  readonly selectedVehicleId: VehicleId;
}

export type ScreenAction =
  | { readonly type: 'start'; readonly stageId: StageId; readonly vehicleId: VehicleId }
  | { readonly type: 'retry' }
  | { readonly type: 'menu' }
  | { readonly type: 'continue' }
  | { readonly type: 'resume' }
  | { readonly type: 'open-calibration' }
  | { readonly type: 'request-reset-progress' }
  | { readonly type: 'confirm-reset-progress' }
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
}
