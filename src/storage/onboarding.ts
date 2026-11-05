import type { OnboardingSnapshot, OnboardingStore, RecordStatus } from '../runtime-types';
import type { StoragePort } from './persistence';

const KEY = 'park-core.onboarding.v1';

export function createOnboarding(getStorage: () => StoragePort | null): OnboardingStore {
  let storage: StoragePort | null = null;
  let dismissed = false;
  let status: RecordStatus = 'persistent';
  try {
    storage = getStorage();
    if (!storage) status = 'session-only';
    const raw = storage?.getItem(KEY);
    if (raw !== null && raw !== undefined) {
      let value: unknown;
      try { value = JSON.parse(raw); }
      catch { status = 'reset-required'; }
      if (value && typeof value === 'object' && 'version' in value &&
          value.version === 1 && 'dismissed' in value && value.dismissed === true) {
        dismissed = true;
      } else status = 'reset-required';
    }
  } catch {
    storage = null;
    status = 'session-only';
  }
  const snapshot = (): OnboardingSnapshot => ({ dismissed, status });
  return {
    snapshot,
    dismiss() {
      dismissed = true;
      if (status === 'reset-required') return snapshot();
      try {
        if (storage) {
          storage.setItem(KEY, JSON.stringify({ version: 1, dismissed: true }));
          status = 'persistent';
        } else status = 'session-only';
      } catch { status = 'session-only'; }
      return snapshot();
    },
    reset() {
      dismissed = false;
      try {
        if (storage) {
          storage.removeItem(KEY);
          status = 'persistent';
        } else status = 'session-only';
      } catch {
        if (status !== 'reset-required') status = 'session-only';
      }
      return snapshot();
    },
  };
}
