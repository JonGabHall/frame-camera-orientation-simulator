import Map from "@arcgis/core/Map.js";
import Ground from "@arcgis/core/Ground.js";
import SceneView from "@arcgis/core/views/SceneView.js";
import Camera from "@arcgis/core/Camera.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import Polyline from "@arcgis/core/geometry/Polyline.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import SpatialReference from "@arcgis/core/geometry/SpatialReference.js";
import { lngLatToXY } from "@arcgis/core/geometry/support/webMercatorUtils.js";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D.js";
import ObjectSymbol3DLayer from "@arcgis/core/symbols/ObjectSymbol3DLayer.js";
import PolygonSymbol3D from "@arcgis/core/symbols/PolygonSymbol3D.js";
import FillSymbol3DLayer from "@arcgis/core/symbols/FillSymbol3DLayer.js";
import LineSymbol3D from "@arcgis/core/symbols/LineSymbol3D.js";
import LineSymbol3DLayer from "@arcgis/core/symbols/LineSymbol3DLayer.js";
import LineStylePattern3D from "@arcgis/core/symbols/patterns/LineStylePattern3D.js";
import TextSymbol3DLayer from "@arcgis/core/symbols/TextSymbol3DLayer.js";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol.js";

import {
  applySensorMount,
  cameraAxesFromHeadingPitchRoll,
  cornerRayDirection,
  intersectRayWithGroundPlane,
  type ExteriorOrientation,
  type FrameCameraState,
  type ImageCorner,
  type Vec3,
} from "../geometry/frameCamera";
import { TARGET_SIZE, TARGET_FACE_COLORS, TARGET_SINGLE_COLOR, DEFAULT_TARGET_SHAPE, targetGroundLocation, type TargetShapeKind } from "../state/sceneObjects";

const FOOTPRINT_CORNERS: ImageCorner[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

/** Arbitrary real-world anchor for the local ENU origin (0,0) - purely visual context; the camera math is local and translation-invariant. */
const ORIGIN_LON = -117.1956;
const ORIGIN_LAT = 34.0561;

/** Local glTF models (see public/models/) - both sized to fit their bounding box below regardless of the file's native scale.
 *  Prefixed with BASE_URL (not a root-absolute "/") so these still resolve correctly if the app is
 *  hosted under a subfolder rather than a domain root - see vite.config.ts's relative `base`. */
const VEHICLE_MODEL_URL = `${import.meta.env.BASE_URL}models/drone_fixed_wing.glb`;
const VEHICLE_MODEL_SIZE = { width: 24, depth: 20, height: 6 };
const SENSOR_MODEL_URL = `${import.meta.env.BASE_URL}models/camera_sensor.glb`;
const SENSOR_MODEL_SIZE = { width: 4, depth: 4, height: 3 };
/** camera_sensor.glb's lens barrel extends well past its own bounding-box center (the anchor="center"
 *  pivot) toward the front lens element - measured from the model's own mesh bounds (accessor min/max)
 *  and scaled by SENSOR_MODEL_SIZE.depth, the front lens element sits 2m forward of that pivot along
 *  the boresight. camera.position (the frustum apex) is the mount's true optical center, so the visual
 *  model is placed 2m *behind* it along the boresight - that shifts the model back until its lens
 *  element (not its bounding-box middle) lines up with the frustum apex. */
const SENSOR_LENS_TIP_OFFSET = 2.0;

type Orientation = FrameCameraState["vehicle"]["orientation"];

/** Length (meters) drawn for frustum edges whose ray never reaches the ground plane. */
const FALLBACK_RAY_DISTANCE = 600;
/** Ground intersections farther than this (meters) are treated as "never reaches the ground" - keeps near-horizon mount angles from producing absurdly distant footprint/frustum points. */
const MAX_GROUND_INTERSECT_DISTANCE = 20_000;

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleVec(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export interface WorldViewOptions {
  /** Called with local ENU X/Y (meters) when the user clicks a location in the scene. */
  onPositionPick?: (x: number, y: number) => void;
}

export interface WorldView {
  view: SceneView;
  update: (state: FrameCameraState) => void;
  /** Toggles a dimmed/dashed overlay of the frustum + footprint from before the most recent Regenerate, for before/after comparison. */
  setShowPreviousOverlay: (show: boolean) => void;
  /** Toggles the neon forward/right/down guide anchored on the vehicle - the frame the lever arm sliders operate in. */
  setShowVehicleAxes: (show: boolean) => void;
  /** Toggles the neon forward/right/down guide anchored on the resolved sensor/camera (after lever arm + boresight). */
  setShowSensorAxes: (show: boolean) => void;
  /** Toggles the curved heading/pitch/roll sweep guides showing which vehicle-orientation slider drives which rotation. */
  setShowRotationArcs: (show: boolean) => void;
  /** Swaps the sample target's shape (box shows per-face colors; other shapes use one solid color). */
  setTargetShape: (shape: TargetShapeKind) => void;
  setProbe: (baseline: Vec3 | null, current: Vec3 | null) => void;
  /** Zooms the camera in tight on the vehicle's current position. */
  zoomToVehicle: () => void;
  destroy: () => void;
}

const lineSymbol = new LineSymbol3D({
  symbolLayers: [new LineSymbol3DLayer({ size: 2, material: { color: "#ffd21e" } })],
});

const previousLineSymbol = new LineSymbol3D({
  symbolLayers: [
    new LineSymbol3DLayer({
      size: 1.5,
      material: { color: [255, 255, 255, 0.55] },
      pattern: new LineStylePattern3D({ style: "dash" }),
    }),
  ],
});

const leverArmSymbol = new LineSymbol3D({
  symbolLayers: [new LineSymbol3DLayer({ size: 1.5, material: { color: "#ffffff" } })],
});

/** Length (meters) of the vehicle body-frame axis guide - the frame the lever arm forward/right/down sliders operate in. */
const BODY_AXIS_LENGTH = 14;

const bodyAxisForwardSymbol = new LineSymbol3D({
  symbolLayers: [new LineSymbol3DLayer({ size: 3, material: { color: "#39ff14" } })],
});
const bodyAxisRightSymbol = new LineSymbol3D({
  symbolLayers: [new LineSymbol3DLayer({ size: 3, material: { color: "#ff9900" } })],
});
const bodyAxisDownSymbol = new LineSymbol3D({
  symbolLayers: [new LineSymbol3DLayer({ size: 3, material: { color: "#e930ff" } })],
});

function bodyAxisLabelSymbol(text: string, color: string): PointSymbol3D {
  return new PointSymbol3D({
    symbolLayers: [new TextSymbol3DLayer({ text, material: { color }, halo: { color: "#000000", size: 1 }, size: 12 })],
  });
}

const bodyAxisLabels = {
  forward: bodyAxisLabelSymbol("F (forward)", "#39ff14"),
  right: bodyAxisLabelSymbol("R (right)", "#ff9900"),
  down: bodyAxisLabelSymbol("D (down)", "#e930ff"),
};

/** Sensor/camera axes reuse the vehicle guide's colors but dashed, so an overlapping vehicle+sensor guide stays legible. */
function sensorAxisSymbol(color: string): LineSymbol3D {
  return new LineSymbol3D({
    symbolLayers: [new LineSymbol3DLayer({ size: 3, material: { color }, pattern: new LineStylePattern3D({ style: "dash" }) })],
  });
}

const sensorAxisForwardSymbol = sensorAxisSymbol("#39ff14");
const sensorAxisRightSymbol = sensorAxisSymbol("#ff9900");
const sensorAxisDownSymbol = sensorAxisSymbol("#e930ff");

const sensorAxisLabels = {
  forward: bodyAxisLabelSymbol("F' (sensor forward)", "#39ff14"),
  right: bodyAxisLabelSymbol("R' (sensor right)", "#ff9900"),
  down: bodyAxisLabelSymbol("D' (sensor down)", "#e930ff"),
};

/**
 * Curved sweep guides showing which rotation each vehicle-orientation slider controls: heading
 * sweeps compass-flat from North, pitch sweeps from nadir up to the current forward direction
 * (holding heading fixed), and roll sweeps the right/wingtip axis from level to the current bank.
 * Colors match the axis each rotation turns about (heading turns the vertical/"down" axis, pitch
 * turns the "right" axis, roll turns the "forward" axis) so guide color = rotation-axis color.
 */
const ROTATION_ARC_RADIUS_HEADING = 12;
const ROTATION_ARC_RADIUS_PITCH = 10;
const ROTATION_ARC_RADIUS_ROLL = 8;

function rotationArcSymbol(color: string): LineSymbol3D {
  return new LineSymbol3D({
    symbolLayers: [new LineSymbol3DLayer({ size: 2.5, material: { color }, pattern: new LineStylePattern3D({ style: "dot" }) })],
  });
}

const rotationArcHeadingSymbol = rotationArcSymbol("#e930ff");
const rotationArcPitchSymbol = rotationArcSymbol("#ff9900");
const rotationArcRollSymbol = rotationArcSymbol("#39ff14");

function headingSweepDirection(angleDeg: number): Vec3 {
  return cameraAxesFromHeadingPitchRoll({ heading: angleDeg, pitch: 90, roll: 0 }).forward;
}
function pitchSweepDirection(headingDeg: number, angleDeg: number): Vec3 {
  return cameraAxesFromHeadingPitchRoll({ heading: headingDeg, pitch: angleDeg, roll: 0 }).forward;
}
function rollSweepDirection(headingDeg: number, pitchDeg: number, angleDeg: number): Vec3 {
  return cameraAxesFromHeadingPitchRoll({ heading: headingDeg, pitch: pitchDeg, roll: angleDeg }).right;
}

function sampleSweepPoints(center: Vec3, radius: number, fromDeg: number, toDeg: number, directionAt: (angleDeg: number) => Vec3): Vec3[] {
  const steps = Math.max(2, Math.ceil(Math.abs(toDeg - fromDeg) / 6) + 1);
  const points: Vec3[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = fromDeg + ((toDeg - fromDeg) * i) / (steps - 1);
    points.push(addVec(center, scaleVec(directionAt(angle), radius)));
  }
  return points;
}

const footprintSymbol = new PolygonSymbol3D({
  symbolLayers: [
    new FillSymbol3DLayer({
      material: { color: [255, 210, 30, 0.25] },
      outline: { color: "#ffd21e", size: 2 },
    }),
  ],
});

const previousFootprintSymbol = new PolygonSymbol3D({
  symbolLayers: [
    new FillSymbol3DLayer({
      material: { color: [255, 255, 255, 0.06] },
      outline: { color: [255, 255, 255, 0.5], size: 1.5 },
    }),
  ],
});

/** Thin "slab" thickness (meters) for each colored face of the box-shaped target. */
const TARGET_FACE_THICKNESS = 1;

function faceSlabSymbol(color: string, width: number, depth: number, height: number): PointSymbol3D {
  return new PointSymbol3D({
    symbolLayers: [new ObjectSymbol3DLayer({ resource: { primitive: "cube" }, width, depth, height, material: { color } })],
  });
}

/** One thin colored slab per box face, positioned at that face's own center (not the box's center) so each reads as a distinct painted side.
 *  Top/bottom span the full width/depth; the 4 wall panels are inset by the wall thickness on every edge so they fit
 *  flush between the top/bottom caps and each other without overlapping (overlapping slabs caused GPU z-fighting,
 *  rendering as jumbled color slivers instead of clean single-color faces). */
const targetFaceSymbols = {
  top: faceSlabSymbol(TARGET_FACE_COLORS.top, TARGET_SIZE.width, TARGET_SIZE.depth, TARGET_FACE_THICKNESS),
  bottom: faceSlabSymbol(TARGET_FACE_COLORS.bottom, TARGET_SIZE.width, TARGET_SIZE.depth, TARGET_FACE_THICKNESS),
  north: faceSlabSymbol(TARGET_FACE_COLORS.north, TARGET_SIZE.width, TARGET_FACE_THICKNESS, TARGET_SIZE.height - 2 * TARGET_FACE_THICKNESS),
  south: faceSlabSymbol(TARGET_FACE_COLORS.south, TARGET_SIZE.width, TARGET_FACE_THICKNESS, TARGET_SIZE.height - 2 * TARGET_FACE_THICKNESS),
  east: faceSlabSymbol(
    TARGET_FACE_COLORS.east,
    TARGET_FACE_THICKNESS,
    TARGET_SIZE.depth - 2 * TARGET_FACE_THICKNESS,
    TARGET_SIZE.height - 2 * TARGET_FACE_THICKNESS,
  ),
  west: faceSlabSymbol(
    TARGET_FACE_COLORS.west,
    TARGET_FACE_THICKNESS,
    TARGET_SIZE.depth - 2 * TARGET_FACE_THICKNESS,
    TARGET_SIZE.height - 2 * TARGET_FACE_THICKNESS,
  ),
};

/** Non-box shapes have no meaningful "which side" distinction, so they use one solid color. */
function targetPrimitiveSymbol(primitive: "sphere" | "cone" | "cylinder"): PointSymbol3D {
  return new PointSymbol3D({
    symbolLayers: [
      new ObjectSymbol3DLayer({
        resource: { primitive },
        width: TARGET_SIZE.width,
        depth: TARGET_SIZE.depth,
        height: TARGET_SIZE.height,
        material: { color: TARGET_SINGLE_COLOR },
      }),
    ],
  });
}

const targetSphereSymbol = targetPrimitiveSymbol("sphere");
const targetConeSymbol = targetPrimitiveSymbol("cone");
const targetCylinderSymbol = targetPrimitiveSymbol("cylinder");

/**
 * A plain cone is rotationally symmetric about its own axis, so it can't show roll/bank and its
 * "front" (nose) is only readable from a subtle tip direction. This builds a small dart/plane-like
 * shape instead - a slender nose cone (heading/pitch direction) plus a flat crossbar perpendicular to
 * it (wings) - so bank angle visibly tilts the crossbar and the nose unambiguously marks "front".
 * Used as the vehicle's fallback while the real aircraft model loads (or if it fails to load).
 * Maps our Esri-OI pitch (0=nadir,90=horizon,180=zenith) to ObjectSymbol3DLayer's tilt (0=level, + lifts the front).
 */
function dartSymbol(orientation: Orientation, color: string, size: number): PointSymbol3D {
  const tilt = orientation.pitch - 90;
  return new PointSymbol3D({
    symbolLayers: [
      new ObjectSymbol3DLayer({
        resource: { primitive: "cone" },
        width: size * 0.6,
        depth: size * 0.6,
        height: size * 3,
        heading: orientation.heading,
        tilt,
        roll: orientation.roll,
        material: { color },
      }),
      new ObjectSymbol3DLayer({
        resource: { primitive: "cube" },
        width: size * 3.2,
        depth: size * 0.5,
        height: size * 0.25,
        heading: orientation.heading,
        tilt,
        roll: orientation.roll,
        material: { color },
      }),
    ],
  });
}

/**
 * A camera/scanner pod: a boxy housing with a dark forward-facing lens cone (marks "front", same
 * asymmetry trick as the dart shape) plus a thin fin on top so bank/roll of the sensor mount is
 * also visible, not just the vehicle's.
 */
function sensorSymbol(orientation: Orientation, color: string, size: number): PointSymbol3D {
  const tilt = orientation.pitch - 90;
  return new PointSymbol3D({
    symbolLayers: [
      new ObjectSymbol3DLayer({
        resource: { primitive: "cube" },
        width: size * 1.4,
        depth: size * 1.4,
        height: size,
        heading: orientation.heading,
        tilt,
        roll: orientation.roll,
        material: { color },
      }),
      new ObjectSymbol3DLayer({
        resource: { primitive: "cone" },
        width: size * 0.6,
        depth: size * 0.6,
        height: size * 1.3,
        heading: orientation.heading,
        tilt,
        roll: orientation.roll,
        material: { color: "#1c1c1c" },
      }),
      new ObjectSymbol3DLayer({
        resource: { primitive: "cube" },
        width: size * 1.6,
        depth: size * 0.25,
        height: size * 0.15,
        heading: orientation.heading,
        tilt,
        roll: orientation.roll,
        material: { color },
      }),
    ],
  });
}

function frustumCornerPoints(camera: ExteriorOrientation, state: FrameCameraState): Vec3[] {
  const axes = cameraAxesFromHeadingPitchRoll(camera.orientation);
  return FOOTPRINT_CORNERS.map((corner) => {
    const direction = cornerRayDirection(corner, axes, state.intrinsics);
    const hit = intersectRayWithGroundPlane(camera.position, direction, state.groundElevation, MAX_GROUND_INTERSECT_DISTANCE);
    return hit ?? addVec(camera.position, scaleVec(direction, FALLBACK_RAY_DISTANCE));
  });
}

export function createWorldView(container: HTMLDivElement, initialState: FrameCameraState, options: WorldViewOptions = {}): WorldView {
  const [originX, originY] = lngLatToXY(ORIGIN_LON, ORIGIN_LAT);
  const sr = SpatialReference.WebMercator;

  function toMapPoint(local: Vec3): Point {
    return new Point({ x: originX + local.x, y: originY + local.y, z: local.z, spatialReference: sr });
  }

  function polylineGraphic(from: Vec3, to: Vec3, symbol: LineSymbol3D): Graphic {
    return new Graphic({
      geometry: new Polyline({
        paths: [[[originX + from.x, originY + from.y, from.z], [originX + to.x, originY + to.y, to.z]]],
        spatialReference: sr,
      }),
      symbol,
    });
  }

  function sweepPolylineGraphic(points: Vec3[], symbol: LineSymbol3D): Graphic {
    return new Graphic({
      geometry: new Polyline({
        paths: [points.map((p) => [originX + p.x, originY + p.y, p.z])],
        spatialReference: sr,
      }),
      symbol,
    });
  }

  const map = new Map({
    basemap: "satellite",
    // Flat (0m) elevation everywhere so the visible ground matches the flat-plane footprint math.
    ground: new Ground({ layers: [] }),
  });

  const footprintLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const frustumLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const previousFootprintLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const previousFrustumLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const targetLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const vehicleLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const sensorLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const leverArmLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const vehicleAxesLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const sensorAxesLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const rotationArcsLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  const probeLayer = new GraphicsLayer({ elevationInfo: { mode: "absolute-height" } });
  // Previous-overlay layers added first so the current frustum/footprint always draws on top of them.
  map.addMany([
    previousFootprintLayer,
    previousFrustumLayer,
    footprintLayer,
    frustumLayer,
    targetLayer,
    leverArmLayer,
    vehicleAxesLayer,
    sensorAxesLayer,
    rotationArcsLayer,
    probeLayer,
    vehicleLayer,
    sensorLayer,
  ]);

  const view = new SceneView({
    container,
    map,
    qualityProfile: "high",
    popupEnabled: false,
    camera: {
      // Placeholder - replaced immediately below with a nadir view fit to the initial vehicle/footprint.
      position: { x: originX, y: originY, z: initialState.vehicle.position.z + 300, spatialReference: sr },
      heading: 0,
      tilt: 0,
    },
  });

  if (options.onPositionPick) {
    view.on("click", (event) => {
      if (!event.mapPoint) {
        return;
      }
      options.onPositionPick!(event.mapPoint.x - originX, event.mapPoint.y - originY);
    });
  }

  let showPreviousOverlay = true;
  let showVehicleAxes = false;
  let showSensorAxes = false;
  let showRotationArcs = false;
  let targetShape: TargetShapeKind = DEFAULT_TARGET_SHAPE;
  let lastCorners: Vec3[] | null = null;
  let lastCameraPosition: Vec3 | null = null;
  let currentState: FrameCameraState = initialState;

  let vehicleModelSymbol: PointSymbol3D | null = null;
  let vehicleModelObjectLayer: ObjectSymbol3DLayer | null = null;
  let sensorModelSymbol: PointSymbol3D | null = null;
  let sensorModelObjectLayer: ObjectSymbol3DLayer | null = null;

  /** Uses the real loaded aircraft model once available; falls back to the dart shape while loading or if loading failed. */
  function vehicleSymbolFor(orientation: Orientation): PointSymbol3D {
    if (vehicleModelSymbol && vehicleModelObjectLayer) {
      vehicleModelObjectLayer.heading = orientation.heading;
      vehicleModelObjectLayer.tilt = orientation.pitch - 90;
      vehicleModelObjectLayer.roll = orientation.roll;
      return vehicleModelSymbol;
    }
    return dartSymbol(orientation, "#ffd21e", 6);
  }

  /** Uses the real loaded camera-sensor model once available; falls back to the procedural pod shape while loading or if loading failed. */
  function sensorSymbolFor(orientation: Orientation): PointSymbol3D {
    if (sensorModelSymbol && sensorModelObjectLayer) {
      sensorModelObjectLayer.heading = orientation.heading;
      sensorModelObjectLayer.tilt = orientation.pitch - 90;
      sensorModelObjectLayer.roll = orientation.roll;
      return sensorModelSymbol;
    }
    return sensorSymbol(orientation, "#ff5a5f", 3);
  }

  /** Retries a fetch a couple of times before giving up - a single HEAD request can fail transiently
   *  (e.g. a dev-server hiccup, a momentary network blip) even when the file is genuinely reachable,
   *  and without a retry that transient failure permanently stuck the app on the fallback primitive
   *  shape for the rest of the session (only a full page reload would recover it). */
  function fetchWithRetry(url: string, init: RequestInit, retriesLeft = 2, delayMs = 400): Promise<Response> {
    return fetch(url, init).catch((error: unknown) => {
      if (retriesLeft <= 0) {
        throw error;
      }
      return new Promise<Response>((resolve, reject) => {
        setTimeout(() => {
          fetchWithRetry(url, init, retriesLeft - 1, delayMs).then(resolve, reject);
        }, delayMs);
      });
    });
  }

  /** Loads a local glTF (.glb) model as a PointSymbol3D, verifying the file is actually reachable first
   *  (a bad path would otherwise fail silently deep inside the renderer instead of raising a JS error).
   *  Uses GET, not HEAD - HEAD requests to these static assets were found to fail unpredictably in the
   *  browser (net::ERR_ABORTED) even though the file loads fine and a plain GET always succeeds; the
   *  response body is discarded, so this only costs re-fetching a small file a second time. */
  function loadLocalModelSymbol(
    url: string,
    size: { width: number; depth: number; height: number },
    anchor: "center" | "top" | "bottom" = "center",
  ): Promise<{ symbol: PointSymbol3D; objectLayer: ObjectSymbol3DLayer }> {
    return fetchWithRetry(url, { method: "GET" }).then((response) => {
      if (!response.ok) {
        throw new Error(`"${url}" responded with ${response.status}`);
      }
      // ObjectSymbol3DLayer defaults to anchoring a custom model at its own local (0,0,0) origin,
      // not the center of its bounding box - these particular files weren't modeled with a centered
      // origin (e.g. the drone's origin sits well behind its true geometric center), which visually
      // offsets the model from the graphic's placement point (the exact math position everything
      // else - frustum, axes, lever arm - is drawn from). Anchoring at "center"/"top" instead fixes that.
      const objectLayer = new ObjectSymbol3DLayer({
        resource: { href: url },
        anchor,
        width: size.width,
        depth: size.depth,
        height: size.height,
      });
      return { symbol: new PointSymbol3D({ symbolLayers: [objectLayer] }), objectLayer };
    });
  }

  function loadVehicleModel(): void {
    loadLocalModelSymbol(VEHICLE_MODEL_URL, VEHICLE_MODEL_SIZE)
      .then(({ symbol, objectLayer }) => {
        vehicleModelSymbol = symbol;
        vehicleModelObjectLayer = objectLayer;
        render(currentState); // swap the already-visible fallback shape for the real model immediately
      })
      .catch((error: unknown) => {
        console.warn("[frame-camera-simulator] falling back to a primitive vehicle shape - could not load the aircraft model:", error);
      });
  }

  function loadSensorModel(): void {
    // "center" (not "top") - ObjectSymbol3DLayer rotates a model about its anchor point, and at the
    // default nadir mount (tilt=-90) the housing's depth axis becomes vertical; anchoring at a
    // non-center point (e.g. "top") pivots around a corner and swings the housing sideways instead
    // of hanging it straight down. Centering keeps rotation predictable at any mount orientation;
    // DEFAULT_CAMERA_STATE's lever arm "down" value compensates so it still visually sits at the belly.
    loadLocalModelSymbol(SENSOR_MODEL_URL, SENSOR_MODEL_SIZE, "center")
      .then(({ symbol, objectLayer }) => {
        sensorModelSymbol = symbol;
        sensorModelObjectLayer = objectLayer;
        render(currentState); // swap the already-visible fallback shape for the real model immediately
      })
      .catch((error: unknown) => {
        console.warn("[frame-camera-simulator] falling back to a primitive sensor shape - could not load the camera-sensor model:", error);
      });
  }


  function clearPreviousOverlay(): void {
    previousFrustumLayer.removeAll();
    previousFootprintLayer.removeAll();
  }

  function drawPreviousOverlay(corners: Vec3[], cameraPosition: Vec3): void {
    previousFrustumLayer.removeAll();
    for (const corner of corners) {
      previousFrustumLayer.add(
        new Graphic({
          geometry: new Polyline({
            paths: [
              [
                [originX + cameraPosition.x, originY + cameraPosition.y, cameraPosition.z],
                [originX + corner.x, originY + corner.y, corner.z],
              ],
            ],
            spatialReference: sr,
          }),
          symbol: previousLineSymbol,
        }),
      );
    }

    previousFootprintLayer.removeAll();
    const ring = corners.map((c) => [originX + c.x, originY + c.y, c.z]);
    ring.push(ring[0]);
    previousFootprintLayer.add(new Graphic({ geometry: new Polygon({ rings: [ring], spatialReference: sr }), symbol: previousFootprintSymbol }));
  }

  function setShowPreviousOverlay(show: boolean): void {
    showPreviousOverlay = show;
    if (show && lastCorners && lastCameraPosition) {
      drawPreviousOverlay(lastCorners, lastCameraPosition);
    } else {
      clearPreviousOverlay();
    }
  }

  function setShowVehicleAxes(show: boolean): void {
    showVehicleAxes = show;
    if (!show) {
      vehicleAxesLayer.removeAll();
    } else {
      render(currentState);
    }
  }

  function setShowSensorAxes(show: boolean): void {
    showSensorAxes = show;
    if (!show) {
      sensorAxesLayer.removeAll();
    } else {
      render(currentState);
    }
  }

  function setShowRotationArcs(show: boolean): void {
    showRotationArcs = show;
    if (!show) {
      rotationArcsLayer.removeAll();
    } else {
      render(currentState);
    }
  }

  function setTargetShape(shape: TargetShapeKind): void {
    targetShape = shape;
    render(currentState);
  }

  /** Draws the sample target: a colored slab per box face, or one solid-color primitive for other shapes. */
  function renderTarget(groundElevation: number): void {
    targetLayer.removeAll();
    const { x: cx, y: cy } = targetGroundLocation();
    const z0 = groundElevation;
    const z1 = groundElevation + TARGET_SIZE.height;
    const cz = (z0 + z1) / 2;

    if (targetShape === "box") {
      targetLayer.addMany([
        new Graphic({ geometry: toMapPoint({ x: cx, y: cy, z: z1 }), symbol: targetFaceSymbols.top }),
        new Graphic({ geometry: toMapPoint({ x: cx, y: cy, z: z0 }), symbol: targetFaceSymbols.bottom }),
        new Graphic({ geometry: toMapPoint({ x: cx, y: cy + TARGET_SIZE.depth / 2, z: cz }), symbol: targetFaceSymbols.north }),
        new Graphic({ geometry: toMapPoint({ x: cx, y: cy - TARGET_SIZE.depth / 2, z: cz }), symbol: targetFaceSymbols.south }),
        new Graphic({ geometry: toMapPoint({ x: cx + TARGET_SIZE.width / 2, y: cy, z: cz }), symbol: targetFaceSymbols.east }),
        new Graphic({ geometry: toMapPoint({ x: cx - TARGET_SIZE.width / 2, y: cy, z: cz }), symbol: targetFaceSymbols.west }),
      ]);
      return;
    }

    const symbol = targetShape === "sphere" ? targetSphereSymbol : targetShape === "cone" ? targetConeSymbol : targetCylinderSymbol;
    targetLayer.add(new Graphic({ geometry: toMapPoint({ x: cx, y: cy, z: cz }), symbol }));
  }

  function render(state: FrameCameraState): void {
    currentState = state;

    if (showPreviousOverlay && lastCorners && lastCameraPosition) {
      drawPreviousOverlay(lastCorners, lastCameraPosition);
    } else {
      clearPreviousOverlay();
    }

    const camera = applySensorMount(state.vehicle.position, state.vehicle.orientation, state.sensorMount);
    const bodyAxes = cameraAxesFromHeadingPitchRoll(state.vehicle.orientation);

    vehicleLayer.removeAll();
    vehicleLayer.add(new Graphic({ geometry: toMapPoint(state.vehicle.position), symbol: vehicleSymbolFor(state.vehicle.orientation) }));

    // Vehicle body-frame guide: the forward/right/down axes the lever arm sliders are expressed in.
    vehicleAxesLayer.removeAll();
    if (showVehicleAxes) {
      const bodyDown = scaleVec(bodyAxes.up, -1);
      const forwardEnd = addVec(state.vehicle.position, scaleVec(bodyAxes.forward, BODY_AXIS_LENGTH));
      const rightEnd = addVec(state.vehicle.position, scaleVec(bodyAxes.right, BODY_AXIS_LENGTH));
      const downEnd = addVec(state.vehicle.position, scaleVec(bodyDown, BODY_AXIS_LENGTH));

      vehicleAxesLayer.addMany([
        polylineGraphic(state.vehicle.position, forwardEnd, bodyAxisForwardSymbol),
        new Graphic({ geometry: toMapPoint(forwardEnd), symbol: bodyAxisLabels.forward }),
        polylineGraphic(state.vehicle.position, rightEnd, bodyAxisRightSymbol),
        new Graphic({ geometry: toMapPoint(rightEnd), symbol: bodyAxisLabels.right }),
        polylineGraphic(state.vehicle.position, downEnd, bodyAxisDownSymbol),
        new Graphic({ geometry: toMapPoint(downEnd), symbol: bodyAxisLabels.down }),
      ]);
    }

    sensorLayer.removeAll();
    const sensorAxes = cameraAxesFromHeadingPitchRoll(camera.orientation);
    // Only the real GLB model has the lens-tip/anchor mismatch - the procedural fallback shape is
    // already symmetric about camera.position, so leave it there while the model is still loading.
    const sensorModelPosition =
      sensorModelSymbol && sensorModelObjectLayer ? addVec(camera.position, scaleVec(sensorAxes.forward, -SENSOR_LENS_TIP_OFFSET)) : camera.position;
    sensorLayer.add(new Graphic({ geometry: toMapPoint(sensorModelPosition), symbol: sensorSymbolFor(camera.orientation) }));

    // Sensor/camera guide: the resolved forward/right/down axes after lever arm + boresight are applied.
    sensorAxesLayer.removeAll();
    if (showSensorAxes) {
      const sensorDown = scaleVec(sensorAxes.up, -1);
      const sensorForwardEnd = addVec(camera.position, scaleVec(sensorAxes.forward, BODY_AXIS_LENGTH));
      const sensorRightEnd = addVec(camera.position, scaleVec(sensorAxes.right, BODY_AXIS_LENGTH));
      const sensorDownEnd = addVec(camera.position, scaleVec(sensorDown, BODY_AXIS_LENGTH));

      sensorAxesLayer.addMany([
        polylineGraphic(camera.position, sensorForwardEnd, sensorAxisForwardSymbol),
        new Graphic({ geometry: toMapPoint(sensorForwardEnd), symbol: sensorAxisLabels.forward }),
        polylineGraphic(camera.position, sensorRightEnd, sensorAxisRightSymbol),
        new Graphic({ geometry: toMapPoint(sensorRightEnd), symbol: sensorAxisLabels.right }),
        polylineGraphic(camera.position, sensorDownEnd, sensorAxisDownSymbol),
        new Graphic({ geometry: toMapPoint(sensorDownEnd), symbol: sensorAxisLabels.down }),
      ]);
    }

    // Rotation sweep guides: curved arcs showing which vehicle-orientation slider drives which rotation.
    rotationArcsLayer.removeAll();
    if (showRotationArcs) {
      const { heading: h, pitch: p, roll: r } = state.vehicle.orientation;
      const center = state.vehicle.position;
      const arcGraphics: Graphic[] = [];

      if (Math.abs(h) > 0.05) {
        const points = sampleSweepPoints(center, ROTATION_ARC_RADIUS_HEADING, 0, h, headingSweepDirection);
        arcGraphics.push(sweepPolylineGraphic(points, rotationArcHeadingSymbol));
        arcGraphics.push(new Graphic({ geometry: toMapPoint(points[points.length - 1]), symbol: bodyAxisLabelSymbol(`Heading ${h.toFixed(0)}°`, "#e930ff") }));
      }
      if (Math.abs(p) > 0.05) {
        const points = sampleSweepPoints(center, ROTATION_ARC_RADIUS_PITCH, 0, p, (angle) => pitchSweepDirection(h, angle));
        arcGraphics.push(sweepPolylineGraphic(points, rotationArcPitchSymbol));
        arcGraphics.push(new Graphic({ geometry: toMapPoint(points[points.length - 1]), symbol: bodyAxisLabelSymbol(`Pitch ${p.toFixed(0)}°`, "#ff9900") }));
      }
      if (Math.abs(r) > 0.05) {
        const points = sampleSweepPoints(center, ROTATION_ARC_RADIUS_ROLL, 0, r, (angle) => rollSweepDirection(h, p, angle));
        arcGraphics.push(sweepPolylineGraphic(points, rotationArcRollSymbol));
        arcGraphics.push(new Graphic({ geometry: toMapPoint(points[points.length - 1]), symbol: bodyAxisLabelSymbol(`Roll ${r.toFixed(0)}°`, "#39ff14") }));
      }

      rotationArcsLayer.addMany(arcGraphics);
    }

    leverArmLayer.removeAll();
    leverArmLayer.add(
      new Graphic({
        geometry: new Polyline({
          paths: [
            [
              [originX + state.vehicle.position.x, originY + state.vehicle.position.y, state.vehicle.position.z],
              [originX + camera.position.x, originY + camera.position.y, camera.position.z],
            ],
          ],
          spatialReference: sr,
        }),
        symbol: leverArmSymbol,
      }),
    );

    renderTarget(state.groundElevation);

    const corners = frustumCornerPoints(camera, state);

    frustumLayer.removeAll();
    for (const corner of corners) {
      frustumLayer.add(
        new Graphic({
          geometry: new Polyline({
            paths: [
              [
                [originX + camera.position.x, originY + camera.position.y, camera.position.z],
                [originX + corner.x, originY + corner.y, corner.z],
              ],
            ],
            spatialReference: sr,
          }),
          symbol: lineSymbol,
        }),
      );
    }

    footprintLayer.removeAll();
    const ring = corners.map((c) => [originX + c.x, originY + c.y, c.z]);
    ring.push(ring[0]);
    footprintLayer.add(new Graphic({ geometry: new Polygon({ rings: [ring], spatialReference: sr }), symbol: footprintSymbol }));

    lastCorners = corners;
    lastCameraPosition = camera.position;
  }

  render(initialState);
  loadVehicleModel();
  loadSensorModel();

  // Starting view: straight-down (nadir), vehicle centered, with the whole initial frustum/footprint
  // visible - matches how the previous/current-state overlay is meant to be read at a glance.
  if (lastCameraPosition && lastCorners) {
    const targetLocation = targetGroundLocation();
    const extentPoints = [
      currentState.vehicle.position,
      lastCameraPosition,
      { ...targetLocation, z: currentState.groundElevation },
      ...lastCorners,
    ].map(toMapPoint);
    const xs = extentPoints.map((p) => p.x);
    const ys = extentPoints.map((p) => p.y);
    const zs = extentPoints.map((p) => p.z ?? 0);
    const initialExtent = new Extent({
      xmin: Math.min(...xs),
      xmax: Math.max(...xs),
      ymin: Math.min(...ys),
      ymax: Math.max(...ys),
      zmin: Math.min(...zs),
      zmax: Math.max(...zs),
      spatialReference: sr,
    }).expand(1.15);
    view
      .goTo(initialExtent, { animate: false })
      .then(() => {
        // goTo picks a sensible distance for the extent but not necessarily a nadir angle - force straight-down.
        view.camera = new Camera({ position: view.camera.position, heading: 0, tilt: 0 });
      })
      .catch(() => {
        // goTo rejects if interrupted by another navigation - not worth surfacing to the user.
      });
  }

  function zoomToVehicle(): void {
    // Tight zoom framing just the vehicle model itself (not the whole frustum/footprint extent).
    const radius = 40; // meters - enough margin around the ~24m-wide vehicle model
    const center = toMapPoint(currentState.vehicle.position);
    const extent = new Extent({
      xmin: center.x - radius,
      xmax: center.x + radius,
      ymin: center.y - radius,
      ymax: center.y + radius,
      zmin: center.z! - radius,
      zmax: center.z! + radius,
      spatialReference: sr,
    });
    view.goTo(extent, { animate: true, duration: 500 }).catch(() => {
      // goTo rejects if interrupted by another navigation - not worth surfacing to the user.
    });
  }

  return {
    view,
    update: render,
    setShowPreviousOverlay,
    setShowVehicleAxes,
    setShowSensorAxes,
    setShowRotationArcs,
    setTargetShape,
    setProbe: (baseline, current) => {
      probeLayer.removeAll();
      if (baseline && current) probeLayer.add(polylineGraphic(baseline, current, lineSymbol));
      for (const [point, color] of [[baseline, "#ffffff"], [current, "#ffe55c"]] as const) {
        if (point) probeLayer.add(new Graphic({ geometry: toMapPoint(point), symbol: new SimpleMarkerSymbol({ color, size: 12, outline: { color: "#151515", width: 1 } }) }));
      }
    },
    zoomToVehicle,
    destroy: () => view.destroy(),
  };
}
