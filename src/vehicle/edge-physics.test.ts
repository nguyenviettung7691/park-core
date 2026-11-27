import * as CANNON from 'cannon-es';
import { afterAll, describe, expect, it } from 'vitest';
import type { InputAction, InputFrame, VehicleId } from '../contracts';
import type { ColliderBox, PhysicsSnapshot } from '../runtime-types';
import { addColliderBoxes, createWorld, type ColliderCleanup } from '../world/colliders';
import { deriveGeometry } from './geometry';
import { profiles } from './profiles';
import { createVehicleRig, type VehicleRig } from './rig';
import { TYRE_HALF_WIDTH_M } from './tyre-edges';
import type { StageId } from '../contracts';
import { scenarios } from '../lessons/scenarios';
import { updateFailure, type FailureEvent } from '../lessons/failure';
import { curbTouchBegan } from '../lessons/edge-warnings';
import {
  footprint,
  footprintInsideRegion,
  wheelStops,
  wheelStopTouchingPose,
} from '../lessons/scenario-test-utils';
import { collidersForScenario } from '../world/colliders';

const H = 1 / 120;
const IDS: readonly VehicleId[] = ['sedan', 'cuv'];
const measurements: string[] = [];
const record = (line: string) => measurements.push(line);
afterAll(() => {
  if (measurements.length) console.info(`EDGE MEASUREMENTS\n${measurements.join('\n')}`);
});

const idle: InputFrame = { source: 'gamepad', steering: 0, throttle: 0, brake: 0 };
const frame = (over: Partial<InputFrame>): InputFrame => ({ ...idle, ...over });
const ground: ColliderBox = {
  id: 'test-ground', kind: 'ground', centerM: [0, -0.5, 0], halfExtentsM: [40, 0.5, 40], yawRad: 0,
};
const STOP_HALF: readonly [number, number, number] = [0.9, 0.055, 0.075];
const CURB_HALF: readonly [number, number, number] = [0.15, 0.055, 16];

interface Fixture {
  world: CANNON.World; rig: VehicleRig; cleanup: ColliderCleanup; t: number;
}

function setup(id: VehicleId, boxes: readonly ColliderBox[], spawn: { x: number; z: number },
  useEdges = true): Fixture {
  const world = createWorld();
  const cleanup = addColliderBoxes(world, [ground, ...boxes]);
  const rig = createVehicleRig(world, profiles[id], cleanup.idForBody,
    useEdges ? cleanup.edges : []);
  rig.settle({ positionM: [spawn.x, profiles[id].centerOfMassHeightM, spawn.z], yawRad: 0 });
  return { world, rig, cleanup, t: 0 };
}

function step(f: Fixture, input: InputFrame, actions: readonly InputAction[] = []): PhysicsSnapshot {
  f.rig.applyInput(input, actions, H);
  f.world.step(H);
  f.t += H;
  return f.rig.snapshot(f.t);
}

function shift(f: Fixture, gear: 'R' | 'N' | 'D') {
  step(f, frame({ brake: 0.2 }), [{ type: 'request-gear', gear }, { type: 'toggle-parking-brake' }]);
  const t = f.rig.snapshot(f.t).telemetry;
  expect(t.gear).toBe(gear);
  expect(t.parkingBrake).toBe(false);
}

/** Wheel-stop box whose near (spawn-side) face is `gap` metres behind the rear tyres. */
function stopBehind(id: VehicleId, spawnZ: number, gap: number): ColliderBox {
  const g = deriveGeometry(profiles[id]);
  const face = spawnZ + g.rearAxleZ + profiles[id].tireRadiusM + gap;
  return {
    id: 'test-stop', kind: 'wheel-stop', centerM: [0, STOP_HALF[1], face + STOP_HALF[2]],
    halfExtentsM: STOP_HALF, yawRad: 0,
  };
}

const curbAt = (x: number): ColliderBox => ({
  id: 'test-curb', kind: 'curb', centerM: [x, CURB_HALF[1], 0], halfExtentsM: CURB_HALF, yawRad: 0,
});

describe('tyre-edge physics in the rig', () => {
  it.each(IDS)('%s: creeps back onto a 0.11 m stop and rests touching, never climbing', (id) => {
    const f = setup(id, [stopBehind(id, 0, 0.15)], { x: 0, z: 0 });
    shift(f, 'R');
    let firstTouch = -1;
    let touchZ = 0;
    let maxSeparation = 0;
    let worst = 'none';
    let finalTouching = 0;
    let finalSteps = 0;
    let maxDy = 0;
    let prev = f.rig.snapshot(f.t);
    let snap = prev;
    const steps = Math.round(4 / H);
    for (let i = 0; i < steps; i++) {
      snap = step(f, idle);
      const rear = [snap.wheelEdges[2], snap.wheelEdges[3]];
      for (const w of snap.wheelEdges) {
        if (w.state === 'climbing' || w.state === 'over') worst = w.state;
      }
      for (let w = 0; w < 4; w++) {
        maxDy = Math.max(maxDy,
          Math.abs(snap.wheelPoses[w].positionM[1] - prev.wheelPoses[w].positionM[1]));
      }
      prev = snap;
      const z = snap.telemetry.pose.positionM[2];
      if (firstTouch < 0 && rear[0].state === 'touching') { firstTouch = f.t; touchZ = z; }
      // Reversing moves +Z into the stop; separation is travel back toward -Z from first touch.
      if (firstTouch >= 0) maxSeparation = Math.max(maxSeparation, touchZ - z);
      if (i >= steps - Math.round(1 / H)) {
        finalSteps += 1;
        if (rear.every((w) => w.state === 'touching')) finalTouching += 1;
      }
    }
    const fraction = finalTouching / finalSteps;
    record(`${id} creep-stop: first touch ${firstTouch.toFixed(3)} s, max separation `
      + `${maxSeparation.toFixed(4)} m, touching ${(fraction * 100).toFixed(1)}% of final 1 s, end speed `
      + `${snap.telemetry.totalSpeedMps.toFixed(4)} m/s, max wheel dy/step ${maxDy.toFixed(4)} m`);
    expect(firstTouch).toBeGreaterThan(0);
    expect(worst).toBe('none');
    expect(maxSeparation).toBeLessThanOrEqual(0.03);
    expect(fraction).toBeGreaterThanOrEqual(0.9);
    expect(snap.wheelEdges[2].kind).toBe('wheel-stop');
    expect(snap.wheelEdges[2].colliderId).toBe('test-stop');
    expect(snap.telemetry.totalSpeedMps).toBeLessThan(0.05);
    expect(maxDy).toBeLessThanOrEqual(0.01);
  });

  const rank = { none: 0, touching: 1, climbing: 2, over: 3 } as const;
  /** Reverse at `speed` onto a stop `gap` m behind the rear tyres: furthest state, max wheel dy/step. */
  function approachStop(id: VehicleId, speed: number) {
    const f = setup(id, [stopBehind(id, 0, 0.3)], { x: 0, z: 0 });
    shift(f, 'R');
    f.rig.body.velocity.set(0, 0, speed);
    let prev = f.rig.snapshot(f.t);
    let maxDy = 0;
    let best: keyof typeof rank = 'none';
    for (let i = 0; i < Math.round(2 / H); i++) {
      const snap = step(f, idle);
      for (let w = 0; w < 4; w++) {
        maxDy = Math.max(maxDy,
          Math.abs(snap.wheelPoses[w].positionM[1] - prev.wheelPoses[w].positionM[1]));
        const st = snap.wheelEdges[w].state;
        if (rank[st] > rank[best]) best = st;
      }
      prev = snap;
    }
    record(`${id} ${speed} m/s approach: furthest state ${best}, max wheel dy/step ${maxDy.toFixed(4)} m`);
    return { best, maxDy };
  }

  it.each(IDS)('%s: a 1 m/s approach onto a 0.11 m stop raises the wheels smoothly', (id) => {
    const { best, maxDy } = approachStop(id, 1);
    // Edge impact compliance holds a 1 m/s axle impact below half height (it reaches touching).
    expect(rank[best]).toBeGreaterThanOrEqual(rank.touching);
    expect(maxDy).toBeLessThanOrEqual(0.01);
  });

  it.each(IDS)('%s: a 1.5 m/s approach climbs a 0.11 m stop without a pop', (id) => {
    const { best, maxDy } = approachStop(id, 1.5);
    expect(rank[best]).toBeGreaterThanOrEqual(rank.climbing);
    expect(maxDy).toBeLessThanOrEqual(0.35 * 2 * STOP_HALF[1]);
  });

  it.each(IDS)('%s: rolls over a 0.11 m stop at 3 m/s without a wheel-height pop', (id) => {
    const f = setup(id, [stopBehind(id, 0, 0.5)], { x: 0, z: 0 });
    shift(f, 'R');
    f.rig.body.velocity.set(0, 0, 3);
    let prev = f.rig.snapshot(f.t);
    let maxRise = 0;
    let reachedOver = false;
    let overSpeed = 0;
    for (let i = 0; i < Math.round(2 / H) && !reachedOver; i++) {
      const snap = step(f, idle);
      for (let w = 0; w < 4; w++) {
        maxRise = Math.max(maxRise, snap.wheelPoses[w].positionM[1] - prev.wheelPoses[w].positionM[1]);
      }
      if (snap.wheelEdges[2].state === 'over' && snap.wheelEdges[3].state === 'over') {
        reachedOver = true;
        overSpeed = snap.telemetry.totalSpeedMps;
      }
      prev = snap;
    }
    record(`${id} momentum-climb: over ${reachedOver} at ${overSpeed.toFixed(3)} m/s, `
      + `max wheel rise/step ${maxRise.toFixed(4)} m (limit 0.0385)`);
    expect(reachedOver).toBe(true);
    // A rigid tyre rises along the corner arc; no single step may exceed 35% of the 0.11 m edge.
    expect(maxRise).toBeLessThanOrEqual(0.35 * 2 * STOP_HALF[1] + 1e-12);
  });

  it.each(IDS)('%s: side-rubs a parallel 0.11 m curb as touching, never climbing', (id) => {
    const p = profiles[id];
    const faceX = 4.05;
    const x = faceX - 0.05 - TYRE_HALF_WIDTH_M - p.trackM / 2;
    const f = setup(id, [curbAt(faceX + CURB_HALF[0])], { x, z: 0 });
    shift(f, 'R');
    let touched = false;
    let bad = '';
    for (let i = 0; i < Math.round(3 / H); i++) {
      // Reverse at creep (about 0.5 m/s) steering left: the right side swings into the curb.
      const snap = step(f, frame({ steering: 0.15 }));
      snap.wheelEdges.forEach((w, k) => {
        if (w.state === 'climbing' || w.state === 'over') bad = `${k}:${w.state}`;
        if (w.state === 'touching') {
          expect(w.kind).toBe('curb');
          if (k === 1 || k === 3) touched = true;
        }
      });
    }
    const end = f.rig.snapshot(f.t);
    record(`${id} side-rub: touched ${touched}, speed ${end.telemetry.totalSpeedMps.toFixed(3)} m/s,`
      + ` x ${end.telemetry.pose.positionM[0].toFixed(3)}`);
    expect(bad).toBe('');
    expect(touched).toBe(true);
  });

  const LOCK_CASES = IDS.flatMap((id) => (['D', 'R'] as const).flatMap((gear) =>
    [1, -1, 0.6, -0.6].flatMap((steering) => [0.3, 0.8].map((gap) => ({ id, gear, steering, gap })))));
  it.each(LOCK_CASES)('$id: creeping in $gear at steering $steering from $gap m never climbs the curb',
    ({ id, gear, steering, gap }) => {
      const p = profiles[id];
      const faceX = 4.05;
      const x = faceX - gap - TYRE_HALF_WIDTH_M - p.trackM / 2;
      const f = setup(id, [curbAt(faceX + CURB_HALF[0])], { x, z: 0 });
      shift(f, gear);
      let worst = 'none';
      let touched = false;
      for (let i = 0; i < Math.round(8 / H); i++) {
        const snap = step(f, frame({ steering }));
        for (const w of snap.wheelEdges) {
          if (w.state === 'touching') touched = true;
          if (w.state === 'climbing' || w.state === 'over') worst = w.state;
        }
      }
      record(`${id} creep ${gear} steer ${steering} gap ${gap}: touched ${touched}, worst ${worst}`);
      expect(worst).toBe('none');
    });

  /*
   * Roadside parallel parking: stopped (brake held) or creeping (no throttle) with the curb-side
   * tyres' outer face `gap` m from the 0.11 m curb face, parallel to it, the learner turns the wheel
   * to full lock toward the curb (right, steering -1). Turning toward a curb only ever rubs it.
   */
  const STEER_GAPS = [0.02, 0.05, 0.1, 0.15] as const;
  const STEER_CASES = IDS.flatMap((id) => (['D', 'R'] as const).flatMap((gear) =>
    (['brake', 'creep'] as const).flatMap((mode) => (['gamepad', 'keyboard'] as const).flatMap(
      (source) => STEER_GAPS.map((gap) => ({ id, gear, mode, source, gap }))))));
  it.each(STEER_CASES)('$id: $mode in $gear, $source steer to lock toward the curb from $gap m '
    + 'only rubs it', ({ id, gear, mode, source, gap }) => {
    const p = profiles[id];
    const faceX = 4.05;
    const x = faceX - gap - TYRE_HALF_WIDTH_M - p.trackM / 2;
    const f = setup(id, [curbAt(faceX + CURB_HALF[0])], { x, z: 0 });
    const contacts: (string | null)[] = [];
    f.rig.onContact((c) => contacts.push(c));
    shift(f, gear);
    const curbH = 2 * CURB_HALF[1];
    // Plan half-length of the tyre at curb-top height (ground-to-corner first-touch distance).
    const reach = Math.sqrt(2 * p.tireRadiusM * curbH - curbH * curbH);
    const input = frame({ source, steering: -1, brake: mode === 'brake' ? 1 : 0 });
    let prev = f.rig.snapshot(f.t);
    let worst = '';
    let maxRise = 0;
    let touched = false;
    let reachedFace = false;
    let missedTouch = '';
    for (let i = 0; i < Math.round(3 / H); i++) {
      const snap = step(f, input);
      for (let w = 0; w < 4; w++) {
        const st = snap.wheelEdges[w].state;
        if ((st === 'climbing' || st === 'over') && !worst) {
          worst = `${w}:${st} at ${f.t.toFixed(3)} s`;
        }
        if (st === 'touching') touched = true;
        maxRise = Math.max(maxRise, snap.wheelPoses[w].positionM[1] - prev.wheelPoses[w].positionM[1]);
      }
      // Curb-side wheels (1, 3): plan footprint at curb height clearly past the face => touching.
      for (const w of [1, 3]) {
        const { positionM: c, rotation: q } = snap.wheelPoses[w];
        const axle = new CANNON.Quaternion(...q).vmult(new CANNON.Vec3(1, 0, 0));
        const len = Math.hypot(axle.x, axle.z);
        const extent = reach * Math.abs(axle.z / len) + TYRE_HALF_WIDTH_M * Math.abs(axle.x / len);
        if (c[0] + extent >= faceX + 0.005) {
          reachedFace = true;
          if (snap.wheelEdges[w].state !== 'touching' && !missedTouch) {
            missedTouch = `${w}:${snap.wheelEdges[w].state} at ${f.t.toFixed(3)} s`;
          }
        }
      }
      prev = snap;
    }
    const end = f.rig.snapshot(f.t);
    record(`${id} ${mode} ${gear} ${source} steer-to-curb gap ${gap}: worst ${worst || 'none'}, `
      + `max wheel rise/step ${maxRise.toFixed(4)} m, touched ${touched}, reached face ${reachedFace}, `
      + `missed ${missedTouch || '-'}, end speed ${end.telemetry.totalSpeedMps.toFixed(3)}`);
    expect(worst).toBe('');
    expect(maxRise).toBeLessThanOrEqual(0.01);
    expect(missedTouch).toBe('');
    expect(contacts).toEqual([]);
    if (reachedFace) expect(touched).toBe(true);
  });

  const ANGLE_CASES = IDS.flatMap((id) => (['D', 'R'] as const).flatMap((gear) =>
    [15, 30, 45, 60, 75, 90].map((angleDeg) => ({ id, gear, angleDeg }))));
  it.each(ANGLE_CASES)('$id: creeping straight in $gear at $angleDeg deg to the curb never climbs it',
    ({ id, gear, angleDeg }) => {
      // Heading angleDeg from the curb line, toward the curb face at x = 4.05.
      const world = createWorld();
      const cleanup = addColliderBoxes(world, [ground, curbAt(4.05 + CURB_HALF[0])]);
      const rig = createVehicleRig(world, profiles[id], cleanup.idForBody, cleanup.edges);
      const a = angleDeg * Math.PI / 180;
      // Forward is (-sin yaw, -cos yaw): yaw -a heads +x in D; in R the rear leads, so yaw +a.
      // About 1 m of plan gap between the body's curb-side extent and the curb face.
      const x0 = 4.05 - (2.5 * Math.sin(a) + 1.0 * Math.cos(a)) - 1.0;
      rig.settle({ positionM: [x0, profiles[id].centerOfMassHeightM, 0],
        yawRad: gear === 'D' ? -a : a });
      const f: Fixture = { world, rig, cleanup, t: 0 };
      shift(f, gear);
      let worst = 'none';
      let touched = false;
      let arrival = 0;
      for (let i = 0; i < Math.round(14 / H); i++) {
        const snap = step(f, idle);
        for (const w of snap.wheelEdges) {
          if (w.state !== 'none' && !touched) { touched = true; arrival = snap.telemetry.totalSpeedMps; }
          if (w.state === 'climbing' || w.state === 'over') worst = w.state;
        }
      }
      record(`${id} creep ${gear} at ${angleDeg} deg: touched ${touched} at ${arrival.toFixed(3)} m/s, `
        + `worst ${worst}`);
      expect(touched).toBe(true);
      expect(worst).toBe('none');
    });

  const DIVE_CASES = IDS.flatMap((id) => (['D', 'R'] as const).flatMap((gear) =>
    [0, 0.4, -0.4].map((steering) => ({ id, gear, steering }))));
  it.each(DIVE_CASES)('$id: hard brake dive in $gear (steering $steering) beside a 0.11 m curb '
    + 'keeps the chassis clear', ({ id, gear, steering }) => {
    const p = profiles[id];
    const faceX = 4.05;
    const x = faceX - 0.02 - TYRE_HALF_WIDTH_M - p.trackM / 2;
    const f = setup(id, [curbAt(faceX + CURB_HALF[0])], { x, z: 0 });
    const contacts: (string | null)[] = [];
    f.rig.onContact((c) => contacts.push(c));
    shift(f, gear);
    // Forward is -Z at yaw 0: 2 m/s in the selected gear's direction.
    f.rig.body.velocity.set(0, 0, gear === 'D' ? -2 : 2);
    let minY = Infinity;
    let minOverCurbY = Infinity;
    // Corners whose plan position is within half a metre of the curb face (could reach it).
    let minNearCurbY = Infinity;
    const g = deriveGeometry(p);
    for (let i = 0; i < Math.round(2 / H); i++) {
      step(f, frame({ brake: 1, steering }));
      // Lowest chassis-box corner height (world), as a clearance witness.
      const [hx, hy, hz] = g.chassis.halfExtentsM;
      const [cx, cy, cz] = g.chassis.centerLocalM;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const v = f.rig.body.pointToWorldFrame(new CANNON.Vec3(cx + sx * hx, cy - hy, cz + sz * hz));
        minY = Math.min(minY, v.y);
        if (v.x >= faceX) minOverCurbY = Math.min(minOverCurbY, v.y);
        if (v.x >= faceX - 0.5) minNearCurbY = Math.min(minNearCurbY, v.y);
      }
    }
    const curbTop = 2 * CURB_HALF[1];
    const mm = (y: number) => (Number.isFinite(y) ? `${((y - curbTop) * 1000).toFixed(3)} mm` : 'n/a');
    // minY is the most conservative (any corner, even across the car from the curb); minNearCurbY
    // counts corners within 0.5 m of the face in plan, minOverCurbY only corners above the curb.
    record(`${id} brake-dive ${gear} steer ${steering}: min chassis corner y ${minY.toFixed(5)} m, `
      + `any corner vs curb top ${mm(minY)}, corners within 0.5 m of the face ${mm(minNearCurbY)}, `
      + `above the curb ${mm(minOverCurbY)}, end speed `
      + `${f.rig.snapshot(f.t).telemetry.totalSpeedMps.toFixed(3)}`);
    expect(contacts).toEqual([]);
    // The simulation is deterministic; 2 mm is a margin, so a tuning change that eats clearance
    // fails here before it shows as a chassis hit.
    expect(minNearCurbY - curbTop).toBeGreaterThanOrEqual(0.002);
  });

  /** Curb square across the path 4 m ahead (-Z), like driving over the roadside curb. */
  const across: ColliderBox = {
    id: 'test-curb-across', kind: 'curb', centerM: [0, CURB_HALF[1], -4],
    halfExtentsM: [16, CURB_HALF[1], CURB_HALF[0]], yawRad: 0,
  };
  /** Drive at `speed` toward the curb; peak deceleration, per-axle minimum speed on the curb. */
  function crossCurb(id: VehicleId, speed: number, throttle: number) {
    const f = setup(id, [across], { x: 0, z: 0 });
    shift(f, 'D');
    f.rig.body.velocity.set(0, 0, -speed);
    let prevV = speed;
    let peakDecel = 0;
    let frontMin = Infinity;
    let rearMin = Infinity;
    let frontCrossed = false;
    let crossed = false;
    let snap = f.rig.snapshot(f.t);
    for (let i = 0; i < Math.round(6 / H) && !crossed; i++) {
      snap = step(f, frame({ throttle }));
      const v = Math.hypot(f.rig.body.velocity.x, f.rig.body.velocity.z);
      peakDecel = Math.max(peakDecel, (prevV - v) / H);
      prevV = v;
      const front = snap.wheelEdges[0].state !== 'none' || snap.wheelEdges[1].state !== 'none';
      const rear = snap.wheelEdges[2].state !== 'none' || snap.wheelEdges[3].state !== 'none';
      const speedNow = snap.telemetry.totalSpeedMps;
      if (front) frontMin = Math.min(frontMin, speedNow);
      if (rear) rearMin = Math.min(rearMin, speedNow);
      if (!front && frontMin < Infinity) frontCrossed = true;
      crossed = !front && !rear && rearMin < Infinity && snap.telemetry.pose.positionM[2] < -6;
    }
    record(`${id} curb crossing ${speed} m/s throttle ${throttle}: peak decel `
      + `${peakDecel.toFixed(1)} m/s^2, min speed front axle on curb ${frontMin.toFixed(3)} m/s, `
      + `rear ${rearMin.toFixed(3)} m/s, crossed ${crossed}, end speed `
      + `${snap.telemetry.totalSpeedMps.toFixed(3)} m/s`);
    return { peakDecel, frontMin, rearMin, frontCrossed, crossed, snap };
  }

  const CROSS_CASES = IDS.flatMap((id) => [
    { id, speed: 2, throttle: 0.3 }, { id, speed: 3, throttle: 0 }, { id, speed: 3, throttle: 0.3 },
  ]);
  it.each(CROSS_CASES)('$id: drives across a 0.11 m curb at $speed m/s (throttle $throttle) and on',
    ({ id, speed, throttle }) => {
      const r = crossCurb(id, speed, throttle);
      expect(r.crossed).toBe(true);
      // The no-damper climb level is about 20 m/s^2; descents must not add a braking jolt.
      expect(r.peakDecel).toBeLessThanOrEqual(25);
      expect(Math.min(r.frontMin, r.rearMin)).toBeGreaterThan(0.5);
    });

  it.each(IDS)('%s: coasting at 2 m/s the front axle descends freely; creep cannot lift the rear',
    (id) => {
      const r = crossCurb(id, 2, 0);
      // The front wheels climb, cross and roll down without being braked on the far side ...
      expect(r.frontCrossed).toBe(true);
      expect(r.peakDecel).toBeLessThanOrEqual(25);
      expect(r.frontMin).toBeGreaterThan(0.5);
      // ... and the rear axle then meets the curb at creep speed, which is momentum-only by design.
      expect(r.crossed).toBe(false);
      expect(r.snap.wheelEdges[2].state).not.toBe('over');
      expect(r.snap.wheelEdges[3].state).not.toBe('over');
    });

  /*
   * No single-step pop onto or off an edge (spec anti-goal; ruling R6): coasting through a 0.11 m
   * curb or stop forward and in reverse, square and at 20 and 30 deg, over the whole crossing
   * (climb, top and far-side descent). Each wheel's height may change per step by at most 0.01 m
   * for approaches up to 1 m/s and 35% of the edge height otherwise, up or down.
   */
  const POP_CASES = IDS.flatMap((id) => (['D', 'R'] as const).flatMap((gear) =>
    (['curb', 'wheel-stop'] as const).flatMap((kind) => [0, 20, 30].flatMap((angleDeg) =>
      [1, 1.5, 2.5, 3, 4].map((speed) => ({ id, gear, kind, angleDeg, speed }))))));
  it.each(POP_CASES)('$id: coasting in $gear at $speed m/s, $angleDeg deg through a $kind, no pop',
    ({ id, gear, kind, angleDeg, speed }) => {
      const a = angleDeg * Math.PI / 180;
      // Travel direction in world xz (forward is (-sin yaw, -cos yaw); in R the car moves backward).
      const yaw = gear === 'D' ? a : -a;
      const sign = gear === 'D' ? 1 : -1;
      const dir = [-Math.sin(yaw) * sign, -Math.cos(yaw) * sign] as const;
      const half = kind === 'curb' ? [16, CURB_HALF[1], CURB_HALF[0]] as const : STOP_HALF;
      const edge: ColliderBox = {
        id: 'pop-edge', kind, centerM: [dir[0] * 4, half[1], dir[1] * 4], halfExtentsM: half, yawRad: 0,
      };
      const world = createWorld();
      const cleanup = addColliderBoxes(world, [ground, edge]);
      const rig = createVehicleRig(world, profiles[id], cleanup.idForBody, cleanup.edges);
      rig.settle({ positionM: [0, profiles[id].centerOfMassHeightM, 0], yawRad: yaw });
      const f: Fixture = { world, rig, cleanup, t: 0 };
      shift(f, gear);
      rig.body.velocity.set(dir[0] * speed, 0, dir[1] * speed);
      let prev = rig.snapshot(f.t);
      let maxRise = 0;
      let maxDrop = 0;
      let touched = false;
      for (let i = 0; i < Math.round(5 / H); i++) {
        const snap = step(f, idle);
        for (let w = 0; w < 4; w++) {
          const dy = snap.wheelPoses[w].positionM[1] - prev.wheelPoses[w].positionM[1];
          maxRise = Math.max(maxRise, dy);
          maxDrop = Math.min(maxDrop, dy);
          if (snap.wheelEdges[w].state !== 'none') touched = true;
        }
        prev = snap;
      }
      const limit = speed <= 1 ? 0.01 : 0.35 * 2 * half[1];
      record(`${id} pop ${gear} ${kind} ${angleDeg} deg ${speed} m/s: max wheel rise/step `
        + `${maxRise.toFixed(4)} m, drop ${(-maxDrop).toFixed(4)} m (limit ${limit.toFixed(4)})`);
      expect(touched).toBe(true);
      expect(maxRise).toBeLessThanOrEqual(limit + 1e-12);
      expect(-maxDrop).toBeLessThanOrEqual(limit + 1e-12);
    });

  /** Max plan overlap of a curb-side tyre (1, 3) with the curb face while not up on the curb. */
  function curbOverlap(snap: PhysicsSnapshot, id: VehicleId, faceX: number): number {
    let worst = 0;
    for (const w of [1, 3]) {
      const { positionM: c, rotation: q } = snap.wheelPoses[w];
      if (c[1] - profiles[id].tireRadiusM >= 2 * CURB_HALF[1] - 0.01) continue;
      const axle = new CANNON.Quaternion(...q).vmult(new CANNON.Vec3(1, 0, 0));
      const len = Math.hypot(axle.x, axle.z);
      const outer = c[0] + TYRE_HALF_WIDTH_M * Math.abs(axle.x / len);
      // Only while the outer edge is over the curb's own footprint (not past its far face).
      if (c[0] - TYRE_HALF_WIDTH_M * Math.abs(axle.x / len) > faceX + 2 * CURB_HALF[0]) continue;
      worst = Math.max(worst, outer - faceX);
    }
    return worst;
  }

  /*
   * Independent review I1: reversing briskly into a roadside space at a shallow angle (the usual
   * parallel-parking mistake). The tyre that brushes the curb first must then ride up it gradually
   * (climbing before over) and come down the far side gradually, never in one step.
   */
  const SHALLOW_CASES = IDS.flatMap((id) => [10, 20, 30].flatMap((angleDeg) =>
    [1.5, 2.5, 4].map((speed) => ({ id, angleDeg, speed }))));
  it.each(SHALLOW_CASES)('$id: reversing at $speed m/s, $angleDeg deg into the curb rides it gradually',
    ({ id, angleDeg, speed }) => {
      const a = angleDeg * Math.PI / 180;
      const faceX = 4.05;
      const x0 = faceX - (2.5 * Math.sin(a) + 1.0 * Math.cos(a)) - 0.6;
      const world = createWorld();
      const cleanup = addColliderBoxes(world, [ground, curbAt(faceX + CURB_HALF[0])]);
      const rig = createVehicleRig(world, profiles[id], cleanup.idForBody, cleanup.edges);
      rig.settle({ positionM: [x0, profiles[id].centerOfMassHeightM, 0], yawRad: a });
      const f: Fixture = { world, rig, cleanup, t: 0 };
      shift(f, 'R');
      rig.body.velocity.set(speed * Math.sin(a), 0, speed * Math.cos(a));
      let prev = rig.snapshot(f.t);
      let maxStep = 0;
      let skipped = '';
      let overlap = 0;
      for (let i = 0; i < Math.round(3 / H); i++) {
        const snap = step(f, idle);
        for (let w = 0; w < 4; w++) {
          maxStep = Math.max(maxStep,
            Math.abs(snap.wheelPoses[w].positionM[1] - prev.wheelPoses[w].positionM[1]));
          const from = prev.wheelEdges[w].state;
          if (snap.wheelEdges[w].state === 'over' && (from === 'none' || from === 'touching')) {
            skipped ||= `${w}:${from}->over at ${f.t.toFixed(3)} s`;
          }
        }
        overlap = Math.max(overlap, curbOverlap(snap, id, faceX));
        prev = snap;
      }
      record(`${id} shallow R ${angleDeg} deg ${speed} m/s: max wheel dy/step ${maxStep.toFixed(4)} m, `
        + `max tyre overlap with the face ${overlap.toFixed(4)} m, skipped ${skipped || '-'}`);
      expect(maxStep).toBeLessThanOrEqual(0.35 * 2 * CURB_HALF[1]);
      expect(skipped).toBe('');
      expect(overlap).toBeLessThanOrEqual(0.02);
    });

  /*
   * Independent review I2: pinned against the curb after a side-rub, the learner turns to lock
   * toward it and floors the throttle. The tyre must not sink into the curb (overlap <= 2 cm) or
   * flicker vertically; it may climb, gradually.
   */
  const THROTTLE_CASES = IDS.flatMap((id) => (['D', 'R'] as const).map((gear) => ({ id, gear })));
  it.each(THROTTLE_CASES)('$id: full throttle in $gear at lock into a rubbed curb never buries the tyre',
    ({ id, gear }) => {
      const p = profiles[id];
      const faceX = 4.05;
      const x = faceX - 0.05 - TYRE_HALF_WIDTH_M - p.trackM / 2;
      const f = setup(id, [curbAt(faceX + CURB_HALF[0])], { x, z: 0 });
      shift(f, gear);
      let prev = f.rig.snapshot(f.t);
      let maxStep = 0;
      let overlap = 0;
      let skipped = '';
      for (let i = 0; i < Math.round(7.5 / H); i++) {
        // Reverse/creep alongside steering slightly in for 1 s (the brush), then lock + throttle.
        const brush = i < Math.round(1 / H);
        const snap = step(f, frame({ steering: brush ? 0.15 : -1, throttle: brush ? 0 : 1 }));
        for (let w = 0; w < 4; w++) {
          maxStep = Math.max(maxStep,
            Math.abs(snap.wheelPoses[w].positionM[1] - prev.wheelPoses[w].positionM[1]));
          const from = prev.wheelEdges[w].state;
          if (snap.wheelEdges[w].state === 'over' && (from === 'none' || from === 'touching')) {
            skipped ||= `${w}:${from}->over at ${f.t.toFixed(3)} s`;
          }
        }
        overlap = Math.max(overlap, curbOverlap(snap, id, faceX));
        prev = snap;
      }
      record(`${id} throttle-at-lock ${gear}: max wheel dy/step ${maxStep.toFixed(4)} m, max tyre `
        + `overlap with the face ${overlap.toFixed(4)} m, skipped ${skipped || '-'}`);
      expect(overlap).toBeLessThanOrEqual(0.02);
      expect(maxStep).toBeLessThanOrEqual(0.35 * 2 * CURB_HALF[1]);
      expect(skipped).toBe('');
    });

  /*
   * Review M9: a curb rest or rub must not chatter between touching and none, which would repeat
   * the curb warning and inflate curbTouches: each wheel touches in one episode, and there is one
   * curbTouchBegan per manoeuvre (reversing at lock, the front tyre that starts against the curb
   * swings off it a second before the rear one arrives: two contacts, two warnings).
   */
  const CHATTER_CASES = IDS.flatMap((id) => [
    { id, name: 'side-rub reversing with steering 0.15', gear: 'R' as const, steering: 0.15,
      angleDeg: 0 },
    { id, name: 'reversing at lock toward the curb', gear: 'R' as const, steering: -1, angleDeg: 0,
      warnings: 2 },
    { id, name: 'creeping in R at 10 deg until at rest', gear: 'R' as const, steering: 0, angleDeg: 10 },
    { id, name: 'creeping in R at 20 deg until at rest', gear: 'R' as const, steering: 0, angleDeg: 20 },
  ]);
  it.each(CHATTER_CASES)('$id: $name warns once per contact', ({ id, gear, steering, angleDeg,
    warnings = 1 }: { id: VehicleId; gear: 'R'; steering: number; angleDeg: number;
    warnings?: number }) => {
    const p = profiles[id];
    const faceX = 4.05;
    const a = angleDeg * Math.PI / 180;
    const x = angleDeg === 0 ? faceX - 0.05 - TYRE_HALF_WIDTH_M - p.trackM / 2
      : faceX - (2.5 * Math.sin(a) + 1.0 * Math.cos(a)) - 0.3;
    const world = createWorld();
    const cleanup = addColliderBoxes(world, [ground, curbAt(faceX + CURB_HALF[0])]);
    const rig = createVehicleRig(world, p, cleanup.idForBody, cleanup.edges);
    rig.settle({ positionM: [x, p.centerOfMassHeightM, 0], yawRad: a });
    const f: Fixture = { world, rig, cleanup, t: 0 };
    shift(f, gear);
    let prev = rig.snapshot(f.t);
    let begins = 0;
    let worst = 'none';
    const episodes = [0, 0, 0, 0];
    for (let i = 0; i < Math.round(8 / H); i++) {
      const snap = step(f, frame({ steering }));
      if (curbTouchBegan(prev.wheelEdges, snap.wheelEdges)) begins += 1;
      snap.wheelEdges.forEach((w, k) => {
        if (w.state !== 'none' && prev.wheelEdges[k].state === 'none') episodes[k] += 1;
      });
      for (const w of snap.wheelEdges) {
        if (w.state === 'climbing' || w.state === 'over') worst = w.state;
      }
      prev = snap;
    }
    record(`${id} chatter ${gear} steer ${steering} at ${angleDeg} deg: ${begins} curb warning(s), `
      + `per-wheel episodes ${episodes.join('/')}, worst ${worst}`);
    expect(worst).toBe('none');
    expect(begins).toBe(warnings);
    for (const n of episodes) expect(n).toBeLessThanOrEqual(1);
  });

  it.each(IDS)('%s: a far stop leaves flat-ground creep bit-identical', (id) => {
    const far: ColliderBox = {
      id: 'far-stop', kind: 'wheel-stop', centerM: [0, STOP_HALF[1], -20],
      halfExtentsM: STOP_HALF, yawRad: 0,
    };
    const drive = (useEdges: boolean) => {
      const f = setup(id, [far], { x: 0, z: 0 }, useEdges);
      expect(f.cleanup.edges.length).toBe(1);
      shift(f, 'D');
      let snap = f.rig.snapshot(f.t);
      for (let i = 0; i < Math.round(3 / H); i++) snap = step(f, frame({ steering: 0.2 }));
      return snap;
    };
    const a = drive(true);
    const b = drive(false);
    const flat = (s: PhysicsSnapshot) => [s.telemetry.pose, ...s.wheelPoses]
      .flatMap((p) => [...p.positionM, ...p.rotation]);
    const fa = flat(a);
    const fb = flat(b);
    fa.forEach((v, i) => expect(Math.abs(v - fb[i])).toBeLessThan(1e-9));
    expect(a.wheelEdges.every((w) => w.state === 'none')).toBe(true);
  });
});

const GARAGE_STOP_STAGES: readonly StageId[] = [1, 2, 4];
const STAGE_CASES = GARAGE_STOP_STAGES.flatMap((stageId) =>
  IDS.map((id) => ({ stageId, id })));

interface LessonFixture extends Fixture {
  readonly stageId: StageId;
  readonly stopId: string;
  readonly leading: 'front' | 'rear';
  readonly contacts: (string | null)[];
  dwell: number;
  failure: FailureEvent | null;
}

/** Lesson world (environment + scenario colliders), car square to the target, `gap` m before touching. */
function lessonSetup(stageId: StageId, id: VehicleId, gap: number): LessonFixture {
  const scenario = scenarios[stageId];
  const [stop] = wheelStops(scenario);
  if (!stop) throw new Error(`stage ${stageId} has no wheel stop`);
  const { pose, leading } = wheelStopTouchingPose(scenario, stop, profiles[id]);
  const heading = scenario.target.region.headingRad;
  // Back the car away from the stop: world (sin h, cos h) is backward for heading h.
  const away = leading === 'front' ? gap : -gap;
  const x = pose.positionM[0] + Math.sin(heading) * away;
  const z = pose.positionM[2] + Math.cos(heading) * away;
  const world = createWorld();
  const cleanup = addColliderBoxes(world, collidersForScenario(scenario));
  const rig = createVehicleRig(world, profiles[id], cleanup.idForBody, cleanup.edges);
  rig.settle({ positionM: [x, profiles[id].centerOfMassHeightM, z], yawRad: heading });
  const contacts: (string | null)[] = [];
  rig.onContact((c) => contacts.push(c));
  return { world, rig, cleanup, t: 0, stageId, stopId: stop.id, leading, contacts, dwell: 0,
    failure: null };
}

function lessonStep(f: LessonFixture, input: InputFrame,
  actions: readonly InputAction[] = []): PhysicsSnapshot {
  const snap = step(f, input, actions);
  const scenario = scenarios[f.stageId];
  const update = updateFailure(scenario, profiles[snap.telemetry.vehicleId], snap.telemetry,
    collidersForScenario(scenario), f.contacts.at(-1) ?? null, snap.wheelEdges, f.dwell, H);
  f.dwell = update.speedEnvelopeDwellS;
  f.failure ??= update.event;
  return snap;
}

const leadingWheels = (f: LessonFixture, snap: PhysicsSnapshot) =>
  f.leading === 'front' ? [snap.wheelEdges[0], snap.wheelEdges[1]]
    : [snap.wheelEdges[2], snap.wheelEdges[3]];

describe('garage wheel stops in the lesson world', () => {
  it.each(STAGE_CASES)('stage $stageId/$id: a creep approach rests touching, parked, no failure',
    ({ stageId, id }) => {
      const f = lessonSetup(stageId, id, 0.3);
      shift(f, f.leading === 'front' ? 'D' : 'R');
      let snap = f.rig.snapshot(f.t);
      let worst = 'none';
      for (let i = 0; i < Math.round(5 / H); i++) {
        snap = lessonStep(f, idle);
        for (const w of snap.wheelEdges) {
          if (w.state === 'climbing' || w.state === 'over') worst = w.state;
        }
      }
      const scenario = scenarios[stageId];
      const pose = snap.telemetry.pose;
      const yaw = 2 * Math.atan2(pose.rotation[1], pose.rotation[3]);
      const headingErr = Math.abs(Math.atan2(Math.sin(yaw - scenario.target.region.headingRad),
        Math.cos(yaw - scenario.target.region.headingRad)));
      record(`stage ${stageId}/${id} touch rest: (${pose.positionM[0].toFixed(3)}, `
        + `${pose.positionM[2].toFixed(3)}) heading err ${headingErr.toExponential(2)} rad, `
        + `speed ${snap.telemetry.totalSpeedMps.toFixed(4)} m/s`);
      expect(worst).toBe('none');
      for (const w of leadingWheels(f, snap)) {
        expect(w.state).toBe('touching');
        expect(w.colliderId).toBe(f.stopId);
      }
      expect(snap.telemetry.totalSpeedMps).toBeLessThan(0.05);
      expect(footprintInsideRegion(footprint(pose, profiles[id]), scenario.target.region,
        scenario.target.insetM)).toBe(true);
      expect(headingErr).toBeLessThanOrEqual(scenario.target.headingToleranceRad);
      expect(f.contacts).toEqual([]);
      expect(f.failure).toBeNull();
    });

  it.each(STAGE_CASES)('stage $stageId/$id: a 15 km/h approach mounts the stop and fails',
    ({ stageId, id }) => {
      const f = lessonSetup(stageId, id, 0.6);
      shift(f, f.leading === 'front' ? 'D' : 'R');
      const heading = scenarios[stageId].target.region.headingRad;
      const v = (15 / 3.6) * (f.leading === 'front' ? 1 : -1);
      // Forward is local -Z: world (-sin, -cos) * v.
      f.rig.body.velocity.set(-Math.sin(heading) * v, 0, -Math.cos(heading) * v);
      for (let i = 0; i < Math.round(2 / H) && !f.failure; i++) lessonStep(f, idle);
      expect(f.failure).toEqual({ reason: 'wheel-stop-mounted', obstacleId: f.stopId });
    });

  /*
   * Review M5: the measured mount threshold (coasting from 1 m, no brake, leading axle into the
   * stop). Climbing is momentum-only, so a stop is mounted well below 15 km/h: walking pace in
   * reverse (stages 2, 4: 1.5 m/s fails, 1.2 m/s holds) and 2 m/s nose-in (stage 1: 1.5 m/s
   * climbs part way and rolls back). Documented in docs/phase-8-asset-catalog.md.
   */
  const MOUNT_CASES = STAGE_CASES.flatMap(({ stageId, id }) => {
    const [hold, mount] = stageId === 1 ? [1.5, 2] : [1.2, 1.5];
    return [{ stageId, id, speed: hold, mounts: false }, { stageId, id, speed: mount, mounts: true }];
  });
  it.each(MOUNT_CASES)('stage $stageId/$id: coasting into the stop at $speed m/s mounts it: $mounts',
    ({ stageId, id, speed, mounts }) => {
      const f = lessonSetup(stageId, id, 1);
      shift(f, f.leading === 'front' ? 'D' : 'R');
      const heading = scenarios[stageId].target.region.headingRad;
      const v = speed * (f.leading === 'front' ? 1 : -1);
      f.rig.body.velocity.set(-Math.sin(heading) * v, 0, -Math.cos(heading) * v);
      for (let i = 0; i < Math.round(4 / H) && !f.failure; i++) lessonStep(f, idle);
      record(`stage ${stageId}/${id} coast ${speed} m/s: failure ${f.failure?.reason ?? 'none'}`);
      expect(f.failure).toEqual(mounts ? { reason: 'wheel-stop-mounted', obstacleId: f.stopId } : null);
    });

  it.each(IDS)('stage 2/%s: drives away in D after resting against the stop', (id) => {
    const f = lessonSetup(2, id, 0.3);
    shift(f, 'R');
    for (let i = 0; i < Math.round(5 / H); i++) lessonStep(f, idle);
    const rest = f.rig.snapshot(f.t);
    expect(leadingWheels(f, rest).every((w) => w.state === 'touching')).toBe(true);
    step(f, frame({ brake: 0.2 }), [{ type: 'request-gear', gear: 'D' }]);
    expect(f.rig.snapshot(f.t).telemetry.gear).toBe('D');
    let snap = rest;
    for (let i = 0; i < Math.round(3 / H); i++) snap = lessonStep(f, idle);
    const moved = Math.hypot(snap.telemetry.pose.positionM[0] - rest.telemetry.pose.positionM[0],
      snap.telemetry.pose.positionM[2] - rest.telemetry.pose.positionM[2]);
    record(`stage 2/${id} drive-away: moved ${moved.toFixed(3)} m in 3 s`);
    // Forward for heading pi is +Z.
    expect(snap.telemetry.pose.positionM[2]).toBeGreaterThan(rest.telemetry.pose.positionM[2]);
    expect(moved).toBeGreaterThanOrEqual(0.3);
    expect(f.failure).toBeNull();
  });
});
