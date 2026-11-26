import type { WheelEdgeContact } from '../runtime-types';

/** True when no wheel had a curb contact before and at least one is touching a curb now. */
export function curbTouchBegan(
  previous: readonly WheelEdgeContact[],
  current: readonly WheelEdgeContact[],
): boolean {
  const wasOnCurb = previous.some((wheel) => wheel.kind === 'curb' && wheel.state !== 'none');
  const touchingNow = current.some((wheel) => wheel.kind === 'curb' && wheel.state === 'touching');
  return !wasOnCurb && touchingNow;
}
