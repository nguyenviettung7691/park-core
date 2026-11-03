const STEP_S = 1 / 120;

export interface Clock {
  advance(elapsedS: number, step: () => void): { alpha: number; droppedTimeS: number };
  reset(): void;
}

export function createClock(): Clock {
  let accumulator = 0;
  return {
    advance(elapsedS, step) {
      if (!Number.isFinite(elapsedS) || elapsedS < 0) {
        throw new RangeError('Elapsed time must be finite and non-negative');
      }
      accumulator += Math.min(elapsedS, 0.1);
      const available = Math.floor((accumulator + Number.EPSILON) / STEP_S);
      const count = Math.min(available, 8);
      accumulator = Math.max(0, accumulator - available * STEP_S);
      for (let i = 0; i < count; i++) step();
      return {
        alpha: accumulator / STEP_S,
        droppedTimeS: Math.max(0, available - count) * STEP_S,
      };
    },
    reset() {
      accumulator = 0;
    },
  };
}
