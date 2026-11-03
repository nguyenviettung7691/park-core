import { Color, Vector4, type Camera, type ColorRepresentation, type Scene, type WebGLRenderTarget } from 'three';

export interface RendererPort {
  render(scene: Scene, camera: Camera): void;
  setRenderTarget(target: WebGLRenderTarget | null): void;
  getRenderTarget(): WebGLRenderTarget | null;
  setViewport(x: number, y: number, width: number, height: number): void;
  getViewport(target: Vector4): Vector4;
  setScissor(x: number, y: number, width: number, height: number): void;
  getScissor(target: Vector4): Vector4;
  setScissorTest(enabled: boolean): void;
  getScissorTest(): boolean;
  setClearColor(color: ColorRepresentation, alpha?: number): void;
  getClearColor(target: Color): Color;
  getClearAlpha(): number;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
}

export interface AuxiliaryPass {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly target: WebGLRenderTarget | null;
  readonly viewport: readonly [number, number, number, number];
  readonly scissor: readonly [number, number, number, number] | null;
  readonly scissorTest: boolean;
  readonly layerMask: number;
}

export function renderAuxiliaryPass(renderer: RendererPort, pass: AuxiliaryPass): void {
  const target = renderer.getRenderTarget();
  const viewport = renderer.getViewport(new Vector4()).clone();
  const scissor = renderer.getScissor(new Vector4()).clone();
  const scissorTest = renderer.getScissorTest();
  const clearColor = renderer.getClearColor(new Color()).clone();
  const clearAlpha = renderer.getClearAlpha();
  const layerMask = pass.camera.layers.mask;

  try {
    renderer.setRenderTarget(pass.target);
    renderer.setViewport(...pass.viewport);
    if (pass.scissor) renderer.setScissor(...pass.scissor);
    renderer.setScissorTest(pass.scissorTest);
    pass.camera.layers.mask = pass.layerMask;
    renderer.render(pass.scene, pass.camera);
  } finally {
    renderer.setRenderTarget(target);
    renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
    renderer.setScissor(scissor.x, scissor.y, scissor.z, scissor.w);
    renderer.setScissorTest(scissorTest);
    renderer.setClearColor(clearColor, clearAlpha);
    pass.camera.layers.mask = layerMask;
  }
}
