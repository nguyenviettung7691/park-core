import {
  BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  Quaternion, Scene, Vector3, type PerspectiveCamera,
} from 'three';
import type { BodyPose, VehicleProfile } from '../contracts';
import type { ColliderBox, RenderFrame } from '../runtime-types';
import { deriveGeometry } from '../vehicle/geometry';

export interface PrototypeScene {
  readonly scene: Scene;
  apply(frame: RenderFrame, camera: PerspectiveCamera): void;
  dispose(): void;
}

export function buildPrototypeScene(
  profile: VehicleProfile, boxes: readonly ColliderBox[],
): PrototypeScene {
  const scene = new Scene();
  scene.background = new Color('#151318');
  const geometries: (BoxGeometry | CylinderGeometry)[] = [];
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
  for (const collider of boxes) {
    const mesh = box(scene, collider.id, collider.halfExtentsM, collider.centerM,
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
  const tire = new CylinderGeometry(profile.tireRadiusM, profile.tireRadiusM, 0.18, 12);
  tire.rotateZ(Math.PI / 2);
  geometries.push(tire);
  const wheels = Array.from({ length: 4 }, (_, index) => {
    const mesh = new Mesh(tire, materials[4]!);
    mesh.name = `wheel-${index}`;
    scene.add(mesh);
    return mesh;
  });
  const nextRotation = new Quaternion();
  const nextPosition = new Vector3();
  const offset = new Vector3();
  const look = new Vector3();
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
    dispose() {
      for (const resource of [...geometries, ...materials]) resource.dispose();
      scene.clear();
    },
  };
}
