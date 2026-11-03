import { applySensorMount, type FrameCameraState } from "../geometry/frameCamera";

export interface OrientedImageryImport {
  state: FrameCameraState;
  warnings: string[];
}

export function importOrientedImagery(record: Record<string, unknown>, current: FrameCameraState): OrientedImageryImport {
  const fields = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  const warnings: string[] = [];
  const number = (name: string): number | undefined => {
    const value = fields.get(name.toLowerCase());
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number.`);
    return parsed;
  };
  const bounded = (name: string, min: number, max: number): number | undefined => {
    const value = number(name);
    if (value !== undefined && (value < min || value > max)) throw new Error(`${name} must be between ${min} and ${max}.`);
    return value;
  };

  const camera = applySensorMount(current.vehicle.position, current.vehicle.orientation, current.sensorMount);
  const orientationValue = fields.get("cameraorientation");
  let stringAngles: number[] | undefined;
  if (orientationValue !== undefined && orientationValue !== null && orientationValue !== "") {
    if (typeof orientationValue !== "string") throw new Error("CameraOrientation must be a pipe-separated string.");
    const parts = orientationValue.split("|");
    if (parts[0] === "1" && (parts.length === 9 || parts.length === 23)) {
      stringAngles = parts.slice(6, 9).map((part) => part.trim() === "" ? NaN : Number(part));
      if (stringAngles.some((angle) => !Number.isFinite(angle))) throw new Error("CameraOrientation angles must be finite numbers.");
      if (stringAngles[0] < 0 || stringAngles[0] > 360 || stringAngles[1] < 0 || stringAngles[1] > 180 || stringAngles[2] < -90 || stringAngles[2] > 90) throw new Error("CameraOrientation angles are outside the supported ranges.");
      warnings.push("CameraOrientation position, spatial reference and precise calibration are not applied.");
    } else {
      warnings.push("CameraOrientation type or length is unsupported; its values are not applied.");
    }
  }
  const hasValue = (name: string) => {
    const value = fields.get(name);
    return value !== undefined && value !== null && value !== "";
  };
  const hasCalibration = (fields.get("focallengthunit") === "mm" || fields.get("focallengthunit") === "microns") && ["focallength", "principalx", "principaly"].some(hasValue);
  if (!stringAngles && !hasCalibration && !["cameraheading", "camerapitch", "cameraroll", "cameraheight", "horizontalfieldofview", "verticalfieldofview", "imagerotation"].some(hasValue)) throw new Error("The record contains no supported camera values.");
  const recordHeading = bounded("CameraHeading", 0, 360);
  const recordPitch = bounded("CameraPitch", 0, 180);
  const recordRoll = bounded("CameraRoll", -90, 90);
  if (stringAngles && ((recordHeading !== undefined && recordHeading % 360 !== stringAngles[0] % 360) || (recordPitch !== undefined && recordPitch !== stringAngles[1]) || (recordRoll !== undefined && recordRoll !== stringAngles[2]))) {
    warnings.push("Individual camera angles differ from CameraOrientation; this simulator uses the individual values, while precise ArcGIS transforms can use CameraOrientation.");
  }
  const heading = recordHeading ?? stringAngles?.[0] ?? camera.orientation.heading;
  const pitch = recordPitch ?? stringAngles?.[1] ?? camera.orientation.pitch;
  const roll = recordRoll ?? stringAngles?.[2] ?? camera.orientation.roll;
  const height = number("CameraHeight");
  if (height !== undefined && height <= 0) throw new Error("CameraHeight must be greater than zero.");
  const horizontal = number("HorizontalFieldOfView");
  const vertical = number("VerticalFieldOfView");
  for (const [name, value] of [["HorizontalFieldOfView", horizontal], ["VerticalFieldOfView", vertical]] as const) {
    if (value !== undefined && (value <= 0 || value >= 180)) throw new Error(`${name} must be greater than 0 and less than 180 for a frame camera.`);
  }
  const imageRotation = bounded("ImageRotation", -360, 360);
  const unit = fields.get("focallengthunit");
  const unitScale = unit === "mm" ? 1 : unit === "microns" ? 0.001 : undefined;
  const suppliedFocalLength = unitScale === undefined ? undefined : number("FocalLength");
  if (suppliedFocalLength !== undefined && suppliedFocalLength <= 0) throw new Error("FocalLength must be greater than zero.");
  const focalLength = unitScale !== undefined && suppliedFocalLength !== undefined ? suppliedFocalLength * unitScale : current.intrinsics.focalLength;
  const principalX = unitScale === undefined ? undefined : number("PrincipalX");
  const principalY = unitScale === undefined ? undefined : number("PrincipalY");
  if (unitScale === undefined && ["focallength", "principalx", "principaly"].some(hasValue)) {
    warnings.push("FocalLength and principal point values require FocalLengthUnit of mm or microns; they are not applied.");
  }
  const sizeFromFov = (degrees: number) => 2 * focalLength * Math.tan(degrees * Math.PI / 360);
  const focalScale = focalLength / current.intrinsics.focalLength;

  const supported = new Set(["cameraheading", "camerapitch", "cameraroll", "cameraheight", "horizontalfieldofview", "verticalfieldofview", "imagerotation", "cameraorientation", "focallength", "focallengthunit", "principalx", "principaly"]);
  const extra = Object.entries(record).filter(([key, value]) => !supported.has(key.toLowerCase()) && value !== null && value !== undefined && value !== "").map(([key]) => key);
  if (extra.length) warnings.push(`Not applied: ${extra.join(", ")}.`);
  if (horizontal !== undefined || vertical !== undefined || focalScale !== 1) warnings.push("Sensor dimensions are derived using the supplied or current focal length; physical sensor dimensions are unknown.");
  if (height !== undefined) warnings.push("CameraHeight is treated as height above the simulator's flat ground plane.");
  warnings.push("Vehicle attitude and mount are illustrative, not recovered from the record.");
  warnings.push("Missing supported values retain the current simulator settings.");

  return {
    state: {
      vehicle: { position: { x: camera.position.x, y: camera.position.y, z: height === undefined ? camera.position.z : current.groundElevation + height }, orientation: { heading: 0, pitch: 90, roll: 0 } },
      sensorMount: { leverArm: { forward: 0, right: 0, down: 0 }, orientation: { heading, pitch, roll } },
      intrinsics: { ...current.intrinsics, focalLength, sensorWidth: horizontal === undefined ? current.intrinsics.sensorWidth * focalScale : sizeFromFov(horizontal), sensorHeight: vertical === undefined ? current.intrinsics.sensorHeight * focalScale : sizeFromFov(vertical), principalPointX: unitScale === undefined || principalX === undefined ? current.intrinsics.principalPointX : principalX * unitScale, principalPointY: unitScale === undefined || principalY === undefined ? current.intrinsics.principalPointY : principalY * unitScale, imageRotation: imageRotation ?? current.intrinsics.imageRotation },
      groundElevation: current.groundElevation,
    },
    warnings,
  };
}