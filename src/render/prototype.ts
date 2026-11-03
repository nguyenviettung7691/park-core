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
  geometry.mirrors.forEach((mirror, index) => {
    box(chassis, `mirror-${index}`, mirror.halfExtentsM, mirror.centerLocalM, materials[3]!);
  });
  box(chassis, 'prototype-dashboard', [0.75, 0.12, 0.55], [0, 0.25, -0.65], materials[1]!);
  const steeringWheelGeometry = new TorusGeometry(0.18, 0.025, 6, 16);
  geometries.push(steeringWheelGeometry);
  const steeringWheel = new Mesh(steeringWheelGeometry, materials[3]!);
  steeringWheel.name = 'prototype-steering-wheel';
  steeringWheel.position.set(-0.36, 0.42, -0.72);
  chassis.add(steeringWheel);

  const rearSurface = new Mesh(
    new PlaneGeometry(0.24, 0.1),
    new MeshBasicMaterial({ color: 0xffffff }),
  );
  geometries.push(rearSurface.geometry);
  materials.push(rearSurface.material);
  rearSurface.name = 'mirror-surface-rear';
  rearSurface.position.set(0, profile.driverEyeLocalM[1] + 0.12, profile.driverEyeLocalM[2] - 0.75);
  rearSurface.layers.set(MIRROR_EXCLUDED_LAYER);
  chassis.add(rearSurface);

  geometry.mirrors.forEach((mirror, index) => {
    const isLeft = index === 0;
    const surface = new Mesh(
      new PlaneGeometry(0.18, 0.12),
      new MeshBasicMaterial({ color: 0xffffff }),
    );
    geometries.push(surface.geometry);
    materials.push(surface.material);
    surface.name = `mirror-surface-${isLeft ? 'left' : 'right'}`;
    surface.position.set(
      (mirror.centerLocalM[0] + profile.driverEyeLocalM[0]) / 2,
      mirror.centerLocalM[1],
      profile.driverEyeLocalM[2] - 1.5,
    );
    surface.rotation.y = isLeft ? Math.PI / 4 : -Math.PI / 4;
    surface.layers.set(MIRROR_EXCLUDED_LAYER);
    chassis.add(surface);
  });

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
  const yawQuaternion = (yaw: number): readonly [number, number, number, number] =>
    [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const anchors: VehicleAnchors = {
    driverEyeLocalM: geometry.driverEyeLocalM,
    mirrors: {
      rear: {
        positionM: [0, profile.driverEyeLocalM[1] + 0.12, profile.driverEyeLocalM[2] - 0.75],
        rotation: yawQuaternion(Math.PI),
      },
      left: {
        positionM: [
          geometry.mirrors[0].centerLocalM[0] + geometry.mirrors[0].halfExtentsM[0],
          geometry.mirrors[0].centerLocalM[1],
          geometry.mirrors[0].centerLocalM[2],
        ],
        rotation: yawQuaternion(105 * Math.PI / 180),
      },
      right: {
        positionM: [
          geometry.mirrors[1].centerLocalM[0] - geometry.mirrors[1].halfExtentsM[0],
          geometry.mirrors[1].centerLocalM[1],
          geometry.mirrors[1].centerLocalM[2],
        ],
        rotation: yawQuaternion(-105 * Math.PI / 180),
      },
    },
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
