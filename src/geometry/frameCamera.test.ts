import { describe, expect, it } from "vitest";
import {
  applySensorMount,
  cameraAxesFromHeadingPitchRoll,
  computeFootprint,
  fieldOfView,
  headingPitchRollToOmegaPhiKappa,
  imageToGround,
  omegaPhiKappaToHeadingPitchRoll,
  worldToImage,
  type FrameCameraState,
} from "./frameCamera";

const BASE_INTRINSICS = {
  focalLength: 24,
  sensorWidth: 36,
  sensorHeight: 24,
  imageWidth: 1200,
  imageHeight: 800,
  principalPointX: 0,
  principalPointY: 0,
  imageRotation: 0,
};

function closeTo(actual: number, expected: number, epsilon = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon);
}

describe("cameraAxesFromHeadingPitchRoll", () => {
  it("looks straight down (nadir), no roll, at pitch 0", () => {
    const axes = cameraAxesFromHeadingPitchRoll({ heading: 0, pitch: 0, roll: 0 });
    closeTo(axes.forward.x, 0);
    closeTo(axes.forward.y, 0);
    closeTo(axes.forward.z, -1);
  });

  it("looks North, horizontal, no roll at pitch 90 (Esri cameraPitch horizon convention)", () => {
    const axes = cameraAxesFromHeadingPitchRoll({ heading: 0, pitch: 90, roll: 0 });
    closeTo(axes.forward.x, 0);
    closeTo(axes.forward.y, 1);
    closeTo(axes.forward.z, 0);
    closeTo(axes.right.x, 1);
    closeTo(axes.right.y, 0);
    closeTo(axes.up.z, 1);
  });

  it("looks straight up (zenith) at pitch 180", () => {
    const axes = cameraAxesFromHeadingPitchRoll({ heading: 0, pitch: 180, roll: 0 });
    closeTo(axes.forward.x, 0);
    closeTo(axes.forward.y, 0);
    closeTo(axes.forward.z, 1);
  });

  it("keeps right/up/forward mutually orthogonal and unit length after roll", () => {
    const axes = cameraAxesFromHeadingPitchRoll({ heading: 37, pitch: 112, roll: 51 });
    const dot = (a: typeof axes.right, b: typeof axes.right) => a.x * b.x + a.y * b.y + a.z * b.z;
    closeTo(dot(axes.right, axes.right), 1);
    closeTo(dot(axes.up, axes.up), 1);
    closeTo(dot(axes.forward, axes.forward), 1);
    closeTo(dot(axes.right, axes.up), 0);
    closeTo(dot(axes.right, axes.forward), 0);
    closeTo(dot(axes.up, axes.forward), 0);
  });
});

describe("worldToImage", () => {
  it("projects a point on the boresight to the image center", () => {
    const axes = cameraAxesFromHeadingPitchRoll({ heading: 0, pitch: 90, roll: 0 });
    const position = { x: 0, y: 0, z: 100 };
    const point = { x: 0, y: 500, z: 100 }; // straight ahead (North), same height
    const result = worldToImage(point, position, axes, BASE_INTRINSICS);
    expect(result.behindCamera).toBe(false);
    closeTo(result.u, BASE_INTRINSICS.imageWidth / 2);
    closeTo(result.v, BASE_INTRINSICS.imageHeight / 2);
  });

  it("flags points behind the camera", () => {
    const axes = cameraAxesFromHeadingPitchRoll({ heading: 0, pitch: 90, roll: 0 });
    const position = { x: 0, y: 0, z: 100 };
    const point = { x: 0, y: -500, z: 100 }; // directly behind
    const result = worldToImage(point, position, axes, BASE_INTRINSICS);
    expect(result.behindCamera).toBe(true);
  });

  it("rotates the projected point 90 degrees when rolling 90 degrees", () => {
    const axes0 = cameraAxesFromHeadingPitchRoll({ heading: 0, pitch: 90, roll: 0 });
    const axes90 = cameraAxesFromHeadingPitchRoll({ heading: 0, pitch: 90, roll: 90 });
    const position = { x: 0, y: 0, z: 100 };
    // a point above the boresight (higher Z) should appear above center with no roll...
    const point = { x: 0, y: 500, z: 110 };
    const noRoll = worldToImage(point, position, axes0, BASE_INTRINSICS);
    const rolled = worldToImage(point, position, axes90, BASE_INTRINSICS);

    const cx = BASE_INTRINSICS.imageWidth / 2;
    const cy = BASE_INTRINSICS.imageHeight / 2;
    closeTo(noRoll.u, cx, 1e-3); // no horizontal offset before roll
    expect(noRoll.v).toBeLessThan(cy); // above center -> smaller v
    // ...and after a 90 degree roll, that same vertical offset becomes a horizontal offset
    closeTo(rolled.v, cy, 1e-3);
    expect(rolled.u).not.toBeCloseTo(cx, 3);
  });

  it("rotates the projected point 90 degrees via imageRotation, same as a 3D roll would - but with no 3D geometry change", () => {
    const axes = cameraAxesFromHeadingPitchRoll({ heading: 0, pitch: 90, roll: 0 });
    const position = { x: 0, y: 0, z: 100 };
    const point = { x: 0, y: 500, z: 110 }; // above the boresight

    const noRotation = worldToImage(point, position, axes, BASE_INTRINSICS);
    const rotated = worldToImage(point, position, axes, { ...BASE_INTRINSICS, imageRotation: 90 });

    const cx = BASE_INTRINSICS.imageWidth / 2;
    const cy = BASE_INTRINSICS.imageHeight / 2;
    closeTo(noRotation.u, cx, 1e-3);
    expect(noRotation.v).toBeLessThan(cy);
    closeTo(rotated.v, cy, 1e-3);
    expect(rotated.u).not.toBeCloseTo(cx, 3);
  });

  it("does not affect the ground footprint (imageRotation is a post-projection image-space effect only)", () => {
    const state: FrameCameraState = {
      vehicle: { position: { x: 0, y: 0, z: 100 }, orientation: { heading: 0, pitch: 90, roll: 0 } },
      sensorMount: { leverArm: { forward: 0, right: 0, down: 0 }, orientation: { heading: 0, pitch: 0, roll: 0 } },
      intrinsics: BASE_INTRINSICS,
      groundElevation: 0,
    };
    const rotatedState: FrameCameraState = { ...state, intrinsics: { ...BASE_INTRINSICS, imageRotation: 37 } };

    const footprint = computeFootprint(state) as { x: number; y: number; z: number }[];
    const rotatedFootprint = computeFootprint(rotatedState) as { x: number; y: number; z: number }[];
    for (let i = 0; i < footprint.length; i++) {
      closeTo(rotatedFootprint[i].x, footprint[i].x, 1e-9);
      closeTo(rotatedFootprint[i].y, footprint[i].y, 1e-9);
    }
  });
});

describe("imageToGround", () => {
  it("round-trips an image point with rotation and principal point offsets", () => {
    const state: FrameCameraState = {
      vehicle: { position: { x: 10, y: 20, z: 100 }, orientation: { heading: 0, pitch: 90, roll: 0 } },
      sensorMount: { leverArm: { forward: 0, right: 0, down: 0 }, orientation: { heading: 40, pitch: 25, roll: 10 } },
      intrinsics: { ...BASE_INTRINSICS, principalPointX: 2, principalPointY: -1, imageRotation: 25 },
      groundElevation: 0,
    };
    const point = imageToGround(450, 300, state);
    expect(point).not.toBeNull();
    const camera = applySensorMount(state.vehicle.position, state.vehicle.orientation, state.sensorMount);
    const projected = worldToImage(point!, camera.position, cameraAxesFromHeadingPitchRoll(camera.orientation), state.intrinsics);
    closeTo(projected.u, 450);
    closeTo(projected.v, 300);
  });

  it("returns null when the image ray does not intersect the ground", () => {
    const state: FrameCameraState = {
      vehicle: { position: { x: 0, y: 0, z: 100 }, orientation: { heading: 0, pitch: 90, roll: 0 } },
      sensorMount: { leverArm: { forward: 0, right: 0, down: 0 }, orientation: { heading: 0, pitch: 180, roll: 0 } },
      intrinsics: BASE_INTRINSICS,
      groundElevation: 0,
    };
    expect(imageToGround(600, 400, state)).toBeNull();
  });
});

describe("fieldOfView", () => {
  it("computes symmetric horizontal/vertical FOV from focal length and sensor size", () => {
    const fov = fieldOfView(BASE_INTRINSICS);
    const expectedHorizontal = 2 * Math.atan(18 / 24) * (180 / Math.PI);
    closeTo(fov.horizontalFieldOfView, expectedHorizontal, 1e-6);
  });
});

describe("computeFootprint", () => {
  // Vehicle orientation {heading:0, pitch:90, roll:0} composes as the identity rotation (see
  // composeOrientations tests), so with a zero lever arm the resolved camera exactly equals
  // whatever the sensorMount.orientation is - keeping these footprint cases simple to reason about.
  const LEVEL_VEHICLE = { heading: 0, pitch: 90, roll: 0 };
  const ZERO_LEVER_ARM = { forward: 0, right: 0, down: 0 };

  it("is a symmetric rectangle centered under the camera at nadir (mount pitch 0)", () => {
    const state: FrameCameraState = {
      vehicle: { position: { x: 10, y: 20, z: 100 }, orientation: LEVEL_VEHICLE },
      sensorMount: { leverArm: ZERO_LEVER_ARM, orientation: { heading: 0, pitch: 0, roll: 0 } },
      intrinsics: BASE_INTRINSICS,
      groundElevation: 0,
    };
    const footprint = computeFootprint(state);
    expect(footprint.every((p) => p !== null)).toBe(true);
    const points = footprint as { x: number; y: number; z: number }[];
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / 4;
    const centerY = points.reduce((sum, p) => sum + p.y, 0) / 4;
    closeTo(centerX, state.vehicle.position.x, 1e-3);
    closeTo(centerY, state.vehicle.position.y, 1e-3);
  });

  it("returns null corners when looking at the horizon (mount pitch 90, rays never reach the ground)", () => {
    const state: FrameCameraState = {
      vehicle: { position: { x: 0, y: 0, z: 100 }, orientation: LEVEL_VEHICLE },
      sensorMount: { leverArm: ZERO_LEVER_ARM, orientation: { heading: 0, pitch: 90, roll: 0 } },
      intrinsics: BASE_INTRINSICS,
      groundElevation: 0,
    };
    const footprint = computeFootprint(state);
    expect(footprint.some((p) => p === null)).toBe(true);
  });
});

describe("applySensorMount", () => {
  it.each([0, 180])("preserves the full camera basis at pitch %s", (pitch) => {
    const orientation = { heading: 35, pitch, roll: 20 };
    const camera = applySensorMount({ x: 0, y: 0, z: 100 }, { heading: 0, pitch: 90, roll: 0 }, {
      leverArm: { forward: 0, right: 0, down: 0 }, orientation,
    });
    const expected = cameraAxesFromHeadingPitchRoll(orientation);
    const actual = cameraAxesFromHeadingPitchRoll(camera.orientation);
    for (const axis of ["right", "up", "forward"] as const) {
      closeTo(actual[axis].x, expected[axis].x);
      closeTo(actual[axis].y, expected[axis].y);
      closeTo(actual[axis].z, expected[axis].z);
    }
  });
  it("leaves the camera at the vehicle's position/orientation when the mount is neutral", () => {
    const vehiclePosition = { x: 5, y: -3, z: 100 };
    const vehicleOrientation = { heading: 30, pitch: 90, roll: 0 };
    const camera = applySensorMount(vehiclePosition, vehicleOrientation, {
      leverArm: { forward: 0, right: 0, down: 0 },
      orientation: { heading: 0, pitch: 90, roll: 0 },
    });
    closeTo(camera.position.x, vehiclePosition.x, 1e-9);
    closeTo(camera.position.y, vehiclePosition.y, 1e-9);
    closeTo(camera.position.z, vehiclePosition.z, 1e-9);
    closeTo(camera.orientation.heading, vehicleOrientation.heading, 1e-6);
    closeTo(camera.orientation.pitch, vehicleOrientation.pitch, 1e-6);
    closeTo(camera.orientation.roll, vehicleOrientation.roll, 1e-6);
  });

  it("translates a lever arm through the vehicle's own body axes", () => {
    // Vehicle facing North, level, no roll: forward=North(+Y), right=East(+X), down=-Up(-Z).
    const camera = applySensorMount(
      { x: 0, y: 0, z: 100 },
      { heading: 0, pitch: 90, roll: 0 },
      { leverArm: { forward: 2, right: 3, down: 1 }, orientation: { heading: 0, pitch: 90, roll: 0 } },
    );
    closeTo(camera.position.x, 3, 1e-9); // right offset -> +X (East)
    closeTo(camera.position.y, 2, 1e-9); // forward offset -> +Y (North)
    closeTo(camera.position.z, 99, 1e-9); // down offset -> -Z
  });

  it("resolves a nadir-mounted sensor on a level vehicle to point straight down", () => {
    const camera = applySensorMount(
      { x: 0, y: 0, z: 100 },
      { heading: 45, pitch: 90, roll: 0 },
      { leverArm: { forward: 0, right: 0, down: 0 }, orientation: { heading: 0, pitch: 0, roll: 0 } },
    );
    closeTo(camera.orientation.pitch, 0, 1e-6); // nadir, regardless of vehicle heading
  });
});


describe("heading/pitch/roll <-> omega/phi/kappa round trip", () => {
  it.each([
    { heading: 0, pitch: 45, roll: 0 },
    { heading: 30, pitch: 70, roll: 10 },
    { heading: 275, pitch: 120, roll: -15 },
  ])("round-trips %o", (orientation) => {
    const opk = headingPitchRollToOmegaPhiKappa(orientation);
    const roundTripped = omegaPhiKappaToHeadingPitchRoll(opk);
    closeTo(((roundTripped.heading - orientation.heading + 540) % 360) - 180, 0, 1e-4);
    closeTo(roundTripped.pitch, orientation.pitch, 1e-4);
    closeTo(roundTripped.roll, orientation.roll, 1e-4);
  });
});
