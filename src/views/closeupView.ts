/**
 * A lightweight, schematic wireframe diagram (canvas 2D, fixed axonometric projection - no
 * basemap/imagery, no ArcGIS SceneView) illustrating the sensor mount's orientation RELATIVE TO
 * THE VEHICLE: the vehicle is drawn as a fixed/canonical reference box (it never rotates by the
 * vehicle's own live world heading/pitch/roll - that's the main world view's job), while the
 * sensor/frustum rotates live with the mount heading/pitch/roll sliders, in the classic
 * heading -> pitch -> roll order (matching Esri's OrientedImageryLayer camera model).
 */
import {
  cameraAxesFromHeadingPitchRoll,
  cornerRayDirection,
  fieldOfView,
  intersectRayWithGroundPlane,
  type FrameCameraState,
  type ImageCorner,
  type Vec3,
} from "../geometry/frameCamera";
import { observeCanvasSize } from "../ui/layout";

/** Canonical vehicle body-frame basis (x=right, y=forward, z=up) - fixed, not the vehicle's live world attitude. */
const BODY_RIGHT: Vec3 = { x: 1, y: 0, z: 0 };
const BODY_FORWARD: Vec3 = { x: 0, y: 1, z: 0 };
const BODY_UP: Vec3 = { x: 0, y: 0, z: 1 };

/** Schematic vehicle box size (diagram units, not to scale with the real aircraft). */
const VEHICLE_BOX = { width: 2.2, depth: 4.4, height: 1.1 };
/** Schematic camera-housing box (diagram units), centered on the sensor position and oriented by
 *  the mount's forward/right/up axes - proportioned like the real camera_sensor.glb (boresight-axis
 *  and width roughly equal, height a bit shorter) so the frustum apex reads as "inside the camera". */
const SENSOR_BOX = { forward: 0.9, right: 0.9, up: 0.68 };
const AXIS_LENGTH = 3;
const SENSOR_AXIS_LENGTH = 2;
const ARC_RADIUS = { heading: 1.8, pitch: 1.5, roll: 1.1 };
/** Pitch's neutral/reference value is 90 (level with the nose), unlike heading/roll which are both 0. */
const PITCH_BASE = 90;
/** Fixed schematic ground plane (body-frame Z) the frustum projects onto - illustrative only, not tied to the real groundElevation slider. */
const GROUND_DEPTH = -10;
const FALLBACK_RAY_LENGTH = 9;
/** Ground intersections farther than this (diagram units) are treated as "never reaches the ground" - keeps near-horizon mount angles from blowing out the auto-fit framing. */
const MAX_GROUND_INTERSECT_DISTANCE = 60;
const CANVAS_PADDING = 34;
const DEFAULT_AZIMUTH = 35;
const DEFAULT_ELEVATION = 25;
const MIN_ELEVATION = -85;
const MAX_ELEVATION = 85;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;
const ROTATE_SPEED = 0.4; // degrees per pixel dragged

/** Rotates a diagram-space point about Z (azimuth, orbit around the vertical axis) then about the
 *  resulting X (elevation, tilt up/down) - a standard 2-axis "orbit camera" pair of rotations. */
function orbitRotate(v: Vec3, azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cosAz = Math.cos(az);
  const sinAz = Math.sin(az);
  const x1 = v.x * cosAz - v.y * sinAz;
  const y1 = v.x * sinAz + v.y * cosAz;
  const cosEl = Math.cos(el);
  const sinEl = Math.sin(el);
  const y2 = y1 * cosEl - v.z * sinEl;
  const z2 = y1 * sinEl + v.z * cosEl;
  return { x: x1, y: y2, z: z2 };
}

/** Orthographic projection (drop depth) of an orbit-rotated point - the depth axis (y2, into the screen) is discarded. */
function orbitProject(v: Vec3, azimuthDeg: number, elevationDeg: number): { x: number; y: number } {
  const r = orbitRotate(v, azimuthDeg, elevationDeg);
  return { x: r.x, y: -r.z };
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleVec(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function boxCorners(center: Vec3, halfWidth: number, halfDepth: number, halfHeight: number): Vec3[] {
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push({ x: center.x + sx * halfWidth, y: center.y + sy * halfDepth, z: center.z + sz * halfHeight });
      }
    }
  }
  return corners;
}

/** Same idea as `boxCorners`, but along an arbitrary orthonormal basis (the sensor's own rotated
 *  forward/right/up axes) instead of the world axes - so the drawn box rotates with the mount. */
function orientedBoxCorners(center: Vec3, forward: Vec3, right: Vec3, up: Vec3, halfForward: number, halfRight: number, halfUp: number): Vec3[] {
  const corners: Vec3[] = [];
  for (const sf of [-1, 1]) {
    for (const sr of [-1, 1]) {
      for (const su of [-1, 1]) {
        corners.push(
          addVec(center, addVec(scaleVec(forward, sf * halfForward), addVec(scaleVec(right, sr * halfRight), scaleVec(up, su * halfUp)))),
        );
      }
    }
  }
  return corners;
}

/** Edges connecting `boxCorners` entries that differ in exactly one axis sign (the 12 edges of a cube). */
const BOX_EDGES: [number, number][] = [
  [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
];

function headingSweepPoint(angleDeg: number): Vec3 {
  return cameraAxesFromHeadingPitchRoll({ heading: angleDeg, pitch: 90, roll: 0 }).forward;
}
function pitchSweepPoint(headingDeg: number, angleDeg: number): Vec3 {
  return cameraAxesFromHeadingPitchRoll({ heading: headingDeg, pitch: angleDeg, roll: 0 }).forward;
}
function rollSweepPoint(headingDeg: number, pitchDeg: number, angleDeg: number): Vec3 {
  return cameraAxesFromHeadingPitchRoll({ heading: headingDeg, pitch: pitchDeg, roll: angleDeg }).right;
}

function sampleArc(anchor: Vec3, radius: number, fromDeg: number, toDeg: number, directionAt: (angleDeg: number) => Vec3): Vec3[] {
  const steps = Math.max(2, Math.ceil(Math.abs(toDeg - fromDeg) / 8) + 1);
  const points: Vec3[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = fromDeg + ((toDeg - fromDeg) * i) / (steps - 1);
    points.push(addVec(anchor, scaleVec(directionAt(angle), radius)));
  }
  return points;
}

/** Where a frustum corner ray meets the schematic ground plane, or a fixed-length fallback point if it never would (e.g. mount pitch near the horizon). */
function footprintPoint(origin: Vec3, direction: Vec3): Vec3 {
  return (
    intersectRayWithGroundPlane(origin, direction, GROUND_DEPTH, MAX_GROUND_INTERSECT_DISTANCE) ?? addVec(origin, scaleVec(direction, FALLBACK_RAY_LENGTH))
  );
}

const FOOTPRINT_CORNERS: ImageCorner[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

/** Color key for the diagram, drawn as an on-canvas legend - the F/R/D axis colors double as their
 *  matching rotation, since heading/pitch/roll each sweep about one of those axes (heading about
 *  Down, pitch about Right, roll about Forward). Entries tagged with a `category` only appear while
 *  the matching guide is toggled on in the Adjustable Parameters pane; untagged entries are always drawn. */
const LEGEND_ITEMS: { color: string; label: string; category?: "axes" | "raster" }[] = [
  { color: "rgba(234, 244, 255, 0.7)", label: "Vehicle (fixed reference)" },
  { color: "rgba(255, 90, 95, 0.85)", label: "Camera / sensor" },
  { color: "#ffffff", label: "Lever arm" },
  { color: "#ffd21e", label: "Frustum / footprint" },
  { color: "#39ff14", label: "Forward (F) \u00b7 Roll", category: "axes" },
  { color: "#ff9900", label: "Right (R) \u00b7 Pitch", category: "axes" },
  { color: "#e930ff", label: "Down (D) \u00b7 Heading", category: "axes" },
  { color: "#8fd6ff", label: "Cols (raster)", category: "raster" },
  { color: "#ffb3c6", label: "Rows (raster)", category: "raster" },
];

export interface CloseupView {
  update: (state: FrameCameraState) => void;
  redraw: () => void;
  /** Toggles the vehicle body F/R/D axis guide (off by default - see the main world view's own toggle). */
  setShowVehicleAxes: (show: boolean) => void;
  /** Toggles the resolved sensor F'/R'/D' axis guide. */
  setShowSensorAxes: (show: boolean) => void;
  /** Toggles the heading/pitch/roll rotation-order arcs. */
  setShowRotationArcs: (show: boolean) => void;
  /** Toggles the footprint's TL/Cols/Rows raster-orientation labels. */
  setShowRasterLabels: (show: boolean) => void;
  /** Toggles the color-key legend (collapsed by default, opened via its own button). */
  setShowLegend: (show: boolean) => void;
  /** Sets what a plain (unmodified) drag does - matches the main scene's own pan/rotate toggle widget. */
  setNavMode: (mode: "pan" | "rotate") => void;
  destroy: () => void;
}

export function createCloseupView(canvas: HTMLCanvasElement): CloseupView {
  const ctx = canvas.getContext("2d")!;
  let currentState: FrameCameraState | null = null;

  // All guides default off to keep the diagram uncluttered - the user opts into whichever helps.
  let showVehicleAxes = false;
  let showSensorAxes = false;
  let showRotationArcs = false;
  let showRasterLabels = false;
  let showLegend = false;

  // User-adjustable orbit/pan/zoom, layered on top of the auto-fit framing computed each render.
  let azimuth = DEFAULT_AZIMUTH;
  let elevation = DEFAULT_ELEVATION;
  let zoom = 1;
  let panX = 0;
  let panY = 0;

  function render(): void {
    const state = currentState;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#08111c";
    ctx.fillRect(0, 0, cw, ch);
    if (!state || cw === 0 || ch === 0) {
      return;
    }

    const { sensorMount, intrinsics } = state;
    const { leverArm, orientation: mountOrientation } = sensorMount;

    const sensorPosition = addVec(
      addVec(scaleVec(BODY_FORWARD, leverArm.forward), scaleVec(BODY_RIGHT, leverArm.right)),
      scaleVec(BODY_UP, -leverArm.down),
    );
    const sensorAxes = cameraAxesFromHeadingPitchRoll(mountOrientation);

    const footprintPoints = FOOTPRINT_CORNERS.map((corner) => footprintPoint(sensorPosition, cornerRayDirection(corner, sensorAxes, intrinsics)));

    const vehicleCorners = boxCorners({ x: 0, y: 0, z: 0 }, VEHICLE_BOX.width / 2, VEHICLE_BOX.depth / 2, VEHICLE_BOX.height / 2);
    // Camera-housing box centered exactly on sensorPosition (the same point the frustum rays
    // originate from) - a corner-anchored box read as "the dot escaped the box" instead of "inside it".
    const sensorCorners = orientedBoxCorners(
      sensorPosition,
      sensorAxes.forward,
      sensorAxes.right,
      sensorAxes.up,
      SENSOR_BOX.forward / 2,
      SENSOR_BOX.right / 2,
      SENSOR_BOX.up / 2,
    );
    const forwardTip = scaleVec(BODY_FORWARD, AXIS_LENGTH);
    const rightTip = scaleVec(BODY_RIGHT, AXIS_LENGTH);
    const downTip = scaleVec(BODY_UP, -AXIS_LENGTH);
    const sensorForwardTip = addVec(sensorPosition, scaleVec(sensorAxes.forward, SENSOR_AXIS_LENGTH));
    const sensorRightTip = addVec(sensorPosition, scaleVec(sensorAxes.right, SENSOR_AXIS_LENGTH));
    const sensorDownTip = addVec(sensorPosition, scaleVec(sensorAxes.up, -SENSOR_AXIS_LENGTH));

    const headingArc = sampleArc(sensorPosition, ARC_RADIUS.heading, 0, mountOrientation.heading, headingSweepPoint);
    const pitchArc = sampleArc(sensorPosition, ARC_RADIUS.pitch, PITCH_BASE, mountOrientation.pitch, (a) => pitchSweepPoint(mountOrientation.heading, a));
    const rollArc = sampleArc(sensorPosition, ARC_RADIUS.roll, 0, mountOrientation.roll, (a) => rollSweepPoint(mountOrientation.heading, mountOrientation.pitch, a));

    // Auto-fit: project everything once to find the 2D bounds, then derive a scale+offset that
    // always frames the whole diagram, regardless of lever arm distance or frustum extent. Only
    // points that will actually be drawn count, so hiding guides also lets the view zoom in tighter.
    const allPoints: Vec3[] = [
      ...vehicleCorners,
      ...sensorCorners,
      sensorPosition,
      ...footprintPoints,
      ...(showVehicleAxes ? [forwardTip, rightTip, downTip] : []),
      ...(showSensorAxes ? [sensorForwardTip, sensorRightTip, sensorDownTip] : []),
      ...(showRotationArcs ? [...headingArc, ...pitchArc, ...rollArc] : []),
    ];
    const projected = allPoints.map((p) => orbitProject(p, azimuth, elevation));
    const minX = Math.min(...projected.map((p) => p.x));
    const maxX = Math.max(...projected.map((p) => p.x));
    const minY = Math.min(...projected.map((p) => p.y));
    const maxY = Math.max(...projected.map((p) => p.y));
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const baseScale = Math.min((cw - 2 * CANVAS_PADDING) / spanX, (ch - 2 * CANVAS_PADDING) / spanY);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const toCanvas = (v: Vec3): [number, number] => {
      const p = orbitProject(v, azimuth, elevation);
      return [cw / 2 + (p.x - midX) * baseScale * zoom + panX, ch / 2 + (p.y - midY) * baseScale * zoom + panY];
    };

    const leverArmLength = Math.sqrt(leverArm.forward ** 2 + leverArm.right ** 2 + leverArm.down ** 2);

    drawFootprint(footprintPoints, toCanvas);
    drawLeverArm({ x: 0, y: 0, z: 0 }, sensorPosition, toCanvas, `${leverArmLength.toFixed(1)} m`);
    drawFrustum(sensorPosition, footprintPoints, toCanvas);
    drawVehicleBox(vehicleCorners, toCanvas);
    drawSensorBox(sensorCorners, toCanvas);
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    drawHaloText("Vehicle", ...toCanvas({ x: 0, y: VEHICLE_BOX.depth / 2, z: VEHICLE_BOX.height / 2 + 0.3 }), "rgba(234, 244, 255, 0.85)");
    drawHaloText("Camera", ...toCanvas(addVec(sensorPosition, scaleVec(sensorAxes.up, SENSOR_BOX.up / 2 + 0.3))), "#ff9da0");
    if (showVehicleAxes) {
      drawAxis({ x: 0, y: 0, z: 0 }, forwardTip, "#39ff14", "F", toCanvas);
      drawAxis({ x: 0, y: 0, z: 0 }, rightTip, "#ff9900", "R", toCanvas);
      drawAxis({ x: 0, y: 0, z: 0 }, downTip, "#e930ff", "D", toCanvas);
    }
    if (showSensorAxes) {
      drawAxis(sensorPosition, sensorForwardTip, "#39ff14", "F'", toCanvas, true);
      drawAxis(sensorPosition, sensorRightTip, "#ff9900", "R'", toCanvas, true);
      drawAxis(sensorPosition, sensorDownTip, "#e930ff", "D'", toCanvas, true);
    }
    if (showRotationArcs) {
      drawArc(headingArc, "#e930ff", `\u2460 Heading ${mountOrientation.heading.toFixed(0)}\u00b0`, toCanvas);
      drawArc(
        pitchArc,
        "#ff9900",
        `\u2461 Pitch ${mountOrientation.pitch.toFixed(0)}\u00b0 (\u0394${(mountOrientation.pitch - PITCH_BASE).toFixed(0)}\u00b0 from level)`,
        toCanvas,
      );
      drawArc(rollArc, "#39ff14", `\u2462 Roll ${mountOrientation.roll.toFixed(0)}\u00b0`, toCanvas);
    }
    drawSensorDot(sensorPosition, toCanvas);
    if (showRasterLabels) {
      drawFootprintLabels(footprintPoints, toCanvas);
    }
    drawReadout(intrinsics, leverArm);
    if (showLegend) {
      drawLegend();
    }
    drawInteractionHint();
  }

  /** Solid white rod from the vehicle reference point to the sensor - same rigid attachment shown
   *  as the "leverArmLayer" line in the main world view, so the vehicle box and camera box read as
   *  one physically-connected assembly instead of two unrelated floating shapes. Labeled with its
   *  own length at the midpoint so the distance reads directly off the geometry, not just the corner readout. */
  function drawLeverArm(from: Vec3, to: Vec3, toCanvas: (v: Vec3) => [number, number], label: string): void {
    const [ax, ay] = toCanvas(from);
    const [bx, by] = toCanvas(to);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "10.5px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    drawHaloText(label, (ax + bx) / 2 + 6, (ay + by) / 2, "#ffffff");
  }

  function drawVehicleBox(corners: Vec3[], toCanvas: (v: Vec3) => [number, number]): void {
    ctx.beginPath();
    for (const [a, b] of BOX_EDGES) {
      const [ax, ay] = toCanvas(corners[a]);
      const [bx, by] = toCanvas(corners[b]);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = "rgba(234, 244, 255, 0.55)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  /** The camera housing box (rotates with the mount) - drawn in the same red used for the fallback
   *  procedural sensor shape in the main world view, so the frustum apex is visibly inside a "camera". */
  function drawSensorBox(corners: Vec3[], toCanvas: (v: Vec3) => [number, number]): void {
    ctx.beginPath();
    for (const [a, b] of BOX_EDGES) {
      const [ax, ay] = toCanvas(corners[a]);
      const [bx, by] = toCanvas(corners[b]);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = "rgba(255, 90, 95, 0.85)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  function drawAxis(from: Vec3, to: Vec3, color: string, label: string, toCanvas: (v: Vec3) => [number, number], dashed = false): void {
    const [ax, ay] = toCanvas(from);
    const [bx, by] = toCanvas(to);
    ctx.save();
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = color;
    ctx.lineWidth = dashed ? 1.5 : 2.5;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = color;
    ctx.font = "bold 12px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    drawHaloText(label, bx, by, color);
  }

  /** Sweep guide from a base/reference angle out to the current value: a dashed arc, tick dots
   *  spaced along the sweep (more dots = a bigger rotation from base), a hollow marker at the base
   *  and a filled marker at the current value - so both dot density and marker position convey how
   *  far the current value has moved from its base, not just the raw sweep angle. */
  function drawArc(points: Vec3[], color: string, label: string, toCanvas: (v: Vec3) => [number, number]): void {
    if (points.length < 2) {
      return;
    }
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = toCanvas(p);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 1; i < points.length - 1; i++) {
      const [x, y] = toCanvas(points[i]);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    const [baseX, baseY] = toCanvas(points[0]);
    ctx.beginPath();
    ctx.arc(baseX, baseY, 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const [lx, ly] = toCanvas(points[points.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.font = "11px sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    drawHaloText(label, lx + 6, ly + 6, color);
  }

  /** Draws text with a dark halo stroke behind it, so labels stay legible over crossing wireframe lines of any color. */
  function drawHaloText(text: string, x: number, y: number, color: string): void {
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(8, 17, 28, 0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawSensorDot(position: Vec3, toCanvas: (v: Vec3) => [number, number]): void {
    const [x, y] = toCanvas(position);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ff5a5f";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawFrustum(sensorPosition: Vec3, footprintPoints: Vec3[], toCanvas: (v: Vec3) => [number, number]): void {
    ctx.beginPath();
    for (const corner of footprintPoints) {
      const [ax, ay] = toCanvas(sensorPosition);
      const [bx, by] = toCanvas(corner);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = "#ffd21e";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawFootprint(points: Vec3[], toCanvas: (v: Vec3) => [number, number]): void {
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = toCanvas(p);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.strokeStyle = "rgba(255, 210, 30, 0.6)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  /** Labels the "TL" (top-left) corner and the raster Cols/Rows directions, matching the image-space viewer's raster convention. */
  function drawFootprintLabels(points: Vec3[], toCanvas: (v: Vec3) => [number, number]): void {
    const [topLeft, topRight, , bottomLeft] = points;
    const [tlx, tly] = toCanvas(topLeft);
    const [trx, tryy] = toCanvas(topRight);
    const [blx, bly] = toCanvas(bottomLeft);

    ctx.font = "11px sans-serif";
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    drawHaloText("TL", tlx + 3, tly - 3, "#eaf4ff");

    drawArrow(tlx, tly, tlx + (trx - tlx) * 0.3, tly + (tryy - tly) * 0.3, "#8fd6ff");
    drawHaloText("Cols", tlx + (trx - tlx) * 0.35, tly + (tryy - tly) * 0.35, "#8fd6ff");

    drawArrow(tlx, tly, tlx + (blx - tlx) * 0.3, tly + (bly - tly) * 0.3, "#ffb3c6");
    drawHaloText("Rows", tlx + (blx - tlx) * 0.35, tly + (bly - tly) * 0.35, "#ffb3c6");
  }

  function drawArrow(x0: number, y0: number, x1: number, y1: number, color: string): void {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const angle = Math.atan2(y1 - y0, x1 - x0);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-6, 3);
    ctx.lineTo(-6, -3);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawReadout(intrinsics: FrameCameraState["intrinsics"], leverArm: FrameCameraState["sensorMount"]["leverArm"]): void {
    const { horizontalFieldOfView, verticalFieldOfView } = fieldOfView(intrinsics);
    const line1 = `HFOV=${horizontalFieldOfView.toFixed(1)}\u00b0  VFOV=${verticalFieldOfView.toFixed(1)}\u00b0`;
    const line2 = `Lever arm F${leverArm.forward.toFixed(1)} R${leverArm.right.toFixed(1)} D${leverArm.down.toFixed(1)} m`;
    ctx.font = "12px sans-serif";
    const width = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    drawTextBackground(4, 4, width + 8, 36);
    ctx.fillStyle = "#eaf4ff";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(line1, 8, 8);
    ctx.fillText(line2, 8, 24);
  }

  function drawInteractionHint(): void {
    const text = `Drag: ${navMode} \u00b7 Shift/right-drag: ${navMode === "pan" ? "rotate" : "pan"} \u00b7 Scroll: zoom \u00b7 Double-click: reset`;
    ctx.font = "10px sans-serif";
    const width = ctx.measureText(text).width;
    drawTextBackground(4, canvas.height - 22, width + 8, 18);
    ctx.fillStyle = "rgba(234, 244, 255, 0.75)";
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText(text, 8, canvas.height - 6);
  }

  /** Color-key legend anchored bottom-right, clear of the top-left readout, the top-right pan/rotate
   *  toggle, and the bottom-left interaction hint. Only lists entries for guides actually toggled on
   *  in the Adjustable Parameters pane (axes/rotation arcs share one category; raster labels another). */
  function drawLegend(): void {
    const showAxes = showVehicleAxes || showSensorAxes || showRotationArcs;
    const items = LEGEND_ITEMS.filter((item) => {
      if (item.category === "axes") return showAxes;
      if (item.category === "raster") return showRasterLabels;
      return true;
    });
    const rowHeight = 14;
    const swatchSize = 9;
    const padding = 6;
    ctx.font = "10.5px sans-serif";
    const textWidth = Math.max(...items.map((item) => ctx.measureText(item.label).width));
    const width = padding * 2 + swatchSize + 6 + textWidth;
    const height = padding * 2 + items.length * rowHeight;
    const x = canvas.width - width - 6;
    const y = canvas.height - height - 26;
    drawTextBackground(x, y, width, height);
    items.forEach((item, i) => {
      const rowY = y + padding + i * rowHeight + rowHeight / 2;
      ctx.fillStyle = item.color;
      ctx.fillRect(x + padding, rowY - swatchSize / 2, swatchSize, swatchSize);
      ctx.fillStyle = "#eaf4ff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(item.label, x + padding + swatchSize + 6, rowY);
    });
  }

  /** A subtle rounded, semi-transparent chip behind a block of text, so it stays legible over the wireframe. */
  function drawTextBackground(x: number, y: number, width: number, height: number): void {
    ctx.fillStyle = "rgba(8, 17, 28, 0.6)";
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.fill();
  }

  function resetView(): void {
    azimuth = DEFAULT_AZIMUTH;
    elevation = DEFAULT_ELEVATION;
    zoom = 1;
    panX = 0;
    panY = 0;
    render();
  }

  // What a plain (unmodified) drag does - toggled via the pan/rotate buttons, matching the main
  // scene's own navigation-toggle widget. Shift/right-click still temporarily invert it either way.
  let navMode: "pan" | "rotate" = "rotate";
  let dragMode: "rotate" | "pan" | null = null;
  let lastX = 0;
  let lastY = 0;

  function pointerDown(event: PointerEvent): void {
    const inverted = event.button === 2 || event.shiftKey;
    dragMode = inverted ? (navMode === "pan" ? "rotate" : "pan") : navMode;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = dragMode === "pan" ? "move" : "grabbing";
    event.preventDefault();
  }

  function pointerMove(event: PointerEvent): void {
    if (!dragMode) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (dragMode === "rotate") {
      azimuth += dx * ROTATE_SPEED;
      elevation = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, elevation - dy * ROTATE_SPEED));
    } else {
      panX += dx;
      panY += dy;
    }
    render();
  }

  function pointerUp(event: PointerEvent): void {
    dragMode = null;
    canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  }

  function wheel(event: WheelEvent): void {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.001);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    render();
  }

  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("dblclick", resetView);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  function update(state: FrameCameraState): void {
    currentState = state;
    render();
  }

  function setShowVehicleAxes(show: boolean): void {
    showVehicleAxes = show;
    render();
  }

  function setShowSensorAxes(show: boolean): void {
    showSensorAxes = show;
    render();
  }

  function setShowRotationArcs(show: boolean): void {
    showRotationArcs = show;
    render();
  }

  function setShowRasterLabels(show: boolean): void {
    showRasterLabels = show;
    render();
  }

  function setShowLegend(show: boolean): void {
    showLegend = show;
    render();
  }

  function setNavMode(mode: "pan" | "rotate"): void {
    navMode = mode;
    render();
  }

  const disposeResize = observeCanvasSize(canvas, () => render());

  return {
    update,
    redraw: render,
    setShowVehicleAxes,
    setShowSensorAxes,
    setShowRotationArcs,
    setShowRasterLabels,
    setShowLegend,
    setNavMode,
    destroy: () => {
      currentState = null;
      disposeResize();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", resetView);
    },
  };
}
