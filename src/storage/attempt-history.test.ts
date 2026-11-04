import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import type { AttemptSummary, CompletedAttemptRecord } from '../contracts';
import { createAttemptHistoryStore } from './attempt-history';

const DATABASE = 'park-core.attempt-history';

const summary: AttemptSummary = {
  stageId: 1,
  vehicleId: 'sedan',
  outcome: 'success',
  failureReason: null,
  obstacleId: null,
  elapsedSimulationS: 2,
  closestSampledClearanceM: null,
  peakSpeedMps: 0,
  directionChanges: 0,
  acknowledgedStepIds: [],
  usedAids: [],
};

function createStore(
  factory: IDBFactory | null = new IDBFactory(),
  ids: readonly string[] = ['attempt-1'],
  dates: readonly string[] = ['2026-11-04T10:00:00.000Z'],
) {
  let idIndex = 0;
  let dateIndex = 0;
  return createAttemptHistoryStore(
    factory,
    () => new Date(dates[dateIndex++] ?? dates.at(-1)!),
    () => ids[idIndex++] ?? ids.at(-1)!,
  );
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('attempts', { keyPath: 'id' });
      store.createIndex('completedAt', 'completedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Database open failed'));
  });
}

function readRecords(database: IDBDatabase): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('attempts', 'readonly');
    const request = transaction.objectStore('attempts').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Read failed'));
  });
}

async function seedRecord(factory: IDBFactory, record: unknown): Promise<void> {
  const database = await openDatabase(factory);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('attempts', 'readwrite');
    transaction.objectStore('attempts').put(record);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Seed failed'));
  });
  database.close();
}

afterEach(() => vi.restoreAllMocks());

describe('completed attempt history', () => {
  it('persists independent records and lists them newest first', async () => {
    const factory = new IDBFactory();
    const store = createStore(factory, ['older', 'newer'], [
      '2026-11-04T10:00:00.000Z',
      '2026-11-04T11:00:00.000Z',
    ]);

    const first = await store.append(summary);
    const second = await store.append({ ...summary, stageId: 2 });
    const listed = await store.list();

    expect(first.status).toBe('persistent');
    expect(second.status).toBe('persistent');
    expect(listed.status).toBe('persistent');
    expect(listed.records.map(({ id }) => id)).toEqual(['newer', 'older']);
    expect(listed.records[0]?.summary.stageId).toBe(2);
  });

  it.each([
    ['unknown stage', { ...summary, stageId: 6 }],
    ['non-finite metric', { ...summary, peakSpeedMps: Number.NaN }],
    ['inconsistent success failure', { ...summary, failureReason: 'collision' }],
    ['unknown field', { ...summary, internal: true }],
  ])('rejects a summary with %s', async (_name, invalid) => {
    const store = createStore();

    await expect(store.append(invalid as unknown as AttemptSummary)).rejects.toThrow(RangeError);
    expect((await store.list()).records).toEqual([]);
  });

  it('rejects a generated duplicate ID instead of treating it as storage failure', async () => {
    const store = createStore(new IDBFactory(), ['duplicate', 'duplicate']);
    await store.append(summary);

    await expect(store.append({ ...summary, stageId: 2 }))
      .rejects.toThrow('Duplicate attempt ID');
    expect((await store.list()).status).toBe('persistent');
  });

  it('keeps completed attempts in memory when IndexedDB is unavailable', async () => {
    const store = createStore(null, ['memory-only']);

    const appended = await store.append(summary);
    const listed = await store.list();

    expect(appended.status).toBe('session-only');
    expect(listed.status).toBe('session-only');
    expect(listed.records).toEqual([{
      id: 'memory-only',
      completedAt: '2026-11-04T10:00:00.000Z',
      summary,
    } satisfies CompletedAttemptRecord]);
  });

  it('keeps a recap in memory when opening the history database fails', async () => {
    class OpenFailureFactory extends IDBFactory {
      override open(): IDBOpenDBRequest {
        throw new DOMException('IndexedDB is blocked', 'SecurityError');
      }
    }
    const store = createStore(new OpenFailureFactory(), ['blocked']);

    expect((await store.append(summary)).status).toBe('session-only');
    expect((await store.list()).records.map(({ id }) => id)).toEqual(['blocked']);
  });

  it('keeps a recap in memory when an IndexedDB transaction fails', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => {
      throw new DOMException('Transaction is unavailable', 'InvalidStateError');
    });
    const store = createStore(new IDBFactory(), ['transaction-failure']);

    expect((await store.append(summary)).status).toBe('session-only');
    expect((await store.list()).records.map(({ id }) => id)).toEqual(['transaction-failure']);
  });

  it('keeps a recap in memory after a quota failure and preserves old records', async () => {
    const factory = new IDBFactory();
    const seed = createStore(factory, ['older']);
    await seed.append(summary);
    const append = vi.spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(() => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      });
    const store = createStore(factory, ['newer'], ['2026-11-04T11:00:00.000Z']);

    const result = await store.append({ ...summary, stageId: 2 });
    const listed = await store.list();

    expect(append).toHaveBeenCalledOnce();
    expect(result.status).toBe('session-only');
    expect(listed.status).toBe('session-only');
    expect(listed.records.map(({ id }) => id)).toEqual(['newer', 'older']);
  });

  it('blocks persisted appends when stored records are malformed and requires reset', async () => {
    const factory = new IDBFactory();
    const malformed = {
      id: 'corrupt',
      completedAt: 'not-a-date',
      summary: { ...summary, stageId: 99 },
    };
    await seedRecord(factory, malformed);
    const store = createStore(factory, ['new-memory']);

    expect((await store.list()).status).toBe('reset-required');
    const result = await store.append(summary);
    const records = await store.list();
    const database = await openDatabase(factory);

    expect(result.status).toBe('reset-required');
    expect(records.status).toBe('reset-required');
    expect(records.records.map(({ id }) => id)).toEqual(['new-memory']);
    expect(await readRecords(database)).toEqual([malformed]);
    database.close();
  });

  it('requires reset when an existing database has an unsupported store schema', async () => {
    const factory = new IDBFactory();
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('attempts', { keyPath: 'id' });
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Database open failed'));
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('attempts', 'readwrite');
      transaction.objectStore('attempts').put({
        id: 'existing',
        completedAt: '2026-11-04T10:00:00.000Z',
        summary,
      });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Seed failed'));
    });
    database.close();
    const store = createStore(factory, ['new-memory']);

    expect((await store.list()).status).toBe('reset-required');
    expect((await store.append(summary)).status).toBe('reset-required');
    const unchanged = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DATABASE, 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('Database open failed'));
    });
    expect(unchanged.objectStoreNames.contains('attempts')).toBe(true);
    expect(unchanged.transaction('attempts', 'readonly')
      .objectStore('attempts').indexNames.contains('completedAt')).toBe(false);
    expect(await readRecords(unchanged)).toEqual([{
      id: 'existing',
      completedAt: '2026-11-04T10:00:00.000Z',
      summary,
    }]);
    unchanged.close();
  });

  it('resets only the history database and clears its session-only fallback', async () => {
    const factory = new IDBFactory();
    const otherDatabase = factory.open('park-core.progress.v1', 1);
    otherDatabase.onupgradeneeded = () => {
      otherDatabase.result.createObjectStore('progress');
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      otherDatabase.onsuccess = () => resolve(otherDatabase.result);
      otherDatabase.onerror = () => reject(otherDatabase.error ?? new Error('Open failed'));
    });
    database.close();
    const store = createStore(factory, ['history']);
    await store.append(summary);

    expect(await store.reset()).toBe('persistent');
    expect(await store.list()).toMatchObject({ status: 'persistent', records: [] });
    const reopenedOther = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('park-core.progress.v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Open failed'));
    });
    expect(reopenedOther.objectStoreNames.contains('progress')).toBe(true);
    reopenedOther.close();

    const fallback = createStore(null, ['fallback']);
    await fallback.append(summary);
    expect(await fallback.reset()).toBe('session-only');
    expect(await fallback.list()).toMatchObject({ status: 'session-only', records: [] });
  });

  it('preserves session-only recaps when resetting the database fails', async () => {
    class ResetFailureFactory extends IDBFactory {
      override open(): IDBOpenDBRequest {
        throw new DOMException('IndexedDB is blocked', 'SecurityError');
      }

      override deleteDatabase(): IDBOpenDBRequest {
        throw new DOMException('IndexedDB is blocked', 'InvalidStateError');
      }
    }
    const store = createStore(new ResetFailureFactory(), ['fallback']);
    await store.append(summary);

    expect(await store.reset()).toBe('session-only');
    expect((await store.list()).records.map(({ id }) => id)).toEqual(['fallback']);
  });
});
