import {
  BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  PlaneGeometry, Quaternion, Scene, TorusGeometry, Vector3, type PerspectiveCamera,
} from 'three';
import type { BodyPose, VehicleProfile } from '../contracts';
import {
  MIRROR_EXCLUDED_LAYER,
  type ColliderBox,
  type RenderFrame,
  type SceneAssets,
  type VehicleAnchors,
} from '../runtime-types';
import { deriveVehicleAssetContract } from '../vehicle/asset-contract';
import { deriveGeometry } from '../vehicle/geometry';

export interface PrototypeScene {
  readonly scene: Scene;
  readonly assets: SceneAssets;
  apply(frame: RenderFrame, camera: PerspectiveCamera): void;
  dispose(): void;
}

export function buildPrototypeScene(
  profile: VehicleProfile, boxes: readonly ColliderBox[],
): PrototypeScene {
  const scene = new Scene();
  scene.background = new Color('#151318');
  const geometries: (BoxGeometry | CylinderGeometry | PlaneGeometry | TorusGeometry)[] = [];
  const materials = [0x302936, 0x4a4252, 0x9b59b6, 0xd5b1e3, 0x151318]
    .map((color) => new MeshBasicMaterial({ color }));
  function box(
    parent: Scene | Group, name: string, half: readonly [number, number, number],
    center: readonly [number, number, number], material: MeshBasicMaterial,
  ) {
    const geometry = new BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2);
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...center);
    parent.add(mesh);
    return mesh;
  }
  const environment = new Group();
  environment.name = 'environment';
  scene.add(environment);
  for (const collider of boxes) {
    const mesh = box(environment, collider.id, collider.halfExtentsM, collider.centerM,
      materials[collider.kind === 'ground' ? 0 : 1]!);
    mesh.rotation.y = collider.yawRad;
  }
  const chassis = new Group();
  chassis.name = 'vehicle';
  scene.add(chassis);
  const geometry = deriveGeometry(profile);
  box(chassis, 'chassis', geometry.chassis.halfExtentsM, geometry.chassis.centerLocalM, materials[2]!);
  box(chassis, 'prototype-dashboard', [0.75, 0.12, 0.55], [0, 0.25, -0.65], materials[1]!);
  const steeringWheelGeometry = new TorusGeometry(0.18, 0.025, 6, 16);
  geometries.push(steeringWheelGeometry);
  const steeringWheel = new Mesh(steeringWheelGeometry, materials[3]!);
  steeringWheel.name = 'prototype-steering-wheel';
  // Wheel sits ahead of the eye, as in the authored cockpits (eye z - 0.5 m).
  steeringWheel.position.set(-0.36, 0.42, profile.driverEyeLocalM[2] - 0.5);
  chassis.add(steeringWheel);

  // Glass faces sit at the shared contract poses; side housings sit just behind them.
  const contract = deriveVehicleAssetContract(profile);
  const mirrorSpecs = contract.mirrors;
  for (const id of ['rear', 'left', 'right'] as const) {
    const spec = mirrorSpecs[id];
    const surface = new Mesh(
      new PlaneGeometry(spec.halfSizeM[0] * 2, spec.halfSizeM[1] * 2),
      new MeshBasicMaterial({ color: 0xffffff }),
    );
    geometries.push(surface.geometry);
    materials.push(surface.material);
    surface.name = `mirror-surface-${id}`;
    surface.position.set(...spec.positionM);
    surface.quaternion.set(...spec.rotation);
    surface.layers.set(MIRROR_EXCLUDED_LAYER);
    chassis.add(surface);
    if (id === 'rear') continue;
    const housing = box(chassis, `mirror-${id === 'left' ? 0 : 1}`,
      [spec.halfSizeM[0] + 0.0125, spec.halfSizeM[1] + 0.0125, 0.025], [0, 0, 0], materials[3]!);
    housing.quaternion.set(...spec.rotation);
    housing.position.set(...spec.positionM)
      .add(new Vector3(0, 0, -0.03).applyQuaternion(housing.quaternion));
  }

  const tire = new CylinderGeometry(profile.tireRadiusM, profile.tireRadiusM, 0.18, 12);
  tire.rotateZ(Math.PI / 2);
  geometries.push(tire);
  const wheel = (index: number) => {
    const mesh = new Mesh(tire, materials[4]!);
    mesh.name = `wheel-${index}`;
    scene.add(mesh);
    return mesh;
  };
  const wheels = [wheel(0), wheel(1), wheel(2), wheel(3)] as const;
  const nextRotation = new Quaternion();
  const nextPosition = new Vector3();
  const offset = new Vector3();
  const look = new Vector3();
  const anchors: VehicleAnchors = {
    driverEyeLocalM: geometry.driverEyeLocalM,
    headClearance: contract.headClearance,
    mirrors: mirrorSpecs,
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const resource of [...geometries, ...materials]) resource.dispose();
    scene.clear();
  };
  const assets: SceneAssets = {
    environment,
    vehicle: chassis,
    wheelNodes: wheels,
    anchors,
    dispose,
  };
  function pose(node: Group | Mesh, previous: BodyPose, current: BodyPose, alpha: number) {
    node.position.set(...previous.positionM).lerp(nextPosition.set(...current.positionM), alpha);
    node.quaternion.set(...previous.rotation).slerp(nextRotation.set(...current.rotation), alpha);
  }
  return {
    scene,
    apply(frame, camera) {
      pose(chassis, frame.previous.telemetry.pose, frame.current.telemetry.pose, frame.alpha);
      wheels.forEach((wheel, index) => {
        pose(wheel, frame.previous.wheelPoses[index]!, frame.current.wheelPoses[index]!, frame.alpha);
      });
      offset.set(0, 3.5, 8).applyQuaternion(chassis.quaternion);
      camera.position.copy(chassis.position).add(offset);
      look.set(0, 0.5, 0).add(chassis.position);
      camera.lookAt(look);
    },
    assets,
    dispose,
  };
}
