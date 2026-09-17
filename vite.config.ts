import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative (not root-absolute) base - so the built dist/ folder works no matter what path/depth
  // Relative (not root-absolute) base keeps built assets portable across project-site paths.
  base: "./",
  test: {
    environment: "node",
  },
});
