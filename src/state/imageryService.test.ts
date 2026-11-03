import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryImageryRecord } from "./imageryService";

const service = vi.hoisted(() => ({ load: vi.fn(), query: vi.fn(), destroy: vi.fn(), properties: vi.fn(), request: vi.fn() }));
vi.mock("@arcgis/core/request.js", () => ({ default: service.request }));
vi.mock("@arcgis/core/layers/OrientedImageryLayer.js", () => ({
  default: class {
    hasZ = true;
    constructor(properties: unknown) { service.properties(properties); }
    load = service.load;
    queryFeatures = service.query;
    destroy = service.destroy;
  },
}));

describe("oriented imagery service lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.load.mockResolvedValue(undefined);
    service.request.mockResolvedValue({ data: { layers: [{ id: 0, name: "Imagery", type: "Oriented Imagery Layer" }] } });
    service.query.mockResolvedValue({ features: [{ attributes: { OBJECTID: 7, CameraHeading: 42 }, geometry: { toJSON: () => ({ x: 1, y: 2, z: 3 }) } }] });
  });

  it("queries only the requested ObjectID and preserves attributes and geometry", async () => {
    expect(await queryImageryRecord("https://example.com/arcgis/rest/services/OI/FeatureServer/2", "7"))
      .toEqual({ OBJECTID: 7, CameraHeading: 42, Shape: { x: 1, y: 2, z: 3 } });
    expect(service.query).toHaveBeenCalledWith({ objectIds: [7], outFields: ["*"], returnGeometry: true, returnZ: true });
    expect(service.destroy).toHaveBeenCalledOnce();
  });

  it("supports ArcGIS Online item IDs and reports missing records", async () => {
    service.query.mockResolvedValue({ features: [] });
    await expect(queryImageryRecord("ca2aa99099414ff7aba2f1e3721f4218", "8")).rejects.toThrow("not found");
    expect(service.properties).toHaveBeenCalledWith({ portalItem: { id: "ca2aa99099414ff7aba2f1e3721f4218" } });
    expect(service.destroy).toHaveBeenCalledOnce();
  });

  it("discovers the oriented imagery layer from a service root", async () => {
    await queryImageryRecord("https://example.com/FeatureServer", "7");
    expect(service.request).toHaveBeenCalledWith("https://example.com/FeatureServer", { query: { f: "json" }, responseType: "json" });
    expect(service.properties).toHaveBeenCalledWith({ url: "https://example.com/FeatureServer/0" });
  });

  it("requires a layer number when the service has multiple candidates", async () => {
    service.request.mockResolvedValue({ data: { layers: [{ id: 0, name: "First", type: "Oriented Imagery Layer" }, { id: 2, name: "Second", type: "Oriented Imagery Layer" }] } });
    await expect(queryImageryRecord("https://example.com/FeatureServer", "7")).rejects.toThrow("0: First, 2: Second");
    expect(service.properties).not.toHaveBeenCalled();
  });

  it("rejects unsafe IDs and URLs before creating a layer", async () => {
    await expect(queryImageryRecord("https://example.com/FeatureServer/0?token=secret", "1")).rejects.toThrow("without credentials");
    await expect(queryImageryRecord("https://example.com/OtherServer", "1")).rejects.toThrow("service or layer URL");
    await expect(queryImageryRecord("https://example.com/FeatureServer/0", "9007199254740992")).rejects.toThrow("ObjectID");
    expect(service.properties).not.toHaveBeenCalled();
  });

  it("cleans up and propagates service failures", async () => {
    service.load.mockRejectedValue(new Error("Access denied"));
    await expect(queryImageryRecord("https://example.com/FeatureServer/0", "1")).rejects.toThrow("Access denied");
    expect(service.destroy).toHaveBeenCalledOnce();
  });
});