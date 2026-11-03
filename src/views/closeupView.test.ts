import { describe, expect, it, vi } from "vitest";
import { applySensorMount, cameraAxesFromHeadingPitchRoll, type Vec3 } from "../geometry/frameCamera";
import { DEFAULT_CAMERA_STATE } from "../state/cameraState";
import { createCloseupView } from "./closeupView";

vi.mock("../ui/layout", () => ({ observeCanvasSize: () => () => {} }));

function project(point: Vec3): [number, number] {
  const azimuth = 35 * Math.PI / 180;
  const elevation = 25 * Math.PI / 180;
  return [
    point.x * Math.cos(azimuth) - point.y * Math.sin(azimuth),
    -(point.x * Math.sin(azimuth) + point.y * Math.cos(azimuth)) * Math.sin(elevation) - point.z * Math.cos(elevation),
  ];
}

describe("close-up view", () => {
  it("draws the vehicle and camera using their resolved combined pose", () => {
    const strokes: { color: string; lines: number[][] }[] = [];
    let lines: number[][] = [];
    let start: number[] = [];
    const context = {
      strokeStyle: "",
      beginPath: () => { lines = []; },
      moveTo: (x: number, y: number) => { start = [x, y]; },
      lineTo: (x: number, y: number) => { lines.push([...start, x, y]); },
      stroke: () => { strokes.push({ color: context.strokeStyle, lines: [...lines] }); },
      measureText: () => ({ width: 100 }),
      clearRect: () => {}, fillRect: () => {}, closePath: () => {}, fill: () => {},
      strokeText: () => {}, fillText: () => {}, arc: () => {}, roundRect: () => {},
    };
    const canvas = {
      width: 700, height: 500, style: {}, getContext: () => context,
      addEventListener: () => {}, removeEventListener: () => {},
    } as unknown as HTMLCanvasElement;
    const view = createCloseupView(canvas);
    const state = {
      ...DEFAULT_CAMERA_STATE,
      vehicle: { position: { x: 1200, y: -300, z: 400 }, orientation: { heading: 47, pitch: 110, roll: 23 } },
      sensorMount: { leverArm: { forward: 3, right: -2, down: 4 }, orientation: { heading: 31, pitch: 35, roll: -17 } },
    };
    view.update(state);

    const lever = strokes.find((stroke) => stroke.color === "#ffffff")!.lines[0];
    const vehicle = strokes.find((stroke) => stroke.color === "rgba(234, 244, 255, 0.55)")!.lines;
    const sensor = strokes.find((stroke) => stroke.color === "rgba(255, 90, 95, 0.85)")!.lines;
    const bodyAxes = cameraAxesFromHeadingPitchRoll(state.vehicle.orientation);
    const camera = applySensorMount({ x: 0, y: 0, z: 0 }, state.vehicle.orientation, state.sensorMount);
    const cameraAxes = cameraAxesFromHeadingPitchRoll(camera.orientation);
    const projectedLever = project(camera.position);
    const scale = (lever[2] - lever[0]) / projectedLever[0];
    expect(lever[3] - lever[1]).toBeCloseTo(projectedLever[1] * scale);

    const expectEdge = (line: number[], direction: Vec3, length: number) => {
      const projected = project(direction);
      expect(line[2] - line[0]).toBeCloseTo(projected[0] * length * scale);
      expect(line[3] - line[1]).toBeCloseTo(projected[1] * length * scale);
    };
    expectEdge(vehicle[0], bodyAxes.up, 1.1);
    expectEdge(vehicle[1], bodyAxes.right, 2.2);
    expectEdge(vehicle[2], bodyAxes.forward, 4.4);
    expectEdge(sensor[0], cameraAxes.up, 0.68);
    expectEdge(sensor[1], cameraAxes.right, 0.9);
    expectEdge(sensor[2], cameraAxes.forward, 0.9);
    view.destroy();
  });
});