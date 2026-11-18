import {
  applySensorMount,
  cameraAxesFromHeadingPitchRoll,
  fieldOfView,
  principalPointPixel,
  worldToImage,
  type CameraAxes,
  type FrameCameraState,
  type Vec3,
} from "../geometry/frameCamera";
import { TARGET_SIZE, TARGET_FACE_COLORS, TARGET_SINGLE_COLOR, DEFAULT_TARGET_SHAPE, targetGroundLocation, type TargetShapeKind } from "../state/sceneObjects";

/** Ground reference grid extent/spacing (meters), centered under the resolved camera position. */
const GRID_HALF_EXTENT = 200;
const GRID_SPACING = 20;

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVec(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len === 0 ? a : scaleVec(a, 1 / len);
}

/** Andrew's monotone chain convex hull - the cone target's silhouette needs to read as a circle from
 *  directly above and a tapered wedge from the side. A fixed apex+2-corner triangle only looks right
 *  from the side; from nadir the apex sits almost exactly above the base center and the real cone's
 *  visible outline is the base circle, not a wedge. Sampling the full base circle and taking the
 *  convex hull with the apex gives the correct silhouette at any viewing angle. */
function convexHull2D(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Rotates a vector's X/Y components within the horizontal plane (Z untouched/zeroed). */
function rotateHorizontal(v: Vec3, angleDeg: number): Vec3 {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos, z: 0 };
}

/**
 * Two horizontal (world Z=0) directions close to the camera's own heading, used to locate the
 * ground-plane horizon/vanishing line. Deriving them from the camera's own forward axis (rather
 * than fixed world East/North) avoids a degenerate case: East/North become exactly perpendicular
 * to the view whenever heading is near 0/180, which would wrongly flag the horizon as undetectable.
 * Returns null only when the camera has no horizontal component at all (looking straight up/down).
 */
function horizonDirections(axes: CameraAxes): [Vec3, Vec3] | null {
  const forwardFlat = normalize({ x: axes.forward.x, y: axes.forward.y, z: 0 });
  if (length(forwardFlat) < 1e-6) {
    return null;
  }
  return [forwardFlat, rotateHorizontal(forwardFlat, 20)];
}

/**
 * Clips a world-space segment so only the portion in front of the camera remains (the pinhole
 * model has no meaning behind the image plane). Since this model has no lens distortion, a
 * straight 3D segment always projects to a straight 2D segment, so 2 (possibly clipped) endpoints
 * are always enough - no need to sample the segment densely.
 */
function clipSegmentToFront(a: Vec3, b: Vec3, cameraPosition: Vec3, forward: Vec3): [Vec3, Vec3] | null {
  const eps = 1e-3;
  const za = dot(subVec(a, cameraPosition), forward);
  const zb = dot(subVec(b, cameraPosition), forward);
  if (za <= eps && zb <= eps) {
    return null;
  }
  if (za > eps && zb > eps) {
    return [a, b];
  }
  const t = (eps - za) / (zb - za);
  const clipPoint = addVec(a, scaleVec(subVec(b, a), t));
  return za > eps ? [a, clipPoint] : [clipPoint, b];
}

function clipPolygonToFront(points: Vec3[], cameraPosition: Vec3, forward: Vec3): Vec3[] {
  const clipped: Vec3[] = [];
  for (let index = 0; index < points.length; index++) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const startInFront = dot(subVec(start, cameraPosition), forward) > 1e-3;
    const endInFront = dot(subVec(end, cameraPosition), forward) > 1e-3;
    const segment = clipSegmentToFront(start, end, cameraPosition, forward);
    if (segment && startInFront) clipped.push(segment[0]);
    if (segment && startInFront !== endInFront) clipped.push(startInFront ? segment[1] : segment[0]);
  }
  return clipped;
}

function clipEdgesToFront(edges: [Vec3, Vec3][], cameraPosition: Vec3, forward: Vec3): Vec3[] {
  return edges.flatMap(([start, end]) => clipSegmentToFront(start, end, cameraPosition, forward) ?? []);
}

function groundGridLines(center: Vec3, groundElevation: number): [Vec3, Vec3][] {
  const originX = Math.round(center.x / GRID_SPACING) * GRID_SPACING;
  const originY = Math.round(center.y / GRID_SPACING) * GRID_SPACING;
  const lines: [Vec3, Vec3][] = [];
  for (let i = -GRID_HALF_EXTENT; i <= GRID_HALF_EXTENT; i += GRID_SPACING) {
    const x = originX + i;
    lines.push([
      { x, y: originY - GRID_HALF_EXTENT, z: groundElevation },
      { x, y: originY + GRID_HALF_EXTENT, z: groundElevation },
    ]);
    const y = originY + i;
    lines.push([
      { x: originX - GRID_HALF_EXTENT, y, z: groundElevation },
      { x: originX + GRID_HALF_EXTENT, y, z: groundElevation },
    ]);
  }
  return lines;
}

/** The 6 faces of the target box, each with its outward normal and assigned color. */
interface TargetFace {
  normal: Vec3;
  corners: [Vec3, Vec3, Vec3, Vec3];
  color: string;
}

function targetBoxFaces(target: { x: number; y: number }, groundElevation: number): TargetFace[] {
  const { width, depth, height } = TARGET_SIZE;
  const x0 = target.x - width / 2;
  const x1 = target.x + width / 2;
  const y0 = target.y - depth / 2;
  const y1 = target.y + depth / 2;
  const z0 = groundElevation;
  const z1 = groundElevation + height;
  const p = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

  return [
    { normal: { x: 0, y: 0, z: 1 }, corners: [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], color: TARGET_FACE_COLORS.top },
    { normal: { x: 0, y: 0, z: -1 }, corners: [p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)], color: TARGET_FACE_COLORS.bottom },
    { normal: { x: 0, y: 1, z: 0 }, corners: [p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0)], color: TARGET_FACE_COLORS.north },
    { normal: { x: 0, y: -1, z: 0 }, corners: [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], color: TARGET_FACE_COLORS.south },
    { normal: { x: 1, y: 0, z: 0 }, corners: [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], color: TARGET_FACE_COLORS.east },
    { normal: { x: -1, y: 0, z: 0 }, corners: [p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0)], color: TARGET_FACE_COLORS.west },
  ];
}

export interface ImageSpaceViewer {
  update: (state: FrameCameraState) => void;
  /** Re-renders with whatever state is already current, without shifting current->previous - use for canvas resize, not new data. */
  redraw: () => void;
  /** Toggles a dashed/faded overlay of the frustum + target from before the most recent update, for before/after comparison. */
  setShowPreviousOverlay: (show: boolean) => void;
  /** Swaps the sample target's shape (box shows per-side colors; other shapes use one solid color). */
  setTargetShape: (shape: TargetShapeKind) => void;
  setProbe: (point: { x: number; y: number } | null) => void;
  destroy: () => void;
}

export function createImageSpaceViewer(canvas: HTMLCanvasElement): ImageSpaceViewer {
  const ctx = canvas.getContext("2d")!;
  let currentState: FrameCameraState | null = null;
  let previousState: FrameCameraState | null = null;
  let showPreviousOverlay = true;
  let targetShape: TargetShapeKind = DEFAULT_TARGET_SHAPE;
  let probe: { x: number; y: number } | null = null;

  function render(): void {
    const state = currentState;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (!state || cw === 0 || ch === 0) {
      return;
    }

    const { intrinsics, groundElevation } = state;
    const camera = applySensorMount(state.vehicle.position, state.vehicle.orientation, state.sensorMount);
    const axes = cameraAxesFromHeadingPitchRoll(camera.orientation);

    const scale = Math.min(cw / intrinsics.imageWidth, ch / intrinsics.imageHeight);
    const frameWidth = intrinsics.imageWidth * scale;
    const frameHeight = intrinsics.imageHeight * scale;
    const offsetX = (cw - frameWidth) / 2;
    const offsetY = (ch - frameHeight) / 2;
    const toCanvas = (u: number, v: number): [number, number] => [offsetX + u * scale, offsetY + v * scale];

    // Letterbox background, for when the canvas's aspect ratio doesn't match the sensor's.
    ctx.fillStyle = "#08111c";
    ctx.fillRect(0, 0, cw, ch);

    // Opaque sky/ground fill + grid first, then the current-state target - both establish the
    // "solid current" base layer that the faded/dashed previous-state overlay is drawn on top of.
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, frameWidth, frameHeight);
    ctx.clip();
    drawSkyAndGround(camera.position, axes, frameWidth, frameHeight, offsetX, offsetY, toCanvas);
    drawGroundGrid(camera.position, axes, groundElevation, intrinsics, toCanvas);
    drawHorizonLine(camera.position, axes, intrinsics, cw, ch, toCanvas);
    drawTargetShape(targetGroundLocation(), camera.position, axes, groundElevation, intrinsics, toCanvas);
    ctx.restore();

    if (showPreviousOverlay && previousState) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([6, 4]);
      drawPreviousOverlay(previousState, cw, ch);
      ctx.restore();
    }

    drawPrincipalPointCrosshair(intrinsics, toCanvas);
    if (probe) {
      const [x, y] = toCanvas(probe.x * intrinsics.imageWidth, probe.y * intrinsics.imageHeight);
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffe55c";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    drawFrameBorder(offsetX, offsetY, frameWidth, frameHeight);
    drawTargetOffFrameIndicator(
      targetGroundLocation(),
      camera.position,
      axes,
      groundElevation,
      intrinsics,
      offsetX,
      offsetY,
      frameWidth,
      frameHeight,
    );
    drawReadout(intrinsics);
    if (showPreviousOverlay && previousState) {
      drawOverlayLegend(cw);
    }
  }

  /**
   * Draws the frustum-defining elements (horizon, target box, principal point) for a prior camera
   * state, clipped to ITS OWN frame rectangle (which may be a different size/position than the
   * current one if intrinsics changed) - reuses the same draw functions as the current-state rendering.
   */
  function drawPreviousOverlay(previous: FrameCameraState, cw: number, ch: number): void {
    const { intrinsics, groundElevation } = previous;
    const camera = applySensorMount(previous.vehicle.position, previous.vehicle.orientation, previous.sensorMount);
    const axes = cameraAxesFromHeadingPitchRoll(camera.orientation);

    const scale = Math.min(cw / intrinsics.imageWidth, ch / intrinsics.imageHeight);
    const frameWidth = intrinsics.imageWidth * scale;
    const frameHeight = intrinsics.imageHeight * scale;
    const offsetX = (cw - frameWidth) / 2;
    const offsetY = (ch - frameHeight) / 2;
    const toCanvas = (u: number, v: number): [number, number] => [offsetX + u * scale, offsetY + v * scale];

    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, frameWidth, frameHeight);
    ctx.clip();
    drawHorizonLine(camera.position, axes, intrinsics, cw, ch, toCanvas);
    drawTargetShape(targetGroundLocation(), camera.position, axes, groundElevation, intrinsics, toCanvas);
    drawPrincipalPointCrosshair(intrinsics, toCanvas);
    ctx.restore();
  }

  function drawOverlayLegend(cw: number): void {
    ctx.save();
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "right";
    const width = Math.max(ctx.measureText("solid = current").width, ctx.measureText("dashed/faded = previous").width);
    drawTextBackground(cw - 8 - width - 8, 4, width + 8, 32);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("solid = current", cw - 8, 8);
    ctx.globalAlpha = 0.7;
    ctx.fillText("dashed/faded = previous", cw - 8, 22);
    ctx.restore();
  }

  /** A subtle rounded, semi-transparent chip behind a block of text, so it stays legible over varying sky/ground/target colors. */
  function drawTextBackground(x: number, y: number, width: number, height: number): void {
    ctx.fillStyle = "rgba(8, 17, 28, 0.6)";
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.fill();
  }

  /**
   * Projects a world-space direction (as if a point infinitely far along it) into image pixels.
   * Since `worldToImage` only depends on the direction from the camera (not distance), this reuses
   * the same collinearity math for horizon/vanishing-line computations - no separate formula needed.
   */
  function projectDirection(direction: Vec3, cameraPosition: Vec3, axes: CameraAxes, intrinsics: FrameCameraState["intrinsics"]) {
    return worldToImage(addVec(cameraPosition, direction), cameraPosition, axes, intrinsics);
  }
  function drawSkyAndGround(
    cameraPosition: Vec3,
    axes: CameraAxes,
    frameWidth: number,
    frameHeight: number,
    offsetX: number,
    offsetY: number,
    toCanvas: (u: number, v: number) => [number, number],
  ): void {
    const sky = "#bfe3f7";
    const ground = "#6b5a3a";
    const intrinsics = currentState!.intrinsics;

    const directions = horizonDirections(axes);
    // Whichever side of the horizon line the boresight (image center) falls on is the ground side.
    const centerLocal = toCanvas(intrinsics.imageWidth / 2, intrinsics.imageHeight / 2);

    if (!directions) {
      // No horizontal reference at all (looking straight up/down) - no horizon possible.
      ctx.fillStyle = axes.forward.z < 0 ? ground : sky;
      ctx.fillRect(offsetX, offsetY, frameWidth, frameHeight);
      return;
    }

    const east = projectDirection(directions[0], cameraPosition, axes, intrinsics);
    const north = projectDirection(directions[1], cameraPosition, axes, intrinsics);

    if (east.behindCamera || north.behindCamera) {
      // No horizon within reach of this orientation (e.g. steep nadir/zenith) - fill with whichever
      // dominates: a boresight pointed down (forward.z < 0) sees mostly ground, otherwise sky.
      ctx.fillStyle = axes.forward.z < 0 ? ground : sky;
      ctx.fillRect(offsetX, offsetY, frameWidth, frameHeight);
      return;
    }

    const [ax, ay] = toCanvas(east.u, east.v);
    const [bx, by] = toCanvas(north.u, north.v);
    const angle = Math.atan2(by - ay, bx - ax);
    const cosA = Math.cos(-angle);
    const sinA = Math.sin(-angle);
    const localY = (centerLocal[0] - ax) * sinA + (centerLocal[1] - ay) * cosA;
    const groundSide = localY >= 0 ? 1 : -1;

    const big = (frameWidth + frameHeight) * 4;
    ctx.fillStyle = sky;
    ctx.fillRect(offsetX, offsetY, frameWidth, frameHeight);

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.fillStyle = ground;
    ctx.fillRect(-big, groundSide > 0 ? 0 : -big, big * 2, big);
    ctx.restore();
  }

  function drawSegment(
    a: Vec3,
    b: Vec3,
    cameraPosition: Vec3,
    axes: CameraAxes,
    intrinsics: FrameCameraState["intrinsics"],
    toCanvas: (u: number, v: number) => [number, number],
  ): void {
    const clipped = clipSegmentToFront(a, b, cameraPosition, axes.forward);
    if (!clipped) {
      return;
    }
    const pa = worldToImage(clipped[0], cameraPosition, axes, intrinsics);
    const pb = worldToImage(clipped[1], cameraPosition, axes, intrinsics);
    const [ax, ay] = toCanvas(pa.u, pa.v);
    const [bx, by] = toCanvas(pb.u, pb.v);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }

  function drawGroundGrid(
    cameraPosition: Vec3,
    axes: CameraAxes,
    groundElevation: number,
    intrinsics: FrameCameraState["intrinsics"],
    toCanvas: (u: number, v: number) => [number, number],
  ): void {
    ctx.beginPath();
    for (const [a, b] of groundGridLines(cameraPosition, groundElevation)) {
      drawSegment(a, b, cameraPosition, axes, intrinsics, toCanvas);
    }
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawHorizonLine(
    cameraPosition: Vec3,
    axes: CameraAxes,
    intrinsics: FrameCameraState["intrinsics"],
    cw: number,
    ch: number,
    toCanvas: (u: number, v: number) => [number, number],
  ): void {
    const directions = horizonDirections(axes);
    if (!directions) {
      return;
    }
    const east = projectDirection(directions[0], cameraPosition, axes, intrinsics);
    const north = projectDirection(directions[1], cameraPosition, axes, intrinsics);
    if (east.behindCamera || north.behindCamera) {
      return;
    }
    const [ax, ay] = toCanvas(east.u, east.v);
    const [bx, by] = toCanvas(north.u, north.v);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ext = (cw + ch) * 4;
    ctx.beginPath();
    ctx.moveTo(ax - (dx / len) * ext, ay - (dy / len) * ext);
    ctx.lineTo(bx + (dx / len) * ext, by + (dy / len) * ext);
    ctx.strokeStyle = "#ffd21e";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * Draws the sample target using whichever shape is currently selected. The box renders as
   * solid colored faces (with simple backface culling, so only sides facing the camera are drawn -
   * this is what actually lets a user tell which side of the box they're looking at) via
   * `drawTargetBoxFaces`; other shapes have no meaningful "which side" distinction, so they render
   * as a single-color silhouette approximation via `drawTargetPrimitive`.
   */
  function drawTargetShape(
    target: { x: number; y: number },
    cameraPosition: Vec3,
    axes: CameraAxes,
    groundElevation: number,
    intrinsics: FrameCameraState["intrinsics"],
    toCanvas: (u: number, v: number) => [number, number],
  ): void {
    if (targetShape === "box") {
      drawTargetBoxFaces(target, cameraPosition, axes, groundElevation, intrinsics, toCanvas);
    } else {
      drawTargetPrimitive(target, cameraPosition, axes, groundElevation, intrinsics, toCanvas, targetShape);
    }
  }

  function drawTargetBoxFaces(
    target: { x: number; y: number },
    cameraPosition: Vec3,
    axes: CameraAxes,
    groundElevation: number,
    intrinsics: FrameCameraState["intrinsics"],
    toCanvas: (u: number, v: number) => [number, number],
  ): void {
    const visibleFaces = targetBoxFaces(target, groundElevation)
      .map((face) => {
        const center = scaleVec(face.corners.reduce((sum, c) => addVec(sum, c), { x: 0, y: 0, z: 0 }), 0.25);
        const facing = dot(face.normal, subVec(cameraPosition, center));
        const dist = length(subVec(cameraPosition, center));
        return { face, facing, dist };
      })
      // A face is visible when its outward normal points back toward the camera.
      .filter(({ facing }) => facing > 0)
      // Painter's algorithm (far to near) as a safety net, though visible faces of a convex box shouldn't overlap.
      .sort((a, b) => b.dist - a.dist);

    for (const { face } of visibleFaces) {
      const clipped = clipPolygonToFront(face.corners, cameraPosition, axes.forward);
      if (clipped.length < 3) continue;
      const projected = clipped.map((point) => worldToImage(point, cameraPosition, axes, intrinsics));
      ctx.beginPath();
      projected.forEach((p, i) => {
        const [x, y] = toCanvas(p.u, p.v);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = face.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Silhouette approximations for shapes with no per-side distinction: a circle, a triangle, and a rectangle. */
  function drawTargetPrimitive(
    target: { x: number; y: number },
    cameraPosition: Vec3,
    axes: CameraAxes,
    groundElevation: number,
    intrinsics: FrameCameraState["intrinsics"],
    toCanvas: (u: number, v: number) => [number, number],
    shape: TargetShapeKind,
  ): void {
    const halfWidth = TARGET_SIZE.width / 2;
    const z0 = groundElevation;
    const z1 = groundElevation + TARGET_SIZE.height;
    const cz = (z0 + z1) / 2;
    const center: Vec3 = { x: target.x, y: target.y, z: cz };

    if (shape === "sphere") {
      const depth = dot(subVec(center, cameraPosition), axes.forward);
      const depthRadius = Math.hypot(axes.forward.x * halfWidth, axes.forward.y * TARGET_SIZE.depth / 2, axes.forward.z * TARGET_SIZE.height / 2);
      if (depth <= depthRadius + 1e-3) {
        const latitudeSamples = 12;
        const longitudeSamples = 24;
        const rings: Vec3[][] = [];
        for (let latitude = 0; latitude <= latitudeSamples; latitude++) {
          const angle = -Math.PI / 2 + latitude * Math.PI / latitudeSamples;
          const ring: Vec3[] = [];
          for (let longitude = 0; longitude < longitudeSamples; longitude++) {
            const azimuth = longitude * 2 * Math.PI / longitudeSamples;
            ring.push({ x: center.x + halfWidth * Math.cos(angle) * Math.cos(azimuth), y: center.y + TARGET_SIZE.depth / 2 * Math.cos(angle) * Math.sin(azimuth), z: center.z + TARGET_SIZE.height / 2 * Math.sin(angle) });
          }
          rings.push(ring);
        }
        const edges: [Vec3, Vec3][] = [];
        for (let latitude = 0; latitude <= latitudeSamples; latitude++) {
          for (let longitude = 0; longitude < longitudeSamples; longitude++) {
            edges.push([rings[latitude][longitude], rings[latitude][(longitude + 1) % longitudeSamples]]);
            if (latitude < latitudeSamples) edges.push([rings[latitude][longitude], rings[latitude + 1][longitude]]);
          }
        }
        const projected = clipEdgesToFront(edges, cameraPosition, axes.forward).map((point) => worldToImage(point, cameraPosition, axes, intrinsics));
        const hull = convexHull2D(projected.map((point) => toCanvas(point.u, point.v)));
        if (hull.length < 3) return;
        ctx.beginPath();
        hull.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.closePath();
        ctx.fillStyle = TARGET_SINGLE_COLOR;
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();
        return;
      }
      const centerP = worldToImage(center, cameraPosition, axes, intrinsics);
      const edgeP = worldToImage(addVec(center, scaleVec(axes.right, halfWidth)), cameraPosition, axes, intrinsics);
      if (centerP.behindCamera || edgeP.behindCamera) {
        return;
      }
      const [cx, cy] = toCanvas(centerP.u, centerP.v);
      const [ex, ey] = toCanvas(edgeP.u, edgeP.v);
      const radius = Math.hypot(ex - cx, ey - cy);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = TARGET_SINGLE_COLOR;
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    if (shape === "cone") {
      const apex: Vec3 = { x: target.x, y: target.y, z: z1 };
      // The base circle is sampled in true world X/Y (matching the upright, un-rotated cone drawn in
      // the 3D scene), not the camera's "right" axis alone - a 2-point base only reads as a wedge
      // from the side. From nadir the apex sits almost exactly above the base center, so a real
      // cone's visible outline there is the base circle itself; the convex hull of the sampled
      // circle plus the apex naturally gives a circle from above and a tapered wedge from the side.
      const BASE_SAMPLES = 24;
      const basePoints: Vec3[] = [];
      for (let i = 0; i < BASE_SAMPLES; i++) {
        const angle = (i / BASE_SAMPLES) * Math.PI * 2;
        basePoints.push({ x: target.x + Math.cos(angle) * halfWidth, y: target.y + Math.sin(angle) * halfWidth, z: z0 });
      }
      const edges: [Vec3, Vec3][] = basePoints.flatMap((point, index) => [[point, basePoints[(index + 1) % BASE_SAMPLES]], [point, apex]]);
      const projected = clipEdgesToFront(edges, cameraPosition, axes.forward).map((point) => worldToImage(point, cameraPosition, axes, intrinsics));
      const hull = convexHull2D(projected.map((p) => toCanvas(p.u, p.v)));
      if (hull.length < 3) {
        return;
      }
      ctx.beginPath();
      hull.forEach(([x, y], i) => {
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = TARGET_SINGLE_COLOR;
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    // Cylinder: sample the top and bottom cap circles in true world X/Y (matching the upright,
    // un-rotated cylinder drawn in the 3D scene) and take the convex hull of their projections, same
    // approach as the cone below. A billboard rectangle (always facing the camera's "right" axis)
    // would look right side-on but wouldn't foreshorten toward the caps' circular outline at steep
    // (near-nadir) pitch, where a real cylinder's silhouette collapses toward a circle/ellipse.
    const CAP_SAMPLES = 24;
    const capPoints: Vec3[] = [];
    for (let i = 0; i < CAP_SAMPLES; i++) {
      const angle = (i / CAP_SAMPLES) * Math.PI * 2;
      const dx = Math.cos(angle) * halfWidth;
      const dy = Math.sin(angle) * halfWidth;
      capPoints.push({ x: target.x + dx, y: target.y + dy, z: z0 });
      capPoints.push({ x: target.x + dx, y: target.y + dy, z: z1 });
    }
    const edges: [Vec3, Vec3][] = [];
    for (let index = 0; index < CAP_SAMPLES; index++) {
      const next = (index + 1) % CAP_SAMPLES;
      edges.push([capPoints[index * 2], capPoints[next * 2]], [capPoints[index * 2 + 1], capPoints[next * 2 + 1]], [capPoints[index * 2], capPoints[index * 2 + 1]]);
    }
    const cylinderProjected = clipEdgesToFront(edges, cameraPosition, axes.forward).map((point) => worldToImage(point, cameraPosition, axes, intrinsics));
    const cylinderHull = convexHull2D(cylinderProjected.map((p) => toCanvas(p.u, p.v)));
    if (cylinderHull.length < 3) {
      return;
    }
    ctx.beginPath();
    cylinderHull.forEach(([x, y], i) => {
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = TARGET_SINGLE_COLOR;
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawPrincipalPointCrosshair(intrinsics: FrameCameraState["intrinsics"], toCanvas: (u: number, v: number) => [number, number]): void {
    const { u, v } = principalPointPixel(intrinsics);
    const [x, y] = toCanvas(u, v);
    const size = 10;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.strokeStyle = "#ff5a5f";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawFrameBorder(offsetX: number, offsetY: number, frameWidth: number, frameHeight: number): void {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, frameWidth - 1, frameHeight - 1);
  }

  /**
   * The target sits at a fixed world location (see `targetGroundLocation`), so both moving the
   * vehicle's X/Y and changing pitch/heading/roll can frame it out entirely. When that happens,
   * draw an arrow at the frame edge pointing (roughly) toward it - a simple "radar" cue rather than
   * perspective-exact, since the point may be behind the camera.
   */
  function drawTargetOffFrameIndicator(
    target: { x: number; y: number },
    cameraPosition: Vec3,
    axes: CameraAxes,
    groundElevation: number,
    intrinsics: FrameCameraState["intrinsics"],
    offsetX: number,
    offsetY: number,
    frameWidth: number,
    frameHeight: number,
  ): void {
    const targetCenter: Vec3 = { x: target.x, y: target.y, z: groundElevation + TARGET_SIZE.height / 2 };
    const projected = worldToImage(targetCenter, cameraPosition, axes, intrinsics);
    const withinFrame =
      !projected.behindCamera && projected.u >= 0 && projected.u <= intrinsics.imageWidth && projected.v >= 0 && projected.v <= intrinsics.imageHeight;
    if (withinFrame) {
      return;
    }

    const d = subVec(targetCenter, cameraPosition);
    const xc = dot(d, axes.right);
    const yc = dot(d, axes.up);
    const rotation = intrinsics.imageRotation * Math.PI / 180;
    const directionX = projected.behindCamera ? (xc * Math.cos(rotation) - yc * Math.sin(rotation)) * frameWidth / intrinsics.sensorWidth : (projected.u / intrinsics.imageWidth - 0.5) * frameWidth;
    const directionY = projected.behindCamera ? -(xc * Math.sin(rotation) + yc * Math.cos(rotation)) * frameHeight / intrinsics.sensorHeight : (projected.v / intrinsics.imageHeight - 0.5) * frameHeight;
    const len = Math.hypot(directionX, directionY);
    const dx = len > 1e-10 ? directionX / len : 0;
    const dy = len > 1e-10 ? directionY / len : -1;

    const cx = offsetX + frameWidth / 2;
    const cy = offsetY + frameHeight / 2;
    const margin = Math.min(16, frameWidth / 2, frameHeight / 2);
    const topInset = Math.min(frameHeight / 2, Math.max(margin, 46 - offsetY));
    const horizontalLimit = dx > 0 ? offsetX + frameWidth - margin : offsetX + margin;
    const verticalLimit = dy > 0 ? offsetY + frameHeight - margin : offsetY + topInset;
    const scale = Math.min(dx !== 0 ? Math.abs((horizontalLimit - cx) / dx) : Infinity, dy !== 0 ? Math.abs((verticalLimit - cy) / dy) : Infinity);
    const px = cx + dx * scale;
    const py = cy + dy * scale;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fillStyle = "#5fc4ff";
    ctx.fill();
    ctx.strokeStyle = "#08111c";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = "bold 11px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const textWidth = Math.min(ctx.measureText("target").width, Math.max(0, frameWidth - 8));
    const labelX = Math.max(offsetX + textWidth / 2 + 4, Math.min(offsetX + frameWidth - textWidth / 2 - 4, px - dx * (textWidth / 2 + 18)));
    const labelY = Math.max(offsetY + topInset, Math.min(offsetY + frameHeight - 8, py - dy * 20));
    drawTextBackground(labelX - textWidth / 2 - 4, labelY - 9, textWidth + 8, 18);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(8, 17, 28, 0.85)";
    ctx.strokeText("target", labelX, labelY, textWidth);
    ctx.fillStyle = "#5fc4ff";
    ctx.fillText("target", labelX, labelY, textWidth);
    ctx.restore();
  }

  function drawReadout(intrinsics: FrameCameraState["intrinsics"]): void {
    const { horizontalFieldOfView, verticalFieldOfView } = fieldOfView(intrinsics);
    const text = `f=${intrinsics.focalLength}mm  HFOV=${horizontalFieldOfView.toFixed(1)}\u00b0  VFOV=${verticalFieldOfView.toFixed(1)}\u00b0`;
    ctx.font = "12px sans-serif";
    const width = ctx.measureText(text).width;
    drawTextBackground(4, 4, width + 8, 20);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    ctx.fillText(text, 8, 8);
  }

  function update(state: FrameCameraState): void {
    previousState = currentState;
    currentState = state;
    render();
  }

  function setShowPreviousOverlay(show: boolean): void {
    showPreviousOverlay = show;
    render();
  }

  function setTargetShape(shape: TargetShapeKind): void {
    targetShape = shape;
    render();
  }

  return {
    update,
    redraw: render,
    setShowPreviousOverlay,
    setTargetShape,
    setProbe: (point) => { probe = point; render(); },
    destroy: () => {
      currentState = null;
      previousState = null;
    },
  };
}
