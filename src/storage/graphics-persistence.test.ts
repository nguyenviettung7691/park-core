import { describe, expect, it } from 'vitest';
import { createPersistence, type StoragePort } from './persistence';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: StoragePort = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  return { storage, values };
}

describe('persisted graphics settings', () => {
  it('preserves the prior render scale and defaults new controls when loading a legacy v1 record', () => {
    const { storage } = createMemoryStorage({
      'park-core.settings.v1': JSON.stringify({
        version: 1,
        volume: 0.5,
        muted: false,
        driverFovDeg: 60,
        cameraMode: 'driver',
        overhead: false,
        trajectory: false,
        inputSource: 'keyboard',
        resolutionScale: 0.75,
      }),
    });

    const settings = createPersistence(() => storage).snapshot().settings;

    expect(settings).toMatchObject({
      version: 1,
      resolutionScale: 0.75,
      preset: 'custom',
      frameRateCap: 'display',
      antialias: true,
      mirrorQuality: 'high',
      overheadQuality: 'high',
    });
  });

  it('round-trips the new graphics choices through the existing settings record', () => {
    const { storage, values } = createMemoryStorage();
    const persistence = createPersistence(() => storage);
    const settings = {
      ...persistence.snapshot().settings,
      resolutionScale: 0.5,
      preset: 'custom',
      frameRateCap: 120,
      antialias: false,
      mirrorQuality: 'low',
      overheadQuality: 'low',
    } as const;

    persistence.saveSettings(settings);

    expect(JSON.parse(values.get('park-core.settings.v1')!)).toMatchObject({
      resolutionScale: 0.5,
      preset: 'custom',
      frameRateCap: 120,
      antialias: false,
      mirrorQuality: 'low',
      overheadQuality: 'low',
    });
  });
});
