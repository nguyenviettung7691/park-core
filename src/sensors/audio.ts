import type { SensorBand, SensorSnapshot } from '../contracts';
import { selectMostSevereWarning } from './warnings';

const TONE_GAIN = 0.15;
const TONE_INTERVAL_S: Readonly<Partial<Record<SensorBand, number>>> = {
  green: 1,
  yellow: 0.5,
  red: 0.2,
};

export interface AudioOutput {
  unlock(): Promise<'ready' | 'unavailable'>;
  update(sensors: SensorSnapshot, signedSpeedMps: number, simulationTimeS: number): void;
  setVolume(value: number): void;
  setMuted(value: boolean): void;
  suspend(): void;
  dispose(): void;
}

function isExpectedUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  return error.name === 'NotAllowedError' || error.name === 'NotSupportedError' ||
    error.name === 'SecurityError' || error.name === 'InvalidStateError';
}

export function createAudio(onError?: (error: unknown) => void): AudioOutput {
  let context: AudioContext | null = null;
  let oscillator: OscillatorNode | null = null;
  let gainNode: GainNode | null = null;
  let unlockPromise: Promise<'ready' | 'unavailable'> | null = null;
  let volume = 0.5;
  let muted = false;
  let active = false;
  let disposed = false;
  let toneRequested = false;
  let currentBand: SensorBand | null = null;
  let nextBeepAtS = -Infinity;

  function reportAsyncFailure(operation: Promise<unknown>) {
    void operation.catch((error: unknown) => {
      if (isExpectedUnavailable(error)) return;
      if (onError) onError(error);
      else queueMicrotask(() => { throw error; });
    });
  }

  function setGain(value: number) {
    if (!context || !gainNode) return;
    const now = context.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(value, now);
  }

  function applyGain() {
    setGain(active && !muted && toneRequested ? volume * TONE_GAIN : 0);
  }

  function silence() {
    toneRequested = false;
    currentBand = null;
    nextBeepAtS = -Infinity;
    setGain(0);
  }

  function initialize(constructor: typeof AudioContext): boolean {
    if (context) return true;
    context = new constructor();
    oscillator = context.createOscillator();
    gainNode = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gainNode.gain.setValueAtTime(0, context.currentTime);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    return true;
  }

  return {
    unlock() {
      if (disposed) return Promise.resolve('unavailable');
      if (unlockPromise) return unlockPromise;
      const AudioContextConstructor = globalThis.AudioContext;
      if (typeof AudioContextConstructor !== 'function') return Promise.resolve('unavailable');
      try {
        initialize(AudioContextConstructor);
        const resume = context!.resume();
        const operation = resume.then(
          (): 'ready' | 'unavailable' => {
          if (context?.state !== 'running') return 'unavailable';
          active = true;
          return 'ready';
          },
          (error: unknown): 'unavailable' => {
            if (isExpectedUnavailable(error)) return 'unavailable';
            throw error;
          },
        ).finally(() => { unlockPromise = null; });
        unlockPromise = operation;
        return operation;
      } catch (error) {
        if (isExpectedUnavailable(error)) return Promise.resolve('unavailable');
        return Promise.reject(error);
      }
    },
    update(sensors, signedSpeedMps, simulationTimeS) {
      if (!Number.isFinite(signedSpeedMps) || !Number.isFinite(simulationTimeS)) {
        throw new RangeError('Audio warning input must be finite');
      }
      if (disposed || !active) return;
      const warning = selectMostSevereWarning(sensors.readings, signedSpeedMps);
      if (!warning) {
        silence();
        applyGain();
        return;
      }
      if (warning.band === 'stop') {
        currentBand = 'stop';
        toneRequested = true;
        nextBeepAtS = simulationTimeS;
        applyGain();
        return;
      }
      const interval = TONE_INTERVAL_S[warning.band];
      if (interval === undefined) {
        silence();
        applyGain();
        return;
      }
      if (warning.band !== currentBand) {
        currentBand = warning.band;
        nextBeepAtS = simulationTimeS;
      }
      toneRequested = simulationTimeS >= nextBeepAtS;
      if (toneRequested) nextBeepAtS = simulationTimeS + interval;
      applyGain();
    },
    setVolume(value) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError('Audio volume must be between 0 and 1');
      }
      volume = value;
      applyGain();
    },
    setMuted(value) {
      muted = value;
      applyGain();
    },
    suspend() {
      active = false;
      silence();
      if (context?.state === 'running') reportAsyncFailure(context.suspend());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      silence();
      oscillator?.stop();
      oscillator?.disconnect();
      gainNode?.disconnect();
      if (context && context.state !== 'closed') reportAsyncFailure(context.close());
      context = null;
      oscillator = null;
      gainNode = null;
    },
  };
}
