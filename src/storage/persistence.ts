import type {
  ControllerCalibration, ProgressSaveV1, StageId, VehicleId,
} from '../contracts';
import { validateCalibration } from '../input/calibration';
import type {
  PersistenceRecord, PersistenceResult, PersistenceSnapshot, RecordStatus, SettingsSaveV1,
} from '../runtime-types';

const STAGE_IDS: readonly StageId[] = [1, 2, 3, 4, 5];
const RECORDS: readonly PersistenceRecord[] = ['progress', 'settings', 'calibration'];
const KEYS: Readonly<Record<PersistenceRecord, string>> = {
  progress: 'park-core.progress.v1',
  settings: 'park-core.settings.v1',
  calibration: 'park-core.calibration.v1',
};
const DEFAULT_PROGRESS: ProgressSaveV1 = {
  version: 1, completedStages: [], lastVehicle: 'sedan',
};
const DEFAULT_SETTINGS: SettingsSaveV1 = {
  version: 1,
  volume: 0.5,
  muted: false,
  driverFovDeg: 60,
  cameraMode: 'driver',
  overhead: false,
  trajectory: false,
  inputSource: 'keyboard',
  resolutionScale: 1,
};

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistenceStore {
  snapshot(): PersistenceSnapshot;
  saveProgress(value: ProgressSaveV1): PersistenceResult;
  saveSettings(value: SettingsSaveV1): PersistenceResult;
  saveCalibrations(value: readonly ControllerCalibration[]): PersistenceResult;
  recordConfirmedStageSuccess(stageId: StageId): PersistenceResult;
  resetRecord(record: PersistenceRecord): PersistenceResult;
}

function isStageId(value: unknown): value is StageId {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVehicleId(value: unknown): value is VehicleId {
  return value === 'sedan' || value === 'cuv';
}

function validateProgress(value: unknown): ProgressSaveV1 | null {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.completedStages) ||
      !value.completedStages.every(isStageId) || !isVehicleId(value.lastVehicle)) return null;
  if (new Set(value.completedStages).size !== value.completedStages.length) return null;
  if (value.completedStages.some((stageId, index) => stageId !== index + 1)) return null;
  return {
    version: 1,
    completedStages: [...value.completedStages],
    lastVehicle: value.lastVehicle,
  };
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validateSettings(value: unknown): SettingsSaveV1 | null {
  if (!isObject(value) || value.version !== 1 ||
      !isFiniteInRange(value.volume, 0, 1) ||
      typeof value.muted !== 'boolean' ||
      typeof value.driverFovDeg !== 'number' || !Number.isInteger(value.driverFovDeg) ||
      value.driverFovDeg < 50 || value.driverFovDeg > 80 ||
      (value.cameraMode !== 'driver' && value.cameraMode !== 'chase') ||
      typeof value.overhead !== 'boolean' || typeof value.trajectory !== 'boolean' ||
      (value.inputSource !== 'keyboard' && value.inputSource !== 'gamepad') ||
      (value.resolutionScale !== 1 && value.resolutionScale !== 0.75 &&
        value.resolutionScale !== 0.5)) return null;
  return {
    version: 1,
    volume: value.volume,
    muted: value.muted,
    driverFovDeg: value.driverFovDeg,
    cameraMode: value.cameraMode,
    overhead: value.overhead,
    trajectory: value.trajectory,
    inputSource: value.inputSource,
    resolutionScale: value.resolutionScale,
  };
}

function validateCalibrations(value: unknown): readonly ControllerCalibration[] | null {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.entries)) return null;
  const entries: ControllerCalibration[] = [];
  const deviceIds = new Set<string>();
  for (const candidate of value.entries) {
    const calibration = validateCalibration(candidate);
    if (!calibration || deviceIds.has(calibration.deviceId)) return null;
    deviceIds.add(calibration.deviceId);
    entries.push(calibration);
  }
  return entries;
}

function isPersistenceRecord(value: unknown): value is PersistenceRecord {
  return value === 'progress' || value === 'settings' || value === 'calibration';
}

function copyCalibration(value: ControllerCalibration): ControllerCalibration {
  return { ...value, throttle: { ...value.throttle }, brake: { ...value.brake } };
}

export function unlockedStages(progress: ProgressSaveV1): readonly StageId[] {
  const completed = new Set(progress.completedStages);
  let count = 1;
  for (const stageId of STAGE_IDS.slice(0, -1)) {
    if (!completed.has(stageId)) break;
    count++;
  }
  return STAGE_IDS.slice(0, count);
}

export function recordStageSuccess(
  progress: ProgressSaveV1, stageId: StageId,
): ProgressSaveV1 {
  if (!isStageId(stageId)) throw new RangeError(`Unknown stage ID: ${stageId}`);
  if (!unlockedStages(progress).includes(stageId) || progress.completedStages.includes(stageId)) {
    return progress;
  }
  return {
    ...progress,
    completedStages: [...progress.completedStages, stageId].sort((a, b) => a - b),
  };
}

export function createPersistence(getStorage: () => StoragePort | null): PersistenceStore {
  let storage: StoragePort | null = null;
  try {
    storage = getStorage();
  } catch {
    storage = null;
  }
  let progress: ProgressSaveV1 = { ...DEFAULT_PROGRESS };
  let settings = { ...DEFAULT_SETTINGS };
  let calibrations: readonly ControllerCalibration[] = [];
  const recordStatus: Record<PersistenceRecord, RecordStatus> = {
    progress: storage ? 'persistent' : 'session-only',
    settings: storage ? 'persistent' : 'session-only',
    calibration: storage ? 'persistent' : 'session-only',
  };

  function markUnavailable() {
    for (const record of RECORDS) {
      if (recordStatus[record] !== 'reset-required') recordStatus[record] = 'session-only';
    }
  }

  function read(record: PersistenceRecord) {
    if (!storage) return;
    let raw: string | null;
    try {
      raw = storage.getItem(KEYS[record]);
    } catch {
      storage = null;
      markUnavailable();
      return;
    }
    if (raw === null) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      recordStatus[record] = 'reset-required';
      return;
    }
    if (record === 'progress') {
      const value = validateProgress(parsed);
      if (value) progress = value;
      else recordStatus[record] = 'reset-required';
    } else if (record === 'settings') {
      const value = validateSettings(parsed);
      if (value) settings = value;
      else recordStatus[record] = 'reset-required';
    } else {
      const value = validateCalibrations(parsed);
      if (value) calibrations = value;
      else recordStatus[record] = 'reset-required';
    }
  }

  for (const record of RECORDS) read(record);

  function result(record: PersistenceRecord): PersistenceResult {
    return { record, status: recordStatus[record] };
  }

  function save<T>(
    record: PersistenceRecord, value: T, json: string, updateMemory: (value: T) => void,
  ): PersistenceResult {
    updateMemory(value);
    if (recordStatus[record] === 'reset-required') return result(record);
    if (!storage) {
      recordStatus[record] = 'session-only';
      return result(record);
    }
    try {
      storage.setItem(KEYS[record], json);
      recordStatus[record] = 'persistent';
    } catch {
      recordStatus[record] = 'session-only';
    }
    return result(record);
  }

  function saveProgress(value: ProgressSaveV1): PersistenceResult {
    const valid = validateProgress(value);
    if (!valid) throw new RangeError('Invalid progress record');
    return save('progress', valid, JSON.stringify(valid), (next) => { progress = next; });
  }

  function saveSettings(value: SettingsSaveV1): PersistenceResult {
    const valid = validateSettings(value);
    if (!valid) throw new RangeError('Invalid settings record');
    return save('settings', valid, JSON.stringify(valid), (next) => { settings = next; });
  }

  function saveCalibrations(value: readonly ControllerCalibration[]): PersistenceResult {
    const valid = validateCalibrations({ version: 1, entries: value });
    if (!valid) throw new RangeError('Invalid calibration record');
    return save('calibration', valid, JSON.stringify({ version: 1, entries: valid }),
      (next) => { calibrations = next; });
  }

  function resetRecord(record: PersistenceRecord): PersistenceResult {
    if (!isPersistenceRecord(record)) throw new RangeError(`Unknown persistence record: ${record}`);
    const previousStatus = recordStatus[record];
    if (storage) {
      try {
        storage.removeItem(KEYS[record]);
      } catch {
        if (previousStatus !== 'reset-required') recordStatus[record] = 'session-only';
        return result(record);
      }
    }
    if (record === 'progress') progress = { ...DEFAULT_PROGRESS };
    else if (record === 'settings') settings = { ...DEFAULT_SETTINGS };
    else calibrations = [];
    recordStatus[record] = storage
      ? 'persistent' : previousStatus === 'reset-required' ? 'reset-required' : 'session-only';
    return result(record);
  }

  return {
    snapshot() {
      return {
        progress: { ...progress, completedStages: [...progress.completedStages] },
        settings: { ...settings },
        calibrations: calibrations.map(copyCalibration),
        recordStatus: { ...recordStatus },
      };
    },
    saveProgress,
    saveSettings,
    saveCalibrations,
    recordConfirmedStageSuccess(stageId) {
      const next = recordStageSuccess(progress, stageId);
      return next === progress
        ? result('progress')
        : saveProgress(next);
    },
    resetRecord,
  };
}
