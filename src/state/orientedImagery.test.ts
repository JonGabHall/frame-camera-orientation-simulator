import { describe, expect, it } from "vitest";
import { applySensorMount, fieldOfView } from "../geometry/frameCamera";
import { DEFAULT_CAMERA_STATE } from "./cameraState";
import { importOrientedImagery } from "./orientedImagery";

describe("oriented imagery record import", () => {
  it("maps resolved camera pose, height and FOV without inventing a mount", () => {
    const result = importOrientedImagery({ CameraHeading: 42, CameraPitch: 55, CameraRoll: -12, CameraHeight: 75, HorizontalFieldOfView: 70, VerticalFieldOfView: 45, ImageRotation: 10, Radial: "1;2;3" }, DEFAULT_CAMERA_STATE);
    const camera = applySensorMount(result.state.vehicle.position, result.state.vehicle.orientation, result.state.sensorMount);
    expect(camera.orientation.heading).toBeCloseTo(42);
    expect(camera.orientation.pitch).toBeCloseTo(55);
    expect(camera.orientation.roll).toBeCloseTo(-12);
    expect(camera.position.z).toBe(75);
    expect(fieldOfView(result.state.intrinsics).horizontalFieldOfView).toBeCloseTo(70);
    expect(fieldOfView(result.state.intrinsics).verticalFieldOfView).toBeCloseTo(45);
    expect(result.state.intrinsics.imageRotation).toBe(10);
    expect(result.warnings.join(" ")).toContain("Radial");
  });

  it("rejects unknown headings, panoramic FOVs and invalid heights", () => {
    expect(() => importOrientedImagery({ CameraHeading: -999 }, DEFAULT_CAMERA_STATE)).toThrow("CameraHeading");
    expect(() => importOrientedImagery({ HorizontalFieldOfView: 360 }, DEFAULT_CAMERA_STATE)).toThrow("frame camera");
    expect(() => importOrientedImagery({ CameraHeight: 0 }, DEFAULT_CAMERA_STATE)).toThrow("CameraHeight");
  });

  it("uses type-1 orientation angles when individual fields are absent", () => {
    const result = importOrientedImagery({ CameraOrientation: "1|4326|0|-117|34|100|40|60|10" }, DEFAULT_CAMERA_STATE);
    expect(result.state.sensorMount.orientation).toEqual({ heading: 40, pitch: 60, roll: 10 });
    expect(result.warnings.join(" ")).toContain("spatial reference");
  });

  it("rejects records with only unsupported fields", () => {
    expect(() => importOrientedImagery({ Matrix: "1;0;0;0;1;0;0;0;1" }, DEFAULT_CAMERA_STATE)).toThrow("no supported camera values");
  });

  it("converts explicitly unit-labeled camera calibration to millimeters", () => {
    const result = importOrientedImagery({ CameraPitch: 30, FocalLength: 24000, FocalLengthUnit: "microns", PrincipalX: 500, PrincipalY: -250 }, DEFAULT_CAMERA_STATE);
    expect(result.state.intrinsics.focalLength).toBe(24);
    expect(result.state.intrinsics.principalPointX).toBe(0.5);
    expect(result.state.intrinsics.principalPointY).toBe(-0.25);
  });

  it("accepts calibration without camera pose fields", () => {
    const result = importOrientedImagery({ FocalLength: 35, FocalLengthUnit: "mm" }, DEFAULT_CAMERA_STATE);
    expect(result.state.intrinsics.focalLength).toBe(35);
  });

  it("retains missing fields of view when importing a focal length", () => {
    const before = fieldOfView(DEFAULT_CAMERA_STATE.intrinsics);
    const result = importOrientedImagery({ FocalLength: 48, FocalLengthUnit: "mm" }, DEFAULT_CAMERA_STATE);
    const after = fieldOfView(result.state.intrinsics);
    expect(after.horizontalFieldOfView).toBeCloseTo(before.horizontalFieldOfView);
    expect(after.verticalFieldOfView).toBeCloseTo(before.verticalFieldOfView);
    expect(result.warnings.join(" ")).toContain("physical sensor dimensions are unknown");

    const partial = importOrientedImagery({ FocalLength: 48, FocalLengthUnit: "mm", HorizontalFieldOfView: 60 }, DEFAULT_CAMERA_STATE);
    expect(fieldOfView(partial.state.intrinsics).horizontalFieldOfView).toBeCloseTo(60);
    expect(fieldOfView(partial.state.intrinsics).verticalFieldOfView).toBeCloseTo(before.verticalFieldOfView);
  });

  it("ignores unitless calibration, even when its values are invalid", () => {
    const result = importOrientedImagery({ CameraPitch: 30, FocalLength: 0, PrincipalX: "invalid", PrincipalY: false }, DEFAULT_CAMERA_STATE);
    expect(result.state.sensorMount.orientation.pitch).toBe(30);
    expect(result.state.intrinsics).toEqual(DEFAULT_CAMERA_STATE.intrinsics);
    expect(result.warnings.join(" ")).toContain("they are not applied");
    expect(() => importOrientedImagery({ CameraPitch: 30, FocalLength: 0, FocalLengthUnit: "mm" }, DEFAULT_CAMERA_STATE)).toThrow("FocalLength");
    expect(() => importOrientedImagery({ CameraPitch: 30, PrincipalX: "invalid", FocalLengthUnit: "mm" }, DEFAULT_CAMERA_STATE)).toThrow("PrincipalX");
  });

  it("reports conflicting individual and CameraOrientation angles", () => {
    const result = importOrientedImagery({ CameraHeading: 42, CameraOrientation: "1|4326|0|-117|34|100|40|60|10" }, DEFAULT_CAMERA_STATE);
    expect(result.state.sensorMount.orientation.heading).toBe(42);
    expect(result.warnings.join(" ")).toContain("differ from CameraOrientation");
    const equivalent = importOrientedImagery({ CameraHeading: 360, CameraOrientation: "1|4326|0|-117|34|100|0|60|10" }, DEFAULT_CAMERA_STATE);
    expect(equivalent.warnings.join(" ")).not.toContain("differ from CameraOrientation");
  });
});