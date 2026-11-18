import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_STATE } from "../state/cameraState";
import { TARGET_FACE_COLORS, TARGET_SINGLE_COLOR, type TargetShapeKind } from "../state/sceneObjects";
import { createImageSpaceViewer } from "./imageSpaceViewer";

function renderTarget(shape: TargetShapeKind, position: { x: number; y: number; z: number }, imageRotation = 0) {
  const fills: string[] = [];
  const rotations: number[] = [];
  const context = {
    fillStyle: "", strokeStyle: "", lineWidth: 0, globalAlpha: 1,
    clearRect: () => {}, fillRect: () => {}, save: () => {}, restore: () => {},
    beginPath: () => {}, closePath: () => {}, rect: () => {}, clip: () => {},
    moveTo: () => {}, lineTo: () => {}, stroke: () => {}, strokeRect: () => {},
    fill: () => fills.push(context.fillStyle), arc: () => {}, roundRect: () => {},
    translate: () => {}, rotate: (angle: number) => rotations.push(angle),
    setLineDash: () => {}, fillText: () => {}, strokeText: () => {}, measureText: () => ({ width: 40 }),
  };
  const canvas = { width: 1200, height: 800, getContext: () => context } as unknown as HTMLCanvasElement;
  const view = createImageSpaceViewer(canvas);
  view.setTargetShape(shape);
  view.update({
    ...DEFAULT_CAMERA_STATE,
    vehicle: { position, orientation: { heading: 0, pitch: 90, roll: 0 } },
    sensorMount: { leverArm: { forward: 0, right: 0, down: 0 }, orientation: { heading: 0, pitch: 90, roll: 0 } },
    intrinsics: { ...DEFAULT_CAMERA_STATE.intrinsics, imageRotation },
  });
  return { fills, rotations };
}

describe("image-space target", () => {
  it.each(["box", "sphere", "cone", "cylinder"] as const)("draws the visible part of a %s crossing the camera plane", (shape) => {
    const { fills } = renderTarget(shape, { x: 20, y: 0, z: 18 });
    const colors = shape === "box" ? Object.values(TARGET_FACE_COLORS) : [TARGET_SINGLE_COLOR];
    expect(fills.some((color) => colors.includes(color))).toBe(true);
  });

  it("points the off-frame indicator in the rotated image direction", () => {
    const { rotations } = renderTarget("box", { x: 100, y: -50, z: 18 }, 90);
    expect(rotations.at(-1)).toBeCloseTo(Math.PI / 2);
  });
});