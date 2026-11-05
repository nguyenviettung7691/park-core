// @vitest-environment jsdom
import { expect, it } from 'vitest';
import {
  APP_OBSERVATION_EVENT, dispatchAppObservation, type AppObservation,
} from './app-observation';

it('dispatches a named window CustomEvent with detached detail', () => {
  const event: AppObservation = {
    kind: 'outcome', generation: 1, sequence: 2, capturedAtMs: 3,
    summary: {
      stageId: 1, vehicleId: 'sedan', outcome: 'success', failureReason: null, obstacleId: null,
      elapsedSimulationS: 4, closestSampledClearanceM: null, peakSpeedMps: 0.5,
      directionChanges: 0, acknowledgedStepIds: ['a'], usedAids: [],
    },
  };
  const received: AppObservation[] = [];
  const listener = (raw: Event) => {
    received.push((raw as CustomEvent<AppObservation>).detail);
  };
  window.addEventListener(APP_OBSERVATION_EVENT, listener);
  dispatchAppObservation(event);
  window.removeEventListener(APP_OBSERVATION_EVENT, listener);
  expect(APP_OBSERVATION_EVENT).toBe('park-core:observation');
  expect(received).toEqual([event]);
  expect(received[0]).not.toBe(event);
  const detail = received[0] as Extract<AppObservation, { kind: 'outcome' }>;
  expect(detail.summary.acknowledgedStepIds).not.toBe(
    (event as Extract<AppObservation, { kind: 'outcome' }>).summary.acknowledgedStepIds,
  );
});
