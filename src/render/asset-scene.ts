import { Color, Quaternion, Scene, Vector3 } from 'three';
import type { BodyPose } from '../contracts';
import type { RenderFrame, SceneAssets } from '../runtime-types';

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
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.clear();
      assets.dispose();
    },
  };
}
