import { Color, Quaternion, Scene, Vector3, type Object3D } from 'three';
import type { BodyPose, VehicleTelemetry } from '../contracts';
import type { RenderFrame, SceneAssets } from '../runtime-types';

export const SPEEDOMETER_MAX_KMH = 120;
const SPEEDOMETER_ZERO_RAD = 120 * Math.PI / 180;
const SPEEDOMETER_SWEEP_RAD = 240 * Math.PI / 180;
export const PEDAL_TRAVEL_RAD = 0.3;
/** Hand lever lift while the parking brake is applied (CUV console lever). */
export const PARKING_LEVER_RAD = 0.35;
/** Indicator lamps flash at 1.5 Hz (90 per minute), lit for the first half of each period. */
export const INDICATOR_FLASH_HZ = 1.5;

/** Needle rotation about the dial normal: +120 degrees at rest, clockwise to -120 at full scale. */
export function speedometerAngleRad(speedMps: number): number {
  const fraction = Math.min(1, Math.max(0, Math.abs(speedMps) * 3.6 / SPEEDOMETER_MAX_KMH));
  return SPEEDOMETER_ZERO_RAD - fraction * SPEEDOMETER_SWEEP_RAD;
}

export function indicatorLit(telemetry: VehicleTelemetry, side: 'left' | 'right'): boolean {
  return telemetry.indicator === side &&
    Math.floor(telemetry.simulationTimeS * INDICATOR_FLASH_HZ * 2) % 2 === 0;
}

// Optional named cockpit controls; vehicles without a node are left untouched.
function cockpitControls(vehicle: Object3D) {
  const find = (name: string) => vehicle.getObjectByName(name) ?? null;
  const controls = {
    steering: find('SteeringWheelPivot'),
    needle: find('SpeedometerNeedle'),
    left: find('IndicatorLeftLamp'),
    right: find('IndicatorRightLamp'),
    parking: find('ParkingBrakeLamp'),
    brake: find('BrakePedal'),
    accelerator: find('AcceleratorPedal'),
    lever: find('ParkingBrakeLever'),
  };
  for (const lamp of [controls.left, controls.right, controls.parking]) if (lamp) lamp.visible = false;
  return controls;
}

export interface AssetScene {
  readonly scene: Scene;
  apply(frame: RenderFrame): void;
  dispose(): void;
}

export function createAssetScene(assets: SceneAssets): AssetScene {
  const scene = new Scene();
  scene.background = new Color('#151318');
  scene.add(assets.environment, assets.vehicle);
  const currentPosition = new Vector3();
  const worldPosition = new Vector3();
  const previousRotation = new Quaternion();
  const currentRotation = new Quaternion();
  const parentRotation = new Quaternion();
  const controls = cockpitControls(assets.vehicle);
  let disposed = false;

  function interpolate(node: { position: Vector3; quaternion: Quaternion },
    previous: BodyPose, current: BodyPose, alpha: number) {
    node.position.set(...previous.positionM).lerp(currentPosition.set(...current.positionM), alpha);
    node.quaternion.set(...previous.rotation)
      .slerp(currentRotation.set(...current.rotation), alpha);
  }

  return {
    scene,
    apply(frame) {
      if (disposed) return;
      const { previous, current, alpha } = frame;
      interpolate(assets.vehicle, previous.telemetry.pose, current.telemetry.pose, alpha);
      assets.vehicle.updateMatrixWorld(true);
      for (let index = 0; index < assets.wheelNodes.length; index++) {
        const wheel = assets.wheelNodes[index]!;
        const before = previous.wheelPoses[index]!;
        const after = current.wheelPoses[index]!;
        worldPosition.set(...before.positionM).lerp(currentPosition.set(...after.positionM), alpha);
        const worldRotation = previousRotation.set(...before.rotation)
          .slerp(currentRotation.set(...after.rotation), alpha);
        const parent = wheel.parent;
        if (!parent) throw new Error(`Wheel node ${wheel.name} has no parent`);
        parent.updateWorldMatrix(true, false);
        wheel.position.copy(parent.worldToLocal(worldPosition));
        parent.getWorldQuaternion(parentRotation);
        wheel.quaternion.copy(parentRotation.invert().multiply(worldRotation));
      }
      const was = previous.telemetry, now = current.telemetry;
      const mix = (a: number, b: number) => a + (b - a) * alpha;
      // Positive steering is a left turn: counter-clockwise from the driver's seat.
      controls.steering?.rotation.set(0, 0, mix(was.steeringWheelRad, now.steeringWheelRad));
      controls.needle?.rotation.set(0, 0,
        speedometerAngleRad(mix(was.signedSpeedMps, now.signedSpeedMps)));
      if (controls.left) controls.left.visible = indicatorLit(now, 'left');
      if (controls.right) controls.right.visible = indicatorLit(now, 'right');
      if (controls.parking) controls.parking.visible = now.parkingBrake;
      controls.lever?.rotation.set(now.parkingBrake ? PARKING_LEVER_RAD : 0, 0, 0);
      controls.brake?.rotation.set(PEDAL_TRAVEL_RAD * mix(was.brake, now.brake), 0, 0);
      controls.accelerator?.rotation.set(
        PEDAL_TRAVEL_RAD * mix(was.throttle ?? 0, now.throttle ?? 0), 0, 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.clear();
      assets.dispose();
    },
  };
}
