import { LOOK_LEFT_LIMIT_RAD, LOOK_RIGHT_LIMIT_RAD } from './head-pose';

export type Glance = 'left' | 'right' | 'back';

/** Yaw is positive when looking left (see cameras.ts); pitch is positive when looking up. */
export interface LookPose {
  readonly yawRad: number;
  readonly pitchRad: number;
}

export interface LookStepInput {
  readonly mouseDx: number;
  readonly mouseDy: number;
  /** Gamepad right stick, -1..1; +X is right, +Y is pushed down. */
  readonly stickX: number;
  readonly stickY: number;
  readonly glance: Glance | null;
  /** While true the pose eases to 0/0 and wins over mouse/stick input. Pass it as a one-shot. */
  readonly recenter: boolean;
}

const DEG = Math.PI / 180;
const PITCH_DOWN_LIMIT_RAD = 45 * DEG;
const PITCH_UP_LIMIT_RAD = 35 * DEG;
const MOUSE_RAD_PER_PX = 0.002;
const STICK_DEADZONE = 0.15;
const STICK_YAW_RATE_RAD_S = 180 * DEG;
const STICK_PITCH_RATE_RAD_S = 120 * DEG;
const SPRING_OMEGA = 16;
const SNAP_ANGLE_RAD = 0.05 * DEG;
const SNAP_SPEED_RAD_S = 0.5 * DEG;

const GLANCE_TARGETS: Record<Glance, LookPose> = {
  left: { yawRad: 110 * DEG, pitchRad: 0 },
  right: { yawRad: -110 * DEG, pitchRad: 0 },
  back: { yawRad: -160 * DEG, pitchRad: -5 * DEG },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function stickAxis(v: number): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  return Math.sign(v) * Math.min(1, (a - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

function clampYaw(yaw: number): number {
  return clamp(yaw, -LOOK_RIGHT_LIMIT_RAD, LOOK_LEFT_LIMIT_RAD);
}

function clampPitch(pitch: number): number {
  return clamp(pitch, -PITCH_DOWN_LIMIT_RAD, PITCH_UP_LIMIT_RAD);
}

/**
 * Fixed-step look controller. The free pose (mouse/stick) is frozen while a glance is held,
 * and the displayed pose follows its target with a critically damped spring.
 */
export function createLookController(): {
  step(input: LookStepInput, dtS: number): void;
  pose(): LookPose;
  reset(): void;
} {
  let freeYaw = 0;
  let freePitch = 0;
  let yaw = 0;
  let pitch = 0;
  let yawVel = 0;
  let pitchVel = 0;
  /** True while the displayed pose equals the free pose and follows it directly. */
  let tracking = true;

  function spring(x: number, v: number, target: number, dt: number): [number, number] {
    const acc = SPRING_OMEGA * SPRING_OMEGA * (target - x) - 2 * SPRING_OMEGA * v;
    const nv = v + acc * dt;
    return [x + nv * dt, nv];
  }

  return {
    step(input, dtS) {
      const values = [input.mouseDx, input.mouseDy, input.stickX, input.stickY, dtS];
      if (values.some((v) => !Number.isFinite(v))) throw new RangeError('Look inputs must be finite');
      if (dtS <= 0) throw new RangeError('dtS must be positive');

      const glance = input.glance;
      if (input.recenter) {
        freeYaw = 0;
        freePitch = 0;
        tracking = false;
      } else if (glance === null) {
        const dYaw = -input.mouseDx * MOUSE_RAD_PER_PX - stickAxis(input.stickX) * STICK_YAW_RATE_RAD_S * dtS;
        const dPitch = -input.mouseDy * MOUSE_RAD_PER_PX - stickAxis(input.stickY) * STICK_PITCH_RATE_RAD_S * dtS;
        if (dYaw !== 0 || dPitch !== 0) {
          if (!tracking) {
            // New input cancels an ease back to the free pose and continues from where the view is.
            freeYaw = yaw;
            freePitch = pitch;
            yawVel = 0;
            pitchVel = 0;
            tracking = true;
          }
          freeYaw = clampYaw(freeYaw + dYaw);
          freePitch = clampPitch(freePitch + dPitch);
        }
      }

      if (glance !== null) tracking = false;

      if (tracking) {
        yaw = freeYaw;
        pitch = freePitch;
        return;
      }

      const target = glance !== null ? GLANCE_TARGETS[glance] : { yawRad: freeYaw, pitchRad: freePitch };
      [yaw, yawVel] = spring(yaw, yawVel, target.yawRad, dtS);
      [pitch, pitchVel] = spring(pitch, pitchVel, target.pitchRad, dtS);

      if (
        glance === null &&
        Math.abs(yaw - freeYaw) < SNAP_ANGLE_RAD &&
        Math.abs(pitch - freePitch) < SNAP_ANGLE_RAD &&
        Math.abs(yawVel) < SNAP_SPEED_RAD_S &&
        Math.abs(pitchVel) < SNAP_SPEED_RAD_S
      ) {
        yaw = freeYaw;
        pitch = freePitch;
        yawVel = 0;
        pitchVel = 0;
        tracking = true;
      }
    },
    pose() {
      return { yawRad: yaw, pitchRad: pitch };
    },
    reset() {
      freeYaw = freePitch = yaw = pitch = yawVel = pitchVel = 0;
      tracking = true;
    },
  };
}
