import { defineConfig } from "tsdown";

// The published CLI is one bundle: the private workspace packages
// (@krapht/ork-*) are built into it, and the third-party packages in
// "dependencies" stay external and are installed with it.
export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  dts: false,
  deps: { alwaysBundle: [/^@krapht\/ork-/u] },
});
