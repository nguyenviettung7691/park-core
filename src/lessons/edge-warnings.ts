import type { WheelEdgeContact } from '../runtime-types';

/**
 * True when no wheel had a curb contact before and at least one is on a curb now, in any state:
 * a fast approach can go from none straight to climbing or over. In lessons the climbing failure
 * takes precedence; in the sandbox mounting a curb still warns.
 */
export function curbTouchBegan(
  previous: readonly WheelEdgeContact[],
  current: readonly WheelEdgeContact[],
): boolean {
  const wasOnCurb = previous.some((wheel) => wheel.kind === 'curb' && wheel.state !== 'none');
  const onCurbNow = current.some((wheel) => wheel.kind === 'curb' && wheel.state !== 'none');
  return !wasOnCurb && onCurbNow;
}
