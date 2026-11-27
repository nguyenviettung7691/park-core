import { describe, expect, it } from 'vitest';
import type { ColliderBox } from '../runtime-types';
import { TOUCH_MARGIN_M, tyreEdge, type TyreEdgeHistory, type TyreFrame } from './tyre-edges';

const R = 0.31;
const faceX = 0.5;

function box(h: number, extra: Partial<ColliderBox> = {}): ColliderBox {
  return {
    id: 'curb-a', kind: 'curb', centerM: [faceX + 1, h / 2, 0],
    halfExtentsM: [1, h / 2, 5], yawRad: 0, ...extra,
  };
}

/** Wheel rolling +x toward the face at x = faceX, d metres short of it. */
function tyreAt(d: number): TyreFrame {
  return {
    centerM: [faceX - d, R, 0], rollDir: [1, 0, 0], axleDir: [0, 0, 1],
    radiusM: R, groundY: 0,
  };
}

describe('tyreEdge', () => {
  it('reports none when the curb is out of reach', () => {
    const r = tyreEdge(tyreAt(0.4), [box(0.11)]);
    expect(r.contact).toEqual({ colliderId: null, kind: null, state: 'none' });
    expect(r.supportY).toBeNull();
    expect(r.normal).toBeNull();
    expect(r.lateralPenetrationM).toBe(0);
  });

  it('starts lifting exactly at first touch with the expected push-back ratio', () => {
    const h = 0.11;
    const d = Math.sqrt(2 * R * h - h * h);
    const r = tyreEdge(tyreAt(d - 1e-9), [box(h)]);
    expect(r.contact.state).toBe('touching');
    expect(r.supportY!).toBeCloseTo(0, 6);
    const n = r.normal!;
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
    const ratio = Math.hypot(n[0], n[2]) / n[1];
    // d / sqrt(r^2 - d^2) at first touch (about 1.18; the spec's 0.237/0.19 is rounded).
    const expected = d / Math.sqrt(R * R - d * d);
    expect(ratio / expected).toBeGreaterThan(0.99);
    expect(ratio / expected).toBeLessThan(1.01);
    expect(expected).toBeCloseTo(1.184, 2);
    expect(n[0]).toBeLessThan(0); // pushes the wheel back along -rollDir
    expect(r.hitPointM![0]).toBeCloseTo(faceX, 9);
    expect(r.hitPointM![1]).toBeCloseTo(h, 9);
  });

  it('keeps supportY continuous while climbing and reaches the top', () => {
    const curb = box(0.11);
    const d0 = Math.sqrt(2 * R * 0.11 - 0.11 * 0.11);
    expect(tyreEdge(tyreAt(d0 + 0.001), [curb]).supportY).toBeNull();
    let prev = tyreEdge(tyreAt(0.31), [curb]).supportY ?? 0;
    let maxJump = 0;
    for (let i = 1; i <= 310; i += 1) {
      const y = tyreEdge(tyreAt(0.31 - i * 0.001), [curb]).supportY ?? 0;
      maxJump = Math.max(maxJump, Math.abs(y - prev));
      prev = y;
    }
    expect(maxJump).toBeLessThanOrEqual(0.002);
    expect(tyreEdge(tyreAt(0), [curb]).supportY!).toBeCloseTo(0.11, 9);
  });

  it('reports touching without support within the touch margin beyond first touch', () => {
    const h = 0.11;
    const d0 = Math.sqrt(2 * R * h - h * h);
    expect(TOUCH_MARGIN_M).toBe(0.005);
    for (const extra of [1e-6, 0.0025, TOUCH_MARGIN_M - 1e-6]) {
      const r = tyreEdge(tyreAt(d0 + extra), [box(h, { id: 'stop-m', kind: 'wheel-stop' })]);
      expect(r.contact).toEqual({ colliderId: 'stop-m', kind: 'wheel-stop', state: 'touching' });
      expect(r.supportY).toBeNull();
      expect(r.normal).toBeNull();
      expect(r.hitPointM).toBeNull();
      expect(r.lateralPenetrationM).toBe(0);
      expect(r.lateralNormal).toBeNull();
    }
    expect(tyreEdge(tyreAt(d0 + TOUCH_MARGIN_M + 1e-6), [box(h)]).contact.state).toBe('none');
  });

  it('is climbing once lift reaches half the curb height', () => {
    expect(tyreEdge(tyreAt(0.24), [box(0.11)]).contact.state).toBe('touching');
    const r = tyreEdge(tyreAt(0.1), [box(0.11)]);
    expect(r.supportY! - 0).toBeGreaterThanOrEqual(0.055);
    expect(r.contact.state).toBe('climbing');
  });

  it('is over when the wheel centre is above the box', () => {
    const r = tyreEdge(tyreAt(-0.2), [box(0.11)]);
    expect(r.contact.state).toBe('over');
    expect(r.supportY).toBeCloseTo(0.11, 9);
    expect(r.normal).toEqual([0, 1, 0]);
  });

  it('applies sideways penalty only for a side approach', () => {
    const side = box(0.11, {
      centerM: [0, 0.055, 1.5], halfExtentsM: [5, 0.055, 0.5],
    });
    const tyre: TyreFrame = {
      centerM: [0, R, 0.92], rollDir: [1, 0, 0], axleDir: [0, 0, 1],
      radiusM: R, groundY: 0,
    };
    const r = tyreEdge(tyre, [side]);
    expect(r.contact.state).toBe('touching');
    expect(r.supportY).toBeNull();
    expect(r.lateralPenetrationM).toBeCloseTo(0.02, 9);
    expect(r.lateralNormal![0]).toBeCloseTo(0, 9);
    expect(r.lateralNormal![2]).toBeCloseTo(-1, 9);
  });

  it('copies kind and id and ignores non-edge boxes', () => {
    const stop = box(0.11, { id: 'stop-1', kind: 'wheel-stop' });
    const r = tyreEdge(tyreAt(0.1), [box(0.5, { id: 'wall', kind: 'obstacle' }), stop]);
    expect(r.contact.colliderId).toBe('stop-1');
    expect(r.contact.kind).toBe('wheel-stop');
    expect(tyreEdge(tyreAt(0.1), [box(0.5, { kind: 'ground' })]).contact.state).toBe('none');
  });

  it('honours box yaw', () => {
    // Yaw 90 deg about +Y turns the box's long local z axis onto world x.
    const yawed = box(0.11, { yawRad: Math.PI / 2, centerM: [0, 0.055, 0] });
    const tyre: TyreFrame = {
      centerM: [0.4, R, 0], rollDir: [1, 0, 0], axleDir: [0, 0, 1],
      radiusM: R, groundY: 0,
    };
    // Rotated box spans x in [-5,5], z in [-1,1]: wheel at x=0.4 is over it.
    expect(tyreEdge(tyre, [yawed]).contact.state).toBe('over');
    const far: TyreFrame = { ...tyre, centerM: [5.2, R, 0] };
    const r = tyreEdge(far, [yawed]);
    expect(r.contact.state).toBe('touching');
  });

  it('gives finite normal and hit point with a slice exactly on the face', () => {
    const r = tyreEdge(tyreAt(0), [box(0.11)]);
    for (const v of [...r.normal!, ...r.hitPointM!]) expect(Number.isFinite(v)).toBe(true);
    expect(r.supportY).toBeCloseTo(0.11, 9);
  });

  it('applies no lateral penalty to a wheel atop a wide box', () => {
    const wide = box(0.11, { centerM: [0, 0.055, 0], halfExtentsM: [5, 0.055, 0.5] });
    const tyre: TyreFrame = {
      centerM: [0, R, 0.3], rollDir: [1, 0, 0], axleDir: [0, 0, 1], radiusM: R, groundY: 0,
    };
    const r = tyreEdge(tyre, [wide]);
    expect(r.contact.state).toBe('over');
    expect(r.lateralPenetrationM).toBe(0);
    expect(r.lateralNormal).toBeNull();
  });

  it('picks the highest support regardless of box order', () => {
    const low = box(0.05, { id: 'low', centerM: [faceX - 0.5, 0.025, 0], halfExtentsM: [0.7, 0.025, 5] });
    const tall = box(0.11, { id: 'tall' });
    const tyre = tyreAt(0.1); // centre at x=0.4, over `low`, rolling toward `tall`
    const a = tyreEdge(tyre, [low, tall]);
    const b = tyreEdge(tyre, [tall, low]);
    expect(a.supportY).toBeCloseTo(b.supportY!, 12);
    expect(a.supportY!).toBeGreaterThan(0.09);
    expect(a.contact.colliderId).toBe('tall');
    expect(b.contact.colliderId).toBe('tall');
  });

  it('applies yaw with the right sign (30 deg, off-origin box)', () => {
    const yaw = Math.PI / 6;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Local +x face normal in world xz is (cos, -sin); local half x = 0.5.
    const centre: [number, number] = [3, -2];
    const faceMid: [number, number] = [centre[0] + 0.5 * c, centre[1] - 0.5 * s];
    const d = 0.1;
    const wheel: [number, number] = [faceMid[0] + c * d, faceMid[1] - s * d];
    const yawed = box(0.11, { yawRad: yaw, centerM: [centre[0], 0.055, centre[1]], halfExtentsM: [0.5, 0.055, 4] });
    const tyre: TyreFrame = {
      centerM: [wheel[0], R, wheel[1]], rollDir: [-c, 0, s], axleDir: [s, 0, c],
      radiusM: R, groundY: 0,
    };
    const r = tyreEdge(tyre, [yawed]);
    expect(r.contact.state).toBe('climbing');
    // Pushes the wheel away from the box: along +(cos, -sin).
    expect(r.normal![0]).toBeGreaterThan(0);
    expect(r.normal![2]).toBeLessThan(0);
    expect(r.normal![0] / -r.normal![2]).toBeCloseTo(c / s, 6);
    // Hit lies on the face plane, within one tyre half-width of the face midpoint along the axle.
    const hx = r.hitPointM![0] - faceMid[0];
    const hz = r.hitPointM![2] - faceMid[1];
    expect(hx * c - hz * s).toBeCloseTo(0, 6);
    expect(Math.abs(hx * s + hz * c)).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  const d0 = Math.sqrt(2 * R * 0.11 - 0.11 * 0.11);
  const still = (engagement: Record<string, number>): TyreEdgeHistory => ({
    engagement: new Map(Object.entries(engagement)), travelM: [0, 0, 0],
  });

  it('rubs a box it was alongside when steered or slid into it, with no lift', () => {
    // Rolling 45 deg into the +x face with the leading outer slice 2 cm inside the box.
    const c = Math.SQRT1_2;
    const curb = box(0.11, { id: 'rubbed' });
    const tyre: TyreFrame = {
      centerM: [faceX + 0.02 - 0.1 * c, R, -0.1 * c], rollDir: [c, 0, -c], axleDir: [c, 0, c],
      radiusM: R, groundY: 0,
    };
    // Plain geometry (no history): the tyre has rolled onto the box.
    expect(tyreEdge(tyre, [curb]).supportY).not.toBeNull();
    // Engagement still at reach (it got there by steering, not rolling): sidewall push only.
    const lateral = tyreEdge(tyre, [curb], still({ rubbed: d0 + TOUCH_MARGIN_M }));
    expect(lateral.contact).toEqual({ colliderId: 'rubbed', kind: 'curb', state: 'touching' });
    expect(lateral.supportY).toBeNull();
    expect(lateral.normal).toBeNull();
    expect(lateral.lateralPenetrationM).toBeCloseTo(0.02, 9);
    expect(lateral.lateralNormal).toEqual([-1, 0, 0]);
    expect(lateral.lateralColliderId).toBe('rubbed');
    expect(lateral.engagement.get('rubbed')).toBeCloseTo(d0 + TOUCH_MARGIN_M, 12);
    // Another box's history leaves the rolling contact unchanged.
    expect(tyreEdge(tyre, [curb], still({ other: 0.1 })).supportY)
      .toBeCloseTo(tyreEdge(tyre, [curb]).supportY!, 12);
  });

  it('remembers a box the wheel is alongside and lifts only as it rolls into it', () => {
    const h = 0.11;
    const curb = box(h, { id: 'side' });
    // Parallel to the +x face (rolling +z), outer slice 5 cm short of it: in reach, no contact.
    const parallel: TyreFrame = {
      centerM: [faceX - 0.05 - 0.1, R, 0], rollDir: [0, 0, 1], axleDir: [1, 0, 0],
      radiusM: R, groundY: 0,
    };
    const alongside = tyreEdge(parallel, [curb], still({}));
    expect(alongside.contact.state).toBe('none');
    expect(alongside.supportY).toBeNull();
    expect(alongside.engagement.get('side')).toBeCloseTo(d0 + TOUCH_MARGIN_M, 12);
    // Out of reach across the face: nothing remembered.
    const far = tyreEdge({ ...parallel, centerM: [faceX - d0 - 0.01 - 0.1, R, 0] }, [curb], still({}));
    expect(far.engagement.has('side')).toBe(false);
    // Steered 35 deg toward the face: plain geometry is a deep rolling contact (a one-step lift) ...
    const a = 35 * Math.PI / 180;
    const roll: [number, number, number] = [Math.sin(a), 0, Math.cos(a)];
    const steered: TyreFrame = {
      ...parallel, rollDir: roll, axleDir: [Math.cos(a), 0, -Math.sin(a)],
    };
    expect(tyreEdge(steered, [curb]).contact.state).toBe('climbing');
    // ... but steering is not rolling: the footprint reaches the face, so it rubs it.
    const remembered = { engagement: alongside.engagement, travelM: [0, 0, 0] as const };
    const rub = tyreEdge(steered, [curb], remembered);
    expect(rub.contact).toEqual({ colliderId: 'side', kind: 'curb', state: 'touching' });
    expect(rub.supportY).toBeNull();
    expect(rub.lateralPenetrationM).toBe(0);
    // Rolling 1 cm along its rolling direction (about 5.7 mm into the face) advances e by at most
    // 1.25 cm and lifts the tyre a little, never to the geometric height.
    const rolled = tyreEdge({ ...steered, centerM: [steered.centerM[0] + roll[0] * 0.01, R, roll[2] * 0.01] },
      [curb], { engagement: rub.engagement, travelM: [roll[0] * 0.01, 0, roll[2] * 0.01] });
    const e = rolled.engagement.get('side')!;
    expect(e).toBeLessThan(d0 + TOUCH_MARGIN_M);
    expect(e).toBeGreaterThanOrEqual(d0 + TOUCH_MARGIN_M - 0.0125 - 1e-12);
    expect(rolled.supportY!).toBeLessThan(0.01);
    expect(rolled.contact.state).toBe('touching');
    // Steered footprint short of the face: remembered, no contact.
    const short = tyreEdge({ ...steered, centerM: [faceX - 0.2 - 0.1, R, 0] }, [curb], remembered);
    expect(short.contact.state).toBe('none');
    expect(short.engagement.has('side')).toBe(true);
  });

  it('eases off an edge no faster than the tyre travels', () => {
    const curb = box(0.11);
    // Engaged on top of the face (e = 0) and then 5 cm short of it after travelling 1 cm.
    const r = tyreEdge(tyreAt(0.05), [curb], {
      engagement: new Map([['curb-a', 0]]), travelM: [-0.01, 0, 0],
    });
    expect(r.engagement.get('curb-a')).toBeCloseTo(0.0125, 12);
    expect(r.supportY!).toBeGreaterThan(tyreEdge(tyreAt(0.05), [curb]).supportY!);
  });

  it('reports over only for the box that carries the wheel centre', () => {
    // Centre over a low stop, outer slice rubbing a tall curb it never rolled onto.
    const low = box(0.05, { id: 'low', kind: 'wheel-stop', centerM: [0, 0.025, 0], halfExtentsM: [1, 0.025, 1] });
    const tall = box(0.11, { id: 'tall', centerM: [0, 0.055, 1.5], halfExtentsM: [1, 0.055, 0.5] });
    const tyre: TyreFrame = {
      centerM: [0, R, 0.92], rollDir: [1, 0, 0], axleDir: [0, 0, 1], radiusM: R, groundY: 0,
    };
    const r = tyreEdge(tyre, [tall, low]);
    expect(r.contact).toEqual({ colliderId: 'low', kind: 'wheel-stop', state: 'over' });
    expect(r.lateralColliderId).toBe('tall');
  });
});
