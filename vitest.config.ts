/**
 * @file Vitest configuration: where the packages' and tools' tests live. The
 *   UI's tests (`.tsx`) run in a DOM (jsdom); the rest run in Node.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: [
            "packages/*/test/**/*.test.ts",
            "tools/*/test/**/*.test.ts",
          ],
          exclude: ["packages/ui/**"],
        },
      },
      {
        test: {
          name: "ui",
          include: ["packages/ui/test/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
