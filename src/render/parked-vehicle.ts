import { Box3, BufferGeometry, Group, Material, Mesh, Vector3, type Object3D } from 'three';
import type { ColliderBox } from '../runtime-types';

export function createParkedVehicle(template: Object3D, collider: ColliderBox): Group {
  const car = new Group();
  car.name = collider.id;
  const shape = new Group();
  const geometries = new Map<BufferGeometry, BufferGeometry>();
  const materials = new Map<Material, Material>();
  function ownMaterial(material: Material): Material {
    let copy = materials.get(material);
    if (!copy) {
      copy = material.clone();
      materials.set(material, copy);
    }
    return copy;
  }
  for (const name of ['Exterior', 'WheelFL', 'WheelFR', 'WheelRL', 'WheelRR']) {
    const source = template.getObjectByName(name);
    if (!source) throw new Error(`Missing parked-car template node: ${name}`);
    const clone = source.clone(true);
    clone.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const sourceGeometry: BufferGeometry = node.geometry;
      const geometry = geometries.get(sourceGeometry) ?? sourceGeometry.clone();
      geometries.set(sourceGeometry, geometry);
      node.geometry = geometry;
      node.material = Array.isArray(node.material)
        ? node.material.map(ownMaterial) : ownMaterial(node.material);
    });
    shape.add(clone);
  }
  const glazing = shape.getObjectByName('ParkedGlazing');
  if (glazing) glazing.visible = true;
  const exteriorGlazing = shape.getObjectByName('ExteriorGlazing');
  if (exteriorGlazing) exteriorGlazing.visible = false;
  const bounds = new Box3().setFromObject(shape);
  const size = bounds.getSize(new Vector3());
  if ([size.x, size.y, size.z].some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Invalid parked-car template bounds');
  }
  shape.scale.set(collider.halfExtentsM[0] * 2 / size.x,
    collider.halfExtentsM[1] * 2 / size.y, collider.halfExtentsM[2] * 2 / size.z);
  shape.position.copy(bounds.getCenter(new Vector3())).multiply(shape.scale).negate();
  car.add(shape);
  car.position.set(...collider.centerM);
  car.rotation.y = collider.yawRad;
  return car;
}
