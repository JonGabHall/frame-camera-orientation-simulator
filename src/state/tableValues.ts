import { applySensorMount, fieldOfView, type FrameCameraState } from "../geometry/frameCamera";

export type TableMode = "frame" | "oriented";
export interface TableValue { name: string; value: string }

function display(value: number, unit = ""): string {
  return `${Number(value.toFixed(3))}${unit ? ` ${unit}` : ""}`;
}

export function cameraTableValues(state: FrameCameraState, mode: TableMode): TableValue[] {
  const camera = applySensorMount(state.vehicle.position, state.vehicle.orientation, state.sensorMount);
  const { intrinsics } = state;
  if (mode === "frame") {
    const pixelWidth = intrinsics.sensorWidth / intrinsics.imageWidth * 1000;
    const pixelHeight = intrinsics.sensorHeight / intrinsics.imageHeight * 1000;
    return [
      { name: "PerspectiveX", value: display(camera.position.x, "m local") },
      { name: "PerspectiveY", value: display(camera.position.y, "m local") },
      { name: "PerspectiveZ", value: display(camera.position.z, "m local") },
      { name: "Omega / Phi / Kappa", value: "Unavailable: Esri convention not verified" },
      { name: "FocalLength", value: display(intrinsics.focalLength * 1000, "microns") },
      { name: "PrincipalX", value: display(intrinsics.principalPointX * 1000, "microns") },
      { name: "PrincipalY", value: display(intrinsics.principalPointY * 1000, "microns") },
      { name: "NColumns", value: display(intrinsics.imageWidth, "px") },
      { name: "NRows", value: display(intrinsics.imageHeight, "px") },
      { name: "PixelSize", value: Math.abs(pixelWidth - pixelHeight) <= Math.max(pixelWidth, pixelHeight) * 1e-8 ? display(pixelWidth, "microns") : "Unavailable: non-square pixels" },
    ];
  }
  const fov = fieldOfView(intrinsics);
  const height = camera.position.z - state.groundElevation;
  const heading = (camera.orientation.heading % 360 + 360) % 360;
  return [
    { name: "X", value: display(camera.position.x, "m local") },
    { name: "Y", value: display(camera.position.y, "m local") },
    { name: "Z", value: display(camera.position.z, "m local") },
    { name: "CameraHeading", value: display(heading, "deg") },
    { name: "CameraPitch", value: display(camera.orientation.pitch, "deg") },
    { name: "CameraRoll", value: `${display(camera.orientation.roll, "deg")}${Math.abs(camera.orientation.roll) > 90 + 1e-8 ? " (outside Esri range)" : ""}` },
    { name: "CameraHeight", value: `${display(height, "m")}${height <= 0 ? " (outside Esri range)" : ""}` },
    { name: "HorizontalFieldOfView", value: display(fov.horizontalFieldOfView, "deg") },
    { name: "VerticalFieldOfView", value: display(fov.verticalFieldOfView, "deg") },
    { name: "FocalLength", value: display(intrinsics.focalLength, "mm") },
    { name: "PrincipalX", value: display(intrinsics.principalPointX, "mm") },
    { name: "PrincipalY", value: display(intrinsics.principalPointY, "mm") },
    { name: "ImageRotation", value: `${display(intrinsics.imageRotation, "deg")} (simulated)` },
  ];
}