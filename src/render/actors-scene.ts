import {
  BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, type Material, type Object3D,
} from 'three';
import type { ActorDefinition } from '../contracts';
import type { ActorPose } from '../world/actors';
import { createParkedVehicle } from './parked-vehicle';

export interface ActorsScene {
  readonly group: Group;
  update(previous: readonly ActorPose[], current: readonly ActorPose[], alpha: number): void;
  dispose(): void;
}

const SWING_RAD = 0.5;
const STRIDE_PERIOD_M = 0.7;
const HIP_Y = 0.8;
const SHOULDER_Y = 1.4;

function limb(name: string, size: [number, number, number], pivotY: number, x: number,
  material: Material): Mesh {
  const geometry = new BoxGeometry(...size);
  geometry.translate(0, -size[1] / 2, 0); // pivot at the top (hip / shoulder)
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, pivotY, 0);
  return mesh;
}

/** Six-mesh stand-in, 1.7 m tall with its base at y = 0; the GLB uses the same node names and pivots. */
export function createPlaceholderPedestrian(): Group {
  const root = new Group();
  root.name = 'PedestrianPlaceholder';
  const material = new MeshStandardMaterial({ color: '#4f6d8f', roughness: 0.8 });
  const body = new Mesh(new BoxGeometry(0.4, 0.6, 0.22), material);
  body.name = 'PedestrianBody';
  body.position.y = (HIP_Y + SHOULDER_Y) / 2;
  const head = new Mesh(new SphereGeometry(0.15, 8, 6), material);
  head.name = 'PedestrianHead';
  head.position.y = 1.55;
  root.add(body, head,
    limb('PedestrianLegL', [0.17, HIP_Y, 0.17], HIP_Y, -0.11, material),
    limb('PedestrianLegR', [0.17, HIP_Y, 0.17], HIP_Y, 0.11, material),
    limb('PedestrianArmL', [0.1, 0.6, 0.1], SHOULDER_Y, -0.26, material),
    limb('PedestrianArmR', [0.1, 0.6, 0.1], SHOULDER_Y, 0.26, material));
  return root;
}

/** Deep-copies a template so the clone owns its geometries and materials. */
function cloneOwned(template: Object3D): Object3D {
  const clone = template.clone(true);
  clone.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry = node.geometry.clone();
    node.material = Array.isArray(node.material)
      ? node.material.map((m: Material) => m.clone()) : node.material.clone();
  });
  return clone;
}

function shortestYaw(from: number, to: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}

interface ActorVisual {
  readonly wrapper: Group;
  readonly halfHeightM: number;
  readonly kind: ActorDefinition['kind'];
  readonly lamps: Object3D | undefined;
  readonly legL: Object3D | undefined;
  readonly legR: Object3D | undefined;
  readonly armL: Object3D | undefined;
  readonly armR: Object3D | undefined;
}

export function createActorsScene(
  definitions: readonly ActorDefinition[],
  vehicleTemplate: Object3D,
  pedestrianTemplate: Object3D | null,
): ActorsScene {
  const group = new Group();
  group.name = 'lesson-actors';
  const visuals = new Map<string, ActorVisual>();
  for (const definition of definitions) {
    const wrapper = new Group();
    wrapper.name = definition.id;
    wrapper.visible = false;
    const [, halfHeight] = definition.halfExtentsM;
    let body: Object3D;
    if (definition.kind === 'car') {
      body = createParkedVehicle(vehicleTemplate, { id: definition.id, kind: 'obstacle',
        centerM: [0, halfHeight, 0], halfExtentsM: definition.halfExtentsM, yawRad: 0 });
    } else {
      if (pedestrianTemplate) {
        body = cloneOwned(pedestrianTemplate);
        body.visible = true; // the environment hides its template; the wrapper controls visibility
      } else {
        body = createPlaceholderPedestrian();
      }
    }
    wrapper.add(body);
    group.add(wrapper);
    visuals.set(definition.id, {
      wrapper, halfHeightM: halfHeight, kind: definition.kind,
      lamps: body.getObjectByName('BrakeLampsLit') ?? undefined,
      legL: body.getObjectByName('PedestrianLegL') ?? undefined,
      legR: body.getObjectByName('PedestrianLegR') ?? undefined,
      armL: body.getObjectByName('PedestrianArmL') ?? undefined,
      armR: body.getObjectByName('PedestrianArmR') ?? undefined,
    });
  }

  let disposed = false;
  return {
    group,
    update(previous, current, alpha) {
      if (disposed) return;
      const before = new Map(previous.map((pose) => [pose.id, pose]));
      for (const pose of current) {
        const visual = visuals.get(pose.id);
        if (!visual) continue;
        // An invisible previous pose (finished cycle) must not be lerped from: snap instead.
        const prior = before.get(pose.id);
        const from = prior?.visible ? prior : pose;
        const { wrapper } = visual;
        wrapper.visible = pose.visible;
        wrapper.position.set(
          from.positionM[0] + (pose.positionM[0] - from.positionM[0]) * alpha,
          from.positionM[1] + (pose.positionM[1] - from.positionM[1]) * alpha - visual.halfHeightM,
          from.positionM[2] + (pose.positionM[2] - from.positionM[2]) * alpha);
        wrapper.rotation.y = shortestYaw(from.yawRad, pose.yawRad, alpha);
        if (visual.lamps) visual.lamps.visible = pose.braking;
        if (visual.kind === 'pedestrian') {
          const moving = pose.strideM !== from.strideM;
          const stride = from.strideM + (pose.strideM - from.strideM) * alpha;
          const swing = moving ? SWING_RAD * Math.sin(Math.PI * stride / STRIDE_PERIOD_M) : 0;
          if (visual.legL) visual.legL.rotation.x = swing;
          if (visual.legR) visual.legR.rotation.x = -swing;
          if (visual.armL) visual.armL.rotation.x = -swing;
          if (visual.armR) visual.armR.rotation.x = swing;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const resources = new Set<{ dispose(): void }>();
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        resources.add(object.geometry);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) resources.add(material);
      });
      for (const resource of resources) resource.dispose();
      group.clear();
    },
  };
}
