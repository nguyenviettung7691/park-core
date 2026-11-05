import type { AttemptSummary, LessonRuntime, StageId, VehicleId, VehicleTelemetry } from './contracts';
import type { PreviewPauseReason } from './runtime-types';

export const APP_OBSERVATION_EVENT = 'park-core:observation';

interface ObservationBase {
  readonly generation: number;
  readonly sequence: number;
  readonly capturedAtMs: number;
}

export type AppObservation = ObservationBase & (
  | { readonly kind: 'session'; readonly stageId: StageId | null; readonly vehicleId: VehicleId }
  | { readonly kind: 'telemetry'; readonly telemetry: VehicleTelemetry }
  | { readonly kind: 'lesson'; readonly lesson: LessonRuntime }
  | { readonly kind: 'outcome'; readonly summary: AttemptSummary }
  | { readonly kind: 'paused'; readonly reason: PreviewPauseReason }
  | { readonly kind: 'resumed' }
  | { readonly kind: 'closed' }
);

export type AppObservationPayload = AppObservation extends infer T
  ? T extends AppObservation ? Omit<T, keyof ObservationBase> : never : never;

export function dispatchAppObservation(event: AppObservation): void {
  window.dispatchEvent(new CustomEvent<AppObservation>(APP_OBSERVATION_EVENT, {
    detail: structuredClone(event),
  }));
}
