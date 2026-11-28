import { describe, expect, it } from 'vitest';
import type { ControllerCalibration, ProgressSaveV1, StageId } from '../contracts';
import type { SettingsSaveV1 } from '../runtime-types';
import { createPersistence, recordStageSuccess, unlockedStages } from './persistence';

const initial: ProgressSaveV1 = {
  version: 1,
  completedStages: [],
  lastVehicle: 'sedan',
};

const initialSettings: SettingsSaveV1 = {
  version: 1,
  volume: 0.5,
  muted: false,
  driverFovDeg: 60,
  cameraMode: 'driver',
  overhead: false,
  trajectory: false,
  inputSource: 'keyboard',
  resolutionScale: 1,
  preset: 'high',
  frameRateCap: 'display',
  antialias: true,
  mirrorQuality: 'high',
  overheadQuality: 'high',
};

const calibration: ControllerCalibration = {
  version: 2,
  deviceId: 'wheel-a',
  steeringAxis: 0,
  steeringLeft: -1,
  steeringCenter: 0,
  steeringRight: 1,
  throttle: { kind: 'button', index: 7, released: 0, pressed: 1 },
  brake: { kind: 'button', index: 6, released: 0, pressed: 1 },
  reverseButton: 4,
  driveButton: 5,
};

const keys = {
  progress: 'park-core.progress.v1',
  settings: 'park-core.settings.v1',
  calibration: 'park-core.calibration.v1',
} as const;

function memoryStorage(entries: readonly (readonly [string, string])[] = []) {
  const data = new Map(entries);
  return {
    data,
    getItem(key: string) { return data.get(key) ?? null; },
    setItem(key: string, value: string) { data.set(key, value); },
    removeItem(key: string) { data.delete(key); },
  };
}

describe('sequential stage progression', () => {
  it.each(['sedan', 'cuv'] as const)('starts with Stage 1 unlocked for %s', (lastVehicle) => {
    expect(unlockedStages({ ...initial, lastVehicle })).toEqual([1]);
  });

  it('unlocks only the contiguous completed prefix', () => {
    expect(unlockedStages({ ...initial, completedStages: [1, 2] })).toEqual([1, 2, 3]);
    expect(unlockedStages({ ...initial, completedStages: [1, 3] })).toEqual([1, 2]);
  });

  it('records only the next unlocked stage and makes repeated success idempotent', () => {
    const skipped = recordStageSuccess(initial, 3);
    expect(skipped.completedStages).toEqual([]);
    const first = recordStageSuccess(initial, 1);
    const second = recordStageSuccess(first, 2);
    const repeated = recordStageSuccess(second, 2);
    expect(second.completedStages).toEqual([1, 2] satisfies readonly StageId[]);
    expect(repeated).toEqual(second);
  });

  it('rejects a stage ID outside the fixed progression', () => {
    expect(() => recordStageSuccess(initial, 6 as StageId)).toThrow(RangeError);
  });
});

describe('versioned persistence', () => {
  it('uses documented defaults for missing records and persists explicit changes', () => {
    const storage = memoryStorage();
    const store = createPersistence(() => storage);
    const changedProgress: ProgressSaveV1 = {
      version: 1, completedStages: [1], lastVehicle: 'cuv',
    };
    const changedSettings = { ...initialSettings, volume: 0.75, cameraMode: 'chase' as const };

    expect(store.snapshot()).toMatchObject({
      progress: initial,
      settings: initialSettings,
      calibrations: [],
      recordStatus: { progress: 'persistent', settings: 'persistent', calibration: 'persistent' },
    });
    expect(store.saveProgress(changedProgress).status).toBe('persistent');
    expect(store.saveSettings(changedSettings).status).toBe('persistent');
    expect(store.saveCalibrations([calibration]).status).toBe('persistent');

    const reopened = createPersistence(() => storage).snapshot();
    expect(reopened.progress).toEqual(changedProgress);
    expect(reopened.settings).toEqual(changedSettings);
    expect(reopened.calibrations).toEqual([calibration]);
  });

  it('round-trips look fields and upgrades stored v1 entries', () => {
    const storage = memoryStorage();
    const look: ControllerCalibration = { ...calibration, lookLeftButton: 8, lookRightButton: 9,
      lookBackButton: 10, recenterButton: 11, lookStick: { xAxis: 2, yAxis: 3 } };
    const store = createPersistence(() => storage);
    store.saveCalibrations([look]);
    expect(JSON.parse(storage.getItem(keys.calibration)!)).toMatchObject({
      version: 1, entries: [{ version: 2 }] });
    const snapshot = createPersistence(() => storage).snapshot();
    expect(snapshot.calibrations).toEqual([look]);
    expect(store.snapshot().calibrations[0]!.lookStick).not.toBe(look.lookStick);

    const legacy = memoryStorage();
    legacy.setItem(keys.calibration, JSON.stringify({ version: 1, entries: [{ ...calibration, version: 1 }] }));
    expect(createPersistence(() => legacy).snapshot().calibrations).toEqual([calibration]);
  });

  it.each([
    ['malformed JSON', 'progress', keys.progress, '{'],
    ['unsupported progress version', 'progress', keys.progress,
      JSON.stringify({ ...initial, version: 2 })],
    ['unknown and duplicate stage IDs', 'progress', keys.progress,
      JSON.stringify({ ...initial, completedStages: [1, 1, 6] })],
    ['non-contiguous completed stages', 'progress', keys.progress,
      JSON.stringify({ ...initial, completedStages: [1, 3] })],
    ['invalid vehicle ID', 'progress', keys.progress,
      JSON.stringify({ ...initial, lastVehicle: 'truck' })],
    ['unsupported settings version', 'settings', keys.settings,
      JSON.stringify({ ...initialSettings, version: 2 })],
    ['invalid settings fields', 'settings', keys.settings,
      JSON.stringify({ ...initialSettings, volume: 2 })],
    ['unsupported calibration version', 'calibration', keys.calibration,
      JSON.stringify({ version: 2, entries: [calibration] })],
    ['invalid calibration entry', 'calibration', keys.calibration,
      JSON.stringify({ version: 1, entries: [{ ...calibration, steeringAxis: 64 }] })],
    ['duplicate calibration devices', 'calibration', keys.calibration,
      JSON.stringify({ version: 1, entries: [calibration, calibration] })],
  ] as const)('preserves %s as reset-required', (_name, record, key, raw) => {
    const storage = memoryStorage([[key, raw]]);
    const snapshot = createPersistence(() => storage).snapshot();

    expect(snapshot.recordStatus[record]).toBe('reset-required');
    expect(storage.getItem(key)).toBe(raw);
  });

  it('does not overwrite a corrupt record when another session save occurs', () => {
    const raw = '{broken progress';
    const storage = memoryStorage([[keys.progress, raw]]);
    const store = createPersistence(() => storage);

    const result = store.saveProgress({ ...initial, completedStages: [1] });

    expect(result.status).toBe('reset-required');
    expect(store.snapshot().progress.completedStages).toEqual([1]);
    expect(storage.getItem(keys.progress)).toBe(raw);
  });

  it('records only confirmed next-stage successes through the progress record', () => {
    const storage = memoryStorage();
    const store = createPersistence(() => storage);

    expect(store.recordConfirmedStageSuccess(2).status).toBe('persistent');
    expect(store.snapshot().progress.completedStages).toEqual([]);
    expect(store.recordConfirmedStageSuccess(1).status).toBe('persistent');
    expect(store.snapshot().progress.completedStages).toEqual([1]);
    expect(JSON.parse(storage.getItem(keys.progress)!).completedStages).toEqual([1]);
  });

  it('resets only the explicitly confirmed record and then permits its writes', () => {
    const progressRaw = '{broken progress';
    const settingsRaw = JSON.stringify(initialSettings);
    const storage = memoryStorage([[keys.progress, progressRaw], [keys.settings, settingsRaw]]);
    const store = createPersistence(() => storage);

    expect(store.resetRecord('progress').status).toBe('persistent');
    expect(storage.getItem(keys.progress)).toBeNull();
    expect(storage.getItem(keys.settings)).toBe(settingsRaw);
    expect(store.snapshot().recordStatus.progress).toBe('persistent');
    expect(store.saveProgress({ ...initial, completedStages: [1] }).status).toBe('persistent');
  });

  it('keeps an in-memory session and reports unavailable storage', () => {
    const store = createPersistence(() => { throw new Error('storage blocked'); });
    const result = store.saveSettings({ ...initialSettings, muted: true });

    expect(store.snapshot().settings.muted).toBe(true);
    expect(result.status).toBe('session-only');
    expect(store.snapshot().recordStatus).toEqual({
      progress: 'session-only', settings: 'session-only', calibration: 'session-only',
    });
  });

  it('keeps a failed write in memory without reporting persistence', () => {
    const storage = {
      ...memoryStorage(),
      setItem() { throw new Error('quota exceeded'); },
    };
    const store = createPersistence(() => storage);
    const settings = { ...initialSettings, muted: true };

    const result = store.saveSettings(settings);

    expect(result.status).toBe('session-only');
    expect(store.snapshot().settings).toEqual(settings);
  });

  it('rejects invalid writes instead of persisting an invalid versioned record', () => {
    const storage = memoryStorage();
    const store = createPersistence(() => storage);

    expect(() => store.saveSettings({ ...initialSettings, driverFovDeg: 90 }))
      .toThrow(RangeError);
    expect(() => store.saveCalibrations([{ ...calibration, steeringAxis: 64 }]))
      .toThrow(RangeError);
    expect(storage.data.size).toBe(0);
  });
});

describe('mirror adjustments in settings', () => {
  it('round-trips mirror adjustments per vehicle', () => {
    const storage = memoryStorage();
    const store = createPersistence(() => storage);
    const mirrorAdjustments = {
      sedan: { rear: { yawDeg: 1, pitchDeg: -2 }, left: { yawDeg: -4, pitchDeg: 0 },
        right: { yawDeg: 0, pitchDeg: 3 } },
    };
    expect(store.saveSettings({ ...initialSettings, mirrorAdjustments }).status).toBe('persistent');
    expect(createPersistence(() => storage).snapshot().settings.mirrorAdjustments)
      .toEqual(mirrorAdjustments);
  });

  it('loads older saves without mirror adjustments unchanged', () => {
    const storage = memoryStorage([[keys.settings, JSON.stringify(initialSettings)]]);
    const snapshot = createPersistence(() => storage).snapshot();
    expect(snapshot.recordStatus.settings).toBe('persistent');
    expect(snapshot.settings).toEqual(initialSettings);
    expect(snapshot.settings.mirrorAdjustments).toBeUndefined();
  });

  it('clamps or zeroes malformed entries without rejecting the record', () => {
    const raw = { ...initialSettings, volume: 0.3, mirrorAdjustments: {
      sedan: { rear: { yawDeg: 'x', pitchDeg: 90 }, left: { yawDeg: -40, pitchDeg: null },
        right: 7 },
      truck: { rear: { yawDeg: 1, pitchDeg: 1 } },
      cuv: 'broken',
    } };
    const storage = memoryStorage([[keys.settings, JSON.stringify(raw)]]);
    const snapshot = createPersistence(() => storage).snapshot();
    expect(snapshot.recordStatus.settings).toBe('persistent');
    expect(snapshot.settings.volume).toBe(0.3);
    expect(snapshot.settings.mirrorAdjustments).toEqual({
      sedan: { rear: { yawDeg: 0, pitchDeg: 12 }, left: { yawDeg: -12, pitchDeg: 0 },
        right: { yawDeg: 0, pitchDeg: 0 } },
    });
  });
});

describe('seat positions in settings', () => {
  it('round-trips seat positions per vehicle', () => {
    const storage = memoryStorage();
    const store = createPersistence(() => storage);
    const seatPositions = { sedan: { foreAftCm: 4, heightCm: -2 }, cuv: { foreAftCm: -10, heightCm: 5 } };
    expect(store.saveSettings({ ...initialSettings, seatPositions }).status).toBe('persistent');
    expect(createPersistence(() => storage).snapshot().settings.seatPositions).toEqual(seatPositions);
  });

  it('loads older saves without seat positions unchanged', () => {
    const storage = memoryStorage([[keys.settings, JSON.stringify(initialSettings)]]);
    const snapshot = createPersistence(() => storage).snapshot();
    expect(snapshot.settings).toEqual(initialSettings);
    expect(snapshot.settings.seatPositions).toBeUndefined();
  });

  it('keeps the rest of the settings when seatPositions is malformed', () => {
    for (const bad of ['broken', 7, [1], { sedan: 'x', truck: { foreAftCm: 1, heightCm: 1 } }]) {
      const raw = { ...initialSettings, volume: 0.3, seatPositions: bad };
      const storage = memoryStorage([[keys.settings, JSON.stringify(raw)]]);
      const snapshot = createPersistence(() => storage).snapshot();
      expect(snapshot.recordStatus.settings).toBe('persistent');
      expect(snapshot.settings.volume).toBe(0.3);
      expect(snapshot.settings.seatPositions).toBeUndefined();
    }
  });

  it('clamps and rounds out-of-range entries', () => {
    const raw = { ...initialSettings, seatPositions: { sedan: { foreAftCm: 99, heightCm: -99 },
      cuv: { foreAftCm: 'x', heightCm: 2.4 } } };
    const storage = memoryStorage([[keys.settings, JSON.stringify(raw)]]);
    expect(createPersistence(() => storage).snapshot().settings.seatPositions).toEqual({
      sedan: { foreAftCm: 10, heightCm: -3 }, cuv: { foreAftCm: 0, heightCm: 2 },
    });
  });
});
