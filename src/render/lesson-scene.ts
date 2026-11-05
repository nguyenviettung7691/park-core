import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import type { LessonRuntime, OrientedRegion, ScenarioDefinition } from '../contracts';
import { createParkedVehicle } from './parked-vehicle';

const PURPLE = '#9B59B6';
const UP = new Vector3(0, 1, 0);
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

export interface LessonScene {
  readonly group: Group;
  update(runtime: LessonRuntime): void;
  dispose(): void;
}

function orient(mesh: Mesh, region: OrientedRegion): void {
  mesh.position.set(region.centerM[0], mesh.position.y, region.centerM[2]);
  mesh.quaternion.setFromAxisAngle(UP, region.headingRad).multiply(FLAT);
}

function createRegionMesh(
  region: OrientedRegion,
  color: string,
  opacity: number,
  name: string,
): Mesh {
  const mesh = new Mesh(
    new PlaneGeometry(region.halfWidthM * 2, region.halfLengthM * 2),
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  mesh.name = name;
  mesh.position.y = 0.015;
  mesh.renderOrder = 1;
  orient(mesh, region);
  return mesh;
}

export function createLessonScene(scenario: ScenarioDefinition, vehicleTemplate: Object3D): LessonScene {
  const group = new Group();
  group.name = 'lesson-visuals';
  group.add(createRegionMesh(scenario.target.region, PURPLE, 0.2, 'lesson-target'));
  for (const [id, region] of Object.entries(scenario.regions)) {
    group.add(createRegionMesh(region, PURPLE, 0.08, `lesson-region-${id}`));
  }
  const highlight = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ color: PURPLE, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  highlight.name = 'lesson-current-step';
  highlight.position.y = 0.04;
  highlight.renderOrder = 2;
  group.add(highlight);
  for (const collider of scenario.obstacles) group.add(createParkedVehicle(vehicleTemplate, collider));

  let disposed = false;
  return {
    group,
    update(runtime) {
      if (disposed) return;
      const step = scenario.steps[runtime.stepIndex];
      const region = step?.highlightId ? scenario.regions[step.highlightId] : undefined;
      if (!region) {
        highlight.visible = false;
        return;
      }
      highlight.visible = true;
      highlight.scale.set(region.halfWidthM * 2, region.halfLengthM * 2, 1);
      orient(highlight, region);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const resources = new Set<{ dispose(): void }>();
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        resources.add(object.geometry);
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) resources.add(material);
      });
      for (const resource of resources) resource.dispose();
      group.clear();
    },
  };
}
