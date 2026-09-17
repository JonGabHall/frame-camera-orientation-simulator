import type { Vec3 } from "../geometry/frameCamera";

/**
 * Shared simulated-scene definitions used by BOTH the SceneView world view and the image-space
 * viewer, so what the sensor "frames" always matches what the two panels draw.
 */

/** Ground track the sample target sits at: directly below wherever the vehicle currently is. This
 *  keeps the target reachable purely by getting pitch/roll/mount right, without also needing to
 *  re-solve X/Y positioning every time the vehicle is moved or an oblique angle is tried. */
export function targetGroundLocation(vehiclePosition: Vec3): { x: number; y: number } {
  return { x: vehiclePosition.x, y: vehiclePosition.y };
}
/** 3x the original {width:8,depth:8,height:12} footprint, for better legibility in both panels. */
export const TARGET_SIZE = { width: 24, depth: 24, height: 36 };

export type TargetShapeKind = "box" | "sphere" | "cone" | "cylinder";
export const DEFAULT_TARGET_SHAPE: TargetShapeKind = "box";

/** Per-face colors for the box shape, shared by both panels so a given face always reads the same color. */
export const TARGET_FACE_COLORS = {
  top: "#e74c3c",
  bottom: "#34495e",
  north: "#2ecc71",
  south: "#e67e22",
  east: "#3498db",
  west: "#9b59b6",
} as const;

/** Single fallback color for non-box shapes, where "which side is visible" isn't a meaningful distinction. */
export const TARGET_SINGLE_COLOR = "#3fa7d6";
