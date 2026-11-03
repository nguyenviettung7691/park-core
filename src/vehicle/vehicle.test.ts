import * as CANNON from 'cannon-es';
import { afterAll, describe, expect, it } from 'vitest';
import type { BodyPose, InputAction, InputFrame, VehicleId } from '../contracts';
import { createClock } from '../clock';
import type { PhysicsSnapshot } from '../runtime-types';
import { profiles } from './profiles';
import { deriveGeometry, rearAxleCenter, vehicleFootprint } from './geometry';
import { ackermann, stepKeyboardSteering } from './steering';
import { SimulationStateError, createVehicleRig, type VehicleRig } from './rig';
import {
  addColliderBoxes,
  createWorld,
  prototypeSpawn,
  prototypeYard,
} from '../world/colliders';

const H = 1 / 120;
const IDS: readonly VehicleId[] = ['sedan', 'cuv'];
const measurements: string[] = [];
const record = (line: string) => measurements.push(line);
afterAll(() => {
  if (measurements.length) console.info(`MEASUREMENTS\n${measurements.join('\n')}`);
});

const idle: InputFrame = { source: 'gamepad', steering: 0, throttle: 0, brake: 0 };
const frame = (over: Partial<InputFrame>): InputFrame => ({ ...idle, ...over });

interface Fixture { world: CANNON.World; rig: VehicleRig; removeYard: () => void; t: number }

function setup(id: VehicleId, spawn = prototypeSpawn(profiles[id])): Fixture {
  const world = createWorld();
  const removeYard = addColliderBoxes(world, prototypeYard);
  const rig = createVehicleRig(world, profiles[id]);
  rig.settle(spawn);
  return { world, rig, removeYard, t: 0 };
}

function step(f: Fixture, input: InputFrame, actions: readonly InputAction[] = []) {
  const notices = f.rig.applyInput(input, actions, H);
  f.world.step(H);
  f.t += H;
  return { notices, snap: f.rig.snapshot(f.t) };
}

function run(f: Fixture, input: InputFrame, seconds: number,
  each?: (s: PhysicsSnapshot) => void): PhysicsSnapshot {
  let snap = f.rig.snapshot(f.t);
  const n = Math.round(seconds / H);
  for (let i = 0; i < n; i++) {
    snap = step(f, input).snap;
    each?.(snap);
  }
  return snap;
}

function shift(f: Fixture, gear: 'P' | 'R' | 'N' | 'D', toggleParking: boolean) {
  const before = f.rig.snapshot(f.t).telemetry.parkingBrake;
  const actions: InputAction[] = [{ type: 'request-gear', gear }];
  if (toggleParking) actions.push({ type: 'toggle-parking-brake' });
  const { notices, snap } = step(f, frame({ brake: 0.2 }), actions);
  expect(notices).toEqual([]);
  expect(snap.telemetry.gear).toBe(gear);
  expect(snap.telemetry.parkingBrake).toBe(toggleParking ? !before : before);
}

const horizontal = (a: BodyPose, b: BodyPose) =>
  Math.hypot(a.positionM[0] - b.positionM[0], a.positionM[2] - b.positionM[2]);

// Algebraic (Kasa) least-squares circle fit: x^2+y^2 = a x + b y + c.
function circleFit(points: readonly (readonly [number, number])[]): number {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of points) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    sxz += x * z; syz += y * z; sz += z;
  }
  const m = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, points.length, sz]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j < 4; j++) m[r][j] -= k * m[c][j];
    }
  }
  const a = m[0][3] / m[0][0], b = m[1][3] / m[1][1], c = m[2][3] / m[2][2];
  return Math.sqrt(c + (a * a + b * b) / 4);
}

describe('vehicle geometry and steering (no engine)', () => {
  it('derives COM-relative geometry', () => {
    const g = deriveGeometry(profiles.sedan);
    expect(g.frontAxleZ).toBeCloseTo(-1.215, 4);
    expect(g.rearAxleZ).toBeCloseTo(1.485, 4);
    expect(g.wheelMountsLocalM[0][1]).toBeCloseTo(0.01506, 4);
    expect(g.wheelMountsLocalM[2][1]).toBeCloseTo(0.01643, 4);
    expect(g.wheelMountsLocalM[0][0]).toBeCloseTo(-0.78, 6);
    expect(g.wheelMountsLocalM[3][0]).toBeCloseTo(0.78, 6);
    expect(deriveGeometry(profiles.cuv).wheelMountsLocalM[0][1]).toBeCloseTo(-0.02903, 4);
    expect(g.mirrors[0].halfExtentsM[0]).toBeCloseTo(0.06, 4);
    expect(g.mirrors[0].centerLocalM[0]).toBeCloseTo(-0.96, 4);
    expect(g.mirrors[1].centerLocalM[0]).toBeCloseTo(0.96, 4);
    expect(g.mirrors[0].centerLocalM[1]).toBeCloseTo(0.43, 4);
    expect(g.mirrors[0].centerLocalM[2]).toBeCloseTo(-0.865, 4);
  });

  it('matches the design table for chassis boxes and driver eyes', () => {
    const s = deriveGeometry(profiles.sedan);
    expect(s.chassis.halfExtentsM[0]).toBeCloseTo(0.9, 6);
    expect(s.chassis.halfExtentsM[1]).toBeCloseTo(0.65, 6);
    expect(s.chassis.halfExtentsM[2]).toBeCloseTo(2.3, 6);
    expect(s.chassis.centerLocalM[1]).toBeCloseTo(0.28, 6);
    expect(s.chassis.centerLocalM[2]).toBeCloseTo(0.185, 6);
    expect(s.driverEyeLocalM[1]).toBeCloseTo(0.6, 6);
    expect(s.driverEyeLocalM[2]).toBeCloseTo(-0.965, 6);
    const c = deriveGeometry(profiles.cuv);
    expect(c.frontAxleZ).toBeCloseTo(-1.0962, 4);
    expect(c.rearAxleZ).toBeCloseTo(1.5138, 4);
    expect(c.chassis.halfExtentsM[1]).toBeCloseTo(0.72, 6);
    expect(c.chassis.halfExtentsM[2]).toBeCloseTo(2.175, 6);
    expect(c.chassis.centerLocalM[2]).toBeCloseTo(0.2288, 4);
    expect(c.driverEyeLocalM[1]).toBeCloseTo(0.68, 6);
    expect(c.driverEyeLocalM[2]).toBeCloseTo(-0.8462, 4);
    expect(c.mirrors[1].centerLocalM[1]).toBeCloseTo(0.48, 4);
  });

  it('rear axle is behind COM along world forward', () => {
    const yaw90 = { positionM: [0, 0.5, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] } as const;
    const p = rearAxleCenter(yaw90, profiles.sedan);
    expect(p[0]).toBeCloseTo(1.485, 4); expect(p[2]).toBeCloseTo(0, 4);
    const id = { positionM: [1, 0.5, 2], rotation: [0, 0, 0, 1] } as const;
    expect(rearAxleCenter(id, profiles.cuv)[2]).toBeCloseTo(2 + 1.5138, 4);
  });

  it('footprint uses mirror width and distinct overhang extents, rotated', () => {
    const id = { positionM: [0, 0.52, 0], rotation: [0, 0, 0, 1] } as const;
    const [fl, fr, rr, rl] = vehicleFootprint(id, profiles.sedan);
    expect(fl[0]).toBeCloseTo(-1.02, 6); expect(fl[2]).toBeCloseTo(-2.115, 6);
    expect(fr[0]).toBeCloseTo(1.02, 6); expect(fr[2]).toBeCloseTo(-2.115, 6);
    expect(rr[0]).toBeCloseTo(1.02, 6); expect(rr[2]).toBeCloseTo(2.485, 6);
    expect(rl[0]).toBeCloseTo(-1.02, 6); expect(rl[2]).toBeCloseTo(2.485, 6);
    const yaw90 = { positionM: [5, 0.52, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] } as const;
    const r = vehicleFootprint(yaw90, profiles.sedan);
    expect(r[0][0]).toBeCloseTo(5 - 2.115, 6); expect(r[0][2]).toBeCloseTo(1.02, 6);
    expect(r[2][0]).toBeCloseTo(5 + 2.485, 6); expect(r[2][2]).toBeCloseTo(-1.02, 6);
  });

  it('Ackermann full lock', () => {
    const [l, r] = ackermann(1, profiles.sedan);
    expect(l).toBeCloseTo(0.6916, 3); expect(r).toBeCloseTo(0.5105, 3);
    expect(ackermann(0, profiles.sedan)).toEqual([0, 0]);
    expect(ackermann(1e-6, profiles.sedan)).toEqual([0, 0]);
    const [rl, rr] = ackermann(-1, profiles.sedan);
    expect(rl).toBeCloseTo(-r, 6); expect(rr).toBeCloseTo(-l, 6);
    const [cl, cr] = ackermann(1, profiles.cuv);
    expect(cl).toBeCloseTo(0.6949, 3); expect(cr).toBeCloseTo(0.5086, 3);
  });

  it('keyboard steering ramps at fixed-step time', () => {
    let s = 0; for (let i = 0; i < 60; i++) s = stepKeyboardSteering(s, 1, 1 / 120);
    expect(s).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 40; i++) s = stepKeyboardSteering(s, 0, 1 / 120);
    expect(s).toBeCloseTo(0, 6);
    for (let i = 0; i < 300; i++) s = stepKeyboardSteering(s, -1, 1 / 120);
    expect(s).toBe(-1);
    expect(stepKeyboardSteering(0.3, -1, 0.1)).toBeCloseTo(0.15, 6);
  });
});

describe('prototype yard', () => {
  it('authors ground, four walls and a 0.1 m barrier with a removable world binding', () => {
    expect(prototypeYard.find((b) => b.kind === 'ground')).toMatchObject({
      centerM: [0, -0.5, 0], halfExtentsM: [20, 0.5, 20],
    });
    expect(prototypeYard.find((b) => b.id === 'barrier')).toMatchObject({
      kind: 'obstacle', centerM: [0, 0.5, -10], halfExtentsM: [4, 0.5, 0.05],
    });
    expect(prototypeYard.filter((b) => b.id.startsWith('wall')).length).toBe(4);
    expect(prototypeSpawn(profiles.cuv)).toEqual({ positionM: [0, 0.62, 4], yawRad: 0 });
    const world = createWorld();
    expect(world.gravity.y).toBeCloseTo(-9.81, 6);
    const remove = addColliderBoxes(world, prototypeYard);
    expect(world.bodies.length).toBe(prototypeYard.length);
    remove(); remove();
    expect(world.bodies.length).toBe(0);
  });
});

describe.each(IDS)('real Cannon rig: %s', (id) => {
  const profile = profiles[id];

  it('settles with four supports, no contact and no growing oscillation', () => {
    const f = setup(id);
    const first = f.rig.snapshot(0);
    expect(first.telemetry.gear).toBe('P');
    expect(first.telemetry.parkingBrake).toBe(true);
    expect(first.telemetry.signedSpeedMps).toBe(0);
    const ys: number[] = [];
    run(f, idle, 3, (s) => ys.push(s.telemetry.pose.positionM[1]));
    expect(f.rig.supports()).toEqual([true, true, true, true]);
    const p2p = (a: number[]) => Math.max(...a) - Math.min(...a);
    const firstP2p = p2p(ys.slice(0, 120));
    const lastP2p = p2p(ys.slice(-120));
    record(`${id} settle: settledY=${first.telemetry.pose.positionM[1].toFixed(5)} nominal=${profile.centerOfMassHeightM} p2p first=${firstP2p.toExponential(3)} last=${lastP2p.toExponential(3)}`);
    expect(lastP2p).toBeLessThanOrEqual(firstP2p + 1e-6);
    expect(f.world.contacts.some((c) => c.bi === f.rig.body || c.bj === f.rig.body)).toBe(false);
  });

  it('captures wheel support before the render refresh clears it', () => {
    const f = setup(id);
    step(f, idle);
    expect(f.rig.supports()).toEqual([true, true, true, true]);
    expect(f.rig.vehicle.wheelInfos.map((w) => w.isInContact)).toEqual([false, false, false, false]);
    const lifted = setup(id);
    lifted.rig.body.position.y = 3;
    step(lifted, idle);
    expect(lifted.rig.supports()).toEqual([false, false, false, false]);
  });

  it('throws a typed non-finite error instead of hiding NaN', () => {
    const f = setup(id);
    f.rig.body.position.x = Number.NaN;
    let err: unknown = null;
    try { f.rig.snapshot(0); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SimulationStateError);
    expect((err as SimulationStateError).reason).toBe('non-finite');
  });

  it('rejects non-finite controls before applying actions or forces', () => {
    const f = setup(id);
    expect(() => f.rig.applyInput(frame({ throttle: NaN }), [], H))
      .toThrow(SimulationStateError);
  });

  it('rejects non-finite wheel orientation in render snapshots', () => {
    const f = setup(id);
    f.rig.vehicle.wheelInfos[0]!.rotation = NaN;
    expect(() => f.rig.snapshot(0)).toThrow(SimulationStateError);
  });

  it('snapshots are fresh immutable values', () => {
    const f = setup(id);
    const a = f.rig.snapshot(0);
    const before = a.telemetry.pose.positionM[2];
    shift(f, 'D', true);
    run(f, idle, 1);
    expect(a.telemetry.pose.positionM[2]).toBe(before);
    expect(Object.isFrozen(a.telemetry.pose.positionM)).toBe(true);
    expect(Object.isFrozen(a.wheelPoses[0].rotation)).toBe(true);
  });

  it('D creeps along -Z, R along +Z, positive steering turns left', () => {
    const d = setup(id);
    shift(d, 'D', true);
    const sd = run(d, idle, 2);
    expect(sd.telemetry.signedSpeedMps).toBeGreaterThan(0.3);
    expect(sd.telemetry.pose.positionM[2]).toBeLessThan(4);
    const r = setup(id);
    shift(r, 'R', true);
    const sr = run(r, idle, 2);
    expect(sr.telemetry.signedSpeedMps).toBeLessThan(-0.3);
    expect(sr.telemetry.pose.positionM[2]).toBeGreaterThan(4);
    const l = setup(id);
    shift(l, 'D', true);
    const sl = run(l, frame({ steering: 1 }), 3);
    expect(sl.telemetry.headingRad).toBeGreaterThan(0.05);
    expect(sl.telemetry.pose.positionM[0]).toBeLessThan(-0.01);
    expect(sl.telemetry.frontWheelAnglesRad[0]).toBeGreaterThan(sl.telemetry.frontWheelAnglesRad[1]);
    expect(sl.telemetry.steeringWheelRad).toBeCloseTo(profile.steeringWheelLockRad, 6);
  });

  it('ramps keyboard steering per fixed step inside the rig', () => {
    const f = setup(id);
    let s = f.rig.snapshot(0);
    for (let i = 0; i < 60; i++) s = step(f, { ...idle, source: 'keyboard', steering: 1 }).snap;
    expect(s.telemetry.steeringWheelRad).toBeCloseTo(0.5 * profile.steeringWheelLockRad, 6);
  });

  it('enforces gear and parking-brake interlocks', () => {
    const f = setup(id);
    const lowBrake = step(f, frame({ brake: 0.1 }), [{ type: 'request-gear', gear: 'D' }]);
    expect(lowBrake.notices).toEqual([{ messageKey: 'gearRejected' }]);
    expect(lowBrake.snap.telemetry.gear).toBe('P');
    shift(f, 'D', false);
    const parked = run(f, frame({ throttle: 1 }), 2);
    expect(Math.abs(parked.telemetry.signedSpeedMps)).toBeLessThan(0.01);
    expect(parked.telemetry.parkingBrake).toBe(true);
    step(f, idle, [{ type: 'toggle-parking-brake' }]);
    const braked = run(f, frame({ throttle: 1, brake: 0.03 }), 2);
    expect(Math.abs(braked.telemetry.signedSpeedMps)).toBeLessThan(0.01);
    const moving = run(f, idle, 3);
    expect(moving.telemetry.signedSpeedMps).toBeGreaterThan(0.5);
    const fast = step(f, frame({ brake: 1 }), [{ type: 'request-gear', gear: 'R' }]);
    expect(fast.snap.telemetry.totalSpeedMps).toBeGreaterThanOrEqual(0.1);
    expect(fast.notices).toEqual([{ messageKey: 'gearRejected' }]);
    expect(fast.snap.telemetry.gear).toBe('D');
    run(f, frame({ brake: 1 }), 2);
    shift(f, 'R', false);
    step(f, idle, [{ type: 'set-indicator', indicator: 'left' }]);
    expect(f.rig.snapshot(f.t).telemetry.indicator).toBe('left');
  });

  it('rejects a gear request at 0.5 m/s even with full brake', () => {
    const f = setup(id);
    shift(f, 'D', true);
    f.rig.body.velocity.set(0, 0, -0.5);
    const r = step(f, frame({ brake: 1 }), [{ type: 'request-gear', gear: 'N' }]);
    expect(r.notices).toEqual([{ messageKey: 'gearRejected' }]);
    expect(r.snap.telemetry.gear).toBe('D');
  });

  it('applies per-wheel holding brake impulses as maxima, not sums', () => {
    const f = setup(id);
    const g = 9.81, m = profile.massKg;
    step(f, idle);
    const both = f.rig.vehicle.wheelInfos.map((w) => w.brake);
    expect(both[0]).toBeCloseTo(m * g / 4 * H, 6);
    expect(both[2]).toBeCloseTo(m * g / 2 * H, 6);
    if (id === 'sedan') { expect(both[0]).toBeCloseTo(29.634, 3); expect(both[3]).toBeCloseTo(59.269, 3); }
    step(f, idle, [{ type: 'toggle-parking-brake' }]);
    for (const w of f.rig.vehicle.wheelInfos) expect(w.brake).toBeCloseTo(m * g / 4 * H, 6);
    shift(f, 'N', false);
    step(f, idle, [{ type: 'toggle-parking-brake' }]);
    const parking = f.rig.vehicle.wheelInfos.map((w) => w.brake);
    expect(parking[0]).toBe(0); expect(parking[1]).toBe(0);
    expect(parking[2]).toBeCloseTo(m * g / 2 * H, 6);
    expect(parking[3]).toBeCloseTo(m * g / 2 * H, 6);
  });

  it('P and parking brake each hold for 60 s within 0.02 m', () => {
    const p = setup(id);
    step(p, idle, [{ type: 'toggle-parking-brake' }]);
    const p0 = p.rig.snapshot(p.t).telemetry.pose;
    const p1 = run(p, idle, 60).telemetry.pose;
    const k = setup(id);
    shift(k, 'N', false);
    const k0 = k.rig.snapshot(k.t).telemetry.pose;
    const k1 = run(k, idle, 60).telemetry.pose;
    record(`${id} hold 60s: P drift=${horizontal(p0, p1).toExponential(3)} m, parking-brake drift=${horizontal(k0, k1).toExponential(3)} m`);
    expect(horizontal(p0, p1)).toBeLessThanOrEqual(0.02);
    expect(horizontal(k0, k1)).toBeLessThanOrEqual(0.02);
  });

  it('creeps to +0.83 in D and -0.56 in R after 6 s', () => {
    const d = setup(id); shift(d, 'D', true);
    const vd = run(d, idle, 6).telemetry.signedSpeedMps;
    const r = setup(id); shift(r, 'R', true);
    const vr = run(r, idle, 6).telemetry.signedSpeedMps;
    record(`${id} creep 6s: D=${vd.toFixed(4)} m/s, R=${vr.toFixed(4)} m/s`);
    expect(Math.abs(vd - profile.creepForwardMps)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(vr + profile.creepReverseMps)).toBeLessThanOrEqual(0.1);
  });

  it('full throttle tapers below 15 km/h without a velocity clamp', () => {
    const f = setup(id, { positionM: [15, profile.centerOfMassHeightM, 15], yawRad: Math.PI / 2 });
    shift(f, 'D', true);
    let peak = 0;
    const s = run(f, frame({ throttle: 1 }), 6, (x) => { peak = Math.max(peak, x.telemetry.signedSpeedMps); });
    record(`${id} full throttle 6s: final=${(s.telemetry.signedSpeedMps * 3.6).toFixed(3)} km/h peak=${(peak * 3.6).toFixed(3)} km/h`);
    expect(peak * 3.6).toBeGreaterThan(12);
    expect(peak * 3.6).toBeLessThan(15);
  });

  it('stops from 5 km/h within 0.5 m under full brake', () => {
    const f = setup(id);
    shift(f, 'D', true);
    f.rig.body.velocity.set(0, 0, -5 / 3.6);
    const start = f.rig.snapshot(f.t).telemetry.pose;
    let stopAt: BodyPose | null = null;
    let t = 0, stopT = 0;
    run(f, frame({ brake: 1 }), 2, (s) => {
      t += H;
      if (!stopAt && s.telemetry.totalSpeedMps < 0.05) { stopAt = s.telemetry.pose; stopT = t; }
    });
    expect(stopAt).not.toBeNull();
    const d = horizontal(start, stopAt!);
    record(`${id} brake 5 km/h: distance=${d.toFixed(4)} m time=${stopT.toFixed(3)} s`);
    expect(d).toBeLessThanOrEqual(0.5);
  });

  it('turns at full lock with the bicycle-reference rear-axle radius', () => {
    const f = setup(id);
    shift(f, 'D', true);
    const pts: (readonly [number, number])[] = [];
    let maxSpeed = 0, i = 0;
    run(f, frame({ steering: 1 }), 14, (s) => {
      if (++i * H <= 4) return;
      maxSpeed = Math.max(maxSpeed, s.telemetry.totalSpeedMps);
      const p = rearAxleCenter(s.telemetry.pose, profile);
      pts.push([p[0], p[2]]);
    });
    const ref = profile.wheelbaseM / Math.tan(profile.steeringWheelLockRad / profile.steeringRatio);
    const radius = circleFit(pts);
    record(`${id} turn: radius=${radius.toFixed(4)} m reference=${ref.toFixed(4)} m error=${((radius / ref - 1) * 100).toFixed(2)}% maxSpeed=${maxSpeed.toFixed(3)} m/s`);
    expect(maxSpeed).toBeLessThanOrEqual(1);
    expect(Math.abs(radius / ref - 1)).toBeLessThanOrEqual(0.05);
  });

  it('30/60/144 fps schedules through the production clock agree', () => {
    const results = [30, 60, 144].map((fps) => {
      const f = setup(id); shift(f, 'D', true);
      const clock = createClock();
      let steps = 0;
      let snap = f.rig.snapshot(f.t);
      for (let i = 0; i < 6 * fps; i++) {
        clock.advance(1 / fps, () => {
          f.rig.applyInput(idle, [], H); f.world.step(H); steps++;
          snap = f.rig.snapshot(steps * H);
        });
      }
      return { fps, elapsed: steps * H, v: snap.telemetry.signedSpeedMps };
    });
    const mean = results.reduce((a, r) => a + r.v, 0) / results.length;
    record(`${id} schedules: ${results.map((r) => `${r.fps}fps t=${r.elapsed.toFixed(4)} v=${r.v.toFixed(4)}`).join('; ')}`);
    for (const r of results) {
      expect(Math.abs(r.elapsed - 6)).toBeLessThanOrEqual(H + 1e-9);
      expect(Math.abs(r.v - mean)).toBeLessThanOrEqual(0.1);
    }
  });

  it('contacts the 0.1 m barrier at 15 km/h in eight-step frames without crossing it', () => {
    const g = deriveGeometry(profile);
    const frontExtent = g.chassis.halfExtentsM[2] - g.chassis.centerLocalM[2];
    const barrier = prototypeYard.find((b) => b.id === 'barrier')!;
    const near = barrier.centerM[2] + barrier.halfExtentsM[2];
    const far = barrier.centerM[2] - barrier.halfExtentsM[2];
    const f = setup(id, { positionM: [0, profile.centerOfMassHeightM, near + 0.02 + frontExtent], yawRad: 0 });
    shift(f, 'N', true);
    let contacts = 0, contactStep = -1, steps = 0, minFront = Infinity, crossed = false;
    const off = f.rig.onContact(() => { contacts++; if (contactStep < 0) contactStep = steps; off(); });
    f.rig.body.velocity.set(0, 0, -15 / 3.6);
    const clock = createClock();
    for (let k = 0; k < 10; k++) {
      const { droppedTimeS } = clock.advance(0.1, () => {
        f.rig.applyInput(idle, [], H); f.world.step(H); steps++;
        const z = f.rig.snapshot(steps * H).telemetry.pose.positionM[2] - frontExtent;
        minFront = Math.min(minFront, z);
        if (z <= far) crossed = true;
      });
      expect(droppedTimeS).toBeGreaterThan(0);
    }
    record(`${id} barrier 15 km/h: contact at substep ${contactStep}, deepest front z=${minFront.toFixed(4)} (near ${near}, far ${far}), max penetration=${(near - minFront).toFixed(4)} m, substeps=${steps}`);
    expect(steps).toBe(80);
    expect(crossed).toBe(false);
    expect(contacts).toBe(1);
    expect(contactStep).toBeGreaterThan(0);
  });

  it('reports chassis contact with the ground after settle and disposes once', () => {
    const f = setup(id);
    let hits = 0;
    f.rig.onContact(() => hits++);
    f.rig.body.position.y = profile.centerOfMassHeightM - 0.4;
    step(f, idle);
    expect(hits).toBe(1);
    const listeners = () => (f.world as unknown as { _listeners: Record<string, unknown[]> })._listeners;
    f.rig.dispose(); f.rig.dispose();
    expect(f.world.bodies.includes(f.rig.body)).toBe(false);
    expect(listeners().preStep ?? []).toEqual([]);
    expect(listeners().beginContact ?? []).toEqual([]);
    f.removeYard();
    expect(f.world.bodies.length).toBe(0);
  });

  it('raises a typed settle error when spawned inside the barrier', () => {
    const world = createWorld();
    addColliderBoxes(world, prototypeYard);
    const rig = createVehicleRig(world, profile);
    let err: unknown = null;
    try { rig.settle({ positionM: [0, profile.centerOfMassHeightM, -10], yawRad: 0 }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SimulationStateError);
    expect((err as SimulationStateError).reason).toMatch(/^settle-(contact|failed)$/);
  });
});
