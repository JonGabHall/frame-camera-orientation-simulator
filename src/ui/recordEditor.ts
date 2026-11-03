import { parseRecordInput, type ImageryRecord } from "../state/recordInput";
import { queryImageryRecord } from "../state/imageryService";

export function createRecordEditor(status: HTMLElement): { element: HTMLElement; getRecord: () => ImageryRecord; setInput: (value: string) => void } {
  const element = document.createElement("div");
  element.className = "oid-record-editor";
  const service = document.createElement("details");
  service.className = "oid-service";
  const serviceSummary = document.createElement("summary");
  serviceSummary.textContent = "Find record in OI layer";
  const serviceLabel = document.createElement("label");
  serviceLabel.textContent = "Service or layer URL, or ArcGIS Online item ID";
  const serviceInput = document.createElement("input");
  serviceInput.type = "text";
  serviceInput.autocomplete = "off";
  serviceInput.placeholder = "https://.../FeatureServer";
  serviceLabel.append(serviceInput);
  const objectIdLabel = document.createElement("label");
  objectIdLabel.textContent = "ObjectID";
  const objectIdInput = document.createElement("input");
  objectIdInput.type = "text";
  objectIdInput.inputMode = "numeric";
  objectIdInput.autocomplete = "off";
  objectIdLabel.append(objectIdInput);
  const findButton = document.createElement("calcite-button");
  findButton.textContent = "Find record";
  findButton.setAttribute("width", "full");
  const serviceStatus = document.createElement("div");
  serviceStatus.className = "oid-record-status";
  serviceStatus.setAttribute("role", "status");
  service.append(serviceSummary, serviceLabel, objectIdLabel, findButton, serviceStatus);
  const input = document.createElement("textarea");
  input.className = "oid-record-input";
  input.setAttribute("aria-label", "Oriented imagery record JSON or CSV");
  input.spellcheck = false;
  input.value = JSON.stringify(Object.fromEntries([
    "ObjectID", "Shape", "Name", "ImagePath", "AcquisitionDate", "CameraHeading", "CameraPitch", "CameraRoll",
    "CameraHeight", "HorizontalFieldOfView", "VerticalFieldOfView", "NearDistance", "FarDistance", "CameraOffset",
    "OrientedImageryType", "ImageRotation", "OrientationAccuracy", "CameraOrientation", "Matrix", "FocalLength", "FocalLengthUnit",
    "PrincipalX", "PrincipalY", "Radial", "Tangential", "A0", "A1", "A2", "B0", "B1", "B2", "SequenceOrder", "OffsetFromStart",
  ].map((name) => [name, null])), null, 2);

  const fileLabel = document.createElement("label");
  fileLabel.textContent = "Open CSV or JSON file";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,.json,application/json,text/csv";
  fileLabel.append(fileInput);
  const review = document.createElement("calcite-button");
  review.textContent = "Review records and fields";
  review.setAttribute("width", "full");
  review.setAttribute("appearance", "outline");
  const selectLabel = document.createElement("label");
  selectLabel.textContent = "Record";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Select record");
  selectLabel.append(select);
  selectLabel.hidden = true;
  const fields = document.createElement("fieldset");
  fields.className = "oid-record-fields";
  fields.hidden = true;
  const legend = document.createElement("legend");
  legend.textContent = "Fields to include";
  fields.append(legend);
  let records: ImageryRecord[] = [];
  let reviewedInput = "";
  let selected: ImageryRecord | undefined;
  let requestVersion = 0;
  let lookupRequired = false;

  function invalidate(): void {
    requestVersion += 1;
    lookupRequired = false;
    records = [];
    selected = undefined;
    reviewedInput = "";
    selectLabel.hidden = true;
    fields.hidden = true;
    status.textContent = "";
  }

  function showFields(record: ImageryRecord | undefined): void {
    selected = record;
    fields.replaceChildren(legend);
    fields.hidden = !record;
    if (!record) return;
    for (const [name, value] of Object.entries(record)) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.value = name;
      const content = document.createElement("span");
      const fieldName = document.createElement("strong");
      fieldName.textContent = name;
      const fieldValue = document.createElement("span");
      fieldValue.textContent = value == null ? "(empty)" : typeof value === "object" ? JSON.stringify(value) : String(value);
      content.append(fieldName, fieldValue);
      label.append(checkbox, content);
      fields.append(label);
    }
  }

  function reviewInput(): void {
    records = parseRecordInput(input.value);
    lookupRequired = false;
    reviewedInput = input.value;
    select.replaceChildren();
    if (records.length > 1) {
      select.add(new Option(`Select one of ${records.length} records`, ""));
      records.forEach((record, index) => {
        const id = Object.entries(record).find(([name]) => name.toLowerCase() === "objectid")?.[1];
        const name = Object.entries(record).find(([key]) => key.toLowerCase() === "name")?.[1];
        select.add(new Option([`Row ${index + 1}`, id != null ? `ObjectID ${id}` : "", name ? String(name) : ""].filter(Boolean).join(" - "), String(index)));
      });
      selectLabel.hidden = false;
      showFields(undefined);
      status.textContent = `Select one of ${records.length} records.`;
    } else {
      selectLabel.hidden = true;
      showFields(records[0]);
      status.textContent = "Review the fields, then apply the record.";
    }
  }

  input.addEventListener("input", invalidate);
  const serviceChanged = (): void => {
    requestVersion += 1;
    lookupRequired = true;
    serviceStatus.textContent = "Lookup changed; find the record or review the existing input.";
  };
  serviceInput.addEventListener("input", serviceChanged);
  objectIdInput.addEventListener("input", serviceChanged);
  findButton.addEventListener("click", async () => {
    const version = ++requestVersion;
    lookupRequired = true;
    findButton.setAttribute("disabled", "");
    serviceStatus.textContent = "Querying the layer...";
    try {
      const record = await queryImageryRecord(serviceInput.value, objectIdInput.value);
      if (version !== requestVersion) return;
      input.value = JSON.stringify(record, null, 2);
      invalidate();
      reviewInput();
      serviceStatus.textContent = "Record loaded below. Review the fields and select Apply record; layer defaults are not applied.";
    } catch (error) {
      if (version === requestVersion) serviceStatus.textContent = error instanceof Error ? error.message : "Unable to query the layer.";
    } finally {
      findButton.removeAttribute("disabled");
    }
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      input.value = await file.text();
      invalidate();
      reviewInput();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Unable to read the file.";
    }
  });
  review.addEventListener("click", () => {
    requestVersion += 1;
    try { reviewInput(); } catch (error) {
      invalidate();
      status.textContent = error instanceof Error ? error.message : "Unable to read the record.";
    }
  });
  select.addEventListener("change", () => showFields(select.value === "" ? undefined : records[Number(select.value)]));
  element.append(service, input, fileLabel, review, selectLabel, fields);

  return {
    element,
    setInput: (value) => { input.value = value; invalidate(); reviewInput(); },
    getRecord: () => {
      if (lookupRequired) throw new Error("Find the requested record or review the existing input before applying.");
      if (reviewedInput !== input.value) {
        const parsed = parseRecordInput(input.value);
        if (parsed.length !== 1) throw new Error("Review the records and select one before applying.");
        return parsed[0];
      }
      if (!selected) throw new Error("Select a record before applying.");
      const included = new Set(Array.from(fields.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'), (checkbox) => checkbox.value));
      return Object.fromEntries(Object.entries(selected).filter(([name]) => included.has(name)));
    },
  };
}