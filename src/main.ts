import "@arcgis/core/assets/esri/themes/dark/main.css";
import "@esri/calcite-components/main.css";
import "./style.css";
import { defineCustomElements } from "@esri/calcite-components/loader";
import esriConfig from "@arcgis/core/config.js";
import { CameraStateStore } from "./state/cameraState";
import { createControlPanel } from "./ui/controlPanel";
import { createWorldView } from "./views/worldView";
import { createImageSpaceViewer } from "./views/imageSpaceViewer";
import { createCloseupView } from "./views/closeupView";
import { observeCanvasSize } from "./ui/layout";
import { createPanelSplitter } from "./ui/panelSplitter";
import { imageToGround, type FrameCameraState } from "./geometry/frameCamera";

esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;
if (!import.meta.env.VITE_ARCGIS_API_KEY) {
  // The "satellite" basemap and web-style vehicle model both work anonymously today, but an API
  // key is still recommended for reliability/rate limits - see .env.example and the deployment guide.
  console.warn("[frame-camera-simulator] VITE_ARCGIS_API_KEY is not set - some Esri services may be rate-limited without a key. See .env.example.");
}

defineCustomElements();

const store = new CameraStateStore();

const worldView = createWorldView(document.querySelector<HTMLDivElement>("#worldView")!, store.getState(), {
  onPositionPick: (x, y) => {
    const current = store.getState();
    store.regenerate({ ...current, vehicle: { ...current.vehicle, position: { ...current.vehicle.position, x, y } } });
  },
});

const imageSpaceCanvas = document.querySelector<HTMLCanvasElement>("#imageSpaceView")!;
const imageSpaceViewer = createImageSpaceViewer(imageSpaceCanvas);
imageSpaceViewer.update(store.getState());
observeCanvasSize(imageSpaceCanvas, () => imageSpaceViewer.redraw());

let probe: { x: number; y: number; baseline: FrameCameraState } | null = null;
const probeReadout = document.querySelector<HTMLElement>("#probeReadout")!;
function updateProbe(state: FrameCameraState): void {
  if (!probe) return;
  const baseline = imageToGround(probe.x * probe.baseline.intrinsics.imageWidth, probe.y * probe.baseline.intrinsics.imageHeight, probe.baseline);
  const current = imageToGround(probe.x * state.intrinsics.imageWidth, probe.y * state.intrinsics.imageHeight, state);
  worldView.setProbe(baseline, current);
  probeReadout.hidden = false;
  if (!baseline || !current) {
    probeReadout.textContent = "Selected ray does not reach the ground in one or both states.";
    return;
  }
  const east = current.x - baseline.x;
  const north = current.y - baseline.y;
  probeReadout.textContent = `Image point ground shift: ${Math.hypot(east, north).toFixed(2)} m (E ${east.toFixed(2)} m, N ${north.toFixed(2)} m). White: reference; yellow: current.`;
}
imageSpaceCanvas.addEventListener("click", (event) => {
  const state = store.getState();
  const bounds = imageSpaceCanvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * imageSpaceCanvas.width / bounds.width;
  const y = (event.clientY - bounds.top) * imageSpaceCanvas.height / bounds.height;
  const scale = Math.min(imageSpaceCanvas.width / state.intrinsics.imageWidth, imageSpaceCanvas.height / state.intrinsics.imageHeight);
  const imageX = (x - (imageSpaceCanvas.width - state.intrinsics.imageWidth * scale) / 2) / scale / state.intrinsics.imageWidth;
  const imageY = (y - (imageSpaceCanvas.height - state.intrinsics.imageHeight * scale) / 2) / scale / state.intrinsics.imageHeight;
  if (imageX < 0 || imageX > 1 || imageY < 0 || imageY > 1) return;
  probe = { x: imageX, y: imageY, baseline: state };
  imageSpaceViewer.setProbe({ x: imageX, y: imageY });
  updateProbe(state);
});

const closeupCanvas = document.querySelector<HTMLCanvasElement>("#closeupView")!;
const closeupView = createCloseupView(closeupCanvas);
closeupView.update(store.getState());

createPanelSplitter(document.querySelector<HTMLElement>("#panels")!, document.querySelector<HTMLElement>("#panelDivider")!);
createPanelSplitter(document.querySelector<HTMLElement>("#rightColumn")!, document.querySelector<HTMLElement>("#rightRowDivider")!, {
  orientation: "row",
  min: 120,
});

store.onRegenerate((state) => {
  worldView.update(state);
  imageSpaceViewer.update(state);
  closeupView.update(state);
  updateProbe(state);
});

const controlsContainer = document.querySelector<HTMLElement>("#controls")!;

/** The 3D scene legend only lists guides that are actually toggled on in the Adjustable Parameters
 *  pane - "axes" covers vehicle axes, sensor axes, and rotation arcs, since all three share the same
 *  F/R/D color key (a rotation arc is just its matching axis swept through the current angle). */
const worldViewLegend = document.querySelector<HTMLElement>("#worldViewLegend")!;
function setLegendRowVisible(key: string, visible: boolean): void {
  worldViewLegend.querySelectorAll<HTMLElement>(`[data-legend="${key}"]`).forEach((row) => row.classList.toggle("legend-row--hidden", !visible));
}
let worldVehicleAxesOn = false;
let worldSensorAxesOn = false;
let worldRotationArcsOn = false;
function updateWorldAxesLegend(): void {
  setLegendRowVisible("axes", worldVehicleAxesOn || worldSensorAxesOn || worldRotationArcsOn);
}
setLegendRowVisible("previous", true);
updateWorldAxesLegend();

createControlPanel(controlsContainer, {
  initial: store.getState(),
  getPosition: () => store.getState().vehicle.position,
  onRegenerate: (state) => store.regenerate(state),
  onTogglePreviousOverlay: (show) => {
    worldView.setShowPreviousOverlay(show);
    imageSpaceViewer.setShowPreviousOverlay(show);
    setLegendRowVisible("previous", show);
  },
  onToggleVehicleAxes: (show) => {
    worldView.setShowVehicleAxes(show);
    worldVehicleAxesOn = show;
    updateWorldAxesLegend();
  },
  onToggleSensorAxes: (show) => {
    worldView.setShowSensorAxes(show);
    worldSensorAxesOn = show;
    updateWorldAxesLegend();
  },
  onToggleRotationArcs: (show) => {
    worldView.setShowRotationArcs(show);
    worldRotationArcsOn = show;
    updateWorldAxesLegend();
  },
  onToggleCloseupVehicleAxes: (show) => closeupView.setShowVehicleAxes(show),
  onToggleCloseupSensorAxes: (show) => closeupView.setShowSensorAxes(show),
  onToggleCloseupRotationArcs: (show) => closeupView.setShowRotationArcs(show),
  onToggleRasterLabels: (show) => closeupView.setShowRasterLabels(show),
  onChangeTargetShape: (shape) => {
    worldView.setTargetShape(shape);
    imageSpaceViewer.setTargetShape(shape);
  },
});

/** Calcite custom elements don't ship vanilla-DOM TS typings; properties are set/read dynamically. */
const controlsPanel = document.querySelector<HTMLElement>("#controlsPanel")!;
const panelToggle = document.querySelector<HTMLButtonElement>("#panelToggle")!;
const panelToggleIcon = panelToggle.querySelector("calcite-icon")!;

// Keeps the floating carrot button glued to the panel's right edge as it collapses/expands or is resized.
function updatePanelTogglePosition(): void {
  panelToggle.style.left = `${controlsPanel.getBoundingClientRect().width}px`;
}
new ResizeObserver(updatePanelTogglePosition).observe(controlsPanel);
updatePanelTogglePosition();

panelToggle.addEventListener("click", () => {
  const collapsed = !(controlsPanel as unknown as { collapsed: boolean }).collapsed;
  (controlsPanel as unknown as { collapsed: boolean }).collapsed = collapsed;
  panelToggleIcon.setAttribute("icon", collapsed ? "chevrons-right" : "chevrons-left");
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
  panelToggle.setAttribute("aria-label", collapsed ? "Expand parameters panel" : "Collapse parameters panel");
});

const centerViewButton = document.querySelector<HTMLButtonElement>("#centerViewButton")!;
centerViewButton.addEventListener("click", () => worldView.zoomToVehicle());

// Mirrors the main scene's own pan/rotate navigation-toggle widget for the close-up diagram's drag behavior.
const closeupPanModeButton = document.querySelector<HTMLButtonElement>("#closeupPanMode")!;
const closeupRotateModeButton = document.querySelector<HTMLButtonElement>("#closeupRotateMode")!;

function setCloseupNavMode(mode: "pan" | "rotate"): void {
  closeupView.setNavMode(mode);
  closeupPanModeButton.classList.toggle("nav-toggle-btn--active", mode === "pan");
  closeupPanModeButton.setAttribute("aria-pressed", String(mode === "pan"));
  closeupRotateModeButton.classList.toggle("nav-toggle-btn--active", mode === "rotate");
  closeupRotateModeButton.setAttribute("aria-pressed", String(mode === "rotate"));
}

closeupPanModeButton.addEventListener("click", () => setCloseupNavMode("pan"));
closeupRotateModeButton.addEventListener("click", () => setCloseupNavMode("rotate"));

// Both legends start collapsed - each button matches its own viewer's existing widget style
// (a circular Esri-style icon button in the main scene, a nav-toggle-style button in the close-up).
const worldViewLegendToggle = document.querySelector<HTMLButtonElement>("#worldViewLegendToggle")!;
const worldViewLegendPanel = document.querySelector<HTMLElement>("#worldViewLegend")!;
worldViewLegendToggle.addEventListener("click", () => {
  const open = !worldViewLegendPanel.classList.contains("is-open");
  worldViewLegendPanel.classList.toggle("is-open", open);
  worldViewLegendToggle.classList.toggle("is-active", open);
  worldViewLegendToggle.setAttribute("aria-pressed", String(open));
  worldViewLegendToggle.setAttribute("aria-expanded", String(open));
  worldViewLegendToggle.setAttribute("aria-label", open ? "Hide legend" : "Show legend");
});

const closeupLegendToggle = document.querySelector<HTMLButtonElement>("#closeupLegendToggle")!;
closeupLegendToggle.addEventListener("click", () => {
  const open = !closeupLegendToggle.classList.contains("nav-toggle-btn--active");
  closeupView.setShowLegend(open);
  closeupLegendToggle.classList.toggle("nav-toggle-btn--active", open);
  closeupLegendToggle.setAttribute("aria-pressed", String(open));
});


