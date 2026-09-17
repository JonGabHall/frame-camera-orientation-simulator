import type { FrameCameraState } from "../geometry/frameCamera";

/** Starting state: vehicle in level flight at 120m, nadir-mounted sensor slung below the vehicle's
 *  reference point plus a forward offset that aligns it with the wing position (the model's overall
 *  bounding-box center sits aft of the wings, which are centered near the model's own local origin),
 *  plus half the camera housing's rotated vertical extent, so the housing's top sits at the belly
 *  instead of straddling it. */
export const DEFAULT_CAMERA_STATE: FrameCameraState = {
  vehicle: {
    position: { x: 0, y: 0, z: 120 },
    orientation: { heading: 0, pitch: 90, roll: 0 },
  },
  sensorMount: {
    leverArm: { forward: 1.7, right: 0, down: 5 },
    orientation: { heading: 0, pitch: 0, roll: 0 },
  },
  intrinsics: {
    focalLength: 24,
    sensorWidth: 36,
    sensorHeight: 24,
    imageWidth: 1200,
    imageHeight: 800,
    principalPointX: 0,
    principalPointY: 0,
    imageRotation: 0,
  },
  groundElevation: 0,
};

function cloneState(state: FrameCameraState): FrameCameraState {
  return {
    vehicle: {
      position: { ...state.vehicle.position },
      orientation: { ...state.vehicle.orientation },
    },
    sensorMount: {
      leverArm: { ...state.sensorMount.leverArm },
      orientation: { ...state.sensorMount.orientation },
    },
    intrinsics: { ...state.intrinsics },
    groundElevation: state.groundElevation,
  };
}


type RegenerateListener = (state: FrameCameraState) => void;

/**
 * Holds the last "regenerated" camera state. Deliberately NOT reactive per-keystroke -
 * the control panel only calls `regenerate()` when the user clicks the Regenerate button.
 */
export class CameraStateStore {
  private state: FrameCameraState;
  private readonly listeners = new Set<RegenerateListener>();

  constructor(initial: FrameCameraState = DEFAULT_CAMERA_STATE) {
    this.state = cloneState(initial);
  }

  getState(): FrameCameraState {
    return cloneState(this.state);
  }

  regenerate(next: FrameCameraState): void {
    this.state = cloneState(next);
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }

  onRegenerate(listener: RegenerateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
