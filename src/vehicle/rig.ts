/*
 * Friction adapter derived from cannon-es 0.20.0 RaycastVehicle:
 * https://github.com/pmndrs/cannon-es/blob/v0.20.0/src/objects/RaycastVehicle.ts
 *
 * Copyright (c) 2015 cannon.js Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import * as CANNON from 'cannon-es';
import type {
  BodyPose, Gear, Indicator, InputAction, InputFrame, SpawnPose, Vec3Data, VehicleProfile,
} from '../contracts';
import type { ControlNotice, PhysicsSnapshot } from '../runtime-types';
import { GRAVITY_MPS2, deriveGeometry } from './geometry';
import { ackermann, stepKeyboardSteering } from './steering';

export type SimulationStateReason = 'non-finite' | 'settle-failed' | 'settle-contact';

export class SimulationStateError extends Error {
  readonly reason: SimulationStateReason;
  constructor(reason: SimulationStateReason) {
    super(`Simulation state error: ${reason}`);
    this.name = 'SimulationStateError';
    this.reason = reason;
  }
}

export interface VehicleRig {
  readonly body: CANNON.Body; readonly vehicle: CANNON.RaycastVehicle;
  settle(spawn: SpawnPose): void;
  applyInput(frame: InputFrame, actions: readonly InputAction[], h: number): readonly ControlNotice[];
  snapshot(simulationTimeS: number): PhysicsSnapshot;
  supports(): readonly [boolean, boolean, boolean, boolean];
  onContact(listener: () => void): () => void;
  dispose(): void;
}

type Flags = readonly [boolean, boolean, boolean, boolean];

const SETTLE_STEP_S = 1 / 120;
const SETTLE_MAX_STEPS = 360;
const SETTLE_MIN_STEPS = 60;
const SETTLE_SPEED_MPS = 0.01;
const GEAR_SPEED_MPS = 0.1;
const GEAR_BRAKE = 0.2;
const BRAKE_INHIBIT = 0.02;
const SERVICE_DECEL_MPS2 = 5;
const FRONT_BRAKE_SHARE = 0.6;
const TAPER_START_MPS = 12 / 3.6;
const TAPER_END_MPS = 15 / 3.6;
const CREEP_GAIN_PER_S = 1;
const CREEP_MAX_ACCEL_MPS2 = 0.5;
const NO_SUPPORT: Flags = Object.freeze([false, false, false, false]);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const vec = (v: CANNON.Vec3): Vec3Data => Object.freeze([v.x, v.y, v.z] as const);
const pose = (p: CANNON.Vec3, q: CANNON.Quaternion): BodyPose =>
  Object.freeze({ positionM: vec(p), rotation: Object.freeze([q.x, q.y, q.z, q.w] as const) });
const finite = (...values: number[]) => values.every(Number.isFinite);

const fr = {
  vel1: new CANNON.Vec3(), vel2: new CANNON.Vec3(), vel: new CANNON.Vec3(),
  r0: new CANNON.Vec3(), c0: new CANNON.Vec3(), m: new CANNON.Vec3(), cross: new CANNON.Vec3(),
  proj: new CANNON.Vec3(), relPos: new CANNON.Vec3(), relPos2: new CANNON.Vec3(),
  impulse: new CANNON.Vec3(),
};
const forwardWS = [0, 1, 2, 3].map(() => new CANNON.Vec3());
const axleWS = [0, 1, 2, 3].map(() => new CANNON.Vec3());
const RIGHT = new CANNON.Vec3(1, 0, 0);

function impulseDenominator(body: CANNON.Body, pos: CANNON.Vec3, n: CANNON.Vec3): number {
  pos.vsub(body.position, fr.r0);
  fr.r0.cross(n, fr.c0);
  body.invInertiaWorld.vmult(fr.c0, fr.m);
  fr.m.cross(fr.r0, fr.cross);
  return body.invMass + n.dot(fr.cross);
}

function relativeVelocity(a: CANNON.Body, b: CANNON.Body, p: CANNON.Vec3, dir: CANNON.Vec3) {
  a.getVelocityAtWorldPoint(p, fr.vel1);
  b.getVelocityAtWorldPoint(p, fr.vel2);
  fr.vel1.vsub(fr.vel2, fr.vel);
  return dir.dot(fr.vel);
}

/**
 * Cannon-es 0.20.0 updateFriction with one correction from the Bullet btRaycastVehicle it ports:
 * the braking/rolling impulse that targets zero contact velocity is divided by the number of
 * wheels on the ground. Without it every braked wheel independently cancels the whole chassis
 * velocity, and four braked wheels form a divergent per-step oscillation (measured gain ~-2.1,
 * limit cycle ~0.056 m/s with 0.0386 m drift in 3 s under P). All other logic is unchanged.
 */
class CorrectedRaycastVehicle extends CANNON.RaycastVehicle {
  override updateFriction(timeStep: number): void {
    const wheels = this.wheelInfos;
    const chassis = this.chassisBody;
    this.numWheelsOnGround = 0;
    for (const w of wheels) {
      if (w.raycastResult.body) this.numWheelsOnGround++;
      w.sideImpulse = 0;
      w.forwardImpulse = 0;
    }
    wheels.forEach((w, i) => {
      const ground = w.raycastResult.body;
      if (!ground) return;
      const axle = axleWS[i];
      this.getWheelTransformWorld(i).vectorToWorldFrame(RIGHT, axle);
      const n = w.raycastResult.hitNormalWorld;
      n.scale(axle.dot(n), fr.proj);
      axle.vsub(fr.proj, axle);
      axle.normalize();
      n.cross(axle, forwardWS[i]);
      forwardWS[i].normalize();
      const p = w.raycastResult.hitPointWorld;
      if (axle.lengthSquared() <= 1.1) {
        const relVel = relativeVelocity(chassis, ground, p, axle);
        w.sideImpulse = -0.2 * relVel / (chassis.invMass + ground.invMass);
      }
    });
    this.sliding = false;
    wheels.forEach((w, i) => {
      const ground = w.raycastResult.body;
      let rolling = 0;
      w.slipInfo = 1;
      if (ground) {
        const maxImpulse = w.brake ? w.brake : 0;
        const p = w.raycastResult.hitPointWorld;
        const vrel = relativeVelocity(chassis, ground, p, forwardWS[i]);
        const denom = impulseDenominator(chassis, p, forwardWS[i])
          + impulseDenominator(ground, p, forwardWS[i]);
        rolling = clamp(-vrel / denom / this.numWheelsOnGround, -maxImpulse, maxImpulse);
        rolling += w.engineForce * timeStep;
        w.slipInfo *= maxImpulse / rolling;
      }
      w.forwardImpulse = 0;
      w.skidInfo = 1;
      if (ground) {
        const maxImp = w.suspensionForce * timeStep * w.frictionSlip;
        w.forwardImpulse = rolling;
        const x = w.forwardImpulse * 0.5 / w.forwardAcceleration;
        const y = w.sideImpulse / w.sideAcceleration;
        const sq = x * x + y * y;
        w.sliding = false;
        if (sq > maxImp * maxImp) {
          this.sliding = true;
          w.sliding = true;
          w.skidInfo *= maxImp / Math.sqrt(sq);
        }
      }
    });
    if (this.sliding) {
      for (const w of wheels) {
        if (w.sideImpulse !== 0 && w.skidInfo < 1) {
          w.forwardImpulse *= w.skidInfo;
          w.sideImpulse *= w.skidInfo;
        }
      }
    }
    wheels.forEach((w, i) => {
      const p = w.raycastResult.hitPointWorld;
      p.vsub(chassis.position, fr.relPos);
      if (w.forwardImpulse !== 0) {
        forwardWS[i].scale(w.forwardImpulse, fr.impulse);
        chassis.applyImpulse(fr.impulse, fr.relPos);
      }
      const ground = w.raycastResult.body;
      if (w.sideImpulse !== 0 && ground) {
        p.vsub(ground.position, fr.relPos2);
        axleWS[i].scale(w.sideImpulse, fr.impulse);
        chassis.vectorToLocalFrame(fr.relPos, fr.relPos);
        fr.relPos.y *= w.rollInfluence;
        chassis.vectorToWorldFrame(fr.relPos, fr.relPos);
        chassis.applyImpulse(fr.impulse, fr.relPos);
        fr.impulse.scale(-1, fr.impulse);
        ground.applyImpulse(fr.impulse, fr.relPos2);
      }
    });
  }
}

export function createVehicleRig(world: CANNON.World, profile: VehicleProfile): VehicleRig {
  const g = deriveGeometry(profile);
  const mass = profile.massKg;
  const body = new CANNON.Body({
    mass,
    linearDamping: profile.linearDamping,
    angularDamping: profile.angularDamping,
    material: new CANNON.Material({ friction: profile.chassisFriction, restitution: 0 }),
  });
  for (const box of [g.chassis, ...g.mirrors]) {
    body.addShape(new CANNON.Box(new CANNON.Vec3(...box.halfExtentsM)),
      new CANNON.Vec3(...box.centerLocalM));
  }
  const vehicle = new CorrectedRaycastVehicle({
    chassisBody: body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2,
  });
  g.wheelMountsLocalM.forEach((mount, i) => {
    vehicle.addWheel({
      radius: profile.tireRadiusM,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      axleLocal: new CANNON.Vec3(1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(...mount),
      suspensionRestLength: profile.suspensionRestLengthM,
      maxSuspensionTravel: profile.suspensionTravelM,
      suspensionStiffness: profile.suspensionStiffness[i],
      dampingCompression: profile.dampingCompression,
      dampingRelaxation: profile.dampingRelaxation,
      maxSuspensionForce: profile.maxSuspensionForceN,
      frictionSlip: profile.frictionSlip,
      rollInfluence: profile.rollInfluence,
      isFrontWheel: i < 2,
      useCustomSlidingRotationalSpeed: false,
    });
  });
  vehicle.addToWorld(world);

  let gear: Gear = 'P';
  let parkingBrake = true;
  let indicator: Indicator = 'off';
  let steering = 0;
  let serviceBrake = 0;
  let support: Flags = NO_SUPPORT;
  let armed = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const forward = new CANNON.Vec3();

  const onBeginContact = (event: { bodyA: CANNON.Body | null; bodyB: CANNON.Body | null }) => {
    if (!armed || disposed) return;
    const other = event.bodyA === body ? event.bodyB : event.bodyB === body ? event.bodyA : null;
    if (!other || other.type !== CANNON.Body.STATIC) return;
    for (const listener of [...listeners]) listener();
  };
  world.addEventListener('beginContact', onBeginContact);

  const worldForward = () => body.quaternion.vmult(new CANNON.Vec3(0, 0, -1), forward);
  const signedSpeed = () => body.velocity.dot(worldForward());

  function applyBrakes(brake: number, h: number) {
    const service = mass * SERVICE_DECEL_MPS2 * brake;
    const front = service * FRONT_BRAKE_SHARE / 2, rear = service * (1 - FRONT_BRAKE_SHARE) / 2;
    const park = gear === 'P' ? mass * GRAVITY_MPS2 / 4 : 0;
    const handbrake = parkingBrake ? mass * GRAVITY_MPS2 / 2 : 0;
    vehicle.setBrake(Math.max(front, park) * h, 0);
    vehicle.setBrake(Math.max(front, park) * h, 1);
    vehicle.setBrake(Math.max(rear, park, handbrake) * h, 2);
    vehicle.setBrake(Math.max(rear, park, handbrake) * h, 3);
  }

  function applySteering() {
    const [left, right] = ackermann(steering, profile);
    vehicle.setSteeringValue(left, 0);
    vehicle.setSteeringValue(right, 1);
    vehicle.setSteeringValue(0, 2);
    vehicle.setSteeringValue(0, 3);
  }

  function assertFinite() {
    const { position: p, quaternion: q, velocity: v, angularVelocity: w } = body;
    if (!finite(p.x, p.y, p.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, w.x, w.y, w.z)) {
      throw new SimulationStateError('non-finite');
    }
  }

  let capturedAtStep = -1;
  // Must run before updateWheelTransform, which clears isInContact; only the first read per step is valid.
  const captureSupport = (): Flags => {
    if (capturedAtStep !== world.stepnumber) {
      capturedAtStep = world.stepnumber;
      support = Object.freeze([
        vehicle.wheelInfos[0]!.isInContact, vehicle.wheelInfos[1]!.isInContact,
        vehicle.wheelInfos[2]!.isInContact, vehicle.wheelInfos[3]!.isInContact,
      ]);
    }
    return support;
  };

  const touchingStatic = () => world.contacts.some((c) =>
    (c.bi === body && c.bj.type === CANNON.Body.STATIC)
    || (c.bj === body && c.bi.type === CANNON.Body.STATIC));

  function clearMotion() {
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.force.setZero();
    body.torque.setZero();
    for (const w of vehicle.wheelInfos) { w.deltaRotation = 0; w.engineForce = 0; }
  }

  return {
    body,
    vehicle,

    settle(spawn) {
      if (disposed) throw new Error('Vehicle rig is disposed');
      armed = false;
      gear = 'P'; parkingBrake = true; indicator = 'off'; steering = 0; serviceBrake = 0;
      const [x, y, z] = spawn.positionM;
      body.position.set(x, y, z);
      body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spawn.yawRad);
      clearMotion();
      applySteering();
      let converged = false;
      for (let i = 0; i < SETTLE_MAX_STEPS && !converged; i++) {
        applyBrakes(0, SETTLE_STEP_S);
        world.step(SETTLE_STEP_S);
        assertFinite();
        converged = i + 1 >= SETTLE_MIN_STEPS
          && body.velocity.length() < SETTLE_SPEED_MPS
          && body.angularVelocity.length() < SETTLE_SPEED_MPS
          && vehicle.wheelInfos.every((w) => w.isInContact);
      }
      if (touchingStatic()) throw new SimulationStateError('settle-contact');
      if (!converged) throw new SimulationStateError('settle-failed');
      support = captureSupport();
      body.position.set(x, body.position.y, z);
      clearMotion();
      for (let i = 0; i < 4; i++) vehicle.updateWheelTransform(i);
      armed = true;
    },

    applyInput(frame, actions, h) {
      if (!finite(frame.brake, frame.throttle, frame.steering, h)) {
        throw new SimulationStateError('non-finite');
      }
      if (h <= 0) throw new RangeError('Physics step must be positive');
      const notices: ControlNotice[] = [];
      const totalSpeed = body.velocity.length();
      const brake = clamp(frame.brake, 0, 1);
      const throttle = clamp(frame.throttle, 0, 1);
      for (const action of actions) {
        if (action.type === 'request-gear') {
          if (totalSpeed < GEAR_SPEED_MPS && brake >= GEAR_BRAKE) gear = action.gear;
          else notices.push(Object.freeze({ messageKey: 'gearRejected' }));
        } else if (action.type === 'toggle-parking-brake') {
          parkingBrake = !parkingBrake;
        } else if (action.type === 'set-indicator') {
          indicator = action.indicator;
        }
      }
      const rawSteer = frame.steering;
      steering = frame.source === 'keyboard'
        ? stepKeyboardSteering(steering, Math.sign(rawSteer), h)
        : clamp(rawSteer, -1, 1);
      applySteering();
      serviceBrake = brake;

      const signed = signedSpeed();
      const direction = gear === 'D' ? 1 : gear === 'R' ? -1 : 0;
      let propulsion = 0;
      if (direction !== 0 && !parkingBrake && brake <= BRAKE_INHIBIT) {
        const directional = signed * direction;
        const target = direction > 0 ? profile.creepForwardMps : profile.creepReverseMps;
        const taper = clamp((TAPER_END_MPS - directional) / (TAPER_END_MPS - TAPER_START_MPS), 0, 1);
        const pedal = throttle * profile.maxDriveForceN * taper;
        const creep = directional < target
          ? clamp(mass * (CREEP_GAIN_PER_S * (target - directional)
            + profile.rollingResistance * GRAVITY_MPS2), 0, mass * CREEP_MAX_ACCEL_MPS2)
          : 0;
        propulsion = direction * Math.max(pedal, creep);
      }
      const resistance = -Math.sign(signed) * Math.min(
        profile.rollingResistance * mass * GRAVITY_MPS2, mass * Math.abs(signed) / h);
      vehicle.applyEngineForce(propulsion / 2 + resistance / 4, 0);
      vehicle.applyEngineForce(propulsion / 2 + resistance / 4, 1);
      vehicle.applyEngineForce(resistance / 4, 2);
      vehicle.applyEngineForce(resistance / 4, 3);
      applyBrakes(brake, h);
      return Object.freeze(notices);
    },

    snapshot(simulationTimeS) {
      if (!Number.isFinite(simulationTimeS)) throw new SimulationStateError('non-finite');
      assertFinite();
      support = captureSupport();
      const wheels = vehicle.wheelInfos.map((w, i) => {
        vehicle.updateWheelTransform(i);
        const t = w.worldTransform;
        if (!finite(t.position.x, t.position.y, t.position.z,
          t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w)) {
          throw new SimulationStateError('non-finite');
        }
        return pose(t.position, t.quaternion);
      });
      const fwd = worldForward();
      return Object.freeze({
        telemetry: Object.freeze({
          simulationTimeS,
          vehicleId: profile.id,
          pose: pose(body.position, body.quaternion),
          headingRad: Math.atan2(-fwd.x, -fwd.z),
          signedSpeedMps: body.velocity.dot(fwd),
          totalSpeedMps: body.velocity.length(),
          angularSpeedRadps: body.angularVelocity.length(),
          steeringWheelRad: steering * profile.steeringWheelLockRad,
          frontWheelAnglesRad: Object.freeze([...ackermann(steering, profile)] as [number, number]),
          gear,
          parkingBrake,
          indicator,
          brake: serviceBrake,
        }),
        wheelPoses: Object.freeze(wheels as [BodyPose, BodyPose, BodyPose, BodyPose]),
      });
    },

    supports: () => support,

    onContact(listener) {
      const entry = () => listener();
      listeners.add(entry);
      return () => { listeners.delete(entry); };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      armed = false;
      listeners.clear();
      world.removeEventListener('beginContact', onBeginContact);
      vehicle.removeFromWorld(world);
    },
  };
}
