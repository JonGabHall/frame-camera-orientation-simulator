import Papa from "papaparse";

export type ImageryRecord = Record<string, unknown>;

function asRecord(value: unknown): ImageryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Each record must be an object.");
  }
  const object = value as ImageryRecord;
  if (object.attributes && typeof object.attributes === "object" && !Array.isArray(object.attributes)) {
    return { ...(object.attributes as ImageryRecord), ...(object.geometry ? { Shape: object.geometry } : {}) };
  }
  return object;
}

export function parseRecordInput(input: string): ImageryRecord[] {
  const text = input.trim().replace(/^\uFEFF/, "");
  if (!text) throw new Error("Enter a JSON record, CSV with headers, or CameraOrientation string.");
  if (/^[1-4]\|/.test(text)) return [{ CameraOrientation: text }];
  if (text.startsWith("{") || text.startsWith("[")) {
    const parsed: unknown = JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as ImageryRecord).features)
      ? (parsed as { features: unknown[] }).features : [parsed];
    if (!records.length) throw new Error("No records found.");
    return records.map(asRecord);
  }
  const result = Papa.parse<string[]>(text, { delimiter: ",", skipEmptyLines: "greedy" });
  if (result.errors.length) throw new Error(`Invalid CSV: ${result.errors[0].message}`);
  const [header, ...rows] = result.data;
  if (!header || !rows.length) throw new Error("CSV needs a header row and at least one record.");
  const names = header.map((name) => name.trim());
  if (names.some((name) => !name)) throw new Error("CSV field names cannot be empty.");
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new Error("CSV field names must be unique.");
  return rows.map((row, index) => {
    if (row.length !== names.length) throw new Error(`CSV record ${index + 1} has ${row.length} values; expected ${names.length}.`);
    return Object.fromEntries(names.map((name, column) => [name, row[column] === "" ? null : row[column]]));
  });
}