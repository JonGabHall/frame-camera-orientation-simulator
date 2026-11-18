import { describe, expect, it } from "vitest";
import { applySensorMount, fieldOfView } from "../geometry/frameCamera";
import { DEFAULT_CAMERA_STATE } from "./cameraState";
import { cameraTableValues } from "./tableValues";

describe("generated table values", () => {
  it("reports the default sensor position, height and physical camera values", () => {
    const oriented = Object.fromEntries(cameraTableValues(DEFAULT_CAMERA_STATE, "oriented").map(({ name, value }) => [name, value]));
    const frame = Object.fromEntries(cameraTableValues(DEFAULT_CAMERA_STATE, "frame").map(({ name, value }) => [name, value]));
    expect([oriented.X, oriented.Y, oriented.Z, oriented.CameraHeight]).toEqual(["0 m local", "1.7 m local", "115 m local", "115 m"]);
    expect([frame.PerspectiveX, frame.PerspectiveY, frame.PerspectiveZ]).toEqual(["0 m local", "1.7 m local", "115 m local"]);
    expect([oriented.HorizontalFieldOfView, oriented.VerticalFieldOfView]).toEqual(["73.74 deg", "53.13 deg"]);
  });

  it("rotates the lever arm with the vehicle before reporting the camera position", () => {
    const state = {
      ...DEFAULT_CAMERA_STATE,
      vehicle: { position: { x: 10, y: 20, z: 100 }, orientation: { heading: 90, pitch: 90, roll: 0 } },
      sensorMount: { ...DEFAULT_CAMERA_STATE.sensorMount, leverArm: { forward: 3, right: 2, down: 5 } },
    };
    const values = Object.fromEntries(cameraTableValues(state, "frame").map(({ name, value }) => [name, value]));
    expect([values.PerspectiveX, values.PerspectiveY, values.PerspectiveZ]).toEqual(["13 m local", "18 m local", "95 m local"]);
  });

  it("uses resolved pose, ground-relative height and field of view", () => {
    const state = { ...DEFAULT_CAMERA_STATE, groundElevation: 20, vehicle: { position: { x: 100, y: 200, z: 120 }, orientation: { heading: 30, pitch: 90, roll: 0 } } };
    const camera = applySensorMount(state.vehicle.position, state.vehicle.orientation, state.sensorMount);
    const values = Object.fromEntries(cameraTableValues(state, "oriented").map(({ name, value }) => [name, value]));
    expect(parseFloat(values.X)).toBeCloseTo(camera.position.x, 2);
    expect(parseFloat(values.CameraHeight)).toBeCloseTo(camera.position.z - 20, 2);
    expect(parseFloat(values.HorizontalFieldOfView)).toBeCloseTo(fieldOfView(state.intrinsics).horizontalFieldOfView, 2);
  });

  it("uses frame camera units and does not invent an Esri orientation", () => {
    const values = Object.fromEntries(cameraTableValues(DEFAULT_CAMERA_STATE, "frame").map(({ name, value }) => [name, value]));
    expect(values.FocalLength).toBe("24000 microns");
    expect(values.PixelSize).toBe("30 microns");
    expect(values["Omega / Phi / Kappa"]).toContain("not verified");
  });

  it("flags non-square pixels and invalid camera height", () => {
    const state = { ...DEFAULT_CAMERA_STATE, groundElevation: 200, intrinsics: { ...DEFAULT_CAMERA_STATE.intrinsics, sensorHeight: 12 } };
    expect(cameraTableValues(state, "frame").find(({ name }) => name === "PixelSize")?.value).toContain("non-square");
    expect(cameraTableValues(state, "oriented").find(({ name }) => name === "CameraHeight")?.value).toContain("outside Esri range");
  });
});