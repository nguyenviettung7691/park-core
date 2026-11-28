import {
  Color, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Quaternion, Scene, Vector3, Vector4, WebGLRenderTarget,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BodyPose, VehicleTelemetry } from '../contracts';
import type { ColliderBox, RenderFrame } from '../runtime-types';
import { buildPrototypeScene } from '../render/prototype';
import { profiles } from '../vehicle/profiles';
import { deriveVehicleAssetContract } from '../vehicle/asset-contract';
import type { GraphicsSettings } from './graphics-settings';
import { createViews } from './cameras';
import { reflectPoint } from './mirror-optics';
import { ZERO_MIRROR_OFFSETS } from './mirror-adjust';
import { renderAuxiliaryPass, type RendererPort } from './auxiliary';

interface RenderCall {
  readonly scene: Scene;
  readonly camera: import('three').Camera;
  readonly target: WebGLRenderTarget | null;
  readonly viewport: Vector4;
  readonly scissor: Vector4;
  readonly scissorTest: boolean;
  readonly layerMask: number;
}

class FakeRenderer implements RendererPort {
  target: WebGLRenderTarget | null = null;
  viewport = new Vector4(0, 0, 640, 480);
  scissor = new Vector4(0, 0, 640, 480);
  scissorTest = false;
  clearColor = new Color('#151318');
  clearAlpha = 1;
  readonly targets = new Set<WebGLRenderTarget>();
  readonly calls: RenderCall[] = [];
  onRender: (() => void) | null = null;

  render(scene: Scene, camera: import('three').Camera): void {
    this.calls.push({
      scene,
      camera,
      target: this.target,
      viewport: this.viewport.clone(),
      scissor: this.scissor.clone(),
      scissorTest: this.scissorTest,
      layerMask: camera.layers.mask,
    });
    this.onRender?.();
  }

  setRenderTarget(target: WebGLRenderTarget | null): void {
    this.target = target;
    if (target) this.targets.add(target);
  }

  getRenderTarget(): WebGLRenderTarget | null {
    return this.target;
  }

  setViewport(x: number, y: number, width: number, height: number): void {
    this.viewport.set(x, y, width, height);
  }

  getViewport(target: Vector4): Vector4 {
    return target.copy(this.viewport);
  }

  setScissor(x: number, y: number, width: number, height: number): void {
    this.scissor.set(x, y, width, height);
  }

  getScissor(target: Vector4): Vector4 {
    return target.copy(this.scissor);
  }

  setScissorTest(enabled: boolean): void {
    this.scissorTest = enabled;
  }

  getScissorTest(): boolean {
    return this.scissorTest;
  }

  setClearColor(color: import('three').ColorRepresentation, alpha?: number): void {
    this.clearColor.set(color);
    if (alpha !== undefined) this.clearAlpha = alpha;
  }

  getClearColor(target: Color): Color {
    return target.copy(this.clearColor);
  }

  getClearAlpha(): number {
    return this.clearAlpha;
  }

  clear(_color?: boolean, _depth?: boolean, _stencil?: boolean): void {}
}

function makePass(scene: Scene, camera: PerspectiveCamera, target: WebGLRenderTarget) {
  return {
    scene,
    camera,
    target,
    viewport: [1, 2, 300, 200] as const,
    scissor: [3, 4, 100, 80] as const,
    scissorTest: true,
    layerMask: 2,
  };
}

function makeFrame(
  positionM: readonly [number, number, number] = [0, 0.52, 0],
  headingRad = 0,
  steeringWheelRad = 0,
  gear: VehicleTelemetry['gear'] = 'D',
): RenderFrame {
  const pose: BodyPose = {
    positionM,
    rotation: [0, Math.sin(headingRad / 2), 0, Math.cos(headingRad / 2)],
  };
  const telemetry: VehicleTelemetry = {
    simulationTimeS: 0,
    vehicleId: 'sedan',
    pose,
    headingRad,
    signedSpeedMps: 0,
    totalSpeedMps: 0,
    angularSpeedRadps: 0,
    steeringWheelRad,
    frontWheelAnglesRad: [0, 0],
    gear,
    parkingBrake: false,
    indicator: 'off',
    brake: 0,
  };
  const none = { colliderId: null, kind: null, state: 'none' } as const;
  const snapshot = {
    telemetry, wheelPoses: [pose, pose, pose, pose] as const,
    wheelEdges: [none, none, none, none] as const,
  };
  return { previous: snapshot, current: snapshot, alpha: 0 };
}

function makeFixture(
  boxes: ColliderBox[] = [],
  quality: Pick<GraphicsSettings, 'mirrorQuality' | 'overheadQuality'> = {
    mirrorQuality: 'high',
    overheadQuality: 'high',
  },
) {
  const profile = profiles.sedan;
  const content = buildPrototypeScene(profile, boxes);
  const renderer = new FakeRenderer();
  const views = createViews(renderer, content.scene, content.assets, profile, boxes, quality);
  const draw = (timeMs: number, frame = makeFrame()) => {
    content.apply(frame, new PerspectiveCamera());
    views.render(frame, timeMs);
  };
  return { content, renderer, views, draw, boxes };
}

function lastCameraCall(renderer: FakeRenderer, name: string): RenderCall {
  const calls = renderer.calls.filter((call) => call.camera.name === name);
  const call = calls[calls.length - 1];
  if (!call) throw new Error(`Missing render for ${name}`);
  return call;
}

describe('renderAuxiliaryPass', () => {
  it.each([false, true])('restores renderer and camera state after render (throws: %s)', (throws) => {
    const renderer = new FakeRenderer();
    const originalTarget = new WebGLRenderTarget(18, 19);
    const passTarget = new WebGLRenderTarget(64, 32);
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    camera.layers.mask = 0x1234;
    renderer.setRenderTarget(originalTarget);
    renderer.setViewport(11, 12, 321, 240);
    renderer.setScissor(13, 14, 123, 80);
    renderer.setScissorTest(false);
    renderer.setClearColor('#123456', 0.37);
    const initialColor = renderer.clearColor.clone();
    renderer.onRender = () => {
      renderer.setRenderTarget(null);
      renderer.setViewport(20, 30, 40, 50);
      renderer.setScissor(21, 31, 41, 51);
      renderer.setScissorTest(true);
      renderer.setClearColor('#abcdef', 0.9);
      camera.layers.mask = 0;
      if (throws) throw new Error('render failed');
    };

    const invoke = () => renderAuxiliaryPass(renderer, makePass(scene, camera, passTarget));
    if (throws) expect(invoke).toThrow('render failed');
    else invoke();

    expect(renderer.calls[0]?.layerMask).toBe(2);
    expect(renderer.target).toBe(originalTarget);
    expect(renderer.viewport).toEqual(new Vector4(11, 12, 321, 240));
    expect(renderer.scissor).toEqual(new Vector4(13, 14, 123, 80));
    expect(renderer.scissorTest).toBe(false);
    expect(renderer.clearColor.equals(initialColor)).toBe(true);
    expect(renderer.clearAlpha).toBe(0.37);
    expect(camera.layers.mask).toBe(0x1234);
    originalTarget.dispose();
    passTarget.dispose();
  });
});

describe('prototype view assets', () => {
  it('exposes local anchors and provisional cabin and mirror surfaces', () => {
    const content = buildPrototypeScene(profiles.sedan, []);
    const assets = content.assets;
    expect(assets.vehicle).toBe(content.scene.getObjectByName('vehicle'));
    expect(assets.environment).toBeInstanceOf(Group);
    expect(assets.anchors.driverEyeLocalM[0]).toBeCloseTo(-0.36, 6);
    expect(assets.anchors.driverEyeLocalM[1]).toBeCloseTo(0.6, 6);
    expect(assets.anchors.driverEyeLocalM[2]).toBeCloseTo(-0.665, 6);
    const contract = deriveVehicleAssetContract(profiles.sedan);
    expect(assets.anchors.mirrors).toEqual(contract.mirrors);
    expect(content.scene.getObjectByName('prototype-dashboard')).toBeInstanceOf(Mesh);
    for (const name of ['mirror-surface-rear', 'mirror-surface-left', 'mirror-surface-right']) {
      const surface = content.scene.getObjectByName(name);
      if (!(surface instanceof Mesh)) throw new Error(`Missing ${name}`);
      expect(surface.geometry).toBeInstanceOf(PlaneGeometry);
      const id = name.slice('mirror-surface-'.length) as 'rear' | 'left' | 'right';
      const spec = contract.mirrors[id];
      const { width, height } = (surface.geometry as PlaneGeometry).parameters;
      expect([width / 2, height / 2]).toEqual(spec.halfSizeM);
      expect(surface.position.toArray()).toEqual([...spec.positionM]);
      expect(surface.quaternion.toArray()).toEqual([...spec.rotation]);
      expect((surface.material as import('three').MeshBasicMaterial).color.getHex())
        .toBe(0xffffff);
    }
    content.dispose();
  });
});

describe('camera and auxiliary views', () => {
  const fixtures: ReturnType<typeof makeFixture>[] = [];
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.views.dispose();
      fixture.content.dispose();
    }
  });

  it('binds mirror targets to authored GLB surface names', () => {
    const profile = profiles.sedan;
    const content = buildPrototypeScene(profile, []);
    const renderer = new FakeRenderer();
    for (const id of ['rear', 'left', 'right'] as const) {
      const surface = content.assets.vehicle.getObjectByName(`mirror-surface-${id}`);
      if (!(surface instanceof Mesh)) throw new Error(`Missing mirror surface: ${id}`);
      surface.name = `MirrorSurface${id[0]!.toUpperCase()}${id.slice(1)}`;
    }

    const views = createViews(renderer, content.scene, content.assets, profile, [], {
      mirrorQuality: 'high',
      overheadQuality: 'high',
    });
    for (const id of ['rear', 'left', 'right'] as const) {
      const surface = content.assets.vehicle.getObjectByName(
        `MirrorSurface${id[0]!.toUpperCase()}${id.slice(1)}`,
      );
      expect(surface).toBeInstanceOf(Mesh);
      expect((surface as Mesh).material).toBeInstanceOf(MeshBasicMaterial);
      expect(((surface as Mesh).material as MeshBasicMaterial).map).not.toBeNull();
    }
    views.dispose();
    content.dispose();
  });

  it('bounds driver FOV and look pose, then recenters', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.views.setCamera('driver');
    fixture.views.setFov(100);
    fixture.views.setLookPose({ yawRad: -10, pitchRad: -10 });
    fixture.draw(0);

    const camera = lastCameraCall(fixture.renderer, 'driver-camera').camera as PerspectiveCamera;
    const direction = camera.getWorldDirection(new Vector3());
    expect(camera.fov).toBe(80);
    expect(Math.atan2(-direction.x, -direction.z)).toBeCloseTo(-160 * Math.PI / 180, 2);
    expect(Math.asin(direction.y)).toBeCloseTo(-45 * Math.PI / 180, 2);

    fixture.views.setLookPose({ yawRad: 10, pitchRad: 10 });
    fixture.draw(8);
    const left = lastCameraCall(fixture.renderer, 'driver-camera').camera.getWorldDirection(new Vector3());
    expect(Math.atan2(-left.x, -left.z)).toBeCloseTo(110 * Math.PI / 180, 2);
    expect(Math.asin(left.y)).toBeCloseTo(35 * Math.PI / 180, 2);

    fixture.views.setLookPose({ yawRad: 0, pitchRad: 0 });
    fixture.views.setFov(40);
    fixture.draw(16);
    const centered = lastCameraCall(fixture.renderer, 'driver-camera').camera as PerspectiveCamera;
    const centeredDirection = centered.getWorldDirection(new Vector3());
    expect(centered.fov).toBe(50);
    expect(centeredDirection.x).toBeCloseTo(0, 6);
    expect(centeredDirection.z).toBeCloseTo(-1, 6);
  });

  it('retracts the chase arm immediately and restores it smoothly after clearance', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.views.setCamera('chase');
    fixture.draw(0);
    const camera = lastCameraCall(fixture.renderer, 'chase-camera').camera as PerspectiveCamera;
    const desiredArm = camera.position.distanceTo(new Vector3(0, 0.52, 0));

    fixture.boxes.push({
      id: 'camera-wall',
      kind: 'obstacle',
      centerM: [0, 1.8, 2.5],
      halfExtentsM: [1, 1, 0.2],
      yawRad: 0,
    });

    fixture.draw(16);
    const retractedArm = camera.position.distanceTo(new Vector3(0, 0.52, 0));
    expect(retractedArm).toBeLessThan(desiredArm);

    fixture.boxes.length = 0;
    fixture.draw(32);
    const restoringArm = camera.position.distanceTo(new Vector3(0, 0.52, 0));
    expect(restoringArm).toBeGreaterThan(retractedArm);
    expect(restoringArm).toBeLessThan(desiredArm);
    for (let time = 48; time <= 3048; time += 16) fixture.draw(time);
    expect(camera.position.distanceTo(new Vector3(0, 0.52, 0))).toBeCloseTo(desiredArm, 1);
  });

  it('orbits the chase camera with the look pose and resets it at zero pose', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.views.setCamera('chase');
    fixture.draw(0);
    const camera = lastCameraCall(fixture.renderer, 'chase-camera').camera as PerspectiveCamera;
    const initialPosition = camera.position.clone();

    fixture.views.setLookPose({ yawRad: -0.4, pitchRad: -0.2 });
    fixture.draw(16);
    expect(camera.position.distanceTo(initialPosition)).toBeGreaterThan(0.1);
    const orbitedPosition = camera.position.clone();
    fixture.views.setLookPose({ yawRad: 0, pitchRad: 0 });
    fixture.draw(32);
    expect(camera.position.distanceTo(orbitedPosition)).toBeGreaterThan(0.1);
  });

  it('throttles mirror and overhead captures without catch-up and maps the inset to WebGL pixels', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.views.setCamera('chase');
    fixture.views.setOverhead(true);
    fixture.views.resize(1280, 720, 2);
    for (const time of [0, 30, 66.7, 500, 516]) fixture.draw(time);

    const calls = fixture.renderer.calls;
    expect(calls.filter((call) => call.camera.name === 'chase-camera')).toHaveLength(5);
    expect(calls.filter((call) => call.camera.name.startsWith('mirror-'))).toHaveLength(9);
    const overhead = calls.filter((call) => call.camera.name === 'overhead-camera');
    expect(overhead).toHaveLength(3);
    expect(overhead.every((call) => call.target?.width === 320 && call.target.height === 320)).toBe(true);
    const overheadCamera = overhead[0]?.camera as OrthographicCamera;
    expect(overheadCamera.up.x).toBeCloseTo(0, 6);
    expect(overheadCamera.up.z).toBeCloseTo(-1, 6);

    const composite = lastCameraCall(fixture.renderer, 'overhead-composite');
    expect(composite.viewport).toEqual(new Vector4(1888, 32, 640, 640));
    expect(composite.scissor).toEqual(new Vector4(1888, 32, 640, 640));
    expect(composite.scissorTest).toBe(true);
    expect(overhead.every((call) => (call.layerMask & (1 << 2)) === 0)).toBe(true);
    expect(calls.filter((call) => call.camera.name.startsWith('mirror-'))
      .every((call) => (call.layerMask & (1 << 1)) === 0)).toBe(true);
  });

  it('captures the mirrors on the next render after invalidateMirrors, keeping the cap otherwise', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    const mirrorCount = () => fixture.renderer.calls.filter((call) =>
      call.camera.name.startsWith('mirror-')).length;
    fixture.draw(0);
    fixture.draw(10);
    expect(mirrorCount()).toBe(3);
    fixture.views.invalidateMirrors();
    fixture.draw(10);
    expect(mirrorCount()).toBe(6);
    fixture.draw(20);
    expect(mirrorCount()).toBe(6);
  });

  it('halves mirror and overhead render-target dimensions at low quality', () => {
    const fixture = makeFixture([], { mirrorQuality: 'low', overheadQuality: 'low' });
    fixtures.push(fixture);
    fixture.views.setOverhead(true);
    fixture.draw(0);

    expect(fixture.renderer.calls
      .filter((call) => call.camera.name.startsWith('mirror-'))
      .map((call) => [call.target?.width, call.target?.height]))
      .toEqual([[256, 64], [128, 76], [128, 76]]);
    const overhead = fixture.renderer.calls.find(
      (call) => call.camera.name === 'overhead-camera',
    );
    expect([overhead?.target?.width, overhead?.target?.height]).toEqual([160, 160]);
  });

  it('keeps all mirror surfaces in the driver frustum and faces them away from housings', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.views.resize(1280, 720, 1);
    const inView = (id: 'rear' | 'left' | 'right') => {
      const camera = lastCameraCall(fixture.renderer, 'driver-camera').camera as PerspectiveCamera;
      const surface = fixture.content.scene.getObjectByName(`mirror-surface-${id}`);
      if (!(surface instanceof Mesh)) throw new Error(`Missing mirror surface ${id}`);
      const center = surface.getWorldPosition(new Vector3()).project(camera);
      expect(Math.abs(center.x), id).toBeLessThan(1);
      expect(Math.abs(center.y), id).toBeLessThan(1);
    };
    fixture.draw(0);
    inView('rear');
    inView('left');
    // The passenger mirror sits ~59° right of the eye: a glance (30° look) brings it in.
    fixture.views.setLookPose({ yawRad: -30 * Math.PI / 180, pitchRad: 0 });
    fixture.draw(100);
    inView('right');
    const eye = new Vector3(...fixture.content.assets.anchors.driverEyeLocalM);
    for (const [id, index] of [['left', 0], ['right', 1]] as const) {
      const surface = fixture.content.assets.vehicle.getObjectByName(`mirror-surface-${id}`) as Mesh;
      const housing = fixture.content.assets.vehicle.getObjectByName(`mirror-${index}`) as Mesh;
      const normal = new Vector3(0, 0, 1).applyQuaternion(surface.quaternion);
      expect(eye.clone().sub(surface.position).dot(normal), id).toBeGreaterThan(0);
      expect(housing.position.clone().sub(surface.position).dot(normal), id).toBeLessThan(-0.01);
    }
  });

  it('keeps the mirror frustum rule at both seat extremes', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.views.resize(1280, 720, 1);
    const centre = (id: 'rear' | 'left' | 'right') => {
      const camera = lastCameraCall(fixture.renderer, 'driver-camera').camera as PerspectiveCamera;
      const surface = fixture.content.scene.getObjectByName(`mirror-surface-${id}`) as Mesh;
      return surface.getWorldPosition(new Vector3()).project(camera);
    };
    let time = 0;
    for (const seat of [
      { foreAftM: -0.1, heightM: -0.03 }, { foreAftM: 0.1, heightM: 0.05 },
      { foreAftM: -0.1, heightM: 0.05 }, { foreAftM: 0.1, heightM: -0.03 },
    ]) {
      fixture.views.setSeatOffset(seat);
      fixture.views.setLookPose({ yawRad: 0, pitchRad: 0 });
      fixture.draw(time += 100);
      for (const id of ['rear', 'left'] as const) {
        const c = centre(id);
        expect(Math.abs(c.x), `${id} ${JSON.stringify(seat)}`).toBeLessThan(1);
        expect(Math.abs(c.y), `${id} ${JSON.stringify(seat)}`).toBeLessThan(1);
      }
      fixture.views.setLookPose({ yawRad: -30 * Math.PI / 180, pitchRad: 0 });
      fixture.draw(time += 100);
      const right = centre('right');
      expect(Math.abs(right.x), JSON.stringify(seat)).toBeLessThan(1);
      expect(Math.abs(right.y), JSON.stringify(seat)).toBeLessThan(1);
    }
  });

  it('moves the eye with the seat offset', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.draw(0);
    const camera = lastCameraCall(fixture.renderer, 'driver-camera').camera as PerspectiveCamera;
    const before = camera.position.clone();
    fixture.views.setSeatOffset({ foreAftM: 0.1, heightM: 0.05 });
    fixture.draw(16);
    const delta = camera.position.clone().sub(before);
    expect(delta.x).toBeCloseTo(0, 6);
    expect(delta.y).toBeCloseTo(0.05, 6);
    expect(delta.z).toBeCloseTo(0.1, 6);
    expect(fixture.views.driverEyeLocal()[2]).toBeCloseTo(before.z + 0.1, 6);
  });

  it('translates the eye for a shoulder check', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.draw(0);
    const camera = lastCameraCall(fixture.renderer, 'driver-camera').camera as PerspectiveCamera;
    const before = camera.position.clone();
    fixture.views.setLookPose({ yawRad: 110 * Math.PI / 180, pitchRad: 0 });
    fixture.draw(16);
    const delta = camera.position.clone().sub(before);
    expect(delta.x).toBeCloseTo(-0.06, 6);
    expect(delta.y).toBeCloseTo(0, 6);
    expect(delta.z).toBeCloseTo(-0.05, 6);
  });

  it('shifts mirror cameras with head parallax and keeps three mirror passes per tick', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.draw(0);
    const before = lastCameraCall(fixture.renderer, 'mirror-left-camera').camera.position.clone();
    fixture.views.setLookPose({ yawRad: 110 * Math.PI / 180, pitchRad: 0 });
    fixture.draw(100);
    const after = lastCameraCall(fixture.renderer, 'mirror-left-camera').camera.position;
    expect(after.distanceTo(before)).toBeGreaterThan(0.05);
    expect(fixture.renderer.calls.filter((call) => call.camera.name.startsWith('mirror-'))).toHaveLength(6);
  });

  it('sizes mirror targets from glass aspect', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.draw(0);
    expect(fixture.renderer.calls
      .filter((call) => call.camera.name.startsWith('mirror-'))
      .map((call) => [call.camera.name, call.target?.width, call.target?.height]))
      .toEqual([['mirror-rear-camera', 512, 128], ['mirror-left-camera', 256, 151],
        ['mirror-right-camera', 256, 151]]);
  });

  it('places each mirror camera at the reflected driver eye', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.draw(0, makeFrame([3, 0.52, -2], 0.4));
    const vehicle = fixture.content.assets.vehicle;
    const eye = new Vector3(...fixture.content.assets.anchors.driverEyeLocalM).applyMatrix4(vehicle.matrixWorld);
    for (const id of ['rear', 'left', 'right'] as const) {
      const surface = vehicle.getObjectByName(`mirror-surface-${id}`) as Mesh;
      const spec = fixture.content.assets.anchors.mirrors[id];
      const glass = {
        center: surface.getWorldPosition(new Vector3()),
        quaternion: surface.getWorldQuaternion(new Quaternion()),
        halfSizeM: spec.halfSizeM,
        convexity: spec.convexity,
      };
      const expected = reflectPoint(eye, glass);
      const camera = lastCameraCall(fixture.renderer, `mirror-${id}-camera`).camera;
      expect(camera.position.distanceTo(expected), id).toBeLessThan(1e-6);
    }
  });

  it('follows glass offsets', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    fixture.draw(0);
    const vehicle = fixture.content.assets.vehicle;
    const left = vehicle.getObjectByName('mirror-surface-left') as Mesh;
    const rear = vehicle.getObjectByName('mirror-surface-rear') as Mesh;
    const before = left.quaternion.clone();
    const rearBefore = rear.quaternion.clone();
    const cameraBefore = lastCameraCall(fixture.renderer, 'mirror-left-camera').camera.position.clone();
    fixture.views.setMirrorOffsets({
      ...ZERO_MIRROR_OFFSETS, left: { yawRad: 0.1, pitchRad: 0 },
    });
    fixture.draw(100);
    const expected = before.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1));
    expect(left.quaternion.angleTo(expected)).toBeLessThan(1e-9);
    expect(rear.quaternion.angleTo(rearBefore)).toBeLessThan(1e-9);
    const cameraAfter = lastCameraCall(fixture.renderer, 'mirror-left-camera').camera.position;
    expect(cameraAfter.distanceTo(cameraBefore)).toBeGreaterThan(0.01);
    fixture.views.setMirrorOffsets(ZERO_MIRROR_OFFSETS);
    fixture.draw(200);
    expect(left.quaternion.angleTo(before)).toBeLessThan(1e-9);
  });

  it('highlights only the selected mirror', () => {
    const fixture = makeFixture();
    fixtures.push(fixture);
    const highlight = () => fixture.content.scene.getObjectByName('mirror-highlight');
    expect(highlight()?.visible ?? false).toBe(false);
    fixture.views.setMirrorHighlight('right');
    const outline = highlight();
    expect(outline?.visible).toBe(true);
    expect(outline?.parent?.name).toBe('mirror-surface-right');
    expect(outline?.layers.mask).toBe(1 << 1);
    fixture.views.setMirrorHighlight(null);
    expect(highlight()?.visible ?? false).toBe(false);
  });

  it('disposes each mirror and overhead target exactly once', () => {
    const fixture = makeFixture();
    fixture.views.setOverhead(true);
    fixture.draw(0);
    const targets = [...fixture.renderer.targets];
    expect(targets).toHaveLength(4);
    const dispose = targets.map((target) => vi.spyOn(target, 'dispose'));

    fixture.views.dispose();
    fixture.views.dispose();

    for (const spy of dispose) expect(spy).toHaveBeenCalledTimes(1);
    fixture.content.dispose();
  });
});
