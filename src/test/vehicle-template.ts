import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';

export function vehicleTemplate(): Group {
  const root = new Group();
  const exterior = new Mesh(new BoxGeometry(1.8, 1.2, 4.6), new MeshBasicMaterial());
  exterior.name = 'Exterior';
  exterior.position.y = 0.3;
  root.add(exterior);
  for (const [index, name] of ['WheelFL', 'WheelFR', 'WheelRL', 'WheelRR'].entries()) {
    const wheel = new Mesh(new BoxGeometry(0.2, 0.6, 0.6), exterior.material);
    wheel.name = name;
    wheel.position.set(index % 2 ? 0.78 : -0.78, -0.2, index < 2 ? -1.2 : 1.5);
    root.add(wheel);
  }
  return root;
}
