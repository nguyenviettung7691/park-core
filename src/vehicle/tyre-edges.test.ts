import { describe, expect, it } from 'vitest';
import type { ColliderBox } from '../runtime-types';
import { tyreEdge, type TyreFrame } from './tyre-edges';

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
    const r = tyreEdge(tyreAt(0.4), [box(0.12)]);
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
    const curb = box(0.12);
    let prev = tyreEdge(tyreAt(0.31), [curb]).supportY ?? 0;
    let maxJump = 0;
    for (let i = 1; i <= 310; i += 1) {
      const y = tyreEdge(tyreAt(0.31 - i * 0.001), [curb]).supportY ?? 0;
      maxJump = Math.max(maxJump, Math.abs(y - prev));
      prev = y;
    }
    expect(maxJump).toBeLessThanOrEqual(0.002);
    expect(tyreEdge(tyreAt(0), [curb]).supportY!).toBeCloseTo(0.12, 9);
  });

  it('is climbing once lift reaches half the curb height', () => {
    expect(tyreEdge(tyreAt(0.24), [box(0.12)]).contact.state).toBe('touching');
    const r = tyreEdge(tyreAt(0.1), [box(0.12)]);
    expect(r.supportY! - 0).toBeGreaterThanOrEqual(0.06);
    expect(r.contact.state).toBe('climbing');
  });

  it('is over when the wheel centre is above the box', () => {
    const r = tyreEdge(tyreAt(-0.2), [box(0.12)]);
    expect(r.contact.state).toBe('over');
    expect(r.supportY).toBeCloseTo(0.12, 9);
    expect(r.normal).toEqual([0, 1, 0]);
  });

  it('applies sideways penalty only for a side approach', () => {
    const side = box(0.12, {
      centerM: [0, 0.06, 1.5], halfExtentsM: [5, 0.06, 0.5],
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
    const stop = box(0.12, { id: 'stop-1', kind: 'wheel-stop' });
    const r = tyreEdge(tyreAt(0.1), [box(0.5, { id: 'wall', kind: 'obstacle' }), stop]);
    expect(r.contact.colliderId).toBe('stop-1');
    expect(r.contact.kind).toBe('wheel-stop');
    expect(tyreEdge(tyreAt(0.1), [box(0.5, { kind: 'ground' })]).contact.state).toBe('none');
  });

  it('honours box yaw', () => {
    // Face normal rotated 90 deg about +Y: box long along x, face at z = -1... rolled along -z.
    const yawed = box(0.12, { yawRad: Math.PI / 2, centerM: [0, 0.06, 0] });
    const tyre: TyreFrame = {
      centerM: [0.4, R, 0], rollDir: [1, 0, 0], axleDir: [0, 0, 1],
      radiusM: R, groundY: 0,
    };
    // Rotated box spans x in [-5,5], z in [-1.5,1.5]: wheel at x=0.4 is over it.
    expect(tyreEdge(tyre, [yawed]).contact.state).toBe('over');
    const far: TyreFrame = { ...tyre, centerM: [5.2, R, 0] };
    const r = tyreEdge(far, [yawed]);
    expect(r.contact.state).toBe('touching');
  });
});
