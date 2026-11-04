import type { AttemptSummary, CompletedAttemptRecord, FailureReason } from '../contracts';
import type {
  AttemptHistorySnapshot,
  AttemptHistoryStatus,
  AttemptHistoryStore,
} from '../runtime-types';

const DATABASE_NAME = 'park-core.attempt-history';
const DATABASE_VERSION = 1;
const STORE_NAME = 'attempts';
const COMPLETED_AT_INDEX = 'completedAt';
const STAGE_IDS = new Set([1, 2, 3, 4, 5]);
const FAILURE_REASONS = new Set<FailureReason>([
  'collision', 'curb-contact', 'out-of-bounds', 'tipped', 'speed-envelope',
]);
const AIDS = new Set<AttemptSummary['usedAids'][number]>([
  'chase', '360', 'trajectory', 'help',
]);
const SUMMARY_KEYS = [
  'stageId', 'vehicleId', 'outcome', 'failureReason', 'obstacleId',
  'elapsedSimulationS', 'closestSampledClearanceM', 'peakSpeedMps',
  'directionChanges', 'acknowledgedStepIds', 'usedAids',
];
const RECORD_KEYS = ['id', 'completedAt', 'summary'];
const STORAGE_ERROR_NAMES = new Set([
  'AbortError', 'ConstraintError', 'DataError', 'InvalidStateError',
  'NotFoundError', 'QuotaExceededError', 'ReadOnlyError', 'SecurityError',
  'TransactionInactiveError', 'UnknownError', 'VersionError',
  'UnsupportedAttemptHistorySchemaError',
]);

class DuplicateAttemptIdError extends Error {
  constructor(id: string) {
    super(`Duplicate attempt ID: ${id}`);
    this.name = 'DuplicateAttemptIdError';
  }
}

class UnsupportedAttemptHistorySchemaError extends Error {
  constructor() {
    super('Attempt history database has an unsupported schema');
    this.name = 'UnsupportedAttemptHistorySchemaError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum;
}

function isValidStringList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}

function validateSummary(value: unknown): AttemptSummary | null {
  if (!isObject(value) || !hasExactKeys(value, SUMMARY_KEYS)) return null;
  if (!STAGE_IDS.has(value.stageId as number)
    || (value.vehicleId !== 'sedan' && value.vehicleId !== 'cuv')
    || (value.outcome !== 'success' && value.outcome !== 'fail')) return null;
  if (value.failureReason !== null && !FAILURE_REASONS.has(value.failureReason as FailureReason)) {
    return null;
  }
  if ((value.outcome === 'success' && value.failureReason !== null)
    || (value.outcome === 'fail' && value.failureReason === null)) return null;
  if (value.obstacleId !== null && !isNonEmptyString(value.obstacleId)) return null;
  if (!isFiniteAtLeast(value.elapsedSimulationS, 0)
    || (value.closestSampledClearanceM !== null
      && !isFiniteAtLeast(value.closestSampledClearanceM, 0))
    || !isFiniteAtLeast(value.peakSpeedMps, 0)
    || !Number.isInteger(value.directionChanges)
    || !isFiniteAtLeast(value.directionChanges, 0)
    || !isValidStringList(value.acknowledgedStepIds)
    || !Array.isArray(value.usedAids)
    || !value.usedAids.every((aid) => AIDS.has(aid as AttemptSummary['usedAids'][number]))
    || new Set(value.usedAids).size !== value.usedAids.length) return null;

  return {
    stageId: value.stageId as AttemptSummary['stageId'],
    vehicleId: value.vehicleId,
    outcome: value.outcome,
    failureReason: value.failureReason as FailureReason | null,
    obstacleId: value.obstacleId as string | null,
    elapsedSimulationS: value.elapsedSimulationS,
    closestSampledClearanceM: value.closestSampledClearanceM as number | null,
    peakSpeedMps: value.peakSpeedMps,
    directionChanges: value.directionChanges,
    acknowledgedStepIds: [...value.acknowledgedStepIds],
    usedAids: [...value.usedAids] as AttemptSummary['usedAids'],
  };
}

function isIsoUtc(value: unknown): value is string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateRecord(value: unknown): CompletedAttemptRecord | null {
  if (!isObject(value) || !hasExactKeys(value, RECORD_KEYS)
    || !isNonEmptyString(value.id) || !isIsoUtc(value.completedAt)) return null;
  const summary = validateSummary(value.summary);
  return summary ? { id: value.id, completedAt: value.completedAt, summary } : null;
}

function expectedStorageFailure(error: unknown): boolean {
  return isObject(error) && typeof error.name === 'string'
    && STORAGE_ERROR_NAMES.has(error.name);
}

function resetRequiredFailure(error: unknown): boolean {
  return isObject(error) && (
    error.name === 'VersionError'
    || error.name === 'NotFoundError'
    || error.name === 'UnsupportedAttemptHistorySchemaError'
  );
}

function hasSupportedSchema(database: IDBDatabase): boolean {
  if (!database.objectStoreNames.contains(STORE_NAME)) return false;
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    if (store.keyPath !== 'id' || !store.indexNames.contains(COMPLETED_AT_INDEX)) return false;
    return store.index(COMPLETED_AT_INDEX).keyPath === 'completedAt';
  } catch {
    return false;
  }
}

function requestFailure(request: IDBRequest): DOMException {
  return request.error ?? new DOMException('IndexedDB request failed', 'UnknownError');
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(STORE_NAME)) return;
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex(COMPLETED_AT_INDEX, 'completedAt');
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      if (!hasSupportedSchema(request.result)) {
        settled = true;
        request.result.close();
        reject(new UnsupportedAttemptHistorySchemaError());
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(requestFailure(request));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new DOMException('IndexedDB open was blocked', 'InvalidStateError'));
    };
  });
}

function readAll(database: IDBDatabase): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, 'readonly');
    } catch (error) {
      reject(error);
      return;
    }
    let records: unknown[] = [];
    try {
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => { records = request.result; };
      request.onerror = () => reject(requestFailure(request));
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(transaction.error
        ?? new DOMException('IndexedDB read failed', 'UnknownError'));
      transaction.onabort = () => reject(transaction.error
        ?? new DOMException('IndexedDB read aborted', 'AbortError'));
    } catch (error) {
      reject(error);
    }
  });
}

type AppendState = 'written' | 'malformed';

function appendRecord(
  database: IDBDatabase,
  record: CompletedAttemptRecord,
): Promise<AppendState> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }
    let malformed = false;
    let duplicate = false;
    try {
      const store = transaction.objectStore(STORE_NAME);
      const existing = store.getAll();
      existing.onsuccess = () => {
        const values: unknown[] = existing.result;
        if (values.some((value) => isObject(value) && value.id === record.id)) {
          duplicate = true;
          return;
        }
        if (values.some((value) => validateRecord(value) === null)) {
          malformed = true;
          return;
        }
        try {
          const request = store.add(record);
          request.onerror = (event) => {
            if (request.error?.name !== 'ConstraintError') return;
            duplicate = true;
            event.preventDefault();
          };
        } catch (error) {
          reject(error);
        }
      };
      existing.onerror = () => reject(requestFailure(existing));
      transaction.oncomplete = () => {
        if (duplicate) reject(new DuplicateAttemptIdError(record.id));
        else resolve(malformed ? 'malformed' : 'written');
      };
      transaction.onerror = () => {
        if (duplicate) return;
        reject(transaction.error ?? new DOMException('IndexedDB append failed', 'UnknownError'));
      };
      transaction.onabort = () => {
        if (duplicate) reject(new DuplicateAttemptIdError(record.id));
        else reject(transaction.error ?? new DOMException('IndexedDB append aborted', 'AbortError'));
      };
    } catch (error) {
      reject(error);
    }
  });
}

function deleteDatabase(factory: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(DATABASE_NAME);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    request.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(requestFailure(request));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new DOMException('IndexedDB delete was blocked', 'InvalidStateError'));
    };
  });
}

function sorted(records: Iterable<CompletedAttemptRecord>): CompletedAttemptRecord[] {
  return [...records].sort((a, b) =>
    Date.parse(b.completedAt) - Date.parse(a.completedAt) || a.id.localeCompare(b.id));
}

export function createAttemptHistoryStore(
  indexedDB: IDBFactory | null,
  now: () => Date = () => new Date(),
  createId: () => string = () => crypto.randomUUID(),
): AttemptHistoryStore {
  const sessionRecords = new Map<string, CompletedAttemptRecord>();
  let resetRequired = false;

  function remember(record: CompletedAttemptRecord): void {
    if (sessionRecords.has(record.id)) throw new DuplicateAttemptIdError(record.id);
    sessionRecords.set(record.id, record);
  }

  function snapshot(
    persisted: readonly CompletedAttemptRecord[],
    status: AttemptHistoryStatus,
  ): AttemptHistorySnapshot {
    const records = new Map(persisted.map((record) => [record.id, record]));
    for (const record of sessionRecords.values()) records.set(record.id, record);
    return { records: sorted(records.values()), status };
  }

  async function list(): Promise<AttemptHistorySnapshot> {
    if (!indexedDB) return snapshot([], 'session-only');
    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase(indexedDB);
      const rawRecords = await readAll(database);
      const persisted: CompletedAttemptRecord[] = [];
      let malformed = false;
      for (const raw of rawRecords) {
        const record = validateRecord(raw);
        if (!record) malformed = true;
        else persisted.push(record);
      }
      if (malformed) resetRequired = true;
      const status = resetRequired
        ? 'reset-required'
        : sessionRecords.size > 0 ? 'session-only' : 'persistent';
      return snapshot(persisted, status);
    } catch (error) {
      if (!expectedStorageFailure(error)) throw error;
      if (resetRequiredFailure(error)) resetRequired = true;
      return snapshot([], resetRequired ? 'reset-required' : 'session-only');
    } finally {
      database?.close();
    }
  }

  async function append(summary: AttemptSummary) {
    const validSummary = validateSummary(summary);
    if (!validSummary) throw new RangeError('Invalid completed attempt summary');
    const record = validateRecord({
      id: createId(),
      completedAt: now().toISOString(),
      summary: validSummary,
    });
    if (!record) throw new RangeError('Invalid completed attempt record');
    if (sessionRecords.has(record.id)) throw new DuplicateAttemptIdError(record.id);
    if (!indexedDB) {
      remember(record);
      return { record, status: 'session-only' as const };
    }
    if (resetRequired) {
      remember(record);
      return { record, status: 'reset-required' as const };
    }

    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase(indexedDB);
      const result = await appendRecord(database, record);
      if (result === 'malformed') {
        resetRequired = true;
        remember(record);
        return { record, status: 'reset-required' as const };
      }
      sessionRecords.delete(record.id);
      return { record, status: 'persistent' as const };
    } catch (error) {
      if (error instanceof DuplicateAttemptIdError) throw error;
      if (!expectedStorageFailure(error)) throw error;
      if (resetRequiredFailure(error)) resetRequired = true;
      remember(record);
      return {
        record,
        status: resetRequired ? 'reset-required' as const : 'session-only' as const,
      };
    } finally {
      database?.close();
    }
  }

  async function reset(): Promise<AttemptHistoryStatus> {
    if (!indexedDB) {
      sessionRecords.clear();
      return 'session-only';
    }
    const previousResetRequired = resetRequired;
    try {
      await deleteDatabase(indexedDB);
      const database = await openDatabase(indexedDB);
      database.close();
      sessionRecords.clear();
      resetRequired = false;
      return 'persistent';
    } catch (error) {
      if (!expectedStorageFailure(error)) throw error;
      resetRequired = previousResetRequired || resetRequiredFailure(error);
      return 'session-only';
    }
  }

  return { list, append, reset };
}
