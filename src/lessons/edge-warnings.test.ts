import { describe, expect, it } from 'vitest';
import type { TyreEdgeState, WheelEdgeContact } from '../runtime-types';
import { curbTouchBegan } from './edge-warnings';

function wheels(
  state: TyreEdgeState,
  kind: 'curb' | 'wheel-stop' = 'curb',
): readonly WheelEdgeContact[] {
  const none: WheelEdgeContact = { colliderId: null, kind: null, state: 'none' };
  return [{ colliderId: 'c', kind, state }, none, none, none];
}

describe('curbTouchBegan', () => {
  it('is true on the transition into a curb touch', () => {
    expect(curbTouchBegan(wheels('none', 'curb').map((w) => ({ ...w, kind: null })), wheels('touching')))
      .toBe(true);
  });
  it('is false while a touch continues and true again after a gap', () => {
    expect(curbTouchBegan(wheels('touching'), wheels('touching'))).toBe(false);
    expect(curbTouchBegan(wheels('touching'), wheels('none'))).toBe(false);
    expect(curbTouchBegan(wheels('none'), wheels('touching'))).toBe(true);
  });
  it('is true on a transition straight into climbing or over', () => {
    expect(curbTouchBegan(wheels('none'), wheels('climbing'))).toBe(true);
    expect(curbTouchBegan(wheels('none'), wheels('over'))).toBe(true);
    expect(curbTouchBegan(wheels('touching'), wheels('climbing'))).toBe(false);
    expect(curbTouchBegan(wheels('climbing'), wheels('over'))).toBe(false);
  });
  it('ignores wheel stops', () => {
    expect(curbTouchBegan(wheels('none'), wheels('touching', 'wheel-stop'))).toBe(false);
  });
});
