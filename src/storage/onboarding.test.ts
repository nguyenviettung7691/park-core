import { expect, it } from 'vitest';
import { createOnboarding } from './onboarding';
import type { StoragePort } from './persistence';

const key = 'park-core.onboarding.v1';
function memory(seed?: string) {
  const data = new Map([
    ['park-core.progress.v1', 'progress'],
    ['park-core.settings.v1', 'settings'],
    ['park-core.calibration.v1', 'calibration'],
  ]);
  if (seed !== undefined) data.set(key, seed);
  const storage: StoragePort = {
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => { data.set(name, value); },
    removeItem: (name) => { data.delete(name); },
  };
  return { data, storage };
}

it('remembers explicit dismissal across visits and resets only its own record', () => {
  const { data, storage } = memory();
  const before = [...data];
  const store = createOnboarding(() => storage);
  expect(store.snapshot()).toEqual({ dismissed: false, status: 'persistent' });
  expect(store.dismiss()).toEqual({ dismissed: true, status: 'persistent' });
  expect(createOnboarding(() => storage).snapshot().dismissed).toBe(true);
  expect(store.reset()).toEqual({ dismissed: false, status: 'persistent' });
  expect([...data]).toEqual(before);
});

it.each(['{', '{"version":2,"dismissed":true}', '{"version":1,"dismissed":"yes"}'])(
  'retains unreadable onboarding until explicit reset: %s', (seed) => {
    const { data, storage } = memory(seed);
    const store = createOnboarding(() => storage);
    expect(store.snapshot()).toEqual({ dismissed: false, status: 'reset-required' });
    expect(store.dismiss()).toEqual({ dismissed: true, status: 'reset-required' });
    expect(data.get(key)).toBe(seed);
    expect(store.reset()).toEqual({ dismissed: false, status: 'persistent' });
    expect(data.has(key)).toBe(false);
  },
);

it.each(['missing', 'getter', 'read', 'write'] as const)(
  'keeps dismissal in session when storage is unavailable: %s', (failure) => {
    const { storage } = memory();
    const denied = () => { throw new Error('denied'); };
    if (failure === 'read') storage.getItem = denied;
    if (failure === 'write') storage.setItem = denied;
    const store = createOnboarding(failure === 'missing' ? () => null :
      failure === 'getter' ? denied : () => storage);
    expect(store.dismiss()).toEqual({ dismissed: true, status: 'session-only' });
    expect(store.snapshot().dismissed).toBe(true);
  },
);

it.each([undefined, '{'])('reports failed removal without claiming a persistent reset', (seed) => {
  const { storage } = memory(seed);
  storage.removeItem = () => { throw new Error('denied'); };
  const store = createOnboarding(() => storage);
  expect(store.reset().status).toBe(seed === undefined ? 'session-only' : 'reset-required');
});
