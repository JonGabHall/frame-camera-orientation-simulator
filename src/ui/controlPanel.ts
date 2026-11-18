import type { FrameCameraState } from "../geometry/frameCamera";
import { DEFAULT_CAMERA_STATE } from "../state/cameraState";
import { importOrientedImagery } from "../state/orientedImagery";
import { DEFAULT_TARGET_SHAPE, type TargetShapeKind } from "../state/sceneObjects";
import { cameraTableValues, type TableMode } from "../state/tableValues";
import { createRecordEditor } from "./recordEditor";

export interface ControlPanelOptions {
  initial: FrameCameraState;
  /** X/Y are set by clicking the scene, not sliders - fetched fresh at Regenerate time so clicks aren't lost. */
  getPosition: () => { x: number; y: number };
  onRegenerate: (state: FrameCameraState) => void;
  /** Toggles the world view's dimmed/dashed overlay of the pre-Regenerate frustum + footprint. */
  onTogglePreviousOverlay: (show: boolean) => void;
  /** Toggles the neon forward/right/down guide anchored on the vehicle, in the main 3D scene. */
  onToggleVehicleAxes: (show: boolean) => void;
  /** Toggles the neon forward/right/down guide anchored on the resolved sensor/camera, in the main 3D scene. */
  onToggleSensorAxes: (show: boolean) => void;
  /** Toggles the curved heading/pitch/roll sweep guides, in the main 3D scene. */
  onToggleRotationArcs: (show: boolean) => void;
  /** Toggles the vehicle body F/R/D axis guide in the close-up diagram. */
  onToggleCloseupVehicleAxes: (show: boolean) => void;
  /** Toggles the resolved sensor F'/R'/D' axis guide in the close-up diagram. */
  onToggleCloseupSensorAxes: (show: boolean) => void;
  /** Toggles the heading/pitch/roll rotation-order arcs in the close-up diagram. */
  onToggleCloseupRotationArcs: (show: boolean) => void;
  /** Toggles the close-up diagram's TL/Cols/Rows raster-orientation labels. */
  onToggleRasterLabels: (show: boolean) => void;
  /** Swaps the sample target's shape. */
  onChangeTargetShape: (shape: TargetShapeKind) => void;
}

interface SliderRowOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

interface SliderRow {
  element: HTMLElement;
  getValue: () => number;
  setValue: (value: number) => void;
}

/** Calcite custom elements don't ship vanilla-DOM TS typings; properties are set dynamically. */
function setProp(el: Element, name: string, value: unknown): void {
  (el as unknown as Record<string, unknown>)[name] = value;
}

function getProp(el: Element, name: string): number {
  return Number((el as unknown as Record<string, unknown>)[name]);
}

/** calcite-input-number's `value` property is a string, unlike calcite-slider's numeric `value`. */
function setNumberInputValue(el: Element, value: number): void {
  setProp(el, "value", String(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createSliderRow({ label, min, max, step, value }: SliderRowOptions): SliderRow {
  const row = document.createElement("div");
  row.className = "param-row";

  const calciteLabel = document.createElement("calcite-label");
  calciteLabel.textContent = label;

  const field = document.createElement("div");
  field.className = "param-field";

  const slider = document.createElement("calcite-slider");
  setProp(slider, "min", min);
  setProp(slider, "max", max);
  setProp(slider, "step", step);
  setProp(slider, "value", value);

  const numberInput = document.createElement("calcite-input-number");
  numberInput.className = "param-number";
  setProp(numberInput, "min", min);
  setProp(numberInput, "max", max);
  setProp(numberInput, "step", step);
  setNumberInputValue(numberInput, value);

  slider.addEventListener("calciteSliderInput", () => setNumberInputValue(numberInput, getProp(slider, "value")));
  numberInput.addEventListener("calciteInputNumberInput", () => setProp(slider, "value", getProp(numberInput, "value")));
  // calciteInputNumberChange fires once editing is committed (blur/Enter) - snap any out-of-range
  // typed value back within min/max, so what's displayed always matches what Generate will submit.
  numberInput.addEventListener("calciteInputNumberChange", () => {
    const clamped = clamp(getProp(numberInput, "value"), min, max);
    setNumberInputValue(numberInput, clamped);
    setProp(slider, "value", clamped);
  });

  field.append(slider, numberInput);
  calciteLabel.append(field);
  row.append(calciteLabel);

  return {
    element: row,
    getValue: () => clamp(getProp(numberInput, "value"), min, max),
    setValue: (next: number) => {
      min = Math.min(min, next);
      max = Math.max(max, next);
      setProp(slider, "min", min);
      setProp(slider, "max", max);
      setProp(numberInput, "min", min);
      setProp(numberInput, "max", max);
      setProp(slider, "value", next);
      setNumberInputValue(numberInput, next);
    },
  };
}

function createSection(heading: string, rows: (SliderRow | HTMLElement)[]): HTMLElement {
  const section = document.createElement("calcite-block");
  section.setAttribute("heading", heading);
  setProp(section, "collapsible", true);
  setProp(section, "expanded", false);
  for (const row of rows) {
    section.append(row instanceof HTMLElement ? row : row.element);
  }
  return section;
}

function createSwitchRow(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "param-row";
  const calciteLabel = document.createElement("calcite-label");
  setProp(calciteLabel, "layout", "inline-space-between");
  calciteLabel.textContent = label;
  const toggle = document.createElement("calcite-switch");
  setProp(toggle, "checked", checked);
  toggle.addEventListener("calciteSwitchChange", () => onChange(Boolean((toggle as unknown as { checked: boolean }).checked)));
  calciteLabel.append(toggle);
  row.append(calciteLabel);
  return row;
}

/** A compact label + small "i" icon that reveals `tooltipText` in a calcite-tooltip on hover/focus, instead of an always-visible notice block. */
function createInfoRow(label: string, tooltipText: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "param-row info-row";

  const icon = document.createElement("calcite-icon");
  setProp(icon, "icon", "information");
  setProp(icon, "scale", "s");
  icon.tabIndex = 0;

  const span = document.createElement("span");
  span.textContent = label;

  const tooltip = document.createElement("calcite-tooltip");
  setProp(tooltip, "referenceElement", icon);
  tooltip.textContent = tooltipText;

  row.append(span, icon, tooltip);
  return row;
}

interface SelectOption {
  value: string;
  label: string;
}

function createSelectRow(label: string, options: SelectOption[], value: string, onChange: (value: string) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "param-row";

  const calciteLabel = document.createElement("calcite-label");
  calciteLabel.textContent = label;

  const select = document.createElement("calcite-select");
  setProp(select, "label", label);
  for (const option of options) {
    const el = document.createElement("calcite-option");
    setProp(el, "value", option.value);
    setProp(el, "label", option.label);
    setProp(el, "selected", option.value === value);
    select.append(el);
  }
  select.addEventListener("calciteSelectChange", () => onChange((select as unknown as { value: string }).value));

  calciteLabel.append(select);
  row.append(calciteLabel);
  return row;
}

export function createControlPanel(
  container: HTMLElement,
  {
    initial,
    getPosition,
    onRegenerate,
    onTogglePreviousOverlay,
    onToggleVehicleAxes,
    onToggleSensorAxes,
    onToggleRotationArcs,
    onToggleCloseupVehicleAxes,
    onToggleCloseupSensorAxes,
    onToggleCloseupRotationArcs,
    onToggleRasterLabels,
    onChangeTargetShape,
  }: ControlPanelOptions,
): { updateGeneratedState: (state: FrameCameraState) => void } {
  // X/Y are set by clicking the scene (see worldView's onPositionPick), not a slider - the sample
  // target sits at a fixed world location (sceneObjects.ts), so moving X/Y changes whether the
  // target falls inside the frame; that's more naturally explored by clicking a spot on the map
  // than dragging a slider back and forth.
  const positionZ = createSliderRow({ label: "Z (meters, altitude)", min: 1, max: 3000, step: 1, value: initial.vehicle.position.z });

  const heading = createSliderRow({ label: "Heading (deg, 0=N)", min: 0, max: 360, step: 1, value: initial.vehicle.orientation.heading });
  const pitch = createSliderRow({
    label: "Pitch (deg, 0=nose down, 90=level flight, 180=nose up)",
    min: 0,
    max: 180,
    step: 1,
    value: initial.vehicle.orientation.pitch,
  });
  const roll = createSliderRow({ label: "Roll / bank (deg, -90 to 90)", min: -90, max: 90, step: 1, value: initial.vehicle.orientation.roll });

  const leverArmForward = createSliderRow({ label: "Lever arm forward (m)", min: -10, max: 10, step: 0.1, value: initial.sensorMount.leverArm.forward });
  const leverArmRight = createSliderRow({ label: "Lever arm right (m)", min: -10, max: 10, step: 0.1, value: initial.sensorMount.leverArm.right });
  const leverArmDown = createSliderRow({ label: "Lever arm down (m)", min: -10, max: 10, step: 0.1, value: initial.sensorMount.leverArm.down });

  const mountHeading = createSliderRow({
    label: "Mount heading (deg, relative to vehicle nose)",
    min: 0,
    max: 360,
    step: 1,
    value: initial.sensorMount.orientation.heading,
  });
  const mountPitch = createSliderRow({
    label: "Mount pitch (deg, 0=nadir, 90=aligned with nose, 180=zenith)",
    min: 0,
    max: 180,
    step: 1,
    value: initial.sensorMount.orientation.pitch,
  });
  const mountRoll = createSliderRow({
    label: "Mount roll / boresight (deg, -90 to 90)",
    min: -90,
    max: 90,
    step: 1,
    value: initial.sensorMount.orientation.roll,
  });

  const focalLength = createSliderRow({ label: "Focal length (mm)", min: 4, max: 200, step: 1, value: initial.intrinsics.focalLength });
  const sensorWidth = createSliderRow({ label: "Sensor width (mm)", min: 4, max: 60, step: 0.5, value: initial.intrinsics.sensorWidth });
  const sensorHeight = createSliderRow({ label: "Sensor height (mm)", min: 4, max: 60, step: 0.5, value: initial.intrinsics.sensorHeight });
  const principalPointX = createSliderRow({ label: "Principal point X offset (mm)", min: -5, max: 5, step: 0.1, value: initial.intrinsics.principalPointX });
  const principalPointY = createSliderRow({ label: "Principal point Y offset (mm)", min: -5, max: 5, step: 0.1, value: initial.intrinsics.principalPointY });
  const imageWidth = createSliderRow({ label: "Image width (px)", min: 100, max: 4000, step: 10, value: initial.intrinsics.imageWidth });
  const imageHeight = createSliderRow({ label: "Image height (px)", min: 100, max: 4000, step: 10, value: initial.intrinsics.imageHeight });
  const imageRotation = createSliderRow({
    label: "Image rotation (deg, extra spin on top of roll)",
    min: -360,
    max: 360,
    step: 1,
    value: initial.intrinsics.imageRotation,
  });

  const groundElevation = createSliderRow({ label: "Ground plane elevation (meters)", min: -500, max: 500, step: 1, value: initial.groundElevation });

  const recordStatus = document.createElement("div");
  recordStatus.className = "oid-record-status";
  recordStatus.setAttribute("role", "status");
  const recordEditor = createRecordEditor(recordStatus);
  const importButton = document.createElement("calcite-button");
  importButton.textContent = "Apply record";
  setProp(importButton, "width", "full");
  importButton.addEventListener("click", () => {
    try {
      const record = recordEditor.getRecord();
      const { state, warnings } = importOrientedImagery(record, {
        vehicle: { position: { ...getPosition(), z: positionZ.getValue() }, orientation: { heading: heading.getValue(), pitch: pitch.getValue(), roll: roll.getValue() } },
        sensorMount: { leverArm: { forward: leverArmForward.getValue(), right: leverArmRight.getValue(), down: leverArmDown.getValue() }, orientation: { heading: mountHeading.getValue(), pitch: mountPitch.getValue(), roll: mountRoll.getValue() } },
        intrinsics: { focalLength: focalLength.getValue(), sensorWidth: sensorWidth.getValue(), sensorHeight: sensorHeight.getValue(), imageWidth: imageWidth.getValue(), imageHeight: imageHeight.getValue(), principalPointX: principalPointX.getValue(), principalPointY: principalPointY.getValue(), imageRotation: imageRotation.getValue() },
        groundElevation: groundElevation.getValue(),
      });
      positionZ.setValue(state.vehicle.position.z);
      heading.setValue(state.vehicle.orientation.heading);
      pitch.setValue(state.vehicle.orientation.pitch);
      roll.setValue(state.vehicle.orientation.roll);
      leverArmForward.setValue(state.sensorMount.leverArm.forward);
      leverArmRight.setValue(state.sensorMount.leverArm.right);
      leverArmDown.setValue(state.sensorMount.leverArm.down);
      mountHeading.setValue(state.sensorMount.orientation.heading);
      mountPitch.setValue(state.sensorMount.orientation.pitch);
      mountRoll.setValue(state.sensorMount.orientation.roll);
      focalLength.setValue(state.intrinsics.focalLength);
      sensorWidth.setValue(state.intrinsics.sensorWidth);
      sensorHeight.setValue(state.intrinsics.sensorHeight);
      principalPointX.setValue(state.intrinsics.principalPointX);
      principalPointY.setValue(state.intrinsics.principalPointY);
      imageRotation.setValue(state.intrinsics.imageRotation);
      recordStatus.textContent = warnings.join(" ");
      onRegenerate(state);
    } catch (error) {
      recordStatus.textContent = error instanceof Error ? error.message : "Unable to read the record.";
    }
  });

  const regenerateButton = document.createElement("calcite-button");
  regenerateButton.textContent = "Generate";
  setProp(regenerateButton, "width", "full");
  regenerateButton.addEventListener("click", () => {
    const next: FrameCameraState = {
      vehicle: {
        position: { ...getPosition(), z: positionZ.getValue() },
        orientation: { heading: heading.getValue(), pitch: pitch.getValue(), roll: roll.getValue() },
      },
      sensorMount: {
        leverArm: { forward: leverArmForward.getValue(), right: leverArmRight.getValue(), down: leverArmDown.getValue() },
        orientation: { heading: mountHeading.getValue(), pitch: mountPitch.getValue(), roll: mountRoll.getValue() },
      },
      intrinsics: {
        focalLength: focalLength.getValue(),
        sensorWidth: sensorWidth.getValue(),
        sensorHeight: sensorHeight.getValue(),
        imageWidth: imageWidth.getValue(),
        imageHeight: imageHeight.getValue(),
        principalPointX: principalPointX.getValue(),
        principalPointY: principalPointY.getValue(),
        imageRotation: imageRotation.getValue(),
      },
      groundElevation: groundElevation.getValue(),
    };
    onRegenerate(next);
  });

  const resetButton = document.createElement("calcite-button");
  resetButton.textContent = "Reset Parameters";
  setProp(resetButton, "width", "full");
  setProp(resetButton, "appearance", "outline");
  resetButton.addEventListener("click", () => {
    positionZ.setValue(DEFAULT_CAMERA_STATE.vehicle.position.z);
    heading.setValue(DEFAULT_CAMERA_STATE.vehicle.orientation.heading);
    pitch.setValue(DEFAULT_CAMERA_STATE.vehicle.orientation.pitch);
    roll.setValue(DEFAULT_CAMERA_STATE.vehicle.orientation.roll);
    leverArmForward.setValue(DEFAULT_CAMERA_STATE.sensorMount.leverArm.forward);
    leverArmRight.setValue(DEFAULT_CAMERA_STATE.sensorMount.leverArm.right);
    leverArmDown.setValue(DEFAULT_CAMERA_STATE.sensorMount.leverArm.down);
    mountHeading.setValue(DEFAULT_CAMERA_STATE.sensorMount.orientation.heading);
    mountPitch.setValue(DEFAULT_CAMERA_STATE.sensorMount.orientation.pitch);
    mountRoll.setValue(DEFAULT_CAMERA_STATE.sensorMount.orientation.roll);
    focalLength.setValue(DEFAULT_CAMERA_STATE.intrinsics.focalLength);
    sensorWidth.setValue(DEFAULT_CAMERA_STATE.intrinsics.sensorWidth);
    sensorHeight.setValue(DEFAULT_CAMERA_STATE.intrinsics.sensorHeight);
    principalPointX.setValue(DEFAULT_CAMERA_STATE.intrinsics.principalPointX);
    principalPointY.setValue(DEFAULT_CAMERA_STATE.intrinsics.principalPointY);
    imageWidth.setValue(DEFAULT_CAMERA_STATE.intrinsics.imageWidth);
    imageHeight.setValue(DEFAULT_CAMERA_STATE.intrinsics.imageHeight);
    imageRotation.setValue(DEFAULT_CAMERA_STATE.intrinsics.imageRotation);
    groundElevation.setValue(DEFAULT_CAMERA_STATE.groundElevation);
    // Bypasses getPosition() (the last scene click) so X/Y also return to the app default, not just the sliders.
    onRegenerate(DEFAULT_CAMERA_STATE);
  });

  const positionInfo = createInfoRow("Vehicle positioning", "Click a location in the scene to move the vehicle there.");

  const compareRow = createSwitchRow("Show previous frustum/footprint", true, onTogglePreviousOverlay);
  const vehicleAxesRow = createSwitchRow("Show vehicle body axes (F/R/D)", false, onToggleVehicleAxes);
  const rotationArcsRow = createSwitchRow("Show heading/pitch/roll rotation guides", false, onToggleRotationArcs);
  const sensorAxesRow = createSwitchRow("Show sensor/camera axes (F'/R'/D')", false, onToggleSensorAxes);

  const closeupVehicleAxesRow = createSwitchRow("Show vehicle body axes (F/R/D)", false, onToggleCloseupVehicleAxes);
  const closeupSensorAxesRow = createSwitchRow("Show sensor/camera axes (F'/R'/D')", false, onToggleCloseupSensorAxes);
  const closeupRotationArcsRow = createSwitchRow("Show heading/pitch/roll rotation guides", false, onToggleCloseupRotationArcs);
  const rasterLabelsRow = createSwitchRow("Show raster labels (TL/Cols/Rows)", false, onToggleRasterLabels);

  const leverArmInfo = createInfoRow(
    "About lever arm/boresight terminology",
    "Lever arm/boresight (forward/right/down) is a general mobile-mapping mounting convention used here for teaching - not a literal OrientedImageryLayer field name. Esri's real OI schema stores only the already-resolved CameraHeading/CameraPitch/CameraRoll/CameraHeight per image.",
  );

  const targetShapeRow = createSelectRow(
    "Sample target shape",
    [
      { value: "box", label: "Box (per-side colors)" },
      { value: "sphere", label: "Sphere" },
      { value: "cone", label: "Cone" },
      { value: "cylinder", label: "Cylinder" },
    ],
    DEFAULT_TARGET_SHAPE,
    (value) => onChangeTargetShape(value as TargetShapeKind),
  );

  const recordSection = createSection("Import Oriented Imagery Record", [recordEditor.element, importButton, recordStatus]);
  recordSection.classList.add("oid-record-section");
  let generatedState = initial;
  let tableMode: TableMode = "frame";
  const tableModes = document.createElement("div");
  tableModes.className = "table-modes";
  tableModes.setAttribute("role", "group");
  tableModes.setAttribute("aria-label", "Camera table schema");
  const tableValues = document.createElement("dl");
  tableValues.className = "table-values";
  const modeButtons = ([ ["frame", "Frame camera"], ["oriented", "Oriented imagery"] ] as const).map(([mode, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      tableMode = mode;
      renderTableValues();
    });
    tableModes.append(button);
    return { mode, button };
  });
  function renderTableValues(): void {
    for (const { mode, button } of modeButtons) button.setAttribute("aria-pressed", String(mode === tableMode));
    tableValues.replaceChildren(...cameraTableValues(generatedState, tableMode).flatMap(({ name, value }) => {
      const term = document.createElement("dt");
      term.textContent = name;
      const description = document.createElement("dd");
      description.textContent = value;
      return [term, description];
    }));
  }
  renderTableValues();
  const tableSummary = document.createElement("div");
  tableSummary.className = "table-summary";
  tableSummary.textContent = "Generated state; coordinates are local.";
  const tableSection = createSection("Camera table values", [tableModes, tableSummary, tableValues]);
  container.append(
    recordSection,
    tableSection,
    compareRow,
    positionInfo,
    leverArmInfo,
    createSection("Vehicle altitude", [positionZ]),
    createSection("Vehicle orientation", [heading, pitch, roll, vehicleAxesRow, rotationArcsRow]),
    createSection("Sensor mount: lever arm", [leverArmForward, leverArmRight, leverArmDown]),
    createSection("Sensor mount: boresight", [mountHeading, mountPitch, mountRoll, sensorAxesRow]),
    createSection("Frame camera table", [
      focalLength,
      sensorWidth,
      sensorHeight,
      principalPointX,
      principalPointY,
      imageWidth,
      imageHeight,
      imageRotation,
    ]),
    createSection("Ground reference", [groundElevation]),
    createSection("Sample target", [targetShapeRow]),
    createSection("Close-up diagram guides", [closeupVehicleAxesRow, closeupSensorAxesRow, closeupRotationArcsRow, rasterLabelsRow]),
    regenerateButton,
    resetButton,
  );

  // Marks the section a changed slider/number input belongs to, so users can see at a glance which
  // parameter groups have unsaved edits since the last Regenerate/Reset.
  function markSectionDirty(event: Event): void {
    (event.target as Element).closest("calcite-block")?.classList.add("param-dirty");
  }
  container.addEventListener("calciteSliderInput", markSectionDirty);
  container.addEventListener("calciteInputNumberInput", markSectionDirty);

  function clearDirtySections(): void {
    container.querySelectorAll("calcite-block.param-dirty").forEach((el) => el.classList.remove("param-dirty"));
  }
  regenerateButton.addEventListener("click", clearDirtySections);
  resetButton.addEventListener("click", clearDirtySections);
  return { updateGeneratedState: (state) => { generatedState = state; renderTableValues(); } };
}
