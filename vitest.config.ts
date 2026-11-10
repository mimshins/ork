/**
 * @file Vitest configuration: where the packages' and tools' tests live. The
 *   UI's tests (`.tsx`) run in a DOM (jsdom); the rest run in Node. `HOME` is a
 *   temp folder, so no test reaches the developer's own `~/.ork/state.db`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineConfig } from "vitest/config";

const HOME = mkdtempSync(path.join(tmpdir(), "ork-test-home-"));
process.once("exit", () => {
  rmSync(HOME, { recursive: true, force: true });
});

export default defineConfig({
  test: {
    env: { HOME },
    projects: [
      {
        test: {
          name: "node",
          // Many tests start the CLI, git or a child process: 2.5-3.5 s in a
          // full run, past Vitest's 5 s default on a busy machine (a pre-push
          // check while a run's sessions work). A test that needs longer still
          // sets its own.
          testTimeout: 15_000,
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
