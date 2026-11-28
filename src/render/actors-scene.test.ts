import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ActorDefinition } from '../contracts';
import type { ActorPose } from '../world/actors';
import { vehicleTemplate } from '../test/vehicle-template';
import { createActorsScene, createPlaceholderPedestrian } from './actors-scene';

const definitions: ActorDefinition[] = [
  { id: 'ped-1', kind: 'pedestrian', halfExtentsM: [0.25, 0.85, 0.2], path: [], cruiseMps: 1.4, detour: [] },
  { id: 'car-1', kind: 'car', halfExtentsM: [0.9, 0.7, 2.1], path: [], cruiseMps: 5.56, detour: [] },
] as unknown as ActorDefinition[];

function pose(id: string, patch: Partial<ActorPose> = {}): ActorPose {
  const car = id.startsWith('car');
  return { id, kind: car ? 'car' : 'pedestrian', visible: true,
    positionM: [0, car ? 0.7 : 0.85, 0], yawRad: 0, braking: false, strideM: 0, ...patch };
}

function build() {
  const template = vehicleTemplate();
  const lamp = new Object3D();
  lamp.name = 'BrakeLampsLit';
  template.getObjectByName('Exterior')!.add(lamp);
  return createActorsScene(definitions, template, null);
}

describe('actors scene', () => {
  it('placeholder pedestrian has six named nodes, <= 6 meshes, 1.7 m tall on y = 0', () => {
    const ped = createPlaceholderPedestrian();
    for (const name of ['PedestrianBody', 'PedestrianHead', 'PedestrianLegL', 'PedestrianLegR',
      'PedestrianArmL', 'PedestrianArmR']) expect(ped.getObjectByName(name), name).toBeTruthy();
    let meshes = 0;
    ped.traverse((n) => { if (n instanceof Mesh) meshes += 1; });
    expect(meshes).toBeLessThanOrEqual(6);
    const box = new Box3().setFromObject(ped);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(1.7);
  });

  it('shows a pedestrian cloned from the environment\'s hidden template', () => {
    const template = createPlaceholderPedestrian();
    template.name = 'PedestrianTemplate';
    template.visible = false; // assets.ts hides the template in the environment
    const scene = createActorsScene([definitions[0]], vehicleTemplate(), template);
    scene.update([pose('ped-1')], [pose('ped-1')], 1);
    const clone = scene.group.children[0].children[0];
    expect(clone.name).toBe('PedestrianTemplate');
    expect(clone.visible).toBe(true);
    expect(template.visible).toBe(false);
  });

  it('is named lesson-actors and hides invisible poses', () => {
    const scene = build();
    expect(scene.group.name).toBe('lesson-actors');
    const poses = [pose('ped-1', { visible: false }), pose('car-1')];
    scene.update(poses, poses, 1);
    expect(scene.group.children.map((c) => c.visible)).toEqual([false, true]);
  });

  it('interpolates position and yaw by the shortest arc', () => {
    const scene = build();
    const prev = [pose('ped-1', { positionM: [0, 0.85, 0], yawRad: 3.0 }), pose('car-1')];
    const cur = [pose('ped-1', { positionM: [2, 0.85, 4], yawRad: -3.0 }), pose('car-1')];
    scene.update(prev, cur, 0.5);
    const g = scene.group.children[0]!;
    expect(g.position.x).toBeCloseTo(1);
    expect(g.position.z).toBeCloseTo(2);
    expect(Math.cos(g.rotation.y)).toBeCloseTo(-1, 5);
    expect(Math.abs(Math.abs(g.rotation.y) - Math.PI)).toBeLessThan(0.1);
  });

  it('shows brake lamps only while braking', () => {
    const scene = build();
    const lamp = scene.group.getObjectByName('BrakeLampsLit')!;
    const calm = [pose('ped-1'), pose('car-1')];
    scene.update(calm, calm, 1);
    expect(lamp.visible).toBe(false);
    const braking = [pose('ped-1'), pose('car-1', { braking: true })];
    scene.update(braking, braking, 1);
    expect(lamp.visible).toBe(true);
  });

  it('swings legs with stride and holds still for equal stride', () => {
    const scene = build();
    const leg = scene.group.getObjectByName('PedestrianLegL')!;
    const a = [pose('ped-1', { strideM: 0 }), pose('car-1')];
    const b = [pose('ped-1', { strideM: 0.175 }), pose('car-1')];
    scene.update(a, b, 1);
    expect(leg.rotation.x).toBeCloseTo(0.5 * Math.sin(Math.PI * 0.175 / 0.7));
    const moving = leg.rotation.x;
    scene.update(b, b, 1);
    expect(leg.rotation.x).toBe(0);
    expect(moving).not.toBe(0);
    scene.update(b, b, 1);
    expect(leg.rotation.x).toBe(0);
  });

  it('disposes cloned resources once', () => {
    const scene = build();
    const meshes: Mesh[] = [];
    scene.group.traverse((n) => { if (n instanceof Mesh) meshes.push(n); });
    expect(meshes.length).toBeGreaterThan(0);
    const spies = meshes.flatMap((m) => [vi.spyOn(m.geometry, 'dispose'),
      vi.spyOn(m.material as MeshBasicMaterial, 'dispose')]);
    scene.dispose();
    scene.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });

  it('clones a supplied pedestrian template without sharing resources', () => {
    const tpl = new Group();
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.name = 'PedestrianBody';
    tpl.add(mesh);
    const scene = createActorsScene(definitions, vehicleTemplate(), tpl);
    const clone = scene.group.getObjectByName('PedestrianBody') as Mesh;
    expect(clone.geometry).not.toBe(mesh.geometry);
    const spy = vi.spyOn(mesh.geometry, 'dispose');
    scene.dispose();
    expect(spy).not.toHaveBeenCalled();
  });
});
