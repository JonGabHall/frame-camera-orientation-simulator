import { describe, expect, it } from "vitest";
import { parseRecordInput } from "./recordInput";

describe("record input", () => {
  it("parses quoted CSV, escaped quotes, CRLF and empty values", () => {
    expect(parseRecordInput('\uFEFFObjectID,Name,CameraHeading,CameraRoll\r\n1,"A, ""north""\r\nview",42,\r\n'))
      .toEqual([{ ObjectID: "1", Name: 'A, "north"\r\nview', CameraHeading: "42", CameraRoll: null }]);
  });

  it("preserves multiple records for explicit selection", () => {
    expect(parseRecordInput("ObjectID,CameraHeading\n1,42\n2,60")).toHaveLength(2);
    expect(parseRecordInput('{"features":[{"attributes":{"ObjectID":1},"geometry":{"x":2}},{"attributes":{"ObjectID":2}}]}'))
      .toEqual([{ ObjectID: 1, Shape: { x: 2 } }, { ObjectID: 2 }]);
  });

  it("rejects malformed or ambiguous CSV", () => {
    expect(() => parseRecordInput('Name,CameraHeading\n"unterminated,42')).toThrow("Invalid CSV");
    expect(() => parseRecordInput("Name,name\na,b")).toThrow("unique");
    expect(() => parseRecordInput("Name,\na,b")).toThrow("empty");
    expect(() => parseRecordInput("Name,CameraHeading\na")).toThrow("expected 2");
    expect(() => parseRecordInput("CameraHeading")).toThrow("header row");
  });

  it("keeps existing JSON and raw orientation formats", () => {
    expect(parseRecordInput('{"CameraHeading":42}')).toEqual([{ CameraHeading: 42 }]);
    expect(parseRecordInput("1|4326|0|0|0|0|40|60|10")).toEqual([{ CameraOrientation: "1|4326|0|0|0|0|40|60|10" }]);
  });
});