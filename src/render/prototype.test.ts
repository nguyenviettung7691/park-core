import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, PerspectiveCamera } from 'three';
import { createAssetScene } from './asset-scene';
import { buildPrototypeScene } from './prototype';
import { profiles } from '../vehicle/profiles';
import { addColliderBoxes, createWorld, prototypeSpawn, prototypeYard } from '../world/colliders';
import { createVehicleRig } from '../vehicle/rig';

it('derives visible boxes from collider metadata and interpolates chassis, wheels and camera together', () => {
  const world = createWorld();
  const remove = addColliderBoxes(world, prototypeYard);
  const rig = createVehicleRig(world, profiles.sedan);
  rig.settle(prototypeSpawn(profiles.sedan));
  const previous = rig.snapshot(0);
  rig.body.position.x += 2;
  world.step(1 / 120);
  const current = rig.snapshot(1 / 120);
  const content = buildPrototypeScene(profiles.sedan, prototypeYard);
  const camera = new PerspectiveCamera();
  content.apply({ previous, current, alpha: 0.5 }, camera);
  const ground = content.scene.getObjectByName('ground');
  expect(ground).toBeInstanceOf(Mesh);
  if (!(ground instanceof Mesh) || !(ground.geometry instanceof BoxGeometry)) {
    throw new Error('Ground box missing');
  }
  expect(ground.geometry.parameters.width).toBe(40);
  expect(ground.geometry.parameters.height).toBe(1);
  const barrier = content.scene.getObjectByName('barrier');
  expect(barrier).toBeInstanceOf(Mesh);
  if (!(barrier instanceof Mesh) || !(barrier.geometry instanceof BoxGeometry)) {
    throw new Error('Barrier box missing');
  }
  expect(barrier.geometry.parameters.depth).toBe(0.1);
  expect(content.scene.getObjectByName('vehicle')?.position.x).toBeCloseTo(1, 2);
  for (let index = 0; index < 4; index++) {
    expect(content.scene.getObjectByName(`wheel-${index}`)?.position.x)
      .toBeCloseTo((previous.wheelPoses[index]!.positionM[0] + current.wheelPoses[index]!.positionM[0]) / 2, 6);
  }
  expect(camera.position.x).toBeCloseTo(1, 2);
  content.dispose(); rig.dispose(); remove();
});

it('gives the box vehicle a DriverSeat group that the asset scene moves by the seat offset', () => {
  const content = buildPrototypeScene(profiles.sedan, []);
  const seat = content.assets.vehicle.getObjectByName('DriverSeat');
  expect(seat).toBeInstanceOf(Group);
  if (!seat) throw new Error('DriverSeat missing');
  expect(seat.parent).toBe(content.assets.vehicle);
  expect(seat.children.some((child) => child instanceof Mesh)).toBe(true);
  const authored = seat.position.clone();
  // Seat sits under the driver eye on the driver (left) side.
  expect(authored.x).toBeCloseTo(profiles.sedan.driverEyeLocalM[0], 6);
  expect(authored.y).toBeLessThan(profiles.sedan.driverEyeLocalM[1]);
  const sceneContent = createAssetScene(content.assets);
  sceneContent.setSeatOffset({ foreAftM: 0.1, heightM: -0.03 });
  expect(seat.position.x).toBeCloseTo(authored.x, 9);
  expect(seat.position.y).toBeCloseTo(authored.y - 0.03, 9);
  expect(seat.position.z).toBeCloseTo(authored.z + 0.1, 9);
  sceneContent.dispose();
});
