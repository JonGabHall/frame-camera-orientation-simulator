/**
 * Frame camera math: pinhole/collinearity model shared by the world view
 * (footprint + frustum) and the image-space viewer (forward projection).
 *
 * World frame: local flat East-North-Up (ENU) meters, NOT a geographic CRS.
 * Orientation fields follow Esri's OrientedImageryLayer camera schema (cameraHeading/
 * cameraPitch/cameraRoll) so the simulator teaches the real ArcGIS data model.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FrameCameraOrientation {
  /** Compass yaw in degrees: 0 = North, 90 = East, clockwise positive. */
  heading: number;
  /** Esri cameraPitch convention: 0 = straight down (nadir), 90 = horizon, 180 = straight up (zenith). */
  pitch: number;
  /** Esri cameraRoll convention: rotation in degrees about the boresight, valid range -90 to +90. */
  roll: number;
}

/** Photogrammetric Euler decomposition R = Rx(omega)*Ry(phi)*Rz(kappa) of the same orientation. */
export interface OmegaPhiKappa {
  omega: number;
  phi: number;
  kappa: number;
}

export interface FrameCameraIntrinsics {
  /** Focal length in millimeters. */
  focalLength: number;
  /** Physical sensor size in millimeters. */
  sensorWidth: number;
  sensorHeight: number;
  /** Output image size in pixels. */
  imageWidth: number;
  imageHeight: number;
  /** Principal point offset from sensor center, in millimeters. */
  principalPointX: number;
  principalPointY: number;
  /**
   * Esri's imageRotation: an extra in-image-plane rotation (degrees, -360 to 360) applied on top
   * of cameraRoll. Unlike roll, this doesn't change the 3D ray directions (footprint/frustum are
   * unaffected) - it only spins the captured image content within the fixed image raster.
   */
  imageRotation: number;
}

/** Sensor-to-vehicle lever arm: offset from the vehicle's reference point to the sensor, in the vehicle's own body frame (meters). */
export interface LeverArm {
  forward: number;
  right: number;
  down: number;
}

/**
 * Sensor mounting relative to the vehicle body frame: a lever arm (translation) plus a mounting
 * orientation. The mounting orientation reuses the heading/pitch/roll convention, but relative to
 * the vehicle's own axes instead of world ENU - heading=0/pitch=0/roll=0 means the sensor points
 * nadir through the vehicle belly (the common aerial-mapping-camera default); pitch=90 means the
 * sensor points along the vehicle's nose (heading=0 forward, roll=0 upright).
 */
export interface SensorMount {
  leverArm: LeverArm;
  orientation: FrameCameraOrientation;
}

/** A resolved camera exterior orientation (position + orientation in world ENU), e.g. the sensor after applying its mount to the vehicle. */
export interface ExteriorOrientation {
  position: Vec3;
  orientation: FrameCameraOrientation;
}

export interface FrameCameraState {
  /** The vehicle/platform's own exterior orientation (e.g. from GNSS/IMU) in the local ENU frame (meters). */
  vehicle: ExteriorOrientation;
  /** How the sensor is mounted on the vehicle (lever arm + mounting orientation). */
  sensorMount: SensorMount;
  intrinsics: FrameCameraIntrinsics;
  /** World Z of the flat ground plane used for footprint/frustum intersection. */
  groundElevation: number;
}

export interface CameraAxes {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

export interface ImagePoint {
  u: number;
  v: number;
  behindCamera: boolean;
}

export type ImageCorner = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";

/** Row-major 3x3 rotation matrix, columns are [right, forward, up] in world ENU (right-handed: right x forward = up). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function toRad(deg: number): number {
  return deg * DEG2RAD;
}

function toDeg(rad: number): number {
  return rad * RAD2DEG;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function normalize(a: Vec3): Vec3 {
  const len = Math.sqrt(dot(a, a));
  return len === 0 ? a : scale(a, 1 / len);
}

/**
 * Camera right/up/forward axes (in world ENU) for a given heading/pitch/roll.
 * Pitch rotates forward about the pre-roll right axis; roll then rotates right/up about forward.
 */
export function cameraAxesFromHeadingPitchRoll(orientation: FrameCameraOrientation): CameraAxes {
  const h = toRad(orientation.heading);
  const p = toRad(orientation.pitch);
  const r = toRad(orientation.roll);

  const forward: Vec3 = {
    x: Math.sin(h) * Math.sin(p),
    y: Math.cos(h) * Math.sin(p),
    z: -Math.cos(p),
  };
  const rightBeforeRoll: Vec3 = { x: Math.cos(h), y: -Math.sin(h), z: 0 };
  const upBeforeRoll = normalize(cross(rightBeforeRoll, forward));

  const cosR = Math.cos(r);
  const sinR = Math.sin(r);
  const right = normalize({
    x: rightBeforeRoll.x * cosR + upBeforeRoll.x * sinR,
    y: rightBeforeRoll.y * cosR + upBeforeRoll.y * sinR,
    z: rightBeforeRoll.z * cosR + upBeforeRoll.z * sinR,
  });
  const up = normalize({
    x: upBeforeRoll.x * cosR - rightBeforeRoll.x * sinR,
    y: upBeforeRoll.y * cosR - rightBeforeRoll.y * sinR,
    z: upBeforeRoll.z * cosR - rightBeforeRoll.z * sinR,
  });

  return { right, up, forward };
}

/** Horizontal/vertical full field of view (Esri's horizontalFieldOfView/verticalFieldOfView), in degrees, from focal length + sensor size. */
export function fieldOfView(intrinsics: FrameCameraIntrinsics): { horizontalFieldOfView: number; verticalFieldOfView: number } {
  const horizontalFieldOfView = 2 * Math.atan(intrinsics.sensorWidth / 2 / intrinsics.focalLength);
  const verticalFieldOfView = 2 * Math.atan(intrinsics.sensorHeight / 2 / intrinsics.focalLength);
  return { horizontalFieldOfView: toDeg(horizontalFieldOfView), verticalFieldOfView: toDeg(verticalFieldOfView) };
}

/** Pixel location of the principal point (optical center + offset). */
export function principalPointPixel(intrinsics: FrameCameraIntrinsics): { u: number; v: number } {
  const pxPerMmX = intrinsics.imageWidth / intrinsics.sensorWidth;
  const pxPerMmY = intrinsics.imageHeight / intrinsics.sensorHeight;
  return {
    u: intrinsics.imageWidth / 2 + intrinsics.principalPointX * pxPerMmX,
    v: intrinsics.imageHeight / 2 - intrinsics.principalPointY * pxPerMmY,
  };
}

/**
 * Forward (collinearity) projection: world point -> image pixel coordinates.
 * `behindCamera` is true when the point is behind the image plane (u/v are not meaningful).
 */
export function worldToImage(
  point: Vec3,
  position: Vec3,
  axes: CameraAxes,
  intrinsics: FrameCameraIntrinsics,
): ImagePoint {
  const d = sub(point, position);
  const xc = dot(d, axes.right);
  const yc = dot(d, axes.up);
  const zc = dot(d, axes.forward);

  if (zc <= 1e-6) {
    return { u: NaN, v: NaN, behindCamera: true };
  }

  const rawX = (intrinsics.focalLength * xc) / zc;
  const rawY = (intrinsics.focalLength * yc) / zc;

  // imageRotation spins the captured content in image space, independent of the 3D roll-based projection above.
  const rot = toRad(intrinsics.imageRotation);
  const cosRot = Math.cos(rot);
  const sinRot = Math.sin(rot);
  const xImageMm = rawX * cosRot - rawY * sinRot + intrinsics.principalPointX;
  const yImageMm = rawX * sinRot + rawY * cosRot + intrinsics.principalPointY;

  const pxPerMmX = intrinsics.imageWidth / intrinsics.sensorWidth;
  const pxPerMmY = intrinsics.imageHeight / intrinsics.sensorHeight;

  return {
    u: intrinsics.imageWidth / 2 + xImageMm * pxPerMmX,
    v: intrinsics.imageHeight / 2 - yImageMm * pxPerMmY,
    behindCamera: false,
  };
}

export function imageToGround(u: number, v: number, state: FrameCameraState): Vec3 | null {
  const camera = applySensorMount(state.vehicle.position, state.vehicle.orientation, state.sensorMount);
  const axes = cameraAxesFromHeadingPitchRoll(camera.orientation);
  const { intrinsics } = state;
  const imageX = (u - intrinsics.imageWidth / 2) * intrinsics.sensorWidth / intrinsics.imageWidth - intrinsics.principalPointX;
  const imageY = (intrinsics.imageHeight / 2 - v) * intrinsics.sensorHeight / intrinsics.imageHeight - intrinsics.principalPointY;
  const rotation = toRad(intrinsics.imageRotation);
  const cameraX = imageX * Math.cos(rotation) + imageY * Math.sin(rotation);
  const cameraY = -imageX * Math.sin(rotation) + imageY * Math.cos(rotation);
  const direction = normalize(add(add(scale(axes.right, cameraX), scale(axes.up, cameraY)), scale(axes.forward, intrinsics.focalLength)));
  return intersectRayWithGroundPlane(camera.position, direction, state.groundElevation);
}

const CORNER_SIGNS: Record<ImageCorner, { sx: number; sy: number }> = {
  topLeft: { sx: -1, sy: 1 },
  topRight: { sx: 1, sy: 1 },
  bottomRight: { sx: 1, sy: -1 },
  bottomLeft: { sx: -1, sy: -1 },
};

/** World-space (unnormalized) ray direction from the camera through one of the 4 image corners. */
export function cornerRayDirection(
  corner: ImageCorner,
  axes: CameraAxes,
  intrinsics: FrameCameraIntrinsics,
): Vec3 {
  const { sx, sy } = CORNER_SIGNS[corner];
  const cornerXMm = sx * (intrinsics.sensorWidth / 2) - intrinsics.principalPointX;
  const cornerYMm = sy * (intrinsics.sensorHeight / 2) - intrinsics.principalPointY;

  return normalize(
    add(add(scale(axes.right, cornerXMm), scale(axes.up, cornerYMm)), scale(axes.forward, intrinsics.focalLength)),
  );
}

/** Default cap (meters) on how far a ground intersection is allowed to be - see `intersectRayWithGroundPlane`. */
const DEFAULT_MAX_GROUND_INTERSECT_DISTANCE = 50_000;

/**
 * Intersection of a ray with the flat ground plane (world Z = groundElevation), or null if none -
 * including when the ray is nearly parallel to the ground (e.g. a sensor pointed near the horizon).
 * A ray only a fraction of a degree off parallel still technically hits the ground, but hundreds of
 * kilometers away; treating anything past `maxDistance` as "no intersection" keeps callers' footprint/
 * frustum math (and any downstream rendering) from working with huge or precision-losing coordinates.
 */
export function intersectRayWithGroundPlane(
  origin: Vec3,
  direction: Vec3,
  groundElevation: number,
  maxDistance = DEFAULT_MAX_GROUND_INTERSECT_DISTANCE,
): Vec3 | null {
  if (Math.abs(direction.z) < 1e-9) {
    return null;
  }
  const t = (groundElevation - origin.z) / direction.z;
  if (t <= 0 || t > maxDistance) {
    return null;
  }
  return add(origin, scale(direction, t));
}


const FOOTPRINT_CORNERS: ImageCorner[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

/** Ground footprint of the 4 image corners, in image-corner order (null entries = ray never hits ground). */
export function computeFootprint(state: FrameCameraState): (Vec3 | null)[] {
  const camera = applySensorMount(state.vehicle.position, state.vehicle.orientation, state.sensorMount);
  const axes = cameraAxesFromHeadingPitchRoll(camera.orientation);
  return FOOTPRINT_CORNERS.map((corner) => {
    const direction = cornerRayDirection(corner, axes, state.intrinsics);
    return intersectRayWithGroundPlane(camera.position, direction, state.groundElevation);
  });
}

function mat3FromColumns(c1: Vec3, c2: Vec3, c3: Vec3): Mat3 {
  return [c1.x, c2.x, c3.x, c1.y, c2.y, c3.y, c1.z, c2.z, c3.z];
}

function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as number[];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += a[row * 3 + k] * b[k * 3 + col];
      }
      r[row * 3 + col] = sum;
    }
  }
  return r as Mat3;
}

function rotationMatrixX(angleRad: number): Mat3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

function rotationMatrixY(angleRad: number): Mat3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function rotationMatrixZ(angleRad: number): Mat3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function rotationMatrixFromHeadingPitchRoll(orientation: FrameCameraOrientation): Mat3 {
  const { right, up, forward } = cameraAxesFromHeadingPitchRoll(orientation);
  return mat3FromColumns(right, forward, up);
}

export function headingPitchRollFromRotationMatrix(m: Mat3): FrameCameraOrientation {
  const forward: Vec3 = { x: m[1], y: m[4], z: m[7] };
  const right: Vec3 = { x: m[0], y: m[3], z: m[6] };

  const pitch = toDeg(Math.acos(clamp(-forward.z, -1, 1)));
  if (Math.hypot(forward.x, forward.y) < 1e-8) {
    return { heading: toDeg(Math.atan2(-right.y, right.x)), pitch, roll: 0 };
  }
  const heading = toDeg(Math.atan2(forward.x, forward.y));

  const hRad = toRad(heading);
  const rightBeforeRoll: Vec3 = { x: Math.cos(hRad), y: -Math.sin(hRad), z: 0 };
  const upBeforeRoll = normalize(cross(rightBeforeRoll, forward));

  const roll = toDeg(Math.atan2(dot(right, upBeforeRoll), dot(right, rightBeforeRoll)));

  return { heading, pitch, roll };
}

/**
 * Composes a base orientation with a relative orientation expressed in the base's own local axes
 * (e.g. vehicle attitude composed with a sensor's mounting orientation), returning the resulting
 * world-frame orientation.
 */
export function composeOrientations(base: FrameCameraOrientation, relative: FrameCameraOrientation): FrameCameraOrientation {
  const composed = mat3Multiply(rotationMatrixFromHeadingPitchRoll(base), rotationMatrixFromHeadingPitchRoll(relative));
  return headingPitchRollFromRotationMatrix(composed);
}

/** Resolves the sensor's world-frame exterior orientation from the vehicle's exterior orientation and the sensor mount (lever arm + mounting orientation). */
export function applySensorMount(vehiclePosition: Vec3, vehicleOrientation: FrameCameraOrientation, mount: SensorMount): ExteriorOrientation {
  const vehicleAxes = cameraAxesFromHeadingPitchRoll(vehicleOrientation);
  const worldOffset = add(
    add(scale(vehicleAxes.forward, mount.leverArm.forward), scale(vehicleAxes.right, mount.leverArm.right)),
    scale(vehicleAxes.up, -mount.leverArm.down),
  );
  return {
    position: add(vehiclePosition, worldOffset),
    orientation: composeOrientations(vehicleOrientation, mount.orientation),
  };
}

/**
 * Omega/Phi/Kappa follows R = Rx(omega) * Ry(phi) * Rz(kappa) applied to the same world
 * East-North-Up basis used for heading/pitch/roll. This is a standard photogrammetric Euler
 * decomposition, illustrating the relationship between the two parameterizations of the same
 * orientation - it is not guaranteed to match a specific vendor's OPK zero-pose convention.
 */
export function rotationMatrixFromOmegaPhiKappa(opk: OmegaPhiKappa): Mat3 {
  const rx = rotationMatrixX(toRad(opk.omega));
  const ry = rotationMatrixY(toRad(opk.phi));
  const rz = rotationMatrixZ(toRad(opk.kappa));
  return mat3Multiply(mat3Multiply(rx, ry), rz);
}

export function omegaPhiKappaFromRotationMatrix(m: Mat3): OmegaPhiKappa {
  const phi = toDeg(Math.asin(clamp(m[2], -1, 1)));
  const omega = toDeg(Math.atan2(-m[5], m[8]));
  const kappa = toDeg(Math.atan2(-m[1], m[0]));
  return { omega, phi, kappa };
}

export function headingPitchRollToOmegaPhiKappa(orientation: FrameCameraOrientation): OmegaPhiKappa {
  return omegaPhiKappaFromRotationMatrix(rotationMatrixFromHeadingPitchRoll(orientation));
}

export function omegaPhiKappaToHeadingPitchRoll(opk: OmegaPhiKappa): FrameCameraOrientation {
  return headingPitchRollFromRotationMatrix(rotationMatrixFromOmegaPhiKappa(opk));
}
