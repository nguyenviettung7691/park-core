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
const CURB_HALF: readonly [number, number, number] = [0.15, 0.06, 16];

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

  it.each(IDS)('%s: a 1 m/s approach onto a 0.11 m stop raises the wheels smoothly', (id) => {
    const f = setup(id, [stopBehind(id, 0, 0.3)], { x: 0, z: 0 });
    shift(f, 'R');
    f.rig.body.velocity.set(0, 0, 1);
    let prev = f.rig.snapshot(f.t);
    let maxDy = 0;
    let best = 'none';
    const rank = { none: 0, touching: 1, climbing: 2, over: 3 } as const;
    for (let i = 0; i < Math.round(2 / H); i++) {
      const snap = step(f, idle);
      for (let w = 0; w < 4; w++) {
        maxDy = Math.max(maxDy,
          Math.abs(snap.wheelPoses[w].positionM[1] - prev.wheelPoses[w].positionM[1]));
        const st = snap.wheelEdges[w].state;
        if (rank[st] > rank[best as keyof typeof rank]) best = st;
      }
      prev = snap;
    }
    record(`${id} 1 m/s approach: furthest state ${best}, max wheel dy/step ${maxDy.toFixed(4)} m`);
    expect(best).not.toBe('none');
    expect(maxDy).toBeLessThanOrEqual(0.01);
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

  it.each(IDS)('%s: side-rubs a parallel 0.12 m curb as touching, never climbing', (id) => {
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

  it.each(IDS)('%s: hard brake dive beside a 0.12 m curb keeps the chassis clear', (id) => {
    const p = profiles[id];
    const faceX = 4.05;
    const x = faceX - 0.02 - TYRE_HALF_WIDTH_M - p.trackM / 2;
    const f = setup(id, [curbAt(faceX + CURB_HALF[0])], { x, z: 10 });
    const contacts: (string | null)[] = [];
    f.rig.onContact((c) => contacts.push(c));
    shift(f, 'D');
    f.rig.body.velocity.set(0, 0, -2);
    let minY = Infinity;
    const g = deriveGeometry(p);
    for (let i = 0; i < Math.round(2 / H); i++) {
      step(f, frame({ brake: 1 }));
      // Lowest chassis-box corner height (world), as a clearance witness.
      const [hx, hy, hz] = g.chassis.halfExtentsM;
      const [cx, cy, cz] = g.chassis.centerLocalM;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const v = new CANNON.Vec3(cx + sx * hx, cy - hy, cz + sz * hz);
        minY = Math.min(minY, f.rig.body.pointToWorldFrame(v).y);
      }
    }
    const curbTop = 2 * CURB_HALF[1];
    record(`${id} brake-dive: min chassis corner y ${minY.toFixed(4)} m, clearance over curb `
      + `${(minY - curbTop).toFixed(4)} m, end speed ${f.rig.snapshot(f.t).telemetry.totalSpeedMps.toFixed(3)}`);
    expect(contacts).toEqual([]);
    expect(minY - curbTop).toBeGreaterThanOrEqual(0.002);
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
