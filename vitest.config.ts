/** @file Vitest configuration: where the packages' and tools' tests live. */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts"],
  },
});
