import type { ImageryRecord } from "./recordInput";

export async function queryImageryRecord(source: string, objectId: string): Promise<ImageryRecord> {
  const identifier = source.trim();
  const idText = objectId.trim();
  if (!/^\d+$/.test(idText) || !Number.isSafeInteger(Number(idText))) throw new Error("Enter a nonnegative, safe integer ObjectID.");
  let properties: { url: string } | { portalItem: { id: string } };
  if (/^[a-f\d]{32}$/i.test(identifier)) {
    properties = { portalItem: { id: identifier } };
  } else {
    let url: URL;
    try { url = new URL(identifier); } catch { throw new Error("Enter an oriented imagery layer URL or ArcGIS Online item ID."); }
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) || url.username || url.password || url.search || url.hash) {
      throw new Error("Use an HTTPS layer URL without credentials, query parameters, or a fragment.");
    }
    if (/\/(FeatureServer|MapServer)\/?$/i.test(url.pathname)) {
      const { default: request } = await import("@arcgis/core/request.js");
      const response = await request(url.toString(), { query: { f: "json" }, responseType: "json" });
      const layers = Array.isArray(response.data.layers) ? response.data.layers as { id: number; name: string; type?: string }[] : [];
      const orientedLayers = layers.filter((layer) => layer.type?.toLowerCase() === "oriented imagery layer");
      const candidates = orientedLayers.length ? orientedLayers : layers;
      if (candidates.length !== 1 || !Number.isInteger(candidates[0].id) || candidates[0].id < 0) {
        const available = candidates.map((layer) => `${layer.id}: ${layer.name}`).join(", ");
        throw new Error(available ? `Multiple layers found (${available}). Use a layer URL ending in its number.` : "No queryable layer found. Use a layer URL ending in its number.");
      }
      url.pathname = `${url.pathname.replace(/\/$/, "")}/${candidates[0].id}`;
    }
    if (!/\/(FeatureServer|MapServer)\/\d+\/?$/i.test(url.pathname)) throw new Error("Enter a FeatureServer or MapServer service or layer URL.");
    properties = { url: url.toString() };
  }
  const { default: OrientedImageryLayer } = await import("@arcgis/core/layers/OrientedImageryLayer.js");
  const layer = new OrientedImageryLayer(properties);
  try {
    await layer.load();
    const result = await layer.queryFeatures({ objectIds: [Number(idText)], outFields: ["*"], returnGeometry: true, returnZ: layer.hasZ });
    if (result.features.length === 0) throw new Error(`ObjectID ${idText} was not found or is not accessible.`);
    if (result.features.length !== 1) throw new Error("The service returned more than one matching record.");
    const feature = result.features[0];
    return { ...feature.attributes, ...(feature.geometry ? { Shape: feature.geometry.toJSON() } : {}) };
  } finally {
    layer.destroy();
  }
}