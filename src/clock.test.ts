import { describe, expect, it, vi } from 'vitest';
import { createClock } from './clock';

describe('fixed-step clock', () => {
  it('caps slow frames at eight steps and reports discarded backlog', () => {
    const step = vi.fn();
    const result = createClock().advance(0.1, step);
    expect(step).toHaveBeenCalledTimes(8);
    expect(result.droppedTimeS).toBeCloseTo(0.1 - 8 / 120);
    expect(result.alpha).toBeGreaterThanOrEqual(0);
    expect(result.alpha).toBeLessThan(1);
  });

  it('accumulates exact and half steps without losing simulation time', () => {
    const clock = createClock();
    const step = vi.fn();
    for (let i = 0; i < 120; i++) clock.advance(1 / 120, step);
    expect(step).toHaveBeenCalledTimes(120);
    clock.advance(1 / 240, step);
    expect(step).toHaveBeenCalledTimes(120);
    clock.advance(1 / 240, step);
    expect(step).toHaveBeenCalledTimes(121);
  });

  it('reset discards a half-step backlog', () => {
    const clock = createClock();
    const step = vi.fn();
    clock.advance(1 / 240, step);
    clock.reset();
    expect(clock.advance(1 / 240, step).alpha).toBeCloseTo(0.5);
    expect(step).not.toHaveBeenCalled();
  });

  it('clamps a long wall-clock interval before bounded stepping', () => {
    const step = vi.fn();
    expect(createClock().advance(5, step).droppedTimeS).toBeCloseTo(0.1 - 8 / 120);
    expect(step).toHaveBeenCalledTimes(8);
  });

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid delta %s', (delta) => {
    expect(() => createClock().advance(delta, () => {})).toThrow(RangeError);
  });
});
